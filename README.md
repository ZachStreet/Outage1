# Outage

Daily broken-network puzzles with a leaderboard. Something's down.

| Path | What it is |
|---|---|
| `src/` | The game: simulation engine, puzzles, page layout, styles |
| `src/puzzles.js` | The outages. Edit this to add or change puzzles |
| `build.js` | Builds `src/` into `public/index.html`, the page Netlify serves |
| `netlify/functions/scores.mjs` | The leaderboard API at `/api/scores` |
| `lib/board.mjs` | Leaderboard rules: validation, best run per outage, ranking |
| `netlify/functions/track.mjs`, `lib/track.mjs` | Anonymous visit tracking at `/api/track`, shown on the `#stats` page |
| `test/` | Tests. `npm test` for the engine and leaderboard, `npm run test:e2e` for the browser test |
| `netlify.toml` | Tells Netlify how to build: `npm run build`, publish `public`, functions in `netlify/functions` |

## How updates go live

Netlify builds from this repository. Every commit to `main` is published automatically, usually within a minute. A pull request gets its own preview link from Netlify first, and merging it publishes it.

- **Change anything:** edit the file on GitHub (pencil icon), then commit. If a build fails, the previous version stays live.
- **Check a deploy:** the Deploys tab in Netlify shows each build.
- **Roll back:** in Deploys, open an older deploy and publish it.

## Adding a day of outages

The home page is a rack with one switch per day, newest on top. Each switch holds that day's five outages, easy to hard.

1. In `src/puzzles.js`, add the day and its date to `DAYS`, for example `3: '2026-11-04'`.
2. Add five puzzle objects with `day: 3` and the next ids and numbers (`p11` to `p15`, `num: 11` to `15`). Copying an existing outage is the quickest start. Their order in the file is their port order.
3. Add the fix for each one to `FIXES` in `test/engine.test.js` and `FIX` in `test/e2e.mjs`, then run the tests.

A day appears on its date, in each player's own time zone, so you can add several days in advance. The leaderboard picks up new outages automatically.

What the simulator supports: access ports, VLANs, 802.1Q trunks (allowed lists, native VLAN, DTP auto/desirable, CDP mismatch logs), speed and duplex negotiation, port security and BPDU Guard with err-disabled ports, router interfaces and router-on-a-stick subinterfaces, static and default routes with longest-prefix matching and routing loops, standard, extended and named ACLs, ARP, ping, tracert, `curl` and `tnc` (TCP port tests) on PCs, and PC IP settings.

Test points can be a ping, a TCP port (`port: 80` runs `curl`, other ports run `tnc`), and can be marked `blocked: true` when the traffic must stay blocked. Use those to stop lazy fixes, like deleting an ACL, from passing. `boot` adds log lines a device printed before the player arrived.

## Who's playing: the stats page

Open `https://<your-site>.netlify.app/#stats`. It isn't linked anywhere. It shows visitors per day, how many were new or returning, how many came back on another day, and how many people started and fixed each outage.

Each browser gets a random anonymous id. The server stores only a hash of it, with the dates it visited and which outages it opened and fixed: no names, no IP addresses. Days are counted in Brisbane time. The data lives in a Netlify Blobs store named `outage-visitors`.

## Run it on your computer (optional)

```
npm install
npm test            # engine and leaderboard tests
npm run test:e2e    # builds, then plays all outages in a headless browser
npx netlify-cli dev # the page, the function and local leaderboard storage together
```

## How the leaderboard works

- The first time someone fixes an outage, they type a name and post the run. After that, runs post automatically, and they can change their name from the win screen.
- Each player's best run per outage counts: fastest time, then fewest escalations, then fewest commands.
- Each browser gets a random private key. The leaderboard only ever shows a hash of it, so nobody can overwrite someone else's times.
- Scores are sent from the player's browser, so a determined friend could fake one. That's fine among friends. A public release would need the server to check runs.
- Data is stored in a Netlify Blobs store named `outage-leaderboard`, with one record per player.
