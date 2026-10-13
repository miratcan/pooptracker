# Changelog

Breaking changes are allowed and are always written here ([ZEN-COURAGE](docs/ZEN.md)).

## 0.0.1-alpha (unreleased)

The first public version.

- A tracker (FastTracker 2 style) whose samples are short videos; the output is a 9:16 music video.
- 1–8 channels; effects 3xx 4xy 8xx 9xx Axy E9x ECx EDx Fxx, plus Sxx (zoom/shake) and Ixx (invert) for video.
- Songs are `.poop` files: plain-text song and patterns plus the original videos, in one zip.
- An instrument can be saved into its own video's metadata (MP4/MOV, key `pooptracker`, format `TURD1`).
- Pre-roll uses only free time: a clip never starts before the channel's previous note has gone silent.
- MCP server: an AI can read and edit the open song, load videos and save files.
- Backspace clears like Del, unlike FT2 (where it deletes the note above and pulls the channel up): it is the Mac's
  only "delete" key and pulling rows up surprised everyone. Shift+Backspace pulls the rows below the cursor up.
- Enter plays the song from the pattern being edited; tempo, instruments and volumes set earlier carry over.
- ⌘/Ctrl+S saves the song and ⌘/Ctrl+O loads one (the browser would otherwise save the page itself).
- MIDI import (.mid, type 0 and 1; Load, drag & drop, MCP import_midi): one instrument per track, one per drum sound;
  each starts with a silent 1 s REPLACE ME video until Repl. gives it its own. The grid is the coarsest that holds every
  note; tempo changes become Fxx; what was moved, clamped or dropped is reported. No EDx.
- Repl. (replace an instrument's video) keeps how it sounds (name, base note, volume, envelope, loop mode) and finds
  the region and hit again in the new video, as Load does. It used to keep the old video's times.
- While recording, Rec is the Stop button and nothing else starts playback; a recording always starts at the song's start.
- With Follow on, the order list follows the song while it plays.
- Edit mode (off at start, red frame when on): off, the note keys only play; on, they write into the pattern.
- A note played from the keyboard is released (the envelope's R) when its key goes up.
- Modules are loaded with `?v=<content hash>` (an import map in index.html, written by `npm run stamp`), so after
  an update the browser never runs new code with old cached modules.
- The sustain level is written in hex `00`–`40` like the volume (`s=40` = full; was `s=1`, `s=0.4`), always two
  digits. Old files still open: a one-digit or dotted `s` is the old 0–1 form and is read as what it meant (`1` →
  `40`), never as hex. In the tracker S and Vol are both hex fields.
- Loop is a mode: `loop=none|forward|pingpong` (was `loop=0|1`). Old files still open: `0` is read as none, `1` as
  forward. Pingpong is new: the clip and its video go loop start → end → start…
- Controls are grouped in named frames (Transport, Tempo, Edit, Sample, Region, Loop, Envelope); the instrument
  volume and S are hex fields (00–40, like the pattern) instead of sliders; number fields have no spinner arrows.
- FastTracker 2 keys: Space stops / toggles edit mode, Enter plays from the current pattern, Ctrl/⌘+Enter loops it,
  F1–F8 octave, F9–F12 row jumps, ` edit step, Shift+M / Shift+U / Ctrl+Shift+M mutes, Alt+Q…I channel jumps,
  Ctrl/Alt+Del partial clears, Shift+Ins / Alt+Backspace inserts, Alt+arrows and Alt/Shift/Ctrl+F3–F5 blocks,
  Ctrl+←→ and Ctrl+F9/F10 order edits, Ctrl+F follow, Shift+Enter loops the pattern from the cursor row,
  Shift+↑↓ instrument, Shift+←→ order position. Blocks are selected with Alt+arrows (Shift+arrows used to).
- The workbench (⌘/Ctrl+B): a long video goes on it, a piece is marked and cut into a new instrument without
  re-encoding (MP4/MOV); the bench itself is never saved. MCP `load_video` takes `start` / `end` for the same.
- An instrument can have a focus (`focus=` in the instrument line): the point its tiles keep in view instead of the
  middle of the frame. Set by clicking the picture on the bench or the frame preview; MCP `set_instrument focus`.
