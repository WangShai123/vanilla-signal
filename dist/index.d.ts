//#region src/index.d.ts
type Equality<T = any> = (previous: T, next: T) => boolean;
type Accessor<T = any> = (() => T) & {
  peek?: () => T;
  toJSON?: () => T;
  dispose?: () => void;
  loading?: () => boolean;
  error?: () => any;
  latest?: () => any;
};
type Setter<T = any> = (next: T | ((previous: T) => T)) => T;
type SignalTuple<T = any> = [Accessor<T>, Setter<T>];
type MaybeAccessor<T = any> = T | (() => T);
interface SignalOptions<T = any> {
  equals?: false | Equality<T>;
}
interface EffectOptions {
  defer?: boolean;
  priority?: number;
}
interface MemoOptions<T = any> extends SignalOptions<T> {
  defer?: boolean;
}
interface DevtoolsHook {
  emit?: (type: string, payload: any) => void;
}
interface OwnerNode {
  type: string;
  parent?: OwnerNode | null;
  owner?: OwnerNode | null;
  owned: any[];
  cleanups: Array<() => void>;
  disposed: boolean;
  errorHandler: ((error: any) => void) | null;
  [key: string]: any;
}
interface ReactiveSource {
  observers?: Set<Computation> | null;
  equals?: Equality<any>;
}
interface Computation extends OwnerNode {
  id: number;
  fn: (value: any) => any;
  owner: OwnerNode | null;
  sources: Set<ReactiveSource>;
  observers: Set<Computation> | null;
  queued: boolean;
  running: boolean;
  state: number;
  initialized: boolean;
  value: any;
  priority: number;
  equals: Equality<any>;
  dispose: () => void;
}
interface ResourceAccessor<T = any> extends Accessor<T | undefined> {
  loading: () => boolean;
  error: () => any;
  latest: () => T | undefined;
}
interface ResourceControls<T = any> {
  state: any;
  mutate: (value: T | ((previous: T | undefined) => T)) => void;
  reload: (value?: any) => Promise<T>;
  refetch: (value?: any) => Promise<T>;
}
declare global {
  interface Window {
    __SIGNAL_DEVTOOLS__?: DevtoolsHook;
  }
}
/**
 * 访问给定值，如果该值是访问器函数则执行它，否则直接返回原值。
 *
 * @param {*} value - 需要访问的值，可能是一个普通值或一个无参的访问器函数。
 * @returns {*} 如果 value 是访问器函数，则返回其执行结果；否则返回 value 本身。
 */
declare function access<T = any>(value: MaybeAccessor<T>): T;
/**
 * 获取当前的 Owner 对象。
 *
 * @returns {Object} 返回全局或模块作用域中的 Owner 变量。
 */
declare function getOwner(): OwnerNode | null;
declare function createSignal<T = any>(initial: T, options?: SignalOptions<T>): SignalTuple<T>;
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
declare function createEffect(fn: (value?: any) => any, options?: EffectOptions): Computation;
/**
 * 创建计算型副作用。
 *
 * 这是 createEffect 的语义别名，适合表达只用于计算同步的 effect。
 *
 * @param {Function} fn - 计算函数。
 * @param {Object} [options={}] - 计算配置。
 * @returns {Object} 可 dispose 的计算节点。
 */
declare function createComputed(fn: (value?: any) => any, options?: EffectOptions): Computation;
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
declare function createMemo<T = any>(fn: (previous?: T) => T, initial?: any, options?: any): Accessor<T>;
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
declare function createWatch<T>(source: MaybeAccessor<T> | Array<MaybeAccessor<T>>, fn: (next: T | T[], previous: T | T[] | undefined) => void, options?: EffectOptions): Computation;
/**
 * 创建选择器函数，用于快速判断某个 key 是否等于当前选中值。
 *
 * 常用于列表项选中状态，只让匹配项和取消匹配项更新。
 *
 * @param {Function|*} source - 当前选中值或其访问器。
 * @param {Function} [equals=Object.is] - key 比较函数。
 * @returns {Function} 接收 key 并返回是否匹配的函数。
 */
declare function createSelector<T = any>(source: MaybeAccessor<T>, equals?: (a: any, b: any) => boolean): (key: T) => boolean;
/**
 * 批量执行多次状态更新。
 *
 * batch 内的更新会推迟队列刷新，直到最外层 batch 结束后统一调度。
 *
 * @param {Function} fn - 批处理函数。
 * @returns {*} fn 的返回值。
 */
declare function batch<T = any>(fn: () => T): T;
/**
 * 在不收集依赖的环境中执行函数。
 *
 * 适合在 effect/watch 中读取辅助状态，但不希望这些读取触发重跑。
 *
 * @param {Function} fn - 要执行的函数。
 * @returns {*} fn 的返回值。
 */
declare function untrack<T = any>(fn: () => T): T;
/**
 * 同步刷新普通 effect 队列。
 *
 * 如果传入函数，会先在 batch 中执行该函数，再立即刷新普通队列。
 *
 * @param {Function} [fn] - 可选的同步更新函数。
 * @returns {*} fn 的返回值。
 */
declare function flushSync<T = any>(fn?: () => T): T | undefined;
/**
 * 在 transition 上下文中执行低优先级更新。
 *
 * transition 内被触发的计算会进入 transition 队列，稍后在空闲时刷新。
 *
 * @param {Function} fn - transition 回调。
 * @returns {*} fn 的返回值。
 */
declare function startTransition<T = any>(fn: () => T): T;
declare function onCleanup<T extends () => void>(fn: T): T;
/**
 * 注册销毁回调。
 *
 * 这是 onCleanup 的语义别名，用于表达资源释放意图。
 *
 * @param {Function} fn - 销毁回调。
 * @returns {Function} 原始回调。
 */
declare function onDispose<T extends () => void>(fn: T): T;
/**
 * 在当前同步执行结束后的微任务中运行挂载回调。
 *
 * 回调会尝试恢复创建它时的 Owner 上下文，若 owner 已销毁则不会执行。
 *
 * @param {Function} fn - 挂载回调。
 * @returns {void}
 */
declare function onMount(fn: () => void): void;
/**
 * 创建一个可手动 dispose 的响应式作用域。
 *
 * 作用域可用于将若干 effect、memo 和清理函数绑定到同一个生命周期。
 *
 * @param {Function} [fn] - 创建作用域后立即执行的函数。
 * @returns {Object} 包含 result、dispose 和 run 的作用域对象。
 */
declare function createScope<T = any>(fn?: () => T): {
  result: T | undefined;
  dispose: () => void;
  run: <R = any>(fn: () => R) => R | undefined;
};
/**
 * 创建响应式根作用域。
 *
 * 根作用域不依赖外层组件系统，适合手动挂载一组响应式资源并返回 dispose。
 *
 * @param {Function} fn - 根作用域回调，接收 dispose 函数。
 * @returns {*} fn 的返回值；如果返回 undefined，则返回默认作用域控制对象。
 */
declare function createRoot<T = any>(fn: (dispose: () => void) => T): any;
declare function createErrorBoundary(fn: () => void, fallback?: any): {
  error: Accessor<any>;
  fallback: any;
  hasError: () => boolean;
  reset: () => void;
  dispose: () => void;
};
/**
 * 立即执行函数并捕获同步错误。
 *
 * 与 createErrorBoundary 不同，它不创建响应式作用域，只处理当前调用栈里的异常。
 *
 * @param {Function} fn - 需要保护执行的函数。
 * @param {*|Function} fallback - 错误发生时返回的值或错误映射函数。
 * @returns {*} fn 的结果或 fallback 结果。
 */
declare function catchError<T = any>(fn: () => T, fallback: T | ((error: any) => T)): T;
/**
 * 深度解包 store proxy，生成普通对象或数组快照。
 *
 * 使用 WeakMap 处理循环引用，避免递归死循环。
 *
 * @param {*} value - 需要解包的值。
 * @param {WeakMap} [seen=new WeakMap()] - 循环引用缓存。
 * @returns {*} 解包后的普通值。
 */
declare function unwrap<T = any>(value: T, seen?: WeakMap<object, any>): any;
/**
 * 创建 store 当前状态的普通对象快照。
 *
 * @param {*} value - store、数组或普通值。
 * @returns {*} 解包后的快照。
 */
declare function snapshot<T = any>(value: T): any;
/**
 * 创建浅层响应式 store。
 *
 * 只有第一层属性会被代理；嵌套对象保持原样。
 *
 * @param {Object|Array} [target={}] - 初始对象或数组。
 * @returns {*} 响应式 store proxy。
 */
declare function createStore<T extends object = Record<string, any>>(target?: T): T;
/**
 * 创建深层响应式 store。
 *
 * 嵌套对象和数组会在读取时懒代理。
 *
 * @param {Object|Array} [target={}] - 初始对象或数组。
 * @returns {*} 深层响应式 store proxy。
 */
declare function createDeepStore<T extends object = Record<string, any>>(target?: T): T;
/**
 * 创建深层只读 store。
 *
 * 读取仍会被追踪，但写入、删除和数组变异会被阻止。
 *
 * @param {Object|Array} [target={}] - 初始对象或数组。
 * @returns {*} 只读 store proxy。
 */
declare function createReadonly<T extends object = Record<string, any>>(target?: T): Readonly<T>;
/**
 * 在 batch 中对 store 执行可变更新。
 *
 * 该函数不会复制数据，只是把多次写入合并为一次刷新时机。
 *
 * @param {*} store - 需要更新的 store。
 * @param {Function} recipe - 直接修改 store 的函数。
 * @returns {*} 原 store。
 */
declare function produce<T>(store: T, recipe: (store: T) => void): T;
declare function createResource<T = any>(source: any, fetcher?: any, options?: any): [ResourceAccessor<T>, ResourceControls<T>];
/**
 * 创建简单的 suspense memo。
 *
 * 当 fn 抛出 Promise 时返回 fallback，并在 Promise settle 后触发重新计算。
 *
 * @param {Function} fn - 可能抛出 Promise 的读取函数。
 * @param {*|Function} fallback - pending 时返回的兜底值或访问器。
 * @returns {Function} memo 读取函数。
 */
declare function createSuspense<T = any>(fn: () => T, fallback: MaybeAccessor<T>): Accessor<T>;
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
declare function insert(parent: Node, value: any, marker?: Node | null): () => void;
/**
 * 渲染内容到容器中。
 *
 * 渲染前会清空容器，并在新的 root 作用域中建立响应式 DOM 更新。
 *
 * @param {*} value - 可渲染值或访问器。
 * @param {Element} container - DOM 容器。
 * @returns {Function} root dispose 函数。
 */
declare function render(value: any, container: Element): any;
/**
 * 将文本节点内容绑定到 signal。
 *
 * @param {Element} el - 目标元素。
 * @param {*|Function} signal - 文本值或访问器。
 * @returns {Object} effect 计算节点。
 */
declare function bindText(el: Element, signal: MaybeAccessor<any>): Computation;
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
declare function bindAttr(el: Element, name: string, signal: MaybeAccessor<any>): Computation;
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
declare function bindStyle(el: any, name: string | Record<string, any>, signal?: MaybeAccessor<any>): Computation;
/**
 * 根据 signal 切换元素 class。
 *
 * @param {Element} el - 目标元素。
 * @param {string} name - class 名称。
 * @param {*|Function} signal - 布尔值或访问器。
 * @returns {Object} effect 计算节点。
 */
declare function bindClass(el: Element, name: string, signal: MaybeAccessor<any>): Computation;
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
declare function bindShow(el: HTMLElement | SVGElement, signal: MaybeAccessor<any>, display?: string): Computation;
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
declare function bindIf(anchor: Node, condition: MaybeAccessor<any>, factory: () => any): () => void;
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
declare function bindList(anchor: Node, listSignal: MaybeAccessor<any[]>, renderItem: (item: any, index: Accessor<number>, itemAccessor: Accessor<any>) => any, options?: any): () => void;
/**
 * 创建基于单个属性的列表 key 函数。
 *
 * @param {string} property - 用作 key 的属性名。
 * @returns {Function} key 提取函数。
 */
declare function createListKey(property: string): (item: any) => any;
/**
 * 创建组合属性 key 函数。
 *
 * 多个属性值会用下划线连接，适合复合主键场景。
 *
 * @param {...string} properties - 参与组合的属性名。
 * @returns {Function} key 提取函数。
 */
declare function createCompositeKey(...properties: string[]): (item: any) => string;
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
declare function h(type: string | ((props: any) => any), props?: any, ...children: any[]): any;
/**
 * JSX classic runtime 使用的 createElement 别名。
 */
declare const createElement: typeof h;
/**
 * JSX Fragment 组件。
 *
 * @param {Object} [props={}] - Fragment props。
 * @returns {*} children 或空数组。
 */
declare function Fragment(props?: {
  children?: any;
}): any;
/**
 * 将 HTML 字符串解析为 DOM 节点。
 *
 * @param {string} markup - HTML 字符串。
 * @returns {Node|Node[]} 单个节点或节点数组。
 */
declare function html(markup: any): Node | Node[];
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
declare function jsx(type: any, props?: any, key?: any): any;
/**
 * JSX automatic runtime 的多 children 入口。
 */
declare const jsxs: typeof jsx;
/**
 * JSX development runtime 入口。
 */
declare const jsxDEV: typeof jsx;
/**
 * 条件渲染组件。
 *
 * 返回一个访问器，由 insert 或 JSX runtime 在后续渲染中消费。
 *
 * @param {Object} props - Show 参数。
 * @returns {Function} 可渲染访问器。
 */
declare function Show(props: {
  when: MaybeAccessor<any>;
  children?: any;
  fallback?: any;
}): Accessor<any>;
/**
 * 列表渲染组件。
 *
 * 内部通过 bindList 维护 keyed DOM 记录。
 *
 * @param {Object} props - For 参数。
 * @returns {DocumentFragment} 包含列表锚点的片段。
 */
declare function For(props: {
  each: MaybeAccessor<any[]>;
  children?: any;
  key?: (item: any, index: number) => any;
  fallback?: any;
}): DocumentFragment;
//#endregion
export { Accessor, EffectOptions, For, Fragment, MaybeAccessor, MemoOptions, Setter, Show, SignalOptions, SignalTuple, access, batch, bindAttr, bindClass, bindIf, bindList, bindShow, bindStyle, bindText, catchError, createCompositeKey, createComputed, createDeepStore, createEffect, createElement, createErrorBoundary, createListKey, createMemo, createReadonly, createResource, createRoot, createScope, createSelector, createSignal, createStore, createSuspense, createWatch, flushSync, getOwner, h, html, insert, jsx, jsxDEV, jsxs, onCleanup, onDispose, onMount, produce, render, snapshot, startTransition, untrack, unwrap };