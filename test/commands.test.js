// The command layer: the only writer of the song. Every change validates, undoes, redoes and announces itself.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestSong, testInstrument, testPattern } from './helpers.js';
import { song, instruments, bench } from '../src/core/song.js';
import * as C from '../src/core/commands.js';
import { focusAt } from '../src/core/instrument.js';

const changes = [];
C.onChange(c => changes.push({ scope: c.scope, how: c.how }));
beforeEach(() => { openTestSong({ instruments: [testInstrument(), testInstrument({ name: 'b' })] }); changes.length = 0; });

test('setCells applies, undoes and redoes, and announces each step', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 3, ch: 1, n: 48, i: 1 }], 'note'));
  assert.equal(song.patterns[0].rows[3][1].n, 48);
  C.undo(); assert.equal(song.patterns[0].rows[3][1].n, -1);
  C.redo(); assert.equal(song.patterns[0].rows[3][1].n, 48);
  assert.deepEqual(changes, [{ scope: 'cells', how: undefined }, { scope: 'cells', how: 'undo' }, { scope: 'cells', how: 'redo' }]);
});

test('an invalid change throws CmdError and changes nothing', () => {
  assert.throws(() => C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 7 }])), C.CmdError);
  assert.throws(() => C.exec(() => C.setCells([{ pat: 0, row: 99, ch: 0, n: 48 }])), /row 99 doesn't exist/);
  assert.equal(song.patterns[0].rows[0][0].n, -1);
  assert.equal(changes.length, 0);
});

test('a change to the same values is not a command', () => {
  assert.equal(C.exec(() => C.setSong({ bpm: song.bpm }, 'BPM')), null);
  assert.equal(C.hist.undo.length, 0);
});

test('a channel with notes in it is not deleted', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 2, n: 48, i: 1 }]));
  assert.throws(() => C.exec(() => C.deleteChannel(2)), /channel 3 isn't empty/);
  C.exec(() => C.deleteChannel(3));
  assert.equal(song.channels.length, 3);
  assert.equal(song.patterns[0].rows[0].length, 3);
  C.undo(); assert.equal(song.patterns[0].rows[0].length, 4);
});

test('the guard can refuse structural changes (e.g. while recording)', () => {
  C.setGuard(a => a === 'channels' ? 'busy' : null);
  try { assert.throws(() => C.exec(() => C.addChannel()), /busy/); }
  finally { C.setGuard(() => null); }
});

test('an instrument in use is not deleted; moving one renumbers its cells', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 2 }]));
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, i: 0 }]));
  C.exec(() => C.setCells([{ pat: 0, row: 1, ch: 0, n: 48, i: 2 }]));
  assert.throws(() => C.exec(() => C.deleteInstrument(2)), /instrument 02 is in use/);
  C.exec(() => C.moveInstrument(2, -1));
  assert.equal(song.patterns[0].rows[1][0].i, 1);
  assert.equal(instruments[1].name, 'b');
});

test('loop start can never be before the hit point', () => {
  assert.throws(() => C.exec(() => C.setInstrument(1, { loop: 'forward', loopStart: 0.5, loopEnd: 1.5 })), /loop start \(0\.500\) can't be before the hit point/);
  C.exec(() => C.setInstrument(1, { loop: 'forward', loopStart: 1.2, loopEnd: 1.5 }));
  assert.equal(instruments[1].loop, 'forward');
});

test('a new song is one command: undo brings everything back', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 1 }]));
  C.exec(() => C.newSong());
  assert.equal(instruments.length, 1);
  assert.equal(song.patterns.length, 1);
  C.undo();
  assert.equal(instruments.length, 3);
  assert.equal(song.patterns[0].rows[0][0].n, 48);
});

test('opening a song clears the history', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 1 }]));
  openTestSong({ patterns: [testPattern(16)] });
  assert.equal(C.undo(), null);
  assert.equal(song.patterns[0].rows.length, 16);
});

test('the focus is an instrument setting: set, checked and undone like the others; the point moves along its path', () => {
  C.exec(() => C.setInstrument(1, { focus: [{ t: 0, x: 0.2, y: 0.5 }, { t: 1, x: 0.6, y: 0.3 }] }));
  const I = instruments[1], f = focusAt(I, 0.5);
  assert.ok(Math.abs(f.x - 0.4) < 1e-9 && Math.abs(f.y - 0.4) < 1e-9);
  assert.deepEqual(focusAt(I, 5), { t: 1, x: 0.6, y: 0.3 });
  assert.throws(() => C.exec(() => C.setInstrument(1, { focus: [{ t: 0, x: 2, y: 0.5 }] })), /focus key 1: x '2' is invalid/);
  C.undo();
  assert.deepEqual(focusAt(I, 0.5), { x: 0.5, y: 0.5 });
});

test('a replaced video keeps how the instrument sounds; region and hit are found again in it', () => {
  C.exec(() => C.setInstrument(1, { name: 'kick', baseNote: 50, vol: 32, R: { v: 9, u: 't' }, start: 0.2, end: 1.8, hit: 1.5, loopStart: 1.6, loopEnd: 1.8, loop: 'forward', focus: [{ t: 0, x: 0.2, y: 0.3 }], avOffset: 40 }));
  const other = testInstrument({ dur: 3 }), d = other.video.buffer.getChannelData(0), sr = other.video.buffer.sampleRate;
  for (let i = Math.round(0.7 * sr); i < Math.round(0.8 * sr); i++) d[i] = 0.8; // a hit at 0.700 s
  C.exec(() => C.setInstrumentVideo(1, other.video));
  const I = instruments[1];
  assert.equal(I.video, other.video);
  assert.deepEqual([I.name, I.baseNote, I.vol, I.R, I.loop], ['kick', 50, 32, { v: 9, u: 't' }, 'forward']);
  assert.deepEqual([I.start, I.end, I.hit, I.loopStart, I.loopEnd, I.avOffset, I.focus], [0, 3, 0.7, 0.7, 3, 0, []]);
  C.undo();
  assert.deepEqual([I.start, I.end, I.hit, I.loopStart, I.avOffset], [0.2, 1.8, 1.5, 1.6, 40]);
});

test('a video that carries its own instrument (saved with Save) brings all of it, the loop mode too', () => {
  const other = testInstrument({ dur: 3 }), saved = { ...C.pick(instruments[1], C.INST_KEYS), name: 'saved', baseNote: 52, fine: -7,
    start: 0.5, end: 2.5, hit: 1, loop: 'pingpong', loopStart: 1.2, loopEnd: 2.4 };
  C.exec(() => C.setInstrumentVideo(1, other.video, saved));
  const I = instruments[1];
  assert.deepEqual([I.name, I.baseNote, I.fine, I.loop, I.loopStart, I.loopEnd], ['saved', 52, -7, 'pingpong', 1.2, 2.4]);
});

test('the bench: putting a video on it, trimming and clearing it are undoable, and bring their marks back', () => {
  const a = new Blob(['a']), b = new Blob(['b']);
  C.exec(() => C.putOnBench(a));
  assert.equal(bench.file, a); assert.equal(bench.in, null);
  Object.assign(bench, { in: 10, out: 13, focus: { x: 0.3, y: 0.5 } }); // marks are not commands
  C.exec(() => C.trimBench(b, 3));
  assert.deepEqual({ ...bench }, { file: b, in: 0, out: 3, focus: { x: 0.3, y: 0.5 } });
  C.exec(C.clearBench);
  assert.equal(bench.file, null);
  C.undo(); assert.equal(bench.file, b);
  C.undo(); assert.deepEqual({ ...bench }, { file: a, in: 10, out: 13, focus: { x: 0.3, y: 0.5 } });
  C.redo(); assert.deepEqual({ ...bench }, { file: b, in: 0, out: 3, focus: { x: 0.3, y: 0.5 } });
  assert.equal(C.putOnBench(b), null); // the same video again is no change
  assert.ok(changes.every(c => c.scope === 'bench'));
});

test('at most MAX_HEAVY commands that keep a video alive stay in the history; it is cut off before the oldest', () => {
  C.exec(() => C.setSong({ bpm: 100 }, 'BPM')); // a light one, before them all
  const files = Array.from({ length: C.MAX_HEAVY + 5 }, (_, i) => new Blob([String(i)]));
  for (const f of files) C.exec(() => C.putOnBench(f));
  assert.equal(C.hist.undo.filter(c => c.heavy).length, C.MAX_HEAVY);
  assert.equal(C.hist.undo.length, C.MAX_HEAVY); // the BPM change went with the oldest
  while (C.undo());
  assert.equal(bench.file, files[4]); // back as far as the history goes: before the 6th video was put on
  assert.equal(song.bpm, 100);
});
