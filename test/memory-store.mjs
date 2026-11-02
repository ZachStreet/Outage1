// Minimal stand-in for a Netlify Blobs store, for local tests.
export function memoryStore() {
  const m = new Map();
  return {
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); return {}; },
    async get(k, o) { if (!m.has(k)) return null; const s = m.get(k); return o && o.type === 'json' ? JSON.parse(s) : s; },
    async list(o) { const p = (o && o.prefix) || ''; return { blobs: [...m.keys()].filter(k => k.startsWith(p)).map(key => ({ key, etag: 'x' })), directories: [] }; },
    _map: m
  };
}
