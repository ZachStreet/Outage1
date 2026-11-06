(function () {
  'use strict';
  const { Network, IOSShell, PCShell, shortIf, isIP, isMask, HOSTS } = window.Outage;
  const DAYS = window.OUTAGE_DAYS || {};
  const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const TODAY = dayKey(new Date());
  // A day's switch appears on its date, in the player's own time zone.
  const PUZ = window.OUTAGE_PUZZLES.filter(p => !DAYS[p.day] || DAYS[p.day] <= TODAY);
  const DAYLIST = Array.from(new Set(PUZ.map(p => p.day))).sort((a, b) => b - a);
  const dayPuz = d => PUZ.filter(p => p.day === d);
  const portOf = p => dayPuz(p.day).indexOf(p) + 1;
  const dayDate = (d, opts) => { const k = DAYS[d]; if (!k) return ''; const [y, m, dd] = k.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-AU', opts || { weekday: 'short', day: 'numeric', month: 'short' }); };
  const $ = s => document.querySelector(s);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const fmtTime = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const DIFF = ['', 'Easy', 'Medium', 'Hard'];
  const ESC = [['Ask a colleague', 'Colleague'], ['Escalate to a senior engineer', 'Senior engineer'], ['Open a vendor support case', 'Vendor support']];
  const SITE = !!window.OUTAGE_SITE;

  // ---------- leaderboard identity (website version only) ----------
  // A random private key stays in this browser; the server only ever shows a hash of it.
  const PKEY = 'outage-player-v1';
  function loadMe() { try { const v = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (v && v.key) return v; } catch (e) { /* storage unavailable */ } return null; }
  function saveMe() { try { localStorage.setItem(PKEY, JSON.stringify(ME)); } catch (e) { /* storage unavailable */ } }
  function newKey() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
  const nameOk = s => /^[\p{L}\p{N} ._'-]{1,20}$/u.test(s);
  let ME = loadMe();

  // ---------- progress (this browser only) ----------
  const KEY = 'outage-progress-v1';
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.solved) return v; } catch (e) { /* storage unavailable */ } return { solved: {}, xp: 0, days: [] }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(PR)); } catch (e) { /* storage unavailable */ } }
  const PR = load();
  const TITLES = ['Help desk', 'NOC tech', 'Network engineer', 'Senior engineer', 'Principal engineer'];
  const PER = 600;
  const level = xp => { const lv = Math.floor(xp / PER) + 1; return { lv, title: TITLES[Math.min(TITLES.length - 1, lv - 1)], pct: Math.round((xp % PER) / PER * 100) }; };
  function streak() {
    const set = new Set(PR.days || []), d = new Date(); let n = 0;
    if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const rankFor = (sec, hints) => hints === 0 && sec <= 180 ? 'Principal engineer' : hints === 0 ? 'Senior engineer' : hints === 1 ? 'Network engineer' : hints === 2 ? 'NOC tech' : 'Help desk';
  const xpFor = (p, sec, hints, fails) => Math.max(50, 200 + 100 * p.diff + Math.max(0, 180 - Math.floor(sec / 2)) - 120 * hints - 10 * fails);

  function renderStats() {
    const lv = level(PR.xp), st = streak();
    $('#stats').innerHTML =
      `<span>Level <b>${lv.lv}</b>, ${esc(lv.title)}<span class="meter" aria-hidden="true"><i style="width:${lv.pct}%"></i></span></span>` +
      `<span><b>${PR.xp}</b> XP</span><span>Streak <b>${st}</b> ${st === 1 ? 'day' : 'days'}</span>`;
  }
  // The logo light and the headline's full stop are one status: red until every outage is fixed.
  function setBrandLed(up) { const l = $('#brand-led'); l.className = 'led ' + (up ? 'led-g' : 'led-r blink'); }
  function setHudStatus(allUp) { $('#hud').classList.toggle('all-up', allUp); }

  // ---------- home: a rack with one switch per day, newest on top ----------
  let selected = null, posted = false;
  function nextUp() { for (const d of DAYLIST) { const n = dayPuz(d).find(p => !PR.solved[p.id]); if (n) return n; } return null; }
  function renderPanel(scrollToSel) {
    const next = nextUp();
    if (!selected || !PUZ.some(p => p.id === selected)) selected = (next || dayPuz(DAYLIST[0])[0]).id;
    const rack = $('#rack'), keep = rack.scrollTop;
    let i = 0;
    rack.innerHTML = DAYLIST.map(d => {
      const list = dayPuz(d), up = list.filter(p => PR.solved[p.id]).length, today = DAYS[d] === TODAY;
      const stat = up === list.length ? 'led-g' : up ? 'led-a' : 'led-r';
      const ports = list.map((p, k) => {
        const solved = !!PR.solved[p.id], isSel = p.id === selected, isNext = next && p.id === next.id;
        return `<button type="button" class="port" data-id="${p.id}" style="--i:${i++}" aria-pressed="${isSel}" aria-label="Day ${d}, port ${k + 1}, ${esc(p.title)}, ${solved ? 'fixed' : 'down'}">` +
          `<span class="port-num" aria-hidden="true">${k + 1}</span><span class="led ${solved ? 'led-g' : 'led-r' + (isNext ? ' blink' : '')}"></span>` +
          `<span class="jack"><span class="jack-hole"></span>${isSel ? '<span class="boot"></span>' : ''}</span><span class="tape port-tape">${esc(p.title)}</span></button>`;
      }).join('');
      return `<div class="unit${list.some(p => p.id === selected) ? ' is-sel' : ''}" data-day="${d}" role="group" aria-label="Day ${d}${DAYS[d] ? ', ' + esc(dayDate(d, { weekday: 'long', day: 'numeric', month: 'long' })) : ''}. ${up} of ${list.length} fixed.">` +
        `<div class="ear" aria-hidden="true"><i></i><i></i></div><div class="face">` +
        `<div class="u-id"><span class="tape u-day">Day ${d}</span><span class="u-date">${esc(dayDate(d))}${today ? ' <b>Today</b>' : ''}</span><span class="u-model">OUTAGE 5</span></div>` +
        `<div class="ports">${ports}</div>` +
        `<div class="u-stat" aria-hidden="true"><div class="silk"><span><i class="led led-g"></i>SYST</span><span><i class="led ${stat}"></i>STAT</span></div><span class="u-count"><b>${up}</b>/${list.length} up</span></div>` +
        `</div><div class="ear" aria-hidden="true"><i></i><i></i></div></div>`;
    }).join('') + '<div class="unit unit-blank" aria-hidden="true"><div class="ear"><i></i><i></i></div><div class="face"><span class="vents"></span></div><div class="ear"><i></i><i></i></div></div>';
    rack.querySelectorAll('.port').forEach(b => { b.onclick = () => { selected = b.getAttribute('data-id'); renderPanel(); renderDetail(); }; });
    rack.scrollTop = keep;
    if (scrollToSel) { const u = rack.querySelector('.unit.is-sel'); if (u) rack.scrollTop = Math.max(0, u.offsetTop - 10); }
    rackFade();
    $('#rack-count').textContent = `${PUZ.filter(p => PR.solved[p.id]).length}/${PUZ.length} fixed across ${DAYLIST.length} ${DAYLIST.length === 1 ? 'day' : 'days'}`;
    if (!posted && !RM) {
      posted = true; rack.classList.add('post');
      setTimeout(() => rack.classList.remove('post'), i * 55 + 950);
    }
  }
  // Fade the bottom edge while there are more switches below, so it reads as scrollable.
  function rackFade() { const r = $('#rack'); r.classList.toggle('more-below', r.scrollTop + r.clientHeight < r.scrollHeight - 4); }
  $('#rack').addEventListener('scroll', rackFade, { passive: true });
  window.addEventListener('resize', rackFade);
  function renderDetail() {
    const p = PUZ.find(x => x.id === selected), s = PR.solved[p.id];
    $('#detail').innerHTML = `
      <div class="d-main">
        <p class="d-port">Day ${p.day}${DAYS[p.day] ? ', ' + esc(dayDate(p.day)) : ''} · Port ${portOf(p)}</p>
        <h2 class="d-title">${esc(p.title)}</h2>
        <p class="d-teaser">${esc(p.teaser)}</p>
        <button class="btn btn-go" id="start" type="button">${s ? 'Fix it again' : 'Start troubleshooting'}</button>
      </div>
      <dl class="facts">
        <div><dt>Covers</dt><dd>${esc(p.topics.join(', '))}</dd></div>
        <div><dt>Difficulty</dt><dd><span class="diff" aria-hidden="true">${[1, 2, 3].map(i => `<i class="led ${i <= p.diff ? 'led-a' : ''}"></i>`).join('')}</span>${DIFF[p.diff]}</dd></div>
        <div><dt>Status</dt><dd><i class="led ${s ? 'led-g' : 'led-r'}" aria-hidden="true"></i>${s ? `Link up. Fixed in ${fmtTime(s.time)}, ranked ${esc(s.rank)}.` : 'Link down. Not fixed yet.'}</dd></div>
      </dl>`;
    $('#start').onclick = () => go(p.id);
  }

  // ---------- routing ----------
  function go(id) { if (location.hash.slice(1) === id) route(); else location.hash = id; }
  function goHome() { if (location.hash) location.hash = ''; else route(); }
  function route() {
    const h = location.hash.slice(1), p = PUZ.find(x => x.id === h);
    $('#overlay').hidden = true;
    if (p) openPuzzle(p); else if (h === 'leaderboard' && SITE) showBoard(); else showHome();
  }
  function showHome() {
    stopTimer(); G = null;
    $('#play').hidden = true; $('#board').hidden = true; $('#home').hidden = false; navCurrent(false);
    const allFixed = PUZ.every(p => PR.solved[p.id]);
    setBrandLed(allFixed); setHudStatus(allFixed);
    renderPanel(true); renderDetail(); renderStats(); window.scrollTo(0, 0);
  }

  // ---------- game ----------
  let G = null, timer = null;
  const KIND = { router: 'router', switch: 'switch', pc: 'PC', server: 'server', printer: 'printer', camera: 'camera' };
  const ln = (t, s) => ({ t, s });

  function openPuzzle(p) {
    stopTimer();
    const net = new Network(p);
    G = { p, net, shells: {}, buf: {}, hist: {}, hi: {}, active: p.start, t0: Date.now(), hints: 0, cmds: 0, tries: [], obj: p.objectives.map(o => Object.assign({ state: 'idle' }, o)), solved: false, anim: 0, pcTab: 'cmd', end: 0 };
    Object.keys(net.devices).forEach(n => {
      const d = net.devices[n];
      if (d.type === 'router' || d.type === 'switch') {
        G.shells[n] = new IOSShell(net, n, (dev, lines) => push(dev, lines));
        G.buf[n] = [ln('dim', n + ' con0 is now available'), ln('dim', ''), ln('dim', 'Press RETURN to get started.'), ln('dim', '')];
      } else {
        G.shells[n] = new PCShell(net, n);
        G.buf[n] = [ln('dim', 'Outage PC command line 1.0'), ln('dim', 'Type help to list commands.'), ln('dim', '')];
      }
      G.hist[n] = []; G.hi[n] = 0;
    });
    $('#home').hidden = true; $('#board').hidden = true; $('#play').hidden = false; navCurrent(false);
    setBrandLed(false);
    // Switches that disagree about a trunk's native VLAN have been logging it via CDP all along.
    net.nativeMismatches().forEach(m => G.buf[m.dev].push(ln('sys', m.line), ln('sys', m.line), ln('dim', '')));
    G.cdpAt = 0;
    renderTicket(); renderTopo(); renderTabs(); renderPane(); renderStats();
    setStatus('', 'Press Test next to a test point to watch the packet, or pick a device and start investigating.');
    timer = setInterval(tickStats, 1000);
    window.scrollTo(0, 0);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }
  const elapsed = () => Math.floor(((G.solved ? G.end : Date.now()) - G.t0) / 1000);

  function renderTicket() {
    const p = G.p, pri = p.ticket.pri;
    $('#tk-form').innerHTML =
      `<dt>Ticket</dt><dd>${esc(p.ticket.id)}</dd><dt>Priority</dt><dd><span class="tape ${pri === 'P1' ? 'tape-r' : 'tape-y'}">${esc(pri)}</span></dd>` +
      `<dt>Opened</dt><dd>${esc(p.ticket.opened)}</dd><dt>Port</dt><dd>Day ${p.day}, ${portOf(p)}</dd>`;
    $('#tk-title').textContent = p.title;
    $('#tk-story').textContent = p.story;
    renderObjectives(); renderHints(); tickStats();
  }
  function tickStats() {
    if (!G) return;
    // CDP repeats the native VLAN complaint every minute until it's fixed.
    if (!G.solved && elapsed() - G.cdpAt >= 60) { G.cdpAt = elapsed(); G.net.nativeMismatches().forEach(m => push(m.dev, [ln('sys', m.line)])); }
    $('#st-time').textContent = fmtTime(elapsed());
    $('#st-cmds').textContent = G.cmds;
    $('#st-hints').textContent = G.hints + '/' + G.p.hints.length;
  }
  function renderObjectives() {
    const ul = $('#obj'); ul.innerHTML = '';
    G.obj.forEach(o => {
      const li = document.createElement('li');
      const led = o.state === 'pass' ? 'led-g' : o.state === 'fail' ? 'led-r' : '';
      const label = o.state === 'pass' ? 'Passing' : o.state === 'fail' ? 'Failing' : 'Not tested yet';
      li.innerHTML = `<i class="led ${led}" aria-hidden="true"></i><span class="t-text">${esc(o.text)}<span class="sr"> (${label})</span><span class="t-cmd">${esc(o.from)}: ping ${esc(o.to)}</span></span><button class="push" type="button">Test</button>`;
      li.querySelector('button').onclick = () => testObjective(o);
      ul.appendChild(li);
    });
  }
  function renderHints() {
    const p = G.p;
    $('#hints').innerHTML = p.hints.slice(0, G.hints).map((h, i) => `<li><b>${ESC[i][1]}</b>${md(h)}</li>`).join('');
    $('#hints').hidden = G.hints === 0;
    const b = $('#hint-btn');
    b.hidden = G.hints >= p.hints.length;
    if (!b.hidden) b.innerHTML = `${ESC[G.hints][0]} <span class="esc-cost">(costs 120 XP)</span>`;
  }

  // ---------- network map ----------
  // Each glyph: body markup, half-size for selection brackets, name-tape y, LED offset along a link.
  const GLYPH = {
    router: { w: 38, h: 17, tape: 26, led: 50, svg: '<rect class="g-body" x="-36" y="-15" width="72" height="30" rx="4"/><circle class="g-pwr" cx="-25" cy="0" r="3"/><rect class="g-hole" x="-8" y="-6" width="11" height="10" rx="1"/><rect class="g-hole" x="7" y="-6" width="11" height="10" rx="1"/><rect class="g-hole" x="22" y="-6" width="8" height="10" rx="1"/>' },
    switch: { w: 46, h: 16, tape: 25, led: 58, svg: '<rect class="g-body" x="-44" y="-14" width="88" height="28" rx="4"/><circle class="g-pwr" cx="-34" cy="0" r="3"/>' + [0, 1, 2, 3, 4, 5].map(i => `<rect class="g-hole" x="${-22 + i * 10}" y="-8" width="7" height="6" rx="1"/><rect class="g-hole" x="${-22 + i * 10}" y="1" width="7" height="6" rx="1"/>`).join('') },
    pc: { w: 25, h: 22, tape: 28, led: 38, svg: '<rect class="g-body" x="-23" y="-21" width="46" height="31" rx="3"/><rect class="g-screen" x="-18" y="-16" width="36" height="21" rx="1.5"/><path class="g-line" d="M0 10V17M-11 18H11"/>' },
    server: { w: 20, h: 28, tape: 35, led: 36, svg: '<rect class="g-body" x="-17" y="-27" width="34" height="54" rx="3"/><rect class="g-hole" x="-11" y="-20" width="22" height="5" rx="1"/><rect class="g-hole" x="-11" y="-11" width="22" height="5" rx="1"/><rect class="g-hole" x="-11" y="-2" width="22" height="5" rx="1"/><circle class="g-pwr" cx="8" cy="17" r="2.6"/>' },
    printer: { w: 25, h: 24, tape: 28, led: 38, svg: '<rect class="g-body" x="-14" y="-23" width="28" height="12" rx="2"/><rect class="g-body" x="-23" y="-12" width="46" height="23" rx="3"/><rect class="g-hole" x="-14" y="4" width="28" height="4" rx="1"/><path class="g-line" d="M-12 11V19H12V11"/>' },
    camera: { w: 25, h: 20, tape: 26, led: 36, svg: '<path class="g-line" d="M-6 8V18M-15 19H3"/><rect class="g-body" x="-23" y="-15" width="34" height="23" rx="4"/><path class="g-body" d="M11 -9L23 -14V9L11 4Z"/><circle class="g-screen" cx="-6" cy="-3.5" r="7"/><circle class="g-pwr" cx="-17" cy="-9" r="2.2"/>' }
  };
  const cableType = (net, l) => {
    const A = net.devices[l.a].type, B = net.devices[l.b].type;
    if (HOSTS.indexOf(A) >= 0 || HOSTS.indexOf(B) >= 0) return 'access';
    if (A === 'router' && B === 'router') return 'wan';
    return 'uplink';
  };
  function brackets(w, h) {
    const x = w + 8, y = h + 8, k = 9;
    return `<path class="g-sel" d="M${-x} ${-y + k}V${-y}H${-x + k}M${x - k} ${-y}H${x}V${-y + k}M${x} ${y - k}V${y}H${x - k}M${-x + k} ${y}H${-x}V${y - k}"/>`;
  }
  // ---------- map label layout ----------
  // Every label (port names, roles, IPs, subnet notes) is placed where it overlaps no device, LED, other label or cable.
  // Candidates are scored and the cheapest wins, so crowded switches push labels further along their cables.
  const VB = { w: 900, h: 380 };
  const CW = { port: 6.95, sub: 6.95, net: 7.6 };
  const tapeW = n => Math.round(n.length * 7.7 + 16);
  const hit = (a, b, pad) => a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad;
  function segHit(s, r, pad) {
    const x1 = r.x1 - pad, y1 = r.y1 - pad, x2 = r.x2 + pad, y2 = r.y2 + pad, dx = s[2] - s[0], dy = s[3] - s[1];
    const P = [-dx, dx, -dy, dy], Q = [s[0] - x1, x2 - s[0], s[1] - y1, y2 - s[1]];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return false; continue; }
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  const textBox = (x, y, w, anchor, size) => { const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2; return { x1, x2: x1 + w, y1: y - size * 0.78, y2: y + size * 0.24 }; };
  function layoutMap(net, p) {
    const devs = net.devices, names = Object.keys(devs), fixed = [], placed = [];
    const segs = net.links.map(l => [devs[l.a].x, devs[l.a].y, devs[l.b].x, devs[l.b].y]);
    names.forEach(n => {
      const d = devs[n], g = GLYPH[d.type], tw = tapeW(n);
      fixed.push({ x1: d.x - g.w, y1: d.y - g.h, x2: d.x + g.w, y2: d.y + g.h });
      fixed.push({ x1: d.x - tw / 2, y1: d.y + g.tape, x2: d.x + tw / 2, y2: d.y + g.tape + 21 });
    });
    const ends = [];
    net.links.forEach((l, i) => {
      const A = devs[l.a], B = devs[l.b], dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      [[l.a, l.ai, A, 1], [l.b, l.bi, B, -1]].forEach(([dn, ifn, D, sg]) => {
        const off = GLYPH[D.type].led, e = { i, dn, ifn, D, ux: ux * sg, uy: uy * sg, off, lx: D.x + ux * off * sg, ly: D.y + uy * off * sg };
        ends.push(e); fixed.push({ x1: e.lx - 7, y1: e.ly - 7, x2: e.lx + 7, y2: e.ly + 7 });
      });
    });
    // clear: how far a label must stay from cables. Labels also keep a gap from each other so two ports never read as one.
    const cost = (b, own, clear) => {
      let c = 0;
      if (b.x1 < 3 || b.x2 > VB.w - 3 || b.y1 < 3 || b.y2 > VB.h - 2) c += 5000;
      fixed.forEach(o => { if (hit(b, o, 2)) c += 1000; });
      placed.forEach(o => { if (hit(b, o, 3)) c += 1000; else if (hit(b, o, 9)) c += 60; });
      segs.forEach((sg, i) => { if (segHit(sg, b, 4)) c += i === own ? 500 : 260; else if (segHit(sg, b, clear)) c += 25; });
      return c;
    };
    const pick = (cands, own, clear) => {
      let best = null;
      cands.forEach(c => { const v = cost(c.box, own, clear || 4) + c.pref; if (!best || v < best.v) best = Object.assign({ v }, c); });
      placed.push(best.box); return best;
    };
    const out = { subs: {}, nets: [], ports: [] };
    // 1. Text under each device: a host's IP, or a router's or switch's role. Hosts keep theirs below.
    names.slice().sort((a, b) => HOSTS.indexOf(devs[b].type) - HOSTS.indexOf(devs[a].type)).forEach(n => {
      const d = devs[n], g = GLYPH[d.type], host = HOSTS.indexOf(d.type) >= 0, t = host ? (d.ip || 'no IP') : (d.role || '');
      if (!t) return;
      const w = t.length * CW.sub, at = (dx, dy, anchor, pref) => ({ dx, dy, anchor, pref, box: textBox(d.x + dx, d.y + dy, w, anchor, 11.5) });
      const cands = [at(0, g.tape + 36, 'middle', 0), at(0, -g.h - 9, 'middle', host ? 80 : 4), at(g.w + 10, 4, 'start', host ? 90 : 9), at(-g.w - 10, 4, 'end', host ? 90 : 11)];
      out.subs[n] = Object.assign({ t }, pick(cands, -1, 12));
    });
    // 2. Subnet notes: nudge up or down from where the puzzle put them.
    (p.labels || []).forEach(l => {
      const w = l.t.length * CW.net, cands = [];
      [0, -10, 10, -20, 20, -32, 32, -46, 46].forEach(dy => cands.push({ x: l.x, y: l.y + dy, pref: Math.abs(dy) * 0.6, box: textBox(l.x, l.y + dy, w, 'middle', 12.5) }));
      out.nets.push(Object.assign({ t: l.t }, pick(cands, -1)));
    });
    // 3. Port names: beside their LED, sliding further along the cable when it's crowded.
    ends.slice().sort((a, b) => GLYPH[b.D.type].led - GLYPH[a.D.type].led).forEach(e => {
      const t = shortIf(e.ifn), w = t.length * CW.port, cands = [];
      let nx = -e.uy, ny = e.ux; if (ny < 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
      [14, 26, 40, 56, 74].forEach((a, ai) => [1, -1].forEach(sd => [15, 23].forEach(q => {
        const px = e.D.x + e.ux * (e.off + a) + nx * sd * q, py = e.D.y + e.uy * (e.off + a) + ny * sd * q + 4;
        const sx = nx * sd, anchor = sx > 0.35 ? 'start' : sx < -0.35 ? 'end' : 'middle';
        cands.push({ x: px, y: py, anchor, pref: ai * 7 + (q - 15) * 0.6 + (sd === 1 ? 0 : 2), box: textBox(px, py, w, anchor, 11.5) });
      })));
      // A label must sit nearer its own LED than any other, or it reads as the wrong port.
      cands.forEach(c => {
        const cx = (c.box.x1 + c.box.x2) / 2, cy = (c.box.y1 + c.box.y2) / 2, mine = Math.hypot(cx - e.lx, cy - e.ly);
        if (ends.some(o => o !== e && Math.hypot(cx - o.lx, cy - o.ly) < mine - 4)) c.pref += 300;
      });
      out.ports.push(Object.assign({ e, t }, pick(cands, e.i)));
    });
    return out;
  }
  function renderTopo() {
    const net = G.net, p = G.p, L = layoutMap(net, p); let s = '';
    L.nets.forEach(l => { s += `<text class="c-net" x="${l.x}" y="${l.y}" text-anchor="middle">${esc(l.t)}</text>`; });
    net.links.forEach((l, i) => {
      const A = net.devices[l.a], B = net.devices[l.b];
      const up = net.linkUp(i) && net.status(l.a, l.ai).protocol === 'up';
      s += `<line class="c-link c-${cableType(net, l)}${up ? '' : ' is-down'}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
    });
    L.ports.forEach(pl => {
      const e = pl.e, st = net.status(e.dn, e.ifn);
      s += `<circle class="c-led ${st.protocol === 'up' ? 'is-up' : 'is-down'}" cx="${e.lx.toFixed(1)}" cy="${e.ly.toFixed(1)}" r="6"><title>${esc(e.dn + ' ' + e.ifn + ': ' + st.status + '/' + st.protocol)}</title></circle>`;
      s += `<text class="c-port" x="${pl.x.toFixed(1)}" y="${pl.y.toFixed(1)}" text-anchor="${pl.anchor}">${esc(pl.t)}</text>`;
    });
    Object.keys(net.devices).forEach(n => {
      const d = net.devices[n], g = GLYPH[d.type], tw = tapeW(n), sub = L.subs[n];
      const hx = Math.max(g.w, tw / 2) + 6, top = Math.min(-g.h - 10, sub ? sub.box.y1 - d.y - 4 : 0), bot = Math.max(g.tape + 24, sub ? sub.box.y2 - d.y + 4 : 0);
      s += `<g class="dev${n === G.active ? ' is-sel' : ''}" data-dev="${esc(n)}" transform="translate(${d.x},${d.y})" tabindex="0" role="button" aria-label="Open the console on ${esc(n)}">` +
        `<rect class="g-hit" x="${-hx}" y="${top}" width="${hx * 2}" height="${bot - top}"/>` +
        brackets(g.w, g.h) + g.svg +
        `<rect class="g-tape-shadow" x="${-tw / 2}" y="${g.tape + 1.5}" width="${tw}" height="20" rx="1.5"/><rect class="g-tape" x="${-tw / 2}" y="${g.tape}" width="${tw}" height="20" rx="1.5"/>` +
        `<text class="g-name" y="${g.tape + 14.5}" text-anchor="middle">${esc(n)}</text>` +
        (sub ? `<text class="g-sub" x="${sub.dx}" y="${sub.dy}" text-anchor="${sub.anchor}">${esc(sub.t)}</text>` : '') + '</g>';
    });
    $('#topo-static').innerHTML = s;
  }
  $('#topo').addEventListener('click', e => { const g = e.target.closest('[data-dev]'); if (g && G) select(g.getAttribute('data-dev'), true); });
  $('#topo').addEventListener('keydown', e => { const g = e.target.closest('[data-dev]'); if (g && G && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.getAttribute('data-dev'), true); } });

  // ---------- packet animation ----------
  const pos = n => { const d = G.net.devices[n]; return { x: d.x, y: d.y }; };
  function travel(h, cls, token) {
    return new Promise(res => {
      if (RM) return res();
      const a = pos(h.from), b = pos(h.to), c = document.createElementNS(SVGNS, 'circle'), t0 = performance.now(), ms = 320;
      c.setAttribute('r', '7.5'); c.setAttribute('class', 'pkt ' + cls); c.setAttribute('cx', a.x); c.setAttribute('cy', a.y);
      $('#topo-anim').appendChild(c);
      (function f(t) {
        const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        c.setAttribute('cx', a.x + (b.x - a.x) * e); c.setAttribute('cy', a.y + (b.y - a.y) * e);
        if (k < 1 && G && token === G.anim) requestAnimationFrame(f); else { c.remove(); res(); }
      })(t0);
    });
  }
  async function walk(hops, cls, token) {
    for (let i = 0; i < hops.length;) {
      if (!G || token !== G.anim) return false;
      const h = hops[i];
      if (h.flood) {
        const group = [];
        while (i < hops.length && hops[i].flood && hops[i].from === h.from) group.push(hops[i++]);
        await Promise.all(group.map(g => travel(g, 'pkt-arp', token)));
      } else { await travel(h, cls, token); i++; }
    }
    return !!G && token === G.anim;
  }
  function mark(n, cls, label) {
    const p = pos(n), g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'mk ' + cls);
    g.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="38"/>` + (label ? `<text x="${p.x + 34}" y="${p.y - 28}">${label}</text>` : '');
    $('#topo-anim').appendChild(g);
    setTimeout(() => g.remove(), 1500);
  }
  async function animate(from, r) {
    const token = ++G.anim;
    $('#topo-anim').innerHTML = '';
    if (!(await walk(r.fwd.hops, 'pkt-req', token))) return;
    if (r.stage === 'request') { mark(r.at, 'mk-bad', '×'); return; }
    if (r.dstDev !== from) mark(r.dstDev, 'mk-hit', '');
    if (!(await walk(r.back.hops, 'pkt-rep', token))) return;
    if (r.ok) mark(from, 'mk-ok', '✓'); else mark(r.at, 'mk-bad', '×');
  }
  function describe(from, r) {
    if (r.ok) return ['ok', `Reply from ${r.dst}. The round trip from ${from} to ${r.dstDev} and back works.`];
    if (r.stage === 'request') {
      if (r.kind === 'arp') return ['bad', `No reply. ${r.at} sent an ARP broadcast asking who has ${r.nh}, and nobody answered.`];
      if (r.kind === 'noroute') return ['bad', `Dropped at ${r.at}: it has no route to ${r.dst}.`];
      if (r.kind === 'nogw') return ['bad', `${r.at} has no default gateway, so it can’t send anything off its own subnet.`];
      if (r.kind === 'noip') return ['bad', `${r.at} has no IP address.`];
      return ['bad', 'The packet looped until its TTL ran out.'];
    }
    return ['bad', `${r.dstDev} received the request, but its reply never made it back to ${from}.`];
  }
  function setStatus(tone, text) {
    $('#wire-led').className = 'led' + (tone === 'ok' ? ' led-g' : tone === 'bad' ? ' led-r' : tone === 'busy' ? ' led-a blink' : '');
    $('#wire-text').textContent = text;
  }

  // ---------- console ----------
  function renderTabs() {
    const tabs = $('#tabs'); tabs.innerHTML = '';
    Object.keys(G.net.devices).forEach(n => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(n === G.active));
      b.innerHTML = `${esc(n)}<span class="tab-kind">${KIND[G.net.devices[n].type]}</span>`;
      b.onclick = () => select(n, true);
      tabs.appendChild(b);
    });
  }
  function select(n, focus) {
    G.active = n; renderTabs(); renderTopo(); renderPane();
    if (focus) { const sel = $('#tabs [aria-selected="true"]'); if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' }); focusInput(); }
  }
  const isHostDev = n => HOSTS.indexOf(G.net.devices[n].type) >= 0;
  function renderPane() {
    const host = isHostDev(G.active), ipMode = host && G.pcTab === 'ip';
    $('#pcswitch').hidden = !host;
    $('#seg-cmd').setAttribute('aria-pressed', String(!ipMode));
    $('#seg-ip').setAttribute('aria-pressed', String(ipMode));
    $('#term-body').hidden = ipMode; $('#ipset').hidden = !ipMode;
    if (ipMode) {
      const d = G.net.devices[G.active];
      $('#ip-addr').value = d.ip || ''; $('#ip-mask').value = d.mask || ''; $('#ip-gw').value = d.gw || '';
      $('#ip-msg').textContent = ''; $('#ip-msg').className = 'ipset-msg';
    } else { renderScreen(); $('#prompt').textContent = G.shells[G.active].prompt(); }
  }
  function lineEl(l) {
    const div = document.createElement('div');
    div.className = 'ln ln-' + l.t;
    if (l.t === 'cmd') {
      const sp = document.createElement('span'); sp.className = 'ln-prompt'; sp.textContent = l.p;
      div.appendChild(sp); div.appendChild(document.createTextNode(l.s));
    } else div.textContent = l.s;
    return div;
  }
  function renderScreen() {
    const scr = $('#screen'), frag = document.createDocumentFragment();
    G.buf[G.active].forEach(l => frag.appendChild(lineEl(l)));
    scr.innerHTML = ''; scr.appendChild(frag); scr.scrollTop = scr.scrollHeight;
  }
  function push(dev, lines) {
    if (!G || !G.buf[dev]) return;
    const b = G.buf[dev];
    lines.forEach(l => b.push(l));
    if (b.length > 600) b.splice(0, b.length - 600);
    if (dev === G.active && !$('#term-body').hidden) renderScreen();
  }
  function focusInput() { if (!$('#term-body').hidden && window.matchMedia('(hover: hover)').matches) $('#cli').focus({ preventScroll: true }); }

  function run(line) {
    const n = G.active, sh = G.shells[n], before = G.net.version;
    push(n, [{ t: 'cmd', p: sh.prompt(), s: line }]);
    if (line.trim()) { G.hist[n].push(line); G.cmds++; }
    G.hi[n] = G.hist[n].length;
    const res = sh.exec(line);
    if (res.clear) G.buf[n] = [];
    push(n, res.lines || []);
    renderScreen();
    $('#prompt').textContent = sh.prompt();
    if (G.net.version !== before) renderTopo();
    if (res.ping) onPing(res.ping);
    tickStats();
  }
  function onPing(pg) {
    const r = pg.res, o = G.obj.find(x => x.from === pg.from && x.to === pg.to);
    if (o) { G.tries.push(r.ok); o.state = r.ok ? 'pass' : 'fail'; renderObjectives(); }
    const [tone, text] = describe(pg.from, r);
    setStatus('busy', `Tracing ${pg.from} to ${pg.to}…`);
    animate(pg.from, r).then(() => { if (!G) return; setStatus(tone, text); if (o && r.ok) checkWin(); });
  }
  function testObjective(o) {
    if (G.solved) return;
    G.pcTab = 'cmd'; select(o.from, false);
    const sh = G.shells[o.from];
    run((sh instanceof IOSShell && /^config/.test(sh.mode) ? 'do ping ' : 'ping ') + o.to);
    document.querySelector('.map').scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' });
  }
  function complete() { const sh = G.shells[G.active]; if (sh.complete) { const inp = $('#cli'); inp.value = sh.complete(inp.value); } focusInput(); }
  function help() {
    const sh = G.shells[G.active], inp = $('#cli'), v = inp.value;
    if (!sh.help) { run('help'); return; }
    push(G.active, [{ t: 'cmd', p: sh.prompt(), s: v + '?' }].concat(sh.help(v)));
    renderScreen(); inp.value = v; focusInput();
  }
  function hist(dir) {
    const n = G.active, h = G.hist[n];
    if (!h.length) return;
    G.hi[n] = Math.max(0, Math.min(h.length, G.hi[n] + dir));
    $('#cli').value = G.hi[n] === h.length ? '' : h[G.hi[n]];
    focusInput();
  }
  $('#cli-form').addEventListener('submit', e => { e.preventDefault(); if (!G || G.solved) return; const v = $('#cli').value; $('#cli').value = ''; run(v); });
  $('#cli').addEventListener('keydown', e => {
    if (!G) return;
    if (e.key === 'Tab') { e.preventDefault(); complete(); }
    else if (e.key === '?' && G.shells[G.active].help) { e.preventDefault(); help(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hist(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hist(1); }
  });
  document.querySelectorAll('.key').forEach(k => k.addEventListener('click', () => {
    if (!G) return;
    const a = k.getAttribute('data-key');
    if (a === 'tab') complete(); else if (a === 'help') help(); else hist(a === 'up' ? -1 : 1);
  }));
  $('#screen').addEventListener('click', () => { if (!getSelection().toString()) focusInput(); });
  $('#seg-cmd').onclick = () => { G.pcTab = 'cmd'; renderPane(); focusInput(); };
  $('#seg-ip').onclick = () => { G.pcTab = 'ip'; renderPane(); };
  $('#ipset').addEventListener('submit', e => {
    e.preventDefault();
    const ip = $('#ip-addr').value.trim(), mask = $('#ip-mask').value.trim(), gw = $('#ip-gw').value.trim(), msg = $('#ip-msg');
    const bad = t => { msg.textContent = t; msg.className = 'ipset-msg err'; };
    if (!isIP(ip)) return bad('Enter an IPv4 address like 192.168.1.10.');
    if (!isMask(mask)) return bad('Enter a subnet mask like 255.255.255.0.');
    if (gw && !isIP(gw)) return bad('Enter the gateway as an IPv4 address, or leave it empty.');
    const d = G.net.devices[G.active];
    d.ip = ip; d.mask = mask; d.gw = gw || null; G.net.touch(); G.cmds++;
    msg.textContent = 'Settings saved. Run ipconfig in the command prompt to check them.'; msg.className = 'ipset-msg';
    renderTopo(); tickStats();
  });

  // ---------- escalations, win ----------
  $('#hint-btn').onclick = () => { if (!G || G.hints >= G.p.hints.length) return; G.hints++; renderHints(); tickStats(); };
  $('#back').onclick = goHome;
  $('#brand').onclick = goHome;

  function checkWin() {
    if (G.solved || !G.obj.every(o => o.state === 'pass')) return;
    const stale = G.obj.filter(o => !G.net.ping(o.from, o.to, { silent: true }).ok);
    if (stale.length) {
      stale.forEach(o => { o.state = 'fail'; }); renderObjectives();
      setStatus('bad', `${stale[0].from} to ${stale[0].to} stopped working after a later change. Test it again.`);
      return;
    }
    win();
  }
  function win() {
    G.solved = true; G.end = Date.now(); stopTimer(); tickStats();
    setBrandLed(true);
    const p = G.p, sec = elapsed(), fails = G.tries.filter(x => !x).length;
    const rank = rankFor(sec, G.hints), xp = xpFor(p, sec, G.hints, fails);
    const prev = PR.solved[p.id];
    if (!prev) PR.xp += xp;
    if (!prev || sec < prev.time) PR.solved[p.id] = { time: sec, hints: G.hints, rank, xp: prev ? prev.xp : xp };
    const d = dayKey(new Date()); if (PR.days.indexOf(d) < 0) PR.days.push(d);
    save(); renderStats();
    $('#win-sub').textContent = `Ticket ${p.ticket.id} closed in ${fmtTime(sec)}.`;
    $('#win-rank').innerHTML = `Ranked <b>${esc(rank)}</b>. ` + (prev ? 'Replay, so no new XP.' : `<b>+${xp}</b> XP.`);
    $('#win-stats').innerHTML = [['Time', fmtTime(sec)], ['Commands', G.cmds], ['Escalations', G.hints + '/' + p.hints.length], ['Tests', G.tries.length]].map(([k, v]) => `<div><span class="lcd">${v}</span><span class="rd-l">${k}</span></div>`).join('');
    $('#win-explain').innerHTML = md(p.explain);
    const rows = G.tries.slice(-6).map(ok => ok ? '!!!!!' : '.....').join('\n');
    // On a real website, add the site's address so friends can follow the link.
    const here = window.OUTAGE_SITE && /^https?:$/.test(location.protocol) ? '\n' + location.origin + location.pathname : '';
    $('#share-text').textContent = `OUTAGE #${p.num} ${p.title}\n${rows}\n${fmtTime(sec)}, ${G.hints} escalation${G.hints === 1 ? '' : 's'}, ${G.cmds} commands\n${rank}${here}`;
    const nextP = PUZ[PUZ.indexOf(p) + 1];
    $('#win-next').hidden = !nextP;
    $('#win-home').className = nextP ? 'btn btn-quiet' : 'btn btn-go';
    if (nextP) { $('#win-next').textContent = `Next outage: ${nextP.title}`; $('#win-next').onclick = () => go(nextP.id); }
    $('#copy').textContent = 'Copy result';
    G.lastRun = { puzzle: p.id, time: Math.max(3, sec), commands: Math.max(1, G.cmds), escalations: G.hints, tests: Math.max(1, G.tries.length) };
    G.lastResult = null;
    if (SITE && ME && ME.name) submitRun(); else renderPost();
    setTimeout(() => { $('#overlay').hidden = false; (nextP ? $('#win-next') : $('#win-home')).focus(); }, RM ? 0 : 500);
  }
  $('#win-home').onclick = goHome;
  $('#overlay').addEventListener('keydown', e => { if (e.key === 'Escape') $('#overlay').hidden = true; });
  $('#copy').onclick = () => {
    const btn = $('#copy'), text = $('#share-text').textContent;
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#share-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Selected. Press Ctrl+C or ⌘C'; };
    try { navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; }, fallback); } catch (e) { fallback(); }
  };

  // ---------- leaderboard (website version only; the API lives at /api/scores) ----------
  function navCurrent(on) { const b = $('#nav-board'); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  if (SITE) { $('#nav-board').hidden = false; $('#nav-board').onclick = () => { location.hash = 'leaderboard'; }; }

  async function api(body) {
    const res = await fetch('/api/scores', body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || (res.status === 404 ? 'The leaderboard service isn’t deployed on this site yet.' : 'The leaderboard didn’t respond.'));
    return data;
  }

  function renderPost(state, msg) {
    const box = $('#post');
    if (!SITE || !G || !G.lastRun) { box.hidden = true; return; }
    box.hidden = false;
    if (!ME || !ME.name || state === 'rename') {
      const rename = state === 'rename';
      box.innerHTML = `<h3>${rename ? 'Change your name' : 'Post to the leaderboard'}</h3>
        <form id="post-form" novalidate><label class="sr" for="post-name">Name on the leaderboard</label>
          <input id="post-name" maxlength="20" autocomplete="nickname" placeholder="Your name" value="${esc((ME && ME.name) || '')}">
          <button class="btn btn-go" type="submit">${rename ? 'Save name' : 'Post my run'}</button></form>
        <p class="muted">Everyone who opens this site sees your name next to your times, commands and escalations.</p>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}`;
      $('#post-form').addEventListener('submit', async e => {
        e.preventDefault();
        const name = $('#post-name').value.replace(/\s+/g, ' ').trim();
        if (!nameOk(name)) { renderPost(state, 'Use 1 to 20 letters, numbers, spaces or . _ \' -'); $('#post-name').focus(); return; }
        if (!ME) ME = { key: newKey() };
        ME.name = name; saveMe();
        if (!rename) { submitRun(); return; }
        try { await api({ key: ME.key, name }); renderPost('renamed'); } catch (err) { renderPost('rename', err.message); }
      });
      return;
    }
    if (state === 'posting') { box.innerHTML = `<h3>Leaderboard</h3><p>Posting your run as <b>${esc(ME.name)}</b>…</p>`; return; }
    if (state === 'error') {
      box.innerHTML = `<h3>Leaderboard</h3><p class="err">Couldn’t post your run. ${esc(msg)}</p><div class="post-row"><button class="push" id="post-retry" type="button">Try again</button></div>`;
      $('#post-retry').onclick = submitRun; return;
    }
    const r = G.lastResult;
    const line = state === 'renamed' ? `Name changed to <b>${esc(ME.name)}</b>.`
      : r && r.best ? `Posted as <b>${esc(ME.name)}</b>. New personal best on this outage.`
      : `Posted as <b>${esc(ME.name)}</b>. Your best here is still ${fmtTime(r.run.time)}.`;
    box.innerHTML = `<h3>Leaderboard</h3><p>${line}</p><div class="post-row"><button class="push" id="post-see" type="button">See the leaderboard</button><button class="textbtn" id="post-rename" type="button">Change name</button></div>`;
    $('#post-see').onclick = () => { location.hash = 'leaderboard'; };
    $('#post-rename').onclick = () => renderPost('rename');
  }
  async function submitRun() {
    if (!G || !G.lastRun) return;
    const g = G; renderPost('posting');
    try {
      const res = await api(Object.assign({ key: ME.key, name: ME.name }, g.lastRun));
      ME.id = res.id; saveMe();
      if (G !== g) return;
      G.lastResult = res; renderPost('posted');
    } catch (err) { if (G === g) renderPost('error', err.message); }
  }

  // Views: 'all' (every day), 'd2' (one day's outages), 'p7' (one outage).
  const BOARD = { view: 'all', data: null, err: null };
  function showBoard() {
    stopTimer(); G = null;
    $('#home').hidden = true; $('#play').hidden = true; $('#board').hidden = false;
    navCurrent(true); setBrandLed(PUZ.every(p => PR.solved[p.id])); renderStats(); renderBoardTabs(); loadBoard(); window.scrollTo(0, 0);
  }
  async function loadBoard() {
    BOARD.err = null; BOARD.data = null; renderBoard();
    try { BOARD.data = await api(); } catch (e) { BOARD.err = e.message; }
    renderBoard();
  }
  const viewDay = v => v[0] === 'd' ? +v.slice(1) : v[0] === 'p' ? (PUZ.find(p => p.id === v) || {}).day : null;
  function renderBoardTabs() {
    const v = BOARD.view, day = viewDay(v);
    const btn = (id, label, sel) => `<button class="btab" type="button" role="tab" aria-selected="${sel}" data-view="${id}">${label}</button>`;
    let html = '<div class="btabs-row">' + btn('all', '<b>All</b>days', v === 'all') + DAYLIST.map(d => btn('d' + d, `<b>Day ${d}</b>${esc(dayDate(d, { day: 'numeric', month: 'short' }))}`, day === d)).join('') + '</div>';
    if (day) html += '<div class="btabs-row btabs-sub">' + btn('d' + day, 'Whole day', v === 'd' + day) + dayPuz(day).map((p, k) => btn(p.id, `<b>${k + 1}</b>${esc(p.title)}`, v === p.id)).join('') + '</div>';
    $('#board-tabs').innerHTML = html;
    $('#board-tabs').querySelectorAll('.btab').forEach(b => { b.onclick = () => { BOARD.view = b.getAttribute('data-view'); renderBoardTabs(); renderBoard(); }; });
  }
  const cmpRun = (a, b) => (a.time - b.time) || (a.escalations - b.escalations) || (a.commands - b.commands);
  const escWord = n => n ? ESC[n - 1][1].replace(' engineer', '') : 'No help';
  const escCell = n => `<span class="esc-dots" aria-hidden="true">${[1, 2, 3].map(i => `<i class="led ${i <= n ? 'led-a' : ''}"></i>`).join('')}</span>${escWord(n)}`;
  const when = iso => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return ''; } };
  const sum = (runs, k) => runs.reduce((a, r) => a + r[k], 0);
  function totals(p, list) { const runs = list.map(z => p.runs[z.id]).filter(Boolean); return { p, fixed: runs.length, total: sum(runs, 'time'), cmds: sum(runs, 'commands'), esc: sum(runs, 'escalations') }; }
  const byTotals = (a, b) => (b.fixed - a.fixed) || (a.total - b.total) || (a.esc - b.esc) || (a.cmds - b.cmds);
  function renderBoard() {
    const body = $('#board-body');
    if (BOARD.err) { body.innerHTML = `<div class="board-empty"><b>Couldn’t load the leaderboard.</b><span>${esc(BOARD.err)} Press Refresh to try again.</span></div>`; return; }
    if (!BOARD.data) { body.innerHTML = '<div class="board-empty"><span>Loading the leaderboard…</span></div>'; return; }
    const me = ME && ME.id, v = BOARD.view;
    const youTag = p => p.id === me ? '<span class="you-tag">You</span>' : '';
    const rowStart = (p, i) => `<tr class="${p.id === me ? 'you' : ''}"><td class="pos">${i + 1}</td><td class="who">${esc(p.name)}${youTag(p)}</td>`;
    const totalCell = r => `<td><span class="t">${fmtTime(r.total)}</span><small class="sub">${r.cmds} commands, ${r.esc} escalation${r.esc === 1 ? '' : 's'}</small></td>`;
    const players = (BOARD.data.players || []).filter(p => p.runs && PUZ.some(z => p.runs[z.id]));
    const empty = (b, t) => { body.innerHTML = `<div class="board-empty"><b>${b}</b><span>${t}</span></div>`; };
    if (v === 'all') {
      if (!players.length) return empty('No runs posted yet.', 'Fix an outage and post your time to take first place.');
      const rows = players.map(p => totals(p, PUZ)).sort(byTotals);
      body.innerHTML = `<table class="lb"><thead><tr><th>#</th><th>Player</th><th>Fixed</th><th>Total time</th>${DAYLIST.map(d => `<th><small>Day ${d}</small>${esc(dayDate(d, { day: 'numeric', month: 'short' }))}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((r, i) => rowStart(r.p, i) + `<td class="num">${r.fixed}/${PUZ.length}</td>` + totalCell(r) +
          DAYLIST.map(d => { const x = totals(r.p, dayPuz(d)); return x.fixed ? `<td class="cell"><span class="t">${fmtTime(x.total)}</span><small>${x.fixed}/${dayPuz(d).length} fixed</small></td>` : '<td class="none">—</td>'; }).join('') + '</tr>').join('') +
        '</tbody></table>';
      return;
    }
    if (v[0] === 'd') {
      const d = +v.slice(1), list = dayPuz(d), ps = players.filter(p => list.some(z => p.runs[z.id]));
      if (!ps.length) return empty(`Nobody has posted a Day ${d} run yet.`, 'Fix one of its outages and take first place.');
      const rows = ps.map(p => totals(p, list)).sort(byTotals);
      body.innerHTML = `<table class="lb"><thead><tr><th>#</th><th>Player</th><th>Fixed</th><th>Total time</th>${list.map((z, k) => `<th><small>${k + 1}</small>${esc(z.title)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((r, i) => rowStart(r.p, i) + `<td class="num">${r.fixed}/${list.length}</td>` + totalCell(r) +
          list.map(z => { const x = r.p.runs[z.id]; return x ? `<td class="cell"><span class="t">${fmtTime(x.time)}</span><small>${x.commands} cmds, ${escWord(x.escalations).toLowerCase()}</small></td>` : '<td class="none">—</td>'; }).join('') + '</tr>').join('') +
        '</tbody></table>';
      return;
    }
    const z = PUZ.find(q => q.id === v);
    if (!z) { BOARD.view = 'all'; renderBoardTabs(); renderBoard(); return; }
    const rows = players.filter(p => p.runs[z.id]).map(p => ({ p, r: p.runs[z.id] })).sort((a, b) => cmpRun(a.r, b.r));
    if (!rows.length) return empty(`Nobody has fixed ${esc(z.title)} yet.`, `Patch into Day ${z.day}, port ${portOf(z)} and be the first.`);
    body.innerHTML = '<table class="lb"><thead><tr><th>#</th><th>Player</th><th>Time</th><th>Commands</th><th>Escalations</th><th>Tests</th><th>Plays</th><th>Posted</th></tr></thead><tbody>' +
      rows.map((x, i) => rowStart(x.p, i) + `<td class="t">${fmtTime(x.r.time)}</td><td class="num">${x.r.commands}</td><td>${escCell(x.r.escalations)}</td><td class="num">${x.r.tests}</td><td class="num">${x.r.plays || 1}</td><td>${when(x.r.at)}</td></tr>`).join('') +
      '</tbody></table>';
  }
  $('#board-refresh').onclick = loadBoard;
  $('#board-play').onclick = goHome;

  // If the condensed display face can't load, shrink the headline so a wider fallback still fits.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const probe = document.createElement('span');
      probe.textContent = "Something's down";
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:800 40px monospace';
      document.body.appendChild(probe);
      const base = probe.offsetWidth;
      probe.style.fontFamily = '"Big Shoulders Display", monospace';
      if (probe.offsetWidth === base) document.documentElement.classList.add('fallback-type');
      probe.remove();
    });
  }

  window.addEventListener('hashchange', route);
  route();
})();
