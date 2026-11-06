// Builds the game from src/ into one HTML file.
//   public/index.html      -> the website Netlify serves (leaderboard on)
//   artifact/outage.html   -> the Claude artifact version (no document skeleton, leaderboard off)
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

let html = src('shell.html');
const parts = { '/*CSS*/': src('style.css'), '/*ENGINE*/': src('engine.js'), '/*PUZZLES*/': src('puzzles.js'), '/*APP*/': src('app.js') };
for (const [k, v] of Object.entries(parts)) {
  if (v.includes('</script')) throw new Error(k + ' contains </script');
  html = html.replace(k, () => v);
}

fs.mkdirSync(path.join(__dirname, 'artifact'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'artifact', 'outage.html'), html);

const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#17212C"/><circle cx="16" cy="16" r="7" fill="#EE3440"/></svg>');
const head = [
  '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta property="og:title" content="Outage: daily network engineering puzzles">',
  '<meta property="og:description" content="Something’s down. Daily network engineering puzzles: find the fault from a Cisco-style console, fix it, and prove it with a ping.">',
  '<meta name="twitter:card" content="summary">',
  '<meta property="og:type" content="website">',
  '<meta name="theme-color" content="#17212C">',
  `<link rel="icon" href="${favicon}">`,
  '<script>window.OUTAGE_SITE = true;</script>',
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
].join('\n');
const split = html.indexOf('<header');
const site = `${head}\n${html.slice(0, split).trim()}\n</head>\n<body>\n${html.slice(split).trim()}\n</body>\n</html>\n`;
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), site);
console.log(`built public/index.html (${(site.length / 1024).toFixed(1)} KB) and artifact/outage.html`);
