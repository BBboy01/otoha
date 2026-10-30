const ALL_OPERATIONS = "all";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    value.forEach((item, index) => {
      copy[index] = cloneValue(item, seen);
    });
    return copy;
  }

  const copy = {};
  seen.set(value, copy);
  Object.keys(value).forEach((key) => {
    copy[key] = cloneValue(value[key], seen);
  });
  return copy;
}

function freezeValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.keys(value).forEach((key) => freezeValue(value[key], seen));
  return Object.freeze(value);
}

function snapshot(value) {
  return freezeValue(cloneValue(value));
}

function operationKind(kind) {
  if (typeof kind !== "string" || !kind.trim()) {
    throw new TypeError("operation kind must be a non-empty string");
  }
  return kind;
}

function createRuntimeStore(initialState = {}) {
  if (!isRecord(initialState)) throw new TypeError("initial state must be an object");

  let state = snapshot(initialState);
  let operationSequence = 0;
  const currentOperations = new Map();
  const issuedTokens = new WeakSet();
  const listeners = new Set();

  function getState() {
    return state;
  }

  function notify(nextState, previousState) {
    for (const listener of [...listeners]) listener(nextState, previousState);
  }

  function setState(nextStateOrUpdater) {
    const nextState = typeof nextStateOrUpdater === "function"
      ? nextStateOrUpdater(state)
      : nextStateOrUpdater;
    if (!isRecord(nextState)) throw new TypeError("next state must be an object");
    if (nextState === state) return state;

    const previousState = state;
    state = snapshot(nextState);
    notify(state, previousState);
    return state;
  }

  function updateJob(jobOrUpdater) {
    const patch = typeof jobOrUpdater === "function"
      ? jobOrUpdater(state.job || {})
      : jobOrUpdater;
    if (!isRecord(patch)) throw new TypeError("job update must be an object");
    return setState({ ...state, job: { ...(state.job || {}), ...patch } });
  }

  function begin(kind) {
    const normalizedKind = operationKind(kind);
    const token = Object.freeze({ kind: normalizedKind, id: ++operationSequence });
    issuedTokens.add(token);
    currentOperations.set(normalizedKind, token);
    return token;
  }

  function isCurrent(token) {
    if (!token || typeof token !== "object" || !issuedTokens.has(token)) return false;
    const current = currentOperations.get(token.kind);
    return current === token;
  }

  function invalidate(kind = ALL_OPERATIONS) {
    if (kind === ALL_OPERATIONS || kind === undefined) {
      currentOperations.clear();
      return;
    }
    currentOperations.delete(operationKind(kind));
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    begin,
    getState,
    invalidate,
    isCurrent,
    setState,
    subscribe,
    updateJob,
  };
}

module.exports = { createRuntimeStore };
