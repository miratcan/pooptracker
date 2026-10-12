// The audio graph: one bus per channel → master → limiter → speakers (and the recorder).
// The engine never creates its own AudioContext: initAudio(ctx) is given one (a real AudioContext in the
// browser, a fake one in Node tests), so the same engine code runs in both.
import { MAX_CH } from '../util.js';
import { song } from '../core/song.js';

export let ctx = null, master = null, limiter = null, recDest = null;
export const chanBus = [];

export function initAudio(context) {
  ctx = context;
  master = ctx.createGain(); master.gain.value = 0.55;
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
  master.connect(limiter); limiter.connect(ctx.destination);
  if (ctx.createMediaStreamDestination) { recDest = ctx.createMediaStreamDestination(); limiter.connect(recDest); }
  chanBus.length = 0;
  for (let i = 0; i < MAX_CH; i++) { const g = ctx.createGain(); g.gain.value = 1; g.connect(master); chanBus.push(g); }
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
  chanBus[ch].gain.setTargetAtTime(isMuted(ch) ? 0 : 1, ctx.currentTime, 0.01);
}
export const clearMutes = () => mutedChannels.clear();
// after the channel list changed, every bus gets its channel's mute again
export function resetBusGains() { for (let ch = 0; ch < MAX_CH; ch++) if (chanBus[ch]) chanBus[ch].gain.value = isMuted(ch) ? 0 : 1; }
