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

  // Each day is one switch in the rack. A day appears on its date (the player's local time), so you can add days in advance.
  const DAYS = { 1: '2026-11-02', 2: '2026-11-03' };

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
    }
  ];

  if (typeof module !== 'undefined' && module.exports) { module.exports = PUZZLES; module.exports.DAYS = DAYS; }
  else { root.OUTAGE_PUZZLES = PUZZLES; root.OUTAGE_DAYS = DAYS; }
})(typeof window !== 'undefined' ? window : globalThis);
