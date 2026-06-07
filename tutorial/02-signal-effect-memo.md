# 第 2 集：createSignal、createEffect、createMemo

## 本集目标

让观众掌握响应式系统的三个基础角色：

- `createSignal`：保存状态。
- `createEffect`：状态变化后执行副作用。
- `createMemo`：根据状态计算派生值。

## 开场口播

上一集我们知道了，`vanilla-signal` 的核心是“状态变化，页面自动更新”。

这一集我们把这个核心拆开看。你只要先掌握三个 API，就能写出大多数基础交互：`createSignal`、`createEffect`、`createMemo`。

## 1. createSignal：一个会通知变化的值

### 口播

`createSignal` 用来保存一个最基础的响应式值。比如数字、字符串、布尔值、当前选中的 id。

它返回一个数组：第一个是读取函数，第二个是更新函数。

### 代码

```js
const { createSignal } = signal;

const [count, setCount] = createSignal(0);

console.log(count()); // 0

setCount(1);
console.log(count()); // 1

setCount((oldValue) => oldValue + 1);
console.log(count()); // 2
```

### 讲解

这里要提醒初学者：读取 signal 必须调用函数。

不是 `count`，而是 `count()`。

这和普通变量不一样。因为 `count()` 这个读取动作，正是响应式系统收集依赖的机会。

## 2. createEffect：状态变化后自动运行

### 口播

如果 `createSignal` 是状态，那么 `createEffect` 就是“状态变化以后要做的事”。

比如改页面标题、打印日志、绑定第三方库、同步到本地存储。

### 代码

```js
const { createSignal, createEffect } = signal;

const [name, setName] = createSignal('vanilla-signal');

createEffect(() => {
  document.title = `正在学习 ${name()}`;
});

setName('createEffect');
```

### 讲解

这段 effect 里读取了 `name()`。

所以当 `setName()` 更新 `name` 时，这个 effect 会重新执行，页面标题也会跟着变。

我们不用手动告诉 effect 依赖谁。它运行时读了谁，就自动依赖谁。

## 3. effect 的常见场景

### 场景一：同步到 localStorage

```js
const [theme, setTheme] = createSignal('light');

createEffect(() => {
  localStorage.setItem('theme', theme());
  document.documentElement.dataset.theme = theme();
});
```

### 场景二：绑定和清理事件

```js
const { createEffect, onCleanup } = signal;

createEffect(() => {
  const handler = () => {
    console.log('window resized');
  };

  window.addEventListener('resize', handler);

  onCleanup(() => {
    window.removeEventListener('resize', handler);
  });
});
```

### 口播

这里出现了 `onCleanup`。它的意思是：当前 effect 下次重新执行之前，或者当前响应式区域销毁时，先把上一次留下的东西清掉。

定时器、事件监听、第三方实例，都适合放到 `onCleanup` 里清理。

## 4. createMemo：像 Excel 公式一样计算

### 口播

很多状态其实不应该单独保存，因为它们可以从其他状态算出来。

比如单价乘数量得到总价，列表筛选得到可见列表，库存数组求和得到总库存。

这种值就适合用 `createMemo`。

### 代码

```js
const { createSignal, createMemo, createEffect } = signal;

const [price, setPrice] = createSignal(99);
const [count, setCount] = createSignal(2);

const total = createMemo(() => {
  return price() * count();
});

createEffect(() => {
  console.log(`总价：${total()}`);
});

setCount(3); // 总价：297
setPrice(120); // 总价：360
```

### 通俗解释

`createMemo` 很像 Excel 里的公式。

`price` 和 `count` 是单元格。

`total` 是公式 `price * count`。

只要单价或数量变了，总价就自动重新计算。

## 5. memo 和 effect 的区别

### 口播

初学者很容易把 `effect` 和 `memo` 混在一起。

可以这样区分：

`memo` 是为了算出一个值。

`effect` 是为了做一件事。

### 示例

```js
const total = createMemo(() => price() * count());

createEffect(() => {
  document.title = `总价：${total()}`;
});
```

### 讲解

`total` 本身是一个值，所以用 `createMemo`。

修改 `document.title` 是一个副作用，所以用 `createEffect`。

## 6. 课堂小例子：计数器升级版

### 代码

```html
<div id="app"></div>
<script src="../dist/signal.umd.js"></script>
<script>
  const { createSignal, createMemo, render, jsx } = signal;

  const [count, setCount] = createSignal(0);

  const label = createMemo(() => {
    if (count() === 0) return '还没有点击';
    if (count() < 5) return '刚刚开始';
    if (count() < 10) return '继续加油';
    return '点击很多次了';
  });

  render(
    () => jsx`
      <section>
        <h2>${() => `当前次数：${count()}`}</h2>
        <p>${label}</p>
        <button onClick=${() => setCount((value) => value + 1)}>+1</button>
        <button onClick=${() => setCount(0)}>重置</button>
      </section>
    `,
    document.getElementById('app')
  );
</script>
```

### 讲解

这里有一个基础状态 `count`。

还有一个派生状态 `label`。

页面直接读取它们，按钮只负责更新状态。这样代码会很清楚：状态在上面，UI 在下面，事件里只做修改。

## 7. 常见错误

### 错误一：忘记调用 accessor

```js
console.log(count); // 拿到的是函数
console.log(count()); // 拿到当前值
```

### 错误二：在 effect 里无条件修改自己依赖的值

```js
createEffect(() => {
  setCount(count() + 1);
});
```

这会形成循环：effect 读了 `count()`，又立刻修改 `count`，修改后 effect 又执行。

### 错误三：把派生值重复存成状态

不推荐：

```js
const [price, setPrice] = createSignal(100);
const [count, setCount] = createSignal(2);
const [total, setTotal] = createSignal(200);
```

推荐：

```js
const total = createMemo(() => price() * count());
```

## 本集结尾

这一集我们掌握了三个核心 API：

- `createSignal` 保存状态。
- `createEffect` 执行副作用。
- `createMemo` 计算派生值。

下一集我们会把这些状态真正渲染到页面上，学习 `render` 和 `jsx``...``。
