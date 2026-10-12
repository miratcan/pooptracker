# POC-02 · Song format (`.poop`) and editing layer (commands + MCP)

> Status: **idea stage** — implementation starts once the document matures.
> Target: `index.html` (the tracker). Related: [POC-01](poc-01.md) (instrument data / video metadata).
> Principles: [The Zen of PoopTracker](ZEN.md).
>
> Two parts: **A. Storage** (what's in the file) · **B. Editing** (how humans and LLMs read and change the song).

---

# A. Storage

## Core principle: self-contained, never references
- The song file **carries everything inside it**: the song data + all the videos it uses.
- References (external files, plugins, "I have that sample") **never**. The bane of modern music software:
  you send a track to a friend, and it doesn't work because they don't have the same VSTs / samples.
- Like FT2's `.xm` file: when you send the file, everything goes with it.

## Principle: only source data in the file
- The file holds **only source data**: who hit, when, with which note, with which effect. Static and unambiguous;
  it doesn't change no matter in which order the patterns play.
- **"What is playing right now?" is a state**: it needs computing and depends on the play order (the same pattern can
  come after different patterns in the order) → it isn't written to the file; it is asked from the editing layer
  (see B, state tool).
- **The song file holds the track's content, not the UI's state:** mute/solo, cursor position, the open pattern,
  zoom etc. don't go into the file.

## Container: zip
```
mysong.poop  (zip)
├── song.txt          ← format version, title, bpm, speed, rowsPerBeat, channels, order, instruments
├── patterns/
│   ├── 00.txt
│   ├── 01.txt
│   └── 02.txt
└── videos/
    ├── def.mp4       ← each video is stored once
    └── cat.mp4          (even if there are several instruments from the same video)
```
- **An uncompressed zip (store) is enough:** videos are already compressed, compressing them again gains nothing.
  A library may not be needed (a few dozen lines). The file can be opened with any zip program.
- **Pattern files are numbered in hex, starting at 00:** `00.txt`, `01.txt` … `10.txt` (the 16th pattern).
  They match the order list one to one (`order=00 01 00 02`). Same numbering as FT2.

## Content format: plain text (not JSON, not binary)
- Patterns already are the text rows on the tracker screen → writing the song data as plain text too is consistent.
- Inventing a separate binary format is needless technical burden; JSON is a needless layer (quotes, brackets,
  key names get in front of the meaningful content).
- **The instrument line is exactly the same as the one in the video metadata** (+ the video path inside the zip): the video
  metadata and the song file speak one text "language".
- Benefit: a **human** opening the file in a text editor can read the track (time turns into rows, notes are written by
  name, `C-4`, row numbers and `rowsPerBeat` give the position). For an LLM it's a convenience, not a requirement:
  the LLM talks to the song through the editing layer, not through the file (see B).

### `song.txt`
```
POOPTRACKER SONG 1
title=Cat March
bpm=125
speed=6
rowsPerBeat=4
channels=3
order=00 01 00 02

=== CHANNELS ===
1;name=Drums;pan=80
2;name=Bass;pan=60
3;name=Melody;pan=A0

=== INSTRUMENT 01 ===
TURD1;name=Def Dum;video=videos/def.mp4;start=0.000;end=2.400;hit=0.300;base=C-4;vol=40;a=0t;d=0t;s=1;r=800ms;loop=0

=== INSTRUMENT 02 ===
TURD1;name=Def Tek;video=videos/def.mp4;start=2.400;end=3.900;hit=2.620;base=C-4;vol=40;a=0t;d=0t;s=1;r=300ms;loop=0
```
- **First line:** format name + version. Breaking format changes are allowed per [ZEN-COURAGE](ZEN.md) and are
  documented in the CHANGELOG; old versions are not guaranteed to be read.
- **`=== ... ===`:** section separator.
- **Channels:** in a single section, one line per channel: name + default pan. Pan is hex, `80` center (`00` full left,
  `FF` full right); the same scale as the `8xx` effect, can be changed temporarily in the song with `8xx`.
  **Mute/solo isn't stored** (UI state).
- **Instruments stay in `song.txt`:** each is one line, not worth splitting into separate files.
- Instruments from the same video (dum/tek) point to the same file; the video is stored once in the zip.
- **The instrument name (`name=`)** is ordinary instrument info: the tracker shows it in the list, the editing layer
  returns it by name ("new hit · C-4 · Kick"). The number → name mapping is done by the editing layer, not the LLM.
- **Escaping:** if an instrument name contains `;` or `=`, it is URL-style encoded (`%3B`, `%3D`); the tracker decodes it.

### `patterns/00.txt`
```
00 | C-4 01 .. ... | ... .. .. ... | C-4 03 30 ...
01 | ... .. .. ... | ... .. .. ... | C-4 03 .. ...
02 | ... .. .. ... | C-4 02 .. 447 | C-4 03 .. ...
03 | === .. .. ... | ... .. .. ... | ... .. .. E93
```
- Each line = one row; as it looks in the tracker: `note instrument volume effect`, channels separated by `|`.
- **Row number at the start of the line** (hex, like FT2): "pattern 0, row 37" is found directly.
- Pattern length = the number of lines in the file; no need to write it separately.
- Size: 64 rows × 8 channels ~7 KB; negligible.

## Effect list: not all of FT2, a selected subset
Criteria: (1) there should be **one way to do each thing** (so neither the LLM nor the human gets confused),
(2) effects that blur the "what is playing" question go.

**Kept**
| Effect | Why |
|---|---|
| Volume column | The single way to set the level |
| `Axy` volume slide | Fade in/out; musical and clear |
| `4xy` vibrato | Doesn't change the pitch on average |
| `3xx` tone portamento | The slide matters musically, its target note is known |
| `8xx` pan | Clear |
| `9xx` sample offset | Very valuable for video: starting the clip from the middle |
| `ECx` note cut | Short, clipped notes |
| `E9x` retrigger | Video stutter effect |
| `EDx` note delay | The same note on two channels, one delayed by 1 tick → a doubling/flanger-like color; looks like an echo in the video |
| `Fxx` speed/BPM | Tempo change |
| `Sxx` zoom/shake, `Ixx` invert | Our video effects |

**Dropped**
| Effect | Why |
|---|---|
| `0xy` arpeggio | Doesn't give a meaningful result; an implicit chord from a single note, blurs analysis |
| `Cxx` set volume | Same job as the volume column |
| `Kxx` key-off | Same job as `===` |
| `E1x`/`E2x`/`EAx`/`EBx` | "Fine" versions of existing effects |
| `1xx`/`2xx` free portamento | A slide without a target; where the pitch stops needs computing. `3xx` is enough |
| `Bxx`/`Dxx` jump / pattern break | Song structure should be in the order list |

---

# B. Editing: a single command layer + MCP

## Goal
Humans and LLMs should easily read the song, analyze it ("what's the scale?"), change it ("write a melody here"),
and **nobody should be able to produce invalid data**.

## A single command layer
- **Every change** in the tracker (typing a note on the keyboard as well as an LLM's tool call) turns into the same command.
- **Validation in one place:** humans and LLMs hit the same rule (e.g. volume can't exceed `40`, i.e. 64);
  the code is written once, no duplication.
- **Undo comes free:** each command knows how to undo itself; human and LLM changes go into the same undo
  history. If the LLM breaks something, Ctrl+Z.

## LLM access: MCP, connected to the live tracker
- LLMs have trouble computing positions in a two-dimensional table:
  - **what they do well:** reading a row left to right;
  - **what they struggle with:** reading a channel down a column, writing while keeping column alignment, counting
    positions in a long table.
- → The LLM doesn't access the file directly; it talks through **tools** ("set row 4 of pattern 1 to C-4").
- An **MCP server** (a small Node program) talks to the open tracker tab over a **live connection (WebSocket)**.
  A change made by the LLM appears on screen immediately and can be played right away. Tools call the command
  layer → validation and undo come automatically.

## Read tools: the same data, different views
The view the LLM struggles with may never be shown to it.
- **Row view:** the pattern as it is.
- **Channel view:** a single channel, as a list: `00 C-4, 04 E-4, 08 G-4…` → no vertical reading problem.
- **Sparse view:** skips empty rows, only events → size shrinks a lot in long patterns.
- **State tool** (`get_state`): "what is happening at position N of the order, row R?" → the current state of each
  channel, including the effects' impact. Since the order position is part of the question, the answer is always right.
  It can also be asked for a range of rows.
  ```
  channel 1: continuing · G-4 · Saz · volume 13
  channel 2: new hit · C-4 · Kick · volume 40
  channel 3: silent
  channel 4: sliding · C-4 → D-4 · Ney · volume 30
  ```
  No interpretation (chord name, scale etc.); the LLM derives the musicology from this information itself. If the tool
  interpreted and got it wrong, the LLM would get it wrong too.
- Also: song summary (bpm, speed, rowsPerBeat, order, pattern list), instrument list (name, base note,
  region, ADSR).

## Write tools: batch operations, not single cells
64 tool calls for a 64-row melody is clumsy → batch operations are a must.
- `set_cells` — set several cells at once (pattern, row, channel, field).
- `write_notes` — write a sequence of notes to a channel starting at a given row: `C-4 E-4 G-4 C-5`, each N rows apart.
- `clear` — clear a range (pattern / channel / row range).
- `transpose` — shift the notes in a range by semitones.
- `copy_pattern` / `new_pattern` — copy a pattern / new pattern.
- `set_order` — set the order list.
- `set_song` — bpm, speed, rowsPerBeat etc.
- `set_instrument` — change the settings of an existing instrument (ADSR, base note, volume, loop).
- **Creating instruments is the human's job:** the LLM can't create a new instrument from a video (choosing a region and
  setting the hit point require seeing/hearing the video).

## Validator
- Inside the command layer; the same code also runs when a file is opened (for hand-edited `.poop` files) and on the
  command line (`poop-check`) → **one code, the same rules everywhere.** A single JS module (~150–200 lines).
- **An invalid change is never applied**; a clear error is returned. The guardrail isn't a separate step, it's the interface itself.
- Check levels:
  1. **Syntax:** the format of the note (`C-4`, `===`, `...`), instrument, volume, effect fields.
  2. **References:** is the instrument defined, does the pattern in the order exist, does the channel count match the
     header, is the video in the zip.
  3. **Value ranges:** note C-0…B-7, volume 00–40, is the effect in the list, is the hit point inside the region etc.
  4. **Warnings (not errors):** "this note is 14 semitones from its base note, the video plays 2.2× faster" —
     valid but probably unwanted.
- **Error messages should say the fix directly**: position, problem and valid values on the same line:
  ```
  patterns/03.txt:12  channel 3: instrument '07' is not defined (defined: 01–05)
  patterns/03.txt:12  channel 5: volume '4F' invalid (range 00–40)
  song.txt:7          order: pattern '06' doesn't exist (existing: 00–05)
  ```
- **Formatter:** tolerant when reading a hand-edited file, always the standard format when writing.
- **Rules document:** the short and precise rules of the format (fields, ranges, the effect list and their meanings).

---

## Considered and rejected
- **Referencing file** (videos outside, matched by hash/file name): breaks portability.
- **Packed + light dual option:** unnecessary since there will never be references.
- **JSON:** an unnecessary layer, lowers readability.
- **Custom binary format:** unnecessary technical burden.
- **All patterns in a single file:** a file per pattern is more practical.
- **Writing continuing notes to the file as `↑C-4`:** in patterns repeated in the order there was no single right
  answer (`00 01 00`: `00` starts once from silence, once with `01`'s sustained note); a `?` mark would just mean
  "go ask" → it lost its meaning. Instead: the state tool.
- **Making duration the primary data** (like a piano roll): it reversed FT2's logic and the keyboard note entry flow.
- **Storing mute/solo in the file:** UI state, not the track's content.
- **A drum category (`kind=drum`):** we don't know anything called "drum", everything is a sample.
- **Giving the LLM direct write access to the file:** column alignment / position counting errors.
- **MCP working only with files:** connecting to the live tracker both shares validation/undo and shows the
  change immediately.
- **Tree-sitter (as a validator):** deliberately tolerant of errors, only understands syntax; our real errors are
  semantic. *Could be revisited later:* for `.poop` highlighting in editors (not as a guardrail).

## Maybe later
- **The song itself as a video:** all the sample videos used, back to back + the pattern data in a QR slideshow at the
  start. A single video on YouTube = a complete song file. Roughly: a compressed pattern ~0.5–1 KB,
  a robust QR ~200–400 bytes → 10–20 patterns a few dozen slides. How many bytes a QR survives YouTube with has to
  be tested.
  _Note (2026-10-12): QR was rejected (POC-01), where the pattern data lives has to be rethought._

## Settled (Phase 2, 2026-10-12)
- **The validator is in `ptformat.js`** (cell, instrument, order, BPM/speed, pattern length); the commands are in `index.html`.
- **A pattern / instrument in use can't be deleted:** the error says where it is used, nothing changes silently in the background.
- **When the instrument order changes**, the numbers in the patterns are updated too; the song plays the same.
- **An effect with parameter `00` is always valid** (including `E00`, `F00`, no effect): since the effect letter is typed
  first, the cell is `E00` for a moment; if that were rejected, `E9x` could never be entered.
- **Loop points are checked against the region only when loop is on.**
- **The clipboard is inside the tracker** (not the system clipboard); moving = cut + paste.
- Known limits: mouse selection is limited to the 35 rows on screen (Shift+PgDn for long blocks); when typing a
  two-digit instrument number, the intermediate value has to be defined too (no problem with fewer than 16 instruments).

## Open questions
- None yet.

## Implementation notes
- The tracker's current ADSR is in seconds; it should be changed according to the tick/ms decision in POC-01.
- The tracker's effect implementation should be trimmed according to the list above (dropped effects will be removed).
- First job is the single command layer: undo, validation and MCP are built on top of it.
