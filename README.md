# Signal

`signal.js` is a fine-grained reactive runtime, designed to closely match the SolidJS mental model while maintaining "zero dependencies and no build step required for direct browser usage". It's suitable for building small to medium-sized UIs, forms, lists, inventory tables, modal content, async data sections, and other interactions using vanilla JavaScript.

## Design Goals

- Fine-grained updates: Only the effects or DOM elements that read a specific signal/store field will update when that field changes.
- No framework dependencies: Doesn't rely on React/Vue/Solid, and doesn't require build tools.
- Supports complex UI state: Handles deep objects, arrays, sorting, insertion, deletion, derived state, and async requests.
- Supports JSX experience: Uses `` jsx `...` `` template literals in environments without builds; can integrate with JSX runtime in build environments.
- Maintainable: Business code is organized in layers of state, memo, effect, and DOM binding.

## Build Outputs

- `signal.mjs`: ES Module, suitable for modern browsers and build tools.
- `signal.umd.js`: UMD module, suitable for direct inclusion in browsers via `<script>` tag. GlobalName: `signal`.

## Documentation

- [Documentation](./docs/signal.md)

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
