import {
  For,
  Show,
  batch,
  bindList,
  bindText,
  createDeepStore,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  createStore,
  createWatch,
  flushSync,
  insert,
  jsx,
  render,
  startTransition,
  untrack,
} from '../dist/index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => sleep(0);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`);
  }
}

function textOf(el) {
  return el.textContent.replace(/\s+/g, ' ').trim();
}

function observeChildList(target) {
  const records = [];
  const observer = new MutationObserver((entries) => records.push(...entries));
  observer.observe(target, { childList: true });

  return {
    records,
    stop() {
      observer.disconnect();
      return records;
    },
  };
}

function idsFromMutations(records, property) {
  return records.flatMap((record) =>
    Array.from(record[property])
      .filter((node) => node.nodeType === Node.ELEMENT_NODE && node.dataset.id)
      .map((node) => node.dataset.id)
  );
}

function listIds(container) {
  return Array.from(container.querySelectorAll('[data-id]'))
    .map((node) => node.dataset.id)
    .join('');
}

class TestRunner {
  constructor() {
    this.tests = [];
    this.rows = new Map();
    this.stats = {
      pass: 0,
      fail: 0,
      pending: 0,
    };
  }

  add(name, detail, fn) {
    this.tests.push({ name, detail, fn, status: 'pending', error: null });
    this.stats.pending++;
  }

  mount(container) {
    container.textContent = '';
    this.tests.forEach((test, index) => {
      const row = document.createElement('div');
      row.className = 'test-row';
      row.innerHTML = `
        <span class="badge">PENDING</span>
        <div>
          <div class="test-name"></div>
          <div class="test-detail"></div>
        </div>
        <button class="secondary">运行</button>
      `;
      row.querySelector('.test-name').textContent = test.name;
      row.querySelector('.test-detail').textContent = test.detail;
      row
        .querySelector('button')
        .addEventListener('click', () => this.runOne(index));
      container.appendChild(row);
      this.rows.set(test, row);
    });
    this.updateStats();
  }

  setStatus(test, status, message = '') {
    if (test.status !== status) {
      this.stats[test.status]--;
      this.stats[status]++;
      test.status = status;
    }

    const row = this.rows.get(test);
    const badge = row.querySelector('.badge');
    const detail = row.querySelector('.test-detail');
    badge.className = `badge ${status}`;
    badge.textContent = status.toUpperCase();
    if (message) detail.textContent = message;
    this.updateStats();
  }

  updateStats() {
    document.getElementById('stat-total').textContent = this.tests.length;
    document.getElementById('stat-pass').textContent = this.stats.pass;
    document.getElementById('stat-fail').textContent = this.stats.fail;
    document.getElementById('stat-pending').textContent = this.stats.pending;
  }

  async runOne(index) {
    const test = this.tests[index];
    this.setStatus(test, 'running');

    try {
      await test.fn();
      this.setStatus(test, 'pass', test.detail);
      log(`PASS ${test.name}`);
    } catch (error) {
      test.error = error;
      this.setStatus(test, 'fail', error.message);
      log(`FAIL ${test.name}: ${error.message}`);
      console.error(error);
    }
  }

  async runAll() {
    document.getElementById('run-state').textContent = 'RUNNING';
    document.getElementById('run-state').className = 'badge running';

    for (let i = 0; i < this.tests.length; i++) {
      await this.runOne(i);
    }

    const failed = this.tests.some((test) => test.status === 'fail');
    document.getElementById('run-state').textContent = failed ? 'FAIL' : 'PASS';
    document.getElementById('run-state').className =
      `badge ${failed ? 'fail' : 'pass'}`;
  }
}

function log(message) {
  const logEl = document.getElementById('log');
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

const runner = new TestRunner();
window.runner = runner;

runner.add(
  'createSignal + effect',
  '更新同值不触发，函数式 setter 可用。',
  async () => {
    const [count, setCount] = createSignal(0);
    let runs = 0;
    let seen = -1;

    createEffect(() => {
      runs++;
      seen = count();
    });

    equal(runs, 1, 'effect should run immediately');
    setCount(0);
    await tick();
    equal(runs, 1, 'same value should not trigger effect');
    setCount((value) => value + 2);
    await tick();
    equal(seen, 2, 'effect should receive updated value');
  }
);

runner.add(
  'dependency cleanup',
  '条件分支切换后不会继续订阅旧 signal。',
  async () => {
    const [useA, setUseA] = createSignal(true);
    const [a, setA] = createSignal('A');
    const [b, setB] = createSignal('B');
    let runs = 0;
    let value = '';

    createEffect(() => {
      runs++;
      value = useA() ? a() : b();
    });

    setUseA(false);
    await tick();
    equal(value, 'B', 'effect should switch branch');
    const afterSwitch = runs;
    setA('A2');
    await tick();
    equal(runs, afterSwitch, 'old dependency should be removed');
    setB('B2');
    await tick();
    equal(value, 'B2', 'new dependency should remain active');
  }
);

runner.add(
  'createMemo',
  '依赖变更时重算；memo 结果相同不唤醒下游 effect。',
  async () => {
    const [count, setCount] = createSignal(1);
    let computes = 0;
    let effects = 0;
    const even = createMemo(() => {
      computes++;
      return count() % 2 === 0;
    });

    createEffect(() => {
      even();
      effects++;
    });

    equal(effects, 1, 'effect should read memo once');
    setCount(3);
    await tick();
    equal(computes, 2, 'memo should recompute on dependency update');
    equal(effects, 1, 'unchanged memo value should not notify effect');
    setCount(4);
    await tick();
    equal(effects, 2, 'changed memo value should notify effect');
  }
);

runner.add('batch', '批量更新只触发一次下游 effect。', async () => {
  const [a, setA] = createSignal(1);
  const [b, setB] = createSignal(1);
  let runs = 0;

  createEffect(() => {
    a();
    b();
    runs++;
  });

  batch(() => {
    setA(2);
    setB(3);
    setA(4);
  });
  await tick();
  equal(runs, 2, 'batched writes should collapse into one effect run');
});

runner.add(
  'untrack + watch',
  'untrack 不建立订阅；watch defer 首次不执行。',
  async () => {
    const [tracked, setTracked] = createSignal(0);
    const [ignored, setIgnored] = createSignal(0);
    let effectRuns = 0;
    let watchRuns = 0;

    createEffect(() => {
      tracked();
      untrack(ignored);
      effectRuns++;
    });

    createWatch(
      tracked,
      () => {
        watchRuns++;
      },
      { defer: true }
    );

    setIgnored(1);
    await tick();
    equal(effectRuns, 1, 'untracked signal should not rerun effect');
    equal(watchRuns, 0, 'deferred watch should not run immediately');
    setTracked(1);
    await tick();
    equal(effectRuns, 2, 'tracked signal should rerun effect');
    equal(watchRuns, 1, 'watch should run after first update');
  }
);

runner.add('createStore shallow', '浅层 store 只追踪直接属性。', async () => {
  const store = createStore({ name: 'Alice', profile: { city: 'Beijing' } });
  let nameRuns = 0;
  let profileRuns = 0;

  createEffect(() => {
    void store.name;
    nameRuns++;
  });

  createEffect(() => {
    void store.profile;
    profileRuns++;
  });

  store.name = 'Bob';
  await tick();
  equal(nameRuns, 2, 'direct property should be reactive');
  const before = profileRuns;
  store.profile.city = 'Shanghai';
  await tick();
  equal(
    profileRuns,
    before,
    'nested mutation should not trigger shallow store'
  );
});

runner.add(
  'createDeepStore nested array',
  '深层对象字段、数组长度、排序和索引访问都能触发。',
  async () => {
    const state = createDeepStore({
      rows: [
        { id: 'red-s', color: 'Red', size: 'S', stock: 2, price: 99 },
        { id: 'blue-m', color: 'Blue', size: 'M', stock: 8, price: 129 },
      ],
    });

    let firstRuns = 0;
    const totalStock = createMemo(() => {
      return state.rows.reduce((sum, row) => sum + row.stock, 0);
    });

    createEffect(() => {
      void state.rows[0]?.id;
      firstRuns++;
    });

    equal(totalStock(), 10, 'initial total should be correct');
    state.rows[0].stock = 5;
    await tick();
    equal(totalStock(), 13, 'nested field should update memo');
    state.rows.push({
      id: 'green-l',
      color: 'Green',
      size: 'L',
      stock: 1,
      price: 109,
    });
    await tick();
    equal(totalStock(), 14, 'push should update length and iteration');
    const firstBeforeSort = firstRuns;
    state.rows.sort((left, right) => left.stock - right.stock);
    await tick();
    assert(firstRuns > firstBeforeSort, 'sort should notify index readers');
    equal(state.rows[0].id, 'green-l', 'sort should mutate array order');
  }
);

runner.add(
  'SKU derived business state',
  '库存表场景可维护：总库存、低库存和总价值来自 memo。',
  async () => {
    const state = createDeepStore({
      skus: [
        { id: 'a', stock: 3, price: 10 },
        { id: 'b', stock: 9, price: 20 },
      ],
    });
    const total = createMemo(() =>
      state.skus.reduce((sum, sku) => sum + sku.stock, 0)
    );
    const low = createMemo(
      () => state.skus.filter((sku) => sku.stock < 5).length
    );
    const value = createMemo(() =>
      state.skus.reduce((sum, sku) => sum + sku.stock * sku.price, 0)
    );

    equal(total(), 12, 'initial total stock should match');
    equal(low(), 1, 'initial low stock count should match');
    state.skus[0].stock = 6;
    state.skus[1].price = 25;
    state.skus.push({ id: 'c', stock: 1, price: 30 });
    await tick();
    equal(total(), 16, 'total should include nested edits and push');
    equal(low(), 1, 'low stock should update from filter');
    equal(value(), 315, 'value should combine stock and price updates');
  }
);

runner.add(
  'bindText + insert + Show',
  'DOM 文本和条件节点细粒度更新。',
  async () => {
    const [name, setName] = createSignal('JUI');
    const [visible, setVisible] = createSignal(true);
    const el = document.createElement('div');
    const dynamic = document.createElement('div');

    bindText(el, () => `Hello ${name()}`);
    insert(
      dynamic,
      Show({
        when: visible,
        fallback: jsx`<span>hidden</span>`,
        children: jsx`<strong>visible</strong>`,
      })
    );

    equal(el.textContent, 'Hello JUI', 'bindText should set initial content');
    equal(textOf(dynamic), 'visible', 'Show should render children');
    setName('Signal');
    setVisible(false);
    await tick();
    equal(el.textContent, 'Hello Signal', 'bindText should update content');
    equal(textOf(dynamic), 'hidden', 'Show should swap fallback');
  }
);

runner.add(
  'bindList keyed reconciliation',
  'keyed list 复用节点并根据排序移动 DOM。',
  async () => {
    const [items, setItems] = createSignal([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    const container = document.createElement('div');
    const anchor = document.createComment('list');
    const nodes = new Map();
    container.append(anchor);

    bindList(
      anchor,
      items,
      (item) => {
        const el = document.createElement('span');
        el.dataset.id = item.id;
        el.textContent = item.label;
        nodes.set(item.id, el);
        return el;
      },
      { key: (item) => item.id }
    );

    equal(textOf(container), 'ABC', 'initial list should render');
    const bNode = nodes.get('b');
    setItems([
      { id: 'c', label: 'C' },
      { id: 'b', label: 'B' },
      { id: 'a', label: 'A' },
      { id: 'd', label: 'D' },
    ]);
    await tick();
    equal(
      textOf(container),
      'CBAD',
      'DOM order should follow keyed array order'
    );
    assert(nodes.get('b') === bNode, 'existing keyed node should be reused');
  }
);

runner.add(
  'bindList keyed insert precision',
  'keyed list 中间插入只新增目标节点，不重插已有节点。',
  async () => {
    const [items, setItems] = createSignal([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    const container = document.createElement('div');
    const anchor = document.createComment('list');
    container.append(anchor);

    bindList(
      anchor,
      items,
      (item) => {
        const el = document.createElement('span');
        el.dataset.id = item.id;
        el.textContent = item.label;
        return el;
      },
      { key: (item) => item.id }
    );

    equal(listIds(container), 'abc', 'initial ids should render');
    const observer = observeChildList(container);
    flushSync(() =>
      setItems([
        { id: 'a', label: 'A' },
        { id: 'x', label: 'X' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ])
    );
    await tick();
    const mutations = observer.stop();

    equal(listIds(container), 'axbc', 'inserted id should be in target order');
    equal(
      idsFromMutations(mutations, 'addedNodes').join(','),
      'x',
      'only inserted id should be added'
    );
    equal(
      idsFromMutations(mutations, 'removedNodes').join(','),
      '',
      'existing ids should not be removed'
    );
  }
);

runner.add(
  'bindList keyed data update precision',
  'keyed list 同 key 数据更新不触发 childList 变更。',
  async () => {
    const [items, setItems] = createSignal([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    const container = document.createElement('div');
    const anchor = document.createComment('list');
    container.append(anchor);

    bindList(
      anchor,
      items,
      (item, _index, itemAccessor) => {
        const el = document.createElement('span');
        el.dataset.id = item.id;
        bindText(el, () => itemAccessor().label);
        return el;
      },
      { key: (item) => item.id }
    );

    equal(textOf(container), 'AB', 'initial labels should render');
    const observer = observeChildList(container);
    flushSync(() =>
      setItems([
        { id: 'a', label: 'A1' },
        { id: 'b', label: 'B1' },
      ])
    );
    await tick();
    const mutations = observer.stop();

    equal(textOf(container), 'A1B1', 'same keyed records should update text');
    equal(
      idsFromMutations(mutations, 'addedNodes').join(','),
      '',
      'same keyed update should not add nodes'
    );
    equal(
      idsFromMutations(mutations, 'removedNodes').join(','),
      '',
      'same keyed update should not remove nodes'
    );
  }
);

runner.add(
  'bindList keyed insert skips unchanged item notifications',
  'keyed list 插入新项时，不通知同引用的已有 itemAccessor。',
  async () => {
    const state = createDeepStore({
      items: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    });
    const renderableItems = createMemo(() => state.items);
    const container = document.createElement('div');
    const anchor = document.createComment('list');
    const textRuns = new Map();
    container.append(anchor);

    bindList(
      anchor,
      renderableItems,
      (item, _index, itemAccessor) => {
        const el = document.createElement('span');
        el.dataset.id = item.id;
        bindText(el, () => {
          const current = itemAccessor();
          textRuns.set(current.id, (textRuns.get(current.id) || 0) + 1);
          return current.label;
        });
        return el;
      },
      { key: (item) => item.id }
    );

    equal(textOf(container), 'ABC', 'initial labels should render');
    textRuns.clear();
    state.items.splice(1, 0, { id: 'x', label: 'X' });
    await tick();

    equal(textOf(container), 'AXBC', 'inserted label should render');
    equal(textRuns.get('x'), 1, 'new item should render once');
    equal(textRuns.get('a'), undefined, 'unchanged a should not rerender');
    equal(textRuns.get('b'), undefined, 'unchanged b should not rerender');
    equal(textRuns.get('c'), undefined, 'unchanged c should not rerender');
  }
);

runner.add(
  'JSX runtime factory',
  'h/jsx 运行时支持动态 props、children 和事件。',
  async () => {
    const [count, setCount] = createSignal(0);
    const view = jsx`<button class=${() => (count() >= 2 ? 'hot' : 'cold')} onClick=${() => setCount((value) => value + 1)}>${() => `count ${count()}`}</button>`;

    equal(view.textContent, 'count 0', 'dynamic child should render');
    view.click();
    view.click();
    await tick();
    equal(
      view.textContent,
      'count 2',
      'event should update signal-backed child'
    );
    equal(view.className, 'hot', 'dynamic prop should update');
  }
);

runner.add('For component', 'For 组件基于 bindList 渲染数组。', async () => {
  const [items, setItems] = createSignal(['one', 'two']);
  const container = document.createElement('div');

  insert(
    container,
    For({
      each: items,
      children: (item) => jsx`<span>${item}</span>`,
    })
  );

  equal(textOf(container), 'onetwo', 'For should render initial values');
  setItems(['two', 'three']);
  await tick();
  equal(textOf(container), 'twothree', 'For should update list');
});

runner.add(
  'createResource latest-wins',
  'source 快速变化时只保留最新请求结果。',
  async () => {
    const [id, setId] = createSignal(1);
    const [data, { state }] = createResource(id, async (currentId) => {
      await sleep(currentId === 1 ? 40 : 5);
      return { id: currentId };
    });

    setId(2);
    setId(3);
    await sleep(70);
    equal(state.loading, false, 'resource should finish loading');
    equal(data().id, 3, 'only latest source result should be visible');
  }
);

runner.add(
  'createResource loading + reload',
  '请求前显示 loading，失败后可通过 reload 恢复。',
  async () => {
    let calls = 0;
    const [resource, controls] = createResource(
      async () => {
        calls++;
        await sleep(20);
        if (calls === 2) throw new Error('mock network error');
        return { rows: ['sku-a', 'sku-b'] };
      },
      { initialValue: undefined }
    );
    const { state } = controls;

    equal(state.loading, true, 'resource should show loading before data');
    await sleep(35);
    equal(state.loading, false, 'resource should finish loading');
    equal(resource().rows.length, 2, 'resource should expose fetched data');

    controls.mutate((value) => ({ rows: [...value.rows, 'sku-c'] }));
    equal(resource().rows.length, 3, 'mutate should update local data');

    let failed = false;
    try {
      await controls.reload();
    } catch {
      failed = true;
    }
    equal(failed, true, 'reload should reject on fetch error');
    assert(state.error instanceof Error, 'resource should expose error');

    const promise = controls.reload();
    equal(state.loading, true, 'reload should enter loading state');
    await promise;
    equal(state.error, null, 'reload should clear error after success');
    equal(resource().rows.length, 2, 'reload should recover fetched data');
  }
);

runner.add(
  'createRoot disposal',
  'dispose 后 effect 不再响应后续更新。',
  async () => {
    const [count, setCount] = createSignal(0);
    let runs = 0;
    const dispose = createRoot((rootDispose) => {
      createEffect(() => {
        count();
        runs++;
      });
      return rootDispose;
    });

    setCount(1);
    await tick();
    equal(runs, 2, 'effect should run before dispose');
    dispose();
    setCount(2);
    await tick();
    equal(runs, 2, 'disposed effect should not rerun');
  }
);

runner.add(
  'startTransition',
  '低优先级队列异步刷新，最终状态一致。',
  async () => {
    const [value, setValue] = createSignal(0);
    let seen = 0;
    createEffect(() => {
      seen = value();
    });

    startTransition(() => {
      setValue(5);
    });
    await sleep(20);
    equal(seen, 5, 'transition update should eventually flush');
  }
);

function createSkuState() {
  return createDeepStore({
    next: 4,
    rows: [
      {
        id: 'sku-1',
        name: 'Tee',
        color: 'Black',
        size: 'S',
        stock: 12,
        price: 89,
      },
      {
        id: 'sku-2',
        name: 'Tee',
        color: 'Black',
        size: 'M',
        stock: 4,
        price: 89,
      },
      {
        id: 'sku-3',
        name: 'Hoodie',
        color: 'Green',
        size: 'L',
        stock: 7,
        price: 199,
      },
    ],
  });
}

let skuDispose = null;
let skuState = null;

function mountSkuDemo() {
  skuDispose?.();
  skuState = createSkuState();
  const host = document.getElementById('sku-table');
  host.textContent = '';

  skuDispose = createRoot((dispose) => {
    const totalStock = createMemo(() =>
      skuState.rows.reduce((sum, row) => sum + Number(row.stock || 0), 0)
    );
    const lowStock = createMemo(
      () => skuState.rows.filter((row) => Number(row.stock) < 5).length
    );
    const totalValue = createMemo(() =>
      skuState.rows.reduce((sum, row) => {
        return sum + Number(row.stock || 0) * Number(row.price || 0);
      }, 0)
    );

    const summary = document.getElementById('sku-total');
    bindText(
      summary,
      () =>
        `总库存 ${totalStock()} / 低库存 ${lowStock()} / 货值 ${totalValue()}`
    );

    const table = jsx`
      <table class="sku-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>规格</th>
            <th>库存</th>
            <th>价格</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;
    host.append(table);
    const tbody = table.querySelector('tbody');
    const anchor = document.createComment('rows');
    tbody.append(anchor);

    bindList(
      anchor,
      () => skuState.rows,
      (row) => {
        const tr = jsx`
          <tr>
            <td>
              <div class="sku-name">${row.name}</div>
              <div class="sku-sub">${row.id}</div>
            </td>
            <td>${() => `${row.color} / ${row.size}`}</td>
            <td>
              <input type="number" min="0" value=${() => row.stock} onInput=${(
                event
              ) => {
                row.stock = Number(event.currentTarget.value);
              }}>
            </td>
            <td>
              <input type="number" min="0" value=${() => row.price} onInput=${(
                event
              ) => {
                row.price = Number(event.currentTarget.value);
              }}>
            </td>
            <td>
              <span class=${() => (row.stock < 5 ? 'low' : 'ok')}>${() => (row.stock < 5 ? '低库存' : '正常')}</span>
            </td>
          </tr>
        `;
        return tr;
      },
      { key: (row) => row.id }
    );

    return dispose;
  });
}

function mountJsxDemo() {
  const host = document.getElementById('jsx-demo');
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);

  render(
    () => jsx`
    <section>
      <h3>${() => `count ${count()}`}</h3>
      <div class="preview-row">
        <button onClick=${() => setCount((value) => value + 1)}>递增</button>
        <button class="secondary" onClick=${() => setCount(0)}>归零</button>
        <span class="chip">${() => `double ${doubled()}`}</span>
        <span class=${() => (count() % 2 ? 'chip low' : 'chip ok')}>${() => (count() % 2 ? 'odd' : 'even')}</span>
      </div>
    </section>
  `,
    host
  );

  bindText(document.getElementById('jsx-count'), () => `count ${count()}`);
}

function mountQueryDemo() {
  const host = document.getElementById('query-demo');
  let failNext = false;
  const [rows, controls] = createResource(
    async () => {
      await sleep(700);
      if (failNext) {
        failNext = false;
        throw new Error('模拟接口失败');
      }
      return [
        { id: 'order-101', title: 'Black / S', stock: 12 },
        { id: 'order-102', title: 'Green / L', stock: 7 },
      ];
    },
    { initialValue: [] }
  );
  const { state } = controls;

  bindText(document.getElementById('query-state'), () => {
    if (state.loading) return 'loading';
    if (state.error) return 'error';
    if (state.isStale) return 'stale';
    return 'success';
  });

  render(
    () => jsx`
    <section>
      ${() =>
        state.loading && !rows()?.length
          ? jsx`<div class="notice">Loading skeleton: 正在请求 SKU 库存...</div>`
          : state.error
            ? jsx`
            <div class="notice">
              请求失败：${() => state.error?.message || ''}
              <button onClick=${() => controls.reload().catch(() => undefined)}>重试</button>
            </div>
          `
            : jsx`
            <div>
              <div class="preview-row">
                <span class="chip">rows ${() => rows()?.length || 0}</span>
                <button class="secondary" onClick=${() => controls.refetch().catch(() => undefined)}>重新请求</button>
                <button class="secondary" onClick=${() => {
                  failNext = true;
                  void controls.reload().catch(() => undefined);
                }}>模拟失败</button>
              </div>
              <div>${() => (rows() || []).map((item) => jsx`<span class="chip">${item.title}: ${item.stock}</span>`)}</div>
            </div>
          `}
    </section>
  `,
    host
  );
}

document
  .getElementById('run-all')
  .addEventListener('click', () => runner.runAll());
document.getElementById('reset-demo').addEventListener('click', mountSkuDemo);
document.getElementById('clear-log').addEventListener('click', () => {
  document.getElementById('log').textContent = '';
});
document.getElementById('add-sku').addEventListener('click', () => {
  const id = `sku-${skuState.next++}`;
  skuState.rows.push({
    id,
    name: 'New item',
    color: 'White',
    size: 'M',
    stock: 3,
    price: 99,
  });
});
document.getElementById('sort-stock').addEventListener('click', () => {
  skuState.rows.sort((left, right) => Number(left.stock) - Number(right.stock));
});
document.getElementById('discount').addEventListener('click', () => {
  batch(() => {
    skuState.rows.forEach((row) => {
      row.price = Math.max(0, Number(row.price) - 5);
    });
  });
});

runner.mount(document.getElementById('test-list'));
mountSkuDemo();
mountJsxDemo();
mountQueryDemo();
void runner.runAll();
