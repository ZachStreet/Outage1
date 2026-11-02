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
  const host = (type, x, y, ip, mask, gw) => ({ type, x, y, ip, mask, gw });
  const link = (a, ai, b, bi) => ({ a, ai, b, bi });
  const M24 = '255.255.255.0';

  const PUZZLES = [
    {
      id: 'p1', num: 1, diff: 1, title: 'Lights Out', topics: ['Interfaces'],
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
      id: 'p2', num: 2, diff: 1, title: 'Wrong Room', topics: ['VLANs', 'Access ports'],
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
      id: 'p3', num: 3, diff: 2, title: 'Lost Gateway', topics: ['Default gateway', 'ARP'],
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
      id: 'p4', num: 4, diff: 2, title: 'Trunk Trouble', topics: ['Trunks', '802.1Q'],
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
      id: 'p5', num: 5, diff: 3, title: 'One-Way Street', topics: ['Static routes', 'Return path'],
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
    }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = PUZZLES;
  else root.OUTAGE_PUZZLES = PUZZLES;
})(typeof window !== 'undefined' ? window : globalThis);
