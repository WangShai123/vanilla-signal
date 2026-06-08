# Signal Documentation

`Signal` is a fine-grained reactive runtime, designed to closely match the SolidJS mental model while maintaining "zero dependencies and no build step required for direct browser usage". It's suitable for building small to medium-sized UIs, forms, lists, inventory tables, modal content, async data sections, and other interactions using vanilla JavaScript.

## Design Goals

- Fine-grained updates: Only the effects or DOM elements that read a specific signal/store field will update when that field changes.
- No framework dependencies: Doesn't rely on React/Vue/Solid, and doesn't require build tools.
- Supports complex UI state: Handles deep objects, arrays, sorting, insertion, deletion, derived state, and async requests.
- Supports JSX experience: Uses `` jsx `...` `` template literals in environments without builds; can integrate with JSX runtime in build environments.
- Maintainable: Business code is organized in layers of state, memo, effect, and DOM binding.

## Install

npm:

```bash
npm install vanilla-signal
```

script:

```html
<!-- umd GlobalName: signal -->
<script src="https://unpkg.com/vanilla-signal/dist/index.umd.js"></script>
<script>
  const { createSignal } = signal;
</script>

<!-- es module -->
<script type="module">
  import { createSignal } from 'https://unpkg.com/vanilla-signal/dist/index.mjs';
</script>
```

## Basic Concepts

### Accessor

The read function of a signal is called an accessor:

```js
const [count, setCount] = createSignal(0);

count(); // Read current value
setCount(1); // Update
```

Reading an accessor within reactive contexts like `createEffect`, `createMemo`, `insert`, or `jsx` dynamic interpolations automatically establishes dependencies.

### Owner and Cleanup

`createRoot`, `createScope`, `createEffect`, and list item roots all form an owner tree. Cleanup functions registered with `onCleanup` execute when effects re-run or owners are disposed.

```js
const dispose = createRoot((dispose) => {
  const timer = setInterval(() => {}, 1000);
  onCleanup(() => clearInterval(timer));
  return dispose;
});

dispose();
```

### Recommended Organization

```js
const state = createDeepStore({
  rows: [],
  filter: '',
});

const visibleRows = createMemo(() => {
  return state.rows.filter((row) => row.name.includes(state.filter));
});

render(
  () => jsx`
  <section>
    <input value=${() => state.filter} onInput=${(e) => {
      state.filter = e.currentTarget.value;
    }}>
    ${For({
      each: visibleRows,
      key: (row) => row.id,
      children: (row) => jsx`<div>${() => row().name}</div>`,
    })}
  </section>
`,
  document.getElementById('app')
);
```

## API Overview

| Category       | API                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Core Reactive  | `createSignal`, `createEffect`, `createComputed`, `createMemo`, `createWatch`, `createSelector`, `access` |
| Scheduling     | `batch`, `untrack`, `flushSync`, `startTransition`                                                        |
| Lifecycle      | `createRoot`, `createScope`, `onCleanup`, `onDispose`, `onMount`, `getOwner`                              |
| Error Handling | `createErrorBoundary`, `catchError`                                                                       |
| Store          | `createStore`, `createDeepStore`, `createReadonly`, `produce`, `unwrap`, `snapshot`                       |
| Async          | `createResource`, `createQuery`, `createSuspense`                                                         |
| DOM            | `insert`, `render`, `bindText`, `bindAttr`, `bindStyle`, `bindClass`, `bindShow`, `bindIf`, `bindList`    |
| List Helpers   | `createListKey`, `createCompositeKey`, `For`, `Show`                                                      |
| JSX Runtime    | `jsx`, `jsxs`, `jsxDEV`, `h`, `createElement`, `Fragment`                                                 |

## Core Reactive

### createSignal

```js
const [read, write] = createSignal(initial, options?)
```

Used to store the most basic reactive values.

```js
const [count, setCount] = createSignal(0);

createEffect(() => {
  console.log('count:', count());
});

setCount(1);
setCount((value) => value + 1);
```

Options:

```js
createSignal(value, {
  equals: Object.is, // default
});
```

`equals` is used to determine if old and new values are the same. Set to `false` to force notification of dependencies on every write:

```js
const [value, setValue] = createSignal({}, { equals: false });
setValue(value()); // Still triggers
```

Read without tracking:

```js
count.peek();
```

Use cases:

- Button counters, toggle states, current tab, selected item id.
- Simple values that don't need deep field reactivity.

### createEffect

```js
const effect = createEffect(fn, options?)
effect.dispose()
```

When dependencies read within the effect change, the effect will re-run.

```js
const [name, setName] = createSignal('JUI');

createEffect(() => {
  document.title = `Hello ${name()}`;
});
```

Clean up previous run:

```js
createEffect(() => {
  const id = setInterval(() => {
    console.log('tick');
  }, 1000);

  onCleanup(() => clearInterval(id));
});
```

Options:

```js
createEffect(fn, {
  defer: true, // Defer to scheduler queue
  priority: 10, // Higher number means higher priority
});
```

Notes:

- Don't unconditionally write to signals you depend on within an effect, as this may cause infinite loops.
- DOM bindings, event subscriptions, and third-party component instantiation are suitable for effects/roots.

### createComputed

`createComputed(fn, options?)` is an alias for `createEffect`. Used to express "derived side effects" with better semantic readability.

```js
createComputed(() => {
  console.log(store.total);
});
```

### createMemo

```js
const memo = createMemo(fn, initial?, options?)
```

Used to cache derived values. Only notifies downstream when dependencies change and the calculated result changes.

```js
const [price, setPrice] = createSignal(100);
const [count, setCount] = createSignal(2);

const total = createMemo(() => price() * count());

console.log(total()); // 200
```

Custom equality check:

```js
const userName = createMemo(() => user().name.trim(), '', {
  equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
});
```

Dispose memo:

```js
total.dispose();
```

Use cases:

- Total inventory, filtered results, total amount, formatted UI text.
- Any value that can be derived from existing state.

### createWatch

```js
createWatch(source, callback, options?)
```

Listens for changes in one or more sources, suitable for executing "actions after change".

```js
const [keyword, setKeyword] = createSignal('');

createWatch(
  keyword,
  (next, prev) => {
    console.log('keyword changed:', prev, '=>', next);
  },
  { defer: true }
);
```

Listen to multiple sources:

```js
createWatch(
  [page, pageSize],
  ([nextPage, nextSize], previous) => {
    loadList(nextPage, nextSize);
  },
  { defer: true }
);
```

Notes:

- `defer: true` means the callback is not called initially, only on subsequent changes.
- The callback executes with `untrack` by default and won't additionally subscribe to signals read within the callback.

### createSelector

```js
const isSelected = createSelector(selectedId);
```

Used for list selection state determination:

```js
const [selectedId, setSelectedId] = createSignal('a');
const isSelected = createSelector(selectedId);

jsx`
  <button class=${() => (isSelected('a') ? 'active' : '')}>A</button>
`;
```

### access

```js
access(value);
```

If `value` is a function, call it; otherwise return the original value. Commonly used in APIs that accept "plain values or accessors".

```js
function toText(value) {
  return String(access(value) ?? '');
}
```

## Scheduler API

### batch

```js
batch(() => {
  state.a = 1;
  state.b = 2;
  setCount(3);
});
```

Batch update dependencies to avoid triggering effects on every write.

Use cases:

- Batch form resets.
- Batch modification of SKU prices or inventory.
- Multiple signal/store fields must be updated as a single transaction.

### untrack

```js
createEffect(() => {
  const id = selectedId();
  const cache = untrack(() => cacheMap());
});
```

Read values without establishing dependencies.

Use cases:

- Reading auxiliary state in effects without wanting it to trigger effect re-runs.
- Writing logs, reading caches, reading previous snapshots.

### flushSync

```js
flushSync(() => {
  setOpen(true);
});
```

Synchronously flush scheduled effects. Suitable for rare scenarios where you need to immediately read DOM results.

```js
flushSync(() => setOpen(true));
panel.getBoundingClientRect();
```

### startTransition

```js
startTransition(() => {
  state.keyword = input;
});
```

Put updates into a low-priority queue. Suitable for search, filtering, large list refreshes, and other tasks that don't need to immediately block current interactions.

## Lifecycle

### createRoot

```js
const dispose = createRoot((dispose) => {
  createEffect(() => {
    console.log(count());
  });

  return dispose;
});

dispose();
```

`createRoot` creates a reactive root. The return value is determined by the callback; if the callback has no return value, it returns `{ dispose, run }`.

Recommended to create roots at the entry points of page sections, modal content, or component instances.

### createScope

```js
const scope = createScope(() => {
  createEffect(() => {});
});

scope.dispose();
scope.run(() => {});
```

`createScope` is similar to `createRoot` but always returns a scope object, suitable for internal tool management.

### onCleanup / onDispose

```js
createEffect(() => {
  const handler = () => {};
  window.addEventListener('resize', handler);
  onCleanup(() => window.removeEventListener('resize', handler));
});
```

`onDispose` is an alias for `onCleanup`.

### onMount

```js
createRoot(() => {
  onMount(() => {
    console.log('mounted in microtask');
  });
});
```

Runs in a microtask after the current owner is created. Suitable for initialization logic that depends on DOM being inserted.

### getOwner

```js
const owner = getOwner();
```

Returns the current owner. Mainly used for low-level tools and debugging; business code generally doesn't need to use it directly.

## Error Handling

### createErrorBoundary

```js
const boundary = createErrorBoundary(() => {
  createEffect(() => {
    if (count() > 5) throw new Error('Too large');
  });
});

createEffect(() => {
  if (boundary.hasError()) {
    console.error(boundary.error());
  }
});
```

Returns:

```js
{
  error,      // signal accessor
  fallback,   // passed-in fallback
  hasError,   // () => boolean
  reset,      // rebuild boundary
  dispose,    // destroy boundary
}
```

### catchError

```js
const result = catchError(
  () => JSON.parse(text),
  (error) => ({ error: error.message })
);
```

Used for safe execution of synchronous functions.

## Store

### createStore

```js
const user = createStore({
  name: 'Alice',
  profile: { city: 'Beijing' },
});

createEffect(() => {
  console.log(user.name);
});

user.name = 'Bob';
```

`createStore` is shallow reactive:

- Changes to `user.name` will trigger.
- `user.profile.city = 'Shanghai'` won't trigger effects reading `user.profile.city` because `profile` doesn't have deep proxying.

Use cases:

- Flat objects.
- Configuration or form states that only need to track first-level fields.

### createDeepStore

```js
const state = createDeepStore({
  user: {
    profile: {
      city: 'Beijing',
    },
  },
});

createEffect(() => {
  console.log(state.user.profile.city);
});

state.user.profile.city = 'Shanghai';
```

`createDeepStore` recursively proxies plain objects and arrays, suitable for complex UI state.

#### SKU Inventory Table Example

```js
const skuState = createDeepStore({
  rows: [
    { id: 'black-s', color: 'Black', size: 'S', stock: 12, price: 89 },
    { id: 'black-m', color: 'Black', size: 'M', stock: 4, price: 89 },
  ],
});

const totalStock = createMemo(() => {
  return skuState.rows.reduce((sum, row) => sum + Number(row.stock || 0), 0);
});

const lowStockCount = createMemo(() => {
  return skuState.rows.filter((row) => row.stock < 5).length;
});

createEffect(() => {
  console.log('total:', totalStock(), 'low:', lowStockCount());
});

skuState.rows[1].stock = 8;
skuState.rows.push({
  id: 'green-l',
  color: 'Green',
  size: 'L',
  stock: 2,
  price: 129,
});
skuState.rows.sort((a, b) => a.stock - b.stock);
```

Array support:

- Index reading: `rows[0]`
- Length reading: `rows.length`
- Iteration reading: `map`, `filter`, `reduce`, `for...of`
- Mutation methods: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`

Notes:

- Deep proxying mainly supports plain objects and arrays.
- `Date`, `Map`, `Set`, class instances are not deeply proxied; recommend using them as plain values or converting to plain object/array.

### createReadonly

```js
const readonlyState = createReadonly(state);
```

Creates a readonly deep store. Writes will be ignored and warnings will be output.

Use cases:

- Exposing public state to external modules without allowing external modifications.
- Component props readonly.

### produce

```js
produce(state, (draft) => {
  draft.user.name = 'Bob';
  draft.rows.push({ id: 'new', stock: 1 });
});
```

Executes multiple modifications in a single `batch`. This is not Immer; it doesn't generate immutable copies but directly modifies the passed store.

### unwrap / snapshot

```js
const raw = unwrap(state);
const copy = snapshot(state);
```

Converts store/proxy to plain objects. `snapshot` is currently equivalent to `unwrap`.

Use cases:

- Serialization before API submission.
- Debug output.
- Saving current state.

## Async Data

### createResource

```js
const [data, controls] = createResource(fetcher, options?)
```

Or:

```js
const [id, setId] = createSignal(1);

const [data, { state, reload, refetch, mutate }] = createResource(
  id,
  async (id) => {
    const response = await fetch(`/api/item/${id}`);
    return response.json();
  }
);
```

`state` fields:

```js
state.data;
state.latest;
state.loading;
state.error;
state.isStale;
```

Control methods:

- `reload(value?)`: Manually reload, will enter loading state.
- `refetch(value?)`: Re-request, keeps stale state when data already exists.
- `mutate(value | updater)`: Local modification of data.

Options:

```js
createResource(fetcher, {
  source, // accessor, automatically requests when changed
  initialValue, // initial data
  loadingDelay, // delay showing loading to reduce flickering
  suspense, // throws promise when read() during loading without data
  throwErrors, // throws error when read()
});
```

Example: With loading UI

```js
const [user, { state, reload }] = createResource(async () => {
  const response = await fetch('/api/user');
  return response.json();
});

render(
  () => jsx`
  <section>
    ${() =>
      state.loading
        ? jsx`<div>Loading...</div>`
        : state.error
          ? jsx`<button onClick=${reload}>Retry</button>`
          : jsx`<div>${() => user()?.name}</div>`}
  </section>
`,
  app
);
```

### createQuery

`createQuery` is a more business-oriented request API with built-in status, loading, error, retry/refetch states, suitable for lists, details, dashboard cards, and other async sections.

```js
const query = createQuery({
  queryKey: () => state.keyword,
  queryFn: async ({ queryKey, signal, attempt }) => {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(queryKey)}`,
      {
        signal,
      }
    );
    return response.json();
  },
  retry: 2,
  retryDelay: (attempt) => attempt * 500,
});
```

Reading data:

```js
query();
query.state.status; // pending | success | error
query.state.isLoading;
query.state.isFetching;
query.state.isError;
query.state.isSuccess;
query.state.error;
query.state.failureCount;
query.state.updatedAt;
```

Control methods:

```js
query.refetch();
query.retry();
query.promise();
```

#### Loading / Skeleton / Retry Example

```js
const products = createQuery({
  retry: 0,
  queryFn: async () => {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  },
});

render(
  () => jsx`
  <section>
    ${() =>
      products.state.isLoading
        ? jsx`<div class="skeleton">Loading products...</div>`
        : products.state.isError
          ? jsx`
          <div class="error">
            ${() => products.state.error?.message || 'Request failed'}
            <button onClick=${() => products.retry()}>Retry</button>
          </div>
        `
          : jsx`
          <ul>
            ${For({
              each: () => products() || [],
              key: (item) => item.id,
              children: (item) => jsx`<li>${() => item().name}</li>`,
            })}
          </ul>
        `}
  </section>
`,
  app
);
```

Options:

```js
createQuery({
  queryKey, // plain value or accessor; changes trigger re-request
  queryFn, // ({ queryKey, signal, attempt }) => Promise<data>
  enabled: true, // plain value or accessor; doesn't auto-request when false
  initialData, // initial data
  keepPreviousData: true,
  retry: 0, // number or (attempt, error) => boolean
  retryDelay: (attempt) => Math.min(1000 * attempt, 3000),
});
```

### createSuspense

```js
const content = createSuspense(() => resource(), jsx`<div>Loading...</div>`);
```

Captures Promises thrown in functions, returns fallback, and triggers recalculation after Promise completion. Suitable for advanced scenarios with `createResource({ suspense: true })`.

## DOM API

### render

```js
const dispose = render(
  () => jsx`
  <button>${() => count()}</button>
`,
  document.getElementById('app')
);

dispose();
```

Clears container and inserts value into it. Returns root dispose.

### insert

```js
const cleanup = insert(parent, () => count());
cleanup();
```

Inserts plain values, DOM Nodes, arrays, or accessors into parent. Automatically replaces content when accessor updates.

### bindText

```js
bindText(el, () => `Hello ${name()}`);
```

Binds `textContent`.

### bindAttr

```js
bindAttr(input, 'disabled', () => loading());
bindAttr(link, 'href', () => state.url);
```

`null`, `undefined`, `false` will remove the attribute; `true` will set an empty attribute.

### bindStyle

```js
bindStyle(el, 'width', () => `${progress()}%`);

bindStyle(el, () => ({
  color: state.danger ? 'red' : 'green',
  display: state.visible ? '' : 'none',
}));
```

### bindClass

```js
bindClass(el, 'is-active', () => selected());
```

### bindShow

```js
bindShow(panel, () => state.open);
```

Controls show/hide via `display: none`.

### bindIf

```js
const anchor = document.createComment('if');
container.append(anchor);

bindIf(
  anchor,
  () => state.open,
  () => jsx`<div>Panel</div>`
);
```

Inserts nodes returned by factory when condition is true; removes when false.

### bindList

```js
const anchor = document.createComment('rows');
tbody.append(anchor);

bindList(
  anchor,
  () => state.rows,
  (row, index, rowAccessor) => jsx`
    <tr>
      <td>${() => rowAccessor().name}</td>
      <td>${() => index()}</td>
    </tr>
  `,
  {
    key: (row) => row.id,
    fallback: jsx`<tr><td>No data</td></tr>`,
  }
);
```

Parameters:

- `anchor`: List insertion position, must already be in DOM.
- `listSignal`: Array or accessor returning array.
- `renderItem(item, indexAccessor, itemAccessor)`: Creates list item nodes.
- `options.key`: Generates stable keys. Strongly recommended for object lists.
- `options.fallback`: Content displayed when list is empty.

Notes:

- Lists with stable ids must use `key`.
- If defaulting to index-based node reuse, list item content needs to be read via `itemAccessor()` to update with position data.
- `bindList` reuses old nodes and moves DOM, suitable for sorting, insertion, deletion.

Helper keys:

```js
bindList(anchor, rows, render, {
  key: createListKey('id'),
});

bindList(anchor, rows, render, {
  key: createCompositeKey('color', 'size'),
});
```

## JSX Runtime

### Without Build: jsx tagged template

Browsers cannot directly parse `<div />` JSX syntax. Use `jsx\`...\`` in no-build scenarios:

```js
const [count, setCount] = createSignal(0);

render(
  () => jsx`
  <button
    class=${() => (count() > 5 ? 'is-hot' : '')}
    onClick=${() => setCount((value) => value + 1)}
  >
    ${() => `count: ${count()}`}
  </button>
`,
  app
);
```

Dynamic rules:

- Child node interpolations can be strings, numbers, DOM Nodes, arrays, or accessors.
- Attribute interpolations can be plain values or accessors.
- Events use `onClick`, `onInput`, etc. properties.
- Both `class` and `className` are available.
- `style` can accept strings or objects.

```js
jsx`
  <input
    value=${() => state.keyword}
    onInput=${(event) => {
      state.keyword = event.currentTarget.value;
    }}
  >
`;
```

### With Build: JSX runtime

If your project integrates Babel/Vite JSX transformation, you can configure to use this runtime:

```js
// automatic runtime requires build tools to transform JSX into jsx/jsxs calls
// importSource points to index.js export location, configure according to actual project path
```

After compilation, equivalent to:

```js
jsx('div', { children: 'test' });
```

Notes:

- `jsx(<div>test</div>)` is not valid browser JavaScript; must be transformed by JSX compiler before running.
- JUI's no-build syntax is `jsx\`<div>test</div>\``.

### h / createElement

`h` is a factory function for manual writing or after JSX compilation:

```js
const node = h(
  'button',
  {
    onClick: () => setCount(count() + 1),
    class: () => (count() > 0 ? 'active' : ''),
  },
  () => count()
);
```

`createElement` is an alias for `h`.

### Fragment

```js
Fragment({
  children: [jsx`<span>A</span>`, jsx`<span>B</span>`],
});
```

Usually used by JSX compilers.

### Show

```js
insert(
  container,
  Show({
    when: () => state.visible,
    fallback: jsx`<span>Hidden</span>`,
    children: jsx`<strong>Visible</strong>`,
  })
);
```

Can also pass function children:

```js
Show({
  when: user,
  fallback: jsx`<span>Not logged in</span>`,
  children: (currentUser) => jsx`<span>${currentUser.name}</span>`,
});
```

### For

```js
insert(
  container,
  For({
    each: items,
    key: (item) => item.id,
    children: (item, index) => jsx`
    <div>
      ${() => index() + 1}.
      ${() => item().name}
    </div>
  `,
  })
);
```

`For`'s `children` receives:

- `item`: Current item accessor, needs to be read with `item()`.
- `index`: Current index accessor, needs to be read with `index()`.

Why item is an accessor:

- When defaulting to index-based node reuse, the item corresponding to the same DOM node may change.
- Reading via `item()` allows node content to update with list changes.

Simple string arrays:

```js
const [items, setItems] = createSignal(['one', 'two']);

insert(
  container,
  For({
    each: items,
    children: (item) => jsx`<span>${item}</span>`,
  })
);

setItems(['two', 'three']);
```

In the example above, `${item}` is treated as an accessor by `jsx`.

Object arrays should provide keys:

```js
For({
  each: () => state.rows,
  key: (row) => row.id,
  children: (row) => jsx`
    <div>${() => row().name}</div>
  `,
});
```

## Common Business Scenarios

### 1. Modal Internal Reactive Form

```js
function mountModalContent(container) {
  return render(() => {
    const form = createDeepStore({
      name: '',
      count: 1,
    });

    const canSubmit = createMemo(() => form.name.trim() && form.count > 0);

    return jsx`
      <form>
        <input value=${() => form.name} onInput=${(e) => {
          form.name = e.currentTarget.value;
        }}>
        <input type="number" value=${() => form.count} onInput=${(e) => {
          form.count = Number(e.currentTarget.value);
        }}>
        <button disabled=${() => !canSubmit()}>Submit</button>
      </form>
    `;
  }, container);
}
```

### 2. Toast Queue

```js
const toasts = createDeepStore([]);

function addToast(message) {
  const id = crypto.randomUUID();
  toasts.push({ id, message });

  setTimeout(() => {
    const index = toasts.findIndex((item) => item.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }, 3000);
}

render(
  () => jsx`
  <div class="toast-stack">
    ${For({
      each: () => toasts,
      key: (toast) => toast.id,
      children: (toast) =>
        jsx`<div class="toast">${() => toast().message}</div>`,
    })}
  </div>
`,
  app
);
```

### 3. SKU Inventory Table

```js
const state = createDeepStore({
  rows: [
    { id: 'black-s', name: 'Tee', size: 'S', stock: 12, price: 89 },
    { id: 'black-m', name: 'Tee', size: 'M', stock: 4, price: 89 },
  ],
});

const totalStock = createMemo(() => {
  return state.rows.reduce((sum, row) => sum + Number(row.stock || 0), 0);
});

render(
  () => jsx`
  <section>
    <strong>${() => `Total Stock: ${totalStock()}`}</strong>
    <table>
      <tbody>
        ${For({
          each: () => state.rows,
          key: (row) => row.id,
          children: (row) => jsx`
            <tr>
              <td>${() => row().name}</td>
              <td>${() => row().size}</td>
              <td>
                <input type="number" value=${() => row().stock} onInput=${(
                  e
                ) => {
                  row().stock = Number(e.currentTarget.value);
                }}>
              </td>
              <td>${() => (row().stock < 5 ? 'Low Stock' : 'Normal')}</td>
            </tr>
          `,
        })}
      </tbody>
    </table>
  </section>
`,
  app
);
```

### 4. Search List

```js
const state = createDeepStore({
  keyword: '',
});

const result = createQuery({
  queryKey: () => state.keyword,
  enabled: () => state.keyword.trim().length > 0,
  queryFn: async ({ queryKey }) => {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(queryKey)}`
    );
    return response.json();
  },
});

render(
  () => jsx`
  <section>
    <input value=${() => state.keyword} onInput=${(e) => {
      state.keyword = e.currentTarget.value;
    }}>

    ${() =>
      result.state.isLoading
        ? jsx`<div>Searching...</div>`
        : result.state.isError
          ? jsx`<button onClick=${() => result.retry()}>Retry</button>`
          : For({
              each: () => result() || [],
              key: (item) => item.id,
              children: (item) => jsx`<div>${() => item().title}</div>`,
            })}
  </section>
`,
  app
);
```

## Performance Recommendations

- Prefer using `createMemo` to express derived values; don't duplicate derivable state into multiple signals.
- Use `batch` or `produce` when batch modifying stores.
- Large lists must provide stable `key` to avoid content misalignment from index-based reuse.
- Read `item()` and `index()` inside list items; don't treat the creation-time item as an eternally unchanged value.
- Only read dependencies that truly need to trigger re-runs in effects; use `untrack` for other reads.
- `createDeepStore` is suitable for UI state; large static data can remain as plain objects, making only filter conditions, selected items, and editable fields reactive.

## Debugging Recommendations

- Signal accessors have `peek()` for non-tracking current value reads.
- Stores can use `snapshot(store)` to output plain objects.
- You can set `window.__SIGNAL_DEVTOOLS__ = { emit(type, payload) {} }` in the browser to receive runtime events.
- If encountering effect loops, check whether the effect writes to signals/stores it reads.

## Limitations and Conventions

- No-build scenarios don't support browsers directly parsing `<div />` JSX syntax; please use `` jsx `...` ``.
- `jsx(<div />)` must rely on build tools to transform JSX into function calls; native browsers cannot execute it.
- Deep store only recursively proxies plain objects and arrays; `Map`, `Set`, `Date`, class instances are treated as plain values.
- `bindList`'s anchor must already be in DOM.
- Async request APIs handle "latest request priority"; expired requests won't override new data.
- `createQuery` initial auto-request failures swallow unhandled Promise rejections, but errors are saved in `query.state.error`; manually returned Promises from `retry/refetch` can still be `await/catch` by callers.

## API Quick Reference

```js
// Core
createSignal(initial, options?)
createEffect(fn, options?)
createComputed(fn, options?)
createMemo(fn, initial?, options?)
createWatch(source | source[], callback, options?)
createSelector(source, equals?)
access(value)

// Scheduler
batch(fn)
untrack(fn)
flushSync(fn?)
startTransition(fn)

// Lifecycle
createRoot(fn)
createScope(fn)
onCleanup(fn)
onDispose(fn)
onMount(fn)
getOwner()

// Error
createErrorBoundary(fn, fallback?)
catchError(fn, fallback)

// Store
createStore(target?)
createDeepStore(target?)
createReadonly(target?)
produce(store, recipe)
unwrap(value)
snapshot(value)

// Async
createResource(fetcher, options?)
createResource(source, fetcher, options?)
createQuery(options | queryFn)
createSuspense(fn, fallback)

// DOM
render(value, container)
insert(parent, value, marker?)
bindText(el, signal)
bindAttr(el, name, signal)
bindStyle(el, nameOrObject, signal?)
bindClass(el, className, signal)
bindShow(el, signal, display?)
bindIf(anchor, condition, factory)
bindList(anchor, listSignal, renderItem, options?)

// List helpers
createListKey(property)
createCompositeKey(...properties)
Show(props)
For(props)

// JSX
jsx
jsxs
jsxDEV
h
createElement
Fragment
```
