# Contributing to PoopTracker

Thanks for wanting to help. Please read [The Zen of PoopTracker](docs/ZEN.md) first: there is no roadmap, and
every feature request and pull request is checked against it. If your idea doesn't fit the Zen, open an issue to
talk about it before writing code.

## Run it

PoopTracker is plain files: no build, no install.

```
python3 -m http.server 8765        # or any static file server, from the project folder
```

Open http://localhost:8765/ in Chrome (the browser it is developed and tested in). Drop a short video on the page
to make an instrument.

To let an AI edit the song over MCP, add `node mcp/server.mjs` to your MCP client (for Claude Code:
`claude mcp add pooptracker -- node /path/to/mcp/server.mjs`); the tracker header shows **MCP ●** when connected.
Another port: `POOPTRACKER_MCP_PORT=8799 node mcp/server.mjs` and open the tracker with `?mcp=8799`.

## Test it

```
npm test            # node --test: the file format, the commands, the engine, and the app in a headless Chrome
npm run stamp       # after changing anything in src/: puts the new module hashes into index.html
```

`test/ui.test.js` drives the app in a headless Chrome over the Chrome DevTools Protocol (`test/browser.js`, no
package): what only shows on the page, like keys that stay down, the workbench's timeline and loop, Load / New / Trim /
Tune / Fit. It finds Chrome where it is usually installed, or at `CHROME=<path>`; without one those tests are skipped.
A behaviour you check by hand in the browser belongs there.

The manual's pictures (`docs/manual/*.png`) are made by `npm run shots` (`tools/shots.mjs`): it brings the app to
each state, draws the numbers the manual's tables use over the elements they name, and takes the picture. Run it after
changing the screen; a new control gets its number there and in both manuals' tables. `--song my.poop --video
long.mp4` makes them with your own material instead of the demo song.

The import map in `index.html` adds `?v=<hash>` to every module, so a browser never mixes a new module with an old
one from its cache. It is written by `tools/stamp.mjs`, not by hand; a test fails while it is out of date.

Node 22 or newer. The tests also run on every push and pull request (GitHub Actions).

## How the code is laid out

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version:

- **The song changes only through a command** in `src/core/commands.js`. A change that writes `song.…` or
  `instruments[…]…` directly will be sent back: it can't be undone, MCP can't do it, and the screens won't know.
  The same holds for the video on the workbench (`bench.file`).
- **`core/` and `engine/` never touch the DOM.** They run in Node; that is what makes them testable.
- **The UI reacts to change events**; panels don't call each other to refresh.

## Conventions

- **Levels are hex, times are decimal.** A level (volume, sustain, effect values) is the same hex number in the
  pattern, the instrument settings and the file (`00`–`40`); times (hit point, region, loop points, envelope),
  BPM and speed are decimal, with their unit.
- **Colors come from the palette.** Every color is a variable in `:root` at the top of `index.html`; CSS uses
  `var(--name)`, canvas code uses `pal.name` (`src/ui/palette.js`). A new color is a new line there, never a hex in
  the code; a test fails otherwise. (`src/demo.js` paints the demo clips: material, not UI.)

## Pull requests

- One change per pull request, with a test when it changes behaviour (`test/*.test.js`).
- Say which Zen principle it serves, or why it doesn't conflict with one.
- No new dependencies, no build step ([ZEN-STANDALONE](docs/ZEN.md)).
- If it changes a file format or breaks old songs, add a line to the CHANGELOG ([ZEN-COURAGE](docs/ZEN.md)).
- If the UI can do something new to a song, MCP should be able to do it too ([ZEN-AI-PARITY](docs/ZEN.md)).
- Write code that reads like the code around it: same naming, same comment density.
