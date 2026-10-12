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
- Edit mode (off at start, red frame when on): off, the note keys only play; on, they write into the pattern.
- FastTracker 2 keys: Space stops / toggles edit mode, Enter plays from the current pattern, Ctrl/⌘+Enter loops it,
  F1–F8 octave, F9–F12 row jumps, ` edit step, Shift+M / Shift+U / Ctrl+Shift+M mutes, Alt+Q…I channel jumps,
  Ctrl/Alt+Del partial clears, Shift+Ins / Alt+Backspace inserts, Alt+arrows and Alt/Shift/Ctrl+F3–F5 blocks,
  Ctrl+←→ and Ctrl+F9/F10 order edits, Ctrl+F follow, Shift+Enter loops the pattern from the cursor row,
  Shift+↑↓ instrument, Shift+←→ order position. Blocks are selected with Alt+arrows (Shift+arrows used to).
