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
- Keys: Backspace (the Mac's "delete") clears like Del; Shift+Backspace deletes the row.
