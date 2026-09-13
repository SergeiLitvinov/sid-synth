// Track allocations while building a replacement graph. Constructors can fail
// before returning an object with dispose(); still release their partial nodes.
export function prepareAudio(context) {
  let nodes = new Set();
  const ctx = new Proxy(context, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (nodes && String(key).startsWith('create') && result && typeof result.disconnect === 'function') nodes.add(result);
        return result;
      };
    },
  });
  return {
    ctx,
    commit() { nodes = null; },
    dispose() {
      if (!nodes) return;
      for (const node of nodes) {
        try { if (node.stop) node.stop(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      nodes.clear();
    },
  };
}
