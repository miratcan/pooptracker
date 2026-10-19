// An instrument's sound: its pitch, found in the clip (Tune), and how a note plays it (base note + finetune).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioBuffer } from './fake-audio.js';
import { detectPitch, tuneFor, rateFor, fitToVideo, fitFor } from '../src/core/instrument.js';

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
