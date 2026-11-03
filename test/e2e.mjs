// Browser test on a local stand-in for Netlify (static page + /api/scores on an in-memory store).
// Solves all ten outages through the real UI, posts runs, and checks the rack, map labels and leaderboard.
// Run: npm run build && node test/e2e.mjs [screenshot-dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeHandler } from '../lib/board.mjs';
import { memoryStore } from './memory-store.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = process.argv[2];
const html = fs.readFileSync(path.join(dir, '..', 'public', 'index.html'));
const store = memoryStore();
const handler = makeHandler(() => store);
const PORT = 8767, BASE = `http://localhost:${PORT}/`;

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/scores')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handler(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } else { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
}).listen(PORT);

// How each outage is fixed from the UI. ip = set a host's IP settings instead of typing commands.
const FIX = {
  p1: [['R1', ['en', 'conf t', 'int g0/0', 'no sh']]],
  p2: [['SW1', ['en', 'conf t', 'int fa0/2', 'sw acc vl 10']]],
  p3: [['Scanner-PC', { ip: { gw: '192.168.30.1' } }]],
  p4: [['SW1', ['en', 'conf t', 'int g0/1', 'sw tr al vl add 20']]],
  p5: [['R2', ['en', 'conf t', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1']]],
  p6: [['SW2', ['en', 'conf t', 'vlan 30', 'name DESIGN', 'end']]],
  p7: [['R1', ['en', 'conf t', 'int g0/1', 'no ip address', 'int g0/2', 'ip address 192.168.40.1 255.255.255.0']]],
  p8: [['SW1', ['en', 'conf t', 'int g0/1', 'sw tr nat vl 1']]],
  p9: [['R1', ['en', 'conf t', 'interface g0/0.20', 'encapsulation dot1Q 20']]],
  p10: [['R1', ['en', 'conf t', 'no ip route 172.16.50.128 255.255.255.128 10.0.0.3']]]
};
const tab = (page, dev) => page.locator('#tabs .tab').filter({ hasText: new RegExp('^' + dev.replace(/[-]/g, '\\-') + '(router|switch|PC|server|printer|camera)$') });
async function solve(page, id, { hint = false } = {}) {
  await page.goto(BASE + '#' + id);
  await page.waitForSelector('#play:not([hidden])');
  if (hint) await page.click('#hint-btn');
  for (const [dev, cmds] of FIX[id]) {
    await tab(page, dev).click();
    if (cmds.ip) {
      await page.click('#seg-ip'); await page.fill('#ip-gw', cmds.ip.gw); await page.click('#ipset button[type=submit]');
      continue;
    }
    for (const c of cmds) { await page.fill('#cli', c); await page.press('#cli', 'Enter'); }
  }
  const n = await page.locator('#obj li').count();
  for (let i = 1; i <= n; i++) { await page.click(`#obj li:nth-child(${i}) button`); await page.waitForTimeout(60); }
  await page.waitForSelector('#overlay:not([hidden])', { timeout: 4000 });
}
// Every text label on the map must clear every other label, device, name tape and port light.
const overlaps = page => page.evaluate(() => {
  const R = el => el.getBoundingClientRect(), items = [];
  document.querySelectorAll('#topo text.c-port, #topo text.c-net, #topo text.g-sub').forEach(t => items.push({ k: 'text', n: t.textContent, r: R(t) }));
  document.querySelectorAll('#topo .dev').forEach(g => {
    g.querySelectorAll('.g-body, .g-screen, .g-hole').forEach(x => items.push({ k: 'device', n: g.dataset.dev, r: R(x) }));
    items.push({ k: 'tape', n: g.dataset.dev, r: R(g.querySelector('.g-tape')) });
  });
  document.querySelectorAll('#topo .c-led').forEach(c => items.push({ k: 'led', n: c.querySelector('title').textContent, r: R(c) }));
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const bad = [];
  items.forEach((a, i) => { if (a.k === 'text') items.forEach((b, j) => { if (j !== i && !(b.k === 'text' && j < i) && hit(a.r, b.r)) bad.push(a.n + ' overlaps ' + b.k + ' ' + b.n); }); });
  return bad;
});

let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };
const browser = await chromium.launch();
const errors = [];
const ctx = async o => { const c = await browser.newContext(Object.assign({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } }, o || {})); await c.clock.setFixedTime(new Date('2026-11-03T10:00:00+10:00')); return c; };
const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };
const shot = (p, f, o) => shots ? p.screenshot(Object.assign({ path: path.join(shots, f) }, o || {})) : null;

const a = watch(await (await ctx()).newPage());
await a.goto(BASE);

await t('rack: one switch per day, newest on top, ten ports', async () => {
  assert.deepStrictEqual(await a.$$eval('.unit[data-day]', us => us.map(u => u.dataset.day)), ['2', '1']);
  assert.strictEqual(await a.locator('.rack .port').count(), 10);
  assert.match(await a.textContent('.unit[data-day="2"] .u-date'), /Today/);
  assert.match(await a.textContent('#detail'), /Day 2.*Port 1[\s\S]*Spring Clean/);
  await shot(a, 'home.png', { fullPage: true });
});
await t('rack: picking a Day 1 port updates the detail', async () => {
  await a.click('.port[data-id="p4"]');
  assert.match(await a.textContent('#detail .d-port'), /Day 1.*Port 4/);
  assert.strictEqual(await a.getAttribute('.port[data-id="p4"]', 'aria-pressed'), 'true');
});
await t('rack scrolls when it holds more than fits', async () => {
  const m = await a.$eval('#rack', r => ({ sh: r.scrollHeight, ch: r.clientHeight, oy: getComputedStyle(r).overflowY }));
  assert.strictEqual(m.oy, 'auto'); assert.ok(m.sh > m.ch, JSON.stringify(m));
});
await t('a day stays hidden until its date', async () => {
  const c = await browser.newContext({ reducedMotion: 'reduce' }); await c.clock.setFixedTime(new Date('2026-11-02T10:00:00+10:00'));
  const p = watch(await c.newPage()); await p.goto(BASE);
  assert.deepStrictEqual(await p.$$eval('.unit[data-day]', us => us.map(u => u.dataset.day)), ['1']);
  await p.goto(BASE + '#p6'); assert.ok(await p.isVisible('#home'), 'future outage opens the panel instead');
  await c.close();
});
for (let i = 1; i <= 10; i++) {
  await t(`p${i}: map labels don't overlap`, async () => {
    await a.goto(BASE + '#p' + i); await a.waitForSelector('#play:not([hidden])');
    assert.deepStrictEqual(await overlaps(a), []);
    if (shots) await a.locator('.map').screenshot({ path: path.join(shots, `map-p${i}.png`) });
  });
}
await t('p8: SW1 console shows the CDP native VLAN mismatch on open', async () => {
  await a.goto(BASE + '#p8'); await a.waitForSelector('#play:not([hidden])');
  await tab(a, 'SW1').click();
  assert.match(await a.textContent('#screen'), /%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet0\/1 \(10\), with SW2 GigabitEthernet0\/1 \(1\)\./);
});
await t('p9: subinterface prompt', async () => {
  await a.goto(BASE + '#p9'); await a.waitForSelector('#play:not([hidden])');
  await tab(a, 'R1').click();
  for (const c of ['en', 'conf t', 'int g0/0.20']) { await a.fill('#cli', c); await a.press('#cli', 'Enter'); }
  assert.strictEqual(await a.textContent('#prompt'), 'R1(config-subif)#');
});

// Player 1 fixes everything. The first win asks for a name; later wins post automatically.
await t('player 1 fixes all ten outages through the UI', async () => {
  for (let i = 1; i <= 10; i++) {
    const id = 'p' + i;
    await solve(a, id);
    if (i === 1) { await a.fill('#post-name', 'Zach'); await a.click('#post-form button[type=submit]'); }
    await a.waitForSelector('#post-see');
    if (i === 8) await shot(a, 'win-p8.png');
    const next = await a.isVisible('#win-next');
    assert.strictEqual(next, i < 10, id + ' next button');
  }
});
await t('rack shows both days fixed', async () => {
  await a.goto(BASE); await a.waitForSelector('.unit');
  assert.deepStrictEqual(await a.$$eval('.unit[data-day] .u-count', e => e.map(x => x.textContent)), ['5/5 up', '5/5 up']);
  assert.strictEqual(await a.locator('.rack .port .led-r').count(), 0);
  assert.match(await a.getAttribute('#brand-led', 'class'), /led-g/);
});

// Player 2: one Day 2 outage with an escalation.
const b = watch(await (await ctx()).newPage());
await t('player 2 posts a Day 2 run with an escalation', async () => {
  await solve(b, 'p6', { hint: true });
  await b.fill('#post-name', 'Matt'); await b.click('#post-form button[type=submit]');
  await b.waitForSelector('#post-see'); await b.click('#post-see'); await b.waitForSelector('table.lb');
});
await t('leaderboard: all days', async () => {
  const rows = await b.$$eval('table.lb tbody tr', rs => rs.map(r => Array.from(r.cells).map(c => c.textContent.trim())));
  assert.strictEqual(rows[0][1], 'Zach'); assert.strictEqual(rows[0][2], '10/10'); assert.strictEqual(rows[1][2], '1/10');
  assert.deepStrictEqual(await b.$$eval('table.lb thead th small', e => e.map(x => x.textContent)), ['Day 2', 'Day 1']);
  await shot(b, 'board-all.png', { fullPage: true });
});
await t('leaderboard: one day, then one outage', async () => {
  await b.click('.btab[data-view="d2"]');
  assert.deepStrictEqual(await b.$$eval('table.lb thead th small', e => e.map(x => x.textContent)), ['1', '2', '3', '4', '5']);
  assert.strictEqual(await b.locator('.btabs-sub .btab').count(), 6);
  await b.click('.btab[data-view="p6"]');
  const rows = await b.$$eval('table.lb tbody tr', rs => rs.map(r => r.querySelector('.who').textContent));
  assert.strictEqual(rows.length, 2); assert.match(await b.textContent('table.lb tbody'), /Colleague/);
  await b.click('.btab[data-view="p10"]');
  assert.deepStrictEqual(await b.$$eval('table.lb tbody tr .who', e => e.map(x => x.textContent)), ['Zach']);
  await b.click('.btab[data-view="d1"]'); await b.click('.btab[data-view="p3"]');
  assert.deepStrictEqual(await b.$$eval('table.lb tbody tr .who', e => e.map(x => x.textContent)), ['Zach']);
  await shot(b, 'board-p3.png', { fullPage: true });
});
await t('phone, dark mode: no sideways scroll on home, a map or the board', async () => {
  const m = watch(await (await ctx({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage());
  for (const h of ['', '#p9', '#leaderboard']) {
    await m.goto(BASE + h); await m.waitForTimeout(150);
    assert.strictEqual(await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, h || 'home');
  }
  await m.goto(BASE); await m.waitForTimeout(150); await shot(m, 'home-phone-dark.png', { fullPage: true });
});
await t('no page errors', async () => { assert.deepStrictEqual(errors, []); });

await browser.close(); server.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
