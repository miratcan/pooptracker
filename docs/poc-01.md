# POC-01 · Video instrument sharing (in-video metadata)

> Status: **implemented** (Phase 5, 2026-10-12).
> Target: `index.html` (the tracker). Principles: [The Zen of PoopTracker](ZEN.md).

## Problem
Turning a video sample into an instrument takes effort: hit point, base note, ADSR, loop, etc. These settings
shouldn't get lost and should be shareable: the settings should travel **with the video itself**.

## Decision: one video = one instrument, settings in the video's metadata
- The instrument's settings are written into the video as **metadata**: the free-form keyed tags of MP4/MOV
  (QuickTime `mdta`; the method iPhone videos use to carry location/device info, `-movflags use_metadata_tags` in ffmpeg).
- Key: `pooptracker`. Value: a single instrument line (below), without the `video=` field.
- **No packs:** one instrument per video. Several instruments can be made from the same video in the tracker (Phase 1),
  but what gets saved into the video is the currently selected instrument.
- Video and audio are **not re-encoded**, no ffmpeg needed: only the file's `moov` box changes (when it grows, the chunk
  offsets are fixed). On every save the picture/audio packets stay byte-for-byte identical → no generation loss.
- Other metadata keys are kept. Saving again updates the `pooptracker` key.
- MP4/MOV only. WebM can't be written.
- **Known limit:** platforms like YouTube, Instagram and WhatsApp strip metadata. Accepted: sharing is done with the file
  itself (direct copy, download link, etc.).

## Import flow
1. A video is loaded → if it has a `pooptracker` key, the instrument line is read and the settings are applied.
2. Otherwise: automatic hit detection (as before).
3. If the line is invalid (e.g. a unit-less ADSR), an error is given, nothing is guessed ([ZEN-EXPLICIT](ZEN.md)).

## The tracker doesn't edit video (2026-10-12)
- See [ZEN-NOT-A-VIDEO-EDITOR](ZEN.md).
- The tracker's only job on the video is **automatic audio normalization**: when each video is loaded, its audio is
  adjusted so its peak is at −1 dBFS (per video, at most +24 dB). The file isn't touched, nothing is saved; it is
  recomputed on every load.
- Contrast, color, audio fixes and the like are **the video editor's job** (e.g. Shotcut). They aren't added to the
  tracker: if they were, it would gradually turn into a video editor.
- Trimming is already in the tracker: the instrument region (start/end) trims the video without changing it. Trimming the
  start in an editor shifts the timeline, and the hit point lands in the wrong place.
- Cutting a piece out of a long video (2026-10-13) is the workbench's job, and it isn't editing: the piece is copied
  without re-encoding (`mp4cut.js`): it holds the frames from the keyframe before the selection, and its edit list
  hides them, so the piece plays exactly the selection. MP4/MOV only, like the metadata.

## Instrument line: settled fields (Phase 1, 2026-10-12)
```
TURD1;name=Kick 2;video=videos/kick.mp4;start=0.600;end=1.200;hit=0.850;base=D-4;vol=40;a=3t;d=0t;s=1A;r=250ms;loop=forward;ls=0.900;le=1.100;av=20
```
- The line starts with its format version (`TURD1`). Breaking format changes are allowed per
  [ZEN-COURAGE](ZEN.md) and are documented in the CHANGELOG; old versions are not guaranteed to be read.
- `s` = sustain level in hex, always two digits, `00`–`40` like `vol`. It was 0–1 (`s=1`, `s=0.4`) before
  2026-10-13; that form (one digit or a dot) is still read, as what it meant (`1` → `40`), and never written.
- `loop` = `none`, `forward` (loop start → end, again) or `pingpong` (start → end → start…; the video plays backward too).
  It was `0`/`1` before 2026-10-13; those are still read (`0` = none, `1` = forward) and never written.
- `ls` / `le` = loop start / end (seconds), `av` = A/V offset (ms, integer). `video=` exists only in `.poop`, not in metadata.
- All fields are always written; `ls`/`le` even when loop is off (so they aren't lost when read back). The one
  exception is `focus`, written only when the instrument has one.
- `focus` (2026-10-13) = where the picture looks: the point a tile keeps in its middle while cropping the frame to its
  shape, as `time:x,y` keys joined by `|` (`focus=0.000:0.300,0.450|1.200:0.350,0.440`). x, y are 0–1 across the
  frame (0,0 top left), time is seconds on the video's timeline, keys in time order; between keys the point moves in a
  straight line. No `focus`: the middle. A tracked path is stored as keys, never re-tracked when the file is opened:
  another device or a later tracker version would come up with a different path.
- **Positions in the video are in seconds, relative to the start of the video:** region start/end, hit point, loop points.
  They point at a place inside the video, and the video doesn't know the tempo → they can't be ticks.
- **The file format never guesses ([ZEN-EXPLICIT](ZEN.md)):** an ADSR value written without a unit (`a=4`) is an error.
  The "default tick" is only the unit the UI gives a new instrument. An optional field that isn't written (vol, loop,
  ADSR…) gets its default.
- Limits: ADSR at most `999t` / `30000ms`.
- When loop is on, the loop start can't be before the hit point (`ls` ≥ `hit`); if it is, that's an error (2026-10-12).
- Code: `ptformat.js` (the same file in the browser and in Node): `format` / `parse`, `mp4ReadTag` / `mp4WriteTag`.

## ADSR unit
- `a=4t` → ticks. When the tempo changes, the envelope stretches too: at 90 → 120 BPM, "a pad that opens over 4 bars"
  still opens over 4 bars. Same logic as FT2.
- `r=800ms` → milliseconds. For tempo-independent physical events (like the resonance of a frame drum).
- A tick envelope is converted to seconds with the BPM at the moment the note is triggered; if the BPM changes in the
  middle of a playing note, that note doesn't stretch, the next note uses the new tempo.
- Note: in FT2 the tick length depends only on the BPM (tick = 2.5 / BPM s), not on Speed. If Speed changes, rows get
  faster and a tick envelope stays long relative to the rows. FT2 did this too.

## Considered and rejected
- **QR slides at the start of the video (tried on 2026-10-12, rejected).** The goal was to use YouTube as storage and
  sharing infrastructure: since the QR is part of the picture, it survived the platforms' re-compression
  (risk test: a large QR was read even at 144p). Reading and exporting with ffmpeg.wasm (normalize once, then
  copy) were implemented and run. Reason for rejection: **too much effort, time, weight (32 MB ffmpeg) and fragility**
  (AAC/H.264 concatenation details, missing AV1 decoder). The YouTube goal was dropped.
- **Metadata + QR together:** closed since QR was rejected.
