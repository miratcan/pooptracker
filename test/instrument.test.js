// An instrument's sound: its pitch, found in the clip (Tune), and how a note plays it (base note + finetune).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioBuffer } from './fake-audio.js';
import { detectPitch, tuneFor, rateFor, fitToVideo, fitFor, makeVideo, amplify } from '../src/core/instrument.js';

const SR = 48000;
// seconds of a signal: f(t) → sample
function sound(sec, f) {
  const b = new FakeAudioBuffer({ length: Math.round(sec * SR), sampleRate: SR }), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = f(i / SR);
  return b;
}
const voice = hz => t => 0.5 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t) + 0.12 * Math.sin(6 * Math.PI * hz * t);

test('detectPitch finds the pitch of a tone with overtones, within a few cents', () => {
  for (const hz of [82.4, 220, 261.63, 445, 987.8]) {
    const got = detectPitch(sound(1, voice(hz)));
    assert.ok(Math.abs(1200 * Math.log2(got / hz)) < 5, `${hz} Hz → ${got} Hz`);
  }
});

test('detectPitch listens from the hit on: silence before it doesn\'t count', () => {
  const b = sound(1.5, t => t < 0.5 ? 0 : voice(330)(t));
  assert.ok(Math.abs(detectPitch(b, 0.5) - 330) < 1);
});

test('a sound without a clear pitch (noise, silence) has none', () => {
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  assert.equal(detectPitch(sound(1, () => rnd())), null);
  assert.equal(detectPitch(sound(1, () => 0)), null);
});

test('tuneFor: a pitch becomes the base note and finetune; that note then plays the clip at its own speed', () => {
  assert.deepEqual(tuneFor(440), { baseNote: 57, fine: 0 }); // A-4
  const t = tuneFor(270); // a little under C#4
  assert.equal(t.baseNote, 49); assert.ok(t.fine < 0 && t.fine >= -64);
  const I = { ...t };
  assert.ok(Math.abs(rateFor(I, 12 * Math.log2(270 / 440) + 57) - 1) < 3e-4); // the clip's own pitch: original speed (fine is rounded to 1/128)
  assert.ok(Math.abs(rateFor(I, I.baseNote + 12) / rateFor(I, I.baseNote) - 2) < 1e-9); // an octave up: twice as fast
  assert.equal(tuneFor(5), null); // below C-0
});

test('fitToVideo: an instrument up to 2 ms past the video\'s readable end is fitted to it; further past, it doesn\'t fit', () => {
  // saved at 48 kHz, opened at 44.1 kHz: the video reads 1 ms shorter
  const s = { start: 0.1, end: 0.367, hit: 0.2, loopStart: 0.3, loopEnd: 0.367, where: 'song.txt:18' };
  assert.equal(fitToVideo(s, 0.367), s);
  assert.deepEqual(fitToVideo(s, 0.366), { ...s, end: 0.366, loopEnd: 0.366 });
  assert.equal(fitToVideo(s, 0.36), null);
});

test('fitFor: a loop is repitched to last a whole number of rows at C-4', () => {
  // 125 BPM, speed 6: a row is 0.12 s. A 1.85 s loop is nearest 16 rows (1.92 s): played a little slower, a bit lower
  const f = fitFor(1.85, 125, 6);
  assert.equal(f.rows, 16);
  const I = { baseNote: f.baseNote, fine: f.fine };
  assert.ok(Math.abs(1.85 / rateFor(I, 48) - 16 * 0.12) < 0.002); // at C-4 it lasts 16 rows
  assert.ok(f.baseNote * 128 + f.fine > 48 * 128);                 // slower: its own pitch sits above C-4
  assert.equal(fitFor(1.85, 125, 6, 8).rows, 8);                   // or as many rows as asked
  assert.equal(fitFor(1.92, 125, 6).baseNote, 48);                 // already 16 rows: C-4, nothing changes
  assert.equal(fitFor(1.92, 125, 6).fine, 0);
});

test('a video\'s readable end doesn\'t depend on the sample rate it was decoded at', () => {
  // 2.5 s of sound: exact at 48 kHz, one sample short once resampled to 44.1 kHz (as Chrome does)
  for (const [length, sampleRate] of [[120000, 48000], [110250, 44100], [110249, 44100]])
    assert.equal(makeVideo('v', [], new FakeAudioBuffer({ length, sampleRate })).dur, 2.5, `${length} at ${sampleRate}`);
  assert.equal(makeVideo('v', [], new FakeAudioBuffer({ length: 110200, sampleRate: 44100 })).dur, 2.498); // really shorter
});

test('amplify: the gain goes from start to end; past full scale it is cut off after each step, so the order counts', () => {
  const b = sound(1, () => 0.5), d = b.getChannelData(0);
  amplify(b, [{ a: 100, b: 0 }]);
  assert.equal(d[0], 0.5); assert.ok(Math.abs(d[d.length - 1]) < 1e-9); assert.ok(Math.abs(d[d.length >> 1] - 0.25) < 1e-3);
  const loud = sound(0.1, () => 0.8), quiet = sound(0.1, () => 0.8);
  amplify(loud, [{ a: 200, b: 200 }, { a: 50, b: 50 }]); // clipped at 1, then halved
  amplify(quiet, [{ a: 50, b: 50 }, { a: 200, b: 200 }]);
  assert.equal(loud.getChannelData(0)[10], 0.5);
  assert.ok(Math.abs(quiet.getChannelData(0)[10] - 0.8) < 1e-6);
  const neg = sound(0.1, () => -0.9); amplify(neg, [{ a: 200, b: 200 }]);
  assert.equal(neg.getChannelData(0)[0], -1);
});
