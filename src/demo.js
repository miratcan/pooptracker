// The demo that greets a new visitor: three drum instruments drawn and synthesized in code (no video files),
// and a basic 4/4 beat. It is opened like a song file at startup.
import { TILE_W, TILE_H, FPS, FX, parseNote } from './util.js';
import { newPattern } from './core/song.js';
import { makeVideo, makeInstrument } from './core/instrument.js';
import { replaceSong } from './core/commands.js';

function normalize(a, peak = 0.9) { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; }
// drumstick: (x,y) = tip, ang = direction from tip to the butt end
function drawStick(g, x, y, ang, len = 150) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.fillStyle = '#e8c48a'; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(4, -2.5); g.lineTo(len, -5); g.lineTo(len, 5); g.lineTo(4, 2.5); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(3, 0, 5, 3.5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#e0a77a'; g.beginPath(); g.ellipse(len - 18, 0, 16, 12, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}
const ease = k => k * k;                          // accelerate into the hit
const outEase = k => 1 - (1 - k) * (1 - k);       // decelerate after the hit
const W = TILE_W, H = TILE_H;
const DEMOS = [
  { name: 'Kick', dur: 1.2, hit: 0.25, R: { v: 5, u: 't' },
    synth(sr, L, hit) {
      const o = new Float32Array(L); let ph = 0;
      for (let i = Math.floor(hit * sr); i < L; i++) {
        const x = i / sr - hit;
        ph += 2 * Math.PI * (48 + 110 * Math.exp(-x / 0.035)) / sr;
        o[i] = Math.sin(ph) * Math.exp(-x / 0.35) + (Math.random() * 2 - 1) * Math.exp(-x / 0.004) * 0.4;
      }
      return normalize(o);
    },
    draw(g, t, hit) {
      const x = t - hit, fl = x > 0 ? Math.exp(-x / 0.1) : 0;
      g.fillStyle = '#140808'; g.fillRect(0, 0, W, H);
      // bass drum front head
      const sc = 1 + fl * 0.04, cx = W * 0.4, cy = H * 0.52, r = 78 * sc;
      g.fillStyle = '#5a1010'; g.beginPath(); g.arc(cx, cy, r + 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgb(${225 + 30 * fl},${215 + 40 * fl},${200 + 55 * fl})`; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(120,20,20,${0.4 + fl * 0.6})`; g.lineWidth = 3;
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(cx, cy, r * (k / 3.5 + fl * 0.1), 0, Math.PI * 2); g.stroke(); }
      // pedal beater swinging from the right into the head
      let a; // 0 = touching head, 1 = pulled back
      if (t < hit) a = 1 - ease(t / hit); else a = Math.min(1, outEase(Math.min(1, x / 0.3)) * 0.8);
      const px = W * 0.88, py = H * 0.95, ang = -Math.PI / 2 - 0.55 + a * 0.9, len = 115;
      const bx = px + Math.cos(ang) * len, by = py + Math.sin(ang) * len;
      g.strokeStyle = '#bbb'; g.lineWidth = 4; g.beginPath(); g.moveTo(px, py); g.lineTo(bx, by); g.stroke();
      g.fillStyle = '#eee'; g.beginPath(); g.arc(bx, by, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#555'; g.fillRect(px - 20, py - 6, 40, 10);
      g.fillStyle = `rgba(255,220,200,${fl})`; g.font = 'bold 26px sans-serif'; g.fillText('KICK', 12, 32);
    } },
  { name: 'Snare', dur: 1.0, hit: 0.20, R: { v: 5, u: 't' },
    synth(sr, L, hit) {
      const o = new Float32Array(L); let lp = 0;
      for (let i = Math.floor(hit * sr); i < L; i++) {
        const x = i / sr - hit, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.5;
        o[i] = lp * Math.exp(-x / 0.16) * 0.8 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x / 0.06) * 0.7;
      }
      return normalize(o);
    },
    draw(g, t, hit) {
      const x = t - hit, fl = x > 0 ? Math.exp(-x / 0.08) : 0;
      g.fillStyle = '#081420'; g.fillRect(0, 0, W, H);
      const cx = W * 0.45, top = H * 0.62, sh = x > 0 ? Math.sin(x * 90) * Math.exp(-x / 0.1) * 2 : 0;
      g.fillStyle = '#9aa7b5'; g.fillRect(cx - 90, top + sh, 180, 46);
      g.strokeStyle = '#d0d8e0'; g.lineWidth = 2;
      for (let k = 0; k < 7; k++) { const lx = cx - 80 + k * 27; g.beginPath(); g.moveTo(lx, top + sh); g.lineTo(lx, top + 46 + sh); g.stroke(); }
      g.fillStyle = `rgb(${220 + 35 * fl},${225 + 30 * fl},${230 + 25 * fl})`; g.beginPath(); g.ellipse(cx, top + sh, 90, 16, 0, 0, Math.PI * 2); g.fill();
      if (fl > 0.02) { g.fillStyle = `rgba(255,255,255,${fl * 0.8})`; g.beginPath(); g.ellipse(cx + 10, top + sh, 30 + 40 * (1 - fl), 6 + 6 * (1 - fl), 0, 0, Math.PI * 2); g.fill(); }
      // stick comes down from above
      const tx = cx + 10, ty = top - 2; let a;
      if (t < hit) a = 1 - ease(t / hit); else a = outEase(Math.min(1, x / 0.25)) * 0.7;
      drawStick(g, tx + a * 30, ty - a * 105, -0.35 - a * 0.5);
      g.fillStyle = `rgba(200,230,255,${fl})`; g.font = 'bold 26px sans-serif'; g.fillText('SNARE', 12, 32);
    } },
  { name: 'HiHat', dur: 0.7, hit: 0.12, R: { v: 3, u: 't' }, vol: 0x30,
    synth(sr, L, hit) {
      const o = new Float32Array(L); let lp = 0;
      for (let i = Math.floor(hit * sr); i < L; i++) {
        const x = i / sr - hit, n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.7; // subtract lowpassed → highpass
        o[i] = (n - lp) * Math.exp(-x / 0.045);
      }
      return normalize(o);
    },
    draw(g, t, hit) {
      const x = t - hit, fl = x > 0 ? Math.exp(-x / 0.06) : 0;
      g.fillStyle = '#121208'; g.fillRect(0, 0, W, H);
      const cx = W * 0.45, cy = H * 0.55, wob = x > 0 ? Math.sin(x * 70) * Math.exp(-x / 0.12) * 0.06 : 0;
      g.fillStyle = '#666'; g.fillRect(cx - 2, cy, 4, H);
      for (const dy of [0, 6]) {
        g.save(); g.translate(cx, cy + dy); g.rotate(wob);
        const gr = g.createLinearGradient(-95, 0, 95, 0); gr.addColorStop(0, '#7a5c10'); gr.addColorStop(0.5, `rgb(${235 + 20 * fl},${200 + 55 * fl},${90 + 150 * fl})`); gr.addColorStop(1, '#7a5c10');
        g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 95, 7, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      const tx = cx + 55, ty = cy - 6; let a;
      if (t < hit) a = 1 - ease(t / hit); else a = outEase(Math.min(1, x / 0.15)) * 0.5;
      drawStick(g, tx + a * 20, ty - a * 55, -0.6 - a * 0.3);
      g.fillStyle = `rgba(255,245,200,${fl})`; g.font = 'bold 26px sans-serif'; g.fillText('HIHAT', 12, 32);
    } },
];
async function genInstrument(def, sr) {
  const L = Math.floor(def.dur * sr);
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: L, sampleRate: sr });
  buffer.copyToChannel(def.synth(sr, L, def.hit), 0);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), frames = [];
  for (let i = 0, n = Math.floor(def.dur * FPS); i < n; i++) { g.save(); def.draw(g, i / FPS, def.hit); g.restore(); frames.push(await createImageBitmap(cv)); }
  const { synth, draw, amp, dur, ...rest } = def;
  const V = makeVideo(def.name, frames, buffer);
  return makeInstrument(V, { ...rest, loopStart: def.hit });
}

function S(P, row, ch, note, inst, vol, fx) {
  const c = P.rows[row][ch];
  if (note) c.n = parseNote(note);
  if (inst) c.i = inst;
  if (vol != null) c.v = vol;
  if (fx) { c.f = FX[fx[0]]; c.p = parseInt(fx.slice(1), 16); }
}
function demoPattern() {
  // 16 rows = 1 bar, 4 rows = 1 beat (speed 6 @ 125 BPM)
  const P = newPattern(16);
  const KICK = 1, SNARE = 2, HAT = 3;
  [0, 8].forEach(r => S(P, r, 0, 'C-4', KICK));            // beats 1 & 3
  [4, 12].forEach(r => S(P, r, 1, 'C-4', SNARE));          // beats 2 & 4
  for (let r = 0; r < 16; r += 2) S(P, r, 2, 'C-4', HAT);  // eighth notes
  return P;
}

export async function loadDemo(sampleRate) {
  const insts = [];
  for (const d of DEMOS) insts.push(await genInstrument(d, sampleRate));
  replaceSong({ patterns: [demoPattern()], order: [0] }, insts, insts.map(I => I.video));
}
