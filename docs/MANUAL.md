# The PoopTracker Manual

*[Türkçe](MANUAL.tr.md)*

PoopTracker is a tracker in the style of FastTracker 2. The difference is that its samples are videos: every note
plays a clip, and the song comes out as a 9:16 music video. This manual walks through the screen piece by piece.
If you only want to start making noise, read [Quick start](#quick-start) and keep **Keys** (bottom right) open.

![PoopTracker playing a song](manual/hero.png)

> PoopTracker is an alpha. It is developed and tested in Chrome. Songs saved today may not open tomorrow
> ([ZEN-COURAGE](ZEN.md)).

## Contents

1. [Quick start](#quick-start)
2. [The screen](#the-screen)
3. [The header](#the-header)
4. [The pattern editor](#the-pattern-editor)
5. [The order list](#the-order-list)
6. [Instruments](#instruments)
7. [The output](#the-output)
8. [The workbench](#the-workbench)
9. [Effects](#effects)
10. [Files: songs, instrument videos, MIDI, recordings](#files)
11. [Letting an AI play along (MCP)](#mcp)
12. [Keyboard reference](#keyboard-reference)

---

## Quick start

1. Open https://miratcan.github.io/pooptracker/ in Chrome. There is nothing to install. (Running it on your own
   computer is only needed for [MCP](#mcp).)
2. A demo beat (Kick, Snare, HiHat) is already loaded. Press **Enter** to play it and **Space** to stop.
3. Drop a short video (a few seconds, with a clear sound in it) anywhere on the page. It becomes a new instrument.
4. Click the pattern, press **Space** to turn on edit mode (the pattern gets a red frame), and play notes on the
   keyboard: `Z S X D C V…` is one octave and `Q 2 W 3 E R…` is the octave above it. Each key writes a note with
   the selected instrument.
5. Press **Enter** to hear it. Press **Rec** when you want the result as a video file.

---

## The screen

PoopTracker has two screens, **Pattern** and **Bench**, and they share one window. This is the Pattern screen:

![The PoopTracker window with its seven areas numbered](manual/overview.png)

| # | Area | What it is for |
|---|------|----------------|
| 1 | [Header](#the-header) | Song files, playback, tempo, edit settings, and the screen switch |
| 2 | [Order](#the-order-list) | The order in which patterns play to make the song |
| 3 | [Pattern editor](#the-pattern-editor) | The grid where you write the notes |
| 4 | [Instruments](#instruments) | Your instruments (videos) |
| 5 | [Instrument settings](#instrument-settings) | How the selected instrument plays: region, hit, loop, envelope… |
| 6 | [Output](#the-output) | The music video, one tile per channel |
| 7 | Status bar | Messages, errors, the **Manual** and **Keys** links, the MCP light |

On the Bench screen, the order list and the pattern editor are replaced by the [workbench](#the-workbench).
Instruments and the output stay visible.

PoopTracker never asks "are you sure?". Anything that changes the song, or throws a video off the workbench, can be undone with **⌘/Ctrl+Z** and redone
with **⌘/Ctrl+Shift+Z** ([ZEN-NO-CONFIRMATION](ZEN.md)).

---

## The header

![The header, numbered](manual/header.png)

| # | Control | What it does |
|---|---------|--------------|
| 1 | **Zap** | Empties the song: patterns, order and instruments. ⌘/Ctrl+Z brings it back. |
| 2 | **Load** | Opens a `.poop` song or imports a MIDI file (`.mid`). Shortcut: ⌘/Ctrl+O. You can also drop the file on the page. |
| 3 | **Save** | Saves the song and its videos as one `.poop` file. Shortcut: ⌘/Ctrl+S. |
| 4 | Title | The song's title. It is also used as the file name when you save or record. |
| 5 | **▶ Song** | Plays the song from the start (**Enter**). |
| 6 | **▶ Pattern** | Loops the pattern you are editing (**⌘/Ctrl+Enter**). |
| 7 | **■ Stop** | Stops playback (**Space**). |
| 8 | **● Rec** | Records the song from its start as a video. While recording, **▶ Song** and **● Rec** stay down and only **■ Stop** works. See [Recordings](#recording-a-video). |
| 9 | **BPM** | Tempo, 32–255. One tick lasts 2.5 / BPM seconds. |
| 10 | **Speed** | Ticks per row, 1–31. A lower speed plays rows faster. |
| 11 | **Oct** | The octave of the lower row of note keys (F1–F8 also change it). |
| 12 | **Step** | How many rows the cursor moves down after you write a note (0 = it doesn't move). The `` ` `` key changes it. |
| 13 | **Follow** | While playing, the pattern and the order list scroll with the music (⌘/Ctrl+F). |
| 14 | **Pattern** | The pattern screen. |
| 15 | **Bench** | The [workbench](#the-workbench). ⌘/Ctrl+B switches between the two screens. |

To leave a header field without the mouse, press **Esc**. The keys then go back to the pattern.

---

## The pattern editor

A pattern is a grid. Rows are time and run downwards. Columns are channels, and a channel plays one note at a time.
The song plays patterns in the order set in the [order list](#the-order-list).

![The pattern editor in edit mode, numbered](manual/pattern.png)

| # | Part | What it is |
|---|------|------------|
| 1 | Pattern number | The pattern you are editing. ◀ ▶ step through the patterns. |
| 2 | **New / Dup. / Del.** | New: a new empty pattern of the same length. Dup.: a copy of this one. Del.: deletes it, if the order doesn't use it. |
| 3 | **Length** | Rows in this pattern, 1–256. |
| 4 | **+ Chn. / − Chn.** | Adds a channel at the end (up to 10) / deletes the channel under the cursor (only if it is empty). |
| 5 | Channel header | Click it to mute the channel. Right-click it to solo the channel. Right-click again to bring all channels back. |
| 6 | Row number | In hex (`00`–`0F` in a 16-row pattern). |
| 7 | **Note** | `C-4`, `C#4`… or `===` (key-off: the note releases). `...` is empty. |
| 8 | **Instrument** | Which instrument plays the note, in hex (`01`, `02`…). |
| 9 | **Volume** | `00`–`40` in hex (`40` is full). It changes both the loudness and the brightness of the tile. Empty means full. |
| 10 | **Effect** | A letter and two hex digits, for example `S40`. Pink effects affect only the video. See [Effects](#effects). |
| 11 | Beat row | Every beat (here every 4th row) is lighter, so you can count. The orange row is the one being heard. |
| 12 | Red frame | **Edit mode is on.** |

### Edit mode

**Space** (while stopped) turns edit mode on and off. PoopTracker starts with it off.

- **Off:** the note keys only *play* the selected instrument, so you can try sounds without changing the song.
- **On** (red frame): the note keys *write* into the pattern. In the instrument, volume and effect columns you type hex digits.

Cut, copy and paste work in both modes.

### Writing notes

The keyboard is laid out like a piano, as in FastTracker 2. The keys are physical keys, so the layout is the same on
any keyboard language:

```
 lower row  (octave = Oct)        upper row  (octave = Oct + 1)
  S D   G H J                      2 3   5 6 7   9 0
 Z X C V B N M                    Q W E R T Y U I O P
 C D E F G A B                    C D E F G A B C D E
```

- **F1–F8** choose the octave. **1** or **CapsLock** writes a key-off (`===`).
- **Shift+↑ / ↓** chooses the instrument, so you don't have to click the list.
- A note played from the keyboard is released (the envelope's R) when you let go of the key.
- **Pitch is speed.** Twelve semitones above the instrument's base note, the video plays twice as fast. Twelve below,
  it plays at half speed. Vibrato makes the picture wobble too.

### Moving around

| Keys | Move |
|------|------|
| ↑ ↓ ← → | One row / one column |
| PgUp / PgDn, Home / End | 16 rows / top or bottom |
| F9 F10 F11 F12 | Row 0, ¼, ½, ¾ of the pattern |
| Tab / Shift+Tab | Next / previous channel |
| Alt+Q W E R T Y U I | Jump to channel 1–8 |
| Shift+← / → | Previous / next order position |
| ⌘/Ctrl+← / → | Change the pattern number at the order position |

### Clearing and inserting

| Keys | Effect |
|------|--------|
| Del / Backspace | Clear the field under the cursor |
| Shift+Del | Clear the whole cell |
| ⌘/Ctrl+Del | Clear volume and effect |
| Alt+Del | Clear the effect |
| Ins / Alt+Backspace | Insert an empty row in this channel (the rows below move down) |
| Shift+Ins / Shift+Alt+Backspace | Insert a row in all channels |
| Shift+Backspace | Delete the row and pull up the rows below |

On a Mac, Backspace clears the field like Del does. In FastTracker 2 it deleted the note above, which surprised everyone.

### Blocks

Drag with the mouse, or hold **Alt** and use the arrow keys (also Shift+PgUp/PgDn/Home/End), to select a block.

| Keys | Effect |
|------|--------|
| ⌘/Ctrl+C / X / V, or Alt+F4 / F3 / F5 | Copy / cut / paste the block (paste goes to the cursor) |
| Shift+F3 / F4 / F5 | Cut / copy / paste the whole channel |
| ⌘/Ctrl+F3 / F4 / F5 | Cut / copy / paste the whole pattern |
| Del | Delete the selection |
| Esc | Drop the selection |

### Mute and solo

![Channel 4 muted: its header turns red and its tile goes dark](manual/mute.png)

- Click a channel header, or its tile in the output, to **mute** it. Click again to unmute.
- Right-click a header or tile to **solo** that channel. Right-click it again to bring all channels back.
- **Shift+M** mutes the channel under the cursor. **⌘/Ctrl+Shift+M** inverts the mutes. **Shift+U** unmutes all.

---

## The order list

The song is a list of positions, and each position plays one pattern. The same pattern can appear many times.

![The order list, numbered](manual/order.png)

| # | Control | What it does |
|---|---------|--------------|
| 1 | A position | `position · pattern`. Click it to select it. With Follow on, the list follows the song while it plays. |
| 2 | **+** | Inserts the pattern you are editing below the selected position (⌘/Ctrl+F10) |
| 3 | **−** | Deletes the selected position (⌘/Ctrl+F9) |
| 4 | **↑** | Moves the position up |
| 5 | **↓** | Moves it down |
| 6 | **◀** | Lowers the pattern number at this position (⌘/Ctrl+←) |
| 7 | **▶** | Raises it (⌘/Ctrl+→) |

**Enter** plays the song from position 00. **Shift+Enter** plays it from the pattern you are editing. Tempo,
instruments and volumes set earlier in the song carry over.

---

## Instruments

An instrument is a video. Its settings (where the sound hits, its loop, its envelope…) belong to the instrument,
and they can also be saved into the video's own metadata ([ZEN-ONE-VIDEO-ONE-INSTRUMENT](ZEN.md)).

An instrument is at most **8 seconds** long. To use part of a longer video, cut it on the [workbench](#the-workbench).

### Adding an instrument

- Drop a video on the page (on the Pattern screen): it becomes a new instrument. Dropped on an instrument in the list,
  it becomes that instrument's video.
- Or press **New** under the instrument list for an empty instrument, then **Load** a video into it.
- PoopTracker finds the **hit** (the moment the sound kicks in) automatically. Check it: the note will land on its
  row exactly at the hit.
- A video saved from PoopTracker with **Save** comes back with all its settings.

![The instrument list and the instrument settings, numbered](manual/instrument.png)

| # | Control | What it does |
|---|---------|--------------|
| 1 | Instrument list | Click an instrument to select it (or use Shift+↑↓). The selected one is what the note keys play. Drop a video on an instrument here to replace its video. |
| 2 | **New** | Adds an empty instrument at the end of the list, to load a video into |
| 3 | **Load** | Gives the **selected** instrument a video and keeps how it sounds (name, base note, finetune, volume, reverb, envelope, loop mode); the region and hit are found again in the new video. A video saved with **Save** brings all its own settings instead. With no instrument, Load makes a new one. |
| 4 | **Save** | Saves the video with this instrument's settings in its metadata. It isn't re-encoded. MP4/MOV only. |
| 5 | **Dup.** | A new instrument from the same video with the same settings. Use it to take another region of the same clip. |
| 6 | **↑ ↓ Del.** | Move the instrument up or down in the list / delete it (only if no pattern uses it) |
| 7 | **▶ From hit** | Plays the instrument from its hit point |
| 8 | **▶ From start** | Plays it from the start of its region |
| 9 | **Sync test** | A click plays exactly at the hit. If the video is in sync, the hit in the picture lines up with the click. |
| 10 | Sample | See [below](#instrument-settings) |
| 11 | Region | |
| 12 | Hit | |
| 13 | Loop | |
| 14 | Envelope | |
| 15 | Region handles | The orange marks at both ends. Drag them to change the part of the video the instrument uses. |
| 16 | Hit line | The red line. Drag it, or click empty space, to move the hit. |
| 17 | Pre-roll | The blue part before the hit. It plays *before* the note's row, so the hit lands on the row. |
| 18 | Filmstrip and waveform | The frames and the sound of the region. Dark parts are outside the region. |
| 19 | Hit frame | The frame at the hit. Click it to set the **focus**, the point a tile keeps in view when it crops the video. Alt+click resets the focus to the middle. |

### Instrument settings

Levels are hex, like in the pattern (`00`–`40`). Times are decimal seconds.

**Sample**
- **Name:** up to 16 characters. It is shown on the tile.
- **Base:** at this note the clip plays at its original speed (usually `C-4`).
- **Tune:** finds the pitch of the clip after its hit and sets **Base** and **Fine** to it, so the notes you write
  sound as written. The clip itself is not changed, and a bend in it stays: the instrument gets one pitch. A noisy sound
  (a snare, a hi-hat) has no clear pitch, and then nothing changes; a kick or a tom has one.
- **Fit:** for loops. Speeds the clip up or slows it down so that, played at `C-4`, its region lasts a whole number of
  rows at the current BPM and speed (the power of two nearest to its length now: 8, 16, 32…). Played every that many
  rows, it repeats seamlessly. Picture and sound change speed together, so the pitch moves with them (repitch). It sets
  **Base** and **Fine**; press it again after changing the tempo.
- **Fine:** finetune, as in FT2: 1/128 of a semitone, −128 to 127. The clip's own pitch is Base plus Fine.
- **Vol:** `00`–`40`, the loudest this instrument gets. The pattern's volume column plays under it: with Vol `20`,
  volume `40` sounds at `20` and volume `20` sounds at `10`.
- **Rev:** how much of the sound goes into the reverb, `00`–`40` (`00` is dry). All instruments share one hall.
- **A/V ms:** fixes a video whose sound is shifted against its picture.

**Region:** the start and end (in seconds) of the part of the video that is used. **Trim** cuts the video down to the
region and throws the rest away, without re-encoding: the instrument plays the same and the song file gets smaller.
⌘/Ctrl+Z brings the whole video back.

**Hit:** where the sound hits, in seconds. **Auto** finds it in the audio again.

**Loop:** `none` plays once. `forward` repeats loop start → end. `pingpong` goes start → end → start…, and the
video goes back and forth with it.

**Env.** (envelope, ADSR):
- **A** (attack): how long the note takes to rise from silence to full volume.
- **D** (decay): how long it then takes to fall to the sustain level.
- **S** (sustain): the level it stays at, hex `00`–`40`, until a key-off (`===`) or until you let go of the key.
- **R** (release): how long it takes to fade to silence after the key-off.

A, D and R each have a unit. **tick** follows the tempo. **ms** stays fixed.

The picture follows the sound: the tile's brightness is the volume × the envelope.

---

## The output

The output is the music video: 9:16, one tile per channel. One to three channels stack as one column. Four to ten
channels make two columns.

![The output while a song plays, numbered](manual/output.png)

| # | Part | What it is |
|---|------|------------|
| 1 | A tile | What one channel plays. The frame is cropped to fit the tile, around the instrument's focus. |
| 2 | Label | Channel number, instrument name, note |
| 3 | Hit flash | The tile's border flashes on every hit |
| 4 | Stats | Frames per second, active voices, cached frames, audio latency, and the position being heard |
| 5 | A grown tile | Channel 1 plays with `G21`, so its tile covers two columns and one row until the channel goes silent |

Click a tile to mute its channel, and right-click it to solo the channel.

The `Gxy` effect lets one channel's tile grow over its neighbours for as long as the channel sounds. See
[Effects](#effects).

---

## The workbench

The workbench (**Bench** in the header, or **⌘/Ctrl+B**) is for long videos: a film, a live recording, a YouTube
download. You put the video on the bench, mark a piece, and cut it into an instrument. The cut doesn't re-encode the
video, so it is fast and keeps the quality. Whatever you don't cut is thrown away: the bench is never saved.

It cuts MP4, MOV, WebM and MKV. A video from YouTube: `yt-dlp <url>`.

![The workbench with a marked piece, numbered](manual/bench.png)

| # | Control | What it does |
|---|---------|--------------|
| 1 | **Load** | Puts a video on the bench. You can also drop it on the page while the bench is open. |
| 2 | Name | The file and its length |
| 3 | **Trim** | Keeps only the marked piece on the bench and throws the rest away (Ctrl+Z brings it back); it stays marked, ready to cut. The piece can be longer than 8 s. |
| 4 | **Clear** | Takes the video off the bench (Ctrl+Z puts it back) |
| 5 | Picture | Click it to set the **focus** of the instrument you are about to cut. Backspace resets it to the middle. |
| 6 | Marked piece | The orange band. **I** marks its start and **O** its end, or you can drag on the timeline. Drag a handle to move that end. |
| 7 | Timeline | Click it to go to that point. Zoom with the wheel or a pinch (`=` / `-`, `0` shows everything). Shift+wheel or sideways scrolling moves along it. |
| 8 | Piece | Start, end and length of the marked piece (at most 8 s) |
| 9 | **▶ Piece**, **■ Stop**, **Loop** | Plays the piece once (Shift+Space); **▶ Piece** stays down while it plays, **■ Stop** stops it. With **Loop** down, it plays again and again until you pause; drag its ends meanwhile to find the loop. |
| 10 | **Cut → Inst.** | Cuts the piece into a **new** instrument (Enter) |
| 11 | **Cut → Repl.** | Cuts the piece into the **selected** instrument's video, keeping how it sounds (Shift+Enter) |

After the cut, the piece is in the instrument list and its hit has been found. Check it in the waveform:

![After the cut: the piece is the last instrument, with its hit marked](manual/bench-cut.png)

**Bench keys:** Space play/pause · ← → 1 s · Shift+← → 10 s · `,` `.` one frame · Home / End · I / O mark ·
Shift+Space play the piece · Enter cut → new · Shift+Enter cut → selected · Esc unmark · Backspace focus to the middle.

---

## Effects

An effect is a letter and two hex digits, `xy`. With parameter `00`, an effect reuses its previous value.

| Effect | Name | What it does |
|--------|------|--------------|
| `3xx` | Tone portamento | Slides from the previous note to this one; `xx` is the speed |
| `4xy` | Vibrato | `x` speed, `y` depth. The picture wobbles too. |
| `8xx` | Pan | `00` left, `80` center, `FF` right |
| `9xx` | Sample offset | Starts at `xx`/256 of the region (no pre-roll) |
| `Axy` | Volume slide | `x` up, `y` down |
| `E9x` | Retrigger | Replays from the hit every `x` ticks (stutter) |
| `ECx` | Note cut | Silence at tick `x` |
| `EDx` | Note delay | Starts the note `x` ticks late |
| `Fxx` | Speed / BPM | `01`–`1F` sets the speed, `20`–`FF` sets the BPM |
| `Sxx` | **Video:** zoom / shake | A punch on the tile |
| `Ixx` | **Video:** invert | A color-invert flash |
| `Gxy` | **Video:** grow | The tile grows over `x` columns and `y` rows of the grid, rightwards and down, until the channel goes silent. `0` means the whole width or height, so `G00` fills the screen. The tiles it covers keep playing, unseen. |

Video-only effects are drawn in pink in the pattern.

---

<a id="files"></a>
## Files: songs, instrument videos, MIDI, recordings

### Songs (`.poop`)

**Save** (⌘/Ctrl+S) writes one `.poop` file. It is a zip that holds the song as plain text (`song.txt`,
`patterns/*.txt`) and the original videos ([ZEN-PLAIN-TEXT](ZEN.md)). **Load** (⌘/Ctrl+O) or dropping the file on
the page opens it. A file that doesn't make sense is refused, and the status bar says where the problem is
([ZEN-EXPLICIT](ZEN.md)).

### Instrument videos

**Save** under the instrument list writes the instrument's video with its settings inside (MP4/MOV metadata). If you
drop that video on any PoopTracker, it arrives as a ready instrument. This is the way to share a single sound.

### MIDI import

**Load** a `.mid` file (type 0 or 1), or drop it on the page. The notes come in with one instrument per track and
one per drum sound. Each instrument starts with a silent "REPLACE ME" video. Select it and press **Load** under the instrument
list (or drop a video on it in the list) to give it a real one. The status bar reports any notes that were moved, clamped or dropped.

### Recording a video

**● Rec** plays the song from its start and records the output with its sound, reverb included. Press **■ Stop**
or **Space** to finish, and PoopTracker asks where to save. The file is MP4 where the browser can
make one, otherwise WebM. While recording, nothing else can start playback, and the channel count can't change.

---

<a id="mcp"></a>
## Letting an AI play along (MCP)

Whatever you can do to a song in the UI, an AI can do over MCP ([ZEN-AI-PARITY](ZEN.md)): read the song, write
notes, change instruments, load videos, cut pieces, import MIDI, and save.

![The status bar, numbered](manual/statusbar.png)

| # | Part | What it is |
|---|------|------------|
| 1 | Status | What just happened, or what went wrong |
| 2 | **Manual** | This manual, on GitHub |
| 3 | **Keys** | All shortcuts and effects, in one dialog |
| 4 | **MCP ●** | Filled when an AI is connected, hollow (○) when not |
| 5 | **GitHub** | The project page |

MCP needs the tracker running on your own computer, not the online version. Clone the repository, serve its folder
and open http://localhost:8765/ in Chrome:

```
python3 -m http.server 8765
```

Then connect Claude Code:

```
claude mcp add pooptracker -- node /path/to/pooptracker/mcp/server.mjs
```

Keep the tracker open in the browser. When the AI connects, the light turns to **MCP ●**. Every change the AI
makes shows up on screen immediately, and you can undo it with ⌘/Ctrl+Z. To use another port, start the server with
`POOPTRACKER_MCP_PORT=8799 node mcp/server.mjs` and open the tracker with `?mcp=8799`.

The little bug that walks around the page is a link for reporting bugs. Click it if something is broken.

---

## Keyboard reference

On a Mac, the F keys need **fn** unless "Use F1, F2, etc. keys as standard function keys" is on. ⌘ and Ctrl
are the same here.

**Playing**

| Keys | |
|------|--|
| Enter | Play the song from the start |
| Shift+Enter | Play the song from this pattern |
| ⌘/Ctrl+Enter | Loop this pattern |
| Space | Stop; when stopped, edit mode on/off |
| ⌘/Ctrl+F | Follow on/off |
| Shift+M · ⌘/Ctrl+Shift+M · Shift+U | Mute channel · invert mutes · unmute all |

**Notes**

| Keys | |
|------|--|
| Z S X D C V G B H N J M | Notes, octave Oct |
| Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P | Notes, octave Oct + 1 and up |
| 1 / CapsLock | Key-off |
| F1–F8 | Octave |
| `` ` `` / Shift+`` ` `` | Edit step up / down |
| Shift+↑ / ↓ | Instrument |

**Moving, editing, blocks:** see [The pattern editor](#moving-around).

**Song and files**

| Keys | |
|------|--|
| ⌘/Ctrl+Z · ⌘/Ctrl+Shift+Z | Undo · redo |
| ⌘/Ctrl+S · ⌘/Ctrl+O | Save the song · load a song |
| ⌘/Ctrl+B | Pattern ⇄ Bench |
| ⌘/Ctrl+F9 / F10 | Delete / insert an order position |

**Bench:** see [The workbench](#the-workbench).
