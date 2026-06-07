# vanilla-signal API 场景速查

这份内容适合放在教程最后，也适合做成课件截图。每个 API 都按“它解决什么问题、怎么用、适合什么场景”来讲。

## 核心响应式

### createSignal

一句话：保存一个会通知页面更新的基础值。

```js
const [count, setCount] = createSignal(0);

count();
setCount(1);
setCount((value) => value + 1);
```

适合：

- 计数器。
- 开关状态。
- 当前 tab。
- 当前选中 id。
- 输入框关键词。

初学提示：读取时要写 `count()`，不是 `count`。

### createEffect

一句话：当里面读过的状态变化时，自动执行一段代码。

```js
createEffect(() => {
  document.title = `count: ${count()}`;
});
```

适合：

- 同步 `document.title`。
- 写日志。
- 操作第三方库。
- 绑定事件后用 `onCleanup` 清理。
- 同步状态到 `localStorage`。

不要做：

- 不要在 effect 里无条件修改自己读取的状态。

### createComputed

一句话：`createEffect` 的语义别名，用来表达“派生副作用”。

```js
createComputed(() => {
  console.log(store.total);
});
```

适合：

- 你想强调这段逻辑是由响应式状态推导触发的副作用。
- 代码组织上希望和普通 effect 区分语义。

提示：行为上可以按 `createEffect` 理解。

### createMemo

一句话：根据其他状态算出一个新值。

```js
const total = createMemo(() => price() * count());
```

适合：

- 总价。
- 总库存。
- 筛选后的列表。
- 表单是否可提交。
- 根据状态生成 UI 文案。

记法：`memo` 是为了算值，`effect` 是为了做事。

### createWatch

一句话：监听一个或多个值的变化，并拿到新值和旧值。

```js
createWatch(
  keyword,
  (next, prev) => {
    console.log(prev, next);
  },
  { defer: true }
);
```

适合：

- 关键词变化后触发搜索。
- 分页参数变化后加载列表。
- 记录某个字段变化日志。

### createSelector

一句话：根据当前选中值，快速判断某个 key 是否选中。

```js
const [selectedId, setSelectedId] = createSignal('a');
const isSelected = createSelector(selectedId);

isSelected('a'); // true
```

适合：

- 列表选中态。
- tab 激活态。
- 单选项高亮。

### access

一句话：如果传进来的是函数就调用，否则直接返回。

```js
function toText(value) {
  return String(access(value) ?? '');
}
```

适合：

- 封装工具函数时，允许参数既可以是普通值，也可以是 accessor。

## 调度和读取控制

### batch

一句话：把多次状态修改合并成一次通知。

```js
batch(() => {
  setA(1);
  setB(2);
});
```

适合：

- 批量重置表单。
- 一次修改多个 store 字段。
- 批量更新列表。

### produce

一句话：在一次批处理中修改 store。

```js
produce(state, (draft) => {
  draft.name = '新名称';
  draft.rows.push({ id: 'new' });
});
```

适合：

- 对 store 连续做多次修改。
- 批量清空、批量勾选、批量调价。

提示：这里不是 Immer，不会生成不可变副本。

### untrack

一句话：读取状态，但不让当前 effect 依赖它。

```js
createEffect(() => {
  const id = selectedId();
  const cache = untrack(() => cacheMap());
});
```

适合：

- effect 中读取辅助值，但不希望辅助值触发重跑。
- 写日志时读取当前快照。

### flushSync

一句话：立即刷新已经排队的更新。

```js
flushSync(() => {
  setOpen(true);
});

panel.getBoundingClientRect();
```

适合：

- 打开弹窗后立刻测量 DOM。
- 少数需要同步读取布局的场景。

### startTransition

一句话：把一批更新放到较低优先级。

```js
startTransition(() => {
  state.keyword = value;
});
```

适合：

- 大列表筛选。
- 搜索结果刷新。
- 不应该阻塞当前输入体验的更新。

## 生命周期

### createRoot

一句话：创建一块可销毁的响应式区域。

```js
const dispose = createRoot((dispose) => {
  createEffect(() => {
    console.log(count());
  });

  return dispose;
});

dispose();
```

适合：

- 页面局部挂载。
- 弹窗内容。
- 手动创建和销毁一组响应式逻辑。

### createScope

一句话：创建一个固定返回 `{ dispose, run }` 的响应式作用域。

```js
const scope = createScope(() => {
  createEffect(() => {});
});

scope.dispose();
```

适合：

- 工具函数内部管理生命周期。
- 第三方插件封装。

### onCleanup / onDispose

一句话：在 effect 重跑前或 owner 销毁时清理资源。

```js
createEffect(() => {
  const timer = setInterval(() => {}, 1000);

  onCleanup(() => clearInterval(timer));
});
```

适合：

- 清理定时器。
- 移除事件监听。
- 销毁第三方组件实例。

### onMount

一句话：当前响应式区域创建后，在微任务中执行。

```js
onMount(() => {
  input.focus();
});
```

适合：

- DOM 插入后的初始化。
- 自动聚焦。

### getOwner

一句话：获取当前响应式 owner。

```js
createRoot(() => {
  console.log(getOwner());
});
```

适合：

- 底层工具封装。
- 调试响应式作用域。
- 框架或插件集成。

提示：普通业务代码一般不需要直接使用。

## Store

### createStore

一句话：创建浅层响应式对象。

```js
const user = createStore({
  name: 'Alice',
});

user.name = 'Bob';
```

适合：

- 扁平配置。
- 一级字段表单。

### createDeepStore

一句话：创建深层响应式对象和数组。

```js
const state = createDeepStore({
  form: {
    name: '',
    address: {
      city: '',
    },
  },
  rows: [],
});
```

适合：

- 表单。
- 商品列表。
- 购物车。
- SKU 表。
- 嵌套业务状态。

### createReadonly

一句话：创建只读 store。

```js
const readonlyState = createReadonly(state);
```

适合：

- 对外暴露状态，但不允许外部修改。
- 只读 props。

### unwrap / snapshot

一句话：把 store 转成普通对象。

```js
const payload = snapshot(state);
```

适合：

- 提交接口。
- 保存到本地。
- 控制台调试。

## DOM 和 JSX

### render

一句话：把 UI 渲染到页面容器中。

```js
const dispose = render(() => jsx`<div>Hello</div>`, app);

dispose();
```

适合：

- 页面入口。
- 挂载弹窗。
- 局部增强老项目 DOM。

### jsx`` tagged template

一句话：无构建环境下，用接近 HTML 的方式写 DOM。

```js
jsx`
  <button onClick=${handleClick}>
    ${() => count()}
  </button>
`;
```

适合：

- 浏览器 `<script>` 直接使用。
- 教学和小项目。
- 不想配置 JSX 编译的页面。

### jsx() / h()

一句话：用函数调用创建 DOM。

```js
jsx('button', {
  onClick: handleClick,
  children: () => count(),
});
```

适合：

- 工具函数封装。
- JSX 编译产物。
- 动态决定标签名。

### createElement / jsxs / jsxDEV

一句话：给 JSX 编译器使用的运行时别名。

```js
const node = createElement('button', {
  children: '保存',
});
```

适合：

- 构建工具把 JSX 编译为函数调用。
- 兼容 automatic runtime 或开发环境 JSX 转换。

提示：手写教程和无构建场景优先使用 `jsx``...```。

### insert

一句话：把普通值、DOM、数组、accessor 插入父节点。

```js
insert(parent, () => count());
```

适合：

- 底层封装。
- 手动控制插入位置。

### bindText / bindAttr / bindStyle / bindClass / bindShow

一句话：把已有 DOM 的文本、属性、样式、class、显示隐藏绑定到状态。

```js
bindText(title, () => state.title);
bindAttr(button, 'disabled', () => state.loading);
bindStyle(bar, 'width', () => `${state.progress}%`);
bindStyle(card, {
  borderColor: () => (state.danger ? '#dc2626' : '#d0d5dd'),
});
bindClass(row, 'active', () => state.selected);
bindShow(panel, () => state.open);
```

适合：

- 老页面局部增强。
- 已经有 DOM，不想用模板重写。
- 封装底层 UI 工具。

### bindIf

一句话：在注释锚点位置做条件插入和移除。

```js
bindIf(anchor, () => state.open, () => jsx`<div>内容</div>`);
```

适合：

- 底层条件渲染封装。
- 手动 DOM 场景。

### bindList

一句话：在注释锚点位置渲染列表，并复用和移动 DOM。

```js
bindList(anchor, () => state.rows, renderItem, {
  key: (row) => row.id,
});
```

适合：

- 底层列表封装。
- 对 DOM 插入位置要求很明确的场景。

### createListKey / createCompositeKey

一句话：生成 `bindList` 或 `For` 可用的 key 函数。

```js
createListKey('id');
createCompositeKey('color', 'size');
```

适合：

- 单字段 id：`createListKey('id')`。
- 复合业务主键：`createCompositeKey('color', 'size')`。
- SKU、规格、库存表这类没有单独 id 的列表。

### html

一句话：把 HTML 字符串解析成 DOM 节点。

```js
const node = html('<strong>提示</strong>');
```

适合：

- 受控模板片段。
- 工具层把静态 HTML 转为节点。

注意：不要直接解析用户输入，避免 XSS。

### Fragment

一句话：返回多个同级子节点，不额外包一层元素。

```js
Fragment({
  children: [jsx`<span>A</span>`, jsx`<span>B</span>`],
});
```

适合：

- JSX 编译器输出。
- 手写代码中需要返回多个同级节点。

### Show

一句话：组件化条件渲染。

```js
Show({
  when: () => state.open,
  fallback: jsx`<span>关闭</span>`,
  children: jsx`<span>打开</span>`,
});
```

适合：

- 登录/未登录。
- loading/内容。
- 展开/收起。
- 空状态提示。

### For

一句话：组件化列表渲染。

```js
For({
  each: () => state.rows,
  key: (row) => row.id,
  fallback: jsx`<div>暂无数据</div>`,
  children: (row, index) => jsx`
    <div>${() => index() + 1}. ${() => row().name}</div>
  `,
});
```

适合：

- 商品列表。
- 表格。
- 任务列表。
- 搜索结果。

## 异步请求

### createResource

一句话：把一个异步值和它的 loading/error 状态管理起来。

```js
const [user, { state, reload }] = createResource(async () => {
  const response = await fetch('/api/user');
  return response.json();
});
```

适合：

- 用户信息。
- 详情数据。
- 简单异步块。

常用控制：

```js
const [data, { state, reload, refetch, mutate }] = createResource(fetcher, {
  initialValue: [],
  loadingDelay: 200,
});
```

- `state.loading`：当前是否加载。
- `state.error`：请求错误。
- `state.isStale`：已有旧数据，同时正在刷新。
- `reload()`：明确重新加载。
- `refetch()`：刷新数据。
- `mutate(value | updater)`：本地修改当前数据。

高级选项：

```js
createResource(fetcher, {
  suspense: true,
  throwErrors: true,
});
```

- `suspense: true`：首次 loading 且无数据时，读取会抛出 Promise。
- `throwErrors: true`：存在错误时，读取会抛出 error。

### createQuery

一句话：更适合业务页面的请求工具，带状态、重试、保留旧数据。

```js
const list = createQuery({
  queryKey: () => state.keyword,
  enabled: () => state.keyword.length > 0,
  queryFn: async ({ queryKey, signal }) => {
    const response = await fetch(`/api/search?q=${queryKey}`, { signal });
    return response.json();
  },
});
```

适合：

- 搜索列表。
- 分页列表。
- 详情卡片。
- 仪表盘数据。

常用状态：

```js
list.state.status;
list.state.isLoading;
list.state.isFetching;
list.state.isError;
list.state.isSuccess;
list.state.error;
list.state.failureCount;
list.state.updatedAt;
```

常用控制：

```js
list.refetch();
list.retry();
list.promise();
```

关键选项：

```js
createQuery({
  queryKey: () => state.keyword,
  enabled: () => state.keyword.trim().length > 0,
  keepPreviousData: true,
  retry: 2,
  retryDelay: (attempt) => attempt * 500,
  queryFn: async ({ queryKey, signal, attempt }) => {
    return fetchData(queryKey, signal, attempt);
  },
});
```

### createSuspense

一句话：捕获 Promise，先返回 fallback，Promise 完成后重新计算。

```js
const [user] = createResource(fetchUser, {
  suspense: true,
});

const content = createSuspense(
  () => {
    const currentUser = user();
    return jsx`<div>${currentUser.name}</div>`;
  },
  jsx`<div>Loading...</div>`
);

render(() => content(), app);
```

适合：

- 更高级的异步 UI 封装。
- 和 `createResource({ suspense: true })` 配合。
- 把 loading fallback 从业务内容里抽到外层统一处理。

提示：要在 `createSuspense` 的第一个函数里直接读取可能抛 Promise 的资源。普通业务页面直接判断 `state.loading` / `state.error` 往往更直观。

## 错误处理

### catchError

一句话：安全执行同步函数。

```js
const result = catchError(
  () => JSON.parse(text),
  (error) => ({ message: error.message })
);
```

适合：

- JSON 解析。
- 用户输入格式化。
- 同步计算兜底。

### createErrorBoundary

一句话：创建一个能捕获响应式错误的边界。

```js
const boundary = createErrorBoundary(() => {
  createEffect(() => {
    if (count() > 5) throw new Error('too large');
  });
});
```

适合：

- 高级组件封装。
- 防止局部响应式逻辑出错影响整块 UI。

## 初学者推荐学习顺序

1. `createSignal`
2. `createEffect`
3. `createMemo`
4. `render`
5. `jsx``...```
6. `createDeepStore`
7. `Show`
8. `For`
9. `createResource`
10. `createQuery`

其他 API 等遇到场景再学。

## 进阶学习顺序

1. `createWatch`
2. `createSelector`
3. `batch`
4. `untrack`
5. `flushSync`
6. `startTransition`
7. `createRoot`
8. `createScope`
9. `onCleanup`
10. `onMount`
11. `bindText` / `bindAttr` / `bindList`
12. `createSuspense`
13. `createErrorBoundary`
