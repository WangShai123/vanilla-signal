# 第 6 集：完整小项目 - 任务面板

## 本集目标

通过一个任务面板，把前几集学到的 API 串起来：

- `createDeepStore` 管理页面状态。
- `createMemo` 计算统计信息。
- `jsx`...` 编写 UI。
- `For` 渲染列表。
- `Show` 渲染空状态和筛选提示。
- `produce` 批量修改。
- `snapshot` 导出普通对象。

## 项目效果

我们要做一个简单的任务面板，支持：

- 新增任务。
- 勾选完成。
- 删除任务。
- 按全部、未完成、已完成筛选。
- 显示总数、已完成数、未完成数。
- 一键清空已完成。
- 导出当前数据。

## 开场口播

前面几集我们已经分别学了 signal、memo、store、模板、列表和条件渲染。

这一集不再单独讲 API，而是用一个小项目把它们连起来。

项目虽然简单，但结构和真实业务页面是一样的：状态在上面，派生数据在中间，事件函数负责修改状态，最后用模板描述 UI。

## 1. 基础页面

### 代码

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>vanilla-signal task board</title>
    <script src="../dist/index.umd.js"></script>
    <style>
      body {
        margin: 0;
        font-family:
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif;
        background: #f4f6f8;
        color: #1f2937;
      }

      button,
      input {
        font: inherit;
      }

      .page {
        width: min(820px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0;
      }

      .toolbar,
      .stats,
      .filters {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 12px;
      }
      .filters {
        justify-content: space-between;
      }

      input[type='text'] {
        flex: 1;
        min-width: 220px;
        height: 36px;
        border: 1px solid #d0d5dd;
        border-radius: 6px;
        padding: 0 10px;
      }

      button {
        height: 36px;
        border: 1px solid #2563eb;
        border-radius: 6px;
        background: #2563eb;
        color: #fff;
        padding: 0 12px;
        cursor: pointer;
      }

      button.secondary {
        background: #fff;
        color: #2563eb;
      }

      button.active {
        background: #1e40af;
        border-color: #1e40af;
      }

      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .stat {
        border: 1px solid #d0d5dd;
        border-radius: 6px;
        background: #fff;
        padding: 8px 10px;
      }

      .list {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .item {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: center;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        background: #fff;
        padding: 10px;
      }

      .item.done .title {
        color: #667085;
        text-decoration: line-through;
      }

      .empty {
        border: 1px dashed #d0d5dd;
        border-radius: 8px;
        background: #fff;
        color: #667085;
        padding: 24px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const {
        createDeepStore,
        createMemo,
        produce,
        snapshot,
        render,
        jsx,
        For,
        Show,
      } = signal;
    </script>
  </body>
</html>
```

## 2. 定义状态

### 代码

```js
const state = createDeepStore({
  draft: '',
  filter: 'all',
  todos: [
    { id: 't1', title: '学习 createSignal', done: true },
    { id: 't2', title: '写一个响应式列表', done: false },
  ],
});
```

### 讲解

页面状态放在一个 `state` 里：

`draft` 是输入框内容。

`filter` 是当前筛选条件。

`todos` 是任务数组。

这样后面维护起来会很清楚。

## 3. 派生数据

### 代码

```js
const totalCount = createMemo(() => state.todos.length);

const doneCount = createMemo(() => {
  return state.todos.filter((todo) => todo.done).length;
});

const activeCount = createMemo(() => totalCount() - doneCount());

const visibleTodos = createMemo(() => {
  if (state.filter === 'active') {
    return state.todos.filter((todo) => !todo.done);
  }

  if (state.filter === 'done') {
    return state.todos.filter((todo) => todo.done);
  }

  return state.todos;
});

const canAdd = createMemo(() => state.draft.trim().length > 0);
```

### 讲解

这里所有统计信息都用 `createMemo`。

它们不是独立状态，而是由 `todos` 和 `filter` 算出来的。

这样做的好处是：只要任务变化，统计和列表都会自动更新。

## 4. 事件函数

### 代码

```js
function addTodo() {
  const title = state.draft.trim();

  if (!title) return;

  state.todos.unshift({
    id: crypto.randomUUID(),
    title,
    done: false,
  });

  state.draft = '';
}

function removeTodo(id) {
  const index = state.todos.findIndex((todo) => todo.id === id);

  if (index >= 0) {
    state.todos.splice(index, 1);
  }
}

function clearDone() {
  produce(state, (draft) => {
    for (let index = draft.todos.length - 1; index >= 0; index -= 1) {
      if (draft.todos[index].done) {
        draft.todos.splice(index, 1);
      }
    }
  });
}

function exportData() {
  console.log(snapshot(state.todos));
}
```

### 讲解

事件函数只负责修改状态。

比如新增任务，就是往 `state.todos` 里插入一项，然后清空输入框。

删除任务，就是找到索引后 `splice`。

清空已完成会连续修改数组，所以这里用 `produce` 包起来。

## 5. 渲染 UI

### 代码

```js
render(
  () => jsx`
    <main class="page">
      <h1>任务面板</h1>

      <div class="toolbar">
        <input
          type="text"
          placeholder="输入任务后按 Enter"
          value=${() => state.draft}
          onInput=${(event) => {
            state.draft = event.currentTarget.value;
          }}
          onKeyDown=${(event) => {
            if (event.key === 'Enter') addTodo();
          }}
        >
        <button disabled=${() => !canAdd()} onClick=${addTodo}>新增</button>
      </div>

      <div class="stats">
        <span class="stat">${() => `全部：${totalCount()}`}</span>
        <span class="stat">${() => `未完成：${activeCount()}`}</span>
        <span class="stat">${() => `已完成：${doneCount()}`}</span>
      </div>

      <div class="filters">
        <button
          class=${() => (state.filter === 'all' ? 'active' : 'secondary')}
          onClick=${() => {
            state.filter = 'all';
          }}
        >
          全部
        </button>
        <button
          class=${() => (state.filter === 'active' ? 'active' : 'secondary')}
          onClick=${() => {
            state.filter = 'active';
          }}
        >
          未完成
        </button>
        <button
          class=${() => (state.filter === 'done' ? 'active' : 'secondary')}
          onClick=${() => {
            state.filter = 'done';
          }}
        >
          已完成
        </button>
        <button
          class="secondary"
          disabled=${() => doneCount() === 0}
          onClick=${clearDone}
        >
          清空已完成
        </button>
        <button class="secondary" onClick=${exportData}>导出</button>
      </div>

      ${Show({
        when: () => state.filter !== 'all',
        children: jsx`
          <p>
            ${() =>
              state.filter === 'active'
                ? `当前只显示未完成任务，共 ${visibleTodos().length} 条`
                : `当前只显示已完成任务，共 ${visibleTodos().length} 条`}
          </p>
        `,
      })}

      <div class="list">
        ${For({
          each: visibleTodos,
          key: (todo) => todo.id,
          fallback: jsx`<div class="empty">暂无任务</div>`,
          children: (todo) => jsx`
            <label class=${() => (todo().done ? 'item done' : 'item')} for=${() => todo().id}>
              <input
                id=${() => todo().id}
                type="checkbox"
                checked=${() => todo().done}
                onChange=${(event) => {
                  todo().done = event.currentTarget.checked;
                }}
              >
              <span class="title">${() => todo().title}</span>
              <button class="secondary" onClick=${() => removeTodo(todo().id)}>
                删除
              </button>
            </label>
          `,
        })}
      </div>
    </main>
  `,
  document.getElementById('app')
);
```

## 6. 分段讲解

### 输入框

输入框读取 `state.draft`，输入时更新 `state.draft`。

新增按钮的 disabled 来自 `canAdd()`。

这就是典型的表单响应式绑定。

### 统计栏

统计栏读取的是 memo。

只要任务列表变化，它们会自动刷新。

### 筛选按钮

按钮点击时只改 `state.filter`。

按钮 class、提示文案、列表内容都会因为 `state.filter` 变化而自动更新。

### 列表

列表用 `For`。

每个任务项用 `todo()` 读取当前任务。

勾选 checkbox 时直接写 `todo().done = ...`。

### 空状态

当 `visibleTodos()` 为空时，`For` 自动显示 `fallback`。

## 7. 收尾总结口播

这个小项目虽然只有几十行核心代码，但已经包含了很多真实业务页面的结构。

我们可以总结成一个固定套路：

第一步，定义基础状态。

第二步，用 `createMemo` 定义派生状态。

第三步，写事件函数修改状态。

第四步，用 `render` 和 `jsx`...` 描述 UI。

第五步，用 `Show` 和 `For` 处理条件与列表。

当你以后写表单、列表、筛选、弹窗时，都可以套用这个结构。

## 8. 留给观众的练习

可以让观众课后尝试：

- 给任务增加优先级字段。
- 增加关键词搜索。
- 把数据保存到 `localStorage`。
- 增加编辑任务标题功能。
- 给删除按钮加确认弹窗。

## 本集结尾

到这里，我们已经能用 `vanilla-signal` 写出一个完整的小 UI。

你不需要先学复杂框架，也能用状态驱动的方式组织页面。

这就是 `vanilla-signal` 最适合初级前端的地方：保留原生 JavaScript 的直接，同时让 UI 更新变得清楚、自动、可维护。
