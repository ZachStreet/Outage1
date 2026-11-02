// Two players on a local stand-in for Netlify: static site + /api/scores backed by an in-memory store.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeHandler } from '../lib/board.mjs';
import { memoryStore } from './memory-store.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const html = fs.readFileSync(path.join(dir, '..', 'public', 'index.html'));
const handler = makeHandler(() => store);
const store = memoryStore();

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/scores')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handler(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } else { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
}).listen(8766);

const FIX = {
  p1: [['R1', ['en', 'conf t', 'int g0/0', 'no sh']]],
  p2: [['SW1', ['en', 'conf t', 'int fa0/2', 'sw acc vl 10']]]
};
async function solve(page, id, { hint = false } = {}) {
  await page.goto('http://localhost:8766/#' + id);
  await page.waitForSelector('#play:not([hidden])');
  if (hint) await page.click('#hint-btn');
  for (const [dev, cmds] of FIX[id]) {
    await page.click(`#tabs .tab:has-text("${dev}")`);
    for (const c of cmds) { await page.fill('#cli', c); await page.press('#cli', 'Enter'); }
  }
  const n = await page.locator('#obj li').count();
  for (let i = 1; i <= n; i++) { await page.click(`#obj li:nth-child(${i}) button`); await page.waitForTimeout(150); }
  await page.waitForSelector('#overlay:not([hidden])');
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = o => browser.newContext(Object.assign({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } }, o || {}));
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };
  const result = {};

  // Player 1: first win shows the name form; second win posts automatically.
  const a = watch(await (await ctx()).newPage());
  await solve(a, 'p1');
  result.formShown = await a.isVisible('#post-name');
  await a.fill('#post-name', 'Zach');
  await a.click('#post-form button[type=submit]');
  await a.waitForSelector('#post-see');
  result.postedA = await a.textContent('#post p');
  await a.screenshot({ path: path.join(out, 'win-post.png') });
  await solve(a, 'p2');
  await a.waitForSelector('#post-see');
  result.autoPostedA = await a.textContent('#post p');

  // Player 2: one escalation on p1, posts as Matt.
  const b = watch(await (await ctx()).newPage());
  await solve(b, 'p1', { hint: true });
  await b.fill('#post-name', 'Matt');
  await b.click('#post-form button[type=submit]');
  await b.waitForSelector('#post-see');
  await b.click('#post-see');
  await b.waitForSelector('table.lb');
  result.allRowsB = await b.$$eval('table.lb tbody tr', rs => rs.map(r => r.querySelector('.who').textContent));
  await b.click('.btab[data-view="p1"]');
  result.p1RowsB = await b.$$eval('table.lb tbody tr', rs => rs.map(r => Array.from(r.cells).map(c => c.textContent.trim()).slice(1, 5).join(' | ')));
  await b.screenshot({ path: path.join(out, 'board-p1.png'), fullPage: true });
  await b.click('.btab[data-view="all"]');
  await b.screenshot({ path: path.join(out, 'board-all.png'), fullPage: true });
  await b.click('.btab[data-view="p3"]');
  result.emptyP3 = await b.textContent('.board-empty b');

  // Rename from the win screen keeps times.
  await solve(b, 'p2');
  await b.waitForSelector('#post-rename');
  await b.click('#post-rename');
  await b.fill('#post-name', 'Matt M');
  await b.click('#post-form button[type=submit]');
  await b.waitForSelector('#post-see');
  result.renamed = await b.textContent('#post p');

  // Phone width, dark mode: board must scroll inside its card, not the page.
  const m = watch(await (await ctx({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage());
  await m.goto('http://localhost:8766/#leaderboard');
  await m.waitForSelector('table.lb');
  result.mobileOverflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await m.screenshot({ path: path.join(out, 'board-mobile-dark.png'), fullPage: true });

  // API down: friendly error instead of a blank page.
  server.close();
  const c = watch(await (await ctx()).newPage());
  await c.goto('data:text/html,<p>x</p>').catch(() => {});
  result.errors = errors;
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
