// The workbench: a kitchen counter for long videos. A video is put on it, a piece is marked (I / O) and cut
// (Enter); the piece goes into the pot as a new instrument, without re-encoding (../mp4cut.js). The bench itself
// is never saved: what isn't cut into an instrument is thrown away.
// Only the browser's video player reads the long video: its sound is never decoded whole (an hour would not fit).
import { MAX_SAMPLE_SEC, hex2, round3 } from '../util.js';
import { cutMp4, reader } from '../mp4cut.js';
import { importVideo } from '../io.js';
import { CmdError } from '../core/commands.js';
import { $, setStatus, showError, escHtml } from './common.js';
import { pal, alpha } from './palette.js';
import { coverRect } from './output.js';

const vid = $('#bVideo'), tl = $('#bTime'), g = tl.getContext('2d'), fc = $('#bFocus'), fg = fc.getContext('2d');
// focus: the point (0–1 across the frame) the new instrument's tiles keep in view; null = the middle
const bench = { file: null, in: null, out: null, busy: false, focus: null };
const STEP = 1, BIG = 10, FRAME = 1 / 30;

// 754.25 → '12:34.250', 3754.25 → '1:02:34.250'
const fmt = t => {
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = (t % 60).toFixed(3).padStart(6, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const dur = () => isFinite(vid.duration) ? vid.duration : 0;
const sel = () => bench.in != null && bench.out != null ? [Math.min(bench.in, bench.out), Math.max(bench.in, bench.out)] : null;

export function putOnBench(file) {
  bench.file = file; bench.in = bench.out = bench.focus = null;
  if (vid.src) URL.revokeObjectURL(vid.src);
  vid.src = URL.createObjectURL(file);
  $('#bEmpty').hidden = true; vid.hidden = false;
  $('#bName').textContent = file.name;
  vid.onloadedmetadata = () => { $('#bName').textContent = `${file.name} · ${fmt(dur())}`; fit(); drawFocus(); };
  vid.onerror = () => showError(`The browser can't play ${file.name}`);
  if (!/\.(mp4|m4v|mov)$/i.test(file.name)) setStatus(`<span class="err">⚠ ${escHtml(file.name)} can be watched but not cut: only MP4/MOV videos can (yt-dlp: <code>-f mp4</code>)</span>`);
  else setStatus(`On the bench: ${escHtml(file.name)}. <b>I</b> / <b>O</b> mark a piece, <b>Enter</b> cuts it into a new instrument.`);
  info();
}
function clear() {
  if (vid.src) { vid.pause(); URL.revokeObjectURL(vid.src); vid.removeAttribute('src'); vid.load(); }
  bench.file = null; bench.in = bench.out = bench.focus = null;
  vid.hidden = true; $('#bEmpty').hidden = false; $('#bName').textContent = '';
  info(); draw(); drawFocus();
}

function info() {
  const s = sel();
  $('#bSel').textContent = s ? `${fmt(s[0])} – ${fmt(s[1])}  (${(s[1] - s[0]).toFixed(3)} s)`
    : bench.in != null ? `${fmt(bench.in)} – …` : bench.out != null ? `… – ${fmt(bench.out)}` : 'no piece marked';
  $('#bSel').textContent += bench.focus ? `  · focus ${bench.focus.x.toFixed(2)}, ${bench.focus.y.toFixed(2)}` : '';
  $('#bCut').disabled = !s || bench.busy;
  $('#bPlaySel').disabled = !s;
}
const seek = t => { vid.currentTime = Math.max(0, Math.min(dur(), t)); follow(); draw(); };
const mark = (which, t = vid.currentTime) => { bench[which] = t; info(); draw(); };
const toggle = () => { if (!bench.file) return; vid.paused ? vid.play() : vid.pause(); };
// plays the marked piece once
let stopAt = null;
function playSel() {
  const s = sel(); if (!s) return;
  stopAt = s[1]; vid.currentTime = s[0]; vid.play();
}
vid.ontimeupdate = () => { if (stopAt != null && vid.currentTime >= stopAt) { vid.pause(); stopAt = null; } };
vid.onpause = () => { stopAt = null; };

async function cut() {
  const s = sel(), file = bench.file;
  if (!file) return showError('Put a video on the bench first: Load, or drop it here');
  if (!s) return showError('Mark the piece first: I at its start, O at its end');
  if (s[1] - s[0] > MAX_SAMPLE_SEC) return showError(`The piece is ${(s[1] - s[0]).toFixed(3)} s; an instrument can be at most ${MAX_SAMPLE_SEC} s`);
  if (bench.busy) return;
  bench.busy = true; info(); vid.pause();
  try {
    setStatus(`Cutting ${fmt(s[0])} – ${fmt(s[1])}…`);
    const piece = await cutMp4(reader(file), file.size, s[0], s[1]);
    const base = file.name.replace(/\.[^.]+$/, ''), at = fmt(s[0]).replace(/\.\d+$/, '');
    const out = new File([piece.bytes], `${base} ${at.replace(/:/g, '.')}.mp4`, { type: 'video/mp4' });
    const { idx, I } = await importVideo(out, t => setStatus(escHtml(t)), { start: piece.start, end: piece.end, name: `${base.slice(0, 15 - at.length)} ${at}`,
      focus: bench.focus ? [{ t: 0, ...bench.focus }] : [] });
    setStatus(`Cut ${fmt(s[0])} – ${fmt(s[1])} → instrument ${hex2(idx)} ${escHtml(I.name)} (${piece.bytes.length < 1048576 ? Math.ceil(piece.bytes.length / 1024) + ' KB' : (piece.bytes.length / 1048576).toFixed(1) + ' MB'}, not re-encoded; hit found at ${I.hit.toFixed(3)} s, check it)`);
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    showError(`Couldn't cut: ${err.message}`);
  } finally { bench.busy = false; info(); }
}

// ── the timeline: the marked piece and the play head over the part of the video in view (view.from…view.to).
// Zoomed in, a strip at the bottom shows where that part is in the whole video.
const view = { from: 0, to: 0 };
const MIN_SPAN = 0.5;
const span = () => view.to - view.from;
function setView(from, to) {
  const D = dur(), s = Math.max(Math.min(to - from, D), Math.min(MIN_SPAN, D));
  from = Math.max(0, Math.min(from, D - s));
  view.from = from; view.to = from + s; draw();
}
const fit = () => setView(0, dur());
// zoom by k (< 1 in, > 1 out) keeping the time t where it is on screen
const zoom = (k, t = vid.currentTime) => { const f = (t - view.from) / (span() || 1); const s = span() * k; setView(t - f * s, t - f * s + s); };
// while playing, the view turns the page when the play head leaves it
const follow = () => { const t = vid.currentTime; if (t < view.from || t > view.to) setView(t - span() * 0.1, t + span() * 0.9); };
const TICKS = [0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600];
function draw() {
  const w = tl.clientWidth, h = tl.clientHeight, k = devicePixelRatio || 1;
  if (tl.width !== Math.round(w * k) || tl.height !== Math.round(h * k)) { tl.width = Math.round(w * k); tl.height = Math.round(h * k); }
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = pal.well; g.fillRect(0, 0, w, h);
  const D = dur(); if (!D) return;
  if (!(view.to > view.from)) { view.from = 0; view.to = D; }
  const x = t => (t - view.from) / span() * w, zoomed = span() < D - 1e-6, bar = zoomed ? 4 : 0, hh = h - bar;
  // ticks no closer than 70 px, each with its time
  const every = TICKS.find(e => e / span() * w >= 70) ?? 3600;
  g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'bottom';
  for (let t = Math.ceil(view.from / every) * every; t <= view.to; t += every) {
    const px = Math.round(x(t));
    g.fillStyle = pal.faint; g.fillRect(px, hh - 6, 1, 6);
    g.fillStyle = pal.dim; g.fillText(fmt(t).replace(every >= 1 ? /\.\d+$/ : /\d\d$/, ''), px + 3, hh - 1);
  }
  const s = sel();
  if (s) { g.fillStyle = alpha(pal.acc, 0.25); g.fillRect(x(s[0]), 0, Math.max(1, x(s[1]) - x(s[0])), hh); }
  // the piece's ends, with a handle on top and bottom to drag them
  g.fillStyle = pal.acc;
  for (const t of [bench.in, bench.out]) if (t != null) {
    const px = Math.round(x(t));
    g.fillRect(px, 0, 1, hh); g.fillRect(px - 3, 0, 7, 7); g.fillRect(px - 3, hh - 7, 7, 7);
  }
  g.fillStyle = pal.acc2; g.fillRect(Math.round(x(vid.currentTime)) - 1, 0, 2, hh);
  g.fillStyle = pal.text; g.font = '11px ui-monospace, Menlo, monospace'; g.textBaseline = 'top';
  const now = fmt(vid.currentTime), tw = g.measureText(now).width, px = x(vid.currentTime);
  g.fillText(now, px + 4 + tw < w ? px + 4 : px - 4 - tw, 3);
  if (zoomed) {
    g.fillStyle = pal.panel2; g.fillRect(0, hh, w, bar);
    g.fillStyle = pal.dim; g.fillRect(view.from / D * w, hh, Math.max(2, span() / D * w), bar);
    g.fillStyle = pal.acc2; g.fillRect(vid.currentTime / D * w, hh, 1, bar);
  }
}
// click: go there · drag an end's handle: move it (the video shows that frame) · drag elsewhere: mark a new piece
// wheel / pinch: zoom around the pointer · sideways (or Shift+wheel): move along
const at = ev => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(dur(), view.from + (ev.clientX - r.left) / r.width * span())); };
// the end (in / out) under the pointer, if one is within a few pixels
function endAt(ev) {
  const r = tl.getBoundingClientRect(), px = t => r.left + (t - view.from) / span() * r.width;
  let best = null, d = 6;
  for (const k of ['in', 'out']) if (bench[k] != null && Math.abs(px(bench[k]) - ev.clientX) <= d) { best = k; d = Math.abs(px(bench[k]) - ev.clientX); }
  return best;
}
tl.onpointermove = ev => { if (dur()) tl.style.cursor = endAt(ev) ? 'ew-resize' : ''; };
tl.onpointerdown = e => {
  if (!dur()) return;
  const end = endAt(e), x0 = e.clientX, t0 = at(e); let dragging = false;
  tl.setPointerCapture(e.pointerId); vid.pause();
  const hover = tl.onpointermove;
  tl.onpointermove = ev => {
    if (!dragging && Math.abs(ev.clientX - x0) < 4) return;
    dragging = true;
    if (end) { bench[end] = at(ev); vid.currentTime = bench[end]; } else { bench.in = t0; bench.out = at(ev); }
    info(); draw();
  };
  tl.onpointerup = ev => {
    tl.onpointermove = hover; tl.onpointerup = null;
    if (!dragging) seek(at(ev)); else if (!end) seek(sel()[0]);
  };
};
tl.addEventListener('wheel', e => {
  if (!dur()) return;
  e.preventDefault();
  const sideways = e.shiftKey ? e.deltaY : e.deltaX;
  if (Math.abs(sideways) > Math.abs(e.shiftKey ? 0 : e.deltaY)) {
    const dt = sideways / tl.clientWidth * span(); setView(view.from + dt, view.to + dt);
  } else zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), at(e));
}, { passive: false });

// ── the focus: a click on the picture sets it. Over the picture: the point, and what a one-channel (9:16) tile sees
// where the picture is inside the video element (object-fit: contain), in CSS pixels
function picture() {
  const W = vid.clientWidth, H = vid.clientHeight, vw = vid.videoWidth, vh = vid.videoHeight;
  if (!vw || !vh) return null;
  const k = Math.min(W / vw, H / vh);
  return { x: vid.offsetLeft + (W - vw * k) / 2, y: vid.offsetTop + (H - vh * k) / 2, w: vw * k, h: vh * k, vw, vh };
}
function drawFocus() {
  const W = fc.clientWidth, H = fc.clientHeight, k = devicePixelRatio || 1;
  if (fc.width !== Math.round(W * k) || fc.height !== Math.round(H * k)) { fc.width = Math.round(W * k); fc.height = Math.round(H * k); }
  fg.setTransform(k, 0, 0, k, 0, 0); fg.clearRect(0, 0, W, H);
  const p = picture(); if (!p || !bench.focus || vid.hidden) return;
  const f = bench.focus, r = coverRect(p.vw, p.vh, 9 / 16, f), s = p.w / p.vw;
  const x0 = p.x + r.x * s, x1 = x0 + r.w * s, y0 = p.y + r.y * s, y1 = y0 + r.h * s, fx = p.x + f.x * p.w, fy = p.y + f.y * p.h;
  fg.fillStyle = alpha(pal.black, .5); fg.fillRect(p.x, p.y, x0 - p.x, p.h); fg.fillRect(x1, p.y, p.x + p.w - x1, p.h);
  fg.fillRect(x0, p.y, x1 - x0, y0 - p.y); fg.fillRect(x0, y1, x1 - x0, p.y + p.h - y1);
  fg.strokeStyle = pal.acc; fg.lineWidth = 2; fg.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
  fg.fillStyle = pal.acc; fg.fillRect(fx - 9, fy - 1, 18, 2); fg.fillRect(fx - 1, fy - 9, 2, 18);
}
const setFocus = f => { bench.focus = f; info(); drawFocus(); };
vid.onclick = e => {
  const p = picture(); if (!p) return;
  const b = vid.getBoundingClientRect(), x = (e.clientX - b.left + vid.offsetLeft - p.x) / p.w, y = (e.clientY - b.top + vid.offsetTop - p.y) / p.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  setFocus({ x: round3(x), y: round3(y) });
};
new ResizeObserver(drawFocus).observe(fc);

let raf = 0;
const loop = () => { raf = requestAnimationFrame(loop); if (!vid.paused) { follow(); draw(); } };
new ResizeObserver(draw).observe(tl);

$('#bBenchLoad').onclick = () => $('#bFile').click();
$('#bFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) putOnBench(f); };
$('#bClear').onclick = clear;
$('#bCut').onclick = cut;
$('#bPlaySel').onclick = playSel;

export const benchScreen = {
  name: 'bench', el: $('#bench'),
  keys: {
    Space: toggle, 'Shift+Space': playSel,
    ArrowLeft: () => seek(vid.currentTime - STEP), ArrowRight: () => seek(vid.currentTime + STEP),
    'Shift+ArrowLeft': () => seek(vid.currentTime - BIG), 'Shift+ArrowRight': () => seek(vid.currentTime + BIG),
    Comma: () => { vid.pause(); seek(vid.currentTime - FRAME); }, Period: () => { vid.pause(); seek(vid.currentTime + FRAME); },
    Home: () => seek(0), End: () => seek(dur()),
    KeyI: () => mark('in'), KeyO: () => mark('out'),
    Enter: cut, NumpadEnter: cut,
    Escape: () => { bench.in = bench.out = null; info(); draw(); },
    Backspace: () => setFocus(null), Delete: () => setFocus(null),
    Equal: () => zoom(0.5), Minus: () => zoom(2), Digit0: fit, NumpadAdd: () => zoom(0.5), NumpadSubtract: () => zoom(2),
  },
  enter() {
    $('#bScreenPat').classList.remove('cur'); $('#bScreenBench').classList.add('cur');
    raf = requestAnimationFrame(loop); draw(); drawFocus(); info();
    if (!bench.file) setStatus('The bench: put a long video on it (Load, or drop it here), mark a piece with <b>I</b> / <b>O</b>, <b>Enter</b> cuts it into a new instrument. <b>⌘/Ctrl+B</b> goes back.');
  },
  leave() {
    $('#bScreenBench').classList.remove('cur'); $('#bScreenPat').classList.add('cur');
    vid.pause(); cancelAnimationFrame(raf);
  },
};
