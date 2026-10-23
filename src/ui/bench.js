// The workbench: a kitchen counter for long videos. A video is put on it, a piece is marked (I / O) and cut
// (Enter); the piece goes into the pot as a new instrument, or becomes the selected instrument's video (Shift+Enter, as
// Load does: it keeps how the instrument sounds), without re-encoding (../mp4cut.js). The bench itself
// is never saved: what isn't cut into an instrument is thrown away. Which video is on it is core state (song.js bench),
// changed by commands like the song, so Ctrl+Z brings back a video that was trimmed or cleared away.
// Only the browser's video player plays the long video: its sound is never decoded whole (an hour would not fit). For
// the timeline's waveform it is decoded a minute at a time, in the background, and only each minute's peaks are kept.
import { MAX_SAMPLE_SEC, hex2, round3 } from '../util.js';
import { cutVideo, soundCutter, reader } from '../mp4cut.js';
import { importVideo, replaceVideo, NO_SOUND } from '../io.js';
import { instruments, bench } from '../core/song.js';
import { CmdError, exec, onChange, putOnBench as putCmd, trimBench, clearBench } from '../core/commands.js';
import { $, ed, setStatus, showError, escHtml } from './common.js';
import { pal, alpha } from './palette.js';
import { coverRect } from './output.js';
import { ctx, ensureAudio } from '../engine/audio.js';

const vid = $('#bVideo'), tl = $('#bTime'), g = tl.getContext('2d'), fc = $('#bFocus'), fg = fc.getContext('2d');
// bench.focus: the point (0–1 across the frame) the new instrument's tiles keep in view; null = the middle
let busy = false; // cutting or trimming
// the waveform: the loudest and the quietest sample of every 1/PPS second (NaN = not read yet); top: the loudest of
// all so far, which fills the height (as an instrument's sound is normalized)
const PPS = 100, WINDOW = 60;
const peaks = { min: null, max: null, top: 0, job: 0, filled: 0 }; // filled: how far it has been read (redraws the picture)
const peaksOf = new WeakMap(); // file → its finished peaks: an undone trim brings its waveform back at once
// file → a promise of its sound cutter (mp4cut soundCutter): the waveform and the loop read only the sound, indexed once
const cutters = new WeakMap();
const soundOf = file => { if (!cutters.has(file)) cutters.set(file, soundCutter(reader(file), file.size)); return cutters.get(file); };
const STEP = 1, BIG = 10, FRAME = 1 / 30;

// 754.25 → '12:34.250', 3754.25 → '1:02:34.250'
const fmt = t => {
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = (t % 60).toFixed(3).padStart(6, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const dur = () => isFinite(vid.duration) ? vid.duration : 0;
const sel = () => bench.in != null && bench.out != null ? [Math.min(bench.in, bench.out), Math.max(bench.in, bench.out)] : null;

export function putOnBench(file) {
  if (!exec(() => putCmd(file))) return;
  if (!/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)) setStatus(`<span class="err">⚠ ${escHtml(file.name)} can be watched but not cut: only MP4, MOV, WebM and MKV videos can</span>`);
  else setStatus(`On the bench: ${escHtml(file.name)}. <b>I</b> / <b>O</b> mark a piece, <b>Enter</b> cuts it into a new instrument, <b>Shift+Enter</b> into the selected one.`);
}
const clear = () => exec(clearBench);

// the player follows the video on the bench: put on, trimmed, cleared, or any of that undone / redone
let shown = null;
function show() {
  if (bench.file !== shown) {
    const file = shown = bench.file;
    if (vid.src) { vid.pause(); URL.revokeObjectURL(vid.src); vid.removeAttribute('src'); vid.load(); }
    peaks.job++; peaks.min = peaks.max = null;
    vid.hidden = !file; $('#bEmpty').hidden = !!file; $('#bName').textContent = file ? file.name : '';
    if (file) {
      vid.onloadedmetadata = () => { $('#bName').textContent = `${file.name} · ${fmt(dur())}`; fit(); drawFocus(); readPeaks(file, dur()); };
      vid.onerror = () => showError(`The browser can't play ${file.name}`);
      vid.src = URL.createObjectURL(file);
    }
  }
  info(); draw(); drawFocus();
}
onChange(({ scope }) => { if (scope === 'bench') show(); });

// a minute of sound at a time is cut out (only the sound: MP4, MOV, WebM and MKV all work), decoded and thrown away once
// its peaks are written; a video that can't be cut shows no waveform. A new video stops the reading.
async function readPeaks(file, D) {
  const job = ++peaks.job;
  if (peaksOf.has(file)) { Object.assign(peaks, peaksOf.get(file), { filled: Infinity }); draw(); return; }
  const n = Math.ceil(D * PPS), ctx = new OfflineAudioContext(1, 1, 44100);
  peaks.min = new Float32Array(n).fill(NaN); peaks.max = new Float32Array(n).fill(NaN); peaks.top = 0;
  for (let t0 = 0; t0 < D; t0 += WINDOW) {
    let buf;
    try { buf = await ctx.decodeAudioData((await (await soundOf(file))(t0, Math.min(D, t0 + WINDOW))).bytes.buffer); }
    catch (err) {
      if (t0 > 0) continue;
      console.warn('no waveform:', err.message);
      if (job === peaks.job) setStatus(`<span class="err">⚠ This browser can't read the sound of ${escHtml(file.name)} (in Safari: WebM sound, Opus): no waveform, and the pieces cut from it will be silent</span>`);
      return;
    }
    if (job !== peaks.job) return;
    const chans = [...Array(buf.numberOfChannels).keys()].map(c => buf.getChannelData(c)), per = buf.sampleRate / PPS;
    for (let i = 0, b = Math.round(t0 * PPS); i < buf.length / per && b < n; i++, b++) {
      let lo = 0, hi = 0;
      for (const d of chans) for (let s = Math.floor(i * per), e = Math.min(d.length, Math.floor((i + 1) * per)); s < e; s++) { if (d[s] < lo) lo = d[s]; if (d[s] > hi) hi = d[s]; }
      peaks.min[b] = lo; peaks.max[b] = hi; peaks.top = Math.max(peaks.top, hi, -lo);
    }
    peaks.filled = t0; draw();
  }
  peaksOf.set(file, { min: peaks.min, max: peaks.max, top: peaks.top });
}

function info() {
  const s = sel();
  $('#bSel').textContent = s ? `${fmt(s[0])} – ${fmt(s[1])}  (${(s[1] - s[0]).toFixed(3)} s)`
    : bench.in != null ? `${fmt(bench.in)} – …` : bench.out != null ? `… – ${fmt(bench.out)}` : 'no piece marked';
  $('#bSel').textContent += bench.focus ? `  · focus ${bench.focus.x.toFixed(2)}, ${bench.focus.y.toFixed(2)}` : '';
  $('#bCut').disabled = $('#bCutRepl').disabled = !s || busy;
  const I = instruments[ed.inst];
  $('#bCutRepl').title = I ? `Cut the marked piece into instrument ${hex2(ed.inst)} ${I.name}: its video is replaced, how it sounds is kept (Shift+Enter)`
    : 'Select an instrument first: the piece replaces its video (Shift+Enter)';
  $('#bPlaySel').disabled = !s;
  $('#bTrim').disabled = !s || busy;
}
const seek = t => { vid.currentTime = Math.max(0, Math.min(dur(), t)); follow(); draw(); };
const mark = (which, t = vid.currentTime) => { bench[which] = t; info(); draw(); };
const toggle = () => { if (!bench.file) return; vid.paused ? vid.play() : vid.pause(); };
// plays the marked piece once, or again and again while Loop is down
let stopAt = null, looping = false;
// ▶ Piece stays down while the piece plays, like the transport's keys; Stop (or its end, or a pause) lets it up
const pieceKey = down => $('#bPlaySel').classList.toggle('down', down);
function playSel() {
  const s = sel(); if (!s) return;
  pieceKey(true);
  if (looping) return startLoop();
  stopAt = s[1]; vid.currentTime = s[0]; vid.play();
}
// checked on every frame (loop below): timeupdate alone comes only every ~250 ms and overshoots the end by that much
const stopAtEnd = () => { if (stopAt != null && vid.currentTime >= stopAt) { vid.pause(); stopAt = null; } };

// ── Loop: the <video> can't loop without a gap (every jump back is a seek, and a seek stalls), so the piece's sound,
// with LOOP_ROOM seconds around it, is decoded and looped by the audio clock, sample-exact; the muted picture follows
// it. Its ends can be dragged meanwhile: inside the decoded room the loop takes them at once, outside it is decoded
// again. A piece longer than LOOP_MAX is looped the plain way (a seek, with its gap).
const LOOP_ROOM = 2, LOOP_MAX = 60;
let lp = null, loopJob = 0; // lp: { src, from, to (the decoded part of the video), pos (where we are in it), last, ending }
async function startLoop() {
  const s = sel(), file = bench.file; if (!s || !file) return;
  stopLoop(); // (not vid.pause(): its pause event would come while decoding and cancel this; a pause by hand does)
  if (s[1] - s[0] > LOOP_MAX) { stopAt = s[1]; vid.currentTime = s[0]; vid.play(); return; }
  ensureAudio(); vid.muted = true;
  const job = ++loopJob, from = Math.max(0, s[0] - LOOP_ROOM), to = Math.min(dur(), s[1] + LOOP_ROOM);
  let buf;
  try { buf = await ctx.decodeAudioData((await (await soundOf(file))(from, to)).bytes.buffer); }
  catch (err) { console.warn('loop: plays the plain way:', err.message); vid.muted = false; stopAt = s[1]; vid.currentTime = s[0]; vid.play(); return; }
  if (job !== loopJob || bench.file !== file) return;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  // straight out, as the <video> plays the bench without Loop: the file's own level, not the song's master and limiter
  src.loopStart = s[0] - from; src.loopEnd = s[1] - from; src.connect(ctx.destination);
  src.start(ctx.currentTime, s[0] - from);
  lp = { src, from, to, pos: s[0], last: ctx.currentTime, ending: false };
  vid.muted = true; vid.currentTime = s[0]; vid.play();
}
function stopLoop() {
  loopJob++; vid.muted = false;
  if (!lp) return;
  try { lp.src.stop(); } catch {}
  lp.src.disconnect(); lp = null;
}
// every frame: follow the ends, keep the picture on the sound's clock, and stop after the last turn (Loop let go)
function loopTick() {
  if (!lp) return;
  const s = sel(); if (!s) { vid.pause(); return; }
  if (!lp.ending) {
    if (s[0] < lp.from || s[1] > lp.to) return startLoop(); // dragged out of the decoded room
    lp.src.loopStart = s[0] - lp.from; lp.src.loopEnd = s[1] - lp.from;
  }
  const now = ctx.currentTime; lp.pos += now - lp.last; lp.last = now;
  let turned = false;
  if (lp.pos >= s[1]) { if (lp.ending) { vid.pause(); return; } lp.pos = s[0] + (lp.pos - s[1]) % (s[1] - s[0]); turned = true; }
  // the picture jumps back with each turn; otherwise only when it has drifted, and not more than twice a second: every
  // seek stalls the decoder, and a heavy video that can't keep up would be seeking all the time
  if (turned || (Math.abs(vid.currentTime - lp.pos) > 0.15 && now - (lp.seekedAt ?? 0) > 0.5)) { vid.currentTime = lp.pos; lp.seekedAt = now; }
}
// where the play head is: the sound's clock while Loop plays (smooth even while the picture catches up), else the video's
const playPos = () => lp ? lp.pos : vid.currentTime;
$('#bLoopSel').onclick = () => {
  looping = !looping; $('#bLoopSel').classList.toggle('down', looping); $('#bLoopSel').setAttribute('aria-pressed', looping);
  const s = sel();
  if (!looping && lp && s) { lp.ending = true; lp.src.loop = false; lp.src.stop(ctx.currentTime + Math.max(0, s[1] - lp.pos)); } // this turn is the last
}
vid.ontimeupdate = stopAtEnd;
vid.onpause = () => { stopAt = null; stopLoop(); pieceKey(false); };

// trim: the marked piece (of any length) becomes the video on the bench, the rest is thrown away; cut the same way as
// an instrument, without re-encoding, and kept in memory only (the bench is never saved; Ctrl+Z brings the whole
// one back). It stays marked, ready to cut.
async function trim() {
  const s = sel(), file = bench.file;
  if (!file) return showError('Put a video on the bench first: Load, or drop it here');
  if (!s) return showError('Mark the part to keep first: I at its start, O at its end');
  if (busy) return;
  busy = true; info(); vid.pause();
  try {
    setStatus(`Trimming to ${fmt(s[0])} – ${fmt(s[1])}…`);
    const piece = await cutVideo(reader(file), file.size, s[0], s[1]);
    const base = file.name.replace(/\.[^.]+$/, ''), at = fmt(s[0]).replace(/\.\d+$/, '').replace(/:/g, '.');
    busy = false;
    exec(() => trimBench(new File([piece.bytes], `${base} ${at}.mp4`, { type: 'video/mp4' }), piece.end));
    setStatus(`Trimmed: only ${fmt(s[0])} – ${fmt(s[1])} is on the bench now (${(s[1] - s[0]).toFixed(3)} s, not re-encoded)`);
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    showError(`Couldn't trim: ${err.message}`);
  } finally { busy = false; info(); }
}

// replace: the piece becomes the selected instrument's video instead of a new instrument
async function cut(replace = false) {
  const s = sel(), file = bench.file, idx = ed.inst;
  if (!file) return showError('Put a video on the bench first: Load, or drop it here');
  if (!s) return showError('Mark the piece first: I at its start, O at its end');
  if (s[1] - s[0] > MAX_SAMPLE_SEC) return showError(`The piece is ${(s[1] - s[0]).toFixed(3)} s; an instrument can be at most ${MAX_SAMPLE_SEC} s`);
  if (replace && !instruments[idx]) return showError('Select the instrument whose video the piece replaces');
  if (busy) return;
  busy = true; info(); vid.pause();
  try {
    setStatus(`Cutting ${fmt(s[0])} – ${fmt(s[1])}…`);
    const piece = await cutVideo(reader(file), file.size, s[0], s[1]);
    const base = file.name.replace(/\.[^.]+$/, ''), at = fmt(s[0]).replace(/\.\d+$/, '');
    const out = new File([piece.bytes], `${base} ${at.replace(/:/g, '.')}.mp4`, { type: 'video/mp4' });
    const region = { start: piece.start, end: piece.end, focus: bench.focus ? [{ t: 0, ...bench.focus }] : [] }, progress = t => setStatus(escHtml(t));
    const size = piece.bytes.length < 1048576 ? Math.ceil(piece.bytes.length / 1024) + ' KB' : (piece.bytes.length / 1048576).toFixed(1) + ' MB';
    if (replace) {
      const { noSound } = await replaceVideo(idx, out, progress, region), I = instruments[idx];
      setStatus(`Cut ${fmt(s[0])} – ${fmt(s[1])} → instrument ${hex2(idx)} ${escHtml(I.name)}: its video is replaced, how it sounds is kept (${size}, not re-encoded; hit found at ${I.hit.toFixed(3)} s, check it)` + (noSound ? `<span class="err">${NO_SOUND}</span>` : ''));
    } else {
      const { idx: n, I, noSound } = await importVideo(out, progress, { ...region, name: `${base.slice(0, 15 - at.length)} ${at}` });
      setStatus(`Cut ${fmt(s[0])} – ${fmt(s[1])} → instrument ${hex2(n)} ${escHtml(I.name)} (${size}, not re-encoded; hit found at ${I.hit.toFixed(3)} s, check it)` + (noSound ? `<span class="err">${NO_SOUND}</span>` : ''));
    }
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    showError(`Couldn't cut: ${err.message}`);
  } finally { busy = false; info(); }
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
const follow = () => { const t = playPos(); if (t < view.from || t > view.to) setView(t - span() * 0.1, t + span() * 0.9); };
const TICKS = [0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600];
// the waveform's picture: for every pixel, the peaks of the time it covers. Drawn again only when what it shows
// changes (the view, the size, more peaks read), not on every frame while playing: a long video has hundreds of
// thousands of peaks
const wave = { c: document.createElement('canvas'), key: '' };
function waveImage(w, hh, k) {
  const key = [peaks.job, view.from, view.to, w, hh, k, peaks.top, peaks.filled].join();
  if (key === wave.key) return wave.c;
  wave.key = key; wave.c.width = Math.round(w * k); wave.c.height = Math.round(hh * k);
  const wg = wave.c.getContext('2d'), a = hh / 2 / peaks.top;
  wg.setTransform(k, 0, 0, k, 0, 0); wg.fillStyle = alpha(pal.acc2, 0.45);
  for (let px = 0; px < w; px++) {
    let lo = 0, hi = 0;
    for (let b = Math.floor((view.from + px / w * span()) * PPS), e = Math.max(b + 1, Math.floor((view.from + (px + 1) / w * span()) * PPS)); b < e && b < peaks.max.length; b++)
      if (peaks.max[b] === peaks.max[b]) { if (peaks.min[b] < lo) lo = peaks.min[b]; if (peaks.max[b] > hi) hi = peaks.max[b]; }
    if (hi > lo) wg.fillRect(px, Math.round(hh / 2 - hi * a), 1, Math.max(1, Math.round((hi - lo) * a)));
  }
  return wave.c;
}
function draw() {
  const w = tl.clientWidth, h = tl.clientHeight, k = devicePixelRatio || 1;
  if (!w || !h) return; // the bench is hidden (another screen): nothing to draw on
  if (tl.width !== Math.round(w * k) || tl.height !== Math.round(h * k)) { tl.width = Math.round(w * k); tl.height = Math.round(h * k); }
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = pal.well; g.fillRect(0, 0, w, h);
  const D = dur(); if (!D) return;
  if (!(view.to > view.from)) { view.from = 0; view.to = D; }
  const x = t => (t - view.from) / span() * w, zoomed = span() < D - 1e-6, bar = zoomed ? 4 : 0, hh = h - bar;
  // the sound under it all
  if (peaks.max && peaks.top > 0) g.drawImage(waveImage(w, hh, k), 0, 0, w, hh);
  // ticks no closer than 70 px, each with its time
  const every = TICKS.find(e => e / span() * w >= 70) ?? 3600;
  g.font = '8px dos8, ui-monospace, monospace'; g.textBaseline = 'bottom';
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
  const pos = playPos();
  g.fillStyle = pal.acc2; g.fillRect(Math.round(x(pos)) - 1, 0, 2, hh);
  g.fillStyle = pal.text; g.font = '8px dos8, ui-monospace, monospace'; g.textBaseline = 'top';
  const now = fmt(pos), tw = g.measureText(now).width, px = x(pos);
  g.fillText(now, px + 4 + tw < w ? px + 4 : px - 4 - tw, 3);
  if (zoomed) {
    g.fillStyle = pal.panel2; g.fillRect(0, hh, w, bar);
    g.fillStyle = pal.dim; g.fillRect(view.from / D * w, hh, Math.max(2, span() / D * w), bar);
    g.fillStyle = pal.acc2; g.fillRect(pos / D * w, hh, 1, bar);
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
// the drag in progress (null: none). One set of handlers for good: swapping them per drag left a drag's handler
// behind whenever its pointerup was lost (released outside the window, a cancelled trackpad gesture), and from then on
// merely moving over the timeline dragged an end along
let drag = null;
tl.onpointerdown = e => {
  if (!dur()) return;
  drag = { end: endAt(e), x0: e.clientX, t0: at(e), moved: false };
  tl.setPointerCapture(e.pointerId); vid.pause();
};
tl.onpointermove = ev => {
  if (drag && !ev.buttons) drag = null; // its release never came: no button is down any more
  if (!drag) { if (dur()) tl.style.cursor = endAt(ev) ? 'ew-resize' : ''; return; }
  if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 4) return;
  drag.moved = true;
  if (drag.end) { bench[drag.end] = at(ev); vid.currentTime = bench[drag.end]; } else { bench.in = drag.t0; bench.out = at(ev); }
  info(); draw();
};
tl.onpointerup = ev => {
  const d = drag; drag = null;
  if (!d) return;
  if (!d.moved) seek(at(ev)); else if (!d.end) seek(sel()[0]);
};
tl.onpointercancel = () => { drag = null; };
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
const loop = () => { raf = requestAnimationFrame(loop); if (!vid.paused) { stopAtEnd(); loopTick(); follow(); draw(); } };
new ResizeObserver(draw).observe(tl);

$('#bBenchLoad').onclick = () => $('#bFile').click();
$('#bFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) putOnBench(f); };
$('#bClear').onclick = clear;
$('#bCut').onclick = () => cut();
$('#bCutRepl').onclick = () => cut(true);
$('#bPlaySel').onclick = playSel;
$('#bStopSel').onclick = () => vid.pause();
$('#bTrim').onclick = trim;

export const benchScreen = {
  name: 'bench', el: $('#bench'),
  keys: {
    Space: toggle, 'Shift+Space': playSel,
    ArrowLeft: () => seek(vid.currentTime - STEP), ArrowRight: () => seek(vid.currentTime + STEP),
    'Shift+ArrowLeft': () => seek(vid.currentTime - BIG), 'Shift+ArrowRight': () => seek(vid.currentTime + BIG),
    Comma: () => { vid.pause(); seek(vid.currentTime - FRAME); }, Period: () => { vid.pause(); seek(vid.currentTime + FRAME); },
    Home: () => seek(0), End: () => seek(dur()),
    KeyI: () => mark('in'), KeyO: () => mark('out'),
    Enter: () => cut(), NumpadEnter: () => cut(), 'Shift+Enter': () => cut(true), 'Shift+NumpadEnter': () => cut(true),
    Escape: () => { bench.in = bench.out = null; info(); draw(); },
    Backspace: () => setFocus(null), Delete: () => setFocus(null),
    Equal: () => zoom(0.5), Minus: () => zoom(2), Digit0: fit, NumpadAdd: () => zoom(0.5), NumpadSubtract: () => zoom(2),
  },
  enter() {
    $('#bScreenPat').classList.remove('down'); $('#bScreenBench').classList.add('down');
    raf = requestAnimationFrame(loop); draw(); drawFocus(); info();
    if (!bench.file) setStatus('The bench: put a long video on it (Load, or drop it here), mark a piece with <b>I</b> / <b>O</b>, <b>Enter</b> cuts it into a new instrument, <b>Shift+Enter</b> into the selected one (replacing its video). <b>⌘/Ctrl+B</b> goes back.');
  },
  leave() {
    $('#bScreenBench').classList.remove('down'); $('#bScreenPat').classList.add('down');
    vid.pause(); cancelAnimationFrame(raf);
  },
};
