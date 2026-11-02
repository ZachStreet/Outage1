// Leaderboard logic, kept separate from the Netlify wrapper so it can be tested with an in-memory store.
// Storage: one JSON record per player at players/<publicId>.
// A player proves who they are with a private random key kept in their browser; the public id is a hash of it,
// so nobody can overwrite someone else's times by reading the leaderboard.
import { createHash } from 'node:crypto';

// Outage ids look like p1, p2 ... p999, so new puzzles need no server change.
const PUZZLE_RE = /^p\d{1,3}$/;
const NAME_RE = /^[\p{L}\p{N} ._'-]{1,20}$/u;
const KEY_RE = /^[a-f0-9]{32,64}$/;
const RANGES = { time: [3, 86400], commands: [1, 5000], escalations: [0, 3], tests: [1, 1000] };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
export const publicId = key => createHash('sha256').update(key).digest('hex').slice(0, 16);
export const cleanName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
// Lower is better: fastest time, then fewest escalations, then fewest commands.
export const compareRuns = (a, b) => (a.time - b.time) || (a.escalations - b.escalations) || (a.commands - b.commands);

function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'Send a JSON object.' };
  if (!KEY_RE.test(String(body.key || ''))) return { error: 'Missing or malformed player key.' };
  const name = cleanName(body.name);
  if (!NAME_RE.test(name)) return { error: 'Names are 1 to 20 letters, numbers, spaces or . _ \' -' };
  if (body.puzzle === undefined) return { name, rename: true };
  if (!PUZZLE_RE.test(String(body.puzzle))) return { error: 'Unknown outage.' };
  const run = {};
  for (const [field, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(body[field]);
    if (!Number.isInteger(v) || v < lo || v > hi) return { error: `${field} must be a whole number from ${lo} to ${hi}.` };
    run[field] = v;
  }
  return { name, puzzle: body.puzzle, run };
}

export function makeHandler(openStore) {
  return async (req) => {
    const store = openStore();
    if (req.method === 'GET') {
      const { blobs } = await store.list({ prefix: 'players/' });
      const records = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      const players = records.filter(Boolean).map(p => ({ id: p.id, name: p.name, runs: p.runs || {}, updated: p.updated }));
      return json({ players });
    }
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'Send a JSON object.' }, 400); }
      const v = validate(body);
      if (v.error) return json({ error: v.error }, 400);
      const id = publicId(body.key), k = 'players/' + id, now = new Date().toISOString();
      const rec = (await store.get(k, { type: 'json' })) || { id, name: v.name, runs: {}, created: now };
      rec.name = v.name;
      rec.updated = now;
      let best = false;
      if (!v.rename) {
        const run = Object.assign({}, v.run, { at: now });
        const old = rec.runs[v.puzzle];
        best = !old || compareRuns(run, old) < 0;
        rec.runs[v.puzzle] = Object.assign(best ? run : old, { plays: ((old && old.plays) || 0) + 1 });
      }
      await store.setJSON(k, rec);
      return json({ ok: true, id, name: rec.name, best, run: v.rename ? null : rec.runs[v.puzzle] });
    }
    return json({ error: 'Use GET or POST.' }, 405);
  };
}
