/* Outage puzzle definitions. */
(function (root) {
  'use strict';
  const port = o => Object.assign({ mode: 'access', vlan: 1, shutdown: false, allowed: 'all', native: 1 }, o || {});
  function sw(x, y, role, vlans, ports) {
    const all = {};
    for (let i = 1; i <= 6; i++) all['FastEthernet0/' + i] = port();
    for (let i = 1; i <= 2; i++) all['GigabitEthernet0/' + i] = port();
    Object.keys(ports || {}).forEach(k => { all[k] = port(ports[k]); });
    return { type: 'switch', x, y, role, vlans: vlans || { 1: 'default' }, ports: all };
  }
  function rt(x, y, role, ifaces, routes) {
    const all = {};
    for (let i = 0; i <= 2; i++) all['GigabitEthernet0/' + i] = { ip: null, mask: null, shutdown: true };
    Object.keys(ifaces).forEach(k => { all[k] = Object.assign({ ip: null, mask: null, shutdown: false }, ifaces[k]); });
    return { type: 'router', x, y, role, ifaces: all, routes: routes || [] };
  }
  const host = (type, x, y, ip, mask, gw, more) => Object.assign({ type, x, y, ip, mask, gw }, more || {});
  const ANY = { addr: '0.0.0.0', wc: '255.255.255.255' };
  const net = (addr, wc) => ({ addr, wc });
  const H = addr => ({ addr, wc: '0.0.0.0' });
  const M30 = '255.255.255.252';
  const G = n => 'GigabitEthernet0/' + n, F = n => 'FastEthernet0/' + n, F0 = 'FastEthernet0';
  // A layer-3 switch: a switch with SVIs (gateway interfaces named Vlan10 and so on) and ip routing on.
  function l3sw(x, y, role, vlans, ports, svis, extra) {
    const d = sw(x, y, role, vlans, ports);
    d.l3 = true; d.ipRouting = true; d.ifaces = {};
    Object.keys(svis || {}).forEach(v => { d.ifaces['Vlan' + v] = Object.assign({ ip: null, mask: null, shutdown: false }, svis[v]); });
    return Object.assign(d, extra || {});
  }
  // DHCP clients: one with no lease yet (Windows gives itself a 169.254 address), and one holding a lease.
  const apipa = (type, x, y, ip, more) => host(type, x, y, ip, '255.255.0.0', null, Object.assign({ dhcp: true, apipa: true }, more || {}));
  const leased = (type, x, y, ip, mask, gw, server, sid, more) => host(type, x, y, ip, mask, gw, Object.assign({ dhcp: true, lease: server, leaseIP: sid }, more || {}));
  const ospf = (rid, networks, passive) => ({ pid: 1, rid, networks: networks.map(([n, wc, area]) => ({ net: n, wc, area })), passive: passive || [] });
  // Day 7's internet edge: office LAN, R1 doing PAT, an ISP router you can look at but not change, and a web server.
  function edge(o) {
    const g0 = Object.assign({ ip: '192.168.10.1', mask: M24, natIn: true, description: 'Office LAN' }, o.g0 || {});
    if (!g0.natIn) delete g0.natIn;
    const R1 = Object.assign(rt(480, 200, 'Edge', { [G(0)]: g0, [G(1)]: { ip: '203.0.113.2', mask: o.shop ? '255.255.255.248' : M30, natOut: true, description: 'ISP' } },
      o.routes || [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '203.0.113.1' }]), {
      acls: { 1: { type: 'std', entries: [{ seq: 10, action: 'permit', src: net(o.acl || '192.168.10.0', '0.0.0.255') }] } },
      nat: { pat: [{ acl: '1', ifn: G(1) }], statics: o.shop ? [{ local: '192.168.10.80', global: '203.0.113.10' }] : [] }
    });
    const d = {
      'Office-PC': host('pc', 90, 110, '192.168.10.21', M24, '192.168.10.1'),
      'Office-PC2': host('pc', 90, 290, '192.168.10.22', M24, '192.168.10.1'),
      SW1: sw(280, 200, 'Office'),
      R1,
      ISP: Object.assign(rt(680, 200, 'Provider', Object.assign({ [G(0)]: { ip: '203.0.113.1', mask: o.shop ? '255.255.255.248' : M30 }, [G(1)]: { ip: '198.51.100.1', mask: M24 } }, o.shop ? { [G(2)]: { ip: '192.0.2.1', mask: M24 } } : {}),
        o.shop ? [{ net: '203.0.113.8', mask: '255.255.255.248', nh: '203.0.113.2' }] : []), { locked: true }),
      Web: host('server', 845, 110, '198.51.100.10', M24, '198.51.100.1', { services: [80], site: 'example.net' })
    };
    if (o.shop) {
      d['Shop-Server'] = host('server', 90, 290, '192.168.10.50', M24, '192.168.10.1', { services: [80], site: 'Shop' });
      delete d['Office-PC2'];
      d.Customer = host('pc', 845, 290, '192.0.2.77', M24, '192.0.2.1');
    }
    return d;
  }
  const edgeLinks = o => [link(o && o.shop ? 'Shop-Server' : 'Office-PC2', F0, 'SW1', F(2)), link('Office-PC', F0, 'SW1', F(1)), link('SW1', G(1), 'R1', G(0)), link('R1', G(1), 'ISP', G(0)), link('ISP', G(1), 'Web', F0)].concat(o && o.shop ? [link('ISP', G(2), 'Customer', F0)] : []);
  const edgeLabels = () => [{ x: 280, y: 52, t: '192.168.10.0/24' }, { x: 580, y: 120, t: 'Public' }, { x: 760, y: 45, t: 'Internet' }];
  // Day 7 and 9: HQ edge router running OSPF with a branch router.
  function edgeOspf(o) {
    return {
      'Branch-PC': host('pc', 70, 200, '192.168.20.21', M24, '192.168.20.1'),
      R2: Object.assign(rt(235, 200, 'Branch', { [G(0)]: { ip: '192.168.20.1', mask: M24 }, [G(1)]: { ip: '10.0.12.2', mask: M30 } }),
        { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 0], ['192.168.20.0', '0.0.0.255', 0]], o.passiveWan ? [G(0), G(1)] : [G(0)]) }),
      'HQ-PC': host('pc', 445, 62, '192.168.10.21', M24, '192.168.10.1'),
      R1: Object.assign(rt(445, 200, 'HQ edge', {
        [G(0)]: { ip: '192.168.10.1', mask: M24, natIn: true, description: 'HQ LAN' },
        [G(2)]: { ip: '10.0.12.1', mask: M30, natIn: true, description: 'Branch' },
        [G(1)]: { ip: '203.0.113.2', mask: M30, natOut: true, description: 'ISP' }
      }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '203.0.113.1' }]), {
        acls: { 1: { type: 'std', entries: [{ seq: 10, action: 'permit', src: net('192.168.0.0', '0.0.255.255') }] } },
        nat: { pat: [{ acl: '1', ifn: G(1) }], statics: [] },
        ospf: ospf('1.1.1.1', [['192.168.10.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)])
      }),
      ISP: Object.assign(rt(650, 200, 'Provider', { [G(0)]: { ip: '203.0.113.1', mask: M30 }, [G(1)]: { ip: '198.51.100.1', mask: M24 } }), { locked: true }),
      Web: host('server', 835, 200, '198.51.100.10', M24, '198.51.100.1', { services: [80], site: 'example.net' })
    };
  }
  const edgeOspfLinks = () => [link('Branch-PC', F0, 'R2', G(0)), link('R2', G(1), 'R1', G(2)), link('HQ-PC', F0, 'R1', G(0)), link('R1', G(1), 'ISP', G(0)), link('ISP', G(1), 'Web', F0)];
  const edgeOspfLabels = () => [{ x: 150, y: 120, t: 'Branch' }, { x: 340, y: 290, t: 'OSPF area 0' }, { x: 745, y: 120, t: 'Internet' }];
  const link = (a, ai, b, bi) => ({ a, ai, b, bi });
  const M24 = '255.255.255.0';

  // Each day is one switch in the rack. A day appears on its date (the player's local time), so you can add days in advance.
  const DAYS = { 1: '2026-11-02', 2: '2026-11-03', 3: '2026-11-07', 4: '2026-11-08', 5: '2026-11-09', 6: '2026-11-10', 7: '2026-11-11', 8: '2026-11-12', 9: '2026-11-13' };

  const PUZZLES = [
    {
      id: 'p1', day: 1, num: 1, diff: 1, title: 'Lights Out', topics: ['Interfaces'],
      teaser: 'Nobody on the office LAN can reach the router.',
      ticket: { id: 'INC-2041', pri: 'P2', opened: '08:12' },
      story: 'A contractor tidied up the office router’s config last night. This morning the front desk can’t load anything, and nobody on the office LAN can reach the web server.',
      start: 'Reception',
      devices: {
        Reception: host('pc', 110, 190, '192.168.1.10', M24, '192.168.1.1'),
        SW1: sw(330, 190, 'Office'),
        R1: rt(560, 190, 'Edge', {
          'GigabitEthernet0/0': { ip: '192.168.1.1', mask: M24, shutdown: true },
          'GigabitEthernet0/1': { ip: '10.10.10.1', mask: M24 }
        }),
        'Web-Server': host('server', 790, 190, '10.10.10.10', M24, '10.10.10.1')
      },
      links: [
        link('Reception', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('SW1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'Web-Server', 'FastEthernet0')
      ],
      labels: [{ x: 330, y: 92, t: '192.168.1.0/24' }, { x: 675, y: 92, t: '10.10.10.0/24' }],
      objectives: [
        { from: 'Reception', to: '192.168.1.1', text: 'Reception can ping its gateway, R1' },
        { from: 'Reception', to: '10.10.10.10', text: 'Reception can reach Web-Server' }
      ],
      hints: [
        'Start at the router. On R1, `show ip interface brief` lists every interface and its state.',
        'GigabitEthernet0/0 says administratively down. A person turned it off with the `shutdown` command.',
        'On R1: `enable`, `configure terminal`, `interface g0/0`, `no shutdown`.'
      ],
      explain: 'An interface can be switched off in software with `shutdown`. "Administratively down" always means someone (or a script) did it on purpose. It is never a cable fault. Router interfaces ship shut down by default, which is why `no shutdown` is one of the first commands every engineer learns.'
    },
    {
      id: 'p2', day: 1, num: 2, diff: 1, title: 'Wrong Room', topics: ['VLANs', 'Access ports'],
      teaser: 'One new starter can’t reach the finance file server.',
      ticket: { id: 'INC-2047', pri: 'P3', opened: '09:40' },
      story: 'New starter Priya sits with the finance team. Her PC can’t open anything on the finance file server, but the rest of Finance is fine. Facilities patched her desk port this morning.',
      start: 'Priya-PC',
      devices: {
        SW1: sw(450, 90, 'Finance floor', { 1: 'default', 10: 'FINANCE', 20: 'GUEST' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 1 }, 'FastEthernet0/3': { vlan: 10 }, 'FastEthernet0/4': { vlan: 20 }
        }),
        'Finance-PC': host('pc', 140, 280, '192.168.10.11', M24, '192.168.10.1'),
        'Priya-PC': host('pc', 345, 280, '192.168.10.12', M24, '192.168.10.1'),
        'File-Server': host('server', 555, 280, '192.168.10.100', M24, '192.168.10.1'),
        'Guest-PC': host('pc', 760, 280, '192.168.20.21', M24, '192.168.20.1')
      },
      links: [
        link('Finance-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Priya-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('File-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/3'),
        link('Guest-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/4')
      ],
      labels: [{ x: 450, y: 362, t: 'Finance: 192.168.10.0/24 · Guest: 192.168.20.0/24' }],
      objectives: [
        { from: 'Priya-PC', to: '192.168.10.100', text: 'Priya-PC can reach File-Server' },
        { from: 'Finance-PC', to: '192.168.10.100', text: 'Finance-PC can still reach File-Server' }
      ],
      hints: [
        'The link lights are green, so the cabling is fine. Compare which VLAN each switch port is in with `show vlan brief` on SW1.',
        'Fa0/2 (Priya) is in VLAN 1. The finance PC and the file server are in VLAN 10.',
        'On SW1: `enable`, `conf t`, `int fa0/2`, `switchport access vlan 10`.'
      ],
      explain: 'A VLAN splits one physical switch into separate virtual switches. Priya’s port sat in the default VLAN 1, so her ARP broadcasts never reached VLAN 10. She was on the same switch and the same subnet, but in a different broadcast domain.'
    },
    {
      id: 'p3', day: 1, num: 3, diff: 2, title: 'Lost Gateway', topics: ['Default gateway', 'ARP'],
      teaser: 'The scanner prints locally but can’t reach head office.',
      ticket: { id: 'INC-2052', pri: 'P2', opened: '06:55' },
      story: 'The warehouse scanner PC still prints labels, but it can’t sync with the inventory server at head office. IT replaced the scanner PC yesterday and set it up by hand.',
      start: 'Scanner-PC',
      devices: {
        'Scanner-PC': host('pc', 110, 115, '192.168.30.20', M24, '192.168.30.254'),
        'Label-Printer': host('printer', 110, 285, '192.168.30.40', M24, '192.168.30.1'),
        SW1: sw(320, 200, 'Warehouse'),
        R1: rt(560, 200, 'Warehouse', {
          'GigabitEthernet0/0': { ip: '192.168.30.1', mask: M24 },
          'GigabitEthernet0/1': { ip: '172.16.0.1', mask: M24 }
        }),
        'Inventory-Server': host('server', 790, 200, '172.16.0.50', M24, '172.16.0.1')
      },
      links: [
        link('Scanner-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Label-Printer', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('SW1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'Inventory-Server', 'FastEthernet0')
      ],
      labels: [{ x: 440, y: 92, t: '192.168.30.0/24' }, { x: 675, y: 92, t: '172.16.0.0/24' }],
      objectives: [
        { from: 'Scanner-PC', to: '172.16.0.50', text: 'Scanner-PC can reach Inventory-Server' },
        { from: 'Scanner-PC', to: '192.168.30.40', text: 'Scanner-PC can still reach Label-Printer' }
      ],
      hints: [
        'Local traffic works and remote traffic doesn’t. Check the PC’s way out: run `ipconfig` on Scanner-PC and compare it with R1’s LAN address.',
        'Scanner-PC’s default gateway is 192.168.30.254. R1’s LAN interface is 192.168.30.1 (`show ip interface brief` on R1).',
        'Open Scanner-PC, switch to IP settings, and set Default gateway to 192.168.30.1.'
      ],
      explain: 'A host sends anything outside its own subnet to its default gateway. If that address doesn’t exist, the ARP request for it goes unanswered and the packet never leaves the LAN, even though local traffic works perfectly.'
    },
    {
      id: 'p4', day: 1, num: 4, diff: 2, title: 'Trunk Trouble', topics: ['Trunks', '802.1Q'],
      teaser: 'Lab machines can’t talk across floors.',
      ticket: { id: 'INC-2060', pri: 'P2', opened: '07:30' },
      story: 'Last night’s change window added a trunk between the Level 1 and Level 2 switches. Staff PCs talk across floors fine. The lab machines on Level 2 can’t reach the lab server downstairs.',
      start: 'Lab-PC',
      devices: {
        SW1: sw(250, 100, 'Level 1', { 1: 'default', 10: 'STAFF', 20: 'LAB' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 20 }, 'GigabitEthernet0/1': { mode: 'trunk', allowed: [10] }
        }),
        SW2: sw(650, 100, 'Level 2', { 1: 'default', 10: 'STAFF', 20: 'LAB' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 20 }, 'GigabitEthernet0/1': { mode: 'trunk' }
        }),
        'Staff-PC1': host('pc', 120, 285, '192.168.10.11', M24, '192.168.10.1'),
        'Lab-Server': host('server', 380, 285, '192.168.20.100', M24, '192.168.20.1'),
        'Staff-PC2': host('pc', 520, 285, '192.168.10.12', M24, '192.168.10.1'),
        'Lab-PC': host('pc', 780, 285, '192.168.20.22', M24, '192.168.20.1')
      },
      links: [
        link('SW1', 'GigabitEthernet0/1', 'SW2', 'GigabitEthernet0/1'),
        link('Staff-PC1', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Lab-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Staff-PC2', 'FastEthernet0', 'SW2', 'FastEthernet0/1'),
        link('Lab-PC', 'FastEthernet0', 'SW2', 'FastEthernet0/2')
      ],
      labels: [{ x: 450, y: 362, t: 'STAFF VLAN 10: 192.168.10.0/24 · LAB VLAN 20: 192.168.20.0/24' }],
      objectives: [
        { from: 'Lab-PC', to: '192.168.20.100', text: 'Lab-PC (Level 2) can reach Lab-Server (Level 1)' },
        { from: 'Staff-PC2', to: '192.168.10.11', text: 'Staff-PC2 can still reach Staff-PC1' }
      ],
      hints: [
        'VLAN 10 crosses between the switches and VLAN 20 doesn’t. Check what the inter-switch link carries: `show interfaces trunk` on both switches.',
        'SW1’s trunk on Gi0/1 only allows VLAN 10. SW2 allows everything.',
        'On SW1: `enable`, `conf t`, `int g0/1`, `switchport trunk allowed vlan add 20`.'
      ],
      explain: 'A trunk carries several VLANs over one cable by tagging each frame with 802.1Q. The allowed list filters which VLANs may cross. This is a classic change-window mistake: `switchport trunk allowed vlan 10` replaces the whole list, while `switchport trunk allowed vlan add 10` appends to it.'
    },
    {
      id: 'p5', day: 1, num: 5, diff: 3, title: 'One-Way Street', topics: ['Static routes', 'Return path'],
      teaser: 'The branch can’t reach the HQ app server.',
      ticket: { id: 'INC-2066', pri: 'P1', opened: '10:05' },
      story: 'Branch users can’t reach the HQ app server. The branch router has a route to HQ. The HQ team says their side is fine because R2 can ping the app server.',
      start: 'Branch-PC',
      devices: {
        'Branch-PC': host('pc', 100, 190, '192.168.1.10', M24, '192.168.1.1'),
        R1: rt(330, 190, 'Branch', {
          'GigabitEthernet0/0': { ip: '192.168.1.1', mask: M24 },
          'GigabitEthernet0/1': { ip: '10.0.0.1', mask: '255.255.255.252' }
        }, [{ net: '172.16.20.0', mask: M24, nh: '10.0.0.2' }]),
        R2: rt(580, 190, 'HQ', {
          'GigabitEthernet0/1': { ip: '10.0.0.2', mask: '255.255.255.252' },
          'GigabitEthernet0/0': { ip: '172.16.20.1', mask: M24 }
        }),
        'App-Server': host('server', 810, 190, '172.16.20.10', M24, '172.16.20.1')
      },
      links: [
        link('Branch-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1'),
        link('R2', 'GigabitEthernet0/0', 'App-Server', 'FastEthernet0')
      ],
      labels: [{ x: 215, y: 92, t: '192.168.1.0/24' }, { x: 455, y: 92, t: '10.0.0.0/30' }, { x: 695, y: 92, t: '172.16.20.0/24' }],
      objectives: [
        { from: 'Branch-PC', to: '172.16.20.10', text: 'Branch-PC can reach App-Server' },
        { from: 'Branch-PC', to: '10.0.0.2', text: 'Branch-PC can ping R2’s WAN interface' }
      ],
      hints: [
        'A ping needs a way there and a way back. R1 knows how to reach HQ. Does R2 know how to reach the branch? Try `tracert 172.16.20.10` on Branch-PC, then `show ip route` on R2.',
        'R2 has no route to 192.168.1.0/24, so every reply to the branch is dropped at R2.',
        'On R2: `enable`, `conf t`, `ip route 192.168.1.0 255.255.255.0 10.0.0.1`.'
      ],
      explain: 'Routing works one direction at a time. Each router only knows its connected networks plus the routes you give it. The request reached the app server fine. The reply died at R2. The HQ team’s test passed because R2 pinged from its own 172.16.20.1 address, which the server can always reply to.'
    },
    // ---------------- Day 2 ----------------
    {
      id: 'p6', day: 2, num: 6, diff: 1, title: 'Spring Clean', topics: ['VLANs', 'VLAN database'],
      teaser: 'The design team can’t print to the plotter. Everyone else can print.',
      ticket: { id: 'INC-2071', pri: 'P3', opened: '08:20' },
      story: 'Overnight, someone tidied up “unused” VLANs on the print room switch. This morning the design team can’t send anything to the plotter, but the office printer next to it works for everyone. Nobody touched a cable.',
      start: 'Design-PC',
      devices: {
        SW1: sw(250, 100, 'Studio', { 1: 'default', 10: 'STAFF', 30: 'DESIGN' }, {
          'FastEthernet0/1': { vlan: 30 }, 'FastEthernet0/2': { vlan: 10 }, 'GigabitEthernet0/1': { mode: 'trunk' }
        }),
        SW2: sw(650, 100, 'Print room', { 1: 'default', 10: 'STAFF' }, {
          'FastEthernet0/1': { vlan: 30 }, 'FastEthernet0/2': { vlan: 10 }, 'GigabitEthernet0/1': { mode: 'trunk' }
        }),
        'Design-PC': host('pc', 120, 285, '192.168.30.21', M24, '192.168.30.1'),
        'Staff-PC': host('pc', 380, 285, '192.168.10.40', M24, '192.168.10.1'),
        Plotter: host('printer', 520, 285, '192.168.30.50', M24, '192.168.30.1'),
        'Office-Printer': host('printer', 780, 285, '192.168.10.60', M24, '192.168.10.1')
      },
      links: [
        link('SW1', 'GigabitEthernet0/1', 'SW2', 'GigabitEthernet0/1'),
        link('Design-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Staff-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Plotter', 'FastEthernet0', 'SW2', 'FastEthernet0/1'),
        link('Office-Printer', 'FastEthernet0', 'SW2', 'FastEthernet0/2')
      ],
      labels: [{ x: 450, y: 372, t: 'STAFF VLAN 10: 192.168.10.0/24 · DESIGN VLAN 30: 192.168.30.0/24' }],
      objectives: [
        { from: 'Design-PC', to: '192.168.30.50', text: 'Design-PC can reach the Plotter' },
        { from: 'Staff-PC', to: '192.168.10.60', text: 'Staff-PC can still reach Office-Printer' }
      ],
      hints: [
        'Both teams cross the same trunk, but only the design VLAN fails. Compare `show vlan brief` on SW1 and SW2.',
        'SW2 has no VLAN 30 any more. Its Fa0/1 still says `switchport access vlan 30` (see `show running-config`), but a port in a VLAN that doesn’t exist is inactive and forwards nothing.',
        'On SW2: `enable`, `conf t`, `vlan 30`, `name DESIGN`.'
      ],
      explain: 'Deleting a VLAN doesn’t touch the ports that use it. They keep `switchport access vlan 30` in their config, vanish from `show vlan brief`, and go inactive. The trunk stops carrying VLAN 30 too, because a switch only forwards VLANs that exist in its own VLAN database. Recreate the VLAN and every port in it comes straight back.'
    },
    {
      id: 'p7', day: 2, num: 7, diff: 1, title: 'Moving Day', topics: ['Interfaces', 'IP addressing', 'CDP'],
      teaser: 'A brand-new router, and nobody can get past the switch.',
      ticket: { id: 'INC-2075', pri: 'P2', opened: '07:45' },
      story: 'The office router died on Friday and a replacement went in over the weekend. The installer pasted the old router’s config onto the new one and checked that every link light was green before leaving. This morning nobody in the office can get past the switch.',
      start: 'Office-PC',
      devices: {
        'Office-PC': host('pc', 100, 120, '192.168.40.21', M24, '192.168.40.1'),
        Kiosk: host('pc', 100, 290, '192.168.40.35', M24, '192.168.40.1'),
        SW1: sw(310, 205, 'Office'),
        R1: rt(555, 205, 'Replacement', {
          'GigabitEthernet0/0': { ip: '10.20.0.1', mask: M24, description: 'Datacentre' },
          'GigabitEthernet0/1': { ip: '192.168.40.1', mask: M24, description: 'Office LAN' },
          'GigabitEthernet0/2': {}
        }),
        'Mail-Server': host('server', 795, 205, '10.20.0.25', M24, '10.20.0.1')
      },
      links: [
        link('Office-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Kiosk', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('SW1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/2'),
        link('R1', 'GigabitEthernet0/0', 'Mail-Server', 'FastEthernet0')
      ],
      labels: [{ x: 310, y: 60, t: '192.168.40.0/24' }, { x: 675, y: 120, t: '10.20.0.0/24' }],
      objectives: [
        { from: 'Office-PC', to: '192.168.40.1', text: 'Office-PC can ping its gateway, R1' },
        { from: 'Office-PC', to: '10.20.0.25', text: 'Office-PC can reach Mail-Server' }
      ],
      hints: [
        'The light on R1’s office link is green, so the cable is fine. Check how R1 is set up with `show ip interface brief`, and which port the switch is really plugged into with `show cdp neighbors`.',
        'The office address 192.168.40.1 is on Gi0/1, which has nothing plugged in. The office switch is cabled to Gi0/2, which has no address.',
        'On R1: `en`, `conf t`, `int g0/1`, `no ip address`, then `int g0/2`, `ip address 192.168.40.1 255.255.255.0`. Take the address off Gi0/1 first, or R1 rejects it as an overlap.'
      ],
      explain: 'A pasted config only works if the interface names line up. The office cable used to be in Gi0/1, but on the new router it went into Gi0/2. `show ip interface brief` gives it away: one interface has the right address but is down/down, next to one that is up/up with no address. A router won’t let two interfaces sit in the same subnet, which is why the address has to come off Gi0/1 first.'
    },
    {
      id: 'p8', day: 2, num: 8, diff: 2, title: 'Native Tongue', topics: ['Trunks', 'Native VLAN', 'CDP'],
      teaser: 'Staff can’t reach the next floor, but the cameras on the same trunk can.',
      ticket: { id: 'INC-2080', pri: 'P2', opened: '09:15' },
      story: 'Last night’s change ticket said “make sure VLAN 10 crosses the new trunk between Level 3 and Level 4”. Since then, staff on Level 3 can’t reach anyone on Level 4. The security cameras use the same trunk and are recording fine, and SW1’s console won’t stop complaining.',
      start: 'Staff-PC1',
      devices: {
        SW1: sw(250, 100, 'Level 3', { 1: 'default', 10: 'STAFF', 20: 'CAMERAS' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 20 }, 'GigabitEthernet0/1': { mode: 'trunk', native: 10 }
        }),
        SW2: sw(650, 100, 'Level 4', { 1: 'default', 10: 'STAFF', 20: 'CAMERAS' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 20 }, 'GigabitEthernet0/1': { mode: 'trunk' }
        }),
        'Staff-PC1': host('pc', 120, 285, '192.168.10.11', M24, '192.168.10.1'),
        'Camera-L3': host('camera', 380, 285, '192.168.20.31', M24, '192.168.20.1'),
        'Staff-PC2': host('pc', 520, 285, '192.168.10.12', M24, '192.168.10.1'),
        NVR: host('server', 780, 285, '192.168.20.50', M24, '192.168.20.1')
      },
      links: [
        link('SW1', 'GigabitEthernet0/1', 'SW2', 'GigabitEthernet0/1'),
        link('Staff-PC1', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Camera-L3', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Staff-PC2', 'FastEthernet0', 'SW2', 'FastEthernet0/1'),
        link('NVR', 'FastEthernet0', 'SW2', 'FastEthernet0/2')
      ],
      labels: [{ x: 450, y: 372, t: 'STAFF VLAN 10: 192.168.10.0/24 · CAMERAS VLAN 20: 192.168.20.0/24' }],
      objectives: [
        { from: 'Staff-PC1', to: '192.168.10.12', text: 'Staff-PC1 (Level 3) can reach Staff-PC2 (Level 4)' },
        { from: 'NVR', to: '192.168.20.31', text: 'NVR can still reach Camera-L3' }
      ],
      hints: [
        'Read SW1’s console before you type anything. That repeating %CDP message is the switch telling you what’s wrong. Then compare `show interfaces trunk` on both switches.',
        'SW1’s native VLAN on the trunk is 10, so it sends VLAN 10 across untagged. SW2’s native VLAN is 1, so it files those frames into VLAN 1. The cameras’ VLAN 20 is tagged, so it’s unaffected.',
        'On SW1: `enable`, `conf t`, `int g0/1`, `switchport trunk native vlan 1`.'
      ],
      explain: 'On an 802.1Q trunk every VLAN is tagged except the native VLAN, which crosses untagged. Each switch puts untagged frames into its own native VLAN, so both ends must agree. Someone typed `native vlan 10` when the ticket meant “allow VLAN 10”. CDP spotted the mismatch and logged it every minute. A native VLAN mismatch also leaks traffic from one VLAN into another, which is why it’s treated as a security problem, not just an outage.'
    },
    {
      id: 'p9', day: 2, num: 9, diff: 2, title: 'One-Armed Router', topics: ['Inter-VLAN routing', 'Subinterfaces'],
      teaser: 'The new printer VLAN is up, and nobody can print to it.',
      ticket: { id: 'INC-2084', pri: 'P2', opened: '13:30' },
      story: 'R1 routes between the office VLANs over a single trunk to SW1, a “router on a stick”. Yesterday a contractor added a VLAN for the new printers. Office PCs still reach each other and R1, but nothing can reach the printers.',
      start: 'Office-PC',
      devices: {
        R1: rt(450, 52, 'Core', {
          'GigabitEthernet0/0': {},
          'GigabitEthernet0/0.10': { encap: 10, ip: '192.168.10.1', mask: M24 },
          'GigabitEthernet0/0.20': { encap: 30, ip: '192.168.20.1', mask: M24 }
        }),
        SW1: sw(450, 200, 'Office', { 1: 'default', 10: 'OFFICE', 20: 'PRINTERS' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 10 }, 'FastEthernet0/3': { vlan: 20 }, 'FastEthernet0/4': { vlan: 20 },
          'GigabitEthernet0/1': { mode: 'trunk' }
        }),
        'Office-PC': host('pc', 140, 305, '192.168.10.21', M24, '192.168.10.1'),
        'Reception-PC': host('pc', 345, 305, '192.168.10.22', M24, '192.168.10.1'),
        'Laser-Printer': host('printer', 560, 305, '192.168.20.30', M24, '192.168.20.1'),
        'Label-Printer': host('printer', 765, 305, '192.168.20.31', M24, '192.168.20.1')
      },
      links: [
        link('R1', 'GigabitEthernet0/0', 'SW1', 'GigabitEthernet0/1'),
        link('Office-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Reception-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Laser-Printer', 'FastEthernet0', 'SW1', 'FastEthernet0/3'),
        link('Label-Printer', 'FastEthernet0', 'SW1', 'FastEthernet0/4')
      ],
      labels: [{ x: 175, y: 120, t: 'VLAN 10 OFFICE: 192.168.10.0/24' }, { x: 725, y: 120, t: 'VLAN 20 PRINTERS: 192.168.20.0/24' }],
      objectives: [
        { from: 'Office-PC', to: '192.168.20.30', text: 'Office-PC can reach Laser-Printer' },
        { from: 'Office-PC', to: '192.168.10.1', text: 'Office-PC can still reach its gateway on R1' }
      ],
      hints: [
        'Office traffic reaches R1 and printer traffic doesn’t, over the same cable. Look at how R1 splits that cable into subinterfaces: `show ip interface brief`, then `show running-config` on R1.',
        'Each subinterface handles one VLAN, set by `encapsulation dot1Q`. Gi0/0.20 has the printer subnet, but it’s tagged for VLAN 30, which doesn’t exist on SW1.',
        'On R1: `enable`, `conf t`, `interface g0/0.20`, `encapsulation dot1Q 20`.'
      ],
      explain: 'A router on a stick routes between VLANs over one trunk. It splits the physical port into subinterfaces, one per VLAN, and `encapsulation dot1Q` sets the VLAN tag each one uses. The printer subinterface had the right IP address but the wrong tag: R1 tagged its frames for VLAN 30, which SW1 doesn’t have, and frames tagged 20 from the switch had no subinterface to land on.'
    },
    {
      id: 'p10', day: 2, num: 10, diff: 3, title: 'Leftovers', topics: ['Static routes', 'Longest prefix match'],
      teaser: 'Every nightly backup fails. The app server in the same subnet is fine.',
      ticket: { id: 'INC-2091', pri: 'P1', opened: '06:05' },
      story: 'On Saturday the old datacentre firewall, FW1, was unplugged, and traffic now runs straight from the HQ router to the datacentre router. Every nightly backup from HQ has failed since. The DC team says the network is fine, because HQ can still reach the app server in the same subnet.',
      start: 'Ops-PC',
      devices: {
        'Ops-PC': host('pc', 85, 205, '192.168.1.20', M24, '192.168.1.1'),
        R1: rt(275, 205, 'HQ', {
          'GigabitEthernet0/0': { ip: '192.168.1.1', mask: M24 },
          'GigabitEthernet0/1': { ip: '10.0.0.1', mask: '255.255.255.248', description: 'To datacentre' }
        }, [{ net: '172.16.50.0', mask: M24, nh: '10.0.0.2' }, { net: '172.16.50.128', mask: '255.255.255.128', nh: '10.0.0.3' }]),
        R2: rt(490, 205, 'Datacentre', {
          'GigabitEthernet0/1': { ip: '10.0.0.2', mask: '255.255.255.248' },
          'GigabitEthernet0/0': { ip: '172.16.50.1', mask: M24 }
        }, [{ net: '192.168.1.0', mask: M24, nh: '10.0.0.1' }]),
        SW1: sw(690, 205, 'DC rack'),
        'App-Server': host('server', 830, 105, '172.16.50.10', M24, '172.16.50.1'),
        'Backup-Server': host('server', 830, 290, '172.16.50.200', M24, '172.16.50.1')
      },
      links: [
        link('Ops-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1'),
        link('R2', 'GigabitEthernet0/0', 'SW1', 'GigabitEthernet0/1'),
        link('App-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Backup-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/2')
      ],
      labels: [{ x: 180, y: 120, t: '192.168.1.0/24' }, { x: 383, y: 120, t: '10.0.0.0/29' }, { x: 655, y: 92, t: '172.16.50.0/24' }],
      objectives: [
        { from: 'Ops-PC', to: '172.16.50.200', text: 'Ops-PC can reach Backup-Server' },
        { from: 'Ops-PC', to: '172.16.50.10', text: 'Ops-PC can still reach App-Server' }
      ],
      hints: [
        'Same subnet, same switch: one server works and one doesn’t. Run `tracert` to both from Ops-PC, then read R1’s routing table with `show ip route`.',
        'Two routes on R1 match 172.16.50.200: the /24 via R2, and a /25 via 10.0.0.3, FW1’s old address. A router always uses the most specific match, so the top half of the subnet still goes to a firewall that isn’t there.',
        'On R1: `enable`, `conf t`, `no ip route 172.16.50.128 255.255.255.128 10.0.0.3`.'
      ],
      explain: 'Routers choose the longest matching prefix, not the first route or the “main” one. The /25 left over from the firewall days covers 172.16.50.128 to .255, so the backup server at .200 matched it, while the app server at .10 only matched the /24. The DC team’s test passed because they tested the one server that was never affected. When you retire a device, search every config for its address.'
    },
    // ---------------- Day 3 ----------------
    {
      id: 'p11', day: 3, num: 11, diff: 1, title: 'Hard Coded', topics: ['Speed and duplex'],
      teaser: 'The file server answers, mostly. Spreadsheets crawl.',
      ticket: { id: 'INC-2104', pri: 'P3', opened: '10:05' },
      story: 'Last week someone “optimised” the file server’s switch port by hard-coding its speed and duplex. Since then the accounts team says spreadsheets take forever to open from the file server, and sometimes fail. The printer on the same switch is fine.',
      start: 'Accounts-PC',
      devices: {
        'Accounts-PC': host('pc', 110, 110, '192.168.20.21', M24, '192.168.20.1'),
        'Kim-PC': host('pc', 110, 290, '192.168.20.22', M24, '192.168.20.1'),
        SW1: sw(400, 200, 'Accounts', { 1: 'default', 20: 'ACCOUNTS' }, {
          'FastEthernet0/1': { vlan: 20 }, 'FastEthernet0/2': { vlan: 20 }, 'FastEthernet0/3': { vlan: 20 },
          'FastEthernet0/6': { vlan: 20, speed: '100', duplex: 'full', description: 'File server' }
        }),
        'File-Server': host('server', 720, 110, '192.168.20.10', M24, '192.168.20.1'),
        Printer: host('printer', 720, 290, '192.168.20.40', M24, '192.168.20.1')
      },
      links: [
        link('Accounts-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Kim-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Printer', 'FastEthernet0', 'SW1', 'FastEthernet0/3'),
        link('File-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/6')
      ],
      labels: [{ x: 400, y: 52, t: 'ACCOUNTS VLAN 20: 192.168.20.0/24' }],
      objectives: [
        { from: 'Accounts-PC', to: '192.168.20.10', text: 'Accounts-PC reaches File-Server with no lost packets' },
        { from: 'Kim-PC', to: '192.168.20.40', text: 'Kim-PC can still reach the Printer' }
      ],
      hints: [
        'Ping the server a few times: some replies go missing and the times jump around. Look at the server’s switch port with `show interfaces status` and `show interfaces fa0/6`.',
        'Fa0/6 is hard-coded to 100 Mb/s full duplex. The server’s network card is still on auto, and when the other end won’t negotiate it falls back to half duplex. One end full, one end half: a duplex mismatch. That’s the climbing CRC count.',
        'On SW1: `enable`, `conf t`, `int fa0/6`, `speed auto`, `duplex auto`.'
      ],
      explain: 'Auto-negotiation only works when both ends take part. Hard-code one side and the other can still sense the speed, but it can’t learn the duplex, so it assumes half. The link comes up and mostly works, which is what makes a duplex mismatch nasty: no alarms, just errors and lost packets that get worse under load. Set both ends to auto, or hard-code both ends the same.'
    },
    {
      id: 'p12', day: 3, num: 12, diff: 1, title: 'Next Door', topics: ['IP addressing', 'Subnetting'],
      teaser: 'A brand-new WAN link, up at both ends, and nothing crosses it.',
      ticket: { id: 'INC-2107', pri: 'P2', opened: '07:30' },
      story: 'A new link to the warehouse went live last night. A different engineer set up the router at each end, both working from the same spreadsheet. The link lights are green, but the warehouse can’t reach HQ, and HQ can’t reach the warehouse.',
      start: 'HQ-PC',
      devices: {
        'HQ-PC': host('pc', 90, 200, '192.168.1.20', M24, '192.168.1.1'),
        R1: rt(310, 200, 'HQ', {
          'GigabitEthernet0/0': { ip: '192.168.1.1', mask: M24 },
          'GigabitEthernet0/1': { ip: '10.0.0.1', mask: M30, description: 'WAN to warehouse' }
        }, [{ net: '192.168.60.0', mask: M24, nh: '10.0.0.2' }]),
        R2: rt(570, 200, 'Warehouse', {
          'GigabitEthernet0/1': { ip: '10.0.0.5', mask: M30, description: 'WAN to HQ' },
          'GigabitEthernet0/0': { ip: '192.168.60.1', mask: M24 }
        }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '10.0.0.1' }]),
        'Dock-PC': host('pc', 800, 200, '192.168.60.20', M24, '192.168.60.1')
      },
      links: [
        link('HQ-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1'),
        link('R2', 'GigabitEthernet0/0', 'Dock-PC', 'FastEthernet0')
      ],
      labels: [{ x: 200, y: 120, t: '192.168.1.0/24' }, { x: 440, y: 120, t: 'WAN /30' }, { x: 685, y: 120, t: '192.168.60.0/24' }],
      objectives: [
        { from: 'HQ-PC', to: '192.168.60.20', text: 'HQ-PC can reach Dock-PC in the warehouse' },
        { from: 'Dock-PC', to: '192.168.1.20', text: 'Dock-PC can reach HQ-PC' }
      ],
      hints: [
        'Both routers say the WAN link is up/up, so it isn’t the cable. Compare the addresses at each end with `show ip interface brief`.',
        'A /30 has two usable addresses. 10.0.0.1/30 pairs with 10.0.0.2, but R2 has 10.0.0.5, which is in the next /30 along (10.0.0.4 to .7). The two ends aren’t in the same subnet. That’s also why R2’s default route via 10.0.0.1 isn’t in `show ip route`.',
        'On R2: `en`, `conf t`, `int g0/1`, `ip address 10.0.0.2 255.255.255.252`.'
      ],
      explain: 'A /30 holds four addresses: the network, two hosts and the broadcast. 10.0.0.0/30 runs from .0 to .3, so its hosts are .1 and .2, and .5 belongs to the next block. Two interfaces on the same cable but different subnets can’t talk. Routers also only install a static route when its next hop is in a connected subnet, which is why R2’s default route quietly disappeared.'
    },
    {
      id: 'p13', day: 3, num: 13, diff: 2, title: 'New Laptop', topics: ['Port security', 'Err-disabled'],
      teaser: 'A new laptop kills the port it’s plugged into.',
      ticket: { id: 'INC-2110', pri: 'P3', opened: '09:20' },
      story: 'Priya’s old laptop died, and IT handed her a new one this morning. The moment she plugged it into her desk port, the port went dead. Her old laptop worked in the same port yesterday, and Sam at the next desk is fine.',
      start: 'Priya-Laptop',
      devices: {
        'Sam-PC': host('pc', 150, 95, '192.168.10.32', M24, '192.168.10.1', { mac: '54bf.6403.7c11' }),
        'Priya-Laptop': host('pc', 150, 300, '192.168.10.31', M24, '192.168.10.1', { mac: '54bf.6411.2a7c' }),
        SW1: sw(430, 200, 'Level 2', { 1: 'default', 10: 'STAFF' }, {
          'FastEthernet0/2': { vlan: 10, psec: { on: true, max: 1, sticky: true, macs: ['54bf.6403.7c11'], dyn: [], violation: 'shutdown', viol: 0 }, description: 'Sam desk' },
          'FastEthernet0/3': { vlan: 10, psec: { on: true, max: 1, sticky: true, macs: ['54bf.6403.91e2'], dyn: [], violation: 'shutdown', viol: 1, last: '54bf.6411.2a7c' }, errdis: 'psecure-violation', description: 'Priya desk' },
          'FastEthernet0/4': { vlan: 10 }, 'FastEthernet0/5': { vlan: 10 }
        }),
        Intranet: host('server', 720, 95, '192.168.10.10', M24, '192.168.10.1', { services: [80], site: 'Intranet' }),
        Printer: host('printer', 720, 300, '192.168.10.40', M24, '192.168.10.1')
      },
      links: [
        link('Sam-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Priya-Laptop', 'FastEthernet0', 'SW1', 'FastEthernet0/3'),
        link('Printer', 'FastEthernet0', 'SW1', 'FastEthernet0/4'),
        link('Intranet', 'FastEthernet0', 'SW1', 'FastEthernet0/5')
      ],
      boot: { SW1: [
        '%PM-4-ERR_DISABLE: psecure-violation error detected on Fa0/3, putting Fa0/3 in err-disable state',
        '%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address 54bf.6411.2a7c on port FastEthernet0/3.',
        '%LINEPROTO-5-UPDOWN: Line protocol on Interface FastEthernet0/3, changed state to down',
        '%LINK-3-UPDOWN: Interface FastEthernet0/3, changed state to down'
      ] },
      labels: [{ x: 430, y: 52, t: 'STAFF VLAN 10: 192.168.10.0/24' }],
      objectives: [
        { from: 'Priya-Laptop', to: '192.168.10.10', text: 'Priya-Laptop can reach the Intranet server' },
        { from: 'Sam-PC', to: '192.168.10.10', text: 'Sam-PC can still reach the Intranet server' }
      ],
      hints: [
        'Read SW1’s console log, then run `show interfaces status`. Fa0/3 isn’t just down.',
        'Port security on Fa0/3 allows one MAC address, and her old laptop’s MAC is stuck to it (sticky). The new laptop broke the rule, so the switch err-disabled the port. Compare `show port-security interface fa0/3` with `ipconfig /all` on the new laptop.',
        'On SW1: `en`, `conf t`, `int fa0/3`, `no switchport port-security mac-address sticky 54bf.6403.91e2`, then `shutdown` and `no shutdown`. The switch learns the new laptop’s MAC.'
      ],
      explain: 'Port security limits which devices can use a port. With sticky learning, the first MAC address seen is saved into the config, so swapping hardware looks exactly like an intruder. In shutdown mode a violation err-disables the port, and it stays down until someone bounces it with `shutdown` and `no shutdown`. Remove the old sticky address first, or the port goes straight back to err-disabled.'
    },
    {
      id: 'p14', day: 3, num: 14, diff: 2, title: 'Fresh Out of the Box', topics: ['Trunks', 'DTP'],
      teaser: 'A replacement switch, configured to match, and VLAN 10 won’t cross.',
      ticket: { id: 'INC-2113', pri: 'P2', opened: '08:40' },
      story: 'SW2 on Level 2 died and was swapped for a spare overnight. The spare got the same VLANs and the same access ports as the old one. Now Level 2 staff can’t reach the file server downstairs, but the lobby kiosk, on the default VLAN, still works.',
      start: 'Staff-PC',
      devices: {
        SW1: sw(250, 100, 'Level 1', { 1: 'default', 10: 'STAFF' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 1 }, 'GigabitEthernet0/1': { mode: 'dynamic auto' }
        }),
        SW2: sw(650, 100, 'Level 2 (spare)', { 1: 'default', 10: 'STAFF' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 1 }, 'GigabitEthernet0/1': { mode: 'dynamic auto' }
        }),
        'File-Server': host('server', 120, 285, '192.168.10.10', M24, '192.168.10.1'),
        'Lobby-Screen': host('pc', 380, 285, '192.168.1.50', M24, '192.168.1.1'),
        'Staff-PC': host('pc', 520, 285, '192.168.10.21', M24, '192.168.10.1'),
        Kiosk: host('pc', 780, 285, '192.168.1.60', M24, '192.168.1.1')
      },
      links: [
        link('SW1', 'GigabitEthernet0/1', 'SW2', 'GigabitEthernet0/1'),
        link('File-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Lobby-Screen', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('Staff-PC', 'FastEthernet0', 'SW2', 'FastEthernet0/1'),
        link('Kiosk', 'FastEthernet0', 'SW2', 'FastEthernet0/2')
      ],
      labels: [{ x: 450, y: 372, t: 'STAFF VLAN 10: 192.168.10.0/24 · DEFAULT VLAN 1: 192.168.1.0/24' }],
      objectives: [
        { from: 'Staff-PC', to: '192.168.10.10', text: 'Staff-PC (Level 2) can reach File-Server (Level 1)' },
        { from: 'Kiosk', to: '192.168.1.50', text: 'Kiosk can still reach Lobby-Screen' }
      ],
      hints: [
        'VLAN 1 crosses between the switches and VLAN 10 doesn’t. Is the link between them actually a trunk? Try `show interfaces trunk` on both switches.',
        'Both ends are in DTP `dynamic auto`, the default on these switches. Auto means “I’ll trunk if the other side asks”, and neither side asks, so the link runs as a plain access port in VLAN 1. `show interfaces switchport` shows it.',
        'On SW2: `enable`, `conf t`, `int g0/1`, `switchport mode trunk`.'
      ],
      explain: 'DTP negotiates trunks: `trunk` is always on, `dynamic desirable` asks, and `dynamic auto` only agrees when asked. Two auto ends never form a trunk. The old SW2 had `switchport mode trunk` on its uplink; the spare came with defaults. Set uplinks to trunk explicitly rather than relying on negotiation.'
    },
    {
      id: 'p15', day: 3, num: 15, diff: 3, title: 'Round and Round', topics: ['Static routes', 'Routing loops'],
      teaser: 'Tracert shows the same two routers, over and over.',
      ticket: { id: 'INC-2118', pri: 'P2', opened: '11:15' },
      story: 'A new router, R3, went in yesterday to connect the lab. The engineer added a route for the lab on R2 from a template. Since then nobody at HQ can reach the lab, and pings come back with an odd error instead of timing out.',
      start: 'HQ-PC',
      devices: {
        'HQ-PC': host('pc', 80, 200, '192.168.1.20', M24, '192.168.1.1'),
        R1: rt(265, 200, 'HQ core', {
          'GigabitEthernet0/0': { ip: '192.168.1.1', mask: M24 },
          'GigabitEthernet0/1': { ip: '10.0.12.1', mask: M30 }
        }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '10.0.12.2' }]),
        R2: rt(470, 200, 'WAN', {
          'GigabitEthernet0/1': { ip: '10.0.12.2', mask: M30 },
          'GigabitEthernet0/2': { ip: '10.0.23.1', mask: M30, description: 'To R3 (lab)' }
        }, [{ net: '192.168.1.0', mask: M24, nh: '10.0.12.1' }, { net: '172.16.30.0', mask: M24, nh: '10.0.12.1' }]),
        R3: rt(670, 200, 'Lab', {
          'GigabitEthernet0/2': { ip: '10.0.23.2', mask: M30 },
          'GigabitEthernet0/0': { ip: '172.16.30.1', mask: M24 }
        }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '10.0.23.1' }]),
        'Lab-PC': host('pc', 850, 200, '172.16.30.20', M24, '172.16.30.1')
      },
      links: [
        link('HQ-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1'),
        link('R2', 'GigabitEthernet0/2', 'R3', 'GigabitEthernet0/2'),
        link('R3', 'GigabitEthernet0/0', 'Lab-PC', 'FastEthernet0')
      ],
      labels: [{ x: 172, y: 120, t: '192.168.1.0/24' }, { x: 368, y: 120, t: '10.0.12.0/30' }, { x: 570, y: 120, t: '10.0.23.0/30' }, { x: 760, y: 120, t: '172.16.30.0/24' }],
      objectives: [
        { from: 'HQ-PC', to: '172.16.30.20', text: 'HQ-PC can reach Lab-PC' },
        { from: 'HQ-PC', to: '10.0.12.2', text: 'HQ-PC can still reach R2' }
      ],
      hints: [
        'Run `tracert 172.16.30.20` from HQ-PC and read the hops. The same addresses keep coming back.',
        'R1 sends lab traffic to R2, and R2’s route for 172.16.30.0/24 points straight back at R1 (10.0.12.1). Each router thinks the other knows the way, so packets bounce between them until their TTL runs out.',
        'On R2: `en`, `conf t`, `no ip route 172.16.30.0 255.255.255.0 10.0.12.1`, then `ip route 172.16.30.0 255.255.255.0 10.0.23.2`.'
      ],
      explain: 'A routing loop: two routers each pointing at the other for the same destination. IP’s only loop protection is the TTL, which every router decrements; at zero the packet is dropped and the sender gets “TTL expired in transit”. That message, plus a tracert that repeats itself, is the signature of a loop.'
    },

    // ---------------- Day 4 ----------------
    {
      id: 'p16', day: 4, num: 16, diff: 1, title: 'Desk Switch', topics: ['Spanning tree', 'BPDU Guard'],
      teaser: 'Four extra ports for the meeting room, and none of them work.',
      ticket: { id: 'INC-2122', pri: 'P3', opened: '09:00' },
      story: 'The meeting room has one wall port, so facilities plugged in a spare Cisco switch to give the room a few more. Nothing in the meeting room can reach the network, and the light on the wall port is off.',
      start: 'Meeting-PC',
      devices: {
        'Office-PC': host('pc', 110, 70, '192.168.10.21', M24, '192.168.10.1'),
        SW1: sw(340, 70, 'Floor', { 1: 'default', 10: 'STAFF' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 10 },
          'FastEthernet0/5': { vlan: 10, portfast: true, bpduguard: true, errdis: 'bpduguard', description: 'Meeting room wall' }
        }),
        'File-Server': host('server', 600, 70, '192.168.10.10', M24, '192.168.10.1'),
        'SW-Meet': sw(340, 232, 'Meeting room', { 1: 'default', 10: 'STAFF' }, {
          'FastEthernet0/1': { vlan: 10 }, 'FastEthernet0/2': { vlan: 10 }, 'GigabitEthernet0/1': { vlan: 10 }
        }),
        'Meeting-PC': host('pc', 140, 305, '192.168.10.51', M24, '192.168.10.1'),
        'Room-Display': host('pc', 540, 305, '192.168.10.52', M24, '192.168.10.1')
      },
      links: [
        link('Office-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('File-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('SW1', 'FastEthernet0/5', 'SW-Meet', 'GigabitEthernet0/1'),
        link('Meeting-PC', 'FastEthernet0', 'SW-Meet', 'FastEthernet0/1'),
        link('Room-Display', 'FastEthernet0', 'SW-Meet', 'FastEthernet0/2')
      ],
      boot: { SW1: [
        '%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port Fa0/5 with BPDU Guard enabled. Disabling port.',
        '%PM-4-ERR_DISABLE: bpduguard error detected on Fa0/5, putting Fa0/5 in err-disable state',
        '%LINEPROTO-5-UPDOWN: Line protocol on Interface FastEthernet0/5, changed state to down',
        '%LINK-3-UPDOWN: Interface FastEthernet0/5, changed state to down'
      ] },
      labels: [{ x: 760, y: 215, t: 'VLAN 10: 192.168.10.0/24' }],
      objectives: [
        { from: 'Meeting-PC', to: '192.168.10.10', text: 'Meeting-PC can reach File-Server' },
        { from: 'Office-PC', to: '192.168.10.10', text: 'Office-PC can still reach File-Server' }
      ],
      hints: [
        'The meeting room’s link light is off at both ends. Read SW1’s console log and run `show interfaces status`.',
        'Fa0/5 was set up for a single desk PC: PortFast with BPDU Guard. The new switch sends spanning-tree BPDUs, so BPDU Guard err-disabled the port to protect the network from loops.',
        'On SW1: `en`, `conf t`, `int fa0/5`, `no spanning-tree portfast`, `spanning-tree bpduguard disable`, then `shutdown` and `no shutdown`.'
      ],
      explain: 'PortFast skips spanning tree’s listening and learning states. That’s great for a PC and dangerous for a switch, so BPDU Guard is its safety net: if a BPDU ever arrives on that port, the port is err-disabled. Here the guard did its job. The fix is to treat the port as a switch uplink, then bounce it, because err-disabled ports stay down until someone does.'
    },
    {
      id: 'p17', day: 4, num: 17, diff: 1, title: 'New Starters', topics: ['Standard ACLs'],
      teaser: 'HR can’t reach payroll. Everyone else can.',
      ticket: { id: 'INC-2125', pri: 'P2', opened: '08:05' },
      story: 'HR moved into their own subnet, 192.168.20.0/24, this morning. Staff can reach the payroll server as usual, but HR can’t, and payroll is literally their job. Guest Wi-Fi must stay locked out of payroll.',
      start: 'HR-PC',
      devices: {
        'Staff-PC': host('pc', 100, 90, '192.168.10.21', M24, '192.168.10.1'),
        'HR-PC': host('pc', 100, 200, '192.168.20.21', M24, '192.168.20.1'),
        'Guest-PC': host('pc', 100, 305, '192.168.30.21', M24, '192.168.30.1'),
        R1: Object.assign(rt(420, 200, 'Core', {
          'GigabitEthernet0/0': { ip: '192.168.10.1', mask: M24, description: 'Staff' },
          'GigabitEthernet0/1': { ip: '10.10.10.1', mask: M24, description: 'Servers', aclOut: '10' },
          'GigabitEthernet0/2': { ip: '192.168.20.1', mask: M24, description: 'HR' },
          'GigabitEthernet0/3': { ip: '192.168.30.1', mask: M24, description: 'Guest Wi-Fi' }
        }), { acls: { 10: { type: 'std', entries: [{ seq: 10, action: 'permit', src: net('192.168.10.0', '0.0.0.255') }] } } }),
        Payroll: host('server', 730, 200, '10.10.10.20', M24, '10.10.10.1', { services: [80], site: 'Payroll' })
      },
      links: [
        link('Staff-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('HR-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/2'),
        link('Guest-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/3'),
        link('R1', 'GigabitEthernet0/1', 'Payroll', 'FastEthernet0')
      ],
      labels: [{ x: 585, y: 130, t: '10.10.10.0/24' }],
      objectives: [
        { from: 'HR-PC', to: '10.10.10.20', text: 'HR-PC can reach Payroll' },
        { from: 'Staff-PC', to: '10.10.10.20', text: 'Staff-PC can still reach Payroll' },
        { from: 'Guest-PC', to: '10.10.10.20', blocked: true, text: 'Guest-PC still can’t reach Payroll' }
      ],
      hints: [
        'HR can reach its gateway but not payroll. Look for anything on R1 that filters traffic: `show access-lists`, then `show ip interface` to see where it’s applied.',
        'ACL 10 is applied outbound on Gi0/1, toward the servers. It permits 192.168.10.0/24 and nothing else, because every ACL ends with an invisible “deny any”. HR’s new subnet was never added.',
        'On R1: `en`, `conf t`, `access-list 10 permit 192.168.20.0 0.0.0.255`.'
      ],
      explain: 'Every access list ends with an implicit deny any, so anything you don’t permit is dropped. Standard ACLs match only the source address, which is why they go close to the destination, here on the interface facing the servers. Removing the ACL would have fixed HR too, and let the guests in.'
    },
    {
      id: 'p18', day: 4, num: 18, diff: 2, title: 'Pings Work', topics: ['Extended ACLs', 'TCP ports'],
      teaser: 'The intranet server answers pings. The website still won’t load.',
      ticket: { id: 'INC-2129', pri: 'P2', opened: '13:10' },
      story: 'The new intranet server answers pings from the office, so the network team closed the ticket. Users reopened it: the intranet website still won’t load. Security’s rule is that the office may ping the server and use the website, but nothing else.',
      start: 'Staff-PC',
      devices: {
        'Staff-PC': host('pc', 100, 110, '192.168.10.21', M24, '192.168.10.1'),
        'Dev-PC': host('pc', 100, 290, '192.168.10.22', M24, '192.168.10.1'),
        SW1: sw(310, 200, 'Office'),
        R1: Object.assign(rt(535, 200, 'Edge', {
          'GigabitEthernet0/0': { ip: '192.168.10.1', mask: M24, description: 'Office LAN', aclIn: '110' },
          'GigabitEthernet0/1': { ip: '10.20.0.1', mask: M24, description: 'Server room' }
        }), { acls: { 110: { type: 'ext', entries: [{ seq: 10, action: 'permit', proto: 'icmp', src: ANY, dst: ANY, dport: null }] } } }),
        Intranet: host('server', 780, 200, '10.20.0.10', M24, '10.20.0.1', { services: [80, 22], site: 'Intranet' })
      },
      links: [
        link('Staff-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Dev-PC', 'FastEthernet0', 'SW1', 'FastEthernet0/2'),
        link('SW1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'Intranet', 'FastEthernet0')
      ],
      labels: [{ x: 310, y: 52, t: '192.168.10.0/24' }, { x: 660, y: 120, t: '10.20.0.0/24' }],
      objectives: [
        { from: 'Staff-PC', to: '10.20.0.10', port: 80, text: 'Staff-PC can load the intranet website' },
        { from: 'Dev-PC', to: '10.20.0.10', text: 'Dev-PC can still ping the Intranet server' },
        { from: 'Staff-PC', to: '10.20.0.10', port: 22, blocked: true, text: 'Staff-PC still can’t SSH to the Intranet server' }
      ],
      hints: [
        'Ping uses ICMP, and a web page uses TCP port 80. Something lets one through and not the other. Try `curl http://10.20.0.10` on Staff-PC, then `show access-lists` on R1.',
        'ACL 110 is applied inbound on R1’s office interface, Gi0/0. It permits ICMP and nothing else, so web traffic falls through to the implicit deny at the end.',
        'On R1: `en`, `conf t`, `access-list 110 permit tcp any host 10.20.0.10 eq www`.'
      ],
      explain: 'A ping proves ICMP works, nothing more. Extended ACLs filter by protocol and port, so a server can answer pings while its website is blocked. Test the thing users actually use. Permitting just web traffic, rather than everything, keeps the ACL doing its job, which is why SSH from the office is still blocked.'
    },
    {
      id: 'p19', day: 4, num: 19, diff: 2, title: 'Line by Line', topics: ['Named ACLs', 'ACL order'],
      teaser: 'Guests are blocked from the servers, including the one printer they’re allowed.',
      ticket: { id: 'INC-2131', pri: 'P3', opened: '10:40' },
      story: 'Security asked for the guest Wi-Fi to be blocked from the office servers, except the guest printer. The change went in last night. Guests are now blocked from the servers, as asked, and from the printer too.',
      start: 'Guest-Laptop',
      devices: {
        'Guest-Laptop': host('pc', 90, 200, '192.168.50.30', M24, '192.168.50.1'),
        Upstream: rt(310, 62, 'Internet', { 'GigabitEthernet0/0': { ip: '100.64.0.1', mask: M30 } }, [{ net: '192.168.50.0', mask: M24, nh: '100.64.0.2' }]),
        R1: Object.assign(rt(310, 215, 'Edge', {
          'GigabitEthernet0/0': { ip: '192.168.50.1', mask: M24, description: 'Guest Wi-Fi', aclIn: 'GUEST-IN' },
          'GigabitEthernet0/1': { ip: '10.30.0.1', mask: M24, description: 'Servers' },
          'GigabitEthernet0/2': { ip: '100.64.0.2', mask: M30, description: 'Internet' }
        }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '100.64.0.1' }]), { acls: { 'GUEST-IN': { type: 'ext', entries: [
          { seq: 10, action: 'deny', proto: 'ip', src: net('192.168.50.0', '0.0.0.255'), dst: net('10.30.0.0', '0.0.0.255'), dport: null },
          { seq: 20, action: 'permit', proto: 'ip', src: net('192.168.50.0', '0.0.0.255'), dst: H('10.30.0.40'), dport: null },
          { seq: 30, action: 'permit', proto: 'ip', src: ANY, dst: ANY, dport: null }
        ] } } }),
        SW1: sw(540, 215, 'Server room'),
        'File-Server': host('server', 790, 110, '10.30.0.10', M24, '10.30.0.1'),
        'Guest-Printer': host('printer', 790, 300, '10.30.0.40', M24, '10.30.0.1')
      },
      links: [
        link('Guest-Laptop', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/2', 'Upstream', 'GigabitEthernet0/0'),
        link('R1', 'GigabitEthernet0/1', 'SW1', 'GigabitEthernet0/1'),
        link('File-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Guest-Printer', 'FastEthernet0', 'SW1', 'FastEthernet0/2')
      ],
      labels: [{ x: 150, y: 120, t: '192.168.50.0/24' }, { x: 640, y: 52, t: '10.30.0.0/24' }],
      objectives: [
        { from: 'Guest-Laptop', to: '10.30.0.40', text: 'Guest-Laptop can reach Guest-Printer' },
        { from: 'Guest-Laptop', to: '10.30.0.10', blocked: true, text: 'Guest-Laptop still can’t reach File-Server' },
        { from: 'Guest-Laptop', to: '100.64.0.1', text: 'Guest-Laptop can still reach the internet' }
      ],
      hints: [
        'Run `show access-lists` on R1 and read GUEST-IN from the top, then test the printer again and watch which line’s match counter goes up.',
        'An ACL stops at the first line that matches. Line 10 denies the whole server subnet, which includes the printer, so line 20 never gets a look in. Move the printer line above it. (Re-adding an identical line with a new number does nothing, so remove the old one first.)',
        'On R1: `en`, `conf t`, `ip access-list extended GUEST-IN`, `no 20`, then `5 permit ip 192.168.50.0 0.0.0.255 host 10.30.0.40`.'
      ],
      explain: 'An ACL is read top down and the first matching line wins. A specific exception has to come before the broad rule it carves a hole in. Named ACLs let you remove and insert lines by sequence number (here 5, before 10) instead of deleting and retyping the whole list. IOS ignores a new line that duplicates an existing one, even with a different number.'
    },
    {
      id: 'p20', day: 4, num: 20, diff: 3, title: 'Wild Card', topics: ['Standard ACLs', 'Wildcard masks'],
      teaser: 'An ACL meant to let IT in keeps IT out.',
      ticket: { id: 'INC-2136', pri: 'P1', opened: '06:50' },
      story: 'Only the IT subnet, 192.168.99.0/24, should reach the backup network. An ACL to enforce that went on last night. This morning the backups failed, because IT can’t reach the backup server either. Staff must stay blocked.',
      start: 'IT-PC',
      devices: {
        'IT-PC': host('pc', 100, 110, '192.168.99.21', M24, '192.168.99.1'),
        'Staff-PC': host('pc', 100, 290, '192.168.10.21', M24, '192.168.10.1'),
        R1: Object.assign(rt(360, 200, 'Core', {
          'GigabitEthernet0/0': { ip: '192.168.99.1', mask: M24, description: 'IT' },
          'GigabitEthernet0/2': { ip: '192.168.10.1', mask: M24, description: 'Staff' },
          'GigabitEthernet0/1': { ip: '10.50.0.1', mask: M24, description: 'Backup network', aclOut: '15' }
        }), { acls: { 15: { type: 'std', entries: [{ seq: 10, action: 'permit', src: net('0.0.0.0', '255.255.255.0') }] } } }),
        SW1: sw(580, 200, 'Backup'),
        'Backup-Server': host('server', 800, 110, '10.50.0.20', M24, '10.50.0.1'),
        'Tape-Library': host('server', 800, 290, '10.50.0.30', M24, '10.50.0.1')
      },
      links: [
        link('IT-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/0'),
        link('Staff-PC', 'FastEthernet0', 'R1', 'GigabitEthernet0/2'),
        link('R1', 'GigabitEthernet0/1', 'SW1', 'GigabitEthernet0/1'),
        link('Backup-Server', 'FastEthernet0', 'SW1', 'FastEthernet0/1'),
        link('Tape-Library', 'FastEthernet0', 'SW1', 'FastEthernet0/2')
      ],
      labels: [{ x: 690, y: 52, t: '10.50.0.0/24' }],
      objectives: [
        { from: 'IT-PC', to: '10.50.0.20', text: 'IT-PC can reach Backup-Server' },
        { from: 'IT-PC', to: '10.50.0.30', text: 'IT-PC can reach Tape-Library' },
        { from: 'Staff-PC', to: '10.50.0.20', blocked: true, text: 'Staff-PC still can’t reach Backup-Server' }
      ],
      hints: [
        'Read ACL 15 with `show access-lists` on R1. IOS shows it the way it stored it, which isn’t quite what was typed.',
        'ACLs use wildcard masks, not subnet masks: 0 means “must match”, 255 means “ignore”. Someone typed 255.255.255.0, which means “ignore the first three octets, the last one must be 0”. IOS rewrote it as 0.0.0.0 with wildcard 255.255.255.0, and no real host ends in .0.',
        'On R1: `en`, `conf t`, `no access-list 15`, then `access-list 15 permit 192.168.99.0 0.0.0.255`.'
      ],
      explain: 'A wildcard mask is the inverse of a subnet mask: a /24 is 0.0.0.255. Typing a subnet mask into an ACL is a classic mistake, and IOS accepts it without complaint. Two more IOS habits worth knowing: `no access-list 15 permit …` deletes the entire list, not one line, and an applied ACL that doesn’t exist permits everything, which is why Staff must be tested too.'
    },
    // ---------------- Day 5 ----------------
    {
      id: 'p21', day: 5, num: 21, diff: 1, title: 'No Vacancy', topics: ['DHCP'],
      teaser: 'Old PCs are fine. New laptops get a 169.254 address.',
      ticket: { id: 'INC-2140', pri: 'P3', opened: '08:35' },
      story: 'Last night someone reserved the first twenty addresses in the office DHCP pool for new printers. This morning every PC that already had an address is fine, but the new laptops come up with a 169.254 address and can’t reach anything.',
      start: 'New-Laptop',
      devices: {
        'New-Laptop': apipa('pc', 100, 110, '169.254.88.14', { mac: '3c22.fb10.0a01' }),
        'Desk-PC': leased('pc', 100, 290, '192.168.10.21', M24, '192.168.10.1', 'R1', '192.168.10.1', { mac: '3c22.fb10.0b02' }),
        SW1: sw(320, 200, 'Office'),
        R1: Object.assign(rt(560, 200, 'Edge', { [G(0)]: { ip: '192.168.10.1', mask: M24 }, [G(1)]: { ip: '10.1.1.1', mask: M24 } }), {
          dhcp: { pools: { STAFF: { network: '192.168.10.0', mask: M24, router: '192.168.10.1', dns: '10.1.1.53' } }, excluded: [['192.168.10.1', '192.168.10.254']], bindings: { '192.168.10.21': '3c22.fb10.0b02' } }
        }),
        'Mail-Server': host('server', 790, 200, '10.1.1.25', M24, '10.1.1.1')
      },
      links: [link('New-Laptop', F0, 'SW1', F(1)), link('Desk-PC', F0, 'SW1', F(2)), link('SW1', G(1), 'R1', G(0)), link('R1', G(1), 'Mail-Server', F0)],
      labels: [{ x: 320, y: 60, t: '192.168.10.0/24' }, { x: 675, y: 120, t: '10.1.1.0/24' }],
      objectives: [
        { from: 'New-Laptop', dhcp: true, text: 'New-Laptop gets an address from DHCP' },
        { from: 'New-Laptop', to: '10.1.1.25', text: 'New-Laptop can reach Mail-Server' },
        { from: 'Desk-PC', to: '10.1.1.25', text: 'Desk-PC can still reach Mail-Server' }
      ],
      hints: [
        'A 169.254 address means no DHCP server answered, so Windows made one up. R1 is the DHCP server here. Start with `show ip dhcp pool` on R1.',
        'The pool holds 254 addresses and all 254 are excluded. The range was meant to be .1 to .20, but someone typed .254. PCs that already had a lease keep it, which is why only new laptops are stuck.',
        'On R1: `en`, `conf t`, `no ip dhcp excluded-address 192.168.10.1 192.168.10.254`, then `ip dhcp excluded-address 192.168.10.1 192.168.10.20`. On New-Laptop: `ipconfig /renew`.'
      ],
      explain: 'Excluded addresses are ones the DHCP server must never hand out, usually for routers, printers and servers with fixed addresses. Exclude the whole subnet and the server has nothing left to offer, so new clients fall back to a 169.254 link-local address. Existing leases carry on until they need renewing, which makes this kind of mistake easy to miss.'
    },
    {
      id: 'p22', day: 5, num: 22, diff: 1, title: 'Lights Off Upstairs', topics: ['Layer-3 switching', 'SVIs'],
      teaser: 'Sales can print. Sales can’t reach anything else.',
      ticket: { id: 'INC-2143', pri: 'P2', opened: '09:10' },
      story: 'Over the weekend someone tidied up the core switch’s config. This morning the sales team can still print to their own printer, but they can’t reach the CRM server or anything else outside their floor.',
      start: 'Sales-PC',
      devices: {
        'Staff-PC': host('pc', 150, 95, '192.168.10.21', M24, '192.168.10.1'),
        'CRM-Server': host('server', 750, 95, '192.168.10.50', M24, '192.168.10.1', { services: [80], site: 'CRM' }),
        CORE: l3sw(450, 195, 'Layer-3 core', { 1: 'default', 10: 'STAFF', 20: 'SALES' }, { [F(1)]: { vlan: 10 }, [F(2)]: { vlan: 10 }, [F(3)]: { vlan: 20 }, [F(4)]: { vlan: 20 } },
          { 10: { ip: '192.168.10.1', mask: M24 }, 20: { ip: '192.168.20.1', mask: M24, shutdown: true } }),
        'Sales-PC': host('pc', 150, 295, '192.168.20.21', M24, '192.168.20.1'),
        'Sales-Printer': host('printer', 750, 295, '192.168.20.40', M24, '192.168.20.1')
      },
      links: [link('Staff-PC', F0, 'CORE', F(1)), link('CRM-Server', F0, 'CORE', F(2)), link('Sales-PC', F0, 'CORE', F(3)), link('Sales-Printer', F0, 'CORE', F(4))],
      labels: [{ x: 450, y: 40, t: 'STAFF VLAN 10: 192.168.10.0/24' }, { x: 450, y: 372, t: 'SALES VLAN 20: 192.168.20.0/24' }],
      objectives: [
        { from: 'Sales-PC', to: '192.168.10.50', text: 'Sales-PC can reach CRM-Server' },
        { from: 'Sales-PC', to: '192.168.20.40', text: 'Sales-PC can still reach Sales-Printer' },
        { from: 'Staff-PC', to: '192.168.10.50', text: 'Staff-PC can still reach CRM-Server' }
      ],
      hints: [
        'Sales can reach things in their own VLAN, but not beyond it. Their gateway is 192.168.20.1, on the core switch. Run `show ip interface brief` on CORE.',
        'Interface Vlan20, the sales VLAN’s gateway, is administratively down.',
        'On CORE: `en`, `conf t`, `interface vlan 20`, `no shutdown`.'
      ],
      explain: 'On a layer-3 switch, each VLAN’s default gateway is a switched virtual interface (SVI), named after the VLAN. Shut it down and the VLAN is cut off from everything outside it, while traffic inside the VLAN, like printing to the printer next door, carries on as normal.'
    },
    {
      id: 'p23', day: 5, num: 23, diff: 2, title: 'Far From Home', topics: ['DHCP relay'],
      teaser: 'Level 6 gets addresses from the server. Level 5 doesn’t.',
      ticket: { id: 'INC-2147', pri: 'P2', opened: '08:50' },
      story: 'The company took over Level 5 this week. Its network was set up yesterday like Level 6’s, and DC-Server already has a DHCP scope for it. Laptops on Level 6 get addresses fine. Laptops on Level 5 get 169.254 addresses.',
      start: 'Laptop',
      devices: {
        'DC-Server': host('server', 110, 110, '10.1.1.5', M24, '10.1.1.1', { dhcpd: {
          pools: { LEVEL5: { network: '192.168.50.0', mask: M24, router: '192.168.50.1', dns: '10.1.1.5' }, LEVEL6: { network: '192.168.60.0', mask: M24, router: '192.168.60.1', dns: '10.1.1.5' } },
          excluded: [['192.168.50.1', '192.168.50.20'], ['192.168.60.1', '192.168.60.20']], bindings: { '192.168.60.21': 'd0bf.9c44.6021' } } }),
        R1: rt(380, 200, 'Core', {
          [G(0)]: { ip: '10.1.1.1', mask: M24, description: 'Datacentre' },
          [G(1)]: { ip: '192.168.50.1', mask: M24, description: 'Level 5' },
          [G(2)]: { ip: '192.168.60.1', mask: M24, description: 'Level 6', helper: ['10.1.1.5'] }
        }),
        SW5: sw(620, 110, 'Level 5'),
        Laptop: apipa('pc', 830, 110, '169.254.21.140', { mac: 'd0bf.9c44.5021' }),
        SW6: sw(620, 290, 'Level 6'),
        'Level6-PC': leased('pc', 830, 290, '192.168.60.21', M24, '192.168.60.1', 'DC-Server', '10.1.1.5', { mac: 'd0bf.9c44.6021' })
      },
      links: [link('DC-Server', F0, 'R1', G(0)), link('R1', G(1), 'SW5', G(1)), link('Laptop', F0, 'SW5', F(1)), link('R1', G(2), 'SW6', G(1)), link('Level6-PC', F0, 'SW6', F(1))],
      labels: [{ x: 245, y: 290, t: '10.1.1.0/24' }, { x: 725, y: 45, t: '192.168.50.0/24' }, { x: 720, y: 372, t: '192.168.60.0/24' }],
      objectives: [
        { from: 'Laptop', dhcp: true, text: 'Laptop on Level 5 gets an address from DHCP' },
        { from: 'Laptop', to: '10.1.1.5', text: 'Laptop can reach DC-Server' },
        { from: 'Level6-PC', to: '10.1.1.5', text: 'Level6-PC can still reach DC-Server' }
      ],
      hints: [
        'DHCP starts with a broadcast, and routers don’t forward broadcasts. So how does Level 6 reach a DHCP server on another subnet? Compare R1’s Level 5 and Level 6 interfaces in `show running-config`.',
        'Level 6’s interface has `ip helper-address 10.1.1.5`, which relays DHCP broadcasts to the server as unicast. Level 5’s interface has nothing, so its broadcasts die at R1.',
        'On R1: `en`, `conf t`, `int g0/1`, `ip helper-address 10.1.1.5`. Then on Laptop: `ipconfig /renew`.'
      ],
      explain: 'A DHCP request is a broadcast, and routers stop broadcasts. A DHCP relay (`ip helper-address`) on the client’s gateway interface turns it into a unicast to the server, stamped with the gateway’s address so the server knows which scope to use. Every subnet without a local DHCP server needs one.'
    },
    {
      id: 'p24', day: 5, num: 24, diff: 2, title: 'Wrong Way Home', topics: ['DHCP options', 'Default gateway'],
      teaser: 'Every laptop gets an address, and nothing outside the lab works.',
      ticket: { id: 'INC-2151', pri: 'P3', opened: '10:20' },
      story: 'The lab got its own DHCP pool on R1 yesterday. Every laptop gets an address and they can all see each other, but nothing outside the lab works: no Git server, nothing.',
      start: 'Lab-Laptop',
      devices: {
        'Lab-Laptop': leased('pc', 100, 110, '192.168.30.21', M24, '192.168.30.254', 'R1', '192.168.30.1', { mac: '8c16.45aa.3021' }),
        'Lab-PC2': leased('pc', 100, 290, '192.168.30.22', M24, '192.168.30.254', 'R1', '192.168.30.1', { mac: '8c16.45aa.3022' }),
        SW1: sw(320, 200, 'Lab'),
        R1: Object.assign(rt(560, 200, 'Lab router', { [G(0)]: { ip: '192.168.30.1', mask: M24 }, [G(1)]: { ip: '10.2.2.1', mask: M24 } }), {
          dhcp: { pools: { LAB: { network: '192.168.30.0', mask: M24, router: '192.168.30.254', dns: '10.2.2.53' } }, excluded: [['192.168.30.1', '192.168.30.20']], bindings: { '192.168.30.21': '8c16.45aa.3021', '192.168.30.22': '8c16.45aa.3022' } }
        }),
        'Git-Server': host('server', 790, 200, '10.2.2.20', M24, '10.2.2.1', { services: [80], site: 'Git' })
      },
      links: [link('Lab-Laptop', F0, 'SW1', F(1)), link('Lab-PC2', F0, 'SW1', F(2)), link('SW1', G(1), 'R1', G(0)), link('R1', G(1), 'Git-Server', F0)],
      labels: [{ x: 320, y: 60, t: '192.168.30.0/24' }, { x: 675, y: 120, t: '10.2.2.0/24' }],
      objectives: [
        { from: 'Lab-Laptop', to: '10.2.2.20', text: 'Lab-Laptop can reach Git-Server' },
        { from: 'Lab-Laptop', to: '192.168.30.22', text: 'Lab-Laptop can still reach Lab-PC2' }
      ],
      hints: [
        'Compare `ipconfig` on Lab-Laptop with R1’s LAN address in `show ip interface brief`.',
        'The laptops’ default gateway is 192.168.30.254, an address nobody has. They got it from DHCP, so look at the LAB pool in R1’s `show running-config`.',
        'On R1: `en`, `conf t`, `ip dhcp pool LAB`, `default-router 192.168.30.1`. Then on Lab-Laptop: `ipconfig /renew` to pick up the new gateway.'
      ],
      explain: 'DHCP hands out more than an address: the pool’s `default-router` becomes every client’s default gateway. Get it wrong and clients work fine inside their subnet but can’t leave it. Fixing the pool isn’t enough on its own, because clients only learn the new gateway when they renew their lease.'
    },
    {
      id: 'p25', day: 5, num: 25, diff: 3, title: 'Moving House', topics: ['SVIs', 'VLANs'],
      teaser: 'The printers moved VLANs. Their gateway didn’t.',
      ticket: { id: 'INC-2156', pri: 'P2', opened: '07:55' },
      story: 'Last night the printers moved from VLAN 30 to a new VLAN 40. Their switch ports were moved, VLAN 30 was deleted, and the printers kept their addresses. This morning nobody can print, and the printers can’t even reach their own gateway.',
      start: 'Staff-PC',
      devices: {
        'Staff-PC': host('pc', 150, 95, '192.168.10.21', M24, '192.168.10.1'),
        'File-Server': host('server', 750, 95, '192.168.10.50', M24, '192.168.10.1'),
        CORE: l3sw(450, 195, 'Layer-3 core', { 1: 'default', 10: 'STAFF', 40: 'PRINTERS' }, { [F(1)]: { vlan: 10 }, [F(2)]: { vlan: 10 }, [F(3)]: { vlan: 40 }, [F(4)]: { vlan: 40 } },
          { 10: { ip: '192.168.10.1', mask: M24 }, 30: { ip: '192.168.30.1', mask: M24 } }),
        'Office-Printer': host('printer', 150, 295, '192.168.30.40', M24, '192.168.30.1'),
        'Label-Printer': host('printer', 750, 295, '192.168.30.41', M24, '192.168.30.1')
      },
      links: [link('Staff-PC', F0, 'CORE', F(1)), link('File-Server', F0, 'CORE', F(2)), link('Office-Printer', F0, 'CORE', F(3)), link('Label-Printer', F0, 'CORE', F(4))],
      labels: [{ x: 450, y: 40, t: 'STAFF VLAN 10: 192.168.10.0/24' }, { x: 450, y: 372, t: 'PRINTERS VLAN 40: 192.168.30.0/24' }],
      objectives: [
        { from: 'Staff-PC', to: '192.168.30.40', text: 'Staff-PC can reach Office-Printer' },
        { from: 'Label-Printer', to: '192.168.30.1', text: 'Label-Printer can reach its gateway' },
        { from: 'Staff-PC', to: '192.168.10.50', text: 'Staff-PC can still reach File-Server' }
      ],
      hints: [
        'Run `show ip interface brief` on CORE. The printers’ gateway, 192.168.30.1, lives on interface Vlan30. Look at its state.',
        'VLAN 30 no longer exists, so its SVI is down/down: an SVI only comes up while its VLAN has at least one active port. The printer subnet needs to move to an SVI for VLAN 40. Take the address off Vlan30 first, or IOS rejects it as an overlap.',
        'On CORE: `en`, `conf t`, `interface vlan 30`, `no ip address`, then `interface vlan 40`, `ip address 192.168.30.1 255.255.255.0`, `no shutdown`.'
      ],
      explain: 'An SVI follows its VLAN: it’s only up while the VLAN exists and has at least one active port (Cisco calls this autostate). Moving devices to a new VLAN means moving the gateway to that VLAN’s SVI too. New SVIs start shut down, so they need a `no shutdown`.'
    },

    // ---------------- Day 6 ----------------
    {
      id: 'p26', day: 6, num: 26, diff: 1, title: 'Unadvertised', topics: ['OSPF', 'Network statements'],
      teaser: 'The routers are OSPF neighbours. The branch LAN is still invisible.',
      ticket: { id: 'INC-2160', pri: 'P3', opened: '09:30' },
      story: 'The branch router R2 was moved onto OSPF yesterday. It formed a neighbour relationship with HQ straight away, and the branch can reach HQ. But nobody at HQ can reach anything at the branch.',
      start: 'HQ-PC',
      devices: {
        'HQ-PC': host('pc', 90, 200, '192.168.1.20', M24, '192.168.1.1'),
        R1: Object.assign(rt(310, 200, 'HQ', { [G(0)]: { ip: '192.168.1.1', mask: M24 }, [G(1)]: { ip: '10.0.12.1', mask: M30 } }), { ospf: ospf('1.1.1.1', [['192.168.1.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        R2: Object.assign(rt(570, 200, 'Branch', { [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(0)]: { ip: '192.168.2.1', mask: M24 } }), { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        'Branch-PC': host('pc', 810, 200, '192.168.2.20', M24, '192.168.2.1')
      },
      links: [link('HQ-PC', F0, 'R1', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(0), 'Branch-PC', F0)],
      labels: [{ x: 200, y: 120, t: '192.168.1.0/24' }, { x: 440, y: 120, t: 'OSPF area 0' }, { x: 690, y: 120, t: '192.168.2.0/24' }],
      objectives: [
        { from: 'HQ-PC', to: '192.168.2.20', text: 'HQ-PC can reach Branch-PC' },
        { from: 'HQ-PC', to: '10.0.12.2', text: 'HQ-PC can still reach R2' }
      ],
      hints: [
        'R1 and R2 are neighbours (`show ip ospf neighbor`), but look at R1’s routing table. Is there a route to 192.168.2.0/24?',
        'OSPF only advertises networks covered by a `network` statement. R2’s config covers the link to R1, but not its own LAN. Compare `show ip protocols` on both routers.',
        'On R2: `en`, `conf t`, `router ospf 1`, `network 192.168.2.0 0.0.0.255 area 0`.'
      ],
      explain: 'A `network` statement does two things: it turns OSPF on for matching interfaces, and it advertises their subnets. R2 never matched its LAN, so OSPF never told anyone about it. The LAN interface is passive, which is right: passive interfaces send no hellos but are still advertised, once a network statement covers them.'
    },
    {
      id: 'p27', day: 6, num: 27, diff: 2, title: 'Passive Aggressive', topics: ['OSPF', 'Passive interfaces'],
      teaser: 'A new branch router, built from the template, has no neighbours.',
      ticket: { id: 'INC-2163', pri: 'P2', opened: '08:15' },
      story: 'A new branch router was built from the standard template, which makes interfaces passive so OSPF doesn’t chatter onto user LANs. The branch can’t reach HQ, and HQ can’t reach the branch.',
      start: 'Branch-PC',
      devices: {
        'HQ-Server': host('server', 90, 200, '192.168.1.10', M24, '192.168.1.1'),
        R1: Object.assign(rt(310, 200, 'HQ', { [G(0)]: { ip: '192.168.1.1', mask: M24 }, [G(1)]: { ip: '10.0.12.1', mask: M30 } }), { ospf: ospf('1.1.1.1', [['192.168.1.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        R2: Object.assign(rt(570, 200, 'Branch', { [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(0)]: { ip: '192.168.2.1', mask: M24 } }), { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 0], ['192.168.2.0', '0.0.0.255', 0]], [G(0), G(1)]) }),
        'Branch-PC': host('pc', 810, 200, '192.168.2.20', M24, '192.168.2.1')
      },
      links: [link('HQ-Server', F0, 'R1', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(0), 'Branch-PC', F0)],
      labels: [{ x: 200, y: 120, t: '192.168.1.0/24' }, { x: 440, y: 120, t: 'OSPF area 0' }, { x: 690, y: 120, t: '192.168.2.0/24' }],
      objectives: [
        { from: 'Branch-PC', to: '192.168.1.10', text: 'Branch-PC can reach HQ-Server' },
        { from: 'HQ-Server', to: '192.168.2.20', text: 'HQ-Server can reach Branch-PC' }
      ],
      hints: [
        'Start with `show ip ospf neighbor` on both routers. Then `show ip ospf interface g0/1` on R2.',
        'R2’s WAN interface, Gi0/1, is passive. A passive interface sends no hellos, so R1 and R2 never become neighbours and never swap routes.',
        'On R2: `en`, `conf t`, `router ospf 1`, `no passive-interface g0/1`.'
      ],
      explain: 'Passive interfaces are good practice on user-facing LANs: the subnet is still advertised, but no OSPF hellos leak onto it. On a link to another router, passive means no neighbour, no routes. The template’s second step, un-passiving the uplink, was the one that got missed.'
    },
    {
      id: 'p28', day: 6, num: 28, diff: 2, title: 'Wrong Area', topics: ['OSPF', 'Areas'],
      teaser: 'R1 keeps logging errors, and the branch is cut off.',
      ticket: { id: 'INC-2167', pri: 'P2', opened: '09:05' },
      story: 'The branch is meant to be its own OSPF area, area 1, connected to the backbone, area 0, at R2. R2 was configured last night. Since then the branch is cut off from HQ, and R1’s console keeps logging errors.',
      start: 'HQ-PC',
      devices: {
        'HQ-PC': host('pc', 90, 200, '192.168.1.20', M24, '192.168.1.1'),
        R1: Object.assign(rt(310, 200, 'HQ (area 0)', { [G(0)]: { ip: '192.168.1.1', mask: M24 }, [G(1)]: { ip: '10.0.12.1', mask: M30 } }), { ospf: ospf('1.1.1.1', [['192.168.1.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        R2: Object.assign(rt(570, 200, 'Branch ABR', { [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(0)]: { ip: '192.168.2.1', mask: M24 } }), { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 1], ['192.168.2.0', '0.0.0.255', 1]], [G(0)]) }),
        'Branch-PC': host('pc', 810, 200, '192.168.2.20', M24, '192.168.2.1')
      },
      links: [link('HQ-PC', F0, 'R1', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(0), 'Branch-PC', F0)],
      labels: [{ x: 200, y: 120, t: 'Area 0' }, { x: 440, y: 120, t: '10.0.12.0/30' }, { x: 690, y: 120, t: 'Area 1' }],
      objectives: [
        { from: 'HQ-PC', to: '192.168.2.20', text: 'HQ-PC can reach Branch-PC' },
        { from: 'Branch-PC', to: '192.168.1.20', text: 'Branch-PC can reach HQ-PC' }
      ],
      hints: [
        'Read R1’s console log. Then compare `show ip protocols` (or `show ip ospf interface brief`) on both routers, looking at the area of the link between them.',
        'Both ends of a link must be in the same area. R1 put 10.0.12.0/30 in area 0, R2 put it in area 1. R2 is meant to sit on the border: its WAN link in area 0, its LAN in area 1.',
        'On R2: `en`, `conf t`, `router ospf 1`, `no network 10.0.12.0 0.0.0.3 area 1`, then `network 10.0.12.0 0.0.0.3 area 0`.'
      ],
      explain: 'OSPF neighbours check that their hellos agree on the area, among other things. An area border router (ABR) sits between areas, with each interface in exactly one of them. Once R2’s WAN link joins area 0, R1 learns the branch LAN as an inter-area route, marked `O IA` in its routing table.'
    },
    {
      id: 'p29', day: 6, num: 29, diff: 2, title: 'Out of Time', topics: ['OSPF', 'Hello timers'],
      teaser: 'Someone tuned the WAN link for faster failover. On one end.',
      ticket: { id: 'INC-2170', pri: 'P2', opened: '11:40' },
      story: 'Yesterday someone tuned the WAN link for faster failover, on R2 only, then went on leave. Since then the branch has been cut off from HQ. Both routers still show the link as up/up.',
      start: 'Branch-PC',
      devices: {
        'HQ-Server': host('server', 90, 200, '192.168.1.10', M24, '192.168.1.1'),
        R1: Object.assign(rt(310, 200, 'HQ', { [G(0)]: { ip: '192.168.1.1', mask: M24 }, [G(1)]: { ip: '10.0.12.1', mask: M30 } }), { ospf: ospf('1.1.1.1', [['192.168.1.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        R2: Object.assign(rt(570, 200, 'Branch', { [G(1)]: { ip: '10.0.12.2', mask: M30, hello: 5 }, [G(0)]: { ip: '192.168.2.1', mask: M24 } }), { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 0], ['192.168.2.0', '0.0.0.255', 0]], [G(0)]) }),
        'Branch-PC': host('pc', 810, 200, '192.168.2.20', M24, '192.168.2.1')
      },
      links: [link('HQ-Server', F0, 'R1', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(0), 'Branch-PC', F0)],
      labels: [{ x: 200, y: 120, t: '192.168.1.0/24' }, { x: 440, y: 120, t: 'OSPF area 0' }, { x: 690, y: 120, t: '192.168.2.0/24' }],
      objectives: [
        { from: 'Branch-PC', to: '192.168.1.10', text: 'Branch-PC can reach HQ-Server' },
        { from: 'HQ-Server', to: '192.168.2.20', text: 'HQ-Server can reach Branch-PC' }
      ],
      hints: [
        'The link is up but `show ip ospf neighbor` is empty on both routers. Compare `show ip ospf interface g0/1` on each.',
        'R2 sends hellos every 5 seconds with a 20-second dead timer. R1 uses the defaults, 10 and 40. OSPF neighbours must agree on both, so they ignore each other’s hellos.',
        'On R2: `en`, `conf t`, `int g0/1`, `no ip ospf hello-interval`. (Setting R1 to 5 seconds as well also works.)'
      ],
      explain: 'Hello and dead intervals are carried in every OSPF hello, and a router ignores hellos whose timers don’t match its own. Faster timers do speed up failure detection, but only if both ends agree. Changing the hello interval also moves the dead interval to four times the hello, unless you set it yourself.'
    },
    {
      id: 'p30', day: 6, num: 30, diff: 3, title: 'Exactly Zero', topics: ['OSPF', 'Wildcard masks'],
      teaser: 'The lab router joined OSPF yesterday. Nobody has heard from it since.',
      ticket: { id: 'INC-2174', pri: 'P2', opened: '10:00' },
      story: 'The lab router, R3, was added to OSPF yesterday. R1 and R2 are neighbours as always, but R3 never shows up anywhere, and the lab is unreachable. R3’s config “looks right”, says the engineer who wrote it.',
      start: 'HQ-PC',
      devices: {
        'HQ-PC': host('pc', 80, 200, '192.168.1.20', M24, '192.168.1.1'),
        R1: Object.assign(rt(255, 200, 'HQ', { [G(0)]: { ip: '192.168.1.1', mask: M24 }, [G(1)]: { ip: '10.0.12.1', mask: M30 } }), { ospf: ospf('1.1.1.1', [['192.168.1.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        R2: Object.assign(rt(460, 200, 'Core', { [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(2)]: { ip: '10.0.23.1', mask: M30 } }), { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 0], ['10.0.23.0', '0.0.0.3', 0]]) }),
        R3: Object.assign(rt(665, 200, 'Lab', { [G(2)]: { ip: '10.0.23.2', mask: M30 }, [G(0)]: { ip: '172.16.3.1', mask: M24 } }), { ospf: ospf('3.3.3.3', [['10.0.23.0', '0.0.0.0', 0], ['172.16.3.0', '0.0.0.255', 0]], [G(0)]) }),
        'Lab-PC': host('pc', 845, 200, '172.16.3.20', M24, '172.16.3.1')
      },
      links: [link('HQ-PC', F0, 'R1', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(2), 'R3', G(2)), link('R3', G(0), 'Lab-PC', F0)],
      labels: [{ x: 168, y: 120, t: '192.168.1.0/24' }, { x: 358, y: 120, t: '10.0.12.0/30' }, { x: 562, y: 120, t: '10.0.23.0/30' }, { x: 755, y: 120, t: '172.16.3.0/24' }],
      objectives: [
        { from: 'HQ-PC', to: '172.16.3.20', text: 'HQ-PC can reach Lab-PC' },
        { from: 'HQ-PC', to: '10.0.23.1', text: 'HQ-PC can still reach R2' }
      ],
      hints: [
        'On R3, `show ip ospf interface brief` lists the interfaces OSPF is actually running on. Which one is missing?',
        'R3 has `network 10.0.23.0 0.0.0.0 area 0`. A wildcard of 0.0.0.0 means “match this exact address”, and no interface has the address 10.0.23.0. R3’s link address is 10.0.23.2, so OSPF never starts on the link.',
        'On R3: `en`, `conf t`, `router ospf 1`, `no network 10.0.23.0 0.0.0.0 area 0`, then `network 10.0.23.0 0.0.0.3 area 0`. (`network 10.0.23.2 0.0.0.0 area 0` works too.)'
      ],
      explain: 'OSPF network statements match interface addresses using a wildcard mask, just like ACLs. 10.0.23.0 0.0.0.3 matches the whole /30; 10.0.23.2 0.0.0.0 matches just that interface. 10.0.23.0 0.0.0.0 matches an address no interface can have, so the statement silently does nothing.'
    },

    // ---------------- Day 7 ----------------
    {
      id: 'p31', day: 7, num: 31, diff: 1, title: 'Saved by the Bell', topics: ['Default routes', 'Saving config'],
      teaser: 'After a power cut, the office lost the internet.',
      ticket: { id: 'INC-2180', pri: 'P1', opened: '07:20' },
      story: 'There was a power cut overnight. Everything came back up, but the office has no internet. Last week someone added a line to R1 to fix exactly this kind of problem. It worked at the time.',
      start: 'Office-PC',
      devices: edge({ routes: [] }),
      links: edgeLinks(),
      labels: edgeLabels(),
      objectives: [
        { from: 'Office-PC', to: '198.51.100.10', port: 80, text: 'Office-PC can load the website on Web' },
        { from: 'Office-PC2', to: '203.0.113.1', text: 'Office-PC2 can still reach the ISP router' }
      ],
      hints: [
        'The office can reach R1 and even the ISP router next door, but nothing beyond. Read R1’s routing table.',
        '“Gateway of last resort is not set.” R1 has no default route. The one added last week was never saved to the startup config, so the reboot wiped it.',
        'On R1: `en`, `conf t`, `ip route 0.0.0.0 0.0.0.0 203.0.113.1`, then `end` and `copy running-config startup-config`, so it survives the next power cut.'
      ],
      explain: 'Cisco devices run from the running config but boot from the startup config. Any change you don’t save with `copy running-config startup-config` (or `write memory`) disappears at the next reload. The ISP router is directly connected, which is why it still answered; everything else on the internet needs the default route.'
    },
    {
      id: 'p32', day: 7, num: 32, diff: 2, title: 'Inside Out', topics: ['NAT'],
      teaser: 'R1 can reach the internet. Nobody behind it can.',
      ticket: { id: 'INC-2183', pri: 'P1', opened: '08:05' },
      story: 'R1 was rebuilt from scratch last night after a failed upgrade. The whole office has lost the internet. Strangely, R1 itself can ping websites just fine.',
      start: 'Office-PC',
      devices: edge({ g0: { natIn: false } }),
      links: edgeLinks(),
      labels: edgeLabels(),
      objectives: [
        { from: 'Office-PC', to: '198.51.100.10', port: 80, text: 'Office-PC can load the website on Web' },
        { from: 'Office-PC2', to: '198.51.100.10', text: 'Office-PC2 can ping Web' }
      ],
      hints: [
        'Test from Office-PC, then check R1’s translations with `show ip nat translations`. Nothing is being translated.',
        'NAT only translates traffic that arrives on an `ip nat inside` interface and leaves on an `ip nat outside` one. Gi0/1 is marked outside, but the office interface, Gi0/0, isn’t marked at all, so the office’s private addresses go out untranslated and the ISP has no way to reply.',
        'On R1: `en`, `conf t`, `int g0/0`, `ip nat inside`.'
      ],
      explain: 'Private addresses like 192.168.x.x can’t be routed on the internet, so the edge router swaps them for its public address (PAT, `overload`). For that, every interface needs a role: inside or outside. R1’s own pings worked because they already come from its public address.'
    },
    {
      id: 'p33', day: 7, num: 33, diff: 2, title: 'Change of Address', topics: ['NAT', 'ACLs'],
      teaser: 'The office was renumbered. The internet didn’t come with it.',
      ticket: { id: 'INC-2186', pri: 'P1', opened: '07:45' },
      story: 'At the weekend the office was renumbered from 192.168.1.0/24 to 192.168.10.0/24 to make room for growth. Everything inside the office works. Nothing reaches the internet.',
      start: 'Office-PC',
      devices: edge({ acl: '192.168.1.0' }),
      links: edgeLinks(),
      labels: edgeLabels(),
      objectives: [
        { from: 'Office-PC', to: '198.51.100.10', port: 80, text: 'Office-PC can load the website on Web' },
        { from: 'Office-PC', to: '192.168.10.22', text: 'Office-PC can still reach Office-PC2' }
      ],
      hints: [
        'NAT is set up and both interfaces have their roles. Which addresses is it allowed to translate? `show running-config` on R1, then `show access-lists`.',
        'NAT translates addresses that match ACL 1, which still permits the old subnet, 192.168.1.0/24. The new 192.168.10.0/24 never matches, so it’s never translated.',
        'On R1: `en`, `conf t`, `access-list 1 permit 192.168.10.0 0.0.0.255`.'
      ],
      explain: 'The ACL in `ip nat inside source list 1 ...` doesn’t filter traffic; it decides which source addresses get translated. Anything it doesn’t permit leaves untranslated and can’t get replies. Renumbering means finding every place the old subnet is written down: ACLs, NAT, routes, firewall rules.'
    },
    {
      id: 'p34', day: 7, num: 34, diff: 2, title: 'Port Forward', topics: ['Static NAT'],
      teaser: 'The shop works inside the office. Customers can’t reach it.',
      ticket: { id: 'INC-2190', pri: 'P1', opened: '09:00' },
      story: 'The online shop server was moved to a new address, 192.168.10.50, last night. Staff can reach it inside the office, but customers on the internet can’t reach the shop’s public address, 203.0.113.10.',
      start: 'Customer',
      devices: edge({ shop: true }),
      links: edgeLinks({ shop: true }),
      labels: edgeLabels(),
      objectives: [
        { from: 'Customer', to: '203.0.113.10', port: 80, text: 'Customer can load the shop at 203.0.113.10' },
        { from: 'Office-PC', to: '192.168.10.50', port: 80, text: 'Office-PC can still load the shop internally' }
      ],
      hints: [
        'Test from Customer, then look at R1’s NAT entries with `show ip nat translations`.',
        'The static NAT entry still maps the public address 203.0.113.10 to 192.168.10.80, the server’s old address.',
        'On R1: `en`, `conf t`, `no ip nat inside source static 192.168.10.80 203.0.113.10`, then `ip nat inside source static 192.168.10.50 203.0.113.10`.'
      ],
      explain: 'Static NAT permanently maps one public address to one inside address, which is how servers behind NAT are reached from the internet. It points at an address, not a machine, so when a server moves the mapping has to move with it.'
    },
    {
      id: 'p35', day: 7, num: 35, diff: 3, title: 'Default Silence', topics: ['OSPF', 'Default routes', 'NAT'],
      teaser: 'HQ has the internet. The branch, one OSPF hop away, doesn’t.',
      ticket: { id: 'INC-2194', pri: 'P2', opened: '10:30' },
      story: 'The branch was connected to HQ with OSPF last week, and the branch can reach everything at HQ. HQ has internet through R1. The branch doesn’t, even though NAT on R1 was set up for both sites.',
      start: 'Branch-PC',
      devices: edgeOspf({}),
      links: edgeOspfLinks(),
      labels: edgeOspfLabels(),
      objectives: [
        { from: 'Branch-PC', to: '198.51.100.10', port: 80, text: 'Branch-PC can load the website on Web' },
        { from: 'HQ-PC', to: '198.51.100.10', port: 80, text: 'HQ-PC can still load the website' },
        { from: 'Branch-PC', to: '192.168.10.21', text: 'Branch-PC can still reach HQ-PC' }
      ],
      hints: [
        'Look at R2’s routing table. Is there a gateway of last resort?',
        'R1 has a static default route to the ISP, but OSPF doesn’t share static routes unless told to, so R2 never learns any way to the internet.',
        'On R1: `en`, `conf t`, `router ospf 1`, `default-information originate`.'
      ],
      explain: '`default-information originate` makes an OSPF router advertise its default route to everyone else, as an external route (`O*E2` in their routing tables). Only the edge router should do it, and only while it actually has a default route itself.'
    },

    // ---------------- Day 8 ----------------
    {
      id: 'p36', day: 8, num: 36, diff: 1, title: 'Speed Trap', topics: ['Speed and duplex'],
      teaser: 'The uplink to the router is dead, and both ends say they’re fine.',
      ticket: { id: 'INC-2200', pri: 'P1', opened: '08:25' },
      story: 'Yesterday someone “troubleshooting a slow network” hard-coded the speed on both ends of the link between the office switch and the router. Now the office can’t reach anything, not even the router.',
      start: 'Office-PC',
      devices: {
        'Office-PC': host('pc', 100, 110, '192.168.10.21', M24, '192.168.10.1'),
        'Office-PC2': host('pc', 100, 290, '192.168.10.22', M24, '192.168.10.1'),
        SW1: sw(320, 200, 'Office', null, { [G(1)]: { speed: '10', description: 'Uplink to R1' } }),
        R1: rt(560, 200, 'Edge', { [G(0)]: { ip: '192.168.10.1', mask: M24, speed: '100' }, [G(1)]: { ip: '10.3.3.1', mask: M24 } }),
        'App-Server': host('server', 790, 200, '10.3.3.10', M24, '10.3.3.1')
      },
      links: [link('Office-PC', F0, 'SW1', F(1)), link('Office-PC2', F0, 'SW1', F(2)), link('SW1', G(1), 'R1', G(0)), link('R1', G(1), 'App-Server', F0)],
      labels: [{ x: 320, y: 60, t: '192.168.10.0/24' }, { x: 675, y: 120, t: '10.3.3.0/24' }],
      objectives: [
        { from: 'Office-PC', to: '10.3.3.10', text: 'Office-PC can reach App-Server' },
        { from: 'Office-PC2', to: '192.168.10.1', text: 'Office-PC2 can reach R1' }
      ],
      hints: [
        'The office can’t even reach R1. Check the uplink: `show interfaces status` on SW1 and `show interfaces g0/0` on R1.',
        'SW1’s uplink is hard-coded to 10 Mb/s and R1’s port to 100 Mb/s. Two different fixed speeds can’t form a link at all.',
        'On SW1: `en`, `conf t`, `int g0/1`, `speed auto`, `duplex auto`.'
      ],
      explain: 'A duplex mismatch half-works; a speed mismatch doesn’t work at all, because the two ends can’t even agree on how to signal. With one end on auto it will sense the other’s speed and follow it. The safest setting is auto on both ends.'
    },
    {
      id: 'p37', day: 8, num: 37, diff: 1, title: 'Seeing Double', topics: ['IP addressing', 'ARP'],
      teaser: 'Pings to the file server work. The files don’t.',
      ticket: { id: 'INC-2203', pri: 'P3', opened: '09:45' },
      story: 'A new printer went in next to the accounts team yesterday. Since then their PCs can’t open the file server’s shares, even though pinging 192.168.10.10 works. Reception, on the other switch, is fine.',
      start: 'Accounts-PC',
      devices: {
        'Accounts-PC': host('pc', 90, 110, '192.168.10.21', M24, '192.168.10.1'),
        Printer: host('printer', 90, 290, '192.168.10.10', M24, '192.168.10.1', { mac: '3cd9.2b5e.0a17' }),
        SW1: sw(300, 200, 'Accounts'),
        SW2: sw(570, 200, 'Reception'),
        'File-Server': host('server', 800, 110, '192.168.10.10', M24, '192.168.10.1', { mac: '0050.56a1.10fe' }),
        'Reception-PC': host('pc', 800, 290, '192.168.10.31', M24, '192.168.10.1')
      },
      links: [link('Accounts-PC', F0, 'SW1', F(1)), link('Printer', F0, 'SW1', F(2)), link('SW1', G(1), 'SW2', G(1)), link('File-Server', F0, 'SW2', F(1)), link('Reception-PC', F0, 'SW2', F(2))],
      labels: [{ x: 435, y: 60, t: '192.168.10.0/24' }],
      objectives: [
        { from: 'Accounts-PC', to: '192.168.10.10', dev: 'File-Server', text: 'Accounts-PC reaches the real File-Server at .10' },
        { from: 'Accounts-PC', to: '192.168.10.40', text: 'Accounts-PC can reach the Printer at .40' },
        { from: 'Reception-PC', to: '192.168.10.10', dev: 'File-Server', text: 'Reception-PC can still reach File-Server' }
      ],
      hints: [
        'Ping 192.168.10.10 from Accounts-PC and read the status line under the map: who actually answered? `arp -a` shows which MAC address replied.',
        'The new Printer was given the file server’s address, 192.168.10.10. With two devices on one address, whichever answers ARP first gets the traffic, and for the accounts PCs that’s the printer next to them. It was meant to be 192.168.10.40.',
        'Open the Printer’s IP settings tab and set 192.168.10.40, mask 255.255.255.0, gateway 192.168.10.1.'
      ],
      explain: 'A duplicate IP address is a race: ARP asks who has the address, both devices answer, and senders believe whichever reply they use. Ping still “works”, it just reaches the wrong box. `arp -a` showing an unexpected MAC address is the giveaway.'
    },
    {
      id: 'p38', day: 8, num: 38, diff: 2, title: 'Guest Pass', topics: ['ACLs', 'ACL direction'],
      teaser: 'An auditor on the guest Wi-Fi opened the payroll server.',
      ticket: { id: 'INC-2207', pri: 'P1', opened: '14:10' },
      story: 'An auditor sat in reception, joined the guest Wi-Fi, and opened the payroll server. The guest ACL was put in last month and nobody tested it. Guests must keep their internet access, and staff must keep payroll.',
      start: 'Guest-Laptop',
      devices: {
        'Staff-PC': host('pc', 90, 110, '192.168.10.21', M24, '192.168.10.1'),
        'Guest-Laptop': host('pc', 90, 300, '192.168.50.30', M24, '192.168.50.1'),
        Upstream: Object.assign(rt(330, 62, 'Internet', { [G(0)]: { ip: '100.64.0.1', mask: M30 } }, [{ net: '192.168.50.0', mask: M24, nh: '100.64.0.2' }]), { locked: true }),
        R1: Object.assign(rt(330, 220, 'Edge', {
          [G(0)]: { ip: '192.168.10.1', mask: M24, description: 'Staff' },
          [G(1)]: { ip: '10.10.10.1', mask: M24, description: 'Servers' },
          [G(2)]: { ip: '192.168.50.1', mask: M24, description: 'Guest Wi-Fi', aclOut: 'GUEST' },
          [G(3)]: { ip: '100.64.0.2', mask: M30, description: 'Internet' }
        }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '100.64.0.1' }]), { acls: { GUEST: { type: 'ext', entries: [
          { seq: 10, action: 'deny', proto: 'ip', src: net('192.168.50.0', '0.0.0.255'), dst: net('10.10.10.0', '0.0.0.255'), dport: null },
          { seq: 20, action: 'permit', proto: 'ip', src: ANY, dst: ANY, dport: null }
        ] } } }),
        SW1: sw(560, 220, 'Server room'),
        Payroll: host('server', 790, 120, '10.10.10.20', M24, '10.10.10.1', { services: [80], site: 'Payroll' }),
        Wiki: host('server', 790, 300, '10.10.10.30', M24, '10.10.10.1', { services: [80], site: 'Wiki' })
      },
      links: [link('Staff-PC', F0, 'R1', G(0)), link('Guest-Laptop', F0, 'R1', G(2)), link('R1', G(3), 'Upstream', G(0)), link('R1', G(1), 'SW1', G(1)), link('Payroll', F0, 'SW1', F(1)), link('Wiki', F0, 'SW1', F(2))],
      labels: [{ x: 665, y: 52, t: '10.10.10.0/24' }],
      objectives: [
        { from: 'Guest-Laptop', to: '10.10.10.20', blocked: true, text: 'Guest-Laptop can’t reach Payroll' },
        { from: 'Guest-Laptop', to: '100.64.0.1', text: 'Guest-Laptop can still reach the internet' },
        { from: 'Staff-PC', to: '10.10.10.20', text: 'Staff-PC can still reach Payroll' }
      ],
      hints: [
        'The GUEST ACL exists and looks right. Check where it’s applied, and in which direction: `show ip interface g0/2`.',
        'GUEST is applied outbound on the guest interface, so it only checks traffic going to the guests. Guest traffic toward payroll comes in on Gi0/2 and never meets it. Its deny line matches guest source addresses, which only makes sense inbound.',
        'On R1: `en`, `conf t`, `int g0/2`, `no ip access-group GUEST out`, then `ip access-group GUEST in`.'
      ],
      explain: '“In” and “out” are from the router’s point of view: in means traffic arriving on that interface, out means traffic leaving through it. An ACL written about guest source addresses has to see traffic coming from the guests, so it goes inbound on the guest interface. Always test an ACL from the side it’s meant to stop.'
    },
    {
      id: 'p39', day: 8, num: 39, diff: 2, title: 'Backup Plan', topics: ['Floating static routes'],
      teaser: 'The fibre is cut. The 4G backup never kicked in.',
      ticket: { id: 'INC-2211', pri: 'P1', opened: '11:05' },
      story: 'Roadworks cut the branch’s fibre to HQ this morning; the carrier is on it. The branch has a 4G backup link for exactly this, with a backup route that should take over automatically. It didn’t, and the branch is offline.',
      start: 'Branch-PC',
      devices: {
        'Branch-PC': host('pc', 80, 200, '192.168.5.20', M24, '192.168.5.1'),
        R1: rt(270, 200, 'Branch', {
          [G(0)]: { ip: '192.168.5.1', mask: M24 },
          [G(1)]: { ip: '10.0.12.1', mask: M30, description: 'Fibre to HQ' },
          [G(2)]: { ip: '10.0.13.1', mask: '255.255.255.248', description: '4G backup' }
        }, [{ net: '10.10.0.0', mask: '255.255.0.0', nh: '10.0.12.2' }, { net: '10.10.0.0', mask: '255.255.0.0', nh: '10.0.13.30', ad: 250 }]),
        R2: rt(600, 115, 'HQ', {
          [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(2)]: { ip: '10.0.23.2', mask: M30 }, [G(0)]: { ip: '10.10.1.1', mask: '255.255.0.0' }
        }, [{ net: '192.168.5.0', mask: M24, nh: '10.0.12.1' }, { net: '192.168.5.0', mask: M24, nh: '10.0.23.3', ad: 250 }]),
        R3: rt(440, 290, '4G router', { [G(2)]: { ip: '10.0.13.3', mask: '255.255.255.248' }, [G(1)]: { ip: '10.0.23.3', mask: M30 } },
          [{ net: '10.10.0.0', mask: '255.255.0.0', nh: '10.0.23.2' }, { net: '192.168.5.0', mask: M24, nh: '10.0.13.1' }]),
        'HQ-Server': host('server', 820, 115, '10.10.1.50', '255.255.0.0', '10.10.1.1')
      },
      links: [link('Branch-PC', F0, 'R1', G(0)), Object.assign(link('R1', G(1), 'R2', G(1)), { cut: true }), link('R1', G(2), 'R3', G(2)), link('R3', G(1), 'R2', G(2)), link('R2', G(0), 'HQ-Server', F0)],
      labels: [{ x: 440, y: 60, t: 'Fibre (cut)' }, { x: 720, y: 290, t: 'HQ 10.10.0.0/16' }],
      objectives: [
        { from: 'Branch-PC', to: '10.10.1.50', text: 'Branch-PC can reach HQ-Server over the backup' },
        { from: 'Branch-PC', to: '10.0.13.3', text: 'Branch-PC can still reach the 4G router' }
      ],
      hints: [
        'The fibre is down, so the branch should be using the 4G link. Look at R1’s routing table: is there any route to 10.10.0.0/16 at all? Then `show running-config`.',
        'The backup is a floating static route: distance 250, so it stays hidden until the fibre route disappears. Its next hop, 10.0.13.30, isn’t in the 4G link’s subnet (10.0.13.0/29 runs .0 to .7), so it can never be installed. The 4G router is 10.0.13.3.',
        'On R1: `en`, `conf t`, `no ip route 10.10.0.0 255.255.0.0 10.0.13.30 250`, then `ip route 10.10.0.0 255.255.0.0 10.0.13.3 250`.'
      ],
      explain: 'A floating static route has a higher administrative distance than the primary, so it only appears when the primary route is gone. That means it never gets tested until the day you need it. HQ’s return route has its own floating backup, which is why fixing the branch side is enough.'
    },
    {
      id: 'p40', day: 8, num: 40, diff: 3, title: 'Static Cling', topics: ['Administrative distance', 'OSPF'],
      teaser: 'OSPF knows the way to the branch. R1 isn’t listening.',
      ticket: { id: 'INC-2216', pri: 'P2', opened: '09:15' },
      story: 'The branch moved from the old MPLS service to a new link running OSPF yesterday. R1 and R2 became neighbours straight away. HQ still can’t reach the branch. The old MPLS router stays plugged in until the carrier collects it.',
      start: 'HQ-PC',
      devices: {
        'HQ-PC': host('pc', 80, 200, '192.168.1.20', M24, '192.168.1.1'),
        'Old-MPLS': Object.assign(rt(290, 62, 'Carrier', { [G(0)]: { ip: '10.0.99.2', mask: M30 } }), { locked: true }),
        R1: Object.assign(rt(290, 200, 'HQ', {
          [G(0)]: { ip: '192.168.1.1', mask: M24 },
          [G(1)]: { ip: '10.0.12.1', mask: M30, description: 'New link to branch' },
          [G(2)]: { ip: '10.0.99.1', mask: M30, description: 'MPLS (being removed)' }
        }, [{ net: '192.168.2.0', mask: M24, nh: '10.0.99.2' }]), { ospf: ospf('1.1.1.1', [['192.168.1.0', '0.0.0.255', 0], ['10.0.12.0', '0.0.0.3', 0]], [G(0)]) }),
        R2: Object.assign(rt(570, 200, 'Branch', { [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(0)]: { ip: '192.168.2.1', mask: M24 } }), { ospf: ospf('2.2.2.2', [['10.0.12.0', '0.0.0.3', 0], ['192.168.2.0', '0.0.0.255', 0]], [G(0)]) }),
        'Branch-PC': host('pc', 810, 200, '192.168.2.20', M24, '192.168.2.1')
      },
      links: [link('HQ-PC', F0, 'R1', G(0)), link('R1', G(2), 'Old-MPLS', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(0), 'Branch-PC', F0)],
      labels: [{ x: 430, y: 120, t: 'OSPF area 0' }, { x: 690, y: 120, t: '192.168.2.0/24' }],
      objectives: [
        { from: 'HQ-PC', to: '192.168.2.20', text: 'HQ-PC can reach Branch-PC' },
        { from: 'HQ-PC', to: '10.0.12.2', text: 'HQ-PC can still reach R2' }
      ],
      hints: [
        'R1 and R2 are neighbours and R2 advertises the branch LAN. So which route to 192.168.2.0/24 did R1 actually install? Read `show ip route` closely.',
        'A static route from the MPLS days is still there. Static routes have an administrative distance of 1 and OSPF has 110, so the static route wins and sends branch traffic to the old MPLS router, which no longer knows the way.',
        'On R1: `en`, `conf t`, `no ip route 192.168.2.0 255.255.255.0 10.0.99.2`.'
      ],
      explain: 'When two sources offer the same prefix, the router installs the one with the lowest administrative distance: connected 0, static 1, OSPF 110. The OSPF route was there all along, hidden behind the static one. Remove the static route and OSPF’s route takes its place instantly.'
    },

    // ---------------- Day 9 ----------------
    {
      id: 'p41', day: 9, num: 41, diff: 1, title: 'Fat Fingers', topics: ['IP addressing'],
      teaser: 'Reception can’t open the booking system. Everyone else can.',
      ticket: { id: 'INC-2220', pri: 'P2', opened: '08:00' },
      story: 'The reception PC was reimaged last night and its static address typed back in by hand. This morning reception can’t open the booking system. The office PC on the same switch is fine.',
      start: 'Reception-PC',
      devices: {
        'Reception-PC': host('pc', 100, 110, '192.168.100.21', M24, '192.168.10.1'),
        'Office-PC': host('pc', 100, 290, '192.168.10.22', M24, '192.168.10.1'),
        SW1: sw(320, 200, 'Office'),
        R1: rt(560, 200, 'Edge', { [G(0)]: { ip: '192.168.10.1', mask: M24 }, [G(1)]: { ip: '10.4.4.1', mask: M24 } }),
        'Booking-Server': host('server', 790, 200, '10.4.4.40', M24, '10.4.4.1', { services: [80], site: 'Bookings' })
      },
      links: [link('Reception-PC', F0, 'SW1', F(1)), link('Office-PC', F0, 'SW1', F(2)), link('SW1', G(1), 'R1', G(0)), link('R1', G(1), 'Booking-Server', F0)],
      labels: [{ x: 320, y: 60, t: '192.168.10.0/24' }, { x: 675, y: 120, t: '10.4.4.0/24' }],
      objectives: [
        { from: 'Reception-PC', to: '10.4.4.40', port: 80, text: 'Reception-PC can open the booking website' },
        { from: 'Office-PC', to: '10.4.4.40', port: 80, text: 'Office-PC can still open the booking website' }
      ],
      hints: [
        'Compare `ipconfig` on Reception-PC and Office-PC, digit by digit.',
        'Reception-PC is 192.168.100.21 instead of 192.168.10.21. Its requests still reach the server through the gateway, but replies to 192.168.100.21 have nowhere to go: no router knows that subnet.',
        'Open Reception-PC’s IP settings tab and set 192.168.10.21, mask 255.255.255.0, gateway 192.168.10.1.'
      ],
      explain: 'One extra digit puts a PC in a different subnet. Here the request still got out, because the gateway happened to answer, but replies are routed to the address the PC claimed, and no router had a route to 192.168.100.0/24. Asymmetric failures like this are why you test both directions.'
    },
    {
      id: 'p42', day: 9, num: 42, diff: 2, title: 'Third Floor', topics: ['Inter-VLAN routing', 'Trunks'],
      teaser: 'Level 3 can print. Level 3 can’t reach anyone else.',
      ticket: { id: 'INC-2224', pri: 'P2', opened: '09:20' },
      story: 'Level 3 opened this week. Facilities patched the new desks into VLAN 30 on SW1, and the Level 3 team can print to their own printer, but they can’t reach anyone on the other floors.',
      start: 'L3-PC',
      devices: {
        R1: rt(450, 52, 'Router on a stick', {
          [G(0)]: {},
          'GigabitEthernet0/0.10': { encap: 10, ip: '192.168.10.1', mask: M24 },
          'GigabitEthernet0/0.20': { encap: 20, ip: '192.168.20.1', mask: M24 }
        }),
        SW1: sw(450, 200, 'Floors', { 1: 'default', 10: 'STAFF', 20: 'SALES', 30: 'LEVEL3' }, {
          [F(1)]: { vlan: 10 }, [F(2)]: { vlan: 20 }, [F(3)]: { vlan: 30 }, [F(4)]: { vlan: 30 }, [G(1)]: { mode: 'trunk', allowed: [10, 20] }
        }),
        'Staff-PC': host('pc', 140, 305, '192.168.10.21', M24, '192.168.10.1'),
        'Sales-PC': host('pc', 345, 305, '192.168.20.21', M24, '192.168.20.1'),
        'L3-PC': host('pc', 560, 305, '192.168.30.21', M24, '192.168.30.1'),
        'L3-Printer': host('printer', 765, 305, '192.168.30.40', M24, '192.168.30.1')
      },
      links: [link('R1', G(0), 'SW1', G(1)), link('Staff-PC', F0, 'SW1', F(1)), link('Sales-PC', F0, 'SW1', F(2)), link('L3-PC', F0, 'SW1', F(3)), link('L3-Printer', F0, 'SW1', F(4))],
      labels: [{ x: 160, y: 120, t: 'VLANs 10, 20, 30' }, { x: 745, y: 120, t: 'L3: 192.168.30.0/24' }],
      objectives: [
        { from: 'L3-PC', to: '192.168.10.21', text: 'L3-PC can reach Staff-PC' },
        { from: 'L3-PC', to: '192.168.30.40', text: 'L3-PC can still reach L3-Printer' },
        { from: 'Sales-PC', to: '192.168.10.21', text: 'Sales-PC can still reach Staff-PC' }
      ],
      hints: [
        'Level 3 can reach its own printer but not its gateway, 192.168.30.1. Who should own that address? Check R1’s interfaces with `show ip interface brief`, and the trunk to R1 with `show interfaces trunk` on SW1.',
        'Two things are missing. R1 has no subinterface for VLAN 30, and the trunk to R1 only allows VLANs 10 and 20.',
        'On SW1: `en`, `conf t`, `int g0/1`, `switchport trunk allowed vlan add 30`. On R1: `en`, `conf t`, `interface g0/0.30`, `encapsulation dot1Q 30`, `ip address 192.168.30.1 255.255.255.0`.'
      ],
      explain: 'A new VLAN on a router-on-a-stick needs three things: the VLAN on the access ports, the VLAN allowed on the trunk to the router, and a subinterface on the router tagged for it with the gateway address. Facilities did the first. Fixing one of the other two still leaves Level 3 cut off, which is why it pays to test after each change.'
    },
    {
      id: 'p43', day: 9, num: 43, diff: 2, title: 'Helper Hops', topics: ['DHCP relay', 'Static routes'],
      teaser: 'The relay is configured. Laptops still get 169.254 addresses.',
      ticket: { id: 'INC-2229', pri: 'P2', opened: '10:10' },
      story: 'The new remote site went live yesterday. R2 relays DHCP to the server at HQ, and the server has a scope for the site. Laptops still come up with 169.254 addresses, and the site’s printer, which has a fixed address, can’t reach HQ either.',
      start: 'Remote-Laptop',
      devices: {
        'DC-Server': host('server', 90, 200, '10.1.1.5', M24, '10.1.1.1', { dhcpd: { pools: { REMOTE: { network: '192.168.70.0', mask: M24, router: '192.168.70.1', dns: '10.1.1.5' } }, excluded: [['192.168.70.1', '192.168.70.50']], bindings: {} } }),
        R1: rt(300, 200, 'HQ', { [G(0)]: { ip: '10.1.1.1', mask: M24 }, [G(1)]: { ip: '10.0.12.1', mask: M30, description: 'To remote site' } }),
        R2: rt(530, 200, 'Remote', { [G(1)]: { ip: '10.0.12.2', mask: M30 }, [G(0)]: { ip: '192.168.70.1', mask: M24, helper: ['10.1.1.5'] } }, [{ net: '0.0.0.0', mask: '0.0.0.0', nh: '10.0.12.1' }]),
        SW1: sw(690, 200, 'Remote'),
        'Remote-Laptop': apipa('pc', 830, 110, '169.254.140.9', { mac: 'f875.a4c0.7001' }),
        'Remote-Printer': host('printer', 830, 290, '192.168.70.40', M24, '192.168.70.1')
      },
      links: [link('DC-Server', F0, 'R1', G(0)), link('R1', G(1), 'R2', G(1)), link('R2', G(0), 'SW1', G(1)), link('Remote-Laptop', F0, 'SW1', F(1)), link('Remote-Printer', F0, 'SW1', F(2))],
      labels: [{ x: 195, y: 120, t: '10.1.1.0/24' }, { x: 415, y: 120, t: '10.0.12.0/30' }, { x: 690, y: 52, t: '192.168.70.0/24' }],
      objectives: [
        { from: 'Remote-Laptop', dhcp: true, text: 'Remote-Laptop gets an address from DHCP' },
        { from: 'Remote-Laptop', to: '10.1.1.5', text: 'Remote-Laptop can reach DC-Server' },
        { from: 'Remote-Printer', to: '10.1.1.5', text: 'Remote-Printer can reach DC-Server' }
      ],
      hints: [
        'R2 is relaying to 10.1.1.5, so the request does reach the server. Can the server’s reply get back? Try `ping 192.168.70.1` from DC-Server, or `tracert` from Remote-Printer.',
        'The server sends its offer to the relay’s address, 192.168.70.1, and R1 has no route to 192.168.70.0/24. The printer’s replies die the same way.',
        'On R1: `en`, `conf t`, `ip route 192.168.70.0 255.255.255.0 10.0.12.2`. Then on Remote-Laptop: `ipconfig /renew`.'
      ],
      explain: 'A DHCP relay is a round trip: the relay forwards the request to the server, and the server sends its offer back to the relay’s own address on the client subnet. That address has to be routable from the server’s side. R2 had a default route toward HQ, so requests got out; nothing knew the way back.'
    },
    {
      id: 'p44', day: 9, num: 44, diff: 3, title: 'Double Trouble', topics: ['Trunks', 'Native VLAN', 'Allowed VLANs'],
      teaser: 'Two engineers each fixed the trunk. Now two things are broken.',
      ticket: { id: 'INC-2233', pri: 'P1', opened: '07:40' },
      story: 'Two engineers each “fixed” the trunk between Level 3 and Level 4 last night, one on each switch, without telling the other. Now staff can’t reach the other floor, and the cameras on Level 3 stopped recording to the NVR on Level 4.',
      start: 'Staff-PC1',
      devices: {
        SW1: sw(250, 100, 'Level 3', { 1: 'default', 10: 'STAFF', 20: 'CAMERAS' }, { [F(1)]: { vlan: 10 }, [F(2)]: { vlan: 20 }, [G(1)]: { mode: 'trunk', native: 10 } }),
        SW2: sw(650, 100, 'Level 4', { 1: 'default', 10: 'STAFF', 20: 'CAMERAS' }, { [F(1)]: { vlan: 10 }, [F(2)]: { vlan: 20 }, [G(1)]: { mode: 'trunk', allowed: [1, 10] } }),
        'Staff-PC1': host('pc', 120, 285, '192.168.10.11', M24, '192.168.10.1'),
        'Camera-L3': host('camera', 380, 285, '192.168.20.31', M24, '192.168.20.1'),
        'Staff-PC2': host('pc', 520, 285, '192.168.10.12', M24, '192.168.10.1'),
        NVR: host('server', 780, 285, '192.168.20.50', M24, '192.168.20.1')
      },
      links: [link('SW1', G(1), 'SW2', G(1)), link('Staff-PC1', F0, 'SW1', F(1)), link('Camera-L3', F0, 'SW1', F(2)), link('Staff-PC2', F0, 'SW2', F(1)), link('NVR', F0, 'SW2', F(2))],
      labels: [{ x: 450, y: 372, t: 'STAFF VLAN 10: 192.168.10.0/24 · CAMERAS VLAN 20: 192.168.20.0/24' }],
      objectives: [
        { from: 'Staff-PC1', to: '192.168.10.12', text: 'Staff-PC1 (Level 3) can reach Staff-PC2 (Level 4)' },
        { from: 'NVR', to: '192.168.20.31', text: 'NVR can reach Camera-L3' }
      ],
      hints: [
        'There are two faults, one per switch. Start with SW1’s console log, then compare `show interfaces trunk` on both switches.',
        'SW1’s native VLAN is 10, so it sends staff traffic untagged and SW2 files it into VLAN 1. Separately, SW2 only allows VLANs 1 and 10 on the trunk, so camera traffic in VLAN 20 is dropped.',
        'On SW1: `en`, `conf t`, `int g0/1`, `switchport trunk native vlan 1`. On SW2: `en`, `conf t`, `int g0/1`, `switchport trunk allowed vlan add 20`.'
      ],
      explain: 'Two faults with two symptoms is a good reason to fix one, retest, and look again. Both ends of a trunk must agree on the native VLAN, and both must allow every VLAN that needs to cross. `show interfaces trunk` on both ends, side by side, shows both problems at once.'
    },
    {
      id: 'p45', day: 9, num: 45, diff: 3, title: 'Friday the 13th', topics: ['OSPF', 'Default routes', 'NAT'],
      teaser: 'A new branch router: no HQ, no internet, and no neighbours.',
      ticket: { id: 'INC-2238', pri: 'P1', opened: '08:13' },
      story: 'A new branch router went in yesterday, built from the standard template, and the branch was meant to get everything through HQ, internet included. The branch has nothing: no HQ, no internet. It’s Friday the 13th, so expect more than one problem.',
      start: 'Branch-PC',
      devices: edgeOspf({ passiveWan: true }),
      links: edgeOspfLinks(),
      labels: edgeOspfLabels(),
      objectives: [
        { from: 'Branch-PC', to: '192.168.10.21', text: 'Branch-PC can reach HQ-PC' },
        { from: 'Branch-PC', to: '198.51.100.10', port: 80, text: 'Branch-PC can load the website on Web' },
        { from: 'HQ-PC', to: '198.51.100.10', port: 80, text: 'HQ-PC can still load the website' }
      ],
      hints: [
        'Start with `show ip ospf neighbor` on R1 and R2. Fix what you find, test again, then read R2’s routing table.',
        'First: R2’s WAN interface, Gi0/1, is passive, so there’s no OSPF neighbour. Second: even once they’re neighbours, R1 doesn’t advertise its default route, so the branch has no way to the internet.',
        'On R2: `en`, `conf t`, `router ospf 1`, `no passive-interface g0/1`. On R1: `en`, `conf t`, `router ospf 1`, `default-information originate`.'
      ],
      explain: 'Layered faults hide behind each other: until the neighbour came up, the missing default route was invisible. Fix, retest, re-read. Once R1 originates its default route, R2 learns `O*E2 0.0.0.0/0`, and R1’s NAT, which already covered the branch subnet, does the rest.'
    }

  ];

  if (typeof module !== 'undefined' && module.exports) { module.exports = PUZZLES; module.exports.DAYS = DAYS; }
  else { root.OUTAGE_PUZZLES = PUZZLES; root.OUTAGE_DAYS = DAYS; }
})(typeof window !== 'undefined' ? window : globalThis);
