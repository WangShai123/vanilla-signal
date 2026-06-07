# 第 4 集：用 createDeepStore 写表单和列表

## 本集目标

让观众理解什么时候用多个 `createSignal`，什么时候用 `createDeepStore`，并能写出表单、列表和统计信息。

## 开场口播

前面我们用 `createSignal` 保存单个值，比如计数、输入框内容、登录状态。

但真实业务里，状态经常是对象和数组。

比如一个商品编辑表单，里面有名称、价格、库存、规格列表。如果每个字段都单独写一个 signal，代码会越来越散。

这种时候就可以用 `createDeepStore`。

## 1. createStore 和 createDeepStore 的区别

### 口播

`createStore` 更适合扁平对象。

`createDeepStore` 会递归处理普通对象和数组，更适合业务 UI 状态。

初学阶段可以先记住：如果你要处理表单、嵌套对象、数组列表，优先用 `createDeepStore`。

### 代码

```js
const { createDeepStore, createEffect } = signal;

const state = createDeepStore({
  user: {
    name: '小明',
    profile: {
      city: '杭州',
    },
  },
});

createEffect(() => {
  console.log(state.user.profile.city);
});

state.user.profile.city = '上海';
```

### 讲解

这里读取的是 `state.user.profile.city`。

当这个深层字段变化时，effect 会重新执行。

这就是 deep store 的价值：你可以像操作普通对象一样操作状态。

## 2. 表单状态

### 代码

```js
const { createDeepStore, createMemo, render, jsx } = signal;

const form = createDeepStore({
  title: '',
  price: 99,
  stock: 10,
  published: false,
});

const canSubmit = createMemo(() => {
  return form.title.trim().length > 0 && form.price > 0 && form.stock >= 0;
});

render(
  () => jsx`
    <form>
      <label>
        商品名称
        <input
          value=${() => form.title}
          onInput=${(event) => {
            form.title = event.currentTarget.value;
          }}
        >
      </label>

      <label>
        价格
        <input
          type="number"
          value=${() => form.price}
          onInput=${(event) => {
            form.price = Number(event.currentTarget.value);
          }}
        >
      </label>

      <label>
        库存
        <input
          type="number"
          value=${() => form.stock}
          onInput=${(event) => {
            form.stock = Number(event.currentTarget.value);
          }}
        >
      </label>

      <label>
        <input
          type="checkbox"
          checked=${() => form.published}
          onChange=${(event) => {
            form.published = event.currentTarget.checked;
          }}
        >
        上架商品
      </label>

      <button disabled=${() => !canSubmit()}>保存</button>
    </form>
  `,
  app
);
```

### 讲解

这里 `form` 就是整个表单状态。

输入框的 `value` 从 `form` 读取。

输入事件里直接写 `form.title = ...`。

保存按钮是否可用，由 `canSubmit` 这个 memo 计算出来。

这样写的好处是：表单字段集中在一个对象里，校验规则也集中在一个地方。

## 3. 列表状态

### 口播

数组也是 UI 里非常常见的状态，比如商品列表、任务列表、购物车、SKU 表格。

`createDeepStore` 支持常见数组操作，例如 `push`、`splice`、`sort`、`filter`、`reduce`。

### 代码

```js
const state = createDeepStore({
  rows: [
    { id: 'p1', name: 'T-Shirt', stock: 12, price: 89 },
    { id: 'p2', name: 'Hoodie', stock: 4, price: 199 },
  ],
});

state.rows.push({
  id: 'p3',
  name: 'Cap',
  stock: 20,
  price: 59,
});

state.rows[1].stock = 8;

state.rows.splice(0, 1);
```

### 讲解

这些写法都很接近普通 JavaScript。

区别是：当数组或数组项变化时，读取过这些数据的 UI 会自动更新。

## 4. 派生统计

### 代码

```js
const totalStock = createMemo(() => {
  return state.rows.reduce((sum, row) => sum + Number(row.stock || 0), 0);
});

const totalAmount = createMemo(() => {
  return state.rows.reduce((sum, row) => {
    return sum + Number(row.stock || 0) * Number(row.price || 0);
  }, 0);
});

const lowStockCount = createMemo(() => {
  return state.rows.filter((row) => row.stock < 5).length;
});
```

### 口播

总库存、总金额、低库存数量，这些都不是独立状态。

它们都可以从 `rows` 算出来，所以用 `createMemo`。

这可以避免一个常见问题：明明改了库存，但忘记同步修改总库存。

## 5. 渲染列表

### 代码

```js
const { For } = signal;

render(
  () => jsx`
    <section>
      <header>
        <strong>${() => `总库存：${totalStock()}`}</strong>
        <strong>${() => `低库存：${lowStockCount()}`}</strong>
      </header>

      <table>
        <thead>
          <tr>
            <th>商品</th>
            <th>价格</th>
            <th>库存</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${For({
            each: () => state.rows,
            key: (row) => row.id,
            children: (row) => jsx`
              <tr>
                <td>${() => row().name}</td>
                <td>${() => `¥${row().price}`}</td>
                <td>
                  <input
                    type="number"
                    value=${() => row().stock}
                    onInput=${(event) => {
                      row().stock = Number(event.currentTarget.value);
                    }}
                  >
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

### 讲解

`For` 用来渲染列表。

`each` 是列表数据。

`key` 是每一行的稳定身份。对象数组强烈建议提供 `key`，通常就是数据库 id 或业务 id。

`children` 是每一项如何渲染。

这里有一个细节：`row` 是一个读取函数，所以在模板里用 `row().name`、`row().stock`。

## 6. 添加、删除、排序

### 代码

```js
function addProduct() {
  state.rows.push({
    id: crypto.randomUUID(),
    name: 'New Product',
    stock: 0,
    price: 99,
  });
}

function removeProduct(id) {
  const index = state.rows.findIndex((row) => row.id === id);
  if (index >= 0) {
    state.rows.splice(index, 1);
  }
}

function sortByStock() {
  state.rows.sort((a, b) => a.stock - b.stock);
}
```

### 讲解

我们直接操作 `state.rows`。

添加、删除、排序后，列表 UI 和统计信息都会自动更新。

## 7. 批量修改：produce

### 口播

有时我们要一次改多个字段，例如重置表单，或者批量调整库存。

这时可以使用 `produce`。

### 代码

```js
const { produce } = signal;

produce(state, (draft) => {
  draft.rows.forEach((row) => {
    row.stock = 0;
  });
});
```

### 讲解

这里的 `produce` 不是 Immer，不会生成不可变副本。

它是在一次批处理中直接修改当前 store。

初学者可以把它理解成：把多次修改合并成一次更新。

## 8. 提交前转普通对象：snapshot

### 代码

```js
const { snapshot } = signal;

async function submit() {
  const payload = snapshot(form);

  await fetch('/api/products', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
```

### 讲解

store 是代理对象。提交接口、打印调试、保存快照时，可以用 `snapshot` 转成普通对象。

## 本集结尾

这一集我们学会了：

- 简单值用 `createSignal`。
- 对象、表单、数组列表优先用 `createDeepStore`。
- 可推导的数据用 `createMemo`。
- 列表渲染用 `For`，对象列表提供稳定 `key`。
- 提交前可以用 `snapshot` 转普通对象。

下一集我们继续处理更复杂的 UI：条件渲染、空列表、loading、error 和异步请求。
