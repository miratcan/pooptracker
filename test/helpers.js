// Test helpers: a fresh song with test instruments, built through the same core functions the app uses.
import { FakeAudioContext, FakeAudioBuffer } from './fake-audio.js';
import { initAudio } from '../src/engine/audio.js';
import { makeVideo, makeInstrument } from '../src/core/instrument.js';
import { replaceSong } from '../src/core/commands.js';
import { emptyCell } from '../src/core/song.js';

export const ctx = new FakeAudioContext();
initAudio(ctx);

// a silent "video": dur seconds of audio, a few 1×1 frames
export function testInstrument(o = {}) {
  const dur = o.dur ?? 2, sr = ctx.sampleRate;
  const V = makeVideo(o.name ?? 'test', [{ width: 1, height: 1 }], new FakeAudioBuffer({ length: Math.round(dur * sr), sampleRate: sr }));
  const { dur: _, ...rest } = o;
  return makeInstrument(V, { name: 'test', hit: 1, loopStart: 1, ...rest });
}
// rows: { [row]: { [ch]: cell fields } }
export function testPattern(n, rows = {}, channels = 4) {
  const P = { rows: Array.from({ length: n }, () => Array.from({ length: channels }, emptyCell)) };
  for (const [r, chs] of Object.entries(rows)) for (const [ch, c] of Object.entries(chs)) Object.assign(P.rows[r][ch], c);
  return P;
}
// a whole new song (like opening a file): no history
export function openTestSong({ instruments = [testInstrument()], patterns = [testPattern(64)], channels = 4, bpm = 125, speed = 6 } = {}) {
  replaceSong({ title: '', bpm, speed, rowsPerBeat: 4, channels: Array.from({ length: channels }, () => ({ name: '', pan: 0x80 })), patterns, order: patterns.map((_, k) => k) },
    instruments, [...new Set(instruments.map(I => I.video))]);
}
