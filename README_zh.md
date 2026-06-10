# Signal

`Signal` 是细粒度响应式运行时，设计目标是接近 SolidJS 的心智模型，同时保持“无依赖、无构建也能直接在浏览器中使用”。它适合用原生 JS 编写中小型 UI、表单、列表、库存表、弹窗内容、异步数据区块等交互。

## 设计目标

- 细粒度更新：读了哪个 signal/store 字段，就只在该字段变化时更新对应 effect 或 DOM。
- 无框架依赖：不依赖 React/Vue/Solid，也不要求构建工具。
- 支持复杂 UI 状态：支持深层对象、数组、排序、插入、删除、派生状态和异步请求。
- 支持 JSX 使用体验：无构建环境使用 `` jsx `...` `` 模板；有构建环境可接入 JSX runtime。
- 可维护：业务代码以 state、memo、effect、DOM binding 分层组织。

## 安装

npm:

```bash
npm install vanilla-signal
```

script:

```html
<!-- umd 全局变量 signal -->
<script src="https://unpkg.com/vanilla-signal/dist/index.umd.js"></script>
<script>
  const { createSignal } = signal;
</script>

<!-- esm 模块导入 -->
<script type="module">
  import { createSignal } from 'https://unpkg.com/vanilla-signal/dist/index.js';
</script>
```

## 使用文档

- [文档](./docs/signal_zh.md)

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

## 翻译

- [English](./README.md)
