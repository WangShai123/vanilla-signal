# 第 5 集：条件渲染、列表渲染和异步请求

## 本集目标

让观众掌握真实 UI 中经常出现的三类状态：

- 显示或隐藏：`Show`
- 渲染数组：`For`
- 请求数据：`createResource` 和 `createQuery`

## 开场口播

真实页面很少只有一个按钮。

我们经常要根据登录状态显示不同内容，根据数组渲染列表，根据请求状态显示 loading、error 或数据。

这一集就来解决这些场景。

## 1. Show：条件渲染

### 口播

如果只是控制一个 DOM 显示隐藏，可以用 class 或 style。

但如果你希望条件为 false 时，内容从 DOM 中移除，就可以用 `Show`。

### 代码

```js
const { createSignal, Show, render, jsx } = signal;

const [loggedIn, setLoggedIn] = createSignal(false);

render(
  () => jsx`
    <section>
      <button onClick=${() => setLoggedIn((value) => !value)}>
        切换登录状态
      </button>

      ${Show({
        when: loggedIn,
        fallback: jsx`<p>请先登录</p>`,
        children: jsx`<p>欢迎回来</p>`,
      })}
    </section>
  `,
  app
);
```

### 讲解

`when` 是条件。

`fallback` 是条件不成立时显示的内容。

`children` 是条件成立时显示的内容。

这和我们平时写 `if...else` 很像，只是它可以响应式更新 DOM。

## 2. Show 的函数 children

### 代码

```js
const [user, setUser] = createSignal(null);

Show({
  when: user,
  fallback: jsx`<p>未登录</p>`,
  children: (currentUser) => jsx`
    <p>${currentUser.name}，你好</p>
  `,
});
```

### 讲解

如果 `when` 本身有值，比如用户对象，`children` 可以写成函数。

函数参数就是当前值。

这样可以少写一次 `user()`。

## 3. For：列表渲染

### 代码

```js
const { createDeepStore, For, render, jsx } = signal;

const state = createDeepStore({
  todos: [
    { id: 't1', title: '学习 signal', done: true },
    { id: 't2', title: '写一个列表', done: false },
  ],
});

render(
  () => jsx`
    <ul>
      ${For({
        each: () => state.todos,
        key: (todo) => todo.id,
        fallback: jsx`<li>暂无任务</li>`,
        children: (todo, index) => jsx`
          <li>
            <span>${() => index() + 1}.</span>
            <input
              type="checkbox"
              checked=${() => todo().done}
              onChange=${(event) => {
                todo().done = event.currentTarget.checked;
              }}
            >
            <span class=${() => (todo().done ? 'done' : '')}>
              ${() => todo().title}
            </span>
          </li>
        `,
      })}
    </ul>
  `,
  app
);
```

### 讲解

`For` 里有两个重点。

第一，`key` 很重要。它告诉运行时每一项是谁，这样新增、删除、排序时，DOM 可以更稳定地复用。

第二，`todo` 和 `index` 都是函数。要读取当前项就写 `todo()`，要读取索引就写 `index()`。

## 4. 空状态 fallback

### 口播

真实列表一定要考虑空状态。

比如购物车为空、搜索无结果、任务列表为空。

`For` 的 `fallback` 就是为这个场景准备的。

### 代码

```js
For({
  each: () => state.todos,
  key: (todo) => todo.id,
  fallback: jsx`<li class="empty">暂无任务</li>`,
  children: (todo) => jsx`<li>${() => todo().title}</li>`,
});
```

## 5. createResource：管理一个异步数据

### 口播

接下来我们看请求。

以前写请求时，我们通常要自己准备三个状态：`data`、`loading`、`error`。

`createResource` 可以把这几个状态放在一起管理。

### 代码

```js
const { createResource, render, jsx } = signal;

const [user, { state, reload }] = createResource(async () => {
  const response = await fetch('/api/user');
  if (!response.ok) throw new Error('请求失败');
  return response.json();
});

render(
  () => jsx`
    <section>
      ${() =>
        state.loading
          ? jsx`<p>加载中...</p>`
          : state.error
            ? jsx`
                <div>
                  <p>${() => state.error.message}</p>
                  <button onClick=${reload}>重试</button>
                </div>
              `
            : jsx`<p>${() => user()?.name}</p>`}
    </section>
  `,
  app
);
```

### 讲解

`user()` 用来读取数据。

`state.loading` 表示是否正在加载。

`state.error` 保存错误。

`reload` 可以重新请求。

这比自己维护三个 signal 更集中。

## 6. createResource 跟随参数变化请求

### 代码

```js
const [id, setId] = createSignal(1);

const [product, { state }] = createResource(id, async (currentId) => {
  const response = await fetch(`/api/products/${currentId}`);
  return response.json();
});
```

### 讲解

这里第一个参数 `id` 是请求来源。

当 `id()` 变化时，resource 会自动重新请求。

适合详情页、tab 切换、分页等场景。

## 7. createQuery：更偏业务的请求状态

### 口播

`createQuery` 更像一个面向业务页面的请求工具。它有更明确的状态，比如 `isLoading`、`isFetching`、`isError`、`isSuccess`，还支持重试。

如果你要写搜索列表、详情卡片、仪表盘数据，可以优先考虑 `createQuery`。

### 代码

```js
const { createDeepStore, createQuery, For, render, jsx } = signal;

const state = createDeepStore({
  keyword: '',
});

const products = createQuery({
  queryKey: () => state.keyword.trim(),
  enabled: () => state.keyword.trim().length > 0,
  keepPreviousData: true,
  retry: 1,
  queryFn: async ({ queryKey, signal }) => {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(queryKey)}`,
      { signal }
    );

    if (!response.ok) {
      throw new Error('搜索失败');
    }

    return response.json();
  },
});
```

### 渲染

```js
render(
  () => jsx`
    <section>
      <input
        placeholder="搜索商品"
        value=${() => state.keyword}
        onInput=${(event) => {
          state.keyword = event.currentTarget.value;
        }}
      >

      ${() =>
        products.state.isLoading
          ? jsx`<p>搜索中...</p>`
          : products.state.isError
            ? jsx`
                <div>
                  <p>${() => products.state.error.message}</p>
                  <button onClick=${() => products.retry()}>重试</button>
                </div>
              `
            : For({
                each: () => products() || [],
                key: (item) => item.id,
                fallback: jsx`<p>暂无结果</p>`,
                children: (item) => jsx`
                  <article>
                    <h3>${() => item().name}</h3>
                    <p>${() => `¥${item().price}`}</p>
                  </article>
                `,
              })}
    </section>
  `,
  app
);
```

### 讲解

这里 `queryKey` 是搜索关键词。

`enabled` 表示什么时候允许请求。关键词为空时不请求。

`keepPreviousData` 表示新请求进行中时，可以保留旧数据，页面不会突然清空。

`queryFn` 里能拿到 `signal`，可以交给 `fetch`，用于中断过期请求。

## 8. createResource 和 createQuery 怎么选

### 口播

简单记法：

如果你只是需要一个异步值，用 `createResource`。

如果你在做业务列表、搜索、详情卡片，并且关心状态、重试、保留旧数据，用 `createQuery`。

## 9. 本集常见坑

### 坑一：请求状态没有覆盖完整

不要只处理成功状态。至少考虑：

- loading
- error
- empty
- success

### 坑二：列表不写 key

对象数组建议一定写 `key`。

```js
key: (item) => item.id
```

### 坑三：在 children 里忘记调用 item()

```js
children: (item) => jsx`<div>${() => item().title}</div>`;
```

## 本集结尾

这一集我们学会了：

- `Show` 处理条件渲染。
- `For` 处理列表渲染和空状态。
- `createResource` 管理基础异步数据。
- `createQuery` 管理更完整的业务请求状态。

下一集我们会把前面所有知识串起来，做一个完整的小项目。
