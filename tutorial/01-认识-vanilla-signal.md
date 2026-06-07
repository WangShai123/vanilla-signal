# 第 1 集：认识 vanilla-signal

## 本集目标

让观众理解 `vanilla-signal` 解决什么问题，以及它和直接操作 DOM、React/Vue 这类框架的区别。

## 开场口播

大家好，这一集我们来认识一个很轻量的响应式 UI 工具：`vanilla-signal`。

如果你刚开始写前端，可能经常会遇到这样的代码：点一下按钮，先改一个变量，然后手动找到页面上的某个元素，再改 `textContent`，再改 `className`，再控制另一个按钮是否禁用。

一开始这没问题。但当一个状态要影响页面上很多地方，或者一个页面里有表单、列表、弹窗、请求状态时，手动操作 DOM 很快就会变得很乱。

`vanilla-signal` 要解决的就是这个问题：我们还是写原生 JavaScript，还是操作真实 DOM，但状态变化以后，页面上用到这个状态的地方会自动更新。

## 屏幕操作

创建一个最小 HTML：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>vanilla-signal demo</title>
    <script src="../dist/signal.umd.js"></script>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const { createSignal, render, jsx } = signal;

      const [count, setCount] = createSignal(0);

      render(
        () => jsx`
          <button onClick=${() => setCount((value) => value + 1)}>
            ${() => `点击次数：${count()}`}
          </button>
        `,
        document.getElementById('app')
      );
    </script>
  </body>
</html>
```

## 讲解口播

这里我们没有写 `document.querySelector` 去找按钮，也没有在点击事件里手动改按钮文字。

我们只做了三件事：

第一，创建一个状态：

```js
const [count, setCount] = createSignal(0);
```

第二，在页面里读取这个状态：

```js
${() => `点击次数：${count()}`}
```

第三，点击按钮时更新状态：

```js
setCount((value) => value + 1);
```

当 `count` 变化时，按钮里的文字会自动变。这就是响应式 UI 最核心的体验：状态是源头，页面是状态的表现。

## 通俗解释

你可以把 `signal` 理解成一个带通知功能的小盒子。

`count()` 是打开盒子看一眼。

`setCount()` 是往盒子里放一个新值。

页面里某个地方只要读过 `count()`，它就相当于登记了一下：“以后这个值变了，记得通知我。”

所以我们不需要到处手动更新 DOM。

## 对比原生 DOM 写法

先展示传统写法：

```js
let count = 0;

const button = document.createElement('button');
button.textContent = `点击次数：${count}`;

button.addEventListener('click', () => {
  count += 1;
  button.textContent = `点击次数：${count}`;
});

document.getElementById('app').append(button);
```

然后展示 `vanilla-signal` 写法：

```js
const [count, setCount] = createSignal(0);

render(
  () => jsx`
    <button onClick=${() => setCount((value) => value + 1)}>
      ${() => `点击次数：${count()}`}
    </button>
  `,
  app
);
```

## 讲解重点

传统写法的问题不在于它不能用，而是在状态变多以后，你要记住所有受影响的 DOM。

`vanilla-signal` 的写法是：谁用到了状态，谁自动更新。我们把注意力放在“状态是什么”和“页面长什么样”，而不是“每次变化要手动改哪些 DOM”。

## 适合使用 vanilla-signal 的场景

- 普通后台页面里的筛选、表单、弹窗、抽屉。
- 商品 SKU 表、库存表、报价表这种有列表和统计的 UI。
- 不想引入 React/Vue，但又不想手写一堆 DOM 更新逻辑的小项目。
- 老项目里某个局部页面想增强交互。
- 需要直接在浏览器里通过 `<script>` 使用的轻量页面。

## 不适合一上来使用的场景

如果你的项目已经是完整 React/Vue 应用，那状态和渲染体系已经由框架负责，不一定需要再引入它。

如果你要做大型工程化应用，也要考虑路由、组件体系、测试、团队规范等配套能力。

所以这门教程的定位很清楚：用 `vanilla-signal` 帮初级前端更轻松地写原生 UI。

## 本集结尾

这一集我们先记住一句话：

> `vanilla-signal` 是一个让原生 JavaScript 页面具备响应式更新能力的小型运行时。

下一集我们开始学习三个最核心的 API：`createSignal`、`createEffect` 和 `createMemo`。
