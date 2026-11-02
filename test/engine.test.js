const assert = require('assert');
const O = require('../src/engine.js');
const PUZ = require('../src/puzzles.js');

let failures = 0;
function t(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); } }

function setup(p) {
  const net = new O.Network(p);
  const sh = {};
  const logs = [];
  Object.keys(net.devices).forEach(n => {
    const d = net.devices[n];
    sh[n] = (d.type === 'router' || d.type === 'switch') ? new O.IOSShell(net, n, (dev, l) => logs.push([dev, l])) : new O.PCShell(net, n);
  });
  return { net, sh, logs, run: (dev, ...cmds) => cmds.map(c => sh[dev].exec(c)) };
}
const objOk = (net, p) => p.objectives.map(o => net.ping(o.from, o.to, { silent: true }).ok);
const text = res => res.lines.map(l => l.s).join('\n');

// ---------- each puzzle: broken at start, fixed after the intended commands ----------
const FIXES = {
  p1: s => s.run('R1', 'enable', 'configure terminal', 'interface g0/0', 'no shutdown'),
  p2: s => s.run('SW1', 'en', 'conf t', 'int fa0/2', 'switchport access vlan 10'),
  p3: s => { const d = s.net.devices['Scanner-PC']; d.gw = '192.168.30.1'; s.net.touch(); },
  p4: s => s.run('SW1', 'en', 'conf t', 'int g0/1', 'switchport trunk allowed vlan add 20'),
  p5: s => s.run('R2', 'en', 'conf t', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1')
};
PUZ.forEach(p => {
  t(p.id + ' starts broken', () => { const s = setup(p); assert.strictEqual(objOk(s.net, p)[0], false); });
  t(p.id + ' fixed by intended commands', () => {
    const s = setup(p); const out = FIXES[p.id](s) || [];
    out.forEach(r => assert.ok(!r.lines.some(l => /Invalid|Incomplete|Ambiguous/.test(l.s)), 'command error: ' + text(r)));
    assert.deepStrictEqual(objOk(s.net, p), p.objectives.map(() => true));
  });
});

// ---------- alternative fixes ----------
t('p4 alt: allowed vlan 10,20', () => { const s = setup(PUZ[3]); s.run('SW1', 'en', 'conf t', 'int gi 0/1', 'sw tr al vl 10,20'); assert.ok(objOk(s.net, PUZ[3]).every(Boolean)); });
t('p4 alt: allowed vlan all', () => { const s = setup(PUZ[3]); s.run('SW1', 'en', 'conf t', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan all'); assert.ok(objOk(s.net, PUZ[3]).every(Boolean)); });
t('p4 wrong: replacing list with 20 breaks staff', () => { const s = setup(PUZ[3]); s.run('SW1', 'en', 'conf t', 'int g0/1', 'switchport trunk allowed vlan 20'); assert.deepStrictEqual(objOk(s.net, PUZ[3]), [true, false]); });
t('p5 alt: default route on R2', () => { const s = setup(PUZ[4]); s.run('R2', 'en', 'conf t', 'ip route 0.0.0.0 0.0.0.0 10.0.0.1'); assert.ok(objOk(s.net, PUZ[4]).every(Boolean)); });
t('p5 wrong next hop is not installed', () => {
  const s = setup(PUZ[4]); s.run('R2', 'en', 'conf t', 'ip route 192.168.1.0 255.255.255.0 10.9.9.9');
  assert.ok(!objOk(s.net, PUZ[4])[0]);
  const r = s.sh.R2.exec('do show ip route'); assert.ok(!/192\.168\.1\.0/.test(text(r)), text(r));
});
t('p2 creating new vlan does not fix', () => { const s = setup(PUZ[1]); const r = s.run('SW1', 'en', 'conf t', 'int f0/2', 'sw acc vl 30'); assert.ok(/Creating vlan 30/.test(text(r[3]))); assert.ok(!objOk(s.net, PUZ[1])[0]); });

// ---------- failure diagnostics ----------
t('p1 failure is ARP for gateway', () => { const s = setup(PUZ[0]); const r = s.net.ping('Reception', '192.168.1.1'); assert.strictEqual(r.stage, 'request'); assert.strictEqual(r.kind, 'arp'); assert.strictEqual(r.nh, '192.168.1.1'); });
t('p5 failure is on the reply at R2', () => { const s = setup(PUZ[4]); const r = s.net.ping('Branch-PC', '172.16.20.10'); assert.strictEqual(r.stage, 'reply'); assert.strictEqual(r.at, 'R2'); assert.strictEqual(r.kind, 'noroute'); });
t('p5 R2 itself can ping app server (the HQ claim)', () => { const s = setup(PUZ[4]); assert.ok(s.net.ping('R2', '172.16.20.10').ok); assert.ok(s.net.ping('R1', '172.16.20.10').ok); });
t('p5 tracert shows hop 1 then timeouts', () => { const s = setup(PUZ[4]); const tr = s.net.tracert('Branch-PC', '172.16.20.10'); assert.deepStrictEqual(tr.rows, ['192.168.1.1', null, null]); assert.strictEqual(tr.done, false); });
t('p5 tracert after fix', () => { const s = setup(PUZ[4]); FIXES.p5(s); const tr = s.net.tracert('Branch-PC', '172.16.20.10'); assert.deepStrictEqual(tr.rows, ['192.168.1.1', '10.0.0.2', '172.16.20.10']); assert.ok(tr.done); });
t('p4 flood dies at SW1', () => { const s = setup(PUZ[3]); const r = s.net.ping('Lab-PC', '192.168.20.100'); assert.strictEqual(r.kind, 'arp'); assert.deepStrictEqual(r.fwd.hops.map(h => h.from + '>' + h.to), ['Lab-PC>SW2', 'SW2>SW1']); });

// ---------- CLI behaviour ----------
t('abbreviations', () => {
  const s = setup(PUZ[0]);
  assert.ok(/GigabitEthernet0\/0\s+192\.168\.1\.1/.test(text(s.sh.R1.exec('sh ip int br'))));
  s.run('R1', 'en'); assert.strictEqual(s.sh.R1.prompt(), 'R1#');
  s.run('R1', 'conf t'); assert.strictEqual(s.sh.R1.prompt(), 'R1(config)#');
  s.run('R1', 'int gig 0/0'); assert.strictEqual(s.sh.R1.prompt(), 'R1(config-if)#');
  assert.strictEqual(s.sh.R1.ifn, 'GigabitEthernet0/0');
});
t('ambiguous "s" in interface mode on a switch', () => { const s = setup(PUZ[1]); s.run('SW1', 'en', 'conf t', 'int fa0/1'); assert.ok(/Ambiguous/.test(text(s.sh.SW1.exec('s')))); });
t('invalid input caret position', () => {
  const s = setup(PUZ[0]); s.run('R1', 'en');
  const r = s.sh.R1.exec('show ip intrface brief');
  assert.strictEqual(r.lines[0].s, ' '.repeat('R1#'.length + 'show ip '.length) + '^');
});
t('unknown single word triggers DNS lookup message', () => { const s = setup(PUZ[0]); assert.ok(/Translating "bogus"/.test(text(s.sh.R1.exec('bogus')))); });
t('incomplete command', () => { const s = setup(PUZ[0]); s.run('R1', 'en'); assert.ok(/Incomplete/.test(text(s.sh.R1.exec('configure')))); });
t('show in config mode needs do', () => {
  const s = setup(PUZ[0]); s.run('R1', 'en', 'conf t');
  assert.ok(/Invalid input/.test(text(s.sh.R1.exec('show ip int br'))));
  assert.ok(/GigabitEthernet0\/0/.test(text(s.sh.R1.exec('do sh ip int br'))));
  assert.strictEqual(s.sh.R1.prompt(), 'R1(config)#');
});
t('no shutdown prints syslog and logs to peer switch', () => {
  const s = setup(PUZ[0]); const r = s.run('R1', 'en', 'conf t', 'int g0/0', 'no sh');
  assert.ok(/%LINK-5-CHANGED: Interface GigabitEthernet0\/0, changed state to up/.test(text(r[3])), text(r[3]));
  assert.ok(/%LINEPROTO-5-UPDOWN/.test(text(r[3])));
  assert.strictEqual(s.logs[0][0], 'SW1');
});
t('help lists options', () => {
  const s = setup(PUZ[0]); s.run('R1', 'en');
  const h = s.sh.R1.help('show ip ').map(l => l.s).join('\n');
  assert.ok(/interface/.test(h) && /route/.test(h), h);
  assert.ok(/configure/.test(s.sh.R1.help('con').map(l => l.s).join(' ')));
});
t('tab completion', () => {
  const s = setup(PUZ[0]); s.run('R1', 'en');
  assert.strictEqual(s.sh.R1.complete('conf'), 'configure ');
  assert.strictEqual(s.sh.R1.complete('sh ip int'), 'sh ip interface ');
  s.run('R1', 'conf t');
  assert.strictEqual(s.sh.R1.complete('int g0/1'), 'int GigabitEthernet0/1 ');
});
t('router ping shows ARP miss then success', () => {
  const s = setup(PUZ[2]); s.run('R1', 'en');
  const a = text(s.sh.R1.exec('ping 172.16.0.50')); assert.ok(/\.!!!!/.test(a) && /80 percent/.test(a), a);
  const b = text(s.sh.R1.exec('ping 172.16.0.50')); assert.ok(/!!!!!/.test(b) && /100 percent/.test(b), b);
});
t('PC ping TTL reflects routers on return path', () => {
  const s = setup(PUZ[4]); FIXES.p5(s);
  const r = text(s.sh['Branch-PC'].exec('ping 172.16.20.10')); assert.ok(/TTL=126/.test(r), r);
  const g = text(s.sh['Branch-PC'].exec('ping 192.168.1.1')); assert.ok(/TTL=255/.test(g), g);
});
t('show vlan brief / trunk / status format', () => {
  const s = setup(PUZ[3]);
  const v = text(s.sh.SW1.exec('show vlan brief')); assert.ok(/^20\s+LAB\s+active\s+Fa0\/2$/m.test(v), v);
  const tr = text(s.sh.SW1.exec('show interfaces trunk')); assert.ok(/Vlans allowed on trunk\nGi0\/1\s+10$/m.test(tr), tr);
  const st = text(s.sh.SW1.exec('sh int status')); assert.ok(/Gi0\/1\s+connected\s+trunk/.test(st), st);
});
t('running-config reflects trunk list', () => { const s = setup(PUZ[3]); s.run('SW1', 'en'); assert.ok(/switchport trunk allowed vlan 10\n/.test(text(s.sh.SW1.exec('sh run')))); });
t('ip address overlap rejected', () => { const s = setup(PUZ[0]); const r = s.run('R1', 'en', 'conf t', 'int g0/2', 'ip address 192.168.1.5 255.255.255.0'); assert.ok(/overlaps with GigabitEthernet0\/0/.test(text(r[3])), text(r[3])); });
t('vlan list helpers', () => { assert.deepStrictEqual(O.parseVlanList('10,20,30-32'), [10, 20, 30, 31, 32]); assert.strictEqual(O.fmtVlans([1, 2, 3, 10, 12, 13]), '1-3,10,12-13'); assert.strictEqual(O.parseVlanList('0'), null); });
t('masks', () => { assert.ok(O.isMask('255.255.255.252')); assert.ok(!O.isMask('255.0.255.0')); assert.ok(O.isMask('0.0.0.0')); });

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
