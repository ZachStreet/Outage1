import assert from 'node:assert';
import { makeHandler, publicId } from '../lib/board.mjs';
import { memoryStore } from './memory-store.mjs';

const store = memoryStore();
const handler = makeHandler(() => store);
const post = b => handler(new Request('http://x/api/scores', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }));
const get = async () => (await handler(new Request('http://x/api/scores'))).json();
const A = 'a'.repeat(32), B = 'b'.repeat(32);
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + e.message); } };

await t('first run is stored as best', async () => {
  const r = await post({ key: A, name: 'Zach', puzzle: 'p1', time: 120, commands: 9, escalations: 1, tests: 3 });
  assert.strictEqual(r.status, 200);
  const d = await r.json();
  assert.ok(d.best); assert.strictEqual(d.id, publicId(A)); assert.strictEqual(d.run.plays, 1);
});
await t('slower run keeps best, counts the play', async () => {
  const d = await (await post({ key: A, name: 'Zach', puzzle: 'p1', time: 300, commands: 4, escalations: 0, tests: 2 })).json();
  assert.ok(!d.best); assert.strictEqual(d.run.time, 120); assert.strictEqual(d.run.plays, 2);
});
await t('faster run replaces best', async () => {
  const d = await (await post({ key: A, name: 'Zach', puzzle: 'p1', time: 90, commands: 7, escalations: 0, tests: 2 })).json();
  assert.ok(d.best); assert.strictEqual(d.run.time, 90); assert.strictEqual(d.run.plays, 3);
});
await t('tie on time is broken by escalations then commands', async () => {
  await post({ key: A, name: 'Zach', puzzle: 'p2', time: 60, commands: 9, escalations: 1, tests: 2 });
  const d = await (await post({ key: A, name: 'Zach', puzzle: 'p2', time: 60, commands: 12, escalations: 0, tests: 2 })).json();
  assert.ok(d.best);
});
await t('second player and GET shape hides private keys', async () => {
  await post({ key: B, name: 'Matt', puzzle: 'p1', time: 75, commands: 6, escalations: 0, tests: 2 });
  const d = await get();
  assert.strictEqual(d.players.length, 2);
  assert.ok(!JSON.stringify(d).includes(A) && !JSON.stringify(d).includes(B), 'private key leaked');
  const z = d.players.find(p => p.name === 'Zach');
  assert.strictEqual(z.runs.p1.time, 90); assert.strictEqual(z.runs.p2.commands, 12);
});
await t('rename without a run', async () => {
  const d = await (await post({ key: B, name: '  Matt   M ' })).json();
  assert.strictEqual(d.name, 'Matt M');
  assert.strictEqual((await get()).players.find(p => p.id === publicId(B)).runs.p1.time, 75);
});
await t('validation', async () => {
  const bad = [
    { name: 'x', puzzle: 'p1', time: 50, commands: 3, escalations: 0, tests: 1 },
    { key: 'zz', name: 'x', puzzle: 'p1', time: 50, commands: 3, escalations: 0, tests: 1 },
    { key: A, name: '<script>', puzzle: 'p1', time: 50, commands: 3, escalations: 0, tests: 1 },
    { key: A, name: 'a'.repeat(21), puzzle: 'p1', time: 50, commands: 3, escalations: 0, tests: 1 },
    { key: A, name: 'Zach', puzzle: 'x1', time: 50, commands: 3, escalations: 0, tests: 1 },
    { key: A, name: 'Zach', puzzle: 'p1234', time: 50, commands: 3, escalations: 0, tests: 1 },
    { key: A, name: 'Zach', puzzle: 'p1', time: 1, commands: 3, escalations: 0, tests: 1 },
    { key: A, name: 'Zach', puzzle: 'p1', time: 50, commands: 3, escalations: 4, tests: 1 },
    { key: A, name: 'Zach', puzzle: 'p1', time: 50.5, commands: 3, escalations: 0, tests: 1 }
  ];
  for (const b of bad) assert.strictEqual((await post(b)).status, 400, JSON.stringify(b));
  const r = await handler(new Request('http://x/api/scores', { method: 'POST', body: 'not json' }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await handler(new Request('http://x/api/scores', { method: 'DELETE' }))).status, 405);
});
await t('unicode names allowed', async () => { assert.strictEqual((await post({ key: 'c'.repeat(32), name: 'Zoë O\'Neil' })).status, 200); });

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
