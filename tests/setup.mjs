// Atrapa localStorage, żeby moduły aplikacji działały w Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() };
globalThis.document = globalThis.document || { addEventListener() {}, documentElement: { dataset: {} } };
globalThis.window = globalThis.window || globalThis;
