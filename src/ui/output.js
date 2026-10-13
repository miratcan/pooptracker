// The output: the 9:16 video, one tile per channel. It draws what the engine plays, at the time that is
// coming out of the speakers, so picture and sound match.
import { OUT_W, OUT_H, clamp, hex2, noteName } from '../util.js';
import { song, videos, nch } from '../core/song.js';
import { frameAt, focusAt } from '../core/instrument.js';
import { ctx, ensureAudio, isMuted, toggleMute } from '../engine/audio.js';
import { voices, voicesAt, visualFx } from '../engine/voice.js';
import { $, view } from './common.js';
import { pal, alpha } from './palette.js';

export const out = $('#out');
const og = out.getContext('2d');

// channels stack downwards in the 9:16 frame: 1–3 → one column (1, 2, 3 rows), 4–8 → two columns (2, 3, 4 rows)
export const grid = () => { const n = nch(), cols = n <= 3 ? 1 : 2; return { cols, rows: Math.ceil(n / cols) }; };
function tileRect(ch) { const { cols, rows } = grid(), w = OUT_W / cols, h = OUT_H / rows; return { x: (ch % cols) * w, y: Math.floor(ch / cols) * h, w, h }; }
// draw an uncropped frame into a box of any shape (like CSS object-fit: cover), cropping around the focus point
// (0–1 across the frame; the middle by default) as far as the frame's edges allow
export function drawCover(g, img, x, y, w, h, f) {
  const r = coverRect(img.width, img.height, w / h, f);
  g.drawImage(img, r.x, r.y, r.w, r.h, x, y, w, h);
}
// the part of an iw × ih frame that a box of this aspect (width / height) shows: in frame pixels
export function coverRect(iw, ih, aspect, f = { x: 0.5, y: 0.5 }) {
  const w = Math.min(iw, ih * aspect), h = w / aspect;
  return { x: clamp(f.x * iw - w / 2, 0, iw - w), y: clamp(f.y * ih - h / 2, 0, ih - h), w, h };
}

export function drawOutput(now) {
  og.fillStyle = pal.black; og.fillRect(0, 0, out.width, out.height);
  for (let ch = 0; ch < nch(); ch++) drawTile(ch, now);
}
function drawTile(ch, now) {
  const { x, y, w: TW, h: TH } = tileRect(ch);
  const list = voicesAt(ch, now), { punch, inv } = visualFx(ch, now);
  og.save();
  og.beginPath(); og.rect(x, y, TW, TH); og.clip();
  const zoom = 1 + punch * 0.35;
  const dw = TW * zoom, dh = TH * zoom;
  const dx = x + (TW - dw) / 2 + punch * 10 * Math.sin(now * 97), dy = y + (TH - dh) / 2 + punch * 8 * Math.cos(now * 83);
  const vis = list.filter(v => v.start <= now && (v.cutT == null || now < v.cutT));
  let lastHit = -1, label = '';
  vis.forEach(v => {
    const bright = Math.sqrt(clamp(v.gainAt(now), 0, 1));
    og.globalAlpha = 1;
    const pos = v.posAt(now);
    drawCover(og, frameAt(v.I, pos), dx, dy, dw, dh, focusAt(v.I, v.I.start + pos + v.I.avOffset / 1000));
    if (bright < 0.99) { og.globalAlpha = 1 - bright; og.fillStyle = pal.black; og.fillRect(x, y, TW, TH); }
    label = `${v.I.name} ${noteName(v.note)}`;
  });
  for (const v of list) if (v.hitT <= now && v.hitT > lastHit) lastHit = v.hitT;
  og.globalAlpha = 1;
  if (inv > 0.01) { og.globalCompositeOperation = 'difference'; og.fillStyle = alpha(pal.white, clamp(inv, 0, 1)); og.fillRect(x, y, TW, TH); og.globalCompositeOperation = 'source-over'; }
  if (isMuted(ch)) { og.fillStyle = alpha(pal.black, .75); og.fillRect(x, y, TW, TH); og.fillStyle = pal.red; og.font = 'bold 20px ui-monospace,Menlo,monospace'; og.fillText('MUTE', x + TW / 2 - 24, y + TH / 2 + 6); }
  // hit flash border
  const ha = lastHit >= 0 ? Math.exp(-(now - lastHit) / 0.09) : 0;
  og.strokeStyle = alpha(pal.acc, 0.15 + ha * 0.85); og.lineWidth = 1 + ha * 4; og.strokeRect(x + 1, y + 1, TW - 2, TH - 2);
  og.font = '11px ui-monospace,Menlo,monospace'; og.fillStyle = alpha(pal.black, .55); og.fillRect(x + 4, y + TH - 19, 8 + og.measureText(`${ch + 1} ${label}`).width, 15);
  og.fillStyle = pal.white; og.fillText(`${ch + 1} ${label}`, x + 8, y + TH - 8);
  og.restore();
}

// clicking a tile mutes its channel
export function muteChannel(ch) { if (ch < 0 || ch >= nch()) return; ensureAudio(); toggleMute(ch); view.patDirty = true; }
out.addEventListener('click', e => {
  const r = out.getBoundingClientRect();
  const { cols, rows } = grid();
  muteChannel(Math.floor((e.clientY - r.top) / r.height * rows) * cols + Math.floor((e.clientX - r.left) / r.width * cols));
});

// the 9:16 output takes the full height of its column; the column is as wide as that makes it
export function fitOut() { const h = $('#outBox').clientHeight, w = Math.floor(h * out.width / out.height); out.style.height = h + 'px'; out.style.width = w + 'px'; $('#outCard').style.width = w + 2 + 'px'; /* + the card's 1px borders */ }
export function sizeOut() { if (out.width !== OUT_W || out.height !== OUT_H) { out.width = OUT_W; out.height = OUT_H; fitOut(); } }
new ResizeObserver(fitOut).observe($('#outBox'));

export function updateStats(fps) {
  const nv = voices.reduce((a, l) => a + l.length, 0);
  const frames = videos.reduce((a, V) => a + V.frames.length, 0);
  const mb = videos.reduce((a, V) => a + V.frames.length * V.frames[0].width * V.frames[0].height, 0) * 4 / 1048576;
  const lat = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
  const v = view.vis, pos = v ? `order ${hex2(v.ord)} · pattern ${hex2(v.pat)} · row ${hex2(v.row)}` : 'stopped';
  $('#stats').textContent = `${fps.toFixed(0)} fps · ${nv} active voices · ${frames} frames cached (~${mb.toFixed(0)} MB) · audio latency ${lat.toFixed(0)} ms · ${pos}`;
}
