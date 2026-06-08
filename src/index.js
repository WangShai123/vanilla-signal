/* ======================================================
 * Signal
 * A Solid-inspired reactive runtime for browser-first UI.
 *
 * Goals:
 * - No runtime dependency and usable directly as an ES module in browsers.
 * - Fine-grained dependency tracking for signals, memos, effects and stores.
 * - Deep object/array stores that handle SKU-table style nested updates.
 * - DOM helpers plus JSX factory/runtime exports for transformed JSX.
 * ====================================================== */

// 开发工具钩子：如果在全局 window 对象上存在 __SIGNAL_DEVTOOLS__，则引用它，否则为 null
const DEVTOOLS =
  typeof window !== 'undefined' ? window.__SIGNAL_DEVTOOLS__ || null : null;

// 计算节点的状态常量：0 表示清洁（无待处理更新）
const CLEAN = 0;
// 计算节点的状态常量：1 表示过时（数据已变更，需要重新计算）
const STALE = 1;

// 用于追踪 Store 迭代操作（如 for...of, Object.keys）的专用 Symbol key
const ITERATE_KEY = Symbol('iterate');
// 用于追踪 Store 整体版本变化的专用 Symbol key，任何属性变动都会触发此 key 的更新
const STORE_VERSION = Symbol('store-version');
// 用于从 Proxy 代理对象中获取原始数据对象的专用 Symbol key
const RAW = Symbol('signal.raw');
// 用于标识一个对象是否为 Signal Store 的专用 Symbol key
const IS_STORE = Symbol('signal.store');

// 当前正在执行的监听者（Listener），用于在读取信号时建立依赖关系
let Listener = null;
// 当前所有者的上下文（Owner），用于管理副作用、清理函数和错误边界的作用域
let Owner = null;
// 批量更新的嵌套深度，大于 0 时表示处于批量更新模式中，暂停立即刷新效应
let batchDepth = 0;
// 过渡（Transition）更新的嵌套深度，用于处理低优先级的状态更新
let transitionDepth = 0;
// 标记是否正在刷新副作用队列，防止重入导致无限循环
let flushing = false;
// 标记普通副作用队列是否已安排等待刷新
let effectFlushPending = false;
// 标记过渡副作用队列是否已安排等待刷新
let transitionFlushPending = false;
// 全局计算节点 ID 计数器，用于唯一标识每个副作用或记忆值
let computationId = 0;

// 待执行的普通副作用（Effect）队列，存储需要立即或高优先级更新的计算节点
const EFFECT_QUEUE = new Set();
// 待执行的过渡（Transition）副作用队列，存储低优先级、可延迟更新的计算节点
const TRANSITION_QUEUE = new Set();
// 一个已解析的 Promise 实例，用于在不支持 queueMicrotask 的环境中模拟微任务调度
const resolvedPromise = Promise.resolve();

/**
 * 向开发工具发送事件通知。
 *
 * @param {string} type - 事件类型名称。
 * @param {object} payload - 事件携带的数据负载。
 * @returns {void}
 */
function emit(type, payload) {
  DEVTOOLS?.emit?.(type, payload);
}

/**
 * 将任务添加到微任务队列中执行，以确保在当前同步代码执行完毕后尽快异步执行。
 * 优先使用原生的 queueMicrotask API，若不可用则回退到已解析的 Promise 的 then 方法。
 *
 * @param {Function} fn - 需要异步执行的回调函数。
 * @returns {void}
 */
function queueTask(fn) {
  // 检查浏览器是否支持原生的 queueMicrotask API
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
  } else {
    // 回退方案：利用已解析 Promise 的 then 回调将任务推入微任务队列
    // eslint-disable-next-line no-floating-promises
    resolvedPromise.then(fn);
    // resolvedPromise.then(fn).catch((err) => {
    //   console.error(err);
    // });
  }
}

/**
 * 检查给定的值是否为对象类型（排除 null）。
 *
 * @param {*} value - 需要检查的值。
 * @returns {boolean} 如果值是对象且不为 null，则返回 true；否则返回 false。
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * 判断给定的值是否可以被包装（wrappable）。
 *
 * 一个值被认为是可包装的，当且仅当它是：
 * - 一个数组，或者
 * - 一个纯对象（即其原型为 Object.prototype 或 null）
 *
 * @param {*} value - 需要检查的值
 * @returns {boolean} 如果值是可包装的则返回 true，否则返回 false
 */
function isWrappable(value) {
  // 非对象类型直接返回 false
  if (!isObject(value)) return false;

  // 数组被视为可包装
  if (Array.isArray(value)) return true;

  // 检查对象的原型是否为 Object.prototype 或 null（即纯对象）
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 判断给定值是否为访问器（函数类型）。
 *
 * @param {*} value - 需要检查的任意类型值。
 * @returns {boolean} 如果值是函数类型则返回 true，否则返回 false。
 */
function isAccessor(value) {
  return typeof value === 'function';
}

/**
 * 访问给定值，如果该值是访问器函数则执行它，否则直接返回原值。
 *
 * @param {*} value - 需要访问的值，可能是一个普通值或一个无参的访问器函数。
 * @returns {*} 如果 value 是访问器函数，则返回其执行结果；否则返回 value 本身。
 */
export function access(value) {
  return isAccessor(value) ? value() : value;
}

/**
 * 获取当前的 Owner 对象。
 *
 * @returns {Object} 返回全局或模块作用域中的 Owner 变量。
 */
export function getOwner() {
  return Owner;
}

/**
 * 创建一个所有者对象，用于管理资源的生命周期和清理逻辑。
 *
 * @param {Object} parent - 父级所有者对象。如果提供且未 disposed，当前所有者将被添加到父级的 owned 列表中。
 * @param {string} [type='owner'] - 所有者的类型标识，默认为 'owner'。
 * @returns {Object} 新创建的所有者对象，包含类型、父引用、子所有者列表、清理函数列表、处置状态和错误处理器。
 */
function createOwner(parent, type = 'owner') {
  // 初始化所有者对象，包含基本属性和状态
  const owner = {
    type,
    parent,
    owned: [],
    cleanups: [],
    disposed: false,
    errorHandler: null,
  };

  // 如果存在有效的父级所有者（未 disposed），将当前所有者注册为子节点
  if (parent && !parent.disposed) {
    parent.owned.push(owner);
  }

  return owner;
}

/**
 * 在指定的所有者上下文环境中执行给定的函数。
 *
 * 该函数会临时将全局 Owner 设置为传入的 owner，执行 fn，
 * 并在执行结束后恢复之前的 Owner 状态。
 * 如果 owner 已被处置（disposed），则直接返回 undefined 而不执行 fn。
 * 如果 fn 执行过程中抛出错误，则通过 handleError 处理；
 * 若 handleError 返回 false，则重新抛出错误，否则返回 undefined。
 *
 * @param {Object} owner - 执行上下文的所有者对象。若其 disposed 属性为真，则不执行 fn。
 * @param {Function} fn - 要在 owner 上下文中执行的无参函数。
 * @returns {*} 返回 fn 的执行结果；若 owner 已处置或错误被 handleError 吞没，则返回 undefined。
 */
function runWithOwner(owner, fn) {
  // 如果所有者已被处置，则直接返回 undefined，避免在无效上下文中执行
  if (owner?.disposed) return undefined;

  // 保存当前的全局 Owner，以便后续恢复
  const prevOwner = Owner;
  // 将全局 Owner 临时切换为传入的 owner
  Owner = owner;
  try {
    // 在指定的 owner 上下文中执行函数
    return fn();
  } catch (error) {
    // 尝试处理执行过程中抛出的错误；若处理失败则重新抛出
    if (!handleError(error, owner)) throw error;
    return undefined;
  } finally {
    // 无论成功或失败，都恢复之前的全局 Owner 状态
    Owner = prevOwner;
  }
}

/**
 * 执行指定所有者关联的所有清理函数。
 * 该函数会从所有者的 cleanups 数组中移除并逆序执行所有清理回调，
 * 以确保资源释放的顺序与创建顺序相反。如果某个清理函数抛出异常，
 * 会捕获错误并发出 'cleanup:error' 事件，同时打印错误日志，
 * 防止单个清理失败影响后续清理函数的执行。
 *
 * @param {Object} owner - 拥有清理函数列表的对象，必须包含 cleanups 属性（数组）。
 * @returns {void}
 */
function runCleanups(owner) {
  // 原子性地取出所有待执行的清理函数，清空原数组
  const cleanups = owner.cleanups.splice(0);

  // 逆序遍历并执行清理函数，确保后注册的先执行（LIFO 顺序）
  for (let i = cleanups.length - 1; i >= 0; i--) {
    try {
      cleanups[i]();
    } catch (error) {
      // 捕获单个清理函数的异常，发出错误事件并记录日志，避免中断其余清理流程
      emit('cleanup:error', { owner, error });
      console.error('signal cleanup error:', error);
    }
  }
}

/**
 * 处置指定的所有者对象，释放其占用的资源并清理相关依赖。
 *
 * @param {Object} owner - 需要被处置的所有者对象。如果该对象为空或已被处置，则直接返回。
 * @returns {void}
 */
function disposeOwner(owner) {
  // 检查所有者是否存在以及是否已被处置，避免重复处理
  if (!owner || owner.disposed) return;
  owner.disposed = true;

  // 获取所有子拥有者并清空原数组，然后逆序遍历以递归处置每个子计算任务
  const owned = owner.owned.splice(0);
  for (let i = owned.length - 1; i >= 0; i--) {
    disposeComputation(owned[i]);
  }

  // 执行所有注册的清理函数
  runCleanups(owner);

  // 从父级结构中分离当前所有者
  detachFromParent(owner);

  // 发出所有者已处置的事件通知
  emit('owner:dispose', { owner });
}

/**
 * 将指定所有者从其父级或所属容器中分离。
 *
 * @param {Object} owner - 需要被分离的所有者对象，该对象应包含 parent 或 owner 属性以定位其容器，且容器需拥有 owned 数组。
 * @returns {void}
 */
function detachFromParent(owner) {
  // 确定所有者所在的父级容器，优先检查 parent 属性，其次检查 owner 属性
  const parent = owner?.parent || owner?.owner;
  if (!parent?.owned) return;

  // 在容器的 owned 列表中查找所有者的索引并将其移除
  const index = parent.owned.indexOf(owner);
  if (index >= 0) parent.owned.splice(index, 1);
}

/**
 * 处理错误事件，沿着所有者层级向上查找并执行错误处理函数。
 * 如果找到有效的错误处理函数则执行并返回 true；
 * 如果遍历完整个层级链仍未找到处理函数，则发出未处理错误事件并返回 false。
 *
 * @param {Error} error - 需要处理的错误对象。
 * @param {Object} [owner=Owner] - 错误处理的起始所有者对象，默认为全局 Owner。
 * @returns {boolean} - 如果错误被成功处理则返回 true，否则返回 false。
 */
function handleError(error, owner = Owner) {
  let cursor = owner;

  // 沿父级层级链向上遍历，寻找第一个定义了 errorHandler 函数的对象
  while (cursor) {
    if (typeof cursor.errorHandler === 'function') {
      cursor.errorHandler(error);
      return true;
    }
    cursor = cursor.parent;
  }

  // 若未找到任何错误处理函数，则发出未处理错误事件
  emit('error:unhandled', { error });
  return false;
}

/**
 * 根据配置选项获取用于比较两个值是否相等的函数。
 *
 * @param {Object} options - 配置选项对象。
 * @param {Function|boolean} [options.equals] - 自定义的相等性比较函数。
 *   - 如果设置为 `false`，则返回一个始终返回 `false` 的函数，表示任何值都不相等。
 *   - 如果未提供或为其他 falsy 值（除 false 外），则默认使用 `Object.is` 进行比较。
 *   - 如果提供了一个函数，则使用该函数作为比较逻辑。
 *
 * @returns {Function} 一个接受两个参数并返回布尔值的相等性比较函数。
 */
function equalsFromOptions(options) {
  // 如果明确禁用相等性检查（equals === false），返回一个恒假函数
  if (options.equals === false) return () => false;

  // 使用提供的自定义比较函数，或回退到默认的 Object.is
  return options.equals || Object.is;
}

/**
 * 追踪数据源与当前监听器之间的依赖关系。
 * 如果当前没有活跃的监听器或监听器已被销毁，则直接返回。
 * 否则，将当前监听器注册为指定数据源的观察者，并建立双向引用。
 *
 * @param {Object} source - 需要被追踪的数据源对象
 * @returns {void}
 */
function trackSource(source) {
  // 若不存在全局监听器或监听器已销毁，则中止追踪
  if (!Listener || Listener.disposed) return;

  // 确保数据源上存在观察者集合，若不存在则初始化
  if (!source.observers) source.observers = new Set();

  // 避免重复注册：仅当当前监听器尚未订阅该数据源时，建立双向关联
  if (!source.observers.has(Listener)) {
    source.observers.add(Listener);
    Listener.sources.add(source);
  }
}

/**
 * 通知指定源的所有观察者，将其标记为过时状态。
 * 如果源没有观察者或观察者集合为空，则直接返回。
 *
 * @param {Object} source - 包含观察者集合的源对象
 * @param {Set} source.observers - 观察者集合，每个观察者将被标记为 stale
 * @returns {void}
 */
function notifySource(source) {
  // 如果没有观察者或观察者集合为空，则提前返回
  if (!source.observers || source.observers.size === 0) return;

  // 将观察者集合转换为数组以便遍历
  const observers = Array.from(source.observers);
  // 遍历所有观察者并标记为过时状态
  for (let i = 0; i < observers.length; i++) {
    markStale(observers[i]);
  }
}

/**
 * 标记指定节点为过时状态，并触发相应的更新逻辑。
 *
 * @param {Object} node - 需要被标记的节点对象。如果节点为空或已销毁，则直接返回。
 * @returns {void}
 */
function markStale(node) {
  // 如果节点不存在或已被销毁，则提前退出
  if (!node || node.disposed) return;

  // 处理 memo 类型节点：标记为过时状态，并在存在观察者时立即执行
  if (node.type === 'memo') {
    // 如果已经是过时状态，则无需重复处理
    if (node.state === STALE) return;
    node.state = STALE;
    // 如果存在观察者，则运行 memo 计算以传播变化
    if (node.observers?.size > 0) runMemo(node);
    return;
  }

  // 对于非 memo 节点，调度其重新计算
  scheduleComputation(node);
}

/**
 * 将一个计算节点加入合适的刷新队列。
 *
 * 如果当前处于 transition 中，节点会进入低优先级队列；否则进入普通 effect 队列。
 * 已销毁、为空或已经排队的节点会被忽略，避免重复调度。
 *
 * @param {Object} node - 需要重新执行的计算节点。
 * @returns {void}
 */
function scheduleComputation(node) {
  if (!node || node.disposed || node.queued) return;

  node.queued = true;
  if (transitionDepth > 0) {
    TRANSITION_QUEUE.add(node);
    scheduleTransitionFlush();
  } else {
    EFFECT_QUEUE.add(node);
    scheduleEffectFlush();
  }
}

/**
 * 安排普通副作用队列在微任务中刷新。
 *
 * 批处理期间、已经安排刷新或正在刷新时不会重复安排。
 *
 * @returns {void}
 */
function scheduleEffectFlush() {
  if (batchDepth > 0 || effectFlushPending || flushing) return;
  effectFlushPending = true;
  queueTask(flushEffects);
}

/**
 * 安排 transition 队列在浏览器空闲时刷新。
 *
 * 优先使用 requestIdleCallback，让低优先级更新避开主交互路径；不支持时回退到 setTimeout。
 *
 * @returns {void}
 */
function scheduleTransitionFlush() {
  if (batchDepth > 0 || transitionFlushPending) return;
  transitionFlushPending = true;

  /**
   * @type {(callback: () => void) => void}
   */
  const schedule =
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (callback) => setTimeout(callback, 0);

  schedule(flushTransitions);
}

/**
 * 取出并排序一个计算队列。
 *
 * 队列会被清空，返回值按 priority 降序、id 升序排列，确保高优先级先执行且同优先级稳定。
 *
 * @param {Set<Object>} queue - 待处理的计算节点集合。
 * @returns {Object[]} 排序后的计算节点数组。
 */
function drainQueue(queue) {
  const computations = Array.from(queue);
  queue.clear();
  computations.sort((a, b) => b.priority - a.priority || a.id - b.id);
  return computations;
}

/**
 * 刷新普通副作用队列。
 *
 * 该函数带有重入保护和循环保护。刷新期间新加入的 effect 会在本轮继续消化，
 * 超过保护阈值时抛出错误，提示可能存在响应式循环。
 *
 * @returns {void}
 */
function flushEffects() {
  if (flushing) return;

  effectFlushPending = false;
  flushing = true;

  try {
    let guard = 0;
    while (EFFECT_QUEUE.size > 0) {
      if (++guard > 100000) {
        throw new Error('Possible infinite reactive update loop');
      }

      const computations = drainQueue(EFFECT_QUEUE);
      for (let i = 0; i < computations.length; i++) {
        const computation = computations[i];
        computation.queued = false;
        if (!computation.disposed) runEffect(computation);
      }
    }
  } finally {
    flushing = false;
    if (EFFECT_QUEUE.size > 0) scheduleEffectFlush();
  }
}

/**
 * 刷新 transition 队列。
 *
 * transition 中收集到的计算会在一个 batch 内执行，避免每个低优先级更新都单独触发下游刷新。
 *
 * @returns {void}
 */
function flushTransitions() {
  transitionFlushPending = false;

  if (TRANSITION_QUEUE.size === 0) return;
  const computations = drainQueue(TRANSITION_QUEUE);
  batch(() => {
    for (let i = 0; i < computations.length; i++) {
      const computation = computations[i];
      computation.queued = false;
      if (!computation.disposed) runEffect(computation);
    }
  });
}

/**
 * 解除计算节点与其所有依赖源之间的订阅关系。
 *
 * 每次重新执行 computation 前都会清理旧依赖，随后在新的读取路径中重新建立依赖。
 *
 * @param {Object} computation - 需要清理依赖的计算节点。
 * @returns {void}
 */
function cleanupSources(computation) {
  computation.sources.forEach((source) => {
    source.observers?.delete(computation);
  });
  computation.sources.clear();
}

/**
 * 创建 effect 或 memo 使用的计算节点。
 *
 * 计算节点同时也是 owner，可挂载子计算与清理函数；创建时会自动绑定到当前 Owner。
 *
 * @param {Function} fn - 计算函数，执行时会接收上一次计算值。
 * @param {Object} [options={}] - 计算节点配置。
 * @param {string} [options.type='effect'] - 节点类型，常见值为 effect 或 memo。
 * @param {*} [options.value] - 初始缓存值。
 * @param {number} [options.priority=0] - 调度优先级。
 * @param {Function} [options.equals=Object.is] - memo 值比较函数。
 * @returns {Object} 新创建的计算节点。
 */
function createComputation(fn, options = {}) {
  const owner = Owner;
  const computation = {
    id: ++computationId,
    type: options.type || 'effect',
    fn,
    owner,
    owned: [],
    cleanups: [],
    sources: new Set(),
    observers: options.type === 'memo' ? new Set() : null,
    disposed: false,
    queued: false,
    running: false,
    state: STALE,
    initialized: false,
    value: options.value,
    priority: options.priority || 0,
    equals: options.equals || Object.is,
    dispose() {
      disposeComputation(computation);
    },
  };

  if (owner && !owner.disposed) {
    owner.owned.push(computation);
  }

  return computation;
}

/**
 * 销毁计算节点并释放其依赖、子节点和清理函数。
 *
 * 销毁后节点会从所有调度队列和父 owner 中移除，后续通知不会再触发它。
 *
 * @param {Object} computation - 需要销毁的计算节点。
 * @returns {void}
 */
function disposeComputation(computation) {
  if (!computation || computation.disposed) return;

  computation.disposed = true;
  computation.queued = false;
  EFFECT_QUEUE.delete(computation);
  TRANSITION_QUEUE.delete(computation);

  if (computation.sources) cleanupSources(computation);

  const owned = computation.owned?.splice(0) || [];
  for (let i = owned.length - 1; i >= 0; i--) {
    disposeComputation(owned[i]);
  }

  runCleanups(computation);
  computation.observers?.clear();
  detachFromParent(computation);
  emit('computation:dispose', { computation });
}

/**
 * 在依赖收集上下文中执行计算节点。
 *
 * 执行前会清理旧依赖和子资源，执行期间将 Listener 与 Owner 指向该节点，
 * 从而让 signal/store 读取自动订阅到当前计算。
 *
 * @param {Object} computation - 要运行的计算节点。
 * @returns {*} 计算函数返回的新值。
 */
function runComputation(computation) {
  if (computation.disposed) return computation.value;
  if (computation.running) {
    throw new Error('Circular dependency detected in reactive computation');
  }

  cleanupSources(computation);
  disposeOwnedAndCleanups(computation);

  const prevListener = Listener;
  const prevOwner = Owner;
  Listener = computation;
  Owner = computation;
  computation.running = true;

  try {
    const next = computation.fn(computation.value);
    computation.value = next;
    computation.initialized = true;
    computation.state = CLEAN;
    emit(`${computation.type}:run`, { computation });
    return next;
  } catch (error) {
    computation.state = CLEAN;
    emit(`${computation.type}:error`, { computation, error });
    if (!handleError(error, computation)) throw error;
    return computation.value;
  } finally {
    computation.running = false;
    Listener = prevListener;
    Owner = prevOwner;
  }
}

/**
 * 销毁 owner 下的子计算并执行其清理函数。
 *
 * 用于 computation 重跑前重置上一次运行期间创建的嵌套资源。
 *
 * @param {Object} owner - 需要清理子资源的 owner。
 * @returns {void}
 */
function disposeOwnedAndCleanups(owner) {
  const owned = owner.owned.splice(0);
  for (let i = owned.length - 1; i >= 0; i--) {
    disposeComputation(owned[i]);
  }
  runCleanups(owner);
}

/**
 * 执行 effect 类型计算节点。
 *
 * 该函数主要作为语义包装，便于调度层区分 effect 与 memo 的运行入口。
 *
 * @param {Object} computation - effect 计算节点。
 * @returns {void}
 */
function runEffect(computation) {
  runComputation(computation);
}

/**
 * 执行 memo 类型计算节点并在值变化时通知观察者。
 *
 * memo 会缓存计算结果，只有处于 STALE 状态时才重新计算。
 *
 * @param {Object} computation - memo 计算节点。
 * @returns {*} memo 的当前缓存值。
 */
function runMemo(computation) {
  if (computation.state === CLEAN) return computation.value;
  const previous = computation.value;
  const hadValue = computation.initialized;
  const next = runComputation(computation);
  const changed = !hadValue || !computation.equals(previous, next);

  if (hadValue && changed) {
    notifySource(computation);
  }

  return computation.value;
}

/* ======================
 * Core APIs
 * ====================== */

export function createSignal(initial, options = {}) {
  let value = initial;
  const signal = {
    observers: new Set(),
    equals: equalsFromOptions(options),
  };

  function read() {
    trackSource(signal);
    return value;
  }

  function write(next) {
    const nextValue = typeof next === 'function' ? next(value) : next;
    if (signal.equals(value, nextValue)) return value;

    const previous = value;
    value = nextValue;
    emit('signal:update', { previous, next: nextValue });
    notifySource(signal);
    return value;
  }

  read.peek = () => value;
  read.toJSON = () => value;

  return [read, write];
}

/**
 * 创建一个响应式副作用。
 *
 * effect 会立即执行一次并自动追踪执行期间读取的 signal/store；依赖变化后会被重新调度。
 *
 * @param {Function} fn - 副作用函数。
 * @param {Object} [options={}] - effect 配置。
 * @param {boolean} [options.defer=false] - 是否延迟首次执行。
 * @param {number} [options.priority=0] - 调度优先级。
 * @returns {Object} 可 dispose 的计算节点。
 */
export function createEffect(fn, options = {}) {
  const computation = createComputation(fn, {
    type: 'effect',
    priority: options.priority || 0,
  });

  if (options.defer) {
    scheduleComputation(computation);
  } else {
    runEffect(computation);
  }

  return computation;
}

/**
 * 创建计算型副作用。
 *
 * 这是 createEffect 的语义别名，适合表达只用于计算同步的 effect。
 *
 * @param {Function} fn - 计算函数。
 * @param {Object} [options={}] - 计算配置。
 * @returns {Object} 可 dispose 的计算节点。
 */
export function createComputed(fn, options = {}) {
  return createEffect(fn, options);
}

/**
 * 创建带缓存的派生值。
 *
 * memo 只在依赖变化后重新计算，并在缓存值变化时通知读取它的下游计算。
 *
 * @param {Function} fn - 派生计算函数。
 * @param {*} [initial] - 初始缓存值；也可传 options 对象。
 * @param {Object} [options={}] - memo 配置。
 * @returns {Function} memo 读取函数。
 */
export function createMemo(fn, initial, options = {}) {
  if (
    initial &&
    typeof initial === 'object' &&
    !Array.isArray(initial) &&
    (Object.prototype.hasOwnProperty.call(initial, 'equals') ||
      Object.prototype.hasOwnProperty.call(initial, 'defer'))
  ) {
    options = initial;
    initial = undefined;
  }

  const computation = createComputation(fn, {
    type: 'memo',
    value: initial,
    equals: equalsFromOptions(options),
  });

  if (!options.defer) runMemo(computation);

  function read() {
    if (computation.state === STALE) runMemo(computation);
    trackSource(computation);
    return computation.value;
  }

  read.peek = () => computation.value;
  read.dispose = () => disposeComputation(computation);

  return read;
}

/**
 * 监听一个或多个数据源，并在源值变化时调用回调。
 *
 * 回调通过 untrack 执行，因此回调内部读取的其它 signal 不会成为 watch 依赖。
 *
 * @param {Function|Function[]} source - 单个访问器或访问器数组。
 * @param {Function} fn - 变化回调，接收新值和旧值。
 * @param {Object} [options={}] - watch 配置。
 * @param {boolean} [options.defer=false] - 是否跳过首次回调。
 * @returns {Object} 底层 effect 计算节点。
 */
export function createWatch(source, fn, options = {}) {
  const sources = Array.isArray(source) ? source : [source];
  let previous;
  let initialized = false;

  return createEffect(() => {
    const values = sources.map((item) => access(item));
    const next = sources.length === 1 ? values[0] : values;

    if (!initialized) {
      initialized = true;
      if (options.defer) {
        previous = next;
        return;
      }

      untrack(() => fn(next, previous));
      previous = next;
      return;
    }

    untrack(() => fn(next, previous));
    previous = next;
  });
}

/**
 * 创建选择器函数，用于快速判断某个 key 是否等于当前选中值。
 *
 * 常用于列表项选中状态，只让匹配项和取消匹配项更新。
 *
 * @param {Function|*} source - 当前选中值或其访问器。
 * @param {Function} [equals=Object.is] - key 比较函数。
 * @returns {Function} 接收 key 并返回是否匹配的函数。
 */
export function createSelector(source, equals = Object.is) {
  const selected = createMemo(() => access(source));
  return (key) => equals(selected(), key);
}

/**
 * 批量执行多次状态更新。
 *
 * batch 内的更新会推迟队列刷新，直到最外层 batch 结束后统一调度。
 *
 * @param {Function} fn - 批处理函数。
 * @returns {*} fn 的返回值。
 */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      scheduleEffectFlush();
      scheduleTransitionFlush();
    }
  }
}

/**
 * 在不收集依赖的环境中执行函数。
 *
 * 适合在 effect/watch 中读取辅助状态，但不希望这些读取触发重跑。
 *
 * @param {Function} fn - 要执行的函数。
 * @returns {*} fn 的返回值。
 */
export function untrack(fn) {
  const prevListener = Listener;
  Listener = null;
  try {
    return fn();
  } finally {
    Listener = prevListener;
  }
}

/**
 * 同步刷新普通 effect 队列。
 *
 * 如果传入函数，会先在 batch 中执行该函数，再立即刷新普通队列。
 *
 * @param {Function} [fn] - 可选的同步更新函数。
 * @returns {*} fn 的返回值。
 */
export function flushSync(fn) {
  const result = fn ? batch(fn) : undefined;
  flushEffects();
  return result;
}

/**
 * 在 transition 上下文中执行低优先级更新。
 *
 * transition 内被触发的计算会进入 transition 队列，稍后在空闲时刷新。
 *
 * @param {Function} fn - transition 回调。
 * @returns {*} fn 的返回值。
 */
export function startTransition(fn) {
  transitionDepth++;
  try {
    return fn();
  } finally {
    transitionDepth--;
    if (transitionDepth === 0 && batchDepth === 0) {
      scheduleTransitionFlush();
    }
  }
}

/* ======================
 * Lifecycle
 * ====================== */

export function onCleanup(fn) {
  if (!Owner) return fn;
  Owner.cleanups.push(fn);
  return fn;
}

/**
 * 注册销毁回调。
 *
 * 这是 onCleanup 的语义别名，用于表达资源释放意图。
 *
 * @param {Function} fn - 销毁回调。
 * @returns {Function} 原始回调。
 */
export function onDispose(fn) {
  return onCleanup(fn);
}

/**
 * 在当前同步执行结束后的微任务中运行挂载回调。
 *
 * 回调会尝试恢复创建它时的 Owner 上下文，若 owner 已销毁则不会执行。
 *
 * @param {Function} fn - 挂载回调。
 * @returns {void}
 */
export function onMount(fn) {
  const owner = Owner;
  queueTask(() => {
    if (!owner || !owner.disposed) runWithOwner(owner, fn);
  });
}

/**
 * 创建一个可手动 dispose 的响应式作用域。
 *
 * 作用域可用于将若干 effect、memo 和清理函数绑定到同一个生命周期。
 *
 * @param {Function} [fn] - 创建作用域后立即执行的函数。
 * @returns {Object} 包含 result、dispose 和 run 的作用域对象。
 */
export function createScope(fn) {
  const scope = createOwner(Owner, 'scope');
  const result = runWithOwner(scope, () => fn?.());

  return {
    result,
    dispose() {
      disposeOwner(scope);
    },
    run(fn) {
      return runWithOwner(scope, fn);
    },
  };
}

/**
 * 创建响应式根作用域。
 *
 * 根作用域不依赖外层组件系统，适合手动挂载一组响应式资源并返回 dispose。
 *
 * @param {Function} fn - 根作用域回调，接收 dispose 函数。
 * @returns {*} fn 的返回值；如果返回 undefined，则返回默认作用域控制对象。
 */
export function createRoot(fn) {
  const root = createOwner(Owner, 'root');
  const dispose = () => disposeOwner(root);
  const result = runWithOwner(root, () => fn?.(dispose));
  return result === undefined
    ? { dispose, run: (cb) => runWithOwner(root, cb) }
    : result;
}

/* ======================
 * Error Boundary
 * ====================== */

export function createErrorBoundary(fn, fallback) {
  const [error, setError] = createSignal(null);
  let scope = null;

  const setup = () => {
    const parent = Owner;
    const boundary = createOwner(parent, 'error-boundary');
    boundary.errorHandler = (caught) => {
      setError(caught);
      emit('error-boundary:catch', { error: caught });
    };

    scope = {
      dispose: () => disposeOwner(boundary),
      run: (cb) => runWithOwner(boundary, cb),
    };

    runWithOwner(boundary, fn);
  };

  setup();

  return {
    error,
    fallback,
    hasError: () => error() !== null,
    reset() {
      scope?.dispose();
      setError(null);
      setup();
    },
    dispose() {
      scope?.dispose();
      scope = null;
      setError(null);
    },
  };
}

/**
 * 立即执行函数并捕获同步错误。
 *
 * 与 createErrorBoundary 不同，它不创建响应式作用域，只处理当前调用栈里的异常。
 *
 * @param {Function} fn - 需要保护执行的函数。
 * @param {*|Function} fallback - 错误发生时返回的值或错误映射函数。
 * @returns {*} fn 的结果或 fallback 结果。
 */
export function catchError(fn, fallback) {
  try {
    return fn();
  } catch (error) {
    emit('catch-error', { error });
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
}

/* ======================
 * Store
 * ====================== */

// Store 原始对象到元数据的映射，每个原始对象拥有一组按 key 划分的依赖 signal。
const STORE_META = new WeakMap();
// 浅层 store 的 proxy 缓存，确保同一个原始对象复用同一个 proxy。
const STORE_CACHE = new WeakMap();
// 深层 store 的 proxy 缓存，用于懒代理嵌套对象。
const DEEP_STORE_CACHE = new WeakMap();
// 只读 store 的 proxy 缓存。
const READONLY_CACHE = new WeakMap();
// proxy 到原始对象的反向映射，用于 unwrap 与写入前去代理。
const PROXY_TO_RAW = new WeakMap();

/**
 * 获取原始 store 对象的响应式元数据。
 *
 * 元数据按原始对象存储在 WeakMap 中，包含每个属性 key 对应的依赖 signal。
 *
 * @param {Object} target - 原始 store 对象。
 * @returns {Object} store 元数据。
 */
function getStoreMeta(target) {
  let meta = STORE_META.get(target);
  if (!meta) {
    meta = { deps: new Map() };
    STORE_META.set(target, meta);
  }
  return meta;
}

/**
 * 获取 store 某个 key 对应的依赖 signal。
 *
 * key 首次被追踪时会懒创建一个版本号 signal，后续触发时递增该版本号。
 *
 * @param {Object} target - 原始 store 对象。
 * @param {string|symbol} key - 属性 key 或特殊追踪 key。
 * @returns {[Function, Function]} 版本 signal。
 */
function getStoreDep(target, key) {
  const meta = getStoreMeta(target);
  let dep = meta.deps.get(key);
  if (!dep) {
    dep = createSignal(0, { equals: false });
    meta.deps.set(key, dep);
  }
  return dep;
}

/**
 * 追踪 store 指定 key 的读取。
 *
 * @param {Object} target - 原始 store 对象。
 * @param {string|symbol} key - 被读取的 key。
 * @returns {void}
 */
function trackKey(target, key) {
  getStoreDep(target, key)[0]();
}

/**
 * 触发 store 指定 key 的依赖更新。
 *
 * @param {Object} target - 原始 store 对象。
 * @param {string|symbol} key - 发生变化的 key。
 * @returns {void}
 */
function triggerKey(target, key) {
  const dep = getStoreMeta(target).deps.get(key);
  if (dep) dep[1]((value) => value + 1);
}

/**
 * 只解开一层 Proxy，返回其原始对象。
 *
 * 如果传入值不是本运行时创建的 proxy，则原样返回。
 *
 * @param {*} value - 可能是 store proxy 的值。
 * @returns {*} 原始值或传入值。
 */
function unwrapShallow(value) {
  return PROXY_TO_RAW.get(value) || value;
}

/**
 * 深度解包 store proxy，生成普通对象或数组快照。
 *
 * 使用 WeakMap 处理循环引用，避免递归死循环。
 *
 * @param {*} value - 需要解包的值。
 * @param {WeakMap} [seen=new WeakMap()] - 循环引用缓存。
 * @returns {*} 解包后的普通值。
 */
export function unwrap(value, seen = new WeakMap()) {
  const raw = unwrapShallow(value);
  if (!isObject(raw)) return raw;
  if (seen.has(raw)) return seen.get(raw);

  if (Array.isArray(raw)) {
    const output = [];
    seen.set(raw, output);
    for (let i = 0; i < raw.length; i++) output[i] = unwrap(raw[i], seen);
    return output;
  }

  const output = {};
  seen.set(raw, output);
  Object.keys(raw).forEach((key) => {
    output[key] = unwrap(raw[key], seen);
  });
  return output;
}

/**
 * 创建 store 当前状态的普通对象快照。
 *
 * @param {*} value - store、数组或普通值。
 * @returns {*} 解包后的快照。
 */
export function snapshot(value) {
  return unwrap(value);
}

/**
 * 判断属性 key 是否为数组索引。
 *
 * @param {string|symbol} key - 待判断的属性 key。
 * @returns {boolean} 如果 key 表示合法数组索引则返回 true。
 */
function isArrayIndex(key) {
  if (typeof key === 'symbol') return false;
  const value = String(key);
  if (value === '') return false;
  const number = Number(value);
  return (
    Number.isInteger(number) &&
    number >= 0 &&
    number < 4294967295 &&
    String(number) === value
  );
}

// 会改变数组自身结构或内容的方法，需要手动触发数组相关依赖。
const ARRAY_MUTATORS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

/**
 * 触发数组某个索引范围内的依赖。
 *
 * @param {Array} target - 原始数组。
 * @param {number} start - 起始索引，包含。
 * @param {number} end - 结束索引，不包含。
 * @returns {void}
 */
function triggerArrayRange(target, start, end) {
  for (let i = start; i < end; i++) triggerKey(target, String(i));
}

/**
 * 根据数组变异方法触发受影响的索引、length、迭代和版本依赖。
 *
 * @param {Array} target - 原始数组。
 * @param {string} method - 数组变异方法名。
 * @param {Array} args - 调用方法时传入的参数。
 * @param {number} oldLength - 变异前数组长度。
 * @param {number} newLength - 变异后数组长度。
 * @returns {void}
 */
function triggerArrayMutation(target, method, args, oldLength, newLength) {
  const maxLength = Math.max(oldLength, newLength);

  if (method === 'push') {
    triggerArrayRange(target, oldLength, newLength);
  } else if (method === 'pop') {
    triggerKey(target, String(newLength));
  } else if (method === 'splice') {
    const start = Math.max(0, Number(args[0]) || 0);
    triggerArrayRange(target, start, maxLength);
  } else {
    triggerArrayRange(target, 0, maxLength);
  }

  if (oldLength !== newLength) triggerKey(target, 'length');
  triggerKey(target, ITERATE_KEY);
  triggerKey(target, STORE_VERSION);
}

/**
 * 为 store 数组创建方法包装。
 *
 * 变异方法会在 batch 中执行并手动触发依赖；只读 store 会阻止变异并打印警告。
 *
 * @param {Array} target - 原始数组。
 * @param {Array} receiver - proxy 接收者。
 * @param {string} key - 数组方法名。
 * @param {boolean} readonly - 是否为只读 store。
 * @returns {Function} 包装后的数组方法。
 */
function createArrayMethod(target, receiver, key, readonly) {
  const method = Array.prototype[key];

  if (ARRAY_MUTATORS.has(key)) {
    return (...args) => {
      if (readonly) {
        console.warn(
          `[signal] Cannot call mutating array method "${key}" on readonly store`
        );
        return key === 'sort' || key === 'reverse' ? receiver : undefined;
      }

      const oldLength = target.length;
      let result;
      batch(() => {
        result = method.apply(target, args.map(unwrapShallow));
        triggerArrayMutation(target, key, args, oldLength, target.length);
      });

      return result === target ? receiver : result;
    };
  }

  return (...args) => method.apply(receiver, args);
}

/**
 * 创建 store proxy。
 *
 * proxy 会在 get/has/ownKeys 中追踪依赖，在 set/delete/数组变异中触发依赖。
 * deep 为 true 时会懒包装嵌套对象，readonly 为 true 时会阻止写入。
 *
 * @param {Object|Array} target - 需要代理的原始对象或数组。
 * @param {boolean} deep - 是否深度代理嵌套对象。
 * @param {boolean} readonly - 是否创建只读代理。
 * @returns {*} proxy 或不可包装的原值。
 */
function createProxy(target, deep, readonly) {
  target = unwrapShallow(target);
  if (!isWrappable(target)) return target;

  const cache = readonly
    ? READONLY_CACHE
    : deep
      ? DEEP_STORE_CACHE
      : STORE_CACHE;
  if (cache.has(target)) return cache.get(target);

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      if (key === RAW) return obj;
      if (key === IS_STORE) return true;
      if (key === '__raw') return obj;
      if (key === '__isStore') return true;
      if (key === '__version__') {
        trackKey(obj, STORE_VERSION);
        return getStoreDep(obj, STORE_VERSION)[0]();
      }

      if (
        Array.isArray(obj) &&
        typeof key === 'string' &&
        key in Array.prototype
      ) {
        const value = Reflect.get(obj, key, receiver);
        if (typeof value === 'function') {
          return createArrayMethod(obj, receiver, key, readonly);
        }
      }

      if (key === Symbol.iterator) trackKey(obj, ITERATE_KEY);
      if (typeof key !== 'symbol') trackKey(obj, key);

      const value = Reflect.get(obj, key, receiver);
      return deep && isWrappable(value)
        ? createProxy(value, true, readonly)
        : value;
    },

    set(obj, key, value, receiver) {
      if (readonly) {
        console.warn(`[signal] Cannot set "${String(key)}" on readonly store`);
        return true;
      }

      const oldLength = Array.isArray(obj) ? obj.length : 0;
      const hadKey = Object.prototype.hasOwnProperty.call(obj, key);
      const previous = obj[key];
      const next = unwrapShallow(value);
      const result = Reflect.set(obj, key, next, receiver);

      if (!result || Object.is(previous, next)) return result;

      batch(() => {
        triggerKey(obj, key);
        triggerKey(obj, STORE_VERSION);

        if (!hadKey) triggerKey(obj, ITERATE_KEY);

        if (Array.isArray(obj)) {
          if (key === 'length') {
            const newLength = obj.length;
            triggerArrayRange(obj, newLength, oldLength);
            triggerKey(obj, 'length');
            triggerKey(obj, ITERATE_KEY);
          } else if (isArrayIndex(key) && obj.length !== oldLength) {
            triggerKey(obj, 'length');
            triggerKey(obj, ITERATE_KEY);
          }
        }
      });

      return result;
    },

    deleteProperty(obj, key) {
      if (readonly) {
        console.warn(
          `[signal] Cannot delete "${String(key)}" on readonly store`
        );
        return true;
      }

      if (!Object.prototype.hasOwnProperty.call(obj, key)) return true;
      const oldLength = Array.isArray(obj) ? obj.length : 0;
      const result = Reflect.deleteProperty(obj, key);

      if (result) {
        batch(() => {
          triggerKey(obj, key);
          triggerKey(obj, ITERATE_KEY);
          triggerKey(obj, STORE_VERSION);
          if (Array.isArray(obj) && obj.length !== oldLength) {
            triggerKey(obj, 'length');
          }
        });
      }

      return result;
    },

    has(obj, key) {
      trackKey(obj, key);
      return Reflect.has(obj, key);
    },

    ownKeys(obj) {
      trackKey(obj, ITERATE_KEY);
      return Reflect.ownKeys(obj);
    },
  });

  cache.set(target, proxy);
  PROXY_TO_RAW.set(proxy, target);
  return proxy;
}

/**
 * 创建浅层响应式 store。
 *
 * 只有第一层属性会被代理；嵌套对象保持原样。
 *
 * @param {Object|Array} [target={}] - 初始对象或数组。
 * @returns {*} 响应式 store proxy。
 */
export function createStore(target = {}) {
  return createProxy(target, false, false);
}

/**
 * 创建深层响应式 store。
 *
 * 嵌套对象和数组会在读取时懒代理。
 *
 * @param {Object|Array} [target={}] - 初始对象或数组。
 * @returns {*} 深层响应式 store proxy。
 */
export function createDeepStore(target = {}) {
  return createProxy(target, true, false);
}

/**
 * 创建深层只读 store。
 *
 * 读取仍会被追踪，但写入、删除和数组变异会被阻止。
 *
 * @param {Object|Array} [target={}] - 初始对象或数组。
 * @returns {*} 只读 store proxy。
 */
export function createReadonly(target = {}) {
  return createProxy(target, true, true);
}

/**
 * 在 batch 中对 store 执行可变更新。
 *
 * 该函数不会复制数据，只是把多次写入合并为一次刷新时机。
 *
 * @param {*} store - 需要更新的 store。
 * @param {Function} recipe - 直接修改 store 的函数。
 * @returns {*} 原 store。
 */
export function produce(store, recipe) {
  batch(() => recipe(store));
  return store;
}

/* ======================
 * Resource & Suspense
 * ====================== */

export function createResource(source, fetcher, options) {
  if (typeof fetcher !== 'function') {
    options = fetcher || {};
    fetcher = source;
    source = options.source;
  } else {
    options = options || {};
  }

  const state = createDeepStore({
    data: options.initialValue,
    latest: options.initialValue,
    loading: false,
    error: null,
    isStale: false,
  });

  let requestId = 0;
  let pending = null;
  let loadingTimer = null;
  let controller = null;

  const hasData = () => state.data !== undefined;

  function clearLoadingTimer() {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
  }

  function setLoading(value, delay = 0) {
    clearLoadingTimer();
    if (!value) {
      state.loading = false;
      return;
    }

    if (delay > 0) {
      loadingTimer = setTimeout(() => {
        state.loading = true;
      }, delay);
    } else {
      state.loading = true;
    }
  }

  /**
   * 加载数据，处理请求状态、竞态条件及错误处理。
   *
   * @param {*} value - 传递给 fetcher 的主要参数值。
   * @param {boolean} [refetching=false] - 标识当前是否为重新获取数据的操作。
   * @returns {Promise} 返回一个 Promise，解析后得到获取的数据。
   */
  function load(value, refetching = false) {
    // 生成唯一请求ID以处理竞态条件，并获取配置的加载延迟时间
    const id = ++requestId;
    const delay = options.loadingDelay || 0;

    //  abort 前一个未完成的请求，并创建新的 AbortController
    if (controller) controller.abort();
    controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;

    // 重置错误状态，更新数据陈旧状态，并根据情况设置加载状态
    state.error = null;
    state.isStale = hasData();
    setLoading(!hasData() || refetching, delay);

    // 执行数据获取逻辑，处理成功响应与异常情况
    pending = Promise.resolve(
      fetcher(value, {
        value,
        refetching,
        signal: controller?.signal,
      })
    )
      .then((data) => {
        // 忽略过时请求的响应，更新最新数据并重置加载状态
        if (id !== requestId) return state.data;
        clearLoadingTimer();
        state.data = data;
        state.latest = data;
        state.loading = false;
        state.isStale = false;
        return data;
      })
      .catch((error) => {
        // 处理请求中止或失败的情况，仅对当前有效请求更新错误状态
        if (id !== requestId && error?.name === 'AbortError') return state.data;
        if (id === requestId) {
          clearLoadingTimer();
          state.error = error;
          state.loading = false;
          state.isStale = false;
        }
        throw error;
      });

    return pending;
  }

  if (source) {
    createEffect(() => {
      // load(access(source), false);
      // void 显式忽略 Promise，表明不需要等待或处理返回值
      void load(access(source), false);
    });
  } else {
    // load(undefined, false);
    // void 显式忽略初始加载的 Promise
    void load(undefined, false);
  }

  /**
   * 读取资源当前数据。
   *
   * suspense 模式下，如果首次数据仍在加载中，会抛出 pending Promise。
   * throwErrors 模式下，如果存在错误，会直接抛出该错误。
   *
   * @returns {*} 当前资源数据。
   */
  function read() {
    if (
      options.suspense &&
      state.loading &&
      state.data === undefined &&
      pending
    ) {
      throw pending;
    }
    if (options.throwErrors && state.error) throw state.error;
    return state.data;
  }

  read.loading = () => state.loading;
  read.error = () => state.error;
  read.latest = () => state.latest;

  return [
    read,
    {
      state,
      mutate(value) {
        state.data = typeof value === 'function' ? value(state.data) : value;
        state.latest = state.data;
      },
      reload(value) {
        return load(
          value === undefined && source ? access(source) : value,
          true
        );
      },
      refetch(value) {
        return load(
          value === undefined && source ? access(source) : value,
          false
        );
      },
    },
  ];
}

/**
 * 创建查询资源。
 *
 * query 提供接近常见数据请求库的状态字段，包括 pending/loading/fetching/success/error 与 retry。
 *
 * @param {Object|Function} options - 查询配置，或直接作为 queryFn 的函数。
 * @returns {Function} 查询读取函数，附带 state、refetch、retry、promise。
 */
export function createQuery(options) {
  if (typeof options === 'function') {
    options = { queryFn: options };
  }

  const {
    enabled = true,
    initialData,
    keepPreviousData = true,
    queryFn,
    queryKey,
    retry = 0,
    retryDelay = (attempt) => Math.min(1000 * attempt, 3000),
  } = options || {};

  if (typeof queryFn !== 'function') {
    throw new TypeError('createQuery requires a queryFn');
  }

  const state = createDeepStore({
    data: initialData,
    error: null,
    failureCount: 0,
    isError: false,
    isFetching: false,
    isLoading: false,
    isPending: initialData === undefined,
    isSuccess: initialData !== undefined,
    status: initialData === undefined ? 'pending' : 'success',
    updatedAt: initialData === undefined ? 0 : Date.now(),
  });

  let requestId = 0;
  let currentPromise = null;
  let controller = null;

  function getKey() {
    return access(queryKey);
  }

  function getEnabled() {
    return !!access(enabled);
  }

  function waitDelay(value, attempt) {
    const delay = typeof value === 'function' ? value(attempt) : value;
    return sleepFor(delay || 0);
  }

  async function execute({ force = false } = {}) {
    if (!force && !getEnabled()) return state.data;

    const id = ++requestId;
    const key = getKey();
    controller?.abort?.();
    controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;

    state.isFetching = true;
    state.isLoading = state.data === undefined || !keepPreviousData;
    state.isPending = state.data === undefined;
    state.isError = false;
    state.error = null;
    state.status = state.data === undefined ? 'pending' : 'success';

    let attempt = 0;

    const run = async () => {
      attempt++;
      try {
        const data = await queryFn({
          attempt,
          queryKey: key,
          signal: controller?.signal,
        });

        if (id !== requestId) return state.data;

        state.data = data;
        state.error = null;
        state.failureCount = 0;
        state.isError = false;
        state.isFetching = false;
        state.isLoading = false;
        state.isPending = false;
        state.isSuccess = true;
        state.status = 'success';
        state.updatedAt = Date.now();
        return data;
      } catch (error) {
        if (id !== requestId && error?.name === 'AbortError') return state.data;

        const shouldRetry =
          typeof retry === 'function'
            ? retry(attempt, error)
            : attempt <= Number(retry || 0);

        if (shouldRetry) {
          await waitDelay(retryDelay, attempt);
          if (id !== requestId) return state.data;
          return run();
        }

        if (id === requestId) {
          state.error = error;
          state.failureCount = attempt;
          state.isError = true;
          state.isFetching = false;
          state.isLoading = false;
          state.isPending = false;
          state.isSuccess = false;
          state.status = 'error';
        }

        throw error;
      }
    };

    currentPromise = run();
    return currentPromise;
  }

  createEffect(() => {
    getKey();
    if (getEnabled()) execute().catch(() => undefined);
  });

  function read() {
    return state.data;
  }

  read.state = state;
  read.refetch = (options) => execute({ ...options, force: true });
  read.retry = () => execute({ force: true });
  read.promise = () => currentPromise;

  return read;
}

/**
 * 等待指定毫秒数。
 *
 * 在 Node 环境下会尝试 unref timer，避免测试或脚本被 retry 延迟阻塞退出。
 *
 * @param {number} ms - 等待时间。
 * @returns {Promise<void>} 延迟完成的 Promise。
 */
function sleepFor(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer?.unref?.();
  });
}

/**
 * 创建简单的 suspense memo。
 *
 * 当 fn 抛出 Promise 时返回 fallback，并在 Promise settle 后触发重新计算。
 *
 * @param {Function} fn - 可能抛出 Promise 的读取函数。
 * @param {*|Function} fallback - pending 时返回的兜底值或访问器。
 * @returns {Function} memo 读取函数。
 */
export function createSuspense(fn, fallback) {
  const [version, setVersion] = createSignal(0, { equals: false });
  let pending = null;

  return createMemo(() => {
    version();

    try {
      return fn();
    } catch (error) {
      if (error instanceof Promise) {
        if (pending !== error) {
          pending = error;
          error.then(
            () => setVersion((value) => value + 1),
            () => setVersion((value) => value + 1)
          );
        }
        return access(fallback);
      }
      throw error;
    }
  });
}

/* ======================
 * DOM helpers
 * ====================== */

/**
 * 判断当前环境是否可访问 DOM。
 *
 * @returns {boolean} 如果 document 存在则返回 true。
 */
function canUseDOM() {
  return typeof document !== 'undefined';
}

/**
 * 判断值是否为 DOM Node。
 *
 * @param {*} value - 待判断值。
 * @returns {boolean} 如果值是 DOM Node 则返回 true。
 */
function isNode(value) {
  return canUseDOM() && value instanceof Node;
}

/**
 * 将任意可渲染值规范化为 DOM 节点数组。
 *
 * 支持访问器、数组、DocumentFragment、Node、null/boolean 和普通文本值。
 *
 * @param {*} value - 可渲染值。
 * @returns {Node[]} DOM 节点数组。
 */
function normalizeNodes(value) {
  value = access(value);

  if (value == null || value === false || value === true) return [];

  if (Array.isArray(value)) {
    const nodes = [];
    value.forEach((item) => {
      nodes.push(...normalizeNodes(item));
    });
    return nodes;
  }

  if (isNode(value) && value.nodeType === 11) {
    return Array.from(value.childNodes);
  }

  if (isNode(value)) return [value];
  return [document.createTextNode(String(value))];
}

/**
 * 从父节点中移除一组 DOM 节点。
 *
 * @param {Node[]} nodes - 需要移除的节点数组。
 * @returns {void}
 */
function removeNodes(nodes) {
  nodes.forEach((node) => node.parentNode?.removeChild(node));
}

/**
 * 将可渲染值插入到父节点中。
 *
 * 如果 value 是访问器，会创建 effect 自动更新 DOM，并返回清理函数。
 *
 * @param {Node} parent - 父节点。
 * @param {*} value - 可渲染值或访问器。
 * @param {Node|null} [marker=null] - 插入位置标记，节点会插入在该标记前。
 * @returns {Function} 清理函数。
 */
export function insert(parent, value, marker = null) {
  let current = [];

  const update = (next) => {
    const nodes = normalizeNodes(next);

    if (
      current.length === 1 &&
      nodes.length === 1 &&
      current[0].nodeType === 3 &&
      nodes[0].nodeType === 3
    ) {
      current[0].data = nodes[0].data;
      return;
    }

    removeNodes(current);
    nodes.forEach((node) => parent.insertBefore(node, marker));
    current = nodes;
  };

  if (isAccessor(value)) {
    const effect = createEffect(() => update(value()));
    return () => {
      effect.dispose();
      removeNodes(current);
    };
  }

  update(value);
  return () => removeNodes(current);
}

/**
 * 渲染内容到容器中。
 *
 * 渲染前会清空容器，并在新的 root 作用域中建立响应式 DOM 更新。
 *
 * @param {*} value - 可渲染值或访问器。
 * @param {Element} container - DOM 容器。
 * @returns {Function} root dispose 函数。
 */
export function render(value, container) {
  container.textContent = '';
  return createRoot((dispose) => {
    const cleanup = insert(container, value);
    onCleanup(cleanup);
    return dispose;
  });
}

/**
 * 将文本节点内容绑定到 signal。
 *
 * @param {Element} el - 目标元素。
 * @param {*|Function} signal - 文本值或访问器。
 * @returns {Object} effect 计算节点。
 */
export function bindText(el, signal) {
  return createEffect(() => {
    const value = access(signal);
    el.textContent = value == null ? '' : String(value);
  });
}

/**
 * 将元素属性绑定到 signal。
 *
 * null/false 会移除属性，true 会设置布尔属性，其它值会转为字符串。
 *
 * @param {Element} el - 目标元素。
 * @param {string} name - 属性名。
 * @param {*|Function} signal - 属性值或访问器。
 * @returns {Object} effect 计算节点。
 */
export function bindAttr(el, name, signal) {
  return createEffect(() => {
    const value = access(signal);
    if (value == null || value === false) {
      el.removeAttribute(name);
    } else if (value === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, String(value));
    }
  });
}

/**
 * 将元素样式绑定到 signal 或样式对象。
 *
 * name 为对象时会批量设置 style；否则只绑定单个样式属性。
 *
 * @param {HTMLElement|SVGElement} el - 目标元素。
 * @param {string|Object} name - 样式名或样式对象。
 * @param {*|Function} signal - 单个样式值或访问器。
 * @returns {Object} effect 计算节点。
 */
export function bindStyle(el, name, signal) {
  if (typeof name === 'object') {
    return createEffect(() => setStyle(el, access(name)));
  }

  return createEffect(() => {
    const value = access(signal);
    el.style[name] = value == null ? '' : String(value);
  });
}

/**
 * 根据 signal 切换元素 class。
 *
 * @param {Element} el - 目标元素。
 * @param {string} name - class 名称。
 * @param {*|Function} signal - 布尔值或访问器。
 * @returns {Object} effect 计算节点。
 */
export function bindClass(el, name, signal) {
  return createEffect(() => {
    el.classList.toggle(name, !!access(signal));
  });
}

/**
 * 根据 signal 控制元素 display。
 *
 * falsy 时设置为 none，truthy 时恢复为传入的 display 值。
 *
 * @param {HTMLElement|SVGElement} el - 目标元素。
 * @param {*|Function} signal - 显隐布尔值或访问器。
 * @param {string} [display=''] - 显示时使用的 display 值。
 * @returns {Object} effect 计算节点。
 */
export function bindShow(el, signal, display = '') {
  return createEffect(() => {
    el.style.display = access(signal) ? display : 'none';
  });
}

/**
 * 在锚点附近按条件挂载或销毁一段 DOM。
 *
 * factory 只在条件变为 truthy 时执行，块级内容会绑定到独立 root 作用域。
 *
 * @param {Node} anchor - 条件块锚点。
 * @param {*|Function} condition - 条件值或访问器。
 * @param {Function} factory - 创建块内容的函数。
 * @returns {Function} 清理函数。
 */
export function bindIf(anchor, condition, factory) {
  const parent = anchor.parentNode;
  const marker = document.createComment('if');
  parent.insertBefore(marker, anchor.nextSibling);

  let cleanup = null;

  const effect = createEffect(() => {
    const visible = !!access(condition);

    if (visible && !cleanup) {
      const block = createRoot((dispose) => {
        const remove = insert(parent, factory(), marker);
        onCleanup(remove);
        return dispose;
      });
      cleanup = block;
    } else if (!visible && cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  return () => {
    effect.dispose();
    cleanup?.();
    marker.remove();
  };
}

/**
 * 获取列表项默认 key。
 *
 * 对象优先使用 id 或 key 字段，否则回退到索引。
 *
 * @param {*} item - 列表项。
 * @param {number} index - 列表项索引。
 * @returns {*} 稳定 key。
 */
function defaultListKey(item, index) {
  const value = access(item);
  if (value && typeof value === 'object') {
    if ('id' in value) return value.id;
    if ('key' in value) return value.key;
  }
  return index;
}

/**
 * 将数组列表绑定到 DOM。
 *
 * 通过 key 复用已有节点，列表项会获得 item 和 index 的响应式访问器。
 *
 * @param {Node} anchor - 列表插入锚点。
 * @param {Array|Function} listSignal - 数组或数组访问器。
 * @param {Function} renderItem - 渲染单项的函数。
 * @param {Object} [options={}] - 列表配置。
 * @returns {Function} 清理函数。
 */
export function bindList(anchor, listSignal, renderItem, options = {}) {
  const keyFn = options.key || defaultListKey;
  const listOwner = Owner;
  let records = [];
  let fallbackCleanup = null;

  function clearFallback() {
    fallbackCleanup?.();
    fallbackCleanup = null;
  }

  function showFallback(parent) {
    if (!options.fallback || fallbackCleanup) return;
    fallbackCleanup = insert(parent, options.fallback, anchor);
  }

  const effect = createEffect(() => {
    const parent = anchor.parentNode;
    const list = access(listSignal) || [];
    const old = new Map();
    const next = [];
    const used = new Set();

    records.forEach((record) => {
      old.set(record.key, record);
    });

    if (list.length > 0) clearFallback();

    list.forEach((item, index) => {
      const key = keyFn(item, index);
      if (used.has(key)) {
        console.warn(`[bindList] Duplicate key "${String(key)}"`);
      }
      used.add(key);

      let record = old.get(key);
      if (record) {
        record.setIndex(index);
        record.setItem(item);
        old.delete(key);
      } else {
        const [itemAccessor, setItem] = createSignal(item, { equals: false });
        const [indexAccessor, setIndex] = createSignal(index);
        let nodes = [];
        const dispose = runWithOwner(listOwner, () =>
          createRoot((rootDispose) => {
            nodes = normalizeNodes(
              renderItem(item, indexAccessor, itemAccessor)
            );
            nodes.forEach((node) => parent.insertBefore(node, anchor));
            onCleanup(() => removeNodes(nodes));
            return rootDispose;
          })
        );

        record = {
          key,
          nodes,
          dispose,
          setIndex,
          setItem,
        };
      }

      next.push(record);
    });

    old.forEach((record) => record.dispose());

    next.forEach((record) => {
      record.nodes.forEach((node) => parent.insertBefore(node, anchor));
    });

    if (next.length === 0) showFallback(parent);
    records = next;
  });

  return () => {
    effect.dispose();
    records.forEach((record) => record.dispose());
    records = [];
    clearFallback();
  };
}

/**
 * 创建基于单个属性的列表 key 函数。
 *
 * @param {string} property - 用作 key 的属性名。
 * @returns {Function} key 提取函数。
 */
export function createListKey(property) {
  return (item) => access(item)?.[property];
}

/**
 * 创建组合属性 key 函数。
 *
 * 多个属性值会用下划线连接，适合复合主键场景。
 *
 * @param {...string} properties - 参与组合的属性名。
 * @returns {Function} key 提取函数。
 */
export function createCompositeKey(...properties) {
  return (item) => {
    const value = access(item);
    return properties.map((property) => value?.[property]).join('_');
  };
}

/* ======================
 * JSX runtime
 * ====================== */

// 需要使用 SVG 命名空间创建的标签集合。
const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'defs',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'text',
  'tspan',
  'use',
  'symbol',
  'view',
]);

/**
 * 将 JSX 风格事件属性名转换为 DOM 事件名。
 *
 * @param {string} prop - 属性名，例如 onClick。
 * @returns {string|null} DOM 事件名，非事件属性返回 null。
 */
function eventName(prop) {
  if (!/^on[A-Z]/.test(prop) && !/^on[a-z]/.test(prop)) return null;
  return prop.slice(2).toLowerCase();
}

/**
 * 设置元素 style。
 *
 * 支持 null 清空、字符串 cssText 和对象形式的逐项样式绑定。
 *
 * @param {HTMLElement|SVGElement} el - 目标元素。
 * @param {string|Object|null} value - 样式值。
 * @returns {void}
 */
function setStyle(el, value) {
  if (value == null) {
    el.removeAttribute('style');
    return;
  }

  if (typeof value === 'string') {
    el.style.cssText = value;
    return;
  }

  Object.keys(value).forEach((name) => {
    const styleValue = access(value[name]);
    el.style[name] = styleValue == null ? '' : String(styleValue);
  });
}

/**
 * 根据对象形式批量切换 class。
 *
 * @param {Element} el - 目标元素。
 * @param {Object} value - class 到布尔值/访问器的映射。
 * @returns {void}
 */
function setClassList(el, value) {
  Object.keys(value || {}).forEach((name) => {
    el.classList.toggle(name, !!access(value[name]));
  });
}

/**
 * 设置 JSX ref。
 *
 * 函数 ref 会被调用，对象 ref 会写入 current。
 *
 * @param {Function|Object} ref - ref 参数。
 * @param {Element} el - DOM 元素。
 * @returns {void}
 */
function setRef(ref, el) {
  if (!ref) return;
  if (typeof ref === 'function') ref(el);
  else if (typeof ref === 'object') ref.current = el;
}

/**
 * 设置 JSX/DOM 属性。
 *
 * 该函数统一处理 children/key/ref/class/classList/style、布尔属性、DOM property 和 attribute 回退。
 *
 * @param {Element} el - 目标元素。
 * @param {string} name - 属性名。
 * @param {*} value - 属性值。
 * @returns {void}
 */
function setProperty(el, name, value) {
  if (name === 'children' || name === 'key') return;

  if (name === 'ref') {
    setRef(value, el);
    return;
  }

  if (name === 'class' || name === 'className') {
    const next = value == null ? '' : String(value);
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
      el.setAttribute('class', next);
    } else {
      el.className = next;
    }
    return;
  }

  if (name === 'classList') {
    setClassList(el, value);
    return;
  }

  if (name === 'style') {
    setStyle(el, value);
    return;
  }

  const attrName = name === 'htmlFor' ? 'for' : name;

  if (value == null || value === false) {
    el.removeAttribute(attrName);
    if (name in el && typeof el[name] !== 'function') {
      try {
        el[name] = value == null ? '' : false;
      } catch (_) {
        // Ignore readonly DOM properties.
      }
    }
    return;
  }

  if (value === true) {
    el.setAttribute(attrName, '');
    if (name in el) {
      try {
        el[name] = true;
      } catch (_) {
        // Ignore readonly DOM properties.
      }
    }
    return;
  }

  if (name in el && attrName !== 'list' && attrName !== 'type') {
    try {
      el[name] = value;
      return;
    } catch (_) {
      // Fall through to setAttribute for readonly DOM properties.
    }
  }

  el.setAttribute(attrName, String(value));
}

/**
 * 应用单个 JSX 属性。
 *
 * 事件属性会注册监听器；函数值属性会创建 effect 自动更新。
 *
 * @param {Element} el - 目标元素。
 * @param {string} name - 属性名。
 * @param {*} value - 属性值。
 * @returns {void}
 */
function applyProp(el, name, value) {
  const event = eventName(name);
  if (event && typeof value === 'function') {
    el.addEventListener(event, value);
    onCleanup(() => el.removeEventListener(event, value));
    return;
  }

  if (
    isAccessor(value) &&
    name !== 'ref' &&
    name !== 'children' &&
    name !== 'key'
  ) {
    createEffect(() => setProperty(el, name, value()));
  } else {
    setProperty(el, name, value);
  }
}

/**
 * 规范化 JSX children。
 *
 * 显式子参数优先于 props.children，单个子节点保持原值，多个子节点保留数组。
 *
 * @param {Object} props - JSX props。
 * @param {Array} children - rest children。
 * @returns {*} 规范化后的 children。
 */
function normalizeChildren(props, children) {
  if (children.length > 0) {
    return children.length === 1 ? children[0] : children;
  }
  return props?.children;
}

/**
 * JSX/ hyperscript 工厂函数。
 *
 * type 为函数时按组件调用；type 为字符串时创建 DOM/SVG 元素并应用 props 与 children。
 *
 * @param {string|Function} type - 标签名或组件函数。
 * @param {Object} props - 属性对象。
 * @param {...*} children - 子节点。
 * @returns {*} 组件结果或 DOM 元素。
 */
export function h(type, props, ...children) {
  props = props || {};
  const normalizedChildren = normalizeChildren(props, children);

  if (typeof type === 'function') {
    return type({ ...props, children: normalizedChildren });
  }

  const el = SVG_TAGS.has(type)
    ? document.createElementNS('http://www.w3.org/2000/svg', type)
    : document.createElement(type);

  Object.keys(props).forEach((name) => {
    if (name !== 'children') applyProp(el, name, props[name]);
  });

  if (normalizedChildren !== undefined) {
    insert(el, normalizedChildren);
  }

  return el;
}

/**
 * JSX classic runtime 使用的 createElement 别名。
 */
export const createElement = h;

/**
 * JSX Fragment 组件。
 *
 * @param {Object} [props={}] - Fragment props。
 * @returns {*} children 或空数组。
 */
export function Fragment(props = {}) {
  return props.children || [];
}

/**
 * 判断值是否为标签模板字符串数组。
 *
 * @param {*} value - 待判断值。
 * @returns {boolean} 如果值是 TemplateStringsArray 则返回 true。
 */
function isTemplateStrings(value) {
  return Array.isArray(value) && Array.isArray(value.raw);
}

/**
 * 将模板插值转换为 DOM 节点。
 *
 * 函数插值会创建动态占位节点并随访问器更新。
 *
 * @param {*} value - 模板插值。
 * @returns {Node|Node[]} DOM 节点或节点数组。
 */
function parseTemplateValue(value) {
  if (isAccessor(value)) {
    const fragment = document.createDocumentFragment();
    const marker = document.createComment('jui-dynamic');
    fragment.append(marker);
    let cleanup = null;

    createEffect(() => {
      cleanup?.();
      cleanup = insert(marker.parentNode, value(), marker);
    });

    onCleanup(() => cleanup?.());
    return fragment;
  }

  if (isNode(value)) return value;
  if (Array.isArray(value)) {
    const fragment = document.createDocumentFragment();
    normalizeNodes(value).forEach((node) => fragment.append(node));
    return fragment;
  }

  return document.createTextNode(value == null ? '' : String(value));
}

/**
 * 将 HTML 字符串解析为 DOM 节点。
 *
 * @param {string} markup - HTML 字符串。
 * @returns {Node|Node[]} 单个节点或节点数组。
 */
export function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup || '').trim();
  return template.content.childNodes.length === 1
    ? template.content.firstChild
    : Array.from(template.content.childNodes);
}

/**
 * 将 tagged template 的字符串片段和插值转换为 DOM 节点。
 *
 * 属性位置的插值会通过 applyProp 绑定，节点位置的插值会替换临时 slot。
 *
 * @param {TemplateStringsArray|string[]} strings - 模板字符串片段。
 * @param {Array} values - 插值数组。
 * @returns {Node|Node[]} DOM 节点或节点数组。
 */
function templateToNodes(strings, values) {
  let html = '';
  const attrTokens = new Map();
  const attrNames = new Map();

  for (let i = 0; i < strings.length; i++) {
    html += strings[i];
    if (i < values.length) {
      const before = strings[i];
      const attrMatch = before.match(
        /([:@A-Za-z_][-:@A-Za-z0-9_.]*)\s*=\s*(['"]?)$/
      );
      if (attrMatch) {
        const token = `__JUI_ATTR_${i}__`;
        attrTokens.set(token, i);
        attrNames.set(i, attrMatch[1]);
        html += attrMatch[2] ? token : `"${token}"`;
      } else {
        html += `<jui-slot data-jui-slot="${i}"></jui-slot>`;
      }
    }
  }

  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const content = template.content;

  content.querySelectorAll('jui-slot').forEach((slot) => {
    const index = Number(slot.getAttribute('data-jui-slot'));
    slot.replaceWith(parseTemplateValue(values[index]));
  });

  content.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (!attrTokens.has(attr.value)) return;
      const index = attrTokens.get(attr.value);
      node.removeAttribute(attr.name);
      applyProp(node, attrNames.get(index) || attr.name, values[index]);
    });
  });

  return content.childNodes.length === 1
    ? content.firstChild
    : Array.from(content.childNodes);
}

/**
 * JSX automatic runtime 入口。
 *
 * 同时支持被作为 tagged template 使用。
 *
 * @param {string|Function|TemplateStringsArray} type - 标签、组件或模板字符串。
 * @param {Object} props - 属性对象。
 * @param {*} key - JSX key。
 * @returns {*} 渲染结果。
 */
export function jsx(type, props, key) {
  if (isTemplateStrings(type)) {
    return templateToNodes(type, Array.prototype.slice.call(arguments, 1));
  }

  const nextProps = key === undefined ? props : { ...props, key };
  return h(type, nextProps);
}

/**
 * JSX automatic runtime 的多 children 入口。
 */
export const jsxs = jsx;
/**
 * JSX development runtime 入口。
 */
export const jsxDEV = jsx;

/**
 * 条件渲染组件。
 *
 * 返回一个访问器，由 insert 或 JSX runtime 在后续渲染中消费。
 *
 * @param {Object} props - Show 参数。
 * @returns {Function} 可渲染访问器。
 */
export function Show(props) {
  return () => {
    const when = access(props.when);
    if (when) {
      return typeof props.children === 'function'
        ? props.children(when)
        : props.children;
    }
    return access(props.fallback);
  };
}

/**
 * 列表渲染组件。
 *
 * 内部通过 bindList 维护 keyed DOM 记录。
 *
 * @param {Object} props - For 参数。
 * @returns {DocumentFragment} 包含列表锚点的片段。
 */
export function For(props) {
  const fragment = document.createDocumentFragment();
  const start = document.createComment('for-start');
  const end = document.createComment('for-end');
  fragment.append(start, end);

  bindList(
    end,
    () => access(props.each) || [],
    (item, index, itemAccessor) => {
      if (typeof props.children === 'function') {
        return props.children(itemAccessor, index);
      }
      return props.children;
    },
    {
      key: props.key,
      fallback: props.fallback,
    }
  );

  return fragment;
}
