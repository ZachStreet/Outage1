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
import { makeTrackHandler } from '../lib/track.mjs';
import { memoryStore } from './memory-store.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = process.argv[2];
const html = fs.readFileSync(path.join(dir, '..', 'public', 'index.html'));
const store = memoryStore();
const handler = makeHandler(() => store);
const trackStore = memoryStore();
const tracker = makeTrackHandler(() => trackStore);
const PORT = 8767, BASE = `http://localhost:${PORT}/`;

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/scores') || req.url.startsWith('/api/track')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await (req.url.startsWith('/api/track') ? tracker : handler)(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) }));
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
  p10: [['R1', ['en', 'conf t', 'no ip route 172.16.50.128 255.255.255.128 10.0.0.3']]],
  p11: [['SW1', ['en', 'conf t', 'int fa0/6', 'speed auto', 'duplex auto']]],
  p12: [['R2', ['en', 'conf t', 'int g0/1', 'ip address 10.0.0.2 255.255.255.252']]],
  p13: [['SW1', ['en', 'conf t', 'int fa0/3', 'no switchport port-security mac-address sticky 54bf.6403.91e2', 'shutdown', 'no shutdown']]],
  p14: [['SW2', ['en', 'conf t', 'int g0/1', 'switchport mode trunk']]],
  p15: [['R2', ['en', 'conf t', 'no ip route 172.16.30.0 255.255.255.0 10.0.12.1', 'ip route 172.16.30.0 255.255.255.0 10.0.23.2']]],
  p16: [['SW1', ['en', 'conf t', 'int fa0/5', 'no spanning-tree portfast', 'spanning-tree bpduguard disable', 'shutdown', 'no shutdown']]],
  p17: [['R1', ['en', 'conf t', 'access-list 10 permit 192.168.20.0 0.0.0.255']]],
  p18: [['R1', ['en', 'conf t', 'access-list 110 permit tcp any host 10.20.0.10 eq www']]],
  p19: [['R1', ['en', 'conf t', 'ip access-list extended GUEST-IN', 'no 20', '5 permit ip 192.168.50.0 0.0.0.255 host 10.30.0.40']]],
  p20: [['R1', ['en', 'conf t', 'no access-list 15', 'access-list 15 permit 192.168.99.0 0.0.0.255']]],
  p21: [['R1', ['en', 'conf t', 'no ip dhcp excluded-address 192.168.10.1 192.168.10.254', 'ip dhcp excluded-address 192.168.10.1 192.168.10.20']], ['New-Laptop', ['ipconfig /renew']]],
  p22: [['CORE', ['en', 'conf t', 'interface vlan 20', 'no shutdown']]],
  p23: [['R1', ['en', 'conf t', 'int g0/1', 'ip helper-address 10.1.1.5']], ['Laptop', ['ipconfig /renew']]],
  p24: [['R1', ['en', 'conf t', 'ip dhcp pool LAB', 'default-router 192.168.30.1']], ['Lab-Laptop', ['ipconfig /renew']]],
  p25: [['CORE', ['en', 'conf t', 'interface vlan 30', 'no ip address', 'interface vlan 40', 'ip address 192.168.30.1 255.255.255.0', 'no shutdown']]],
  p26: [['R2', ['en', 'conf t', 'router ospf 1', 'network 192.168.2.0 0.0.0.255 area 0']]],
  p27: [['R2', ['en', 'conf t', 'router ospf 1', 'no passive-interface g0/1']]],
  p28: [['R2', ['en', 'conf t', 'router ospf 1', 'no network 10.0.12.0 0.0.0.3 area 1', 'network 10.0.12.0 0.0.0.3 area 0']]],
  p29: [['R2', ['en', 'conf t', 'int g0/1', 'no ip ospf hello-interval']]],
  p30: [['R3', ['en', 'conf t', 'router ospf 1', 'no network 10.0.23.0 0.0.0.0 area 0', 'network 10.0.23.0 0.0.0.3 area 0']]],
  p31: [['R1', ['en', 'conf t', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'end', 'copy running-config startup-config']]],
  p32: [['R1', ['en', 'conf t', 'int g0/0', 'ip nat inside']]],
  p33: [['R1', ['en', 'conf t', 'access-list 1 permit 192.168.10.0 0.0.0.255']]],
  p34: [['R1', ['en', 'conf t', 'no ip nat inside source static 192.168.10.80 203.0.113.10', 'ip nat inside source static 192.168.10.50 203.0.113.10']]],
  p35: [['R1', ['en', 'conf t', 'router ospf 1', 'default-information originate']]],
  p36: [['SW1', ['en', 'conf t', 'int g0/1', 'speed auto', 'duplex auto']]],
  p37: [['Printer', { ip: { addr: '192.168.10.40' } }]],
  p38: [['R1', ['en', 'conf t', 'int g0/2', 'no ip access-group GUEST out', 'ip access-group GUEST in']]],
  p39: [['R1', ['en', 'conf t', 'no ip route 10.10.0.0 255.255.0.0 10.0.13.30 250', 'ip route 10.10.0.0 255.255.0.0 10.0.13.3 250']]],
  p40: [['R1', ['en', 'conf t', 'no ip route 192.168.2.0 255.255.255.0 10.0.99.2']]],
  p41: [['Reception-PC', { ip: { addr: '192.168.10.21' } }]],
  p42: [['SW1', ['en', 'conf t', 'int g0/1', 'switchport trunk allowed vlan add 30']], ['R1', ['en', 'conf t', 'interface g0/0.30', 'encapsulation dot1Q 30', 'ip address 192.168.30.1 255.255.255.0']]],
  p43: [['R1', ['en', 'conf t', 'ip route 192.168.70.0 255.255.255.0 10.0.12.2']], ['Remote-Laptop', ['ipconfig /renew']]],
  p44: [['SW1', ['en', 'conf t', 'int g0/1', 'switchport trunk native vlan 1']], ['SW2', ['en', 'conf t', 'int g0/1', 'switchport trunk allowed vlan add 20']]],
  p45: [['R2', ['en', 'conf t', 'router ospf 1', 'no passive-interface g0/1']], ['R1', ['en', 'conf t', 'router ospf 1', 'default-information originate']]]
};
const N = Object.keys(FIX).length;
const tab = (page, dev) => page.locator('#tabs .tab').filter({ hasText: new RegExp('^' + dev.replace(/[-]/g, '\\-') + '(router|switch|L3 switch|ISP, read-only|PC|server|printer|camera)$') });
async function solve(page, id, { hint = false } = {}) {
  await page.goto(BASE + '#' + id);
  await page.waitForSelector('#play:not([hidden])');
  if (hint) await page.click('#hint-btn');
  for (const [dev, cmds] of FIX[id]) {
    await tab(page, dev).click();
    if (cmds.ip) {
      await page.click('#seg-ip');
      if (cmds.ip.addr) await page.fill('#ip-addr', cmds.ip.addr);
      if (cmds.ip.gw) await page.fill('#ip-gw', cmds.ip.gw);
      await page.click('#ipset button[type=submit]');
      await page.click('#seg-cmd');
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
const ctx = async o => { const c = await browser.newContext(Object.assign({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } }, o || {})); await c.clock.setFixedTime(new Date('2026-11-13T10:00:00+10:00')); return c; };
const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };
const shot = (p, f, o) => shots ? p.screenshot(Object.assign({ path: path.join(shots, f) }, o || {})) : null;

const a = watch(await (await ctx()).newPage());
await a.goto(BASE);

await t('rack: one switch per day, newest on top, five ports each', async () => {
  assert.deepStrictEqual(await a.$$eval('.unit[data-day]', us => us.map(u => u.dataset.day)), ['9', '8', '7', '6', '5', '4', '3', '2', '1']);
  assert.strictEqual(await a.locator('.rack .port').count(), N);
  assert.match(await a.textContent('.unit[data-day="9"] .u-date'), /Today/);
  assert.match(await a.textContent('#detail'), /Day 9.*Port 1[\s\S]*Fat Fingers/);
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
for (let i = 1; i <= N; i++) {
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

await t('p13: SW1 console shows the port-security violation on open', async () => {
  await a.goto(BASE + '#p13'); await a.waitForSelector('#play:not([hidden])');
  await tab(a, 'SW1').click();
  assert.match(await a.textContent('#screen'), /%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address 54bf\.6411\.2a7c/);
});
await t('p21: DHCP test point runs ipconfig /renew; Use DHCP button works', async () => {
  await a.goto(BASE + '#p21'); await a.waitForSelector('#play:not([hidden])');
  await a.click('#obj li:nth-child(1) button'); await a.waitForTimeout(60);
  assert.match(await a.textContent('#screen'), /unable to contact your DHCP server/);
  assert.match(await a.textContent('#wire-text'), /No DHCP server answered/);
  await tab(a, 'Desk-PC').click(); await a.click('#seg-ip'); await a.click('#ip-dhcp');
  assert.match(await a.textContent('#ip-msg'), /No DHCP server answered/, 'Desk-PC\'s old lease is excluded too');
});
await t('p31: the ISP router refuses enable', async () => {
  await a.goto(BASE + '#p31'); await a.waitForSelector('#play:not([hidden])');
  await tab(a, 'ISP').click(); await a.fill('#cli', 'enable'); await a.press('#cli', 'Enter');
  assert.match(await a.textContent('#screen'), /Access denied/);
});
await t('p18: web and SSH test points run curl and tnc; SSH counts as passing when blocked', async () => {
  await a.goto(BASE + '#p18'); await a.waitForSelector('#play:not([hidden])');
  assert.deepStrictEqual(await a.$$eval('#obj .t-cmd', e => e.map(x => x.textContent)), ['Staff-PC: curl http://10.20.0.10', 'Dev-PC: ping 10.20.0.10', 'Staff-PC: tnc 10.20.0.10 -port 22 should fail']);
  await a.click('#obj li:nth-child(3) button'); await a.waitForTimeout(60);
  assert.match(await a.getAttribute('#obj li:nth-child(3) .led', 'class'), /led-g/);
  assert.match(await a.textContent('#wire-text'), /Blocked, as it should be/);
  await a.click('#obj li:nth-child(1) button'); await a.waitForTimeout(60);
  assert.match(await a.textContent('#screen'), /curl: \(28\) Failed to connect/);
  assert.match(await a.getAttribute('#obj li:nth-child(1) .led', 'class'), /led-r/);
});

// Player 1 fixes everything. The first win asks for a name; later wins post automatically.
await t(`player 1 fixes all ${N} outages through the UI`, async () => {
  for (let i = 1; i <= N; i++) {
    const id = 'p' + i;
    await solve(a, id);
    if (i === 1) { await a.fill('#post-name', 'Zach'); await a.click('#post-form button[type=submit]'); }
    await a.waitForSelector('#post-see');
    if (i === 8) await shot(a, 'win-p8.png');
    const next = await a.isVisible('#win-next');
    assert.strictEqual(next, i < N, id + ' next button');
  }
});
await t('rack shows every day fixed', async () => {
  await a.goto(BASE); await a.waitForSelector('.unit');
  assert.deepStrictEqual(await a.$$eval('.unit[data-day] .u-count', e => e.map(x => x.textContent)), Array(9).fill('5/5 up'));
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
  assert.strictEqual(rows[0][1], 'Zach'); assert.strictEqual(rows[0][2], `${N}/${N}`); assert.strictEqual(rows[1][2], `1/${N}`);
  assert.deepStrictEqual(await b.$$eval('table.lb thead th small', e => e.map(x => x.textContent)), ['Day 9', 'Day 8', 'Day 7', 'Day 6', 'Day 5', 'Day 4', 'Day 3', 'Day 2', 'Day 1']);
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
await t('stats page counts visitors, starts and fixes', async () => {
  await b.goto(BASE + '#stats');
  await b.waitForSelector('.stat-tiles');
  assert.ok(await b.isVisible('#stats') && /XP/.test(await b.textContent('#stats')), 'header stats stay visible');
  const tiles = await b.$$eval('.stat-tiles .lcd', e => e.map(x => x.textContent));
  assert.ok(+tiles[0] >= 2, tiles.join(','));
  const p1 = await b.$$eval('#stats-body table:last-of-type tbody tr', rs => rs.map(r => Array.from(r.cells).map(c => c.textContent)).find(c => /Lights Out/.test(c[0])));
  assert.ok(p1 && +p1[2] >= 1, String(p1));
  await shot(b, 'stats.png', { fullPage: true });
});
await t('phone, dark mode: no sideways scroll on home, a map or the board', async () => {
  const m = watch(await (await ctx({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage());
  for (const h of ['', '#p9', '#p19', '#leaderboard', '#stats']) {
    await m.goto(BASE + h); await m.waitForTimeout(150);
    assert.strictEqual(await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, h || 'home');
  }
  await m.goto(BASE); await m.waitForTimeout(150); await shot(m, 'home-phone-dark.png', { fullPage: true });
});
await t('no page errors', async () => { assert.deepStrictEqual(errors, []); });

await browser.close(); server.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
