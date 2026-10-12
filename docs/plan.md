# Implementation plan

> Target: `index.html` (the tracker). Design notes: [POC-01](poc-01.md) (instrument sharing / video metadata),
> [POC-02](poc-02.md) (song format + editing layer). Principles: [The Zen of PoopTracker](ZEN.md).
>
> Ordering criteria: **dependencies** (what builds on what) and **early benefit**. Each phase ends with a result
> that is usable on its own.

---

## Phase 1 · Finalize the data model
Every later phase writes or reads this model to/from files → the model has to be settled first (otherwise we'd
have to write conversion code for our own old files).

- **Trim the effect list** (POC-02): the dropped ones are removed (`0xy`, `Cxx`, `Kxx`, `E1x`/`E2x`/`EAx`/`EBx`,
  `1xx`/`2xx`, `Bxx`/`Dxx`); the remaining ones work as before.
- **ADSR with units** (POC-01): every value carries its unit, default tick (`a=4t`), optionally ms (`r=800ms`).
  In the UI, a unit choice for each ADSR value.
- **Instrument regions:** several instruments from one video; each instrument has its own start/end point
  (non-destructive trimming — the original video stays as it is). The hit point and loop points are on the same
  timeline as the region. At first they are set with number boxes.
- **Instrument line format** (`TURD1;name=…;start=…;hit=…;…`): read + write code. The video metadata (Phase 5) and
  `.poop` (Phase 3) use the same line → written once.

**Done when:**
- [x] Dropped effects can't be entered in a pattern and don't play; the remaining effects work as before.
- [x] ADSR can be set in ticks and ms; when the BPM changes, a tick envelope stretches with the tempo, an ms one stays fixed.
- [x] Two instruments from the same video (different region, different hit point) can be created and played in the same song.
- [x] Every instrument written to a `TURD1;…` line and read back comes out with exactly the same settings.

---

## Phase 2 · Command layer and editing features
Editing features are written **directly as commands** → undo and validation work from day one, the same work
isn't done twice.

- **Command layer:** every change in the tracker goes through a command (POC-02 / B).
- **Validator:** inside the commands; an invalid change is never applied, a clear error is returned.
- **Undo / redo.**
- **Selection:** block selection with Shift+arrow keys and by dragging with the mouse.
- **Copy / cut / paste** (the selected block).
- **Deleting the selection.**
- **Moving** (dragging or cut-paste).
- **Pattern operations:** adding a new empty pattern, deleting a pattern, changing the pattern length
  (the existing "copy" stays).
- **Order list UI:** adding, deleting, reordering entry by entry (instead of today's text box).
- **Instrument operations:** delete, rename, reorder.
- **Draggable handles on the waveform:** region start/end, hit point, loop start/end — in different colors,
  each drag is one command.

**Done when:**
- [x] Every edit made with the keyboard and the mouse can be undone and redone with Ctrl+Z / Ctrl+Shift+Z.
- [x] Invalid values (e.g. volume > `40`) can't be entered by any route; a message explaining why appears.
- [x] A block can be selected, copied, pasted into another pattern, moved, and deleted.
- [x] An empty pattern can be added and deleted, its length can be changed; the order list can be edited from the UI.
- [x] An instrument can be deleted, renamed, and reordered.
- [x] Region, hit point and loop points can be set by dragging on the waveform.

---

## Phase 3 · `.poop` save / open
Once this phase is done, work isn't lost when the page is reloaded; later phases can be tested with real songs.

- Self-contained, uncompressed zip: `song.txt`, `patterns/00.txt…`, `videos/` (POC-02 / A).
- The tracker keeps the **original file** of loaded videos in memory (today it doesn't).
- The same video is stored once in the zip.
- The validator runs when a file is opened (for hand-edited files); the formatter writes the standard form.

**Done when:**
- [x] A song that is saved, then opened after reloading the page, plays exactly the same (patterns, order,
      instruments, regions, channels).
- [ ] A `.poop` file opened on another computer/browser works without needing any external file.
- [x] The zip can be opened with any zip program, and `song.txt` and the patterns can be read in a text editor.
- [x] When a hand-broken file is opened, the error is shown with its line number.

---

## Phase 4 · MCP
- A small MCP server in Node; a live connection to the tracker tab (WebSocket).
- Tools call the command layer → validation and undo come automatically.
- **Read tools:** row view, channel view, sparse view, state tool (`get_state`), song summary,
  instrument list.
- **Write tools:** `set_cells`, `write_notes`, `clear`, `transpose`, `copy_pattern` / `new_pattern`,
  `set_order`, `set_song`, `set_instrument` (no creating new instruments — that's the human's job).

**Done when:**
- [x] An LLM client can connect to MCP and read the song; `get_state` gives the correct state for the order position.
- [x] Notes written by the LLM appear in the tracker immediately and can be played.
- [x] A change made by the LLM can be undone in the tracker with Ctrl+Z.
- [x] An invalid write request isn't applied; the LLM gets back an error that tells the position and the valid values.

---

## Phase 5 · Instrument sharing via video metadata
One video = one instrument: the settings are written into the video's MP4/MOV metadata (`pooptracker` key) (POC-01).
The first design, QR slides, was tried and rejected (POC-01, "Considered and rejected").

- **Reading:** when a video is loaded, if its metadata has an instrument line the settings are applied, otherwise automatic hit detection.
- **Writing:** "Save video with instrument": the selected instrument is written into a copy of the video, which is downloaded; the video is not re-encoded.

**Done when:**
- [x] A video saved with an instrument, loaded back into the tracker, brings the instrument with the same settings.
- [x] Saving doesn't change the picture or the sound (every packet byte-for-byte identical); the file plays.
- [x] Other metadata keys in the video are kept; ffprobe can read the `pooptracker` key.

---

## Phase 6 · Channel count (1–8)
The channel count is not a fixed 4 but the song's own setting: between 1 and 8.

- **Add / delete channel:** from the pattern box; adding appends at the end, deleting deletes the channel the cursor is on.
  Both are a command, undone with Ctrl+Z. A channel with notes in it isn't deleted; where it is used is reported (like
  deleting an instrument).
- **Vertical 9:16 output** (target TikTok/Reels; the recording is 9:16 too). Channels are laid out downwards: 1–3 channels
  one column (1, 2, 3 rows), 4–8 channels two columns (2, 3, 4 rows). Since the tile's shape changes with the channel
  count, video frames are stored uncropped, and each tile center-crops to its own shape.
- **`.poop`:** `channels=` accepts 1–8; the number of cells in pattern rows must match it.
- **MCP:** channel numbers 1–N (the song's channel count).

**Done when:**
- [x] Channels can be added and deleted, and undone; a non-empty channel can't be deleted and the reason is given.
- [x] The output grid and the pattern editor follow the channel count; mute works on every channel.
- [x] Songs with 1, 5 and 8 channels can be saved and opened.
- [x] MCP accepts channel numbers according to the song's channel count.

---

## Phase 7 · Foundation for 0.0.1-alpha (2026-10-12)
The alpha is for developers as well as musicians, so the code is laid out before pull requests arrive.
[docs/ZEN.md](ZEN.md) is the constitution; there is no roadmap beyond it. Everything is in English.

- **ES modules, no build:** `src/core` (the song + commands), `src/engine` (playback, no DOM), `src/ui` (screens).
  See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Commands are the only writer** and announce every change; the engine and the screens listen.
- **Screens with their own keys** (one screen for now; the instrument editor can become a second one).
- **Tests in the repo** (`npm test`, no dependencies) and a GitHub Action.
- **MCP can do whatever the UI can do to a song** ([ZEN-AI-PARITY](ZEN.md)), including files.

**Done when:**
- [x] The split changes no behaviour: golden traces of 4 songs (every voice and every output frame) and a 40-step
  UI + MCP scenario are identical before and after.
- [x] `core/` and `engine/` run in Node; the engine's playback rules are tested there.
- [x] Every song change the UI can make has an MCP tool.
- [x] CONTRIBUTING.md, ARCHITECTURE.md, CHANGELOG.md.

---

## Maybe later
- **The song itself as a video** (POC-02): the sample videos back to back + the pattern data (since QR was rejected, where the data lives has to be rethought).
- **Community sample library (GitHub):** a separate repo (`pooptracker-samples`), people add video instruments by PR.
  Since every video carries its settings in its metadata, a PR is just the video. Folders by type (`drums/kick/`, `perc/`, `voice/`…).
  A GitHub Action checks the PR (with `ptformat.js`): is the metadata there and valid, duration ≤ 8 s, size and resolution limits.
  License CC0 only; the PR template has "I shot this" and "everyone in the video has given permission" checkboxes. No Git LFS (free quota is low).
  Later: the tracker can browse this library and add instruments from it.
