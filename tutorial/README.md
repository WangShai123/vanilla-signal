# vanilla-signal UI 教程视频脚本

这套脚本面向初级前端程序员，目标不是把 API 背一遍，而是让观众理解：为什么原生 DOM 写复杂交互会累，`vanilla-signal` 如何用 signal、effect、memo、store、JSX 模板把 UI 状态变得更直观。

## 推荐视频结构

| 集数 | 文件                             | 主题                                                                                         | 建议时长   |
| ---- | -------------------------------- | -------------------------------------------------------------------------------------------- | ---------- |
| 1    | `01-认识-vanilla-signal.md`      | 从原生 DOM 痛点引出细粒度响应式                                                              | 8-12 分钟  |
| 2    | `02-signal-effect-memo.md`       | 掌握 `createSignal`、`createEffect`、`createMemo`                                            | 12-16 分钟 |
| 3    | `03-render-jsx-dom.md`           | 用 `render`、`jsx``、事件和动态属性构建 UI                                                   | 12-16 分钟 |
| 4    | `04-store-form-list.md`          | 用 `createDeepStore` 写表单、列表、派生统计                                                  | 15-20 分钟 |
| 5    | `05-show-for-async.md`           | 条件渲染、列表渲染、异步请求状态                                                             | 15-20 分钟 |
| 6    | `06-mini-project.md`             | 完整小项目：任务面板                                                                         | 20-30 分钟 |
| 7    | `07-调度-监听-选择器.md`         | `createWatch`、`createSelector`、`batch`、`untrack`、`flushSync`、`startTransition`          | 15-20 分钟 |
| 8    | `08-生命周期-作用域-错误处理.md` | `createRoot`、`createScope`、`onCleanup`、`onMount`、`createErrorBoundary`、`catchError`     | 15-20 分钟 |
| 9    | `09-dom底层api与老项目增强.md`   | `insert`、`bindText`、`bindAttr`、`bindStyle`、`bindClass`、`bindShow`、`bindIf`、`bindList` | 15-20 分钟 |
| 10   | `10-高级异步-createSuspense.md`  | `createResource` 高级选项、`createQuery` 重试与竞态、`createSuspense`                        | 18-25 分钟 |
| 附录 | `api-场景速查.md`                | API 用法和适用场景速查                                                                       | 随课件使用 |

## 录制建议

1. 每集先用一句业务问题开头，例如“点击按钮后，页面上 3 个地方都要更新，该怎么写？”
2. 初学者更容易接受“状态变化，页面自动跟着变”，不要一开始讲调度、owner、依赖图。
3. API 讲解顺序建议固定为：解决什么问题、最小代码、常见场景、容易踩坑。
4. 代码演示优先使用 UMD 版本，避免初学者被构建工具打断：

```html
<script src="./dist/index.umd.js"></script>
<script>
  const { createSignal, createMemo, createDeepStore, render, jsx, For, Show } =
    signal;
</script>
```

5. 如果视频面向已经会 Vite 的观众，再补充 ESM 用法：

```js
import {
  createSignal,
  createMemo,
  createDeepStore,
  render,
  jsx,
  For,
  Show,
} from './dist/index.js';
```

## 课程主线

可以把整套教程讲成一句话：

> `vanilla-signal` 让我们在不引入大框架的情况下，用“状态驱动 UI”的方式写原生页面。

观众应该带走的核心心智模型：

- `createSignal`：保存一个会通知别人的值。
- `createEffect`：当读过的值变化时，自动重新执行一段副作用。
- `createMemo`：像 Excel 公式一样，根据其他状态算出新值。
- `createDeepStore`：把对象和数组变成响应式状态，适合表单、列表、业务页面。
- `jsx`...`：无构建环境下，用接近 HTML 的方式创建 DOM。
- `render`：把响应式 UI 挂到页面上，并负责清理。
- `Show` / `For`：用组件化写法处理条件和列表。
- `createResource` / `createQuery`：把请求的 loading、error、data 管起来。
- `createSuspense`：让会抛 Promise 的异步读取先显示 fallback，完成后自动恢复内容。
- `createRoot` / `createScope`：管理一组响应式逻辑的创建和销毁。
- `bindText` / `bindList` 等底层 API：给已有 DOM 或老项目做局部响应式增强。
