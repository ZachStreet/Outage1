/* Outage simulation engine: network model, packet walker, IOS-style shell, PC shell. No DOM. */
(function (root) {
  'use strict';

  // ---------- addressing helpers ----------
  const ip2n = s => s.split('.').reduce((a, o) => a * 256 + Number(o), 0) >>> 0;
  const n2ip = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
  const isIP = s => typeof s === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(o => Number(o) <= 255);
  const isMask = s => { if (!isIP(s)) return false; const inv = (~ip2n(s)) >>> 0; return ((inv + 1) & inv) === 0; };
  const prefixLen = m => { let n = ip2n(m), c = 0; while (n) { c += n & 1; n = n >>> 1; } return c; };
  const netOf = (ip, m) => (ip2n(ip) & ip2n(m)) >>> 0;
  const inNet = (ip, net, m) => netOf(ip, m) === netOf(net, m);
  const HOSTS = ['pc', 'server', 'printer', 'camera'];
  const IF_TYPES = [['GigabitEthernet', 'Gi'], ['FastEthernet', 'Fa']];
  const shortIf = n => { for (const [l, s] of IF_TYPES) if (n.indexOf(l) === 0) return s + n.slice(l.length); return n; };
  const cdpIf = n => n.replace(/^GigabitEthernet/, 'Gig ').replace(/^FastEthernet/, 'Fas ');
  // Router subinterfaces (router on a stick) are named like GigabitEthernet0/0.20.
  const isSub = n => n.indexOf('.') >= 0;
  const parentIf = n => n.split('.')[0];
  const ifNums = n => (n.match(/\d+/g) || []).map(Number);
  const ifSort = (a, b) => { const x = ifNums(a), y = ifNums(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if (x[i] === undefined) return -1; if (y[i] === undefined) return 1; if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };
  const uniqSort = a => Array.from(new Set(a)).sort((x, y) => x - y);
  const pad = (s, n) => { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); };
  const L = (t, s) => ({ t, s });

  function parseVlanList(s) {
    const out = [];
    for (const part of s.split(',')) {
      if (!/^\d+(-\d+)?$/.test(part)) return null;
      const [a, b] = part.split('-').map(Number);
      if (a < 1 || a > 4094) return null;
      if (b === undefined) { out.push(a); continue; }
      if (b < a || b > 4094) return null;
      for (let v = a; v <= b; v++) out.push(v);
    }
    return uniqSort(out);
  }
  function fmtVlans(list) {
    if (list === 'all') return '1-4094';
    if (!list.length) return 'none';
    const parts = []; let s = list[0], p = list[0];
    for (let i = 1; i <= list.length; i++) {
      const v = list[i];
      if (v === p + 1) { p = v; continue; }
      parts.push(s === p ? String(s) : s + '-' + p);
      s = p = v;
    }
    return parts.join(',');
  }
  const vlanAllowed = (port, v) => port.allowed === 'all' || port.allowed.indexOf(v) >= 0;

  // ---------- network model ----------
  class Network {
    constructor(def) {
      this.devices = JSON.parse(JSON.stringify(def.devices));
      this.links = def.links.map(l => Object.assign({}, l));
      this.arp = new Set();
      this.version = 0;
    }
    touch() { this.arp.clear(); this.version++; }
    isHost(name) { return HOSTS.indexOf(this.devices[name].type) >= 0; }
    isRouter(name) { return this.devices[name].type === 'router'; }
    ifaceNames(name) {
      const d = this.devices[name];
      if (d.type === 'router') return Object.keys(d.ifaces).sort(ifSort);
      if (d.type === 'switch') return Object.keys(d.ports);
      return ['FastEthernet0'];
    }
    ifaceCfg(name, ifn) {
      const d = this.devices[name];
      if (d.type === 'router') return d.ifaces[ifn];
      if (d.type === 'switch') return d.ports[ifn];
      return d;
    }
    // allowNew lets `interface g0/0.20` create a subinterface on a router, like IOS does.
    resolveIf(name, token, allowNew) {
      const m = /^([a-z]+)(\d+(?:\/\d+)*)(?:\.(\d+))?$/i.exec(token);
      if (!m) return null;
      const pre = m[1].toLowerCase(), names = this.ifaceNames(name);
      for (const [long] of IF_TYPES) {
        if (long.toLowerCase().indexOf(pre) !== 0) continue;
        const full = long + m[2];
        if (names.indexOf(full) < 0) continue;
        if (m[3] === undefined) return full;
        if (!this.isRouter(name) || +m[3] < 1 || +m[3] > 4094) return null;
        const sub = full + '.' + Number(m[3]);
        return names.indexOf(sub) >= 0 || allowNew ? sub : null;
      }
      return null;
    }
    subFor(name, phys, vlan) {
      const d = this.devices[name];
      return Object.keys(d.ifaces).find(k => isSub(k) && parentIf(k) === phys && d.ifaces[k].encap === vlan) || null;
    }
    adminUp(name, ifn) {
      if (this.isHost(name)) return true;
      const c = this.ifaceCfg(name, ifn);
      if (isSub(ifn)) return !!c && !c.shutdown && this.adminUp(name, parentIf(ifn));
      return !!c && !c.shutdown;
    }
    peer(name, ifn) {
      ifn = parentIf(ifn);
      for (let i = 0; i < this.links.length; i++) {
        const l = this.links[i];
        if (l.a === name && l.ai === ifn) return { dev: l.b, ifn: l.bi, link: i };
        if (l.b === name && l.bi === ifn) return { dev: l.a, ifn: l.ai, link: i };
      }
      return null;
    }
    linkUp(i) { const l = this.links[i]; return this.adminUp(l.a, l.ai) && this.adminUp(l.b, l.bi); }
    status(name, ifn) {
      if (isSub(ifn)) {
        const c = this.ifaceCfg(name, ifn);
        if (c && c.shutdown) return { status: 'administratively down', protocol: 'down' };
        const ps = this.status(name, parentIf(ifn));
        return ps.status === 'administratively down' ? { status: 'down', protocol: 'down' } : ps;
      }
      if (!this.adminUp(name, ifn)) return { status: 'administratively down', protocol: 'down' };
      const p = this.peer(name, ifn);
      if (!p || !this.adminUp(p.dev, p.ifn)) return { status: 'down', protocol: 'down' };
      return { status: 'up', protocol: 'up' };
    }
    l3If(name, ifn) {
      const d = this.devices[name];
      if (this.isHost(name)) return d.ip && d.mask ? { ip: d.ip, mask: d.mask } : null;
      if (d.type === 'router') {
        const c = d.ifaces[ifn];
        if (!c || !c.ip || (isSub(ifn) && !c.encap) || this.status(name, ifn).protocol !== 'up') return null;
        return { ip: c.ip, mask: c.mask };
      }
      return null;
    }
    owns(name, ip) {
      const d = this.devices[name];
      if (this.isHost(name)) return d.ip === ip;
      if (d.type === 'router') return Object.keys(d.ifaces).some(n => d.ifaces[n].ip === ip && this.status(name, n).protocol === 'up');
      return false;
    }

    // Layer 2: every L3 endpoint an untagged frame from (srcDev, srcIf) can reach, plus the links it crossed.
    l2(srcDev, srcIf) {
      const endpoints = [], edges = [];
      if (!this.adminUp(srcDev, srcIf)) return { endpoints, edges };
      const seen = new Set();
      // A subinterface sends out of its physical port, tagged with its dot1Q VLAN.
      let start = { from: srcDev, fromIf: srcIf, vlan: null, tagged: false, path: [] };
      if (isSub(srcIf)) {
        const c = this.ifaceCfg(srcDev, srcIf);
        if (!c || !c.encap) return { endpoints, edges };
        start = { from: srcDev, fromIf: parentIf(srcIf), vlan: c.encap, tagged: true, path: [] };
      }
      const q = [start];
      while (q.length) {
        const f = q.shift();
        const p = this.peer(f.from, f.fromIf);
        if (!p || !this.linkUp(p.link)) continue;
        const hop = { link: p.link, from: f.from, to: p.dev };
        const path = f.path.concat([hop]);
        edges.push(hop);
        const d = this.devices[p.dev];
        if (d.type === 'router') {
          // Tagged frames land on the subinterface for that VLAN; untagged ones on the physical port.
          if (!f.tagged) endpoints.push({ dev: p.dev, ifn: p.ifn, path });
          else { const sub = this.subFor(p.dev, p.ifn, f.vlan); if (sub && this.adminUp(p.dev, sub)) endpoints.push({ dev: p.dev, ifn: sub, path }); }
          continue;
        }
        if (d.type !== 'switch') { if (!f.tagged) endpoints.push({ dev: p.dev, ifn: p.ifn, path }); continue; }
        const port = d.ports[p.ifn];
        let v;
        if (port.mode === 'trunk') { v = f.tagged ? f.vlan : (port.native || 1); if (!vlanAllowed(port, v)) continue; }
        else { if (f.tagged) continue; v = port.vlan; }
        if (!d.vlans[v]) continue;
        const key = p.dev + '|' + v;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const out of Object.keys(d.ports)) {
          if (out === p.ifn) continue;
          const op = d.ports[out];
          if (op.shutdown) continue;
          if (op.mode === 'trunk') {
            if (!vlanAllowed(op, v)) continue;
            q.push({ from: p.dev, fromIf: out, vlan: v, tagged: v !== (op.native || 1), path });
          } else if (op.vlan === v) {
            q.push({ from: p.dev, fromIf: out, vlan: v, tagged: false, path });
          }
        }
      }
      return { endpoints, edges };
    }

    routes(name) {
      const d = this.devices[name], out = [];
      for (const n of Object.keys(d.ifaces)) {
        const c = d.ifaces[n];
        if (!c.ip || (isSub(n) && !c.encap) || this.status(name, n).protocol !== 'up') continue;
        out.push({ code: 'C', net: n2ip(netOf(c.ip, c.mask)), mask: c.mask, ifn: n, nh: null });
        out.push({ code: 'L', net: c.ip, mask: '255.255.255.255', ifn: n, nh: null });
      }
      for (const r of d.routes || []) {
        const ex = out.find(e => e.code === 'C' && inNet(r.nh, e.net, e.mask));
        if (ex) out.push({ code: r.net === '0.0.0.0' && r.mask === '0.0.0.0' ? 'S*' : 'S', net: r.net, mask: r.mask, ifn: ex.ifn, nh: r.nh });
      }
      return out;
    }
    lookup(name, dst) {
      let best = null, bl = -1;
      for (const e of this.routes(name)) {
        if (!inNet(dst, e.net, e.mask)) continue;
        const pl = prefixLen(e.mask);
        if (pl > bl || (pl === bl && e.code === 'C' && best.code !== 'C')) { best = e; bl = pl; }
      }
      return best;
    }

    // Trunks whose two ends disagree on the native VLAN. CDP reports these on both switches.
    nativeMismatches() {
      const out = [];
      this.links.forEach((l, i) => {
        const A = this.devices[l.a], B = this.devices[l.b];
        if (A.type !== 'switch' || B.type !== 'switch' || !this.linkUp(i)) return;
        const pa = A.ports[l.ai], pb = B.ports[l.bi];
        if (pa.mode !== 'trunk' || pb.mode !== 'trunk') return;
        const na = pa.native || 1, nb = pb.native || 1;
        if (na === nb) return;
        out.push({ dev: l.a, ifn: l.ai, native: na, peer: B.hostname || l.b, peerIf: l.bi, peerNative: nb });
        out.push({ dev: l.b, ifn: l.bi, native: nb, peer: A.hostname || l.a, peerIf: l.ai, peerNative: na });
      });
      return out.map(m => Object.assign(m, { line: '%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ' + m.ifn + ' (' + m.native + '), with ' + m.peer + ' ' + m.peerIf + ' (' + m.peerNative + ').' }));
    }

    // One-way packet walk from a device toward dst.
    route(src, dst) {
      const hops = [], arrivals = [], resolutions = [];
      let cur = src, srcIP = null, ttl = 12;
      const fail = (at, kind, nh) => ({ ok: false, hops, arrivals, resolutions, at, kind, nh: nh || null, srcIP });
      while (ttl-- > 0) {
        const d = this.devices[cur];
        if (this.owns(cur, dst)) return { ok: true, hops, arrivals, resolutions, dev: cur, srcIP };
        let egress, nh;
        if (this.isHost(cur)) {
          if (!d.ip || !d.mask) return fail(cur, 'noip');
          if (srcIP === null) srcIP = d.ip;
          if (inNet(dst, d.ip, d.mask)) nh = dst;
          else if (!d.gw) return fail(cur, 'nogw');
          else nh = d.gw;
          egress = 'FastEthernet0';
        } else if (d.type === 'router') {
          const r = this.lookup(cur, dst);
          if (!r) return fail(cur, 'noroute');
          egress = r.ifn; nh = r.nh || dst;
          if (srcIP === null) srcIP = d.ifaces[egress].ip;
        } else return fail(cur, 'noroute');
        const dom = this.l2(cur, egress);
        const t = dom.endpoints.find(e => { const l3 = this.l3If(e.dev, e.ifn); return l3 && l3.ip === nh; });
        if (!t) { dom.edges.forEach(h => hops.push(Object.assign({ flood: true }, h))); return fail(cur, 'arp', nh); }
        resolutions.push(cur + '>' + nh);
        t.path.forEach(h => hops.push(h));
        cur = t.dev;
        if (this.isRouter(cur)) arrivals.push({ dev: cur, ip: this.l3If(t.dev, t.ifn).ip });
      }
      return fail(cur, 'ttl');
    }

    // Round trip. silent=true leaves the ARP cache alone (used for win checks).
    ping(src, dst, opts) {
      const silent = !!(opts && opts.silent);
      const f = this.route(src, dst);
      if (!f.ok) return { ok: false, stage: 'request', kind: f.kind, at: f.at, nh: f.nh, dst, fwd: f, back: null, srcIP: f.srcIP };
      if (f.dev === src) return { ok: true, stage: 'done', dst, dstDev: src, fwd: f, back: { ok: true, hops: [], arrivals: [], resolutions: [] }, srcIP: dst, arpMiss: false };
      const b = this.route(f.dev, f.srcIP);
      const ok = b.ok && b.dev === src;
      const miss = ok && f.resolutions.some(k => !this.arp.has(k));
      if (ok && !silent) f.resolutions.concat(b.resolutions).forEach(k => this.arp.add(k));
      return { ok, stage: ok ? 'done' : 'reply', kind: ok ? null : b.kind, at: ok ? null : b.at, nh: b.nh, dst, dstDev: f.dev, fwd: f, back: b, srcIP: f.srcIP, arpMiss: miss };
    }

    tracert(src, dst) {
      const f = this.route(src, dst), rows = [];
      if (!f.srcIP) return { rows, done: false, noip: true };
      f.arrivals.forEach(a => { const b = this.route(a.dev, f.srcIP); rows.push(b.ok && b.dev === src ? a.ip : null); });
      let done = false;
      if (f.ok && f.dev !== src) {
        const b = this.route(f.dev, f.srcIP), ok = b.ok && b.dev === src;
        if (this.isRouter(f.dev)) rows[rows.length - 1] = ok ? dst : null; else rows.push(ok ? dst : null);
        done = ok;
      }
      return { rows, done };
    }
  }

  // ---------- IOS-style shell ----------
  const MODES = { user: 'U', priv: 'P', config: 'C', 'config-if': 'I', 'config-vlan': 'V' };
  const PARAMS = ['IP', 'MASK', 'IFACE', 'VLAN', 'VLANLIST', 'WORD', 'LINE'];
  const isParam = p => PARAMS.indexOf(p) >= 0;
  const KW_HELP = {
    enable: 'Turn on privileged commands', disable: 'Turn off privileged commands', configure: 'Enter configuration mode',
    terminal: 'Configure from the terminal', show: 'Show running system information', ping: 'Send echo messages',
    exit: 'Exit from the EXEC', end: 'Exit to privileged EXEC mode', interface: 'Select an interface to configure',
    shutdown: 'Shutdown the selected interface', no: 'Negate a command or set its defaults', ip: 'IP configuration subcommands',
    address: 'Set the IP address of an interface', route: 'IP routing table / static routes', hostname: "Set system's network name",
    vlan: 'VLAN commands', name: 'Ascii name of the VLAN', switchport: 'Set switching mode characteristics',
    mode: 'Set trunking mode of the interface', access: 'Set access mode characteristics of the interface',
    trunk: 'Set trunking characteristics of the interface', allowed: 'Set allowed VLAN characteristics when interface is in trunking mode',
    native: 'Set trunking native characteristics when interface is in trunking mode', add: 'add VLANs to the current list',
    remove: 'remove VLANs from the current list', all: 'all VLANs', 'running-config': 'Current operating configuration',
    interfaces: 'Interface status and configuration', brief: 'Brief summary of IP status and configuration', status: 'Show interface line status',
    description: 'Interface specific description', do: 'To run exec commands in config mode', write: 'Write running configuration to memory',
    memory: 'Write to NV memory', copy: 'Copy from one file to another', 'startup-config': 'Copy to startup configuration',
    encapsulation: 'Set encapsulation type for an interface', dot1q: 'IEEE 802.1Q Virtual LAN', cdp: 'CDP information',
    neighbors: 'CDP neighbor entries'
  };
  const PARAM_SHOW = { IP: ['A.B.C.D', 'IP address'], MASK: ['A.B.C.D', 'IP subnet mask'], VLAN: ['<1-4094>', 'VLAN ID'], VLANLIST: ['WORD', 'VLAN IDs of the allowed VLANs, e.g. 10,20,30-40'], WORD: ['WORD', 'Name'], LINE: ['LINE', 'Text'] };

  function tokenize(line) {
    const toks = [], re = /\S+/g; let m;
    while ((m = re.exec(line))) toks.push({ s: m[0], pos: m.index });
    for (let i = 0; i < toks.length - 1; i++) {
      if (/^[a-z]+$/i.test(toks[i].s) && /^\d+(\/\d+)+(\.\d+)?$/.test(toks[i + 1].s)) { toks[i] = { s: toks[i].s + toks[i + 1].s, pos: toks[i].pos }; toks.splice(i + 1, 1); }
    }
    return toks;
  }

  const CMDS = [
    { m: 'UP', p: ['enable'], f() { this.mode = 'priv'; } },
    { m: 'P', p: ['disable'], f() { this.mode = 'user'; } },
    { m: 'UP', p: ['exit'], f() { this.mode = 'user'; return [L('dim', ''), L('dim', this.host() + ' con0 is now available'), L('dim', ''), L('dim', 'Press RETURN to get started.')]; } },
    { m: 'UP', p: ['ping', 'IP'], f(v) { return this.ping(v[0]); } },
    { m: 'UP', p: ['show', 'ip', 'interface', 'brief'], f() { return this.showIpIntBrief(); } },
    { m: 'UP', t: 'R', p: ['show', 'ip', 'route'], f() { return this.showIpRoute(); } },
    { m: 'UP', t: 'S', p: ['show', 'vlan', 'brief'], f() { return this.showVlanBrief(); } },
    { m: 'UP', t: 'S', p: ['show', 'interfaces', 'trunk'], f() { return this.showTrunk(); } },
    { m: 'UP', t: 'S', p: ['show', 'interfaces', 'status'], f() { return this.showIntStatus(); } },
    { m: 'UP', t: 'S', p: ['show', 'interfaces', 'switchport'], f() { return this.showSwitchport(); } },
    { m: 'UP', p: ['show', 'cdp', 'neighbors'], f() { return this.showCdp(); } },
    { m: 'P', p: ['show', 'running-config'], f() { return this.showRun(); } },
    { m: 'P', p: ['configure', 'terminal'], f() { this.mode = 'config'; return [L('out', 'Enter configuration commands, one per line.  End with CNTL/Z.')]; } },
    { m: 'P', p: ['write', 'memory'], f() { return [L('out', 'Building configuration...'), L('out', '[OK]')]; } },
    { m: 'P', p: ['copy', 'running-config', 'startup-config'], f() { return [L('out', 'Destination filename [startup-config]? '), L('out', 'Building configuration...'), L('out', '[OK]')]; } },
    { m: 'C', p: ['hostname', 'WORD'], f(v) { this.d.hostname = v[0]; } },
    { m: 'CI', p: ['interface', 'IFACE'], f(v) {
      if (!this.net.ifaceCfg(this.name, v[0])) { this.d.ifaces[v[0]] = { ip: null, mask: null, shutdown: false, encap: null }; this.net.touch(); }
      this.mode = 'config-if'; this.ifn = v[0];
    } },
    { m: 'C', t: 'R', p: ['ip', 'route', 'IP', 'MASK', 'IP'], f(v) {
      const [net, mask, nh] = v;
      if (netOf(net, mask) !== ip2n(net)) return [L('err', '%Inconsistent address and mask')];
      const rs = this.d.routes = this.d.routes || [];
      if (!rs.some(r => r.net === net && r.mask === mask && r.nh === nh)) { rs.push({ net, mask, nh }); this.net.touch(); }
    } },
    { m: 'C', t: 'R', p: ['no', 'ip', 'route', 'IP', 'MASK', 'IP'], f(v) {
      const rs = this.d.routes || [], i = rs.findIndex(r => r.net === v[0] && r.mask === v[1] && r.nh === v[2]);
      if (i < 0) return [L('err', '%No matching route to delete')];
      rs.splice(i, 1); this.net.touch();
    } },
    { m: 'C', t: 'S', p: ['vlan', 'VLAN'], f(v) { const id = v[0]; if (!this.d.vlans[id]) { this.d.vlans[id] = 'VLAN' + String(id).padStart(4, '0'); this.net.touch(); } this.mode = 'config-vlan'; this.vlan = id; } },
    { m: 'C', t: 'S', p: ['no', 'vlan', 'VLAN'], f(v) { if (v[0] === 1) return [L('err', '%Default VLAN 1 may not be deleted.')]; delete this.d.vlans[v[0]]; this.net.touch(); } },
    { m: 'V', p: ['name', 'WORD'], f(v) { this.d.vlans[this.vlan] = v[0]; this.net.touch(); } },
    { m: 'I', p: ['shutdown'], f() { return this.setShut(true); } },
    { m: 'I', p: ['no', 'shutdown'], f() { return this.setShut(false); } },
    { m: 'I', p: ['description', 'LINE'], f(v) { this.cfg().description = v[0]; } },
    { m: 'I', p: ['no', 'description'], f() { delete this.cfg().description; } },
    { m: 'I', t: 'R', p: ['ip', 'address', 'IP', 'MASK'], f(v) {
      const [ip, mask] = v;
      if (isSub(this.ifn) && !this.cfg().encap) return [L('err', '% Configuring IP routing on a LAN subinterface is only allowed if that subinterface is already'), L('err', 'configured as part of an IEEE 802.10, IEEE 802.1Q, or ISL vLAN.')];
      if (netOf(ip, mask) === ip2n(ip) && prefixLen(mask) < 31) return [L('err', 'Bad mask /' + prefixLen(mask) + ' for address ' + ip)];
      for (const n of Object.keys(this.d.ifaces)) {
        const c = this.d.ifaces[n];
        if (n === this.ifn || !c.ip) continue;
        const shorter = prefixLen(c.mask) < prefixLen(mask) ? c.mask : mask;
        if (inNet(ip, c.ip, shorter)) return [L('err', '% ' + n2ip(netOf(ip, mask)) + ' overlaps with ' + n)];
      }
      const c = this.cfg(); c.ip = ip; c.mask = mask; this.net.touch();
    } },
    { m: 'I', t: 'R', p: ['no', 'ip', 'address'], f() { const c = this.cfg(); c.ip = null; c.mask = null; this.net.touch(); } },
    { m: 'I', t: 'R', sub: true, p: ['encapsulation', 'dot1q', 'VLAN'], f(v) {
      const other = this.net.subFor(this.name, parentIf(this.ifn), v[0]);
      if (other && other !== this.ifn) return [L('err', '% Configuration of multiple subinterfaces of the same main interface with the same VID (' + v[0] + ') is not permitted.'), L('err', 'This VID is already configured on ' + other + '.')];
      this.cfg().encap = v[0]; this.net.touch();
    } },
    { m: 'I', t: 'S', p: ['switchport', 'mode', 'access'], f() { this.cfg().mode = 'access'; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'mode', 'trunk'], f() { this.cfg().mode = 'trunk'; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'access', 'vlan', 'VLAN'], f(v) {
      const out = [];
      if (!this.d.vlans[v[0]]) { this.d.vlans[v[0]] = 'VLAN' + String(v[0]).padStart(4, '0'); out.push(L('out', '% Access VLAN does not exist. Creating vlan ' + v[0])); }
      this.cfg().vlan = v[0]; this.net.touch(); return out;
    } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'access', 'vlan'], f() { this.cfg().vlan = 1; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'trunk', 'allowed', 'vlan', 'all'], f() { this.cfg().allowed = 'all'; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'trunk', 'allowed', 'vlan', 'add', 'VLANLIST'], f(v) { const c = this.cfg(); if (c.allowed !== 'all') c.allowed = uniqSort(c.allowed.concat(v[0])); this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'trunk', 'allowed', 'vlan', 'remove', 'VLANLIST'], f(v) {
      const c = this.cfg(); let base = c.allowed;
      if (base === 'all') { base = []; for (let i = 1; i <= 4094; i++) base.push(i); }
      c.allowed = base.filter(x => v[0].indexOf(x) < 0); this.net.touch();
    } },
    { m: 'I', t: 'S', p: ['switchport', 'trunk', 'allowed', 'vlan', 'VLANLIST'], f(v) { this.cfg().allowed = v[0]; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'trunk', 'allowed', 'vlan'], f() { this.cfg().allowed = 'all'; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'trunk', 'native', 'vlan', 'VLAN'], f(v) { this.cfg().native = v[0]; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'trunk', 'native', 'vlan'], f() { this.cfg().native = 1; this.net.touch(); } },
    { m: 'CIV', p: ['exit'], f() { this.mode = this.mode === 'config' ? 'priv' : 'config'; this.ifn = null; this.vlan = null; } },
    { m: 'CIV', p: ['end'], f() { this.mode = 'priv'; this.ifn = null; this.vlan = null; return [L('sys', '%SYS-5-CONFIG_I: Configured from console by console')]; } },
    { m: 'CIV', p: ['do', 'LINE'], f(v) { return this.execIn(v[0], 'priv'); } }
  ];

  class IOSShell {
    constructor(net, name, log) { this.net = net; this.name = name; this.log = log || function () {}; this.mode = 'user'; this.ifn = null; this.vlan = null; }
    get d() { return this.net.devices[this.name]; }
    host() { return this.d.hostname || this.name; }
    prompt() { return this.host() + (this.mode === 'config-if' && this.ifn && isSub(this.ifn) ? '(config-subif)#' : ({ user: '>', priv: '#', config: '(config)#', 'config-if': '(config-if)#', 'config-vlan': '(config-vlan)#' })[this.mode]); }
    cfg() { return this.net.ifaceCfg(this.name, this.ifn); }
    cmdsFor(mode) {
      const code = MODES[mode], t = this.d.type === 'router' ? 'R' : 'S', sub = mode === 'config-if' && !!this.ifn && isSub(this.ifn);
      return CMDS.filter(c => c.m.indexOf(code) >= 0 && (!c.t || c.t === t) && (!c.sub || sub));
    }
    validate(p, s) {
      switch (p) {
        case 'IP': return isIP(s) ? s : undefined;
        case 'MASK': return isMask(s) ? s : undefined;
        case 'IFACE': return this.net.resolveIf(this.name, s, true) || undefined;
        case 'VLAN': return /^\d+$/.test(s) && +s >= 1 && +s <= 4094 ? +s : undefined;
        case 'VLANLIST': return /^[\d,-]+$/.test(s) ? (parseVlanList(s) || undefined) : undefined;
        case 'WORD': return s;
      }
      return undefined;
    }
    match(toks, mode) {
      let cands = this.cmdsFor(mode).map(c => ({ c, vals: [], done: false }));
      for (let i = 0; i < toks.length; i++) {
        const raw = toks[i].s, low = raw.toLowerCase(), kws = new Set();
        cands.forEach(cd => { if (cd.done) return; const p = cd.c.p[i]; if (p && !isParam(p) && p.indexOf(low) === 0) kws.add(p); });
        let kw = null;
        if (kws.has(low)) kw = low;
        else if (kws.size === 1) kw = Array.from(kws)[0];
        else if (kws.size > 1) {
          const paramOk = cands.some(cd => !cd.done && isParam(cd.c.p[i]) && (cd.c.p[i] === 'LINE' || this.validate(cd.c.p[i], raw) !== undefined));
          if (!paramOk) return { err: 'ambiguous', at: i };
        }
        const next = [];
        cands.forEach(cd => {
          if (cd.done) { next.push(cd); return; }
          const p = cd.c.p[i];
          if (p === undefined) return;
          if (p === 'LINE') { next.push({ c: cd.c, vals: cd.vals.concat([toks.slice(i).map(t => t.s).join(' ')]), done: true }); return; }
          if (isParam(p)) { const v = this.validate(p, raw); if (v !== undefined) next.push({ c: cd.c, vals: cd.vals.concat([v]), done: false }); return; }
          if (p === kw) next.push(cd);
        });
        if (!next.length) return { err: 'invalid', at: i };
        cands = next;
      }
      return { cands, n: toks.length };
    }
    exec(line) {
      const toks = tokenize(line);
      if (!toks.length) return { lines: [] };
      const r = this.match(toks, this.mode);
      if (r.err === 'ambiguous') return { lines: [L('err', '% Ambiguous command:  "' + line.trim() + '"')] };
      if (r.err === 'invalid') {
        if (toks.length === 1 && r.at === 0 && (this.mode === 'user' || this.mode === 'priv')) {
          return { lines: [L('out', 'Translating "' + toks[0].s + '"...domain server (255.255.255.255)'), L('err', '% Unknown command or computer name, or unable to find computer address')] };
        }
        return { lines: [L('err', ' '.repeat(this.prompt().length + toks[r.at].pos) + '^'), L('err', "% Invalid input detected at '^' marker.")] };
      }
      const complete = r.cands.filter(cd => cd.done || cd.c.p.length === r.n);
      if (!complete.length) return { lines: [L('err', '% Incomplete command.')] };
      const cd = complete[0];
      const res = cd.c.f.call(this, cd.vals);
      if (!res) return { lines: [] };
      return Array.isArray(res) ? { lines: res } : res;
    }
    execIn(line, mode) {
      const saved = this.mode; this.mode = mode;
      const res = this.exec(line);
      if (this.mode === mode) this.mode = saved;
      return res;
    }
    help(line) {
      const endsSpace = line.trim() === '' || /\s$/.test(line);
      const toks = tokenize(line);
      let mode = this.mode, base = toks;
      if (/^config/.test(mode) && toks.length && toks[0].s.toLowerCase() === 'do' && (toks.length > 1 || endsSpace)) { mode = 'priv'; base = toks.slice(1); }
      const pre = endsSpace ? base : base.slice(0, -1);
      const partial = endsSpace ? '' : base[base.length - 1].s.toLowerCase();
      const r = this.match(pre, mode);
      if (r.err) return [L('err', '% Unrecognized command')];
      const i = pre.length, opts = new Map(); let cr = false;
      r.cands.forEach(cd => {
        if (cd.done) { opts.set('LINE', 'Text'); cr = true; return; }
        const p = cd.c.p[i];
        if (p === undefined) { cr = true; return; }
        if (p === 'IFACE') {
          const types = new Set(this.net.ifaceNames(this.name).map(n => n.replace(/[\d/.]+$/, '')));
          types.forEach(t => { if (t.toLowerCase().indexOf(partial) === 0) opts.set(t, t + ' IEEE 802.3'); });
          return;
        }
        if (isParam(p)) { if (endsSpace) opts.set(PARAM_SHOW[p][0], PARAM_SHOW[p][1]); return; }
        if (p.indexOf(partial) === 0) opts.set(p, KW_HELP[p] || '');
      });
      if (!endsSpace) { const ks = Array.from(opts.keys()); return ks.length ? [L('out', ks.join('  '))] : [L('err', '% Unrecognized command')]; }
      const keys = Array.from(opts.keys()).sort();
      const w = Math.max(4, ...keys.map(k => k.length)) + 2;
      const out = keys.map(k => L('out', '  ' + k.padEnd(w) + opts.get(k)));
      if (cr) out.push(L('out', '  <cr>'));
      return out;
    }
    complete(line) {
      if (!line.trim() || /\s$/.test(line)) return line;
      const toks = tokenize(line);
      let mode = this.mode, base = toks;
      if (/^config/.test(mode) && toks.length > 1 && toks[0].s.toLowerCase() === 'do') { mode = 'priv'; base = toks.slice(1); }
      const last = base[base.length - 1];
      const r = this.match(base.slice(0, -1), mode);
      if (r.err) return line;
      const i = base.length - 1, kws = new Set(); let ifaceSlot = false;
      r.cands.forEach(cd => { const p = cd.c.p[i]; if (!p || cd.done) return; if (p === 'IFACE') ifaceSlot = true; else if (!isParam(p) && p.indexOf(last.s.toLowerCase()) === 0) kws.add(p); });
      if (kws.size === 1) return line.slice(0, last.pos) + Array.from(kws)[0] + ' ';
      if (ifaceSlot) { const n = this.net.resolveIf(this.name, last.s); if (n) return line.slice(0, last.pos) + n + ' '; }
      return line;
    }

    // ----- state changes -----
    stateLines(n, b, a) {
      const out = [], admin = a.status === 'administratively down' || b.status === 'administratively down';
      if (b.status !== a.status) out.push(L('sys', (admin ? '%LINK-5-CHANGED' : '%LINK-3-UPDOWN') + ': Interface ' + n + ', changed state to ' + a.status));
      if (b.protocol !== a.protocol) out.push(L('sys', '%LINEPROTO-5-UPDOWN: Line protocol on Interface ' + n + ', changed state to ' + a.protocol));
      return out;
    }
    setShut(v) {
      const n = this.ifn, before = this.net.status(this.name, n), p = this.net.peer(this.name, n);
      const pBefore = p ? this.net.status(p.dev, p.ifn) : null;
      this.cfg().shutdown = v; this.net.touch();
      const lines = this.stateLines(n, before, this.net.status(this.name, n));
      if (p && !this.net.isHost(p.dev)) { const pl = this.stateLines(p.ifn, pBefore, this.net.status(p.dev, p.ifn)); if (pl.length) this.log(p.dev, pl); }
      return lines;
    }

    // ----- exec commands -----
    ping(ip) {
      const r = this.net.ping(this.name, ip);
      const lines = [L('out', 'Type escape sequence to abort.'), L('out', 'Sending 5, 100-byte ICMP Echos to ' + ip + ', timeout is 2 seconds:')];
      let marks, got;
      if (r.ok) { marks = r.arpMiss ? '.!!!!' : '!!!!!'; got = r.arpMiss ? 4 : 5; }
      else { marks = r.stage === 'request' && r.kind === 'noroute' && r.at !== this.name ? 'U.U.U' : '.....'; got = 0; }
      lines.push(L(r.ok ? 'ok' : 'err', marks));
      lines.push(L('out', 'Success rate is ' + got * 20 + ' percent (' + got + '/5)' + (got ? ', round-trip min/avg/max = 0/0/1 ms' : '')));
      return { lines, ping: { from: this.name, to: ip, res: r } };
    }
    showIpIntBrief() {
      const rows = [pad('Interface', 23) + pad('IP-Address', 16) + pad('OK?', 4) + pad('Method', 7) + pad('Status', 22) + 'Protocol'];
      this.net.ifaceNames(this.name).forEach(n => {
        const st = this.net.status(this.name, n), c = this.net.ifaceCfg(this.name, n);
        rows.push(pad(n, 23) + pad(c.ip || 'unassigned', 16) + pad('YES', 4) + pad(c.ip ? 'manual' : 'unset', 7) + pad(st.status, 22) + st.protocol);
      });
      if (this.d.type === 'switch') rows.push(pad('Vlan1', 23) + pad('unassigned', 16) + pad('YES', 4) + pad('unset', 7) + pad('administratively down', 22) + 'down');
      return rows.map(s => L('out', s));
    }
    showIpRoute() {
      const rs = this.net.routes(this.name).sort((a, b) => ip2n(a.net) - ip2n(b.net) || prefixLen(a.mask) - prefixLen(b.mask));
      const def = rs.find(r => r.code === 'S*');
      const out = [
        'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
        '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
        '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
        '       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP',
        '       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area',
        '       * - candidate default, U - per-user static route, o - ODR',
        '       P - periodic downloaded static route', '',
        def ? 'Gateway of last resort is ' + def.nh + ' to network 0.0.0.0' : 'Gateway of last resort is not set', ''
      ];
      rs.forEach(r => {
        const pfx = r.net + '/' + prefixLen(r.mask);
        out.push(pad(r.code, 5) + (r.nh ? pfx + ' [1/0] via ' + r.nh : pfx + ' is directly connected, ' + r.ifn));
      });
      return out.map(s => L('out', s));
    }
    showVlanBrief() {
      const d = this.d, out = ['VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------'];
      Object.keys(d.vlans).map(Number).sort((a, b) => a - b).forEach(v => {
        const ports = Object.keys(d.ports).filter(n => d.ports[n].mode === 'access' && d.ports[n].vlan === v).map(shortIf).join(', ');
        out.push(pad(v, 5) + pad(d.vlans[v], 33) + pad('active', 10) + ports);
      });
      // Ports assigned to a VLAN that no longer exists are shown as inactive, like real IOS.
      [['1002', 'fddi-default'], ['1003', 'token-ring-default'], ['1004', 'fddinet-default'], ['1005', 'trnet-default']].forEach(([v, n]) => out.push(pad(v, 5) + pad(n, 33) + 'act/unsup'));
      return out.map(s => L('out', s));
    }
    showTrunk() {
      const d = this.d;
      const tr = Object.keys(d.ports).filter(n => d.ports[n].mode === 'trunk' && this.net.status(this.name, n).protocol === 'up');
      if (!tr.length) return [];
      const out = [pad('Port', 12) + pad('Mode', 13) + pad('Encapsulation', 15) + pad('Status', 14) + 'Native vlan'];
      tr.forEach(n => out.push(pad(shortIf(n), 12) + pad('on', 13) + pad('802.1q', 15) + pad('trunking', 14) + (d.ports[n].native || 1)));
      const sect = (title, fn) => { out.push(''); out.push(pad('Port', 12) + title); tr.forEach(n => out.push(pad(shortIf(n), 12) + fn(d.ports[n]))); };
      const active = p => { const ids = Object.keys(d.vlans).map(Number); const list = p.allowed === 'all' ? ids : p.allowed.filter(v => ids.indexOf(v) >= 0); return fmtVlans(uniqSort(list)); };
      sect('Vlans allowed on trunk', p => fmtVlans(p.allowed));
      sect('Vlans allowed and active in management domain', active);
      sect('Vlans in spanning tree forwarding state and not pruned', active);
      return out.map(s => L('out', s));
    }
    showIntStatus() {
      const d = this.d, out = [pad('Port', 10) + pad('Name', 19) + pad('Status', 13) + pad('Vlan', 11) + pad('Duplex', 8) + pad('Speed', 6) + 'Type'];
      Object.keys(d.ports).forEach(n => {
        const c = d.ports[n], st = this.net.status(this.name, n), gi = n.indexOf('Gigabit') === 0;
        const s = c.shutdown ? 'disabled' : st.protocol !== 'up' ? 'notconnect' : c.mode === 'access' && !d.vlans[c.vlan] ? 'inactive' : 'connected';
        const up = s === 'connected' || s === 'inactive';
        out.push(pad(shortIf(n), 10) + pad((c.description || '').slice(0, 18), 19) + pad(s, 13) + pad(c.mode === 'trunk' ? 'trunk' : c.vlan, 11) + pad(up ? 'a-full' : 'auto', 8) + pad(up ? (gi ? 'a-1000' : 'a-100') : 'auto', 6) + (gi ? '10/100/1000BaseTX' : '10/100BaseTX'));
      });
      return out.map(s => L('out', s));
    }
    showSwitchport() {
      const d = this.d, out = [], vn = v => v + ' (' + (d.vlans[v] || 'Inactive') + ')';
      Object.keys(d.ports).forEach(n => {
        const c = d.ports[n], tr = c.mode === 'trunk', up = this.net.status(this.name, n).protocol === 'up';
        out.push('Name: ' + shortIf(n), 'Switchport: Enabled', 'Administrative Mode: ' + (tr ? 'trunk' : 'static access'),
          'Operational Mode: ' + (!up ? 'down' : tr ? 'trunk' : 'static access'), 'Administrative Trunking Encapsulation: dot1q',
          'Negotiation of Trunking: ' + (tr ? 'On' : 'Off'), 'Access Mode VLAN: ' + vn(c.vlan || 1), 'Trunking Native Mode VLAN: ' + vn(c.native || 1),
          'Trunking VLANs Enabled: ' + (c.allowed === 'all' ? 'ALL' : fmtVlans(c.allowed)), '');
      });
      return out.map(s => L('out', s));
    }
    showCdp() {
      const out = ['Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge', '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone', '',
        pad('Device ID', 17) + pad('Local Intrfce', 18) + pad('Holdtme', 11) + pad('Capability', 12) + pad('Platform', 10) + 'Port ID'];
      this.net.ifaceNames(this.name).filter(n => !isSub(n)).forEach((n, i) => {
        if (this.net.status(this.name, n).protocol !== 'up') return;
        const p = this.net.peer(this.name, n);
        if (!p || this.net.isHost(p.dev)) return;
        const pd = this.net.devices[p.dev], r = pd.type === 'router';
        out.push(pad(pd.hostname || p.dev, 17) + pad(cdpIf(n), 18) + pad(151 + (i * 7) % 29, 11) + pad(r ? 'R B S I' : 'S I', 12) + pad(r ? 'ISR4321' : 'WS-C2960', 10) + cdpIf(p.ifn));
      });
      return out.map(s => L('out', s));
    }
    showRun() {
      const d = this.d, c = [];
      c.push('!', 'version 15.2', 'no service timestamps log datetime msec', '!', 'hostname ' + this.host(), '!');
      if (d.type === 'router') {
        this.net.ifaceNames(this.name).forEach(n => {
          const x = d.ifaces[n];
          c.push('interface ' + n);
          if (x.description) c.push(' description ' + x.description);
          if (isSub(n) && x.encap) c.push(' encapsulation dot1Q ' + x.encap);
          c.push(x.ip ? ' ip address ' + x.ip + ' ' + x.mask : ' no ip address');
          if (x.shutdown) c.push(' shutdown');
          c.push('!');
        });
        c.push('ip classless');
        (d.routes || []).forEach(r => c.push('ip route ' + r.net + ' ' + r.mask + ' ' + r.nh));
        c.push('!');
      } else {
        Object.keys(d.ports).forEach(n => {
          const x = d.ports[n];
          c.push('interface ' + n);
          if (x.description) c.push(' description ' + x.description);
          if (x.mode === 'access' && x.vlan !== 1) c.push(' switchport access vlan ' + x.vlan);
          if (x.mode === 'trunk' && x.native && x.native !== 1) c.push(' switchport trunk native vlan ' + x.native);
          if (x.mode === 'trunk' && x.allowed !== 'all') c.push(' switchport trunk allowed vlan ' + fmtVlans(x.allowed));
          c.push(' switchport mode ' + x.mode);
          if (x.shutdown) c.push(' shutdown');
          c.push('!');
        });
        c.push('interface Vlan1', ' no ip address', ' shutdown', '!');
      }
      c.push('line con 0', '!', 'end');
      const body = c.join('\n');
      return ['Building configuration...', '', 'Current configuration : ' + body.length + ' bytes'].concat(c).map(s => L('out', s));
    }
  }

  // ---------- PC command prompt ----------
  class PCShell {
    constructor(net, name) { this.net = net; this.name = name; }
    prompt() { return 'C:\\>'; }
    exec(line) {
      const t = line.trim().split(/\s+/).filter(Boolean);
      if (!t.length) return { lines: [] };
      const c = t[0].toLowerCase(), d = this.net.devices[this.name];
      if (c === 'ipconfig') {
        return { lines: ['', 'FastEthernet0 Connection:(default port)', '', '   Connection-specific DNS Suffix..: ',
          '   IPv4 Address....................: ' + (d.ip || '0.0.0.0'), '   Subnet Mask.....................: ' + (d.mask || '0.0.0.0'),
          '   Default Gateway.................: ' + (d.gw || '0.0.0.0'), ''].map(s => L('out', s)) };
      }
      if (c === 'ping') { const ip = t.slice(1).find(isIP); return ip ? this.ping(ip) : { lines: [L('err', 'Usage: ping <IPv4 address>')] }; }
      if (c === 'tracert') { const ip = t.slice(1).find(isIP); return ip ? this.tracert(ip) : { lines: [L('err', 'Usage: tracert <IPv4 address>')] }; }
      if (c === 'help' || c === '?') {
        return { lines: ['Available commands:', '  ipconfig            Show this PC\'s IP settings', '  ping <address>      Test reachability (4 echo requests)',
          '  tracert <address>   List the routers on the path', '  cls                 Clear the screen', '', 'Change addresses in the IP settings tab.'].map(s => L('out', s)) };
      }
      if (c === 'cls' || c === 'clear') return { lines: [], clear: true };
      return { lines: [L('err', 'Invalid Command.')] };
    }
    ping(ip) {
      const d = this.net.devices[this.name];
      if (!d.ip) return { lines: [L('err', 'Unable to ping: this PC has no IP address. Set one in IP settings.')] };
      const r = this.net.ping(this.name, ip);
      const lines = [L('out', ''), L('out', 'Pinging ' + ip + ' with 32 bytes of data:'), L('out', '')];
      const ttl = r.ok ? (this.net.isRouter(r.dstDev) ? 255 : 128) - r.back.arrivals.length : 0;
      let got = 0;
      for (let i = 0; i < 4; i++) {
        if (!r.ok || (i === 0 && r.arpMiss)) lines.push(L('err', 'Request timed out.'));
        else { lines.push(L('ok', 'Reply from ' + ip + ': bytes=32 time<1ms TTL=' + ttl)); got++; }
      }
      lines.push(L('out', ''), L('out', 'Ping statistics for ' + ip + ':'), L('out', '    Packets: Sent = 4, Received = ' + got + ', Lost = ' + (4 - got) + ' (' + (4 - got) * 25 + '% loss),'));
      if (got) lines.push(L('out', 'Approximate round trip times in milli-seconds:'), L('out', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms'));
      lines.push(L('out', ''));
      return { lines, ping: { from: this.name, to: ip, res: r } };
    }
    tracert(ip) {
      const tr = this.net.tracert(this.name, ip);
      if (tr.noip) return { lines: [L('err', 'Unable to trace: this PC has no IP address.')] };
      const lines = [L('out', ''), L('out', 'Tracing route to ' + ip + ' over a maximum of 30 hops: '), L('out', '')];
      const rows = tr.rows.slice();
      if (!tr.done) for (let i = 0; i < 3; i++) rows.push(null);
      rows.forEach((r, i) => {
        const n = String(i + 1).padStart(3);
        lines.push(r ? L('out', n + '   0 ms      0 ms      0 ms      ' + r) : L('err', n + '   *         *         *         Request timed out.'));
      });
      lines.push(L('out', ''), L(tr.done ? 'out' : 'dim', tr.done ? 'Trace complete.' : '(Stopped early. A real tracert keeps going to 30 hops.)'), L('out', ''));
      return { lines };
    }
  }

  const api = { Network, IOSShell, PCShell, isIP, isMask, shortIf, fmtVlans, parseVlanList, tokenize, HOSTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Outage = api;
})(typeof window !== 'undefined' ? window : globalThis);
