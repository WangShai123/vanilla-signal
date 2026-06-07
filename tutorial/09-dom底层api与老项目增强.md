# 第 9 集：DOM 底层 API 与老项目增强

## 本集目标

这一集讲 `vanilla-signal` 的底层 DOM API。

这些 API 不一定比 `jsx``...`` 更常用，但在老项目改造、局部增强、工具封装时很有价值：

- `insert`
- `bindText`
- `bindAttr`
- `bindStyle`
- `bindClass`
- `bindShow`
- `bindIf`
- `bindList`
- `createListKey`
- `createCompositeKey`
- `html`
- `Fragment`

## 开场口播

前面我们主要用 `render` 和 `jsx``...`` 写新 UI。

但真实工作中，经常不是从零写页面。

你可能接手的是一个已经存在的 HTML 页面，只想给其中一个按钮、一个表格、一个筛选区域加响应式能力。

这时底层 DOM API 就很合适。

## 1. insert：把响应式内容插入 DOM

### 代码

```html
<div id="app">
  <h1>订单数量：</h1>
  <span id="count"></span>
</div>
```

```js
const { createSignal, insert } = signal;

const [count, setCount] = createSignal(0);

insert(document.getElementById('count'), () => count());
```

### 讲解

`insert(parent, value)` 可以把内容插入父节点。

如果 `value` 是函数，它会自动创建响应式更新。

所以 `count()` 变化时，`span` 里的文字会跟着变。

## 2. bindText：绑定文本

### 代码

```html
<h2 id="title"></h2>
```

```js
const title = document.getElementById('title');

bindText(title, () => `当前用户：${state.user.name}`);
```

### 讲解

`bindText` 做的事情很直接：把元素的 `textContent` 绑定到一个值。

适合已有 DOM 的文字更新。

## 3. bindAttr：绑定属性

### 代码

```html
<button id="submit">提交</button>
```

```js
const button = document.getElementById('submit');

bindAttr(button, 'disabled', () => state.loading || !canSubmit());
```

### 讲解

当返回值是 `true`，会设置布尔属性。

当返回值是 `false`、`null`、`undefined`，会移除属性。

适合 `disabled`、`href`、`aria-*`、`data-*` 这类属性。

## 4. bindStyle：绑定样式

### 单个样式

```js
bindStyle(progressBar, 'width', () => `${state.progress}%`);
```

### 多个样式

```js
bindStyle(card, {
  borderColor: () => (state.danger ? '#dc2626' : '#d0d5dd'),
  backgroundColor: () => (state.danger ? '#fff1f2' : '#fff'),
});
```

### 讲解

单个样式适合进度条、宽高、透明度。

多个样式适合状态卡片、提示条、主题切换。传对象时，对象里的每个样式值都可以是普通值，也可以是读取状态的函数。

## 5. bindClass：绑定一个 class

### 代码

```js
bindClass(row, 'is-selected', () => state.selectedId === row.dataset.id);
bindClass(row, 'is-error', () => state.errorIds.includes(row.dataset.id));
```

### 讲解

`bindClass` 是对 `classList.toggle` 的响应式封装。

适合给已有 DOM 加高亮、错误态、选中态。

## 6. bindShow：控制显示隐藏

### 代码

```js
bindShow(panel, () => state.open);
```

### 讲解

`bindShow` 不是移除 DOM，而是通过 `display: none` 控制显示隐藏。

如果你希望内容保留输入状态、滚动位置、内部 DOM，就适合用 `bindShow`。

如果你希望 false 时直接销毁内容，可以用 `bindIf` 或 `Show`。

## 7. bindIf：条件创建和销毁 DOM

### HTML

```html
<div id="panel-host"></div>
```

### JS

```js
const host = document.getElementById('panel-host');
const anchor = document.createComment('panel');

host.append(anchor);

const cleanup = bindIf(
  anchor,
  () => state.open,
  () => jsx`
    <section>
      <h2>设置面板</h2>
      <button onClick=${() => {
        state.open = false;
      }}>
        关闭
      </button>
    </section>
  `
);
```

### 讲解

`bindIf` 需要一个注释节点作为锚点。

条件为 true 时，在锚点附近插入内容。

条件为 false 时，销毁这段内容。

返回的 `cleanup` 可以手动清理这个条件块。

## 8. bindList：底层列表渲染

### HTML

```html
<ul id="todo-list"></ul>
```

### JS

```js
const list = document.getElementById('todo-list');
const anchor = document.createComment('todos');

list.append(anchor);

bindList(
  anchor,
  () => state.todos,
  (todo, index, todoAccessor) => jsx`
    <li>
      <span>${() => index() + 1}.</span>
      <span>${() => todoAccessor().title}</span>
    </li>
  `,
  {
    key: (todo) => todo.id,
    fallback: jsx`<li>暂无任务</li>`,
  }
);
```

### 讲解

`bindList` 是 `For` 背后的底层能力。

它会根据 key 复用旧节点，并在排序、插入、删除时移动 DOM。

`renderItem` 会收到三个参数：

- `item`：创建时的原始项。
- `index`：当前索引 accessor。
- `itemAccessor`：当前项 accessor。

业务代码里一般优先用 `For`。

需要手动控制 DOM 锚点时，再用 `bindList`。

## 9. createListKey 和 createCompositeKey

### 单字段 key

```js
bindList(anchor, () => state.rows, renderRow, {
  key: createListKey('id'),
});
```

### 复合 key

```js
bindList(anchor, () => state.skus, renderSku, {
  key: createCompositeKey('color', 'size'),
});
```

### 讲解

`createListKey('id')` 等价于：

```js
(item) => item.id;
```

`createCompositeKey('color', 'size')` 适合没有单独 id，但多个字段组合起来能确定唯一项的场景。

例如 SKU 的颜色加尺码。

## 10. html：把字符串转成 DOM

### 代码

```js
const node = html('<strong>加粗文本</strong>');

document.body.append(node);
```

### 讲解

`html` 可以把一段 HTML 字符串变成 DOM 节点。

它适合受控的模板片段。

不要把用户输入直接传进去，否则会有 XSS 风险。

用户输入应该作为文本插入，而不是作为 HTML 解析。

## 11. Fragment：返回一组子节点

### 代码

```js
const nodes = Fragment({
  children: [
    jsx`<span>左侧</span>`,
    jsx`<span>右侧</span>`,
  ],
});
```

### 讲解

`Fragment` 通常由 JSX 编译器使用。

在手写代码里，它可以用来返回多个同级节点，而不额外包一层 div。

## 12. 老项目增强示例

### HTML

```html
<section id="legacy-counter">
  <button class="minus">-</button>
  <strong class="value"></strong>
  <button class="plus">+</button>
  <p class="tip"></p>
</section>
```

### JS

```js
const root = document.getElementById('legacy-counter');
const minus = root.querySelector('.minus');
const plus = root.querySelector('.plus');
const value = root.querySelector('.value');
const tip = root.querySelector('.tip');

const [count, setCount] = createSignal(0);

minus.addEventListener('click', () => {
  setCount((current) => current - 1);
});

plus.addEventListener('click', () => {
  setCount((current) => current + 1);
});

bindText(value, () => count());
bindText(tip, () => (count() > 10 ? '数量较多' : ''));
bindAttr(minus, 'disabled', () => count() <= 0);
bindClass(root, 'is-hot', () => count() > 10);
```

### 讲解

这个例子没有重写 HTML，也没有使用 `render`。

我们只是拿到已有 DOM，然后把文字、属性、class 绑定到 signal。

这就是老项目局部增强的典型用法。

## 本集结尾

这一集我们学会了：

- 新 UI 优先用 `render` 和 `jsx``...``。
- 老 DOM 局部增强可以用 `bindText`、`bindAttr`、`bindClass` 等 API。
- 条件块用 `bindIf`。
- 底层列表用 `bindList`。
- key 可以用 `createListKey` 或 `createCompositeKey` 辅助生成。

底层 API 的意义是让 `vanilla-signal` 不只能写新页面，也能进入已有页面的一小块区域，逐步改善交互代码。
