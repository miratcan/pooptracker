# Architecture

PoopTracker is plain JavaScript modules loaded by the browser: no build step, no framework, no dependencies
([ZEN-STANDALONE](ZEN.md)). `index.html` holds the markup and the CSS; `src/main.js` starts everything. The import map at the end of
`index.html` is generated (`npm run stamp`): it versions every module by its content hash for the browser cache.

## Layers

```
src/
  ptformat.js     the file formats: TURD1 instrument lines, .poop songs, MP4 metadata   (no DOM, no audio)
  mp4.js          MP4/MOV boxes: reading and writing them                            (no DOM, no audio)
  mp4cut.js       cuts a piece out of an MP4/MOV or WebM/MKV without re-encoding (the workbench); the piece is an MP4  (no DOM, no audio)
  webm.js         reads a WebM/MKV's packets and describes them as an MP4 moov, for mp4cut  (no DOM, no audio)
  midi.js         .mid files → a song (notes, tempo, one instrument per track)       (no DOM, no audio)
  util.js         constants and small helpers                                        (no DOM, no audio)
  core/           the song and the commands that change it                           (no DOM, no audio)
    song.js         song, instruments, videos: the data
    commands.js     the ONLY writer of that data; undo / redo; change events
    instrument.js   videos and instruments: regions, hit point, pitch, ADSR, normalize, hit detection
  engine/         plays the song on an AudioContext                                  (no DOM)
    audio.js        the audio graph (a bus and a reverb send per channel, one hall reverb), mute, the audio clock
    voice.js        one playing note: audio and video read the same position [ZEN-IN-SYNC]
    player.js       rows → voices, ahead of time; effects; key preview, sync test
  io.js           files ⇄ song: decode videos, import / replace, read / build .poop, save to video
  mcp.js          the MCP tools, run inside the tab [ZEN-AI-PARITY]
  ui/             screens and panels
    common.js       editor state (cursor, selection…), status bar, run(), refreshUI()
    screens.js      screens and the keyboard dispatcher [ZEN-FLAT-SCREENS]
    patternEditor.js, songPanel.js, instrumentPanel.js, output.js, transport.js, files.js
  demo.js         the demo instruments and beat shown at startup
media/replace-me.mp4  the 1 s silent video every MIDI-imported instrument starts with
mcp/server.mjs    the MCP server (Node, stdio ⇄ WebSocket to the tab); reads and writes files for MCP
test/             node --test: format, commands, engine (on a fake AudioContext), cutting (fixtures/av.mp4), MIDI
```

Dependencies only point down: `ui` → `io`, `engine`, `core` → `midi` → `ptformat`, `mp4cut` → `webm` → `mp4`, `util`. `core` and `engine` never import
`ui`, so they run in Node; that is how the tests play songs without a browser.

## The rules

1. **The song changes only through a command** (`core/commands.js`). A command validates first and throws
   `CmdError` with a readable message if the change is invalid; nothing is applied. Otherwise it returns
   `{ label, scope, apply, revert }`. `exec()` applies it and records it for undo. The keyboard, the mouse and MCP
   all use the same commands, so they share validation and undo. Nobody writes `song.…` or `instruments[…]…` directly.
2. **Changes are announced, not pushed.** After a command is applied, undone or redone, `onChange` listeners hear
   `{ cmd, scope, how }`. The engine follows the song (tempo, channel list); the UI redraws what the scope touched
   (`cells` → the pattern only; anything else → `refreshUI()`). A panel never calls another panel to update it.
3. **The engine doesn't know the screen.** It is told what to play (`startPlay('pattern', () => ed.pat)`), it gets
   its `AudioContext` from outside (`initAudio(ctx)`), and it tells listeners when it starts or stops (`onPlayer`).
4. **Screens own their keys.** A screen is `{ keys, onKey, enter, leave }`; `screens.js` sends each key to the active
   screen first, then to the global keys (undo / redo). Screens are never nested.
5. **Files never guess** ([ZEN-EXPLICIT](ZEN.md)). Parsers reject ambiguous values with `file:line` and what is allowed.

## Time

Notes are scheduled ahead (about 150 ms plus room for the longest pre-roll) on the AudioContext clock; the audio
thread plays them, so a busy main thread doesn't make the sound stutter. The output and the pattern cursor follow
the time that is coming out of the speakers (`visualTime()`), so picture and sound match.

A note's **hit** lands exactly on its row. If the clip's hit is not at its start, the clip starts early (the
**pre-roll**), but only in free time: never before the channel's previous note has gone silent.
