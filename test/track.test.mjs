import assert from 'node:assert';
import { makeTrackHandler, today, visitorKey } from '../lib/track.mjs';
import { memoryStore } from './memory-store.mjs';

const store = memoryStore();
let now = new Date('2026-11-07T01:00:00Z');
const handler = makeTrackHandler(() => store, () => now);
const post = b => handler(new Request('http://x/api/track', { method: 'POST', body: JSON.stringify(b) }));
const get = async () => (await handler(new Request('http://x/api/track'))).json();
const A = 'a'.repeat(32), B = 'b'.repeat(32);
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + e.message); } };

await t('days are Brisbane dates', () => { assert.strictEqual(today(new Date('2026-11-06T15:30:00Z')), '2026-11-07'); assert.strictEqual(today(new Date('2026-11-06T13:30:00Z')), '2026-11-06'); });
await t('visits, starts and fixes are recorded once per outage per day', async () => {
  for (const b of [{ vid: A, event: 'visit' }, { vid: A, event: 'start', puzzle: 'p11' }, { vid: A, event: 'start', puzzle: 'p11' }, { vid: A, event: 'fix', puzzle: 'p11' }, { vid: B, event: 'visit' }])
    assert.strictEqual((await post(b)).status, 200);
  const s = await get();
  assert.strictEqual(s.visitors, 2); assert.strictEqual(s.returned, 0);
  assert.deepStrictEqual(s.days[0], { date: '2026-11-07', visitors: 2, new: 2, returning: 0, starts: 1, fixes: 1 });
  assert.deepStrictEqual(s.puzzles, [{ id: 'p11', starts: 1, fixes: 1 }]);
});
await t('a visit on a later day counts as returning', async () => {
  now = new Date('2026-11-08T02:00:00Z');
  await post({ vid: A, event: 'visit' });
  const s = await get();
  assert.strictEqual(s.returned, 1);
  assert.deepStrictEqual(s.days.map(d => [d.date, d.new, d.returning]), [['2026-11-08', 0, 1], ['2026-11-07', 2, 0]]);
});
await t('only a hash of the visitor id is stored', async () => {
  const keys = (await store.list({ prefix: 'v/' })).blobs.map(b => b.key);
  assert.ok(keys.indexOf(visitorKey(A)) >= 0 && !keys.some(k => k.indexOf(A) >= 0));
});
await t('validation', async () => {
  for (const b of [{}, { vid: 'zz', event: 'visit' }, { vid: A, event: 'hack' }, { vid: A, event: 'start' }, { vid: A, event: 'fix', puzzle: 'x1' }])
    assert.strictEqual((await post(b)).status, 400, JSON.stringify(b));
  assert.strictEqual((await handler(new Request('http://x/api/track', { method: 'DELETE' }))).status, 405);
});

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
