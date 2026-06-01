# Signal 使用文档

`signal.js` 是细粒度响应式运行时，设计目标是接近 SolidJS 的心智模型，同时保持“无依赖、无构建也能直接在浏览器中使用”。它适合用原生 JS 编写中小型 UI、表单、列表、库存表、弹窗内容、异步数据区块等交互。

## 设计目标

- 细粒度更新：读了哪个 signal/store 字段，就只在该字段变化时更新对应 effect 或 DOM。
- 无框架依赖：不依赖 React/Vue/Solid，也不要求构建工具。
- 支持复杂 UI 状态：支持深层对象、数组、排序、插入、删除、派生状态和异步请求。
- 支持 JSX 使用体验：无构建环境使用 `` jsx `...` `` 模板；有构建环境可接入 JSX runtime。
- 可维护：业务代码以 state、memo、effect、DOM binding 分层组织。

## 打包结果

- `signal.mjs`：ES Module，适合现代浏览器和构建工具。
- `signal.umd.js`：UMD 模块，适合直接在浏览器中通过 `<script>` 引入。GlobalName: `signal`。

## 基本概念

### Accessor

Signal 的读取函数称为 accessor：

```js
const [count, setCount] = createSignal(0);

count(); // 读取当前值
setCount(1); // 更新
```

在 `createEffect`、`createMemo`、`insert`、`jsx` 动态插值等响应式上下文中读取 accessor，会自动建立依赖。

### Owner 与清理

`createRoot`、`createScope`、`createEffect`、列表项 root 都会形成 owner 树。`onCleanup` 注册的清理函数会在 effect 重跑或 owner 销毁时执行。

```js
const dispose = createRoot((dispose) => {
  const timer = setInterval(() => {}, 1000);
  onCleanup(() => clearInterval(timer));
  return dispose;
});

dispose();
```

### 推荐组织方式

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

## API 总览

| 分类        | API                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| 核心响应式  | `createSignal`, `createEffect`, `createComputed`, `createMemo`, `createWatch`, `createSelector`, `access` |
| 调度        | `batch`, `untrack`, `flushSync`, `startTransition`                                                        |
| 生命周期    | `createRoot`, `createScope`, `onCleanup`, `onDispose`, `onMount`, `getOwner`                              |
| 错误处理    | `createErrorBoundary`, `catchError`                                                                       |
| Store       | `createStore`, `createDeepStore`, `createReadonly`, `produce`, `unwrap`, `snapshot`                       |
| 异步        | `createResource`, `createQuery`, `createSuspense`                                                         |
| DOM         | `insert`, `render`, `bindText`, `bindAttr`, `bindStyle`, `bindClass`, `bindShow`, `bindIf`, `bindList`    |
| 列表辅助    | `createListKey`, `createCompositeKey`, `For`, `Show`                                                      |
| JSX Runtime | `jsx`, `jsxs`, `jsxDEV`, `h`, `createElement`, `Fragment`                                                 |

## 核心响应式

### createSignal

```js
const [read, write] = createSignal(initial, options?)
```

用于保存最基础的响应式值。

```js
const [count, setCount] = createSignal(0);

createEffect(() => {
  console.log('count:', count());
});

setCount(1);
setCount((value) => value + 1);
```

选项：

```js
createSignal(value, {
  equals: Object.is, // 默认
});
```

`equals` 用于判断新旧值是否相同。设置为 `false` 可强制每次写入都通知依赖：

```js
const [value, setValue] = createSignal({}, { equals: false });
setValue(value()); // 仍然触发
```

读取但不追踪：

```js
count.peek();
```

适用场景：

- 按钮计数、开关状态、当前 tab、选中项 id。
- 不需要深层字段响应的简单值。

### createEffect

```js
const effect = createEffect(fn, options?)
effect.dispose()
```

当 effect 内读取的依赖变化时，effect 会重新运行。

```js
const [name, setName] = createSignal('JUI');

createEffect(() => {
  document.title = `Hello ${name()}`;
});
```

清理上一次运行：

```js
createEffect(() => {
  const id = setInterval(() => {
    console.log('tick');
  }, 1000);

  onCleanup(() => clearInterval(id));
});
```

选项：

```js
createEffect(fn, {
  defer: true, // 延迟到调度队列运行
  priority: 10, // 数字越大优先级越高
});
```

注意：

- effect 内不要无条件写入自己依赖的 signal，否则可能形成循环更新。
- DOM 绑定、事件订阅、第三方组件实例化适合放在 effect/root 中。

### createComputed

`createComputed(fn, options?)` 是 `createEffect` 的别名。用于表达“派生副作用”，语义上可读性更强。

```js
createComputed(() => {
  console.log(store.total);
});
```

### createMemo

```js
const memo = createMemo(fn, initial?, options?)
```

用于缓存派生值。只有依赖变化且计算结果变化时，才通知下游。

```js
const [price, setPrice] = createSignal(100);
const [count, setCount] = createSignal(2);

const total = createMemo(() => price() * count());

console.log(total()); // 200
```

自定义相等判断：

```js
const userName = createMemo(() => user().name.trim(), '', {
  equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
});
```

释放 memo：

```js
total.dispose();
```

适用场景：

- 总库存、筛选结果、总金额、格式化后的 UI 文案。
- 任何可由已有状态推导出的值。

### createWatch

```js
createWatch(source, callback, options?)
```

监听一个或多个 source 的变化，适合执行“变化后动作”。

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

监听多个 source：

```js
createWatch(
  [page, pageSize],
  ([nextPage, nextSize], previous) => {
    loadList(nextPage, nextSize);
  },
  { defer: true }
);
```

注意：

- `defer: true` 表示首次不调用 callback，只在后续变化时调用。
- callback 内部默认使用 `untrack` 执行，不会额外订阅 callback 里读取的 signal。

### createSelector

```js
const isSelected = createSelector(selectedId);
```

用于列表选中态判断：

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

如果 `value` 是函数，则调用它；否则返回原值。常用于接受“普通值或 accessor”的 API。

```js
function toText(value) {
  return String(access(value) ?? '');
}
```

## 调度 API

### batch

```js
batch(() => {
  state.a = 1;
  state.b = 2;
  setCount(3);
});
```

批量更新依赖，避免每次写入都触发 effect。

适用场景：

- 表单批量重置。
- 批量修改 SKU 价格或库存。
- 多个 signal/store 字段必须作为一次事务更新。

### untrack

```js
createEffect(() => {
  const id = selectedId();
  const cache = untrack(() => cacheMap());
});
```

读取值但不建立依赖。

适用场景：

- effect 中读取辅助状态，但不希望它触发 effect 重跑。
- 写日志、读取缓存、读取上一次快照。

### flushSync

```js
flushSync(() => {
  setOpen(true);
});
```

同步刷新已调度 effect。适合需要立即读取 DOM 结果的少数场景。

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

将更新放入低优先级队列。适合搜索、筛选、大列表刷新等不需要立即阻塞当前交互的任务。

## 生命周期

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

`createRoot` 创建一个响应式根。返回值由 callback 决定；如果 callback 没有返回值，则返回 `{ dispose, run }`。

推荐在一个页面区域、弹窗内容、组件实例的入口处创建 root。

### createScope

```js
const scope = createScope(() => {
  createEffect(() => {});
});

scope.dispose();
scope.run(() => {});
```

`createScope` 和 `createRoot` 类似，但固定返回 scope 对象，适合工具层内部管理。

### onCleanup / onDispose

```js
createEffect(() => {
  const handler = () => {};
  window.addEventListener('resize', handler);
  onCleanup(() => window.removeEventListener('resize', handler));
});
```

`onDispose` 是 `onCleanup` 的别名。

### onMount

```js
createRoot(() => {
  onMount(() => {
    console.log('mounted in microtask');
  });
});
```

在当前 owner 创建后的微任务中运行。适合初始化依赖 DOM 已插入后的逻辑。

### getOwner

```js
const owner = getOwner();
```

返回当前 owner。主要用于底层工具和调试，业务代码一般不需要直接使用。

## 错误处理

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

返回：

```js
{
  error,      // signal accessor
  fallback,   // 传入的 fallback
  hasError,   // () => boolean
  reset,      // 重建 boundary
  dispose,    // 销毁 boundary
}
```

### catchError

```js
const result = catchError(
  () => JSON.parse(text),
  (error) => ({ error: error.message })
);
```

用于同步函数的安全执行。

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

`createStore` 是浅层响应式：

- `user.name` 变化会触发。
- `user.profile.city = 'Shanghai'` 不会触发读取 `user.profile.city` 的 effect，因为 `profile` 没有深层代理。

适用场景：

- 扁平对象。
- 只需要跟踪一级字段的配置、表单状态。

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

`createDeepStore` 会递归代理普通对象和数组，适合复杂 UI 状态。

#### SKU 库存表示例

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

数组支持：

- 索引读取：`rows[0]`
- 长度读取：`rows.length`
- 迭代读取：`map`, `filter`, `reduce`, `for...of`
- 变异方法：`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`

注意：

- 深层代理主要支持普通对象和数组。
- `Date`, `Map`, `Set`, class 实例不会被深层代理；建议将它们作为普通值使用，或转换为 plain object/array。

### createReadonly

```js
const readonlyState = createReadonly(state);
```

创建只读 deep store。写入会被忽略并输出警告。

适用场景：

- 暴露公共状态给外部模块，但不允许外部修改。
- 组件 props 只读化。

### produce

```js
produce(state, (draft) => {
  draft.user.name = 'Bob';
  draft.rows.push({ id: 'new', stock: 1 });
});
```

在一次 `batch` 中执行多次修改。这里不是 Immer，不会生成不可变副本，而是直接修改传入 store。

### unwrap / snapshot

```js
const raw = unwrap(state);
const copy = snapshot(state);
```

将 store/proxy 转为普通对象。`snapshot` 当前等同于 `unwrap`。

适用场景：

- 提交接口前序列化。
- 调试输出。
- 保存当前状态。

## 异步数据

### createResource

```js
const [data, controls] = createResource(fetcher, options?)
```

或：

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

`state` 字段：

```js
state.data;
state.latest;
state.loading;
state.error;
state.isStale;
```

控制方法：

- `reload(value?)`：手动重新加载，会进入 loading。
- `refetch(value?)`：重新请求，已有数据时保留 stale 状态。
- `mutate(value | updater)`：本地修改 data。

选项：

```js
createResource(fetcher, {
  source, // accessor，变化后自动请求
  initialValue, // 初始数据
  loadingDelay, // 延迟显示 loading，减少闪烁
  suspense, // loading 且无 data 时 read() 抛 promise
  throwErrors, // read() 时抛出 error
});
```

示例：带 loading UI

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

`createQuery` 是更偏业务 UI 的请求 API，内置 status、loading、error、retry/refetch 状态，适合列表、详情、仪表盘卡片等异步区域。

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

读取数据：

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

控制方法：

```js
query.refetch();
query.retry();
query.promise();
```

#### Loading / 骨架屏 / 重试示例

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
            ${() => products.state.error?.message || '请求失败'}
            <button onClick=${() => products.retry()}>重试</button>
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

选项：

```js
createQuery({
  queryKey, // 普通值或 accessor；变化会重新请求
  queryFn, // ({ queryKey, signal, attempt }) => Promise<data>
  enabled: true, // 普通值或 accessor；false 时不自动请求
  initialData, // 初始数据
  keepPreviousData: true,
  retry: 0, // 数字或 (attempt, error) => boolean
  retryDelay: (attempt) => Math.min(1000 * attempt, 3000),
});
```

### createSuspense

```js
const content = createSuspense(() => resource(), jsx`<div>Loading...</div>`);
```

捕获函数中抛出的 Promise，返回 fallback，并在 Promise 完成后触发重新计算。适合配合 `createResource({ suspense: true })` 的高级场景。

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

清空 container，并把 value 插入其中。返回 root dispose。

### insert

```js
const cleanup = insert(parent, () => count());
cleanup();
```

将普通值、DOM Node、数组、accessor 插入 parent。accessor 更新时自动替换内容。

### bindText

```js
bindText(el, () => `Hello ${name()}`);
```

绑定 `textContent`。

### bindAttr

```js
bindAttr(input, 'disabled', () => loading());
bindAttr(link, 'href', () => state.url);
```

`null`, `undefined`, `false` 会移除属性；`true` 会设置空属性。

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

通过 `display: none` 控制显示隐藏。

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

条件为 true 时插入 factory 返回的节点；false 时移除。

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
    fallback: jsx`<tr><td>暂无数据</td></tr>`,
  }
);
```

参数：

- `anchor`：列表插入位置，必须已经在 DOM 中。
- `listSignal`：数组或返回数组的 accessor。
- `renderItem(item, indexAccessor, itemAccessor)`：创建列表项节点。
- `options.key`：生成稳定 key。对象列表强烈建议提供。
- `options.fallback`：空列表时显示内容。

注意：

- 有稳定 id 的列表必须使用 `key`。
- 如果默认按 index 复用节点，列表项内容需要通过 `itemAccessor()` 读取才能随同位置数据更新。
- `bindList` 会复用旧节点并移动 DOM，适合排序、插入、删除。

辅助 key：

```js
bindList(anchor, rows, render, {
  key: createListKey('id'),
});

bindList(anchor, rows, render, {
  key: createCompositeKey('color', 'size'),
});
```

## JSX Runtime

### 无构建：jsx tagged template

浏览器不能直接解析 `<div />` 这种 JSX 语法。无构建场景应使用 `jsx\`...\``：

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

动态规则：

- 子节点插值可以是字符串、数字、DOM Node、数组、accessor。
- 属性插值可以是普通值或 accessor。
- 事件使用 `onClick`, `onInput` 等属性。
- `class` 和 `className` 都可用。
- `style` 可传字符串或对象。

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

### 有构建：JSX runtime

如果项目接入 Babel/Vite JSX 转换，可配置使用本 runtime：

```js
// automatic runtime 需要构建器把 JSX 转成 jsx/jsxs 调用
// importSource 指向 signal.js 的导出位置，按项目实际路径配置
```

编译后等价于：

```js
jsx('div', { children: 'test' });
```

注意：

- `jsx(<div>test</div>)` 不是合法浏览器 JavaScript，必须经过 JSX 编译器转换后才可运行。
- JUI 的无构建写法是 `jsx\`<div>test</div>\``。

### h / createElement

`h` 是手写或 JSX 编译后的工厂函数：

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

`createElement` 是 `h` 的别名。

### Fragment

```js
Fragment({
  children: [jsx`<span>A</span>`, jsx`<span>B</span>`],
});
```

通常由 JSX 编译器使用。

### Show

```js
insert(
  container,
  Show({
    when: () => state.visible,
    fallback: jsx`<span>隐藏</span>`,
    children: jsx`<strong>显示</strong>`,
  })
);
```

也可传函数 children：

```js
Show({
  when: user,
  fallback: jsx`<span>未登录</span>`,
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

`For` 的 `children` 接收：

- `item`：当前项 accessor，需要用 `item()` 读取。
- `index`：当前索引 accessor，需要用 `index()` 读取。

为什么 item 是 accessor：

- 默认按 index 复用节点时，同一个 DOM 节点对应的 item 可能变化。
- 通过 `item()` 读取，节点内容才能随列表更新。

简单字符串数组：

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

上例中 `${item}` 会被 `jsx` 当 accessor 处理。

对象数组建议提供 key：

```js
For({
  each: () => state.rows,
  key: (row) => row.id,
  children: (row) => jsx`
    <div>${() => row().name}</div>
  `,
});
```

## 常见业务场景

### 1. Modal 内部响应式表单

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
        <button disabled=${() => !canSubmit()}>提交</button>
      </form>
    `;
  }, container);
}
```

### 2. Toast 队列

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

### 3. SKU 库存表

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
    <strong>${() => `总库存：${totalStock()}`}</strong>
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
              <td>${() => (row().stock < 5 ? '低库存' : '正常')}</td>
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

### 4. 搜索列表

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
        ? jsx`<div>搜索中...</div>`
        : result.state.isError
          ? jsx`<button onClick=${() => result.retry()}>重试</button>`
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

## 性能建议

- 优先用 `createMemo` 表达派生值，不要把可推导状态重复存到多个 signal。
- 批量修改 store 时使用 `batch` 或 `produce`。
- 大列表必须提供稳定 `key`，避免按 index 复用带来的内容错位。
- 列表项内部读取 `item()` 和 `index()`，不要把创建时的 item 当成永远不变的值。
- effect 中只读取真正需要触发重跑的依赖；其他读取用 `untrack`。
- `createDeepStore` 适合 UI 状态；大型静态数据可保持普通对象，只把筛选条件、选中项、可编辑字段响应式化。

## 调试建议

- signal accessor 有 `peek()`，可不追踪读取当前值。
- store 可用 `snapshot(store)` 输出普通对象。
- 可以在浏览器设置 `window.__SIGNAL_DEVTOOLS__ = { emit(type, payload) {} }` 接收运行时事件。
- 遇到 effect 循环，检查 effect 内是否写入了自己读取的 signal/store。

## 限制与约定

- 无构建场景不支持浏览器直接解析 `<div />` JSX 语法，请使用 `` jsx `...` ``。
- `jsx(<div />)` 必须依赖构建器把 JSX 转换成函数调用；原生浏览器无法执行。
- deep store 只递归普通对象和数组；`Map`, `Set`, `Date`, class 实例按普通值处理。
- `bindList` 的 anchor 必须已在 DOM 中。
- 异步请求 API 会处理“最新请求优先”，过期请求不会覆盖新数据。
- `createQuery` 初始自动请求失败会吞掉未处理 Promise rejection，但错误会保存在 `query.state.error` 中；手动 `retry/refetch` 返回的 Promise 仍可由调用方 `await/catch`。

## API 速查

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
