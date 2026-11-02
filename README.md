# Outage

Daily broken-network puzzles with a leaderboard. Something's down.

| Path | What it is |
|---|---|
| `src/` | The game: simulation engine, puzzles, page layout, styles |
| `src/puzzles.js` | The outages. Edit this to add or change puzzles |
| `build.js` | Builds `src/` into `public/index.html`, the page Netlify serves |
| `netlify/functions/scores.mjs` | The leaderboard API at `/api/scores` |
| `lib/board.mjs` | Leaderboard rules: validation, best run per outage, ranking |
| `test/` | Tests. Run `npm test` |
| `netlify.toml` | Tells Netlify how to build: `npm run build`, publish `public`, functions in `netlify/functions` |

## One-time setup: deploy from GitHub

The leaderboard runs as a Netlify Function, and functions need a Git or CLI deploy. A drag-and-drop deploy only publishes the static page. Switch your existing Netlify project to build from GitHub once:

1. On GitHub, create a new repository called `outage`. Private is fine.
2. On the new repo's page, choose **uploading an existing file**, drag in everything from this folder, and commit.
3. In Netlify, open your existing project and link it to that repository. This is under the project's build and deploy settings, as **Link repository** or similar. Pick GitHub, then `outage`. Netlify reads `netlify.toml`, so leave the build settings as they are.
4. Wait about a minute for the first build. Then open `https://<your-site>.netlify.app/api/scores`. You should see `{"players":[]}`.

Your site keeps its existing address.

## Day-to-day updates

- **Change anything:** edit the file on GitHub (pencil icon), then commit. Netlify rebuilds and publishes automatically, usually within a minute.
- **Add an outage:** copy one of the objects in `src/puzzles.js`, give it the next id (`p6`, `p7`...), and change the devices, fault, story, test points and hints. It appears on the next free port of the switch. The leaderboard accepts it automatically.
- **Check a deploy:** the Deploys tab in Netlify shows each build. If a build fails, the previous version stays live.
- **Roll back:** in Deploys, open an older deploy and publish it.

## Run it on your computer (optional)

```
npm install
npm test
npx netlify-cli dev
```

`netlify dev` runs the page, the function and a local copy of the leaderboard storage together.

## How the leaderboard works

- The first time someone fixes an outage, they type a name and post the run. After that, runs post automatically, and they can change their name from the win screen.
- Each player's best run per outage counts: fastest time, then fewest escalations, then fewest commands.
- Each browser gets a random private key. The leaderboard only ever shows a hash of it, so nobody can overwrite someone else's times.
- Scores are sent from the player's browser, so a determined friend could fake one. That's fine among friends. A public release would need the server to check runs.
- Data is stored in a Netlify Blobs store named `outage-leaderboard`, with one record per player.
