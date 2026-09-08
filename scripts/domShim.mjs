/**
 * Minimal browser storage shims, preloaded via `node --import` so they are in
 * place before the test bundle executes.
 *
 * A plain side-effect `import` inside the bundle is not reliable here: zustand's
 * persist middleware resolves its storage once, when the store module is first
 * evaluated, and caches the failure. Node 22 also ships a `localStorage` global
 * that exists but throws unless the process was started with a backing file, so
 * an "is it defined" check is not enough either.
 */
const make = () => {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
};

for (const name of ['localStorage', 'sessionStorage']) {
  try {
    Object.defineProperty(globalThis, name, { value: make(), configurable: true });
  } catch {
    // Non-configurable in this runtime; leave it alone.
  }
}
