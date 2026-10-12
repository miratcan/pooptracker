// The engine plays the song on a fake AudioContext: no DOM, no sound, the voices are inspected directly.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ctx, openTestSong, testInstrument, testPattern } from './helpers.js';
import { FX } from '../src/util.js';
import { player, startPlay, stopPlay, schedule } from '../src/engine/player.js';
import { voices } from '../src/engine/voice.js';

const ROW = 2.5 / 125 * 6; // 125 BPM, speed 6
// plays the song until `secs` of audio time are scheduled; returns the voices of a channel
function play(secs, ch = 0) {
  ctx.currentTime = 0;
  startPlay('song');
  const t0 = player.uiQueue[0].t; // the time of row 0
  for (let t = 0; t < secs; t += 0.05) { ctx.currentTime = t; schedule(); }
  return { t0, list: voices[ch].slice() };
}
afterEach(() => stopPlay());
const note = (i = 1, extra = {}) => ({ n: 48, i, ...extra });
// a 2 s clip whose hit is at 1 s: its full pre-roll is 1 s
const clip = (o = {}) => testInstrument({ dur: 2, hit: 1, loopStart: 1, ...o });

test('the hit of every note lands exactly on its row', () => {
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: note() }, 40: { 0: note() } })] });
  const { t0, list } = play(6);
  assert.deepEqual(list.map(v => +(v.hitT - t0).toFixed(6)), [0, +(40 * ROW).toFixed(6)]);
});

test('pre-roll: a note starts early by its pre-roll when the channel is free', () => {
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: note() }, 40: { 0: note() } })] });
  const { list: [a, b] } = play(6);
  assert.equal(+(a.hitT - a.start).toFixed(6), 1);
  assert.equal(+(b.hitT - b.start).toFixed(6), 1);
});

test('pre-roll is eaten by the note before it: no free time, no pre-roll', () => {
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: note() }, 2: { 0: note() } })] });
  const { list: [, b] } = play(3);
  assert.equal(b.start, b.hitT);
  assert.equal(b.posAt(b.start), 1); // it starts right at its hit point
});

test('pre-roll uses only the free time after the previous note ends', () => {
  // the first clip ends 1 s after its hit; the second hit comes 12 rows (1.44 s) later → 0.44 s of pre-roll
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: note() }, 12: { 0: note() } })] });
  const { list: [a, b] } = play(4);
  assert.equal(+(b.start - (a.hitT + 1)).toFixed(6), 0);
});

test('a looping note keeps the channel busy until it is cut', () => {
  openTestSong({ instruments: [clip({ loop: true, loopStart: 1.2, loopEnd: 1.8 })], patterns: [testPattern(64, { 0: { 0: note() }, 40: { 0: note() } })] });
  const { list: [a, b] } = play(6);
  assert.equal(b.start, b.hitT);
  assert.equal(+(a.cutT - b.hitT).toFixed(6), 0.006); // cut with a 6 ms fade at the new hit
});

test('key-off (===) releases the note; the next pre-roll starts when the release ends', () => {
  const I = clip({ loop: true, loopStart: 1.2, loopEnd: 1.8, R: { v: 100, u: 'ms' } });
  openTestSong({ instruments: [I], patterns: [testPattern(64, { 0: { 0: note() }, 2: { 0: { n: 97 } }, 8: { 0: note() } })] });
  const { list: [a, b] } = play(4);
  assert.equal(+(a.relT - a.hitT).toFixed(6), +(2 * ROW).toFixed(6));
  assert.equal(+(b.start - (a.relT + 0.1)).toFixed(6), 0);
});

test('EDx delays the note by x ticks', () => {
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 4: { 0: note(1, { f: FX.E, p: 0xD3 }) } })] });
  const { t0, list: [a] } = play(4);
  assert.equal(+(a.hitT - t0).toFixed(6), +(4 * ROW + 3 * 2.5 / 125).toFixed(6));
});

test('E9x retriggers from the hit point every x ticks', () => {
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: note(1, { f: FX.E, p: 0x92 }) } })] });
  const { list } = play(3);
  assert.equal(list.length, 3); // ticks 0, 2, 4 of a speed-6 row
  assert.ok(list.slice(1).every(v => v.start === v.hitT && v.posAt(v.start) === 1));
});

test('Fxx changes the tempo from that row on', () => {
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: { f: FX.F, p: 250 } }, 1: { 0: note() } })] });
  const { t0, list: [a] } = play(3);
  assert.equal(+(a.hitT - t0).toFixed(6), +(2.5 / 250 * 6).toFixed(6)); // row 0 already at 250 BPM
});

test('playing from an order position keeps the tempo and instrument set before it', () => {
  const second = testInstrument({ name: 'second' });
  openTestSong({ instruments: [clip(), second], patterns: [testPattern(4, { 0: { 0: { f: FX.F, p: 250 } }, 1: { 0: note(2) } }), testPattern(4, { 0: { 0: { n: 48 } } })] });
  ctx.currentTime = 0;
  startPlay('song', null, 1);
  assert.equal(player.uiQueue[0].ord, 1);
  assert.equal(player.bpm, 250);
  for (let t = 0; t < 1; t += 0.05) { ctx.currentTime = t; schedule(); }
  assert.equal(voices[0][0].I, second); // the note without an instrument number uses the one set in pattern 0
});

test('muted or not, a channel plays on its own bus', () => {
  openTestSong({ channels: 2, instruments: [clip()], patterns: [testPattern(16, { 0: { 0: note(), 1: note() } }, 2)] });
  play(0.3);
  assert.equal(voices[0].length, 1);
  assert.equal(voices[1].length, 1);
  assert.notEqual(voices[0][0].pn.outputs[0], voices[1][0].pn.outputs[0]);
});
