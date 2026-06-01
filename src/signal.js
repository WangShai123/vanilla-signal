/* ======================================================
 * signal.js
 * A Solid-inspired reactive runtime for browser-first UI.
 *
 * Goals:
 * - No runtime dependency and usable directly as an ES module in browsers.
 * - Fine-grained dependency tracking for signals, memos, effects and stores.
 * - Deep object/array stores that handle SKU-table style nested updates.
 * - DOM helpers plus JSX factory/runtime exports for transformed JSX.
 * ====================================================== */

const DEVTOOLS = typeof window !== "undefined" ? window.__SIGNAL_DEVTOOLS__ || null : null;

const CLEAN = 0;
const STALE = 1;
const ITERATE_KEY = Symbol("iterate");
const STORE_VERSION = Symbol("store-version");
const RAW = Symbol("signal.raw");
const IS_STORE = Symbol("signal.store");

let Listener = null;
let Owner = null;
let batchDepth = 0;
let transitionDepth = 0;
let flushing = false;
let effectFlushPending = false;
let transitionFlushPending = false;
let computationId = 0;

const EFFECT_QUEUE = new Set();
const TRANSITION_QUEUE = new Set();
const resolvedPromise = Promise.resolve();

function emit(type, payload) {
  DEVTOOLS?.emit?.(type, payload);
}

function queueTask(fn) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
  } else {
    resolvedPromise.then(fn);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function isWrappable(value) {
  if (!isObject(value)) return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isAccessor(value) {
  return typeof value === "function";
}

export function access(value) {
  return isAccessor(value) ? value() : value;
}

export function getOwner() {
  return Owner;
}

function createOwner(parent, type = "owner") {
  const owner = {
    type,
    parent,
    owned: [],
    cleanups: [],
    disposed: false,
    errorHandler: null,
  };

  if (parent && !parent.disposed) {
    parent.owned.push(owner);
  }

  return owner;
}

function runWithOwner(owner, fn) {
  if (owner?.disposed) return undefined;

  const prevOwner = Owner;
  Owner = owner;
  try {
    return fn();
  } catch (error) {
    if (!handleError(error, owner)) throw error;
    return undefined;
  } finally {
    Owner = prevOwner;
  }
}

function runCleanups(owner) {
  const cleanups = owner.cleanups.splice(0);
  for (let i = cleanups.length - 1; i >= 0; i--) {
    try {
      cleanups[i]();
    } catch (error) {
      emit("cleanup:error", { owner, error });
      console.error("signal cleanup error:", error);
    }
  }
}

function disposeOwner(owner) {
  if (!owner || owner.disposed) return;
  owner.disposed = true;

  const owned = owner.owned.splice(0);
  for (let i = owned.length - 1; i >= 0; i--) {
    disposeComputation(owned[i]);
  }

  runCleanups(owner);
  detachFromParent(owner);
  emit("owner:dispose", { owner });
}

function detachFromParent(owner) {
  const parent = owner?.parent || owner?.owner;
  if (!parent?.owned) return;

  const index = parent.owned.indexOf(owner);
  if (index >= 0) parent.owned.splice(index, 1);
}

function handleError(error, owner = Owner) {
  let cursor = owner;
  while (cursor) {
    if (typeof cursor.errorHandler === "function") {
      cursor.errorHandler(error);
      return true;
    }
    cursor = cursor.parent;
  }
  emit("error:unhandled", { error });
  return false;
}

function equalsFromOptions(options) {
  if (options.equals === false) return () => false;
  return options.equals || Object.is;
}

function trackSource(source) {
  if (!Listener || Listener.disposed) return;

  if (!source.observers) source.observers = new Set();
  if (!source.observers.has(Listener)) {
    source.observers.add(Listener);
    Listener.sources.add(source);
  }
}

function notifySource(source) {
  if (!source.observers || source.observers.size === 0) return;

  const observers = Array.from(source.observers);
  for (let i = 0; i < observers.length; i++) {
    markStale(observers[i]);
  }
}

function markStale(node) {
  if (!node || node.disposed) return;

  if (node.type === "memo") {
    if (node.state === STALE) return;
    node.state = STALE;
    if (node.observers?.size > 0) runMemo(node);
    return;
  }

  scheduleComputation(node);
}

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

function scheduleEffectFlush() {
  if (batchDepth > 0 || effectFlushPending || flushing) return;
  effectFlushPending = true;
  queueTask(flushEffects);
}

function scheduleTransitionFlush() {
  if (batchDepth > 0 || transitionFlushPending) return;
  transitionFlushPending = true;

  const schedule =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : (callback) => setTimeout(callback, 0);

  schedule(flushTransitions);
}

function drainQueue(queue) {
  const computations = Array.from(queue);
  queue.clear();
  computations.sort((a, b) => b.priority - a.priority || a.id - b.id);
  return computations;
}

function flushEffects() {
  if (flushing) return;

  effectFlushPending = false;
  flushing = true;

  try {
    let guard = 0;
    while (EFFECT_QUEUE.size > 0) {
      if (++guard > 100000) {
        throw new Error("Possible infinite reactive update loop");
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

function cleanupSources(computation) {
  computation.sources.forEach((source) => {
    source.observers?.delete(computation);
  });
  computation.sources.clear();
}

function createComputation(fn, options = {}) {
  const owner = Owner;
  const computation = {
    id: ++computationId,
    type: options.type || "effect",
    fn,
    owner,
    owned: [],
    cleanups: [],
    sources: new Set(),
    observers: options.type === "memo" ? new Set() : null,
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
  emit("computation:dispose", { computation });
}

function runComputation(computation) {
  if (computation.disposed) return computation.value;
  if (computation.running) {
    throw new Error("Circular dependency detected in reactive computation");
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

function disposeOwnedAndCleanups(owner) {
  const owned = owner.owned.splice(0);
  for (let i = owned.length - 1; i >= 0; i--) {
    disposeComputation(owned[i]);
  }
  runCleanups(owner);
}

function runEffect(computation) {
  runComputation(computation);
}

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
    const nextValue = typeof next === "function" ? next(value) : next;
    if (signal.equals(value, nextValue)) return value;

    const previous = value;
    value = nextValue;
    emit("signal:update", { previous, next: nextValue });
    notifySource(signal);
    return value;
  }

  read.peek = () => value;
  read.toJSON = () => value;

  return [read, write];
}

export function createEffect(fn, options = {}) {
  const computation = createComputation(fn, {
    type: "effect",
    priority: options.priority || 0,
  });

  if (options.defer) {
    scheduleComputation(computation);
  } else {
    runEffect(computation);
  }

  return computation;
}

export function createComputed(fn, options = {}) {
  return createEffect(fn, options);
}

export function createMemo(fn, initial, options = {}) {
  if (
    initial &&
    typeof initial === "object" &&
    !Array.isArray(initial) &&
    (Object.prototype.hasOwnProperty.call(initial, "equals") ||
      Object.prototype.hasOwnProperty.call(initial, "defer"))
  ) {
    options = initial;
    initial = undefined;
  }

  const computation = createComputation(fn, {
    type: "memo",
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

export function createSelector(source, equals = Object.is) {
  const selected = createMemo(() => access(source));
  return (key) => equals(selected(), key);
}

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

export function untrack(fn) {
  const prevListener = Listener;
  Listener = null;
  try {
    return fn();
  } finally {
    Listener = prevListener;
  }
}

export function flushSync(fn) {
  const result = fn ? batch(fn) : undefined;
  flushEffects();
  return result;
}

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

export function onDispose(fn) {
  return onCleanup(fn);
}

export function onMount(fn) {
  const owner = Owner;
  queueTask(() => {
    if (!owner || !owner.disposed) runWithOwner(owner, fn);
  });
}

export function createScope(fn) {
  const scope = createOwner(Owner, "scope");
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

export function createRoot(fn) {
  const root = createOwner(Owner, "root");
  const dispose = () => disposeOwner(root);
  const result = runWithOwner(root, () => fn?.(dispose));
  return result === undefined ? { dispose, run: (cb) => runWithOwner(root, cb) } : result;
}

/* ======================
 * Error Boundary
 * ====================== */

export function createErrorBoundary(fn, fallback) {
  const [error, setError] = createSignal(null);
  let scope = null;

  const setup = () => {
    const parent = Owner;
    const boundary = createOwner(parent, "error-boundary");
    boundary.errorHandler = (caught) => {
      setError(caught);
      emit("error-boundary:catch", { error: caught });
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

export function catchError(fn, fallback) {
  try {
    return fn();
  } catch (error) {
    emit("catch-error", { error });
    return typeof fallback === "function" ? fallback(error) : fallback;
  }
}

/* ======================
 * Store
 * ====================== */

const STORE_META = new WeakMap();
const STORE_CACHE = new WeakMap();
const DEEP_STORE_CACHE = new WeakMap();
const READONLY_CACHE = new WeakMap();
const PROXY_TO_RAW = new WeakMap();

function getStoreMeta(target) {
  let meta = STORE_META.get(target);
  if (!meta) {
    meta = { deps: new Map() };
    STORE_META.set(target, meta);
  }
  return meta;
}

function getStoreDep(target, key) {
  const meta = getStoreMeta(target);
  let dep = meta.deps.get(key);
  if (!dep) {
    dep = createSignal(0, { equals: false });
    meta.deps.set(key, dep);
  }
  return dep;
}

function trackKey(target, key) {
  getStoreDep(target, key)[0]();
}

function triggerKey(target, key) {
  const dep = getStoreMeta(target).deps.get(key);
  if (dep) dep[1]((value) => value + 1);
}

function unwrapShallow(value) {
  return PROXY_TO_RAW.get(value) || value;
}

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

export function snapshot(value) {
  return unwrap(value);
}

function isArrayIndex(key) {
  if (typeof key === "symbol") return false;
  const value = String(key);
  if (value === "") return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 4294967295 && String(number) === value;
}

const ARRAY_MUTATORS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

function triggerArrayRange(target, start, end) {
  for (let i = start; i < end; i++) triggerKey(target, String(i));
}

function triggerArrayMutation(target, method, args, oldLength, newLength) {
  const maxLength = Math.max(oldLength, newLength);

  if (method === "push") {
    triggerArrayRange(target, oldLength, newLength);
  } else if (method === "pop") {
    triggerKey(target, String(newLength));
  } else if (method === "splice") {
    const start = Math.max(0, Number(args[0]) || 0);
    triggerArrayRange(target, start, maxLength);
  } else {
    triggerArrayRange(target, 0, maxLength);
  }

  if (oldLength !== newLength) triggerKey(target, "length");
  triggerKey(target, ITERATE_KEY);
  triggerKey(target, STORE_VERSION);
}

function createArrayMethod(target, receiver, key, readonly) {
  const method = Array.prototype[key];

  if (ARRAY_MUTATORS.has(key)) {
    return (...args) => {
      if (readonly) {
        console.warn(`[signal] Cannot call mutating array method "${key}" on readonly store`);
        return key === "sort" || key === "reverse" ? receiver : undefined;
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

function createProxy(target, deep, readonly) {
  target = unwrapShallow(target);
  if (!isWrappable(target)) return target;

  const cache = readonly ? READONLY_CACHE : deep ? DEEP_STORE_CACHE : STORE_CACHE;
  if (cache.has(target)) return cache.get(target);

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      if (key === RAW) return obj;
      if (key === IS_STORE) return true;
      if (key === "__raw") return obj;
      if (key === "__isStore") return true;
      if (key === "__version__") {
        trackKey(obj, STORE_VERSION);
        return getStoreDep(obj, STORE_VERSION)[0]();
      }

      if (Array.isArray(obj) && typeof key === "string" && key in Array.prototype) {
        const value = Reflect.get(obj, key, receiver);
        if (typeof value === "function") {
          return createArrayMethod(obj, receiver, key, readonly);
        }
      }

      if (key === Symbol.iterator) trackKey(obj, ITERATE_KEY);
      if (typeof key !== "symbol") trackKey(obj, key);

      const value = Reflect.get(obj, key, receiver);
      return deep && isWrappable(value) ? createProxy(value, true, readonly) : value;
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
          if (key === "length") {
            const newLength = obj.length;
            triggerArrayRange(obj, newLength, oldLength);
            triggerKey(obj, "length");
            triggerKey(obj, ITERATE_KEY);
          } else if (isArrayIndex(key) && obj.length !== oldLength) {
            triggerKey(obj, "length");
            triggerKey(obj, ITERATE_KEY);
          }
        }
      });

      return result;
    },

    deleteProperty(obj, key) {
      if (readonly) {
        console.warn(`[signal] Cannot delete "${String(key)}" on readonly store`);
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
            triggerKey(obj, "length");
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

export function createStore(target = {}) {
  return createProxy(target, false, false);
}

export function createDeepStore(target = {}) {
  return createProxy(target, true, false);
}

export function createReadonly(target = {}) {
  return createProxy(target, true, true);
}

export function produce(store, recipe) {
  batch(() => recipe(store));
  return store;
}

/* ======================
 * Resource & Suspense
 * ====================== */

export function createResource(source, fetcher, options) {
  if (typeof fetcher !== "function") {
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

  function load(value, refetching = false) {
    const id = ++requestId;
    const delay = options.loadingDelay || 0;

    if (controller) controller.abort();
    controller = typeof AbortController !== "undefined" ? new AbortController() : null;

    state.error = null;
    state.isStale = hasData();
    setLoading(!hasData() || refetching, delay);

    pending = Promise.resolve(
      fetcher(value, {
        value,
        refetching,
        signal: controller?.signal,
      }),
    )
      .then((data) => {
        if (id !== requestId) return state.data;
        clearLoadingTimer();
        state.data = data;
        state.latest = data;
        state.loading = false;
        state.isStale = false;
        return data;
      })
      .catch((error) => {
        if (id !== requestId && error?.name === "AbortError") return state.data;
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
      load(access(source), false);
    });
  } else {
    load(undefined, false);
  }

  function read() {
    if (options.suspense && state.loading && state.data === undefined && pending) {
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
        state.data = typeof value === "function" ? value(state.data) : value;
        state.latest = state.data;
      },
      reload(value) {
        return load(value === undefined && source ? access(source) : value, true);
      },
      refetch(value) {
        return load(value === undefined && source ? access(source) : value, false);
      },
    },
  ];
}

export function createQuery(options) {
  if (typeof options === "function") {
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

  if (typeof queryFn !== "function") {
    throw new TypeError("createQuery requires a queryFn");
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
    status: initialData === undefined ? "pending" : "success",
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
    const delay = typeof value === "function" ? value(attempt) : value;
    return sleepFor(delay || 0);
  }

  async function execute({ force = false } = {}) {
    if (!force && !getEnabled()) return state.data;

    const id = ++requestId;
    const key = getKey();
    controller?.abort?.();
    controller = typeof AbortController !== "undefined" ? new AbortController() : null;

    state.isFetching = true;
    state.isLoading = state.data === undefined || !keepPreviousData;
    state.isPending = state.data === undefined;
    state.isError = false;
    state.error = null;
    state.status = state.data === undefined ? "pending" : "success";

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
        state.status = "success";
        state.updatedAt = Date.now();
        return data;
      } catch (error) {
        if (id !== requestId && error?.name === "AbortError") return state.data;

        const shouldRetry =
          typeof retry === "function" ? retry(attempt, error) : attempt <= Number(retry || 0);

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
          state.status = "error";
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

function sleepFor(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer?.unref?.();
  });
}

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
            () => setVersion((value) => value + 1),
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

function canUseDOM() {
  return typeof document !== "undefined";
}

function isNode(value) {
  return canUseDOM() && value instanceof Node;
}

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

function removeNodes(nodes) {
  nodes.forEach((node) => node.parentNode?.removeChild(node));
}

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

export function render(value, container) {
  container.textContent = "";
  return createRoot((dispose) => {
    const cleanup = insert(container, value);
    onCleanup(cleanup);
    return dispose;
  });
}

export function bindText(el, signal) {
  return createEffect(() => {
    const value = access(signal);
    el.textContent = value == null ? "" : String(value);
  });
}

export function bindAttr(el, name, signal) {
  return createEffect(() => {
    const value = access(signal);
    if (value == null || value === false) {
      el.removeAttribute(name);
    } else if (value === true) {
      el.setAttribute(name, "");
    } else {
      el.setAttribute(name, String(value));
    }
  });
}

export function bindStyle(el, name, signal) {
  if (typeof name === "object") {
    return createEffect(() => setStyle(el, access(name)));
  }

  return createEffect(() => {
    const value = access(signal);
    el.style[name] = value == null ? "" : String(value);
  });
}

export function bindClass(el, name, signal) {
  return createEffect(() => {
    el.classList.toggle(name, !!access(signal));
  });
}

export function bindShow(el, signal, display = "") {
  return createEffect(() => {
    el.style.display = access(signal) ? display : "none";
  });
}

export function bindIf(anchor, condition, factory) {
  const parent = anchor.parentNode;
  const marker = document.createComment("if");
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

function defaultListKey(item, index) {
  const value = access(item);
  if (value && typeof value === "object") {
    if ("id" in value) return value.id;
    if ("key" in value) return value.key;
  }
  return index;
}

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
            nodes = normalizeNodes(renderItem(item, indexAccessor, itemAccessor));
            nodes.forEach((node) => parent.insertBefore(node, anchor));
            onCleanup(() => removeNodes(nodes));
            return rootDispose;
          }),
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

export function createListKey(property) {
  return (item) => access(item)?.[property];
}

export function createCompositeKey(...properties) {
  return (item) => {
    const value = access(item);
    return properties.map((property) => value?.[property]).join("_");
  };
}

/* ======================
 * JSX runtime
 * ====================== */

const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "rect",
  "defs",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "text",
  "tspan",
  "use",
  "symbol",
  "view",
]);

function eventName(prop) {
  if (!/^on[A-Z]/.test(prop) && !/^on[a-z]/.test(prop)) return null;
  return prop.slice(2).toLowerCase();
}

function setStyle(el, value) {
  if (value == null) {
    el.removeAttribute("style");
    return;
  }

  if (typeof value === "string") {
    el.style.cssText = value;
    return;
  }

  Object.keys(value).forEach((name) => {
    const styleValue = access(value[name]);
    el.style[name] = styleValue == null ? "" : String(styleValue);
  });
}

function setClassList(el, value) {
  Object.keys(value || {}).forEach((name) => {
    el.classList.toggle(name, !!access(value[name]));
  });
}

function setRef(ref, el) {
  if (!ref) return;
  if (typeof ref === "function") ref(el);
  else if (typeof ref === "object") ref.current = el;
}

function setProperty(el, name, value) {
  if (name === "children" || name === "key") return;

  if (name === "ref") {
    setRef(value, el);
    return;
  }

  if (name === "class" || name === "className") {
    const next = value == null ? "" : String(value);
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      el.setAttribute("class", next);
    } else {
      el.className = next;
    }
    return;
  }

  if (name === "classList") {
    setClassList(el, value);
    return;
  }

  if (name === "style") {
    setStyle(el, value);
    return;
  }

  const attrName = name === "htmlFor" ? "for" : name;

  if (value == null || value === false) {
    el.removeAttribute(attrName);
    if (name in el && typeof el[name] !== "function") {
      try {
        el[name] = value == null ? "" : false;
      } catch (_) {
        // Ignore readonly DOM properties.
      }
    }
    return;
  }

  if (value === true) {
    el.setAttribute(attrName, "");
    if (name in el) {
      try {
        el[name] = true;
      } catch (_) {
        // Ignore readonly DOM properties.
      }
    }
    return;
  }

  if (name in el && attrName !== "list" && attrName !== "type") {
    try {
      el[name] = value;
      return;
    } catch (_) {
      // Fall through to setAttribute for readonly DOM properties.
    }
  }

  el.setAttribute(attrName, String(value));
}

function applyProp(el, name, value) {
  const event = eventName(name);
  if (event && typeof value === "function") {
    el.addEventListener(event, value);
    onCleanup(() => el.removeEventListener(event, value));
    return;
  }

  if (isAccessor(value) && name !== "ref" && name !== "children" && name !== "key") {
    createEffect(() => setProperty(el, name, value()));
  } else {
    setProperty(el, name, value);
  }
}

function normalizeChildren(props, children) {
  if (children.length > 0) {
    return children.length === 1 ? children[0] : children;
  }
  return props?.children;
}

export function h(type, props, ...children) {
  props = props || {};
  const normalizedChildren = normalizeChildren(props, children);

  if (typeof type === "function") {
    return type({ ...props, children: normalizedChildren });
  }

  const el = SVG_TAGS.has(type)
    ? document.createElementNS("http://www.w3.org/2000/svg", type)
    : document.createElement(type);

  Object.keys(props).forEach((name) => {
    if (name !== "children") applyProp(el, name, props[name]);
  });

  if (normalizedChildren !== undefined) {
    insert(el, normalizedChildren);
  }

  return el;
}

export const createElement = h;

export function Fragment(props = {}) {
  return props.children || [];
}

function isTemplateStrings(value) {
  return Array.isArray(value) && Array.isArray(value.raw);
}

function parseTemplateValue(value) {
  if (isAccessor(value)) {
    const fragment = document.createDocumentFragment();
    const marker = document.createComment("jui-dynamic");
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

  return document.createTextNode(value == null ? "" : String(value));
}

export function html(markup) {
  const template = document.createElement("template");
  template.innerHTML = String(markup || "").trim();
  return template.content.childNodes.length === 1
    ? template.content.firstChild
    : Array.from(template.content.childNodes);
}

function templateToNodes(strings, values) {
  let html = "";
  const attrTokens = new Map();
  const attrNames = new Map();

  for (let i = 0; i < strings.length; i++) {
    html += strings[i];
    if (i < values.length) {
      const before = strings[i];
      const attrMatch = before.match(/([:@A-Za-z_][-:@A-Za-z0-9_.]*)\s*=\s*(['"]?)$/);
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

  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const content = template.content;

  content.querySelectorAll("jui-slot").forEach((slot) => {
    const index = Number(slot.getAttribute("data-jui-slot"));
    slot.replaceWith(parseTemplateValue(values[index]));
  });

  content.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (!attrTokens.has(attr.value)) return;
      const index = attrTokens.get(attr.value);
      node.removeAttribute(attr.name);
      applyProp(node, attrNames.get(index) || attr.name, values[index]);
    });
  });

  return content.childNodes.length === 1 ? content.firstChild : Array.from(content.childNodes);
}

export function jsx(type, props, key) {
  if (isTemplateStrings(type)) {
    return templateToNodes(type, Array.prototype.slice.call(arguments, 1));
  }

  const nextProps = key === undefined ? props : { ...props, key };
  return h(type, nextProps);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export function Show(props) {
  return () => {
    const when = access(props.when);
    if (when) {
      return typeof props.children === "function" ? props.children(when) : props.children;
    }
    return access(props.fallback);
  };
}

export function For(props) {
  const fragment = document.createDocumentFragment();
  const start = document.createComment("for-start");
  const end = document.createComment("for-end");
  fragment.append(start, end);

  bindList(
    end,
    () => access(props.each) || [],
    (item, index, itemAccessor) => {
      if (typeof props.children === "function") {
        return props.children(itemAccessor, index);
      }
      return props.children;
    },
    {
      key: props.key,
      fallback: props.fallback,
    },
  );

  return fragment;
}
