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
  p5: s => s.run('R2', 'en', 'conf t', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1'),
  p6: s => s.run('SW2', 'en', 'conf t', 'vlan 30', 'name DESIGN', 'end'),
  p7: s => s.run('R1', 'en', 'conf t', 'int g0/1', 'no ip address', 'int g0/2', 'ip address 192.168.40.1 255.255.255.0'),
  p8: s => s.run('SW1', 'en', 'conf t', 'int g0/1', 'switchport trunk native vlan 1'),
  p9: s => s.run('R1', 'en', 'conf t', 'interface g0/0.20', 'encapsulation dot1Q 20'),
  p10: s => s.run('R1', 'en', 'conf t', 'no ip route 172.16.50.128 255.255.255.128 10.0.0.3')
};
const P = id => PUZ.find(p => p.id === id);
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

// ---------- Day 2 ----------
t('every puzzle has a day, unique id and num, and a dated day', () => {
  const ids = new Set(PUZ.map(p => p.id)), nums = new Set(PUZ.map(p => p.num));
  assert.strictEqual(ids.size, PUZ.length); assert.strictEqual(nums.size, PUZ.length);
  PUZ.forEach(p => { assert.ok(PUZ.DAYS[p.day], p.id + ' has no date'); assert.ok(p.hints.length === 3 && p.objectives.length >= 2, p.id); });
});
t('"still" objectives pass at the start (they guard against breaking something else)', () => {
  PUZ.forEach(p => { const s = setup(p), ok = objOk(s.net, p); p.objectives.forEach((o, i) => { if (/still/.test(o.text)) assert.ok(ok[i], p.id + ': ' + o.text); }); });
});
t('p6 port in deleted VLAN shows inactive; trunk drops VLAN 30', () => {
  const s = setup(P('p6'));
  const st = text(s.sh.SW2.exec('show interfaces status')); assert.ok(/Fa0\/1\s+inactive\s+30/.test(st), st);
  const sw = text(s.sh.SW2.exec('show interfaces switchport')); assert.ok(/Access Mode VLAN: 30 \(Inactive\)/.test(sw), sw);
  const vb = text(s.sh.SW2.exec('show vlan brief')); assert.ok(!/Fa0\/1/.test(vb), vb);
  const tr = text(s.sh.SW2.exec('show interfaces trunk')); assert.ok(/active in management domain\nGi0\/1\s+1,10$/m.test(tr), tr);
  const r = s.net.ping('Design-PC', '192.168.30.50'); assert.strictEqual(r.kind, 'arp'); assert.strictEqual(r.at, 'Design-PC');
});
t('p6 after fix the port is connected again', () => { const s = setup(P('p6')); FIXES.p6(s); assert.ok(/Fa0\/1\s+connected\s+30/.test(text(s.sh.SW2.exec('show interfaces status')))); });
t('p7 overlap is rejected until the old address is removed', () => {
  const s = setup(P('p7')); const r = s.run('R1', 'en', 'conf t', 'int g0/2', 'ip address 192.168.40.1 255.255.255.0');
  assert.ok(/overlaps with GigabitEthernet0\/1/.test(text(r[3])), text(r[3])); assert.ok(!objOk(s.net, P('p7'))[0]);
});
t('p7 clues: brief shows Gi0/1 down with the address; CDP shows switch on Gi0/2', () => {
  const s = setup(P('p7')); s.run('R1', 'en');
  const b = text(s.sh.R1.exec('show ip interface brief'));
  assert.ok(/GigabitEthernet0\/1\s+192\.168\.40\.1\s+YES manual down\s+down/.test(b), b);
  assert.ok(/GigabitEthernet0\/2\s+unassigned\s+YES unset\s+up\s+up/.test(b), b);
  const c = text(s.sh.R1.exec('show cdp neighbors')); assert.ok(/^SW1\s+Gig 0\/2\s+\d+\s+S I\s+WS-C2960\s+Gig 0\/1$/m.test(c), c);
  assert.ok(!/Mail-Server/.test(c), 'hosts do not speak CDP');
});
t('p8 native mismatch reported on both switches with the IOS log format', () => {
  const s = setup(P('p8')); const m = s.net.nativeMismatches();
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0].line, '%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on GigabitEthernet0/1 (10), with SW2 GigabitEthernet0/1 (1).');
  assert.strictEqual(m[1].dev, 'SW2');
  FIXES.p8(s); assert.strictEqual(s.net.nativeMismatches().length, 0);
});
t('p8 VLAN 10 from SW1 lands in VLAN 1 on SW2', () => {
  const s = setup(P('p8')); const r = s.net.ping('Staff-PC1', '192.168.10.12');
  assert.strictEqual(r.kind, 'arp'); assert.deepStrictEqual(r.fwd.hops.map(h => h.from + '>' + h.to), ['Staff-PC1>SW1', 'SW1>SW2']);
  const tr = text(s.sh.SW1.exec('show interfaces trunk')); assert.ok(/Gi0\/1\s+on\s+802\.1q\s+trunking\s+10$/m.test(tr), tr);
});
t('p8 alt: matching native 10 on SW2, or `no switchport trunk native vlan` on SW1', () => {
  let s = setup(P('p8')); s.run('SW2', 'en', 'conf t', 'int g0/1', 'sw tr nat vl 10'); assert.ok(objOk(s.net, P('p8')).every(Boolean));
  s = setup(P('p8')); s.run('SW1', 'en', 'conf t', 'int g0/1', 'no switchport trunk native vlan'); assert.ok(objOk(s.net, P('p8')).every(Boolean));
});
t('p9 subinterfaces: prompt, ordering, show run, routing table', () => {
  const s = setup(P('p9')); s.run('R1', 'en');
  const b = text(s.sh.R1.exec('sh ip int br')).split('\n').map(l => l.split(/\s+/)[0]);
  assert.deepStrictEqual(b.slice(1), ['GigabitEthernet0/0', 'GigabitEthernet0/0.10', 'GigabitEthernet0/0.20', 'GigabitEthernet0/1', 'GigabitEthernet0/2']);
  assert.ok(/interface GigabitEthernet0\/0\.20\n encapsulation dot1Q 30\n ip address 192\.168\.20\.1 255\.255\.255\.0/.test(text(s.sh.R1.exec('show run'))));
  assert.ok(/C\s+192\.168\.20\.0\/24 is directly connected, GigabitEthernet0\/0\.20/.test(text(s.sh.R1.exec('show ip route'))));
  s.run('R1', 'conf t', 'int g0/0.20'); assert.strictEqual(s.sh.R1.prompt(), 'R1(config-subif)#');
  s.run('R1', 'exit', 'int g0/0'); assert.strictEqual(s.sh.R1.prompt(), 'R1(config-if)#');
  assert.ok(/Invalid input/.test(text(s.sh.R1.exec('encapsulation dot1Q 20'))), 'encapsulation only on subinterfaces');
});
t('p9 failure: R1 tags printer traffic for VLAN 30 and SW1 drops it', () => {
  const s = setup(P('p9')); const r = s.net.ping('Office-PC', '192.168.20.30');
  assert.strictEqual(r.stage, 'request'); assert.strictEqual(r.kind, 'arp'); assert.strictEqual(r.at, 'R1');
  assert.ok(!s.net.ping('Laser-Printer', '192.168.20.1').ok, 'printer cannot reach its gateway either');
});
t('p9 new subinterface needs encapsulation before an address', () => {
  const s = setup(P('p9')); const r = s.run('R1', 'en', 'conf t', 'int g0/0.40', 'ip address 192.168.40.1 255.255.255.0');
  assert.ok(/only allowed if that subinterface is already/.test(text(r[3])), text(r[3]));
  const r2 = s.run('R1', 'encapsulation dot1q 40', 'ip address 192.168.40.1 255.255.255.0');
  assert.ok(!r2.some(x => x.lines.length), r2.map(text).join('|'));
  assert.ok(/GigabitEthernet0\/0\.40\s+192\.168\.40\.1/.test(text(s.sh.R1.exec('do sh ip int br'))));
});
t('p9 two subinterfaces cannot share a VLAN tag', () => {
  const s = setup(P('p9')); const r = s.run('R1', 'en', 'conf t', 'int g0/0.20', 'encapsulation dot1Q 10');
  assert.ok(/same VID \(10\) is not permitted/.test(text(r[3])), text(r[3]));
  assert.ok(/encapsulation dot1Q 30/.test(text(s.sh.R1.exec('do show run'))));
});
t('p9 fixed: TTL shows one router hop', () => {
  const s = setup(P('p9')); FIXES.p9(s); s.net.ping('Office-PC', '192.168.20.30');
  assert.ok(/TTL=127/.test(text(s.sh['Office-PC'].exec('ping 192.168.20.30'))));
});
t('p10 longest match: /25 wins for .200, /24 for .10', () => {
  const s = setup(P('p10'));
  const r = s.net.ping('Ops-PC', '172.16.50.200'); assert.strictEqual(r.at, 'R1'); assert.strictEqual(r.kind, 'arp'); assert.strictEqual(r.nh, '10.0.0.3');
  assert.deepStrictEqual(s.net.tracert('Ops-PC', '172.16.50.200').rows, ['192.168.1.1']);
  assert.deepStrictEqual(s.net.tracert('Ops-PC', '172.16.50.10').rows, ['192.168.1.1', '10.0.0.2', '172.16.50.10']);
  const rt = text(s.sh.R1.exec('show ip route'));
  assert.ok(/S\s+172\.16\.50\.0\/24 \[1\/0\] via 10\.0\.0\.2/.test(rt) && /S\s+172\.16\.50\.128\/25 \[1\/0\] via 10\.0\.0\.3/.test(rt), rt);
});
t('p10 alt: re-pointing the /25 at R2 also works', () => {
  const s = setup(P('p10')); s.run('R1', 'en', 'conf t', 'no ip route 172.16.50.128 255.255.255.128 10.0.0.3', 'ip route 172.16.50.128 255.255.255.128 10.0.0.2');
  assert.ok(objOk(s.net, P('p10')).every(Boolean));
});

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
