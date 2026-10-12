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
  const I = Object.assign({ name: '', start: 0, end: V.dur, hit: 0, baseNote: 48, vol: 64,
    A: { v: 0, u: 't' }, D: { v: 0, u: 't' }, S: 1, R: { v: 5, u: 't' }, loop: 'none', loopStart: 0, loopEnd: V.dur, avOffset: 0 }, o);
  I.video = V; I.A = { ...I.A }; I.D = { ...I.D }; I.R = { ...I.R };
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
export const rateFor = (I, pitch) => Math.pow(2, (pitch - I.baseNote) / 12);
export const frameAt = (I, pos) => videoFrame(I.video, I.start + pos + I.avOffset / 1000);
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
