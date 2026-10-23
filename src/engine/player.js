// The player: turns rows into voices, ahead of time, on the audio clock. It reads the song and never
// touches the screen: it is told what to play (startPlay) and tells whoever listens (onPlayer) when it
// starts or stops. Same code for playback and for the silent replay behind MCP get_state (sim channels).
import { FX, FXCH, FX_ALLOWED, MAX_CH, KEYOFF, clamp } from '../util.js';
import { song, instruments, nch } from '../core/song.js';
import { hitPos, rateFor } from '../core/instrument.js';
import { onChange } from '../core/commands.js';
import { ctx, master, ensureAudio, clearMutes, resetBusGains } from './audio.js';
import { Voice, SimVoice, voices, visEv, addVoice, killAllVoices } from './voice.js';

// uiQueue: { t, pat, ord, row } for every row scheduled, so the screen can follow what is heard
export const player = { playing: false, mode: 'song', ord: 0, row: 0, nextRowTime: 0, bpm: 125, speed: 6, chans: [], uiQueue: [], timer: 0, patternOf: null };
export const newChan = (_, ch) => ({ voice: null, inst: 0, pitch: 48, target: 48, vol: 64, pan: song.channels[ch].pan, vibPos: 0, vibSpeed: 0, vibDepth: 0, vibOff: 0, m3: 0, mA: 0, span: null, spanT: -Infinity });
const maxPreroll = () => Math.min(3, Math.max(0, ...instruments.filter(Boolean).map(hitPos)));

const listeners = [];
export const onPlayer = fn => listeners.push(fn);
const emit = () => listeners.forEach(fn => fn(player));

// mode 'song' plays the order (from order position fromOrd); mode 'pattern' loops one pattern: patternOf() says which
// (asked every row, so the pattern can change while it plays), the first time from row fromRow
export function startPlay(mode, patternOf = null, fromOrd = 0, fromRow = 0) {
  ensureAudio(); stopPlay();
  player.mode = mode; player.ord = 0; player.row = 0; player.patternOf = patternOf;
  player.bpm = song.bpm; player.speed = song.speed;
  player.chans = Array.from({ length: nch() }, newChan);
  if (mode === 'song' && fromOrd > 0) skipTo(Math.min(fromOrd, song.order.length - 1));
  if (mode === 'pattern') player.row = fromRow;
  // leave room for the longest pre-roll so even the very first note gets its wind-up
  player.nextRowTime = ctx.currentTime + 0.1 + maxPreroll() * 1.2;
  player.playing = true;
  player.timer = setInterval(schedule, 25);
  schedule();
  emit();
}
// starting mid-song: the earlier patterns are played silently, so tempo, instruments, volumes and effect
// memory are what they would be there; notes still ringing from before aren't heard
function skipTo(ord) {
  const sim = { mode: 'song', ord: 0, row: 0, bpm: player.bpm, speed: player.speed, nextRowTime: 0, chans: player.chans.map(C => ({ ...C, sim: true })) };
  while (sim.ord < ord) processRow(sim);
  player.ord = ord; player.bpm = sim.bpm; player.speed = sim.speed;
  player.chans = sim.chans.map(({ sim: _, ...C }) => ({ ...C, voice: null }));
}
export function stopPlay() {
  clearInterval(player.timer);
  player.playing = false; player.uiQueue = [];
  killAllVoices(); emit();
}
export function schedule() {
  const horizon = ctx.currentTime + 0.15 + maxPreroll() * 1.25;
  let guard = 0;
  while (player.nextRowTime < horizon && guard++ < 64) processRow(player);
}
// P = the player, or a silent copy used by get_state (its channels have sim: true → SimVoice, no audio).
// firstTickOnly: process just tick 0 of the row (the state "at" a row).
export function processRow(P, firstTickOnly = false) {
  const patIdx = P.mode === 'pattern' ? P.patternOf() : song.order[P.ord] ?? 0;
  const pat = song.patterns[patIdx] || song.patterns[0];
  if (P.row >= pat.rows.length) P.row = 0; // pattern shortened while playing
  const row = pat.rows[P.row];
  const t0 = P.nextRowTime;
  for (const c of row) if (c.f === FX.F && c.p > 0) { if (c.p < 32) P.speed = c.p; else P.bpm = c.p; }
  const td = 2.5 / P.bpm, spd = firstTickOnly ? 1 : P.speed;
  if (P === player) P.uiQueue.push({ t: t0, pat: patIdx, ord: P.ord, row: P.row });
  for (let ch = 0; ch < P.chans.length; ch++) processChannelRow(P.chans[ch], ch, row[ch], t0, td, spd);
  P.nextRowTime = t0 + td * spd;
  if (++P.row >= pat.rows.length) {
    P.row = 0;
    if (P.mode === 'song') P.ord = (P.ord + 1) % song.order.length;
  }
}
export function processChannelRow(C, ch, cell, t0, td, spd) {
  const f = FX_ALLOWED.includes(FXCH[cell.f]) ? cell.f : -1, p = cell.p, x = p >> 4, y = p & 15, isE = f === FX.E;
  const delay = isE && x === 0xD ? y : 0;
  const hasNote = cell.n >= 0 && cell.n < 96;
  if (f === 3 && p) C.m3 = p;
  if (f === 4) { if (x) C.vibSpeed = x; if (y) C.vibDepth = y; }
  if (f === FX.A && p) C.mA = p;
  for (let tick = 0; tick < spd; tick++) {
    const t = t0 + tick * td;
    if (f !== 4) C.vibOff = 0;
    if (tick === delay) {
      // volume first, so the pre-roll part already uses the right volume
      if (cell.i > 0) { C.inst = cell.i; if (instruments[C.inst]) C.vol = 64; } // full, under the instrument's own volume
      if (cell.v >= 0) C.vol = Math.min(64, cell.v);
      if (f === 8) C.pan = p;
      if (hasNote) {
        if (f === 3 && C.voice && C.voice.cutT == null) C.target = cell.n;
        else triggerNote(C, ch, cell.n, t, f === 9 ? p / 256 : null, td);
      } else if (cell.n === KEYOFF && C.voice) C.voice.release(t);
      if (f === FX.S && !C.sim) visEv[ch].push({ t, type: 'S', amt: p / 255 });
      if (f === FX.I && !C.sim) visEv[ch].push({ t, type: 'I', amt: p / 255 });
      if (f === FX.G && !C.sim) { C.span = p; C.spanT = t; C.voice?.spans?.push({ t, p }); }
    }
    if (tick > 0) {
      if (f === 3) { const s = C.m3 / 16; C.pitch = C.pitch < C.target ? Math.min(C.target, C.pitch + s) : Math.max(C.target, C.pitch - s); }
      if (f === 4) C.vibPos += C.vibSpeed;
      if (f === FX.A) { const u = C.mA >> 4, d = C.mA & 15; C.vol = u ? Math.min(64, C.vol + u) : Math.max(0, C.vol - d); }
      if (isE && x === 9 && y > 0 && tick % y === 0) retrigger(C, ch, t, td);
    }
    if (isE && x === 0xC && tick === y) C.vol = 0;
    if (f === 4) C.vibOff = Math.sin(C.vibPos * 2 * Math.PI / 64) * C.vibDepth / 8;
    C.pitch = clamp(C.pitch, 0, 119);
    if (C.voice) C.voice.update(t, C.vol / 64, rateFor(C.voice.I, C.pitch + C.vibOff), C.pan);
  }
}
function triggerNote(C, ch, note, t, offsetFrac, td) {
  const I = instruments[C.inst]; if (!I) return;
  C.pitch = C.target = note; C.vibPos = 0;
  // Gxy lasts until the channel goes silent: a note after silence starts at its own size again (unless the G came after it)
  const quiet = C.sim ? Infinity : C.voice ? C.voice.silentFrom() : -Infinity;
  if (C.sim || (quiet <= t && C.spanT < quiet)) C.span = null;
  const v = new (C.sim ? SimVoice : Voice)(I, ch, t, rateFor(I, note), { vol: C.vol / 64, pan: C.pan, note, td, startPos: offsetFrac != null ? offsetFrac * I.buffer.duration : null, freeT: C.voice && !C.sim ? C.voice.silentFrom() : null });
  if (C.voice) C.voice.cut(t);
  if (C.span != null && !C.sim) v.spans.push({ t: -Infinity, p: C.span });
  C.voice = v; if (!C.sim) addVoice(ch, v);
}
function retrigger(C, ch, t, td) {
  const old = C.voice; if (!old) return;
  const I = old.I;
  const v = new (C.sim ? SimVoice : Voice)(I, ch, t, rateFor(I, C.pitch), { vol: C.vol / 64, pan: C.pan, note: old.note, td, startPos: hitPos(I) });
  if (C.span != null && !C.sim) v.spans.push({ t: -Infinity, p: C.span });
  old.cut(t); C.voice = v; if (!C.sim) addVoice(ch, v);
}

// live keyboard preview: we can't see the future, so start right AT the hit point (no pre-roll)
const prevVoice = new Array(MAX_CH).fill(null);
export function previewNote(I, ch, note, fromStart = false) {
  ensureAudio();
  if (!I) return;
  const now = ctx.currentTime + 0.01;
  const v = new Voice(I, ch, now, rateFor(I, note), { vol: 1, pan: 128, note, startPos: fromStart ? 0 : hitPos(I) });
  v.advance(now + 30);
  if (prevVoice[ch]) prevVoice[ch].cut(now);
  prevVoice[ch] = v; addVoice(ch, v);
  return v;
}
// manual tune: a plain tone at `note` to tune the instrument against by ear (a new one cuts the last)
let refTone = null;
export function referenceTone(note, dur = 1.5) {
  ensureAudio();
  const now = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (note - 57) / 12);
  g.gain.setValueAtTime(0.25, now); g.gain.setValueAtTime(0.25, now + dur - 0.1); g.gain.linearRampToValueAtTime(0, now + dur);
  o.connect(g); g.connect(master); o.start(now); o.stop(now + dur);
  if (refTone) { refTone.g.gain.cancelScheduledValues(now); refTone.g.gain.setValueAtTime(0, now); refTone.o.stop(now); }
  refTone = { o, g };
}
// sync test: schedule hits with pre-roll + a metronome click exactly on each hit
export function syncTest(I, ch) {
  ensureAudio();
  if (!I) return;
  const gap = Math.max(0.7, hitPos(I) + 0.55);
  let T = ctx.currentTime + 0.15 + hitPos(I), prev = prevVoice[ch];
  for (let k = 0; k < 4; k++, T += gap) {
    const v = new Voice(I, ch, T, 1, { vol: 1, pan: 128, note: I.baseNote });
    v.advance(T + gap);
    if (prev) prev.cut(T);
    addVoice(ch, v); prev = v;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1760; g.gain.setValueAtTime(0.35, T); g.gain.exponentialRampToValueAtTime(0.001, T + 0.04);
    o.connect(g); g.connect(master); o.start(T); o.stop(T + 0.06);
  }
  prevVoice[ch] = prev;
}

// the engine follows the song: tempo edits apply while playing; a different channel list (or a whole new
// song) stops playback, since the player's channels are built when it starts
onChange(({ cmd, scope, how }) => {
  if (scope === 'song') { if (cmd.fields.includes('bpm')) player.bpm = song.bpm; if (cmd.fields.includes('speed')) player.speed = song.speed; }
  if (scope === 'channels' || scope === 'all') {
    if (how === 'open') clearMutes();
    stopPlay();
    for (let ch = 0; ch < MAX_CH; ch++) { voices[ch].forEach(v => v.kill && v.kill()); voices[ch].length = 0; visEv[ch].length = 0; }
    resetBusGains();
    player.bpm = song.bpm; player.speed = song.speed;
  }
});
