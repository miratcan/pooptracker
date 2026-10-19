// An instrument's sound: its pitch, found in the clip (Tune), and how a note plays it (base note + finetune).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioBuffer } from './fake-audio.js';
import { detectPitch, tuneFor, rateFor } from '../src/core/instrument.js';

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
