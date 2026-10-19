// A video = one loaded file (frames + audio), never modified. An instrument is a region of a video
// (start/end, non-destructive); several instruments can share one video. All instrument times
// (start, end, hit, loop points) are seconds on the video's timeline, rounded to ms.
import { FPS, clamp } from '../util.js';

// file = the original video file, kept as is for saving (demo videos have none)
export function makeVideo(name, frames, buffer, file = null) {
  return { name, file, frames, fps: FPS, buffer, peaks: computePeaks(buffer, 1200), dur: Math.floor(buffer.duration * 1000) / 1000 };
}
// the clip repeats (forward or pingpong) once it reaches the loop end
export const loops = I => I.loop !== 'none' && I.loopEnd > I.loopStart;
export const videoFrame = (V, t) => V.frames[clamp(Math.floor(t * V.fps), 0, V.frames.length - 1)];
export function makeInstrument(V, o) {
  const I = Object.assign({ name: '', start: 0, end: V.dur, hit: 0, baseNote: 48, fine: 0, vol: 64, reverb: 0,
    A: { v: 0, u: 't' }, D: { v: 0, u: 't' }, S: 64, R: { v: 5, u: 't' }, loop: 'none', loopStart: 0, loopEnd: V.dur, avOffset: 0, focus: [] }, o);
  I.video = V; I.A = { ...I.A }; I.D = { ...I.D }; I.R = { ...I.R }; I.focus = I.focus.map(k => ({ ...k }));
  sliceRegion(I);
  return I;
}
// cut the region's audio out of the video (the values themselves are checked by the validator)
export function sliceRegion(I) {
  const b = I.video.buffer, sr = b.sampleRate, i0 = Math.round(I.start * sr), i1 = Math.min(b.length, Math.max(i0 + 1, Math.round(I.end * sr)));
  I.buffer = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: i1 - i0, sampleRate: sr });
  for (let c = 0; c < b.numberOfChannels; c++) I.buffer.copyToChannel(b.getChannelData(c).subarray(i0, i1), c);
}
// I.buffer holds only the region, so playback positions are relative to I.start
export const hitPos = I => I.hit - I.start;
// fine: FT2's finetune, 1/128 of a semitone: the clip's own pitch is baseNote + fine / 128
export const rateFor = (I, pitch) => Math.pow(2, (pitch - I.baseNote - I.fine / 128) / 12);
export const frameAt = (I, pos) => videoFrame(I.video, I.start + pos + I.avOffset / 1000);
// where the picture looks at video time t ({ x, y }, 0–1 across the frame): along the focus path, the middle without one
export function focusAt(I, t) {
  const K = I.focus;
  if (!K.length) return { x: 0.5, y: 0.5 };
  if (t <= K[0].t) return K[0];
  for (let i = 1; i < K.length; i++) if (t < K[i].t) {
    const a = K[i - 1], b = K[i], f = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  return K[K.length - 1];
}
// ADSR times carry their unit: ticks follow the tempo (tick = 2.5 / BPM s), ms stay fixed
export const tickDur = bpm => 2.5 / bpm;
export const envSec = (e, td) => e.u === 'ms' ? e.v / 1000 : e.v * td;
export function computePeaks(buf, n) {
  const d = buf.getChannelData(0), out = new Float32Array(n * 2), step = d.length / n;
  for (let i = 0; i < n; i++) {
    let mn = 0, mx = 0;
    for (let j = Math.floor(i * step), e = Math.floor((i + 1) * step); j < e; j++) { const v = d[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
    out[i * 2] = mn; out[i * 2 + 1] = mx;
  }
  return out;
}
// Every video is peak-normalized when it is loaded (the file itself is untouched): quiet phone recordings
// come up to the same level. Per video, so instruments cut from one video keep their natural balance.
const NORM_PEAK = 0.891, NORM_MAX_GAIN = 15.85; // −1 dBFS, at most +24 dB (a near-silent video stays near silent)
export function normalizeVideoAudio(buf) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
  if (!peak) return 1;
  const g = Math.min(NORM_PEAK / peak, NORM_MAX_GAIN);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  return g;
}
// Onset detection: largest jump in short-window energy.
// the pitch of a sound in Hz, or null when it has none clear enough (a drum, noise, silence). YIN (de Cheveigné &
// Kawahara, 2002) on 30 ms windows over the 2 s after `from` (seconds: the hit), the median of the windows that have one
export function detectPitch(buf, from = 0) {
  const sr = buf.sampleRate, nc = buf.numberOfChannels, i1 = Math.min(buf.length, Math.round((from + 2) * sr));
  const d = new Float32Array(buf.length);
  for (let c = 0; c < nc; c++) { const x = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] += x[i] / nc; }
  const W = Math.round(sr * 0.03), minLag = Math.floor(sr / 1500), maxLag = Math.ceil(sr / 50), hop = Math.round(sr * 0.02);
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const dd = new Float32Array(maxLag + 2), found = [];
  const last = Math.min(d.length, i1 + W + maxLag + 1); // windows start in those 2 s and may read on past them
  for (let i0 = Math.round(from * sr); i0 + W + maxLag + 1 <= last; i0 += hop) {
    let e = 0; for (let i = i0; i < i0 + W; i++) e += d[i] * d[i];
    if (Math.sqrt(e / W) < peak * 0.05) continue; // too quiet to tell
    // the cumulative mean normalized difference; the first dip under 0.15 is the period
    let sum = 0; dd[0] = 1;
    for (let tau = 1; tau <= maxLag + 1; tau++) {
      let s = 0; for (let i = i0; i < i0 + W; i++) { const q = d[i] - d[i + tau]; s += q * q; }
      sum += s; dd[tau] = sum ? s * tau / sum : 1;
    }
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) if (dd[t] < 0.15) { while (t < maxLag && dd[t + 1] < dd[t]) t++; tau = t; break; }
    if (tau < 0) continue;
    const a = dd[tau - 1], b = dd[tau], c = dd[tau + 1], den = a - 2 * b + c; // between samples: a parabola through the dip
    found.push(sr / (den ? tau + (a - c) / (2 * den) : tau));
  }
  if (found.length < 3) return null;
  found.sort((x, y) => x - y);
  return found[found.length >> 1];
}
// a pitch in Hz → the base note and finetune that play the clip as itself (A-4 = 440 Hz); null outside C-0…B-7
export function tuneFor(hz) {
  const n = 57 + 12 * Math.log2(hz / 440), baseNote = Math.round(n);
  return baseNote >= 0 && baseNote <= 95 ? { baseNote, fine: Math.round((n - baseNote) * 128) } : null;
}

export function detectHit(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, win = Math.floor(sr * 0.01);
  const e = [];
  for (let i = 0; i + win <= d.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += d[j] * d[j]; e.push(Math.sqrt(s / win)); }
  let best = 0, bk = 0;
  for (let k = 1; k < e.length; k++) { const prev = Math.max(e[k - 1], k > 2 ? (e[k - 2] + e[k - 3]) / 2 : 0); const f = e[k] - prev; if (f > best) { best = f; bk = k; } }
  // refine inside the window: first sample over 30% of the window peak
  const i0 = Math.max(0, (bk - 1) * win), i1 = Math.min(d.length, (bk + 1) * win);
  let pk = 0; for (let j = i0; j < i1; j++) pk = Math.max(pk, Math.abs(d[j]));
  for (let j = i0; j < i1; j++) if (Math.abs(d[j]) > pk * 0.3) return j / sr;
  return bk * win / sr;
}
