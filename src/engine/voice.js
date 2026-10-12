// A voice = one triggered note on one channel. Audio and video read the SAME
// piecewise-linear position function (segs), so they cannot drift apart [ZEN-IN-SYNC].
import { MAX_CH, lerp } from '../util.js';
import { song } from '../core/song.js';
import { hitPos, tickDur, envSec } from '../core/instrument.js';
import { ctx, chanBus } from './audio.js';

export const voices = Array.from({ length: MAX_CH }, () => []);
export const visEv = Array.from({ length: MAX_CH }, () => []);
export class Voice {
  constructor(I, ch, hitT, rate, o) {
    this.I = I; this.ch = ch; this.hitT = hitT; this.rate = rate; this.vol = o.vol; this.panV = o.pan; this.note = o.note ?? -1;
    // envelope in seconds, fixed at trigger time with the tempo of that moment
    const td = o.td ?? tickDur(song.bpm);
    this.eA = envSec(I.A, td); this.eD = envSec(I.D, td); this.eS = I.S; this.eR = envSec(I.R, td);
    const preroll = o.startPos == null;
    // THE pre-roll math: start the sample early so its hit point lands exactly on hitT.
    // The pre-roll only uses free time: it never starts before the channel's previous note goes silent (o.freeT).
    let start = preroll ? Math.min(hitT, Math.max(hitT - hitPos(I) / rate, o.freeT ?? -Infinity)) : hitT;
    // max(0): with a full pre-roll this is 0 up to rounding, and a negative offset makes start() throw
    let pos = preroll ? Math.max(0, hitPos(I) - (hitT - start) * rate) : o.startPos;
    const now = ctx.currentTime + 0.01;
    if (start < now) { pos += (now - start) * rate; start = now; } // too late: skip into the sample instead
    this.start = start;
    this.segs = [{ t: start, pos, rate }];
    this.pts = []; this.relT = null; this.cutT = null; this.started = false;
    const src = ctx.createBufferSource();
    src.buffer = I.buffer; src.playbackRate.value = rate;
    if (I.loop && I.loopEnd > I.loopStart) { src.loop = true; src.loopStart = I.loopStart - I.start; src.loopEnd = I.loopEnd - I.start; }
    this.g = ctx.createGain(); this.g.gain.value = 0;
    this.pn = ctx.createStereoPanner(); this.pn.pan.value = (o.pan - 128) / 128;
    src.connect(this.g); this.g.connect(this.pn); this.pn.connect(chanBus[ch]);
    this.src = src;
    if (pos < I.buffer.duration) { src.start(start, pos); this.started = true; }
    src.onended = () => { this.done = true; try { src.disconnect(); this.g.disconnect(); this.pn.disconnect(); } catch (e) {} };
    const h = Math.max(hitT, start);
    this.pt(start, this.env(start) * this.vol);
    this.advance(h);
    this.pt(h, this.env(h) * this.vol);
  }
  envRaw(x) { const { eA, eD, eS } = this; if (x < 0) return 0; if (eA > 0 && x < eA) return x / eA; x -= eA; if (eD > 0 && x < eD) return 1 - (1 - eS) * x / eD; return eS; }
  env(t) {
    if (this.relT != null && t > this.relT) {
      const er = this.envRaw(this.relT - this.start);
      return this.eR <= 0 ? 0 : Math.max(0, er * (1 - (t - this.relT) / this.eR));
    }
    return this.envRaw(t - this.start);
  }
  pt(t, v) {
    if (this.pts.length) { const last = this.pts[this.pts.length - 1]; if (t < last.t) t = last.t; this.g.gain.linearRampToValueAtTime(v, t); }
    else this.g.gain.setValueAtTime(v, t);
    this.pts.push({ t, v });
  }
  // add exact envelope breakpoints between the last automation point and t
  advance(t) {
    const last = this.pts[this.pts.length - 1].t;
    const bps = [this.start + this.eA, this.start + this.eA + this.eD];
    if (this.relT != null) bps.push(this.relT + this.eR);
    bps.filter(b => b > last && b < t).sort((a, b) => a - b).forEach(b => this.pt(b, this.env(b) * this.vol));
  }
  update(t, vol, rate, pan) {
    if (this.cutT != null) return;
    t = Math.max(t, this.start);
    this.advance(t); this.vol = vol; this.pt(t, this.env(t) * vol);
    if (rate !== this.rate) this.setRate(t, rate);
    if (pan !== this.panV) { this.pn.pan.setValueAtTime((pan - 128) / 128, t); this.panV = pan; }
  }
  setRate(t, r) {
    const s = this.segs[this.segs.length - 1];
    this.segs.push({ t, pos: s.pos + (t - s.t) * s.rate, rate: r });
    this.src.playbackRate.setValueAtTime(r, t);
    this.rate = r;
  }
  release(t) {
    if (this.relT != null || this.cutT != null) return;
    t = Math.max(t, this.start);
    this.advance(t); this.pt(t, this.env(t) * this.vol); this.relT = t;
  }
  cut(t, fade = 0.006) {
    if (this.cutT != null) return;
    t = Math.max(t, this.start);
    this.advance(t); this.pt(t, this.env(t) * this.vol); this.pt(t + fade, 0);
    if (this.started) try { this.src.stop(t + fade + 0.005); } catch (e) {}
    this.cutT = t + fade;
  }
  // when this voice goes silent, as scheduled so far (later rows can only end it earlier)
  silentFrom() {
    let t = this.cutT ?? Infinity, envEnd = this.eS === 0 ? this.start + this.eA + this.eD : Infinity;
    if (this.relT != null && this.relT < envEnd) envEnd = this.relT + this.eR;
    t = Math.min(t, envEnd);
    const I = this.I;
    if (!(I.loop && I.loopEnd > I.loopStart)) { const s = this.segs[this.segs.length - 1]; t = Math.min(t, s.t + Math.max(0, I.buffer.duration - s.pos) / s.rate); }
    return t;
  }
  kill() { try { this.started && this.src.stop(); } catch (e) {} try { this.src.disconnect(); this.g.disconnect(); this.pn.disconnect(); } catch (e) {} this.cutT = 0; }
  posAt(t) {
    let s = this.segs[0];
    for (let i = this.segs.length - 1; i >= 0; i--) if (this.segs[i].t <= t) { s = this.segs[i]; break; }
    let pos = s.pos + Math.max(0, t - s.t) * s.rate;
    const I = this.I, L = I.loopEnd - I.loopStart, ls = I.loopStart - I.start;
    if (I.loop && L > 0 && pos > ls + L) pos = ls + ((pos - ls) % L);
    return pos;
  }
  gainAt(t) {
    const p = this.pts;
    if (t <= p[0].t) return p[0].v;
    for (let i = p.length - 1; i >= 0; i--) {
      if (p[i].t <= t) { const n = p[i + 1]; if (!n || n.t === p[i].t) return p[i].v; return lerp(p[i].v, n.v, (t - p[i].t) / (n.t - p[i].t)); }
    }
    return p[p.length - 1].v;
  }
}
// the channel's voices at time `now` (for drawing); finished ones are dropped (and stopped) here
export function voicesAt(ch, now) {
  const list = voices[ch];
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    if ((v.cutT != null && v.cutT < now - 0.05) || (v.done && i < list.length - 1) || list.length > 8) { if (v.cutT == null) v.kill(); list.splice(i, 1); }
  }
  return list;
}
// the channel's video effects (Sxx punch, Ixx invert) at time `now`; older than 2 s are dropped
export function visualFx(ch, now) {
  const ev = visEv[ch];
  while (ev.length && ev[0].t < now - 2) ev.shift();
  let punch = 0, inv = 0;
  for (const e of ev) {
    if (e.t > now) break;
    const a = now - e.t;
    if (e.type === 'S') punch = e.amt * Math.exp(-a / 0.12);
    if (e.type === 'I') inv = e.amt * Math.exp(-a / 0.18);
  }
  return { punch, inv };
}
export function addVoice(ch, v) { voices[ch].push(v); voices[ch].sort((a, b) => a.start - b.start); }
export function killAllVoices() { voices.forEach(list => { list.forEach(v => v.kill()); list.length = 0; }); visEv.forEach(l => l.length = 0); }
// A voice without audio, for get_state: only tracks whether it still sounds (cut, released, sample ended).
export class SimVoice {
  constructor(I, ch, hitT, rate, o) {
    this.I = I; this.note = o.note ?? -1; this.eR = envSec(I.R, o.td ?? tickDur(song.bpm));
    this.segs = [{ t: hitT, pos: o.startPos ?? hitPos(I), rate }]; this.relT = null; this.cutT = null;
  }
  update(t, vol, rate) { const s = this.segs[this.segs.length - 1]; if (rate !== s.rate) this.segs.push({ t, pos: s.pos + (t - s.t) * s.rate, rate }); }
  release(t) { if (this.relT == null && this.cutT == null) this.relT = t; }
  cut(t) { if (this.cutT == null) this.cutT = t; }
  alive(t) {
    if (this.cutT != null && t >= this.cutT) return false;
    if (this.relT != null && t >= this.relT + this.eR) return false;
    if (this.I.loop) return true;
    let s = this.segs[0]; for (const x of this.segs) if (x.t <= t) s = x;
    return s.pos + Math.max(0, t - s.t) * s.rate < this.I.buffer.duration;
  }
  clone() { const v = Object.assign(Object.create(SimVoice.prototype), this); v.segs = this.segs.map(x => ({ ...x })); return v; }
}
