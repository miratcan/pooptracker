// The engine plays the song on a fake AudioContext: no DOM, no sound, the voices are inspected directly.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ctx, openTestSong, testInstrument, testPattern } from './helpers.js';
import { FX, spanCells } from '../src/util.js';
import { player, startPlay, stopPlay, schedule, previewNote } from '../src/engine/player.js';
import { voices, voicesAt } from '../src/engine/voice.js';
import { revBus } from '../src/engine/audio.js';

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
  openTestSong({ instruments: [clip({ loop: 'forward', loopStart: 1.2, loopEnd: 1.8 })], patterns: [testPattern(64, { 0: { 0: note() }, 40: { 0: note() } })] });
  const { list: [a, b] } = play(6);
  assert.equal(b.start, b.hitT);
  assert.equal(+(a.cutT - b.hitT).toFixed(6), 0.006); // cut with a 6 ms fade at the new hit
});

test('key-off (===) releases the note; the next pre-roll starts when the release ends', () => {
  const I = clip({ loop: 'forward', loopStart: 1.2, loopEnd: 1.8, R: { v: 100, u: 'ms' } });
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
  openTestSong({ instruments: [clip(), second], patterns: [testPattern(4, { 0: { 0: { f: FX.F, p: 250 } }, 1: { 0: note(2) }, 2: { 0: note(2) } }), testPattern(4, { 0: { 0: { n: 48 } } })] });
  ctx.currentTime = 0;
  startPlay('song', null, 1);
  assert.equal(player.uiQueue[0].ord, 1);
  assert.equal(player.bpm, 250);
  for (let t = 0; t < 1; t += 0.05) { ctx.currentTime = t; schedule(); }
  assert.equal(voices[0][0].I, second); // the note without an instrument number uses the one set in pattern 0
});

test('a jammed note is released when its key goes up: the envelope fades over R, then the clip stops', () => {
  const I = clip({ loop: 'forward', loopStart: 1, loopEnd: 1.5, R: { v: 200, u: 'ms' } });
  openTestSong({ instruments: [I] });
  ctx.currentTime = 0;
  const v = previewNote(I, 0, 48);
  v.letGo(0.5);
  const ev = v.g.gain.events.at(-1);
  assert.deepEqual([ev[1], +ev[2].toFixed(3)], [0, 0.7]); // silent R (200 ms) after the key went up
  assert.ok(Math.abs(v.src.stopped - 0.71) < 1e-9);
});

test('pingpong: the clip loops forward then backward, and the video follows', () => {
  const I = clip({ loop: 'pingpong', loopStart: 1, loopEnd: 1.5 });
  openTestSong({ instruments: [I] });
  ctx.currentTime = 0;
  const v = previewNote(I, 0, 48);
  const B = v.src.buffer;
  assert.notEqual(B, I.buffer);
  assert.equal(B.length, (1.5 + 0.5) * ctx.sampleRate); // up to the loop end, then the loop part reversed
  assert.deepEqual([v.src.loopStart, v.src.loopEnd], [1, 2]);
  const t0 = v.segs[0].t;
  assert.ok(Math.abs(v.posAt(t0 + 0.25) - 1.25) < 1e-9); // on the way to the loop end
  assert.ok(Math.abs(v.posAt(t0 + 0.75) - 1.25) < 1e-9); // on the way back
});

test('muted or not, a channel plays on its own bus', () => {
  openTestSong({ channels: 2, instruments: [clip()], patterns: [testPattern(16, { 0: { 0: note(), 1: note() } }, 2)] });
  play(0.3);
  assert.equal(voices[0].length, 1);
  assert.equal(voices[1].length, 1);
  assert.notEqual(voices[0][0].pn.outputs[0], voices[1][0].pn.outputs[0]);
});

test('reverb: a voice sends its share to its channel\'s reverb bus; a dry instrument sends nothing', () => {
  openTestSong({ channels: 2, instruments: [clip({ reverb: 32 }), clip()], patterns: [testPattern(16, { 0: { 0: note(1), 1: note(2) } }, 2)] });
  play(0.3);
  const wet = voices[0][0], dry = voices[1][0];
  assert.equal(wet.rv.gain.value, 0.5);
  assert.equal(wet.rv.outputs[0], revBus[0]);
  assert.ok(wet.pn.outputs.includes(wet.rv));
  assert.equal(dry.rv, undefined);
  assert.equal(dry.pn.outputs.length, 1);
});

test('the instrument\'s volume is the ceiling of the sound: Vol 20 plays volume 40 at 20 and 20 at 10; the picture follows the volume', () => {
  openTestSong({ channels: 3, instruments: [clip({ vol: 0x20 })], patterns: [testPattern(16, { 0: { 0: note(1, { v: 0x40 }), 1: note(1, { v: 0x20 }), 2: note(1) } }, 3)] });
  play(1.5);
  // the sound (the gain node) is scaled by Vol; the picture (gainAt) follows the volume alone
  const sound = ch => { const ev = voices[ch][0].g.gain.events.filter(e => e[2] <= voices[ch][0].hitT + 0.01); return +ev.at(-1)[1].toFixed(3); };
  const picture = ch => +voices[ch][0].gainAt(voices[ch][0].hitT + 0.01).toFixed(3);
  assert.deepEqual([sound(0), sound(1), sound(2)], [0.5, 0.25, 0.5]);
  assert.deepEqual([picture(0), picture(1), picture(2)], [1, 0.5, 1]);
});

test('Gxy is a channel setting, like 8xx: it stays until the next G, also through silence; a silent channel shows its own cell', () => {
  const I = clip({ loop: 'forward', loopStart: 1.2, loopEnd: 1.8, R: { v: 100, u: 'ms' } });
  const G = p => ({ f: FX.G, p });
  openTestSong({ instruments: [I], patterns: [testPattern(64, {
    0: { 0: note(1, G(0x22)) }, 4: { 0: note() }, 8: { 0: G(0x00) }, 12: { 0: { n: 97 } }, 20: { 0: note() }, // grown, kept, full screen, silence
    27: { 0: G(0x12) }, 28: { 0: note() }, // a G before the note (the channel is already silent) applies to it
    32: { 0: note(1, G(0x11)) }, // back to its own cell
  })] });
  const { list: [a, b, c, d, e] } = play(5);
  assert.equal(a.spanAt(a.hitT + 0.001), 0x22);
  assert.equal(b.spanAt(b.hitT + 0.001), 0x22);
  assert.equal(b.spanAt(a.hitT + 8 * ROW + 0.001), 0x00);
  assert.equal(b.spanAt(b.relT + 0.2), null); // released and faded out: silent, so its own cell
  assert.equal(c.spanAt(c.hitT + 0.001), 0x00); // after the silence the G00 still holds: nothing changed it
  assert.equal(d.spanAt(d.hitT + 0.001), 0x12);
  assert.equal(e.spanAt(e.hitT + 0.001), 0x11);
});

test('a G on a note\'s own row holds from the start of its pre-roll; a G on its own changes the playing note from its row on', () => {
  const G = p => ({ f: FX.G, p });
  // a 2 s clip with its hit at 1 s: its pre-roll is a second; the channel is silent by then, so it gets all of it
  openTestSong({ instruments: [clip()], patterns: [testPattern(64, { 0: { 0: note(1, G(0x22)) }, 40: { 0: note(1, G(0x00)) }, 44: { 0: G(0x12) } })] });
  const { list } = play(7), v = list[1];
  assert.ok(v.start < v.hitT - 0.9); // a full pre-roll
  assert.equal(v.spanAt(v.start + 0.01), 0x00); // not the 22 of the note before
  assert.equal(v.spanAt(v.hitT + 3 * ROW), 0x00);
  assert.equal(v.spanAt(v.hitT + 4 * ROW + 0.001), 0x12);
});

test('starting mid-song, a G written earlier holds, like the tempo and the volumes', () => {
  const G = p => ({ f: FX.G, p });
  openTestSong({ instruments: [clip()], patterns: [testPattern(16, { 0: { 0: note(1, G(0x22)) } }), testPattern(16, { 0: { 0: note() } })] });
  ctx.currentTime = 0; startPlay('song', null, 1);
  for (let t = 0; t < 2; t += 0.05) { ctx.currentTime = t; schedule(); }
  const v = voices[0][0];
  assert.equal(v.spanAt(v.hitT + 0.001), 0x22);
});

test('Gxy covers cells rightwards and down as far as the grid goes; 0 = the whole width or height', () => {
  assert.deepEqual(spanCells(0, 0x22, 2, 5), { c0: 0, r0: 0, c1: 2, r1: 2 });
  assert.deepEqual(spanCells(1, 0x22, 2, 5), { c0: 1, r0: 0, c1: 2, r1: 2 }); // right column: only down
  assert.deepEqual(spanCells(9, 0x22, 2, 5), { c0: 1, r0: 4, c1: 2, r1: 5 }); // the last tile can't grow
  assert.deepEqual(spanCells(5, 0x00, 2, 5), { c0: 0, r0: 0, c1: 2, r1: 5 }); // G00: the full screen
  assert.deepEqual(spanCells(3, 0x02, 2, 5), { c0: 0, r0: 1, c1: 2, r1: 3 }); // the whole width, 2 rows
});

test('a busy channel never loses a note scheduled ahead: drawing drops only voices that have started', () => {
  // a 1 s pre-roll in the song schedules notes far ahead; a note on every row then fills a channel's list past 8
  const rows = Object.fromEntries(Array.from({ length: 64 }, (_, r) => [r, { 0: note(2) }]));
  rows[0][1] = note(1);
  openTestSong({ instruments: [clip(), testInstrument({ dur: 0.3, hit: 0.01, loopStart: 0.01 })], patterns: [testPattern(64, rows)] });
  ctx.currentTime = 0; startPlay('song');
  const seen = new Set();
  for (let t = 0; t < 6; t += 1 / 60) {
    ctx.currentTime = t; schedule();
    voices[0].forEach(v => seen.add(v));
    voicesAt(0, t - 0.2); // the picture runs behind the audio clock by the output latency
  }
  assert.ok(seen.size > 40);
  assert.deepEqual([...seen].filter(v => v.cutT === 0).map(v => +v.hitT.toFixed(3)), []); // killed: none
});
