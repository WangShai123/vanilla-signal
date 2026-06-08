# 第 3 集：render、jsx 模板和 DOM 绑定

## 本集目标

让观众学会不用构建工具，也能用接近 HTML 的方式写响应式 UI。

## 开场口播

前面我们已经学会了状态和派生值。但前端最终还是要把内容显示到页面上。

这一集我们学习 `render` 和 `jsx`...`。它们能让我们在原生浏览器环境里，用接近 HTML 的写法创建 DOM，并且让文本、属性、样式、事件都能响应式更新。

## 1. render：把 UI 挂到页面

### 代码

```js
const { render, jsx } = signal;

render(
  () => jsx`
    <section>
      <h1>Hello vanilla-signal</h1>
    </section>
  `,
  document.getElementById('app')
);
```

### 口播

`render` 接收两个参数。

第一个参数是要渲染的内容，可以是 DOM、字符串、数组，也可以是一个函数。

第二个参数是容器，也就是页面上的某个元素。

`render` 会把内容插入容器，并返回一个 `dispose` 函数，用来销毁这块 UI。

## 2. jsx``：无构建环境下写模板

### 口播

浏览器不能直接运行 `<div></div>` 这种 JSX 语法。除非你用了 Babel、Vite 之类的编译工具。

所以 `vanilla-signal` 提供了 tagged template 写法，也就是：

```js
jsx`<div>内容</div>`;
```

它看起来像 HTML，但本质上还是 JavaScript 模板字符串。

## 3. 文本动态更新

### 代码

```js
const { createSignal, render, jsx } = signal;

const [name, setName] = createSignal('小明');

render(
  () => jsx`
    <section>
      <h2>${() => `你好，${name()}`}</h2>
      <input
        value=${name}
        onInput=${(event) => setName(event.currentTarget.value)}
      >
    </section>
  `,
  app
);
```

### 讲解

在模板里，`${...}` 是动态插槽。

如果插进去的是普通字符串，它就是普通文本。

如果插进去的是函数，例如：

```js
${() => `你好，${name()}`}
```

它就会变成响应式内容。里面读了 `name()`，以后 `name` 变化，这块文本自动更新。

## 4. 动态属性

### 代码

```js
const [disabled, setDisabled] = createSignal(false);

jsx`
  <button disabled=${disabled}>
    保存
  </button>
`;
```

### 讲解

属性也可以传 signal 或函数。

当 `disabled()` 是 `true`，按钮禁用。

当 `disabled()` 是 `false`，属性会被移除。

## 5. 动态 class

### 代码

```js
const [active, setActive] = createSignal(false);

jsx`
  <button
    class=${() => (active() ? 'tab is-active' : 'tab')}
    onClick=${() => setActive((value) => !value)}
  >
    切换
  </button>
`;
```

### 口播

如果 class 由状态决定，就传一个函数。

这比手动写 `element.classList.add` 和 `element.classList.remove` 更集中，因为 class 的规则就写在模板里。

## 6. 动态 style

### 代码

```js
const [progress, setProgress] = createSignal(40);

jsx`
  <div class="bar">
    <div
      class="bar-inner"
      style=${() => ({
        width: `${progress()}%`,
        backgroundColor: progress() >= 80 ? '#16a34a' : '#2563eb',
      })}
    ></div>
  </div>
`;
```

### 讲解

`style` 可以传对象。对象里的字段可以根据状态计算。

CSS 属性名建议用 JavaScript 写法，例如 `backgroundColor`。

## 7. 事件绑定

### 代码

```js
jsx`
  <button onClick=${() => setCount((value) => value + 1)}>
    +1
  </button>
`;
```

### 讲解

事件使用 `onClick`、`onInput`、`onChange` 这类属性。

事件处理函数里通常只做一件事：更新状态。

UI 会因为状态变化自动更新。

## 8. 写入 SVG

### 口播

如果你要在 `jsx``...`` 里写 SVG，可以直接写 `<svg>`。

### 代码

```js
const [liked, setLiked] = createSignal(false);

jsx`
  <button onClick=${() => setLiked((value) => !value)}>
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path
        d="M12 21s-7-4.35-9.33-8.28C.5 9.06 2.42 4.5 6.6 4.5c2.16 0 3.6 1.2 4.4 2.18C11.8 5.7 13.24 4.5 15.4 4.5c4.18 0 6.1 4.56 3.93 8.22C19 16.65 12 21 12 21Z"
        fill=${() => (liked() ? '#e11d48' : 'none')}
        stroke="#e11d48"
        stroke-width="2"
      ></path>
    </svg>
    ${() => (liked() ? '已喜欢' : '喜欢')}
  </button>
`;
```

### 讲解

注意像 `stroke-width` 这种带中划线的 SVG 属性，在模板里可以直接写。

如果你用 `jsx('svg', props)` 这种函数调用写法，带中划线的属性需要加引号：

```js
jsx('path', {
  d: 'M4 12h16',
  stroke: 'currentColor',
  'stroke-width': 2,
});
```

## 9. h / jsx() 函数写法

### 口播

除了模板字符串，还可以用函数调用创建节点。

### 代码

```js
const node = jsx('button', {
  class: () => (count() > 0 ? 'active' : ''),
  onClick: () => setCount((value) => value + 1),
  children: () => `count: ${count()}`,
});
```

### 讲解

这种写法不如模板直观，但它很适合封装底层工具，或者配合 JSX 编译器。

## 10. 一个完整例子：登录状态卡片

### 代码

```html
<div id="app"></div>
<script src="../dist/index.umd.js"></script>
<script>
  const { createSignal, render, jsx } = signal;

  const [name, setName] = createSignal('');
  const [loggedIn, setLoggedIn] = createSignal(false);

  render(
    () => jsx`
      <section>
        <h2>${() => (loggedIn() ? `欢迎，${name()}` : '请登录')}</h2>

        <input
          placeholder="请输入昵称"
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)}
        >

        <button
          disabled=${() => name().trim().length === 0}
          onClick=${() => setLoggedIn(true)}
        >
          登录
        </button>

        <button
          disabled=${() => !loggedIn()}
          onClick=${() => setLoggedIn(false)}
        >
          退出
        </button>
      </section>
    `,
    document.getElementById('app')
  );
</script>
```

### 讲解

这个例子里，标题、按钮禁用状态、输入框内容都来自 signal。

我们没有手动更新 DOM。事件只负责改状态，模板负责描述 UI 和状态的关系。

## 本集结尾

这一集我们学会了：

- `render` 用来挂载 UI。
- `jsx`...` 用来在无构建环境里写模板。
- 文本、属性、class、style、事件都可以和 signal 连接。
- SVG 可以直接写在模板里。

下一集我们进入更真实的业务场景：表单和列表。
