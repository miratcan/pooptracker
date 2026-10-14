// The audio graph: one bus per channel → master → limiter → speakers (and the recorder).
// Beside it, one reverb: each channel has a send bus (fed by the voices whose instrument has reverb) → the reverb → master.
// The engine never creates its own AudioContext: initAudio(ctx) is given one (a real AudioContext in the
// browser, a fake one in Node tests), so the same engine code runs in both.
import { MAX_CH } from '../util.js';
import { song } from '../core/song.js';

export let ctx = null, master = null, limiter = null, recDest = null, reverb = null;
export const chanBus = [], revBus = [];

export function initAudio(context) {
  ctx = context;
  master = ctx.createGain(); master.gain.value = 0.55;
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
  master.connect(limiter); limiter.connect(ctx.destination);
  if (ctx.createMediaStreamDestination) { recDest = ctx.createMediaStreamDestination(); limiter.connect(recDest); }
  reverb = ctx.createConvolver(); reverb.buffer = hallImpulse(ctx);
  const wet = ctx.createGain(); wet.gain.value = REV_WET; reverb.connect(wet); wet.connect(master);
  chanBus.length = revBus.length = 0;
  for (let i = 0; i < MAX_CH; i++) {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(master); chanBus.push(g);
    const r = ctx.createGain(); r.gain.value = 1; r.connect(reverb); revBus.push(r);
  }
}
// The one room every song plays in: a dark hall. Its impulse is made here, not loaded (no files, works offline):
// stereo noise that dies away over about 3 s and loses its highs as it goes, after a short pre-delay.
const REV_SECONDS = 3, REV_PREDELAY = 0.02, REV_WET = 2; // the normalized hall is quiet next to the dry sound
function hallImpulse(ctx) {
  const sr = ctx.sampleRate, n = Math.round(sr * REV_SECONDS), pre = Math.round(sr * REV_PREDELAY);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0, seed = c ? 0x9E3779B9 : 0x85EBCA6B;
    for (let i = pre; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0; // the same room every time
      const t = (i - pre) / sr, white = seed / 2 ** 31 - 1;
      const a = 0.6 * Math.exp(-t / 0.8) + 0.08; // a one-pole low-pass that closes over time…
      lp += (white - lp) * a;
      // …divided by what it takes from the level, so only the exponential decides how long the tail is (-60 dB at the end)
      d[i] = lp / Math.sqrt(a / (2 - a)) * Math.exp(-6.9 * t / REV_SECONDS) * Math.min(1, t / 0.005);
    }
  }
  return buf;
}
// browsers start audio suspended until the user interacts with the page
export function ensureAudio() { if (ctx.state === 'suspended') ctx.resume(); }
// The time (in AudioContext seconds) that is currently coming out of the speakers.
export function visualTime() {
  if (ctx.getOutputTimestamp) {
    const ts = ctx.getOutputTimestamp();
    if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
  }
  return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
}

// Mute belongs to a channel, not to a channel number: a channel keeps it when another one is deleted
// before it (and when that delete is undone).
const mutedChannels = new Set();
export const isMuted = ch => mutedChannels.has(song.channels[ch]);
export function toggleMute(ch) {
  const C = song.channels[ch]; if (!C) return;
  if (mutedChannels.has(C)) mutedChannels.delete(C); else mutedChannels.add(C);
  for (const b of [chanBus, revBus]) b[ch].gain.setTargetAtTime(isMuted(ch) ? 0 : 1, ctx.currentTime, 0.01);
}
export const clearMutes = () => mutedChannels.clear();
// after the channel list changed, every bus gets its channel's mute again
export function resetBusGains() { for (let ch = 0; ch < MAX_CH; ch++) for (const b of [chanBus, revBus]) if (b[ch]) b[ch].gain.value = isMuted(ch) ? 0 : 1; }
