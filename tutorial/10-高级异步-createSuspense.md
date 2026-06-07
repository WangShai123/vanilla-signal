# 第 10 集：高级异步与 createSuspense

## 本集目标

这一集补齐异步相关的进阶用法：

- `createResource` 的 `initialValue`、`loadingDelay`、`mutate`、`reload`、`refetch`、`suspense`、`throwErrors`
- `createQuery` 的 `enabled`、`queryKey`、`keepPreviousData`、`retry`、`retryDelay`、`promise`
- `createSuspense` 的工作方式和使用场景

## 开场口播

前面我们已经用过 `createResource` 和 `createQuery` 处理请求。

这一集我们把异步部分讲完整。

真实业务里的请求不只是“加载成功显示数据”，还会涉及首次 loading、防闪烁、重试、保留旧数据、取消过期请求，以及 Suspense 风格的 fallback。

## 1. createResource 的两种写法

### 无 source：页面打开就请求

```js
const [user, controls] = createResource(async () => {
  const response = await fetch('/api/user');
  return response.json();
});
```

### 有 source：参数变化后请求

```js
const [id, setId] = createSignal(1);

const [product, controls] = createResource(id, async (currentId) => {
  const response = await fetch(`/api/products/${currentId}`);
  return response.json();
});
```

### 讲解

没有 source 时，resource 创建后就会请求。

有 source 时，source 的值变化会触发重新请求。

适合详情页 id 变化、tab 切换、分页参数变化。

## 2. createResource 的状态

### 代码

```js
const [data, { state, reload, refetch, mutate }] = createResource(fetcher);
```

### 状态字段

```js
state.data;
state.latest;
state.loading;
state.error;
state.isStale;
```

### 口播

`data()` 读取当前数据。

`state.data` 是 store 里的当前数据。

`state.latest` 是最近一次成功的数据。

`state.loading` 表示当前是否 loading。

`state.error` 保存请求错误。

`state.isStale` 表示当前正在请求新数据，但页面上还有旧数据。

## 3. initialValue：先给一个初始数据

### 代码

```js
const [products, { state }] = createResource(
  async () => {
    const response = await fetch('/api/products');
    return response.json();
  },
  {
    initialValue: [],
  }
);
```

### 讲解

有些 UI 不希望初始值是 `undefined`。

比如列表页面可以先给 `[]`，这样渲染时不用到处写空判断。

## 4. loadingDelay：避免 loading 闪一下

### 口播

如果请求很快，比如 100 毫秒内完成，loading 一闪而过，体验反而不好。

`loadingDelay` 可以延迟显示 loading。

### 代码

```js
const [data, { state }] = createResource(fetcher, {
  loadingDelay: 200,
});
```

### 讲解

如果请求在 200 毫秒内完成，就不会显示 loading。

如果超过 200 毫秒还没完成，才显示 loading。

适合减少页面闪烁。

## 5. reload 和 refetch 的区别

### 代码

```js
const [data, { reload, refetch }] = createResource(fetcher);

reload();
refetch();
```

### 讲解

在这个实现里，`reload` 会以“重新加载”的方式请求，通常适合用户点击刷新按钮，希望明确看到 loading。

`refetch` 更偏“后台刷新”，已有数据时可以保持页面内容，配合 `isStale` 表示旧数据正在更新。

简单说：

`reload` 更强调重新加载。

`refetch` 更强调刷新数据。

## 6. mutate：本地乐观更新

### 口播

有时接口还没返回，我们希望先把 UI 改掉，让用户感觉更快。

这叫乐观更新。

可以用 `mutate`。

### 代码

```js
const [todos, { mutate, refetch }] = createResource(fetchTodos, {
  initialValue: [],
});

async function toggleTodo(id) {
  mutate((list) => {
    return list.map((todo) =>
      todo.id === id ? { ...todo, done: !todo.done } : todo
    );
  });

  try {
    await fetch(`/api/todos/${id}/toggle`, {
      method: 'POST',
    });
  } catch (error) {
    await refetch();
  }
}
```

### 讲解

`mutate` 直接改 resource 当前数据。

如果接口失败，可以 `refetch` 拉回服务端真实数据。

## 7. throwErrors：读取时抛错

### 代码

```js
const [data] = createResource(fetcher, {
  throwErrors: true,
});

createEffect(() => {
  try {
    console.log(data());
  } catch (error) {
    console.error(error);
  }
});
```

### 讲解

默认情况下，请求错误会放到 `state.error`。

开启 `throwErrors` 后，读取 `data()` 时如果有错误，会直接抛出。

这适合和错误边界或统一错误处理结合。

入门业务页面通常直接用 `state.error` 更直观。

## 8. suspense: true：让 resource 抛 Promise

### 口播

`createResource` 有一个高级选项：`suspense: true`。

开启后，如果首次数据还没回来，并且处于 loading，读取 `data()` 会抛出当前 pending Promise。

这听起来奇怪，但它是 Suspense 风格 UI 的基础。

### 代码

```js
const [user] = createResource(
  async () => {
    const response = await fetch('/api/user');
    return response.json();
  },
  {
    suspense: true,
  }
);
```

### 讲解

普通代码不应该直接让这个 Promise 抛到最外面。

我们需要用 `createSuspense` 捕获它。

## 9. createSuspense：捕获 Promise 并显示 fallback

### 代码

```js
const [user] = createResource(fetchUser, {
  suspense: true,
});

const content = createSuspense(
  () => {
    const currentUser = user();

    return jsx`
      <section>
        <h2>${currentUser.name}</h2>
      </section>
    `;
  },
  jsx`<p>用户信息加载中...</p>`
);

render(() => content(), app);
```

### 讲解

`createSuspense` 接收两个参数。

第一个参数是可能抛 Promise 的函数。

第二个参数是 fallback，也就是等待时显示的内容。

当 `user()` 抛出 Promise 时，`createSuspense` 捕获它，先返回 fallback。

Promise 完成后，它会触发重新计算，再显示真实内容。

这里的关键是：要在 `createSuspense` 的第一个函数里直接读取 `user()`。这样 Promise 才会被 `createSuspense` 捕获。

## 10. fallback 也可以是函数

### 代码

```js
const content = createSuspense(
  () => {
    const currentUser = user();
    return jsx`<div>${currentUser.name}</div>`;
  },
  () => jsx`<div>${() => state.loadingText}</div>`
);
```

### 讲解

fallback 可以是普通 DOM，也可以是 accessor。

如果 fallback 本身也依赖状态，就传函数。

## 11. createSuspense 和 createResource state 的区别

### 口播

这两种写法都能做 loading。

普通写法是显式判断状态：

```js
${() =>
  state.loading
    ? jsx`<p>加载中...</p>`
    : jsx`<p>${() => user().name}</p>`}
```

Suspense 写法是让读取过程自己抛 Promise，然后外层捕获：

```js
const content = createSuspense(
  () => {
    const currentUser = user();
    return jsx`<p>${currentUser.name}</p>`;
  },
  jsx`<p>加载中...</p>`
);
```

显式状态判断更适合初学者和普通业务。

Suspense 更适合封装通用异步组件，或者想把 loading 逻辑提到外层统一处理的场景。

## 12. createQuery：业务请求更完整

### 代码

```js
const products = createQuery({
  queryKey: () => state.keyword.trim(),
  enabled: () => state.keyword.trim().length > 0,
  keepPreviousData: true,
  retry: 2,
  retryDelay: (attempt) => attempt * 500,
  queryFn: async ({ queryKey, signal, attempt }) => {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(queryKey)}`,
      { signal }
    );

    if (!response.ok) {
      throw new Error(`搜索失败，第 ${attempt} 次尝试`);
    }

    return response.json();
  },
});
```

### 讲解

`queryKey` 是请求的关键参数。

`enabled` 控制是否允许自动请求。

`keepPreviousData` 表示新请求过程中是否保留旧数据。

`retry` 是失败后重试次数。

`retryDelay` 是每次重试前等待多久。

`queryFn` 会收到 `signal`，可以交给 `fetch`。当新的请求开始时，旧请求会被中断，避免旧结果覆盖新结果。

## 13. createQuery 的状态字段

### 代码

```js
products.state.status;
products.state.isPending;
products.state.isLoading;
products.state.isFetching;
products.state.isError;
products.state.isSuccess;
products.state.error;
products.state.failureCount;
products.state.updatedAt;
```

### 讲解

`isLoading` 更偏首次加载或没有可展示数据时的加载。

`isFetching` 表示当前正在请求，不管有没有旧数据。

所以很多页面可以这样显示：

首次加载显示骨架屏。

已有数据时，右上角显示一个小的“刷新中”。

请求失败显示错误和重试按钮。

## 14. createQuery 渲染模式

### 代码

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
          ? jsx`<div class="skeleton">加载中...</div>`
          : products.state.isError
            ? jsx`
                <div class="error">
                  <p>${() => products.state.error.message}</p>
                  <button onClick=${() => products.retry()}>重试</button>
                </div>
              `
            : jsx`
                <div>
                  ${Show({
                    when: () => products.state.isFetching,
                    children: jsx`<small>刷新中...</small>`,
                  })}

                  ${For({
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
                </div>
              `}
    </section>
  `,
  app
);
```

### 讲解

这里用到了一个比较完整的异步 UI 结构：

首次加载：骨架屏。

请求失败：错误提示和重试按钮。

请求成功：列表。

后台刷新：显示小提示，但保留旧列表。

空结果：`For` 的 fallback。

## 15. promise：拿到当前请求

### 代码

```js
async function submitAfterLoaded() {
  await products.promise();
  console.log('当前请求完成后再继续');
}
```

### 讲解

`query.promise()` 返回当前请求 Promise。

适合少数需要等待当前请求完成后继续执行的场景。

如果当前还没有请求，它可能是 `null`，实际使用时要注意判断。

## 16. 异步 API 怎么选

### 口播

可以用这套判断：

如果只是一个简单异步值，用 `createResource`。

如果是搜索、列表、详情卡片，关心重试、保留旧数据和更细状态，用 `createQuery`。

如果你要封装 Suspense 风格的异步 UI，用 `createResource({ suspense: true })` 加 `createSuspense`。

如果只是普通按钮提交，用原生 `async/await` 和一个 `loading` signal 也完全可以。

## 17. 常见坑

### 坑一：把所有请求都做成 Suspense

Suspense 是高级组织方式，不是所有请求都需要。

普通业务页面显式写 `loading/error/data` 往往更清楚。

### 坑二：搜索请求不处理过期结果

`createQuery` 会中断旧请求，并且内部有请求 id 判断，适合搜索框这类高频请求。

### 坑三：重试次数太多

用户主动操作的请求，失败后通常给重试按钮更好。

自动重试适合网络抖动场景，不适合所有错误。

### 坑四：乐观更新失败后不回滚

用了 `mutate` 后，如果接口失败，要么恢复旧数据，要么 `refetch` 重新拉取服务端数据。

## 本集结尾

这一集我们补齐了异步进阶：

- `createResource` 管基础异步值。
- `loadingDelay` 能减少 loading 闪烁。
- `mutate` 支持本地乐观更新。
- `throwErrors` 和 `suspense` 可以把错误或 Promise 交给外层处理。
- `createSuspense` 捕获 Promise，先显示 fallback，完成后重新渲染。
- `createQuery` 更适合业务请求，支持重试、中断旧请求和保留旧数据。

到这里，`vanilla-signal` 的核心、DOM、Store、生命周期和异步能力已经形成完整闭环。
