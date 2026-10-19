# Changelog

Breaking changes are allowed and are always written here ([ZEN-COURAGE](docs/ZEN.md)).

## 0.0.1-alpha (unreleased)

The first public version.

- A tracker (FastTracker 2 style) whose samples are short videos; the output is a 9:16 music video.
- 1–10 channels (was 1–8); effects 3xx 4xy 8xx 9xx Axy E9x ECx EDx Fxx, plus Sxx (zoom/shake), Ixx (invert) and
  Gxy (the tile grows over x columns and y rows, over the tiles next to it, until the channel goes silent) for video.
- Songs are `.poop` files: plain-text song and patterns plus the original videos, in one zip.
- An instrument can be saved into its own video's metadata (MP4/MOV, key `pooptracker`, format `TURD1`).
- Pre-roll uses only free time: a clip never starts before the channel's previous note has gone silent.
- MCP server: an AI can read and edit the open song, load videos and save files.
- Backspace clears like Del, unlike FT2 (where it deletes the note above and pulls the channel up): it is the Mac's
  only "delete" key and pulling rows up surprised everyone. Shift+Backspace pulls the rows below the cursor up.
- Enter plays the song from its start; Shift+Enter from the pattern being edited (tempo, instruments and volumes set
  earlier carry over); ⌘/Ctrl+Enter loops the pattern. Playing a pattern from the cursor row is gone.
- ⌘/Ctrl+S saves the song and ⌘/Ctrl+O loads one (the browser would otherwise save the page itself).
- MIDI import (.mid, type 0 and 1; Load, drag & drop, MCP import_midi): one instrument per track, one per drum sound;
  each starts with a silent 1 s REPLACE ME video until Repl. gives it its own. The grid is the coarsest that holds every
  note; tempo changes become Fxx; what was moved, clamped or dropped is reported. No EDx.
- Repl. (replace an instrument's video) keeps how it sounds (name, base note, volume, reverb, envelope, loop mode) and finds
  the region and hit again in the new video, as Load does. It used to keep the old video's times.
- Reverb: each instrument has a Rev amount (hex 00–40, `rev=` in its line; 00 = dry) into one shared ~3 s dark hall,
  made in code (no files). FT2 has no reverb; this deviates from [ZEN-FT2] on purpose. Recordings include it.
- The workbench also cuts WebM and MKV (AV1, VP9, H.264, HEVC pictures; Opus, AAC sound), still without re-encoding:
  the packets are copied into an MP4 piece. VP8 and Vorbis have no place in MP4 and are refused by name.
- On the workbench, ▶ Piece stays down while the piece plays and the new ■ Stop lets it up, as in the transport.
- On the workbench, Loop (a key that stays down) makes ▶ Piece play the piece again and again, without a gap (its
  sound is looped by the audio clock, the picture follows); its ends can be dragged meanwhile.
- On the workbench, Trim keeps only the marked piece on the bench and throws the rest away (not re-encoded).
- Under the instrument list, **Load** now gives the selected instrument a video (what Repl. did; Repl. is gone) and
  the new **New** adds an empty instrument (with the REPLACE ME video) to load into: Load never adds one by surprise.
  A video saved with Save brings all its settings, its loop mode too (it used to keep the instrument's).
- The manual's pictures are made by `npm run shots` from the app itself, numbers included, and show the current
  screen; the instrument and workbench tables are numbered again (New / Load, Trim).
- Section headings that wrap onto two lines no longer overlap.
- Undo keeps at most 20 steps that hold a video (replacing, trimming, the bench, a new song); past that the oldest go.
- Resizing the window no longer sets off "ResizeObserver loop" errors (the output and the pattern resize a frame later).
- The workbench's waveform and loop read only the sound (mp4cut soundCutter): a 5-minute 720p video, 2.7 MB read
  instead of 155 MB.
- Browser tests: `npm test` also drives the app in a headless Chrome (test/browser.js speaks the Chrome DevTools
  Protocol itself, no package); skipped without Chrome.
- A video's readable end no longer depends on the sample rate it was decoded at (resampling could leave it one sample,
  so 1 ms, short): a trimmed 2.5 s region stays 2.5 s.
- The pattern is measured again once the DOS font has loaded (it was only by luck that the layout changed then).
- Fit (next to Tune), for loops: repitches the clip so that at C-4 its region lasts a whole number of rows at the
  current tempo (like Renoise's beat sync in repitch mode); sets Base and Fine. MCP `fit_instrument` (rows optional).
- Tune (next to Base) finds an instrument's pitch and sets Base and the new Fine to it; Fine is FT2's finetune (1/128
  semitone, -128–127), saved as `fine=` only when it isn't 0, so older files open as before. MCP `tune_instrument`, and
  `set_instrument fine`.
- Trim in an instrument's Region cuts its video down to the region (not re-encoded; hit, loop and focus move with it),
  so the song file gets smaller; Ctrl+Z brings the whole video back. MCP `trim_instrument` does the same.
- The video on the workbench changes through commands like the song: Ctrl+Z brings back what Trim or Clear threw away.
  [ZEN-NO-CONFIRMATION] now reads "Everything that throws something away can be undone".
- On the workbench, Shift+Enter (Cut → Repl.) cuts the piece into the selected instrument: its video is replaced, how
  it sounds is kept, as with Repl. MCP replace_video takes start/end (and focus) for the same.
- An instrument's Vol is the ceiling of its sound: the volume column plays under it (Vol 20: volume 40 sounds at 20,
  20 at 10). The picture follows the volume column alone (full at 40). Vol used to be only the volume a note without a
  volume column got.
- Right-clicking a channel tile or a channel's header solos it (as FT2's scopes); right-clicking it again brings all back.
- While recording, ▶ Song and ● Rec stay down like a tape deck's keys and only Stop works (it ends the take); a recording always starts at the song's start.
- With Follow on, the order list follows the song while it plays.
- Edit mode (off at start, red frame when on): off, the note keys only play; on, they write into the pattern. Cut and
  paste (⌘/Ctrl+X / V, Alt+F3 / F5…) work either way.
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
- FastTracker 2 keys: Space stops / toggles edit mode, Enter plays the song (Shift+Enter from the current pattern), Ctrl/⌘+Enter loops it,
  F1–F8 octave, F9–F12 row jumps, ` edit step, Shift+M / Shift+U / Ctrl+Shift+M mutes, Alt+Q…I channel jumps,
  Ctrl/Alt+Del partial clears, Shift+Ins / Alt+Backspace inserts, Alt+arrows and Alt/Shift/Ctrl+F3–F5 blocks,
  Ctrl+←→ and Ctrl+F9/F10 order edits, Ctrl+F follow, Shift+Enter loops the pattern from the cursor row,
  Shift+↑↓ instrument, Shift+←→ order position. Blocks are selected with Alt+arrows (Shift+arrows used to).
- The workbench (⌘/Ctrl+B): a long video goes on it, a piece is marked and cut into a new instrument without
  re-encoding (MP4/MOV); the bench itself is never saved. MCP `load_video` takes `start` / `end` for the same.
- An instrument can have a focus (`focus=` in the instrument line): the point its tiles keep in view instead of the
  middle of the frame. Set by clicking the picture on the bench or the frame preview; MCP `set_instrument focus`.
