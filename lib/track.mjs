// Anonymous play tracking: how many people visit each day, how many come back, what they start and fix.
// Each browser sends a random visitor id; only a hash of it is stored, one record per visitor, with no names or IPs.
import { createHash } from 'node:crypto';

const VID_RE = /^[a-f0-9]{32}$/;
const PUZZLE_RE = /^p\d{1,3}$/;
const EVENTS = ['visit', 'start', 'fix'];
const TZ = 'Australia/Brisbane';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
export const visitorKey = vid => 'v/' + createHash('sha256').update(vid).digest('hex').slice(0, 16);
// Days are counted in Brisbane time, so "today" matches the site owner's day.
export const today = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: TZ });

export function summarise(records) {
  const days = {}, puzzles = {};
  let returned = 0;
  for (const r of records) {
    const dates = Object.keys(r.days || {});
    if (dates.length > 1) returned++;
    for (const d of dates) {
      const x = r.days[d], day = days[d] || (days[d] = { date: d, visitors: 0, new: 0, returning: 0, starts: 0, fixes: 0 });
      day.visitors++;
      if (r.first === d) day.new++; else day.returning++;
      day.starts += (x.starts || []).length; day.fixes += (x.fixes || []).length;
      (x.starts || []).forEach(id => { (puzzles[id] = puzzles[id] || { id, starts: 0, fixes: 0 }).starts++; });
      (x.fixes || []).forEach(id => { (puzzles[id] = puzzles[id] || { id, starts: 0, fixes: 0 }).fixes++; });
    }
  }
  return {
    visitors: records.length, returned,
    days: Object.values(days).sort((a, b) => (a.date < b.date ? 1 : -1)),
    puzzles: Object.values(puzzles).sort((a, b) => +a.id.slice(1) - +b.id.slice(1))
  };
}

export function makeTrackHandler(openStore, clock = () => new Date()) {
  return async (req) => {
    const store = openStore();
    if (req.method === 'GET') {
      const { blobs } = await store.list({ prefix: 'v/' });
      const records = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })))).filter(Boolean);
      return json(summarise(records));
    }
    if (req.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);
    let b;
    try { b = await req.json(); } catch (e) { return json({ error: 'Send a JSON object.' }, 400); }
    if (!b || !VID_RE.test(String(b.vid || ''))) return json({ error: 'Bad visitor id.' }, 400);
    if (EVENTS.indexOf(b.event) < 0) return json({ error: 'Unknown event.' }, 400);
    if (b.event !== 'visit' && !PUZZLE_RE.test(String(b.puzzle || ''))) return json({ error: 'Unknown outage.' }, 400);
    const k = visitorKey(b.vid), d = today(clock());
    const rec = (await store.get(k, { type: 'json' })) || { first: d, days: {} };
    const day = rec.days[d] || (rec.days[d] = { visits: 0, starts: [], fixes: [] });
    if (b.event === 'visit') day.visits = Math.min(999, day.visits + 1);
    else {
      const list = b.event === 'start' ? day.starts : day.fixes;
      if (list.indexOf(b.puzzle) < 0 && list.length < 200) list.push(b.puzzle);
    }
    await store.setJSON(k, rec);
    return json({ ok: true });
  };
}
