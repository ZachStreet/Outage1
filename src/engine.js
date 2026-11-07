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
  const vlanAllowed = (port, v) => !port.allowed || port.allowed === 'all' || port.allowed.indexOf(v) >= 0;

  // MAC addresses: fixed per device and port, in Cisco's dotted form. Puzzles can set a host's MAC explicitly.
  const hash32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const macFor = s => { const a = hash32(s), b = hash32(s + '#'); return [0x00, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (b >>> 8) & 255, b & 255].map(x => x.toString(16).padStart(2, '0')).join('').replace(/(....)(....)(....)/, '$1.$2.$3'); };
  const winMac = m => m.replace(/\./g, '').toUpperCase().match(/../g).join('-');
  const isMac = s => /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s);
  const cap = (name, ifn) => /^Gigabit/.test(ifn) ? 1000 : 100;

  // ACL helpers. Addresses are stored the way IOS stores them: the address with the wildcard bits already applied.
  const PORTS = { www: 80, telnet: 23, ftp: 21, smtp: 25, domain: 53, pop3: 110 };
  const portName = n => { for (const k of Object.keys(PORTS)) if (PORTS[k] === n) return k; return String(n); };
  const wildOk = (ip, a) => (((ip2n(ip) ^ ip2n(a.addr)) & ~ip2n(a.wc)) >>> 0) === 0;
  const ANY = { addr: '0.0.0.0', wc: '255.255.255.255' };
  const isAny = a => a.wc === '255.255.255.255';
  function aclAddr(t, i, std) {
    if (t[i] === 'any') return { addr: ANY.addr, wc: ANY.wc, next: i + 1 };
    if (t[i] === 'host') return isIP(t[i + 1]) ? { addr: t[i + 1], wc: '0.0.0.0', next: i + 2 } : { err: i + 1 };
    if (!isIP(t[i])) return { err: i };
    if (isIP(t[i + 1])) { const wc = t[i + 1]; return { addr: n2ip((ip2n(t[i]) & ~ip2n(wc)) >>> 0), wc, next: i + 2 }; }
    return std ? { addr: t[i], wc: '0.0.0.0', next: i + 1 } : { err: i + 1 };
  }
  // Parse the part of an ACL line after permit/deny. Returns an entry, or { err: index of the bad token }.
  function parseAce(type, action, t) {
    if (type === 'std') {
      const a = aclAddr(t, 0, true);
      if (a.err !== undefined) return { err: a.err };
      if (a.next < t.length) return { err: a.next };
      return { action, src: { addr: a.addr, wc: a.wc } };
    }
    const proto = (t[0] || '').toLowerCase();
    if (['ip', 'icmp', 'tcp', 'udp'].indexOf(proto) < 0) return { err: 0 };
    const sa = aclAddr(t, 1, false); if (sa.err !== undefined) return { err: sa.err };
    const da = aclAddr(t, sa.next, false); if (da.err !== undefined) return { err: da.err };
    let i = da.next, dport = null;
    if (i < t.length) {
      if (t[i].toLowerCase() !== 'eq' || (proto !== 'tcp' && proto !== 'udp')) return { err: i };
      const pv = t[i + 1] && (PORTS[t[i + 1].toLowerCase()] || (/^\d+$/.test(t[i + 1]) && +t[i + 1] <= 65535 ? +t[i + 1] : 0));
      if (!pv) return { err: i + 1 };
      dport = pv; i += 2;
      if (i < t.length) return { err: i };
    }
    return { action, proto, src: { addr: sa.addr, wc: sa.wc }, dst: { addr: da.addr, wc: da.wc }, dport };
  }
  const addrStd = a => isAny(a) ? 'any' : a.wc === '0.0.0.0' ? a.addr : a.addr + ', wildcard bits ' + a.wc;
  const addrExt = a => isAny(a) ? 'any' : a.wc === '0.0.0.0' ? 'host ' + a.addr : a.addr + ' ' + a.wc;
  const aceText = (type, e) => type === 'std' ? addrStd(e.src) : e.proto + ' ' + addrExt(e.src) + ' ' + addrExt(e.dst) + (e.dport ? ' eq ' + portName(e.dport) : '');
  const aceRun = (type, e) => type === 'std' ? (isAny(e.src) ? 'any' : e.src.wc === '0.0.0.0' ? e.src.addr : e.src.addr + ' ' + e.src.wc) : aceText(type, e);

  // ---------- network model ----------
  class Network {
    constructor(def) {
      this.devices = JSON.parse(JSON.stringify(def.devices));
      this.links = def.links.map(l => Object.assign({}, l));
      this.arp = new Set();
      this.version = 0;
      this.counting = false;
    }
    mac(name, ifn) { const d = this.devices[name]; return this.isHost(name) ? (d.mac || macFor(name)) : macFor(name + '/' + parentIf(ifn || '')); }
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
    // Up enough to pass frames: not shut down and not err-disabled.
    portUp(name, ifn) { if (!this.adminUp(name, ifn)) return false; const c = this.ifaceCfg(name, parentIf(ifn)); return !(c && c.errdis); }
    nic(name, ifn) { const c = this.isHost(name) ? this.devices[name] : this.ifaceCfg(name, parentIf(ifn)); return { speed: (c && c.speed) || 'auto', duplex: (c && c.duplex) || 'auto', cap: this.isHost(name) ? 100 : cap(name, ifn) }; }
    // What the two ends of a cable settle on. Auto-negotiation only happens when both ends are fully auto; an end that
    // can't negotiate still senses the speed but falls back to half duplex. Two different fixed speeds never link up.
    linkMode(i) {
      const l = this.links[i], A = this.nic(l.a, l.ai), B = this.nic(l.b, l.bi);
      if (A.speed !== 'auto' && B.speed !== 'auto' && A.speed !== B.speed) return { ok: false };
      const full = x => x.speed === 'auto' && x.duplex === 'auto', both = full(A) && full(B);
      const dup = x => x.duplex !== 'auto' ? x.duplex : both ? 'full' : 'half';
      const speed = A.speed !== 'auto' ? +A.speed : B.speed !== 'auto' ? +B.speed : Math.min(A.cap, B.cap);
      return { ok: true, a: dup(A), b: dup(B), speed, autoA: A, autoB: B };
    }
    duplexMismatch(i) { const m = this.linkMode(i); return m.ok && m.a !== m.b; }
    linkUp(i) { const l = this.links[i]; return this.portUp(l.a, l.ai) && this.portUp(l.b, l.bi) && this.linkMode(i).ok; }
    endMode(name, ifn) { const p = this.peer(name, ifn); if (!p) return null; const m = this.linkMode(p.link), l = this.links[p.link]; if (!m.ok) return null; const mine = l.a === name && l.ai === parentIf(ifn); return { duplex: mine ? m.a : m.b, speed: m.speed }; }
    status(name, ifn) {
      if (isSub(ifn)) {
        const c = this.ifaceCfg(name, ifn);
        if (c && c.shutdown) return { status: 'administratively down', protocol: 'down' };
        const ps = this.status(name, parentIf(ifn));
        return ps.status === 'administratively down' ? { status: 'down', protocol: 'down' } : ps;
      }
      if (!this.adminUp(name, ifn)) return { status: 'administratively down', protocol: 'down' };
      const c = this.ifaceCfg(name, ifn);
      if (c && c.errdis) return { status: 'down', protocol: 'down', errdis: c.errdis };
      const p = this.peer(name, ifn);
      if (!p || !this.portUp(p.dev, p.ifn) || !this.linkMode(p.link).ok) return { status: 'down', protocol: 'down' };
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

    // DTP: trunk is always on, access never trunks, dynamic auto waits to be asked, dynamic desirable asks.
    opTrunk(name, ifn) {
      const c = this.devices[name].ports[ifn];
      if (c.mode === 'trunk') return true;
      if (!c.mode || c.mode === 'access') return false;
      const p = this.peer(name, ifn);
      if (!p || this.devices[p.dev].type !== 'switch') return false;
      const o = this.devices[p.dev].ports[p.ifn].mode;
      if (!o || o === 'access') return false;
      return c.mode === 'dynamic desirable' || o === 'trunk' || o === 'dynamic desirable';
    }
    // Port security: is the device on this port allowed to use it?
    psecAllowed(name, ifn) {
      const ps = this.devices[name].ports[ifn].psec;
      if (!ps || !ps.on) return true;
      const p = this.peer(name, ifn);
      if (!p || !this.isHost(p.dev)) return true;
      const m = this.mac(p.dev), known = (ps.macs || []).concat(ps.dyn || []);
      return known.indexOf(m) >= 0 || known.length < (ps.max || 1);
    }
    // Checks a switch port runs when it comes up. May err-disable it; returns the log lines.
    portChecks(name, ifn) {
      const c = this.devices[name].ports[ifn], p = this.peer(name, ifn), s = shortIf(ifn);
      if (!p || !this.portUp(p.dev, p.ifn)) return [];
      if (c.bpduguard && this.devices[p.dev].type === 'switch') {
        c.errdis = 'bpduguard';
        return [L('sys', '%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ' + s + ' with BPDU Guard enabled. Disabling port.'), L('sys', '%PM-4-ERR_DISABLE: bpduguard error detected on ' + s + ', putting ' + s + ' in err-disable state')];
      }
      const ps = c.psec;
      if (ps && ps.on && this.isHost(p.dev)) {
        const m = this.mac(p.dev), known = (ps.macs || []).concat(ps.dyn || []);
        if (known.indexOf(m) >= 0) return [];
        if (known.length < (ps.max || 1)) { if (ps.sticky) (ps.macs = ps.macs || []).push(m); else (ps.dyn = ps.dyn || []).push(m); return []; }
        ps.viol = (ps.viol || 0) + 1; ps.last = m;
        if ((ps.violation || 'shutdown') === 'shutdown') {
          c.errdis = 'psecure-violation';
          return [L('sys', '%PM-4-ERR_DISABLE: psecure-violation error detected on ' + s + ', putting ' + s + ' in err-disable state'), L('sys', '%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ' + m + ' on port ' + ifn + '.')];
        }
      }
      return [];
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
        if (!this.psecAllowed(p.dev, p.ifn)) continue;
        let v;
        if (this.opTrunk(p.dev, p.ifn)) { v = f.tagged ? f.vlan : (port.native || 1); if (!vlanAllowed(port, v)) continue; }
        else { if (f.tagged) continue; v = port.vlan || 1; }
        hop.vlan = v;
        if (!d.vlans[v]) continue;
        const key = p.dev + '|' + v;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const out of Object.keys(d.ports)) {
          if (out === p.ifn) continue;
          const op = d.ports[out];
          if (op.shutdown || op.errdis || !this.psecAllowed(p.dev, out)) continue;
          if (this.opTrunk(p.dev, out)) {
            if (!vlanAllowed(op, v)) continue;
            q.push({ from: p.dev, fromIf: out, vlan: v, tagged: v !== (op.native || 1), path });
          } else if ((op.vlan || 1) === v) {
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
        if (!this.opTrunk(l.a, l.ai) || !this.opTrunk(l.b, l.bi)) return;
        const na = pa.native || 1, nb = pb.native || 1;
        if (na === nb) return;
        out.push({ dev: l.a, ifn: l.ai, native: na, peer: B.hostname || l.b, peerIf: l.bi, peerNative: nb });
        out.push({ dev: l.b, ifn: l.bi, native: nb, peer: A.hostname || l.a, peerIf: l.ai, peerNative: na });
      });
      return out.map(m => Object.assign(m, { line: '%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ' + m.ifn + ' (' + m.native + '), with ' + m.peer + ' ' + m.peerIf + ' (' + m.peerNative + ').' }));
    }

    // Cisco devices at both ends of a link report duplex mismatches over CDP.
    duplexWarnings() {
      const out = [];
      this.links.forEach((l, i) => {
        if (this.isHost(l.a) || this.isHost(l.b) || !this.linkUp(i)) return;
        const m = this.linkMode(i); if (m.a === m.b) return;
        const A = this.devices[l.a], B = this.devices[l.b], say = x => x === 'half' ? 'half duplex' : 'not half duplex';
        out.push({ dev: l.a, line: '%CDP-4-DUPLEX_MISMATCH: duplex mismatch discovered on ' + l.ai + ' (' + say(m.a) + '), with ' + (B.hostname || l.b) + ' ' + l.bi + ' (' + say(m.b) + ').' });
        out.push({ dev: l.b, line: '%CDP-4-DUPLEX_MISMATCH: duplex mismatch discovered on ' + l.bi + ' (' + say(m.b) + '), with ' + (A.hostname || l.a) + ' ' + l.ai + ' (' + say(m.a) + ').' });
      });
      return out;
    }
    cdpWarnings() { return this.nativeMismatches().concat(this.duplexWarnings()); }

    // Access lists. An ACL that is applied but doesn't exist filters nothing, like IOS.
    aclEval(dev, name, pkt) {
      const a = (this.devices[dev].acls || {})[name];
      if (!a) return true;
      for (const e of a.entries) {
        const hit = wildOk(pkt.src, e.src) && (a.type === 'std' || ((e.proto === 'ip' || e.proto === pkt.proto) && wildOk(pkt.dst, e.dst) && (!e.dport || e.dport === pkt.dport)));
        if (hit) { if (this.counting) e.hits = (e.hits || 0) + 1; return e.action === 'permit'; }
      }
      return false;
    }

    // One-way packet walk from a device toward dst.
    // pk describes the packet: { proto: 'icmp' | 'tcp', dport, sport }.
    route(src, dst, pk) {
      pk = pk || {};
      const hops = [], arrivals = [], resolutions = [];
      let cur = src, srcIP = null, ttl = 12, inIf = null;
      const fail = (at, kind, nh, extra) => Object.assign({ ok: false, hops, arrivals, resolutions, at, kind, nh: nh || null, srcIP }, extra || {});
      const pkt = () => ({ src: srcIP, dst, proto: pk.proto || 'icmp', dport: pk.dport || null, sport: pk.sport || null });
      while (ttl-- > 0) {
        const d = this.devices[cur];
        if (inIf && d.type === 'router') {
          const acl = (d.ifaces[inIf] || {}).aclIn;
          if (acl && !this.aclEval(cur, acl, pkt())) { arrivals.pop(); return fail(cur, 'acl', null, { acl, dir: 'in', ifn: inIf }); }
        }
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
          // Outbound ACLs don't filter traffic the router itself originates.
          const acl = inIf && d.ifaces[egress].aclOut;
          if (acl && !this.aclEval(cur, acl, pkt())) return fail(cur, 'acl', nh, { acl, dir: 'out', ifn: egress });
        } else return fail(cur, 'noroute');
        const dom = this.l2(cur, egress);
        const t = dom.endpoints.find(e => { const l3 = this.l3If(e.dev, e.ifn); return l3 && l3.ip === nh; });
        if (!t) { dom.edges.forEach(h => hops.push(Object.assign({ flood: true }, h))); return fail(cur, 'arp', nh); }
        resolutions.push(cur + '>' + nh);
        t.path.forEach(h => hops.push(h));
        cur = t.dev; inIf = t.ifn;
        if (this.isRouter(cur)) arrivals.push({ dev: cur, ip: this.l3If(t.dev, t.ifn).ip });
      }
      return fail(cur, 'ttl');
    }

    // Round trip. silent=true leaves the ARP cache and ACL counters alone (used for win checks).
    trip(src, dst, req, rep, port, opts) {
      const silent = !!(opts && opts.silent);
      this.counting = !silent;
      try {
        const f = this.route(src, dst, req);
        if (!f.ok) return { ok: false, stage: 'request', kind: f.kind, at: f.at, nh: f.nh, acl: f.acl, dst, port, fwd: f, back: null, srcIP: f.srcIP };
        if (f.dev === src) return { ok: true, stage: 'done', dst, port, dstDev: src, fwd: f, back: { ok: true, hops: [], arrivals: [], resolutions: [] }, srcIP: dst, arpMiss: false };
        // TCP: nothing listening means the server answers with a reset, which still has to get back.
        const refused = port && !(this.isHost(f.dev) && (this.devices[f.dev].services || []).indexOf(port) >= 0);
        const b = this.route(f.dev, f.srcIP, rep);
        const back = b.ok && b.dev === src, ok = back && !refused;
        const miss = back && f.resolutions.some(k => !this.arp.has(k));
        if (back && !silent) f.resolutions.concat(b.resolutions).forEach(k => this.arp.add(k));
        const lossy = ok && f.hops.concat(b.hops).some(h => !h.flood && this.duplexMismatch(h.link));
        return { ok, lossy, stage: ok ? 'done' : back ? 'refused' : 'reply', kind: back ? null : b.kind, at: back ? null : b.at, nh: b.nh, acl: b.acl, dst, port, dstDev: f.dev, fwd: f, back: b, srcIP: f.srcIP, arpMiss: miss };
      } finally { this.counting = false; }
    }
    ping(src, dst, opts) { return this.trip(src, dst, { proto: 'icmp' }, { proto: 'icmp' }, null, opts); }
    connect(src, dst, port, opts) { return this.trip(src, dst, { proto: 'tcp', dport: port }, { proto: 'tcp', sport: port }, port, opts); }
    // Test points: o = { from, to, port?, blocked?, dev? }.
    test(o, silent) { return o.port ? this.connect(o.from, o.to, o.port, { silent }) : this.ping(o.from, o.to, { silent }); }
    passes(o, r) { return o.blocked ? !r.ok : !!r.ok && !r.lossy && (!o.dev || r.dstDev === o.dev); }

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
  const MODES = { user: 'U', priv: 'P', config: 'C', 'config-if': 'I', 'config-vlan': 'V', 'config-std-nacl': 'A', 'config-ext-nacl': 'A' };
  const PARAMS = ['IP', 'MASK', 'IFACE', 'VLAN', 'VLANLIST', 'WORD', 'LINE', 'NUM', 'ACLNUM', 'MAC'];
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
    neighbors: 'CDP neighbor entries', 'access-list': 'Add an access list entry', 'access-lists': 'List access lists',
    'access-group': 'Specify access control for packets', permit: 'Specify packets to forward', deny: 'Specify packets to reject',
    in: 'inbound packets', out: 'outbound packets', standard: 'Standard Access List', extended: 'Extended Access List',
    'port-security': 'Security related command', maximum: 'Max secure addresses', 'mac-address': 'Secure mac address',
    sticky: 'Configure dynamically learned MAC addresses as sticky', violation: 'Security violation mode',
    protect: 'Security violation protect mode', restrict: 'Security violation restrict mode', 'spanning-tree': 'Spanning Tree Subsystem',
    portfast: 'Portfast options for the interface', bpduguard: "Don't accept BPDUs on this interface", disable: 'Disable', clear: 'Reset functions',
    speed: 'Configure speed operation.', duplex: 'Configure duplex operation.', full: 'Force full duplex operation', half: 'Force half-duplex operation',
    auto: 'Enable AUTO speed configuration', dynamic: 'Set trunking mode to dynamically negotiate access or trunk mode',
    desirable: 'Set trunking mode dynamic negotiation parameter to DESIRABLE', address: 'Show secure address', 'interface': 'Select an interface'
  };
  const PARAM_SHOW = { IP: ['A.B.C.D', 'IP address'], MASK: ['A.B.C.D', 'IP subnet mask'], VLAN: ['<1-4094>', 'VLAN ID'], VLANLIST: ['WORD', 'VLAN IDs of the allowed VLANs, e.g. 10,20,30-40'], WORD: ['WORD', 'Name'], LINE: ['LINE', 'Text'],
    NUM: ['<1-2147483647>', 'Number'], ACLNUM: ['<1-199>', 'IP access list number (1-99 standard, 100-199 extended)'], MAC: ['H.H.H', '48 bit mac address'] };

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
    // ----- speed, duplex, DTP, spanning tree, port security -----
    { m: 'I', p: ['speed', 'auto'], f() { this.cfg().speed = 'auto'; return this.relink(); } },
    { m: 'I', p: ['speed', 'NUM'], f(v) {
      if ([10, 100, 1000].indexOf(v[0]) < 0 || (v[0] === 1000 && cap(this.name, this.ifn) < 1000)) return this.caret(1);
      this.cfg().speed = String(v[0]); return this.relink();
    } },
    { m: 'I', p: ['duplex', 'auto'], f() { this.cfg().duplex = 'auto'; return this.relink(); } },
    { m: 'I', p: ['duplex', 'full'], f() { this.cfg().duplex = 'full'; return this.relink(); } },
    { m: 'I', p: ['duplex', 'half'], f() { this.cfg().duplex = 'half'; return this.relink(); } },
    { m: 'I', t: 'S', p: ['switchport', 'mode', 'dynamic', 'auto'], f() { this.cfg().mode = 'dynamic auto'; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'mode', 'dynamic', 'desirable'], f() { this.cfg().mode = 'dynamic desirable'; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['spanning-tree', 'portfast'], f() { this.cfg().portfast = true; return [L('out', '%Warning: portfast should only be enabled on ports connected to a single'), L('out', ' host. Connecting hubs, concentrators, switches, bridges, etc... to this'), L('out', ' interface  when portfast is enabled, can cause temporary bridging loops.'), L('out', ' Use with CAUTION')]; } },
    { m: 'I', t: 'S', p: ['no', 'spanning-tree', 'portfast'], f() { this.cfg().portfast = false; } },
    { m: 'I', t: 'S', p: ['spanning-tree', 'bpduguard', 'enable'], f() { this.cfg().bpduguard = true; } },
    { m: 'I', t: 'S', p: ['spanning-tree', 'bpduguard', 'disable'], f() { this.cfg().bpduguard = false; } },
    { m: 'I', t: 'S', p: ['no', 'spanning-tree', 'bpduguard'], f() { this.cfg().bpduguard = false; } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security'], f() {
      const c = this.cfg();
      if (c.mode !== 'access') return [L('err', 'Command rejected: ' + this.ifn + ' is a dynamic port.')];
      c.psec = Object.assign({ max: 1, macs: [], dyn: [], violation: 'shutdown', viol: 0 }, c.psec || {}, { on: true }); this.net.touch();
    } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'port-security'], f() { const c = this.cfg(); if (c.psec) { c.psec.on = false; c.psec.dyn = []; } this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'maximum', 'NUM'], f(v) { this.psec().max = v[0]; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'violation', 'shutdown'], f() { this.psec().violation = 'shutdown'; } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'violation', 'restrict'], f() { this.psec().violation = 'restrict'; } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'violation', 'protect'], f() { this.psec().violation = 'protect'; } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'mac-address', 'sticky'], f() { const ps = this.psec(); ps.sticky = true; ps.macs = (ps.macs || []).concat(ps.dyn || []); ps.dyn = []; this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'mac-address', 'sticky', 'MAC'], f(v) { const ps = this.psec(); if (ps.macs.indexOf(v[0]) < 0) ps.macs.push(v[0]); this.net.touch(); } },
    { m: 'I', t: 'S', p: ['switchport', 'port-security', 'mac-address', 'MAC'], f(v) { const ps = this.psec(); if (ps.macs.indexOf(v[0]) < 0) ps.macs.push(v[0]); this.net.touch(); } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'port-security', 'mac-address', 'sticky', 'MAC'], f(v) { const ps = this.psec(); ps.macs = ps.macs.filter(m => m !== v[0]); this.net.touch(); } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'port-security', 'mac-address', 'MAC'], f(v) { const ps = this.psec(); ps.macs = ps.macs.filter(m => m !== v[0]); this.net.touch(); } },
    { m: 'I', t: 'S', p: ['no', 'switchport', 'port-security', 'mac-address', 'sticky'], f() { const ps = this.psec(); ps.sticky = false; ps.macs = []; this.net.touch(); } },
    { m: 'P', t: 'S', p: ['clear', 'port-security', 'sticky', 'interface', 'IFACE'], f(v) { const c = this.net.ifaceCfg(this.name, v[0]); if (c.psec) { c.psec.macs = []; this.net.touch(); } } },
    { m: 'P', t: 'S', p: ['clear', 'port-security', 'all'], f() { Object.keys(this.d.ports).forEach(n => { const ps = this.d.ports[n].psec; if (ps) { ps.macs = []; ps.dyn = []; } }); this.net.touch(); } },
    { m: 'UP', t: 'S', p: ['show', 'port-security'], f() { return this.showPsec(); } },
    { m: 'UP', t: 'S', p: ['show', 'port-security', 'address'], f() { return this.showPsecAddr(); } },
    { m: 'UP', t: 'S', p: ['show', 'port-security', 'interface', 'IFACE'], f(v) { return this.showPsecIf(v[0]); } },
    { m: 'UP', p: ['show', 'interfaces', 'IFACE'], f(v) { return this.showInterface(v[0]); } },

    // ----- access lists -----
    { m: 'C', t: 'R', p: ['access-list', 'ACLNUM', 'permit', 'LINE'], f(v) { return this.aclAdd(String(v[0]), v[0] < 100 ? 'std' : 'ext', 'permit', v[1], null, 3); } },
    { m: 'C', t: 'R', p: ['access-list', 'ACLNUM', 'deny', 'LINE'], f(v) { return this.aclAdd(String(v[0]), v[0] < 100 ? 'std' : 'ext', 'deny', v[1], null, 3); } },
    { m: 'C', t: 'R', p: ['no', 'access-list', 'ACLNUM'], f(v) { this.aclDel(String(v[0])); } },
    // IOS quirk: on a numbered ACL, "no access-list N permit ..." deletes the whole list, not one line.
    { m: 'C', t: 'R', p: ['no', 'access-list', 'ACLNUM', 'LINE'], f(v) { this.aclDel(String(v[0])); } },
    { m: 'C', t: 'R', p: ['ip', 'access-list', 'standard', 'WORD'], f(v) { return this.aclMode(v[0], 'std'); } },
    { m: 'C', t: 'R', p: ['ip', 'access-list', 'extended', 'WORD'], f(v) { return this.aclMode(v[0], 'ext'); } },
    { m: 'C', t: 'R', p: ['no', 'ip', 'access-list', 'standard', 'WORD'], f(v) { this.aclDel(v[0]); } },
    { m: 'C', t: 'R', p: ['no', 'ip', 'access-list', 'extended', 'WORD'], f(v) { this.aclDel(v[0]); } },
    { m: 'A', p: ['permit', 'LINE'], f(v) { return this.aclAdd(this.acl, this.aclType(), 'permit', v[0], null, 1); } },
    { m: 'A', p: ['deny', 'LINE'], f(v) { return this.aclAdd(this.acl, this.aclType(), 'deny', v[0], null, 1); } },
    { m: 'A', p: ['NUM', 'permit', 'LINE'], f(v) { return this.aclAdd(this.acl, this.aclType(), 'permit', v[1], v[0], 2); } },
    { m: 'A', p: ['NUM', 'deny', 'LINE'], f(v) { return this.aclAdd(this.acl, this.aclType(), 'deny', v[1], v[0], 2); } },
    { m: 'A', p: ['no', 'NUM'], f(v) { const a = this.d.acls[this.acl]; a.entries = a.entries.filter(e => e.seq !== v[0]); this.net.touch(); } },
    { m: 'I', t: 'R', p: ['ip', 'access-group', 'WORD', 'in'], f(v) { this.cfg().aclIn = v[0]; this.net.touch(); } },
    { m: 'I', t: 'R', p: ['ip', 'access-group', 'WORD', 'out'], f(v) { this.cfg().aclOut = v[0]; this.net.touch(); } },
    { m: 'I', t: 'R', p: ['no', 'ip', 'access-group', 'WORD', 'in'], f() { delete this.cfg().aclIn; this.net.touch(); } },
    { m: 'I', t: 'R', p: ['no', 'ip', 'access-group', 'WORD', 'out'], f() { delete this.cfg().aclOut; this.net.touch(); } },
    { m: 'UP', t: 'R', p: ['show', 'access-lists'], f() { return this.showAcl(); } },
    { m: 'UP', t: 'R', p: ['show', 'ip', 'access-lists'], f() { return this.showAcl(); } },
    { m: 'UP', t: 'R', p: ['show', 'ip', 'interface'], f() { return this.showIpInt(null); } },
    { m: 'UP', t: 'R', p: ['show', 'ip', 'interface', 'IFACE'], f(v) { return this.showIpInt(v[0]); } },

    { m: 'CIVA', p: ['exit'], f() { this.mode = this.mode === 'config' ? 'priv' : 'config'; this.ifn = null; this.vlan = null; this.acl = null; } },
    { m: 'CIVA', p: ['end'], f() { this.mode = 'priv'; this.ifn = null; this.vlan = null; this.acl = null; return [L('sys', '%SYS-5-CONFIG_I: Configured from console by console')]; } },
    { m: 'CIVA', p: ['do', 'LINE'], f(v) { return this.execIn(v[0], 'priv'); } }
  ];

  class IOSShell {
    constructor(net, name, log) { this.net = net; this.name = name; this.log = log || function () {}; this.mode = 'user'; this.ifn = null; this.vlan = null; }
    get d() { return this.net.devices[this.name]; }
    host() { return this.d.hostname || this.name; }
    prompt() { return this.host() + (this.mode === 'config-if' && this.ifn && isSub(this.ifn) ? '(config-subif)#' : ({ user: '>', priv: '#', config: '(config)#', 'config-if': '(config-if)#', 'config-vlan': '(config-vlan)#', 'config-std-nacl': '(config-std-nacl)#', 'config-ext-nacl': '(config-ext-nacl)#' })[this.mode]); }
    psec() { const c = this.cfg(); return (c.psec = Object.assign({ on: false, max: 1, macs: [], dyn: [], violation: 'shutdown', viol: 0 }, c.psec || {})); }
    aclType() { return this.mode === 'config-std-nacl' ? 'std' : 'ext'; }
    caret(i) { const t = this._toks && this._toks[i]; return [L('err', ' '.repeat(this.prompt().length + (t ? t.pos : 0)) + '^'), L('err', "% Invalid input detected at '^' marker.")]; }
    aclMode(name, type) {
      const acls = this.d.acls = this.d.acls || {};
      if (acls[name] && acls[name].type !== type) return [L('err', '% A named ' + (type === 'std' ? 'extended' : 'standard') + ' IP access list with this name already exists')];
      if (!acls[name]) acls[name] = { type, entries: [] };
      this.mode = type === 'std' ? 'config-std-nacl' : 'config-ext-nacl'; this.acl = name;
    }
    aclDel(name) { if (this.d.acls) delete this.d.acls[name]; this.net.touch(); }
    // first = index of the first token after permit/deny, for the error caret.
    aclAdd(name, type, action, rest, seq, first) {
      const acls = this.d.acls = this.d.acls || {};
      const a = acls[name] || (acls[name] = { type, entries: [] });
      const t = rest.split(/\s+/).filter(Boolean), e = parseAce(type, action, t);
      if (e.err !== undefined) return this.caret(first + e.err);
      if (seq === null) seq = a.entries.length ? a.entries[a.entries.length - 1].seq + 10 : 10;
      else if (a.entries.some(x => x.seq === seq)) return [L('err', '% Duplicate sequence number')];
      const key = aceText(type, e) + e.action;
      if (a.entries.some(x => aceText(type, x) + x.action === key)) return [];
      e.seq = seq; a.entries.push(e); a.entries.sort((x, y) => x.seq - y.seq); this.net.touch();
    }
    // Bring a link up or down after a speed or duplex change, with the log lines both ends would print.
    relink() {
      const n = this.ifn, p = this.net.peer(this.name, n), was = this.net.status(this.name, n), pWas = p ? this.net.status(p.dev, p.ifn) : null;
      this.net.touch();
      const out = this.stateLines(n, was, this.net.status(this.name, n));
      if (p && !this.net.isHost(p.dev)) { const pl = this.stateLines(p.ifn, pWas, this.net.status(p.dev, p.ifn)); if (pl.length) this.log(p.dev, pl); }
      return out;
    }
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
        case 'NUM': return /^\d{1,9}$/.test(s) ? +s : undefined;
        case 'ACLNUM': return /^\d{1,3}$/.test(s) && +s >= 1 && +s <= 199 ? +s : undefined;
        case 'MAC': return isMac(s) ? s.toLowerCase() : undefined;
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
      this._toks = toks;
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
      const n = this.ifn, c = this.cfg(), before = this.net.status(this.name, n), p = this.net.peer(this.name, n);
      // An err-disabled port only recovers with shutdown followed by no shutdown.
      if (!v && !c.shutdown) return [];
      const pBefore = p ? this.net.status(p.dev, p.ifn) : null;
      c.shutdown = v; if (v) delete c.errdis;
      this.net.touch();
      const checks = !v && this.d.type === 'switch' ? this.net.portChecks(this.name, n) : [];
      const lines = checks.concat(this.stateLines(n, before, this.net.status(this.name, n)));
      if (p && !this.net.isHost(p.dev)) { const pl = this.stateLines(p.ifn, pBefore, this.net.status(p.dev, p.ifn)); if (pl.length) this.log(p.dev, pl); }
      return lines;
    }

    // ----- exec commands -----
    ping(ip) {
      const r = this.net.ping(this.name, ip);
      const lines = [L('out', 'Type escape sequence to abort.'), L('out', 'Sending 5, 100-byte ICMP Echos to ' + ip + ', timeout is 2 seconds:')];
      let marks, got;
      if (r.ok && r.lossy) { marks = '!.!!.'; got = 3; }
      else if (r.ok) { marks = r.arpMiss ? '.!!!!' : '!!!!!'; got = r.arpMiss ? 4 : 5; }
      else if (r.stage === 'request' && r.kind === 'ttl') { marks = '&&&&&'; got = 0; }
      else { marks = r.stage === 'request' && (r.kind === 'noroute' || r.kind === 'acl') && r.at !== this.name ? 'U.U.U' : '.....'; got = 0; }
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
        const ports = Object.keys(d.ports).filter(n => !this.net.opTrunk(this.name, n) && (d.ports[n].vlan || 1) === v).map(shortIf).join(', ');
        out.push(pad(v, 5) + pad(d.vlans[v], 33) + pad('active', 10) + ports);
      });
      // Ports assigned to a VLAN that no longer exists are shown as inactive, like real IOS.
      [['1002', 'fddi-default'], ['1003', 'token-ring-default'], ['1004', 'fddinet-default'], ['1005', 'trnet-default']].forEach(([v, n]) => out.push(pad(v, 5) + pad(n, 33) + 'act/unsup'));
      return out.map(s => L('out', s));
    }
    showTrunk() {
      const d = this.d;
      const tr = Object.keys(d.ports).filter(n => this.net.opTrunk(this.name, n) && this.net.status(this.name, n).protocol === 'up');
      if (!tr.length) return [];
      const out = [pad('Port', 12) + pad('Mode', 13) + pad('Encapsulation', 15) + pad('Status', 14) + 'Native vlan'];
      const md = m => m === 'trunk' ? 'on' : m === 'dynamic auto' ? 'auto' : 'desirable';
      tr.forEach(n => out.push(pad(shortIf(n), 12) + pad(md(d.ports[n].mode), 13) + pad('802.1q', 15) + pad('trunking', 14) + (d.ports[n].native || 1)));
      const sect = (title, fn) => { out.push(''); out.push(pad('Port', 12) + title); tr.forEach(n => out.push(pad(shortIf(n), 12) + fn(d.ports[n]))); };
      const active = p => { const ids = Object.keys(d.vlans).map(Number); const list = !p.allowed || p.allowed === 'all' ? ids : p.allowed.filter(v => ids.indexOf(v) >= 0); return fmtVlans(uniqSort(list)); };
      sect('Vlans allowed on trunk', p => fmtVlans(p.allowed || 'all'));
      sect('Vlans allowed and active in management domain', active);
      sect('Vlans in spanning tree forwarding state and not pruned', active);
      return out.map(s => L('out', s));
    }
    showIntStatus() {
      const d = this.d, out = [pad('Port', 10) + pad('Name', 19) + pad('Status', 13) + pad('Vlan', 11) + pad('Duplex', 8) + pad('Speed', 6) + 'Type'];
      Object.keys(d.ports).forEach(n => {
        const c = d.ports[n], st = this.net.status(this.name, n), gi = n.indexOf('Gigabit') === 0, tr = this.net.opTrunk(this.name, n);
        const s = c.shutdown ? 'disabled' : st.errdis ? 'err-disabled' : st.protocol !== 'up' ? 'notconnect' : !tr && !d.vlans[c.vlan || 1] ? 'inactive' : 'connected';
        const up = s === 'connected' || s === 'inactive', em = up ? this.net.endMode(this.name, n) : null;
        const dx = (c.duplex || 'auto') === 'auto' ? (em ? 'a-' + em.duplex : 'auto') : c.duplex;
        const sp = (c.speed || 'auto') === 'auto' ? (em ? 'a-' + em.speed : 'auto') : c.speed;
        out.push(pad(shortIf(n), 10) + pad((c.description || '').slice(0, 18), 19) + pad(s, 13) + pad(tr ? 'trunk' : (c.vlan || 1), 11) + pad(dx, 8) + pad(sp, 6) + (gi ? '10/100/1000BaseTX' : '10/100BaseTX'));
      });
      return out.map(s => L('out', s));
    }
    showSwitchport() {
      const d = this.d, out = [], vn = v => v + ' (' + (d.vlans[v] || 'Inactive') + ')';
      Object.keys(d.ports).forEach(n => {
        const c = d.ports[n], tr = this.net.opTrunk(this.name, n), up = this.net.status(this.name, n).protocol === 'up', m = c.mode || 'access';
        out.push('Name: ' + shortIf(n), 'Switchport: Enabled', 'Administrative Mode: ' + (m === 'access' ? 'static access' : m),
          'Operational Mode: ' + (!up ? 'down' : tr ? 'trunk' : 'static access'), 'Administrative Trunking Encapsulation: dot1q',
          'Negotiation of Trunking: ' + (m === 'access' ? 'Off' : 'On'), 'Access Mode VLAN: ' + vn(c.vlan || 1), 'Trunking Native Mode VLAN: ' + vn(c.native || 1),
          'Trunking VLANs Enabled: ' + (!c.allowed || c.allowed === 'all' ? 'ALL' : fmtVlans(c.allowed)), '');
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
    showAcl() {
      const out = [], acls = this.d.acls || {};
      Object.keys(acls).sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b)) ? a - b : a < b ? -1 : 1).forEach(k => {
        const a = acls[k];
        out.push((a.type === 'std' ? 'Standard' : 'Extended') + ' IP access list ' + k);
        a.entries.forEach(e => out.push('    ' + e.seq + ' ' + (a.type === 'std' ? pad(e.action, 6) : e.action + ' ') + aceText(a.type, e) + (e.hits ? ' (' + e.hits + ' match' + (e.hits === 1 ? '' : 'es') + ')' : '')));
      });
      return out.map(s => L('out', s));
    }
    showIpInt(only) {
      const out = [];
      this.net.ifaceNames(this.name).filter(n => !only || n === only).forEach(n => {
        const x = this.d.ifaces[n], st = this.net.status(this.name, n);
        out.push(n + ' is ' + st.status + ', line protocol is ' + st.protocol);
        if (x.ip) out.push('  Internet address is ' + x.ip + '/' + prefixLen(x.mask), '  Broadcast address is 255.255.255.255', '  MTU is 1500 bytes');
        else out.push('  Internet protocol processing disabled');
        if (x.ip) out.push('  Outgoing access list is ' + (x.aclOut || 'not set'), '  Inbound  access list is ' + (x.aclIn || 'not set'), '  Proxy ARP is enabled', '  ICMP redirects are always sent');
      });
      return out.map(s => L('out', s));
    }
    showInterface(n) {
      const st = this.net.status(this.name, n), c = this.net.ifaceCfg(this.name, n), sw = this.d.type === 'switch', gi = /^Gigabit/.test(n);
      const tag = sw ? (st.errdis ? ' (err-disabled)' : c.shutdown ? ' (disabled)' : st.protocol === 'up' ? ' (connected)' : ' (notconnect)') : '';
      const em = st.protocol === 'up' ? this.net.endMode(this.name, n) : null, mac = this.net.mac(this.name, n);
      const p = this.net.peer(this.name, n), bad = em && p && this.net.duplexMismatch(p.link), h = hash32(this.name + n);
      const out = [n + ' is ' + st.status + ', line protocol is ' + st.protocol + tag, '  Hardware is ' + (gi ? 'Gigabit Ethernet' : 'Fast Ethernet') + ', address is ' + mac + ' (bia ' + mac + ')'];
      if (c.description) out.push('  Description: ' + c.description);
      if (!sw && c.ip) out.push('  Internet address is ' + c.ip + '/' + prefixLen(c.mask));
      out.push('  MTU 1500 bytes, BW ' + ((em ? em.speed : cap(this.name, n)) * 1000) + ' Kbit/sec, DLY ' + (gi ? 10 : 100) + ' usec,');
      out.push('  ' + (em ? (em.duplex === 'full' ? 'Full-duplex' : 'Half-duplex') + ', ' + em.speed + 'Mb/s' : (c.duplex && c.duplex !== 'auto' ? c.duplex[0].toUpperCase() + c.duplex.slice(1) + '-duplex' : 'Auto-duplex') + ', ' + (c.speed && c.speed !== 'auto' ? c.speed + 'Mb/s' : 'Auto-speed')) + ', media type is ' + (gi ? '10/100/1000BaseTX' : '10/100BaseTX'));
      const pin = em ? 9000 + h % 40000 : 0, crc = bad && em.duplex === 'full' ? 1200 + h % 900 : 0, late = bad && em.duplex === 'half' ? 800 + h % 700 : 0;
      out.push('  5 minute input rate ' + (em ? 2000 + h % 9000 : 0) + ' bits/sec, ' + (em ? 3 + h % 9 : 0) + ' packets/sec');
      out.push('     ' + pin + ' packets input, ' + pin * 131 + ' bytes, 0 no buffer');
      out.push('     ' + crc + ' input errors, ' + crc + ' CRC, 0 frame, 0 overrun, 0 ignored');
      out.push('     ' + (crc ? Math.floor(crc / 3) : 0) + ' runts, 0 giants');
      out.push('     0 output errors, ' + (late ? late * 3 : 0) + ' collisions, 0 interface resets');
      out.push('     ' + late + ' late collision, 0 deferred');
      return out.map(s => L('out', s));
    }
    showPsec() {
      const d = this.d, out = ['Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action', '                (Count)       (Count)          (Count)', '---------------------------------------------------------------------------'];
      Object.keys(d.ports).forEach(n => { const ps = d.ports[n].psec; if (!ps || !ps.on) return; out.push(shortIf(n).padStart(10) + String(ps.max || 1).padStart(15) + String((ps.macs || []).length + (ps.dyn || []).length).padStart(13) + String(ps.viol || 0).padStart(19) + '         ' + (ps.violation || 'shutdown').replace(/^./, x => x.toUpperCase())); });
      out.push('---------------------------------------------------------------------------', 'Total Addresses in System (excluding one mac per port)     : 0', 'Max Addresses limit in System (excluding one mac per port) : 4096');
      return out.map(s => L('out', s));
    }
    showPsecAddr() {
      const d = this.d, out = ['          Secure Mac Address Table', '-----------------------------------------------------------------------------', 'Vlan    Mac Address       Type                          Ports   Remaining Age', '                                                                   (mins)', '----    -----------       ----                          -----   -------------'];
      Object.keys(d.ports).forEach(n => { const ps = d.ports[n].psec; if (!ps || !ps.on) return; const v = String(d.ports[n].vlan || 1);
        (ps.macs || []).forEach(m => out.push(v.padStart(4) + '    ' + pad(m, 18) + pad(ps.sticky ? 'SecureSticky' : 'SecureConfigured', 30) + pad(shortIf(n), 8) + '    -'));
        (ps.dyn || []).forEach(m => out.push(v.padStart(4) + '    ' + pad(m, 18) + pad('SecureDynamic', 30) + pad(shortIf(n), 8) + '    -')); });
      out.push('-----------------------------------------------------------------------------');
      return out.map(s => L('out', s));
    }
    showPsecIf(n) {
      const c = this.d.ports[n], ps = c.psec || {}, st = this.net.status(this.name, n), on = !!ps.on;
      const status = !on ? 'Secure-down' : st.errdis === 'psecure-violation' ? 'Secure-shutdown' : st.protocol === 'up' ? 'Secure-up' : 'Secure-down';
      const out = ['Port Security              : ' + (on ? 'Enabled' : 'Disabled'), 'Port Status                : ' + status, 'Violation Mode             : ' + (ps.violation || 'shutdown').replace(/^./, x => x.toUpperCase()),
        'Aging Time                 : 0 mins', 'Aging Type                 : Absolute', 'SecureStatic Address Aging : Disabled', 'Maximum MAC Addresses      : ' + (ps.max || 1),
        'Total MAC Addresses        : ' + ((ps.macs || []).length + (ps.dyn || []).length), 'Configured MAC Addresses   : ' + (ps.sticky ? 0 : (ps.macs || []).length), 'Sticky MAC Addresses       : ' + (ps.sticky ? (ps.macs || []).length : 0),
        'Last Source Address:Vlan   : ' + (ps.last ? ps.last + ':' + (c.vlan || 1) : '0000.0000.0000:0'), 'Security Violation Count   : ' + (ps.viol || 0)];
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
          if (x.aclIn) c.push(' ip access-group ' + x.aclIn + ' in');
          if (x.aclOut) c.push(' ip access-group ' + x.aclOut + ' out');
          if (x.duplex && x.duplex !== 'auto') c.push(' duplex ' + x.duplex);
          if (x.speed && x.speed !== 'auto') c.push(' speed ' + x.speed);
          if (x.shutdown) c.push(' shutdown');
          c.push('!');
        });
        c.push('ip classless');
        (d.routes || []).forEach(r => c.push('ip route ' + r.net + ' ' + r.mask + ' ' + r.nh));
        c.push('!');
        const acls = d.acls || {};
        Object.keys(acls).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b).forEach(k => acls[k].entries.forEach(e => c.push('access-list ' + k + ' ' + pad(e.action, 6) + aceRun(acls[k].type, e))));
        Object.keys(acls).filter(k => !/^\d+$/.test(k)).forEach(k => { c.push('ip access-list ' + (acls[k].type === 'std' ? 'standard ' : 'extended ') + k); acls[k].entries.forEach(e => c.push(' ' + e.action + ' ' + aceRun(acls[k].type, e))); });
        if (Object.keys(acls).length) c.push('!');
      } else {
        Object.keys(d.ports).forEach(n => {
          const x = d.ports[n];
          c.push('interface ' + n);
          if (x.description) c.push(' description ' + x.description);
          if (x.mode === 'access' && x.vlan !== 1) c.push(' switchport access vlan ' + x.vlan);
          if (x.mode === 'trunk' && x.native && x.native !== 1) c.push(' switchport trunk native vlan ' + x.native);
          if (x.mode === 'trunk' && x.allowed && x.allowed !== 'all') c.push(' switchport trunk allowed vlan ' + fmtVlans(x.allowed));
          c.push(' switchport mode ' + (x.mode || 'access'));
          const ps = x.psec;
          if (ps && ps.on) {
            c.push(' switchport port-security');
            if ((ps.max || 1) !== 1) c.push(' switchport port-security maximum ' + ps.max);
            if (ps.violation && ps.violation !== 'shutdown') c.push(' switchport port-security violation ' + ps.violation);
            if (ps.sticky) c.push(' switchport port-security mac-address sticky');
            (ps.macs || []).forEach(m => c.push(' switchport port-security mac-address ' + (ps.sticky ? 'sticky ' : '') + m));
          }
          if (x.duplex && x.duplex !== 'auto') c.push(' duplex ' + x.duplex);
          if (x.speed && x.speed !== 'auto') c.push(' speed ' + x.speed);
          if (x.portfast) c.push(' spanning-tree portfast');
          if (x.bpduguard) c.push(' spanning-tree bpduguard enable');
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
        const all = (t[1] || '').toLowerCase() === '/all';
        const rows = ['', 'FastEthernet0 Connection:(default port)', '', '   Connection-specific DNS Suffix..: '];
        if (all) rows.push('   Physical Address................: ' + winMac(this.net.mac(this.name)), '   DHCP Enabled....................: No');
        rows.push('   IPv4 Address....................: ' + (d.ip || '0.0.0.0'), '   Subnet Mask.....................: ' + (d.mask || '0.0.0.0'), '   Default Gateway.................: ' + (d.gw || '0.0.0.0'), '');
        return { lines: rows.map(s => L('out', s)) };
      }
      if (c === 'ping') { const ip = t.slice(1).find(isIP); return ip ? this.ping(ip) : { lines: [L('err', 'Usage: ping <IPv4 address>')] }; }
      if (c === 'tracert') { const ip = t.slice(1).find(isIP); return ip ? this.tracert(ip) : { lines: [L('err', 'Usage: tracert <IPv4 address>')] }; }
      if (c === 'curl') {
        const u = t.slice(1).find(x => x[0] !== '-');
        if (!u) return { lines: [L('err', 'curl: try \'curl --help\' for more information')] };
        const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/i.exec(u), host = m ? m[1] : u;
        if (!isIP(host)) return { lines: [L('err', 'curl: (6) Could not resolve host: ' + host)] };
        return this.connect(host, m[2] ? +m[2] : 80, 'curl');
      }
      if (c === 'tnc' || c === 'test-netconnection') {
        const ip = t.slice(1).find(isIP), pi = t.findIndex(x => /^-port$/i.test(x)), port = pi > 0 ? +t[pi + 1] : 0;
        if (!ip || !(port > 0 && port < 65536)) return { lines: [L('err', 'Usage: tnc <IPv4 address> -port <number>')] };
        return this.connect(ip, port, 'tnc');
      }
      if (c === 'help' || c === '?') {
        return { lines: ['Available commands:', '  ipconfig [/all]          Show this PC\'s IP settings (/all adds the MAC address)', '  ping <address>           Test reachability (4 echo requests)',
          '  tracert <address>        List the routers on the path', '  curl http://<address>    Load a web page (TCP port 80)', '  tnc <address> -port <n>  Test a TCP port (Test-NetConnection)',
          '  cls                      Clear the screen', '', 'Change addresses in the IP settings tab.'].map(s => L('out', s)) };
      }
      if (c === 'cls' || c === 'clear') return { lines: [], clear: true };
      return { lines: [L('err', 'Invalid Command.')] };
    }
    // What Windows prints when a ping fails. Routers report unreachable networks and TTL expiry back to the sender,
    // if that message can find its way back.
    failLine(r) {
      const d = this.net.devices[this.name];
      if (r.stage === 'request' && r.kind === 'arp' && r.at === this.name) return 'Reply from ' + d.ip + ': Destination host unreachable.';
      if (r.stage !== 'request' || r.at === this.name || ['noroute', 'acl', 'ttl'].indexOf(r.kind) < 0) return null;
      const arr = r.fwd.arrivals.filter(a => a.dev === r.at).pop() || r.fwd.arrivals[r.fwd.arrivals.length - 1];
      if (!arr) return null;
      const back = this.net.route(r.at, d.ip);
      if (!back.ok || back.dev !== this.name) return null;
      return 'Reply from ' + arr.ip + ': ' + (r.kind === 'ttl' ? 'TTL expired in transit.' : r.kind === 'acl' ? 'Destination host unreachable.' : 'Destination net unreachable.');
    }
    ping(ip) {
      const d = this.net.devices[this.name];
      if (!d.ip) return { lines: [L('err', 'Unable to ping: this PC has no IP address. Set one in IP settings.')] };
      const r = this.net.ping(this.name, ip);
      const lines = [L('out', ''), L('out', 'Pinging ' + ip + ' with 32 bytes of data:'), L('out', '')];
      const ttl = r.ok ? (this.net.isRouter(r.dstDev) ? 255 : 128) - r.back.arrivals.length : 0, fl = r.ok ? null : this.failLine(r);
      let got = 0;
      for (let i = 0; i < 4; i++) {
        // Windows counts error replies as "received", which is why a failing ping can show 0% loss.
        if (fl) { lines.push(L('err', fl)); got++; }
        else if (!r.ok || (i === 0 && r.arpMiss) || (r.lossy && i % 3 === 1)) lines.push(L('err', 'Request timed out.'));
        else { lines.push(L('ok', 'Reply from ' + ip + ': bytes=32 time' + (r.lossy ? '=' + (14 + i * 9) + 'ms' : '<1ms') + ' TTL=' + ttl)); got++; }
      }
      lines.push(L('out', ''), L('out', 'Ping statistics for ' + ip + ':'), L('out', '    Packets: Sent = 4, Received = ' + got + ', Lost = ' + (4 - got) + ' (' + (4 - got) * 25 + '% loss),'));
      if (got && !fl) lines.push(L('out', 'Approximate round trip times in milli-seconds:'), L('out', r.lossy ? '    Minimum = 14ms, Maximum = 41ms, Average = 26ms' : '    Minimum = 0ms, Maximum = 0ms, Average = 0ms'));
      lines.push(L('out', ''));
      return { lines, ping: { from: this.name, to: ip, res: r } };
    }
    connect(ip, port, tool) {
      const d = this.net.devices[this.name];
      if (!d.ip) return { lines: [L('err', 'This PC has no IP address. Set one in IP settings.')] };
      const r = this.net.connect(this.name, ip, port), lines = [];
      if (tool === 'curl') {
        if (r.ok) { const site = this.net.devices[r.dstDev].site || r.dstDev; lines.push(L('ok', '<!DOCTYPE html>'), L('ok', '<html><head><title>' + site + '</title></head>'), L('ok', '<body><h1>' + site + '</h1><p>It works.</p></body></html>')); }
        else if (r.stage === 'refused') lines.push(L('err', 'curl: (7) Failed to connect to ' + ip + ' port ' + port + ' after 4 ms: Connection refused'));
        else lines.push(L('err', 'curl: (28) Failed to connect to ' + ip + ' port ' + port + ' after 21043 ms: Timed out'));
      } else {
        if (!r.ok) lines.push(L('err', 'WARNING: TCP connect to (' + ip + ' : ' + port + ') failed'));
        [['ComputerName', ip], ['RemoteAddress', ip], ['RemotePort', port], ['InterfaceAlias', 'Ethernet'], ['SourceAddress', d.ip], ['TcpTestSucceeded', r.ok ? 'True' : 'False']]
          .forEach(([k, v]) => lines.push(L(k === 'TcpTestSucceeded' ? (r.ok ? 'ok' : 'err') : 'out', pad(k, 17) + ': ' + v)));
      }
      lines.push(L('out', ''));
      return { lines, ping: { from: this.name, to: ip, port, res: r } };
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

  const api = { Network, IOSShell, PCShell, isIP, isMask, shortIf, fmtVlans, parseVlanList, tokenize, HOSTS, winMac };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Outage = api;
})(typeof window !== 'undefined' ? window : globalThis);
