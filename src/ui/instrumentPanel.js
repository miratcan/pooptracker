// The instrument panel: the list of instruments, their settings and the waveform editor.
// Sliders and waveform drags preview live and become ONE command when released.
import { clamp, hex2, noteName, parseNote, round3, copy } from '../util.js';
import { song, instruments } from '../core/song.js';
import { makeInstrument, videoFrame, frameAt, focusAt, hitPos, sliceRegion, tickDur, detectHit, loops } from '../core/instrument.js';
import { setInstrument, addInstrument, deleteInstrument, moveInstrument } from '../core/commands.js';
import { previewNote, syncTest } from '../engine/player.js';
import { $, ed, run, num, showError, refreshUI } from './common.js';
import { drawCover, coverRect } from './output.js';
import { pal, alpha } from './palette.js';
import { saveInstrumentVideo } from './files.js';

export const curInst = () => instruments[ed.inst];
function refreshInstList() {
  const el = $('#instList'); el.innerHTML = '';
  instruments.forEach((I, idx) => {
    if (!I) return;
    const d = document.createElement('div'); d.className = 'inst' + (idx === ed.inst ? ' sel' : ''); d.dataset.idx = idx;
    const c = document.createElement('canvas'); c.width = 128; c.height = 72;
    drawCover(c.getContext('2d'), frameAt(I, hitPos(I) + 0.05), 0, 0, 128, 72);
    const s = document.createElement('span'); s.textContent = `${hex2(idx)} ${I.name}`;
    d.append(c, s); d.onclick = () => selectInst(idx); el.appendChild(d);
  });
}
export function selectInst(idx) {
  ed.inst = idx; const I = curInst(); if (!I) return;
  $('#iName').value = I.name; $('#iBase').value = noteName(I.baseNote); $('#iVol').value = hex2(I.vol); $('#iRev').value = hex2(I.reverb);
  ['A', 'D', 'R'].forEach(p => { $('#i' + p).value = I[p].v; $('#i' + p + 'u').value = I[p].u; }); $('#iS').value = hex2(I.S);
  $('#iStart').value = I.start.toFixed(3); $('#iEnd').value = I.end.toFixed(3);
  $('#iHit').value = I.hit.toFixed(3); $('#iAV').value = I.avOffset;
  $('#iLoop').value = I.loop; $('#iLS').disabled = $('#iLE').disabled = I.loop === 'none'; $('#iLS').value = I.loopStart.toFixed(3); $('#iLE').value = I.loopEnd.toFixed(3);
  refreshInstList(); drawWave(null);
}
const instCmd = (fields, label, before) => run(() => setInstrument(ed.inst, fields, label, before));
$('#iName').onchange = e => instCmd({ name: e.target.value }, 'name');
$('#iBase').onchange = e => {
  const n = parseNote(e.target.value);
  if (n < 0 || n > 95) { showError(`base note '${e.target.value}' is invalid (C-0…B-7)`); refreshUI(); } else instCmd({ baseNote: n }, 'base note');
};
// volume is hex, as everywhere in the tracker (00–40)
$('#iVol').onchange = e => {
  const t = e.target.value.trim();
  if (!/^[0-9a-f]{1,2}$/i.test(t)) { showError(`volume '${t}' is invalid (hex 00–40)`); refreshUI(); } else instCmd({ vol: parseInt(t, 16) }, 'volume');
};
$('#iRev').onchange = e => {
  const t = e.target.value.trim();
  if (!/^[0-9a-f]{1,2}$/i.test(t)) { showError(`reverb '${t}' is invalid (hex 00–40)`); refreshUI(); } else instCmd({ reverb: parseInt(t, 16) }, 'reverb');
};
$('#iS').onchange = e => {
  const t = e.target.value.trim();
  if (!/^[0-9a-f]{1,2}$/i.test(t)) { showError(`S '${t}' is invalid (hex 00–40)`); refreshUI(); } else instCmd({ S: parseInt(t, 16) }, 'S');
};
['A', 'D', 'R'].forEach(p => {
  $('#i' + p).onchange = e => instCmd({ [p]: { v: num(e.target), u: curInst()[p].u } }, p);
  // switching the unit keeps the current length (at the current BPM)
  $('#i' + p + 'u').onchange = e => {
    const E = curInst()[p], u = e.target.value; if (u === E.u) return;
    instCmd({ [p]: { v: Math.round(u === 'ms' ? E.v * tickDur(song.bpm) * 1000 : E.v / 1000 / tickDur(song.bpm)), u } }, `${p} unit`);
  };
});
$('#iStart').onchange = e => instCmd({ start: round3(num(e.target)) }, 'region start');
$('#iEnd').onchange = e => instCmd({ end: round3(num(e.target)) }, 'region end');
$('#iHit').onchange = e => instCmd({ hit: round3(num(e.target)) }, 'hit point');
$('#iAV').onchange = e => instCmd({ avOffset: num(e.target) }, 'A/V offset');
$('#iLoop').onchange = e => {
  const I = curInst(), mode = e.target.value;
  // turning loop on: if the old loop points don't fit (inside the region, starting at or after the hit), start with hit → region end
  const fits = I.loopStart >= I.hit && I.loopEnd <= I.end && I.loopStart < I.loopEnd;
  instCmd(mode !== 'none' && !fits ? { loop: mode, loopStart: I.hit, loopEnd: I.end } : { loop: mode }, `loop: ${mode}`);
};
$('#iLS').onchange = e => instCmd({ loopStart: round3(num(e.target)) }, 'loop start');
$('#iLE').onchange = e => instCmd({ loopEnd: round3(num(e.target)) }, 'loop end');
$('#bAuto').onclick = () => { const I = curInst(); instCmd({ hit: round3(I.start + detectHit(I.buffer)) }, 'auto hit'); };
$('#bVidSave').onclick = () => { const I = curInst(); if (I) saveInstrumentVideo(I); };
$('#bSplit').onclick = () => { const I = curInst(); if (I) run(() => addInstrument(makeInstrument(I.video, I), 'new instrument from this video')); };
$('#iDel').onclick = () => run(() => deleteInstrument(ed.inst));
$('#iUp').onclick = () => run(() => moveInstrument(ed.inst, -1));
$('#iDown').onclick = () => run(() => moveInstrument(ed.inst, 1));
$('#bHitPlay').onclick = () => previewNote(curInst(), ed.ch, curInst().baseNote);
$('#bFull').onclick = () => previewNote(curInst(), ed.ch, curInst().baseNote, true);
$('#bSync').onclick = () => syncTest(curInst(), ed.ch);

const wave = $('#wave'), wg = wave.getContext('2d'), fp = $('#framePrev'), fpg = fp.getContext('2d');
// draggable handles on the waveform (first one wins when they overlap)
const HANDLES = [['hit', 'red', 'hit point'], ['loopStart', 'green', 'loop start'], ['loopEnd', 'green', 'loop end'], ['start', 'acc', 'region start'], ['end', 'acc', 'region end']]; // colors: palette names
const handlesOf = I => HANDLES.filter(([k]) => I.loop !== 'none' || !k.startsWith('loop'));
// where each handle may go, so that a drag can never make the instrument invalid
function handleRange(I, k) {
  const ms = 0.001;
  if (k === 'start') return [0, Math.min(I.hit, I.loop !== 'none' ? I.loopStart : Infinity, I.end - ms)];
  if (k === 'end') return [Math.max(I.hit, I.loop !== 'none' ? I.loopEnd : 0, I.start + ms), I.video.dur];
  if (k === 'hit') return [I.start, I.loop !== 'none' ? Math.min(I.end, I.loopStart) : I.end];
  if (k === 'loopStart') return [I.hit, I.loopEnd - ms];
  return [I.loopStart + ms, I.end];
}
function drawWave(hoverT) {
  const I = curInst(); if (!I) return;
  const d = window.devicePixelRatio || 1, W = wave.clientWidth, H = wave.clientHeight;
  if (wave.width !== Math.round(W * d)) { wave.width = Math.round(W * d); wave.height = Math.round(H * d); }
  wg.setTransform(d, 0, 0, d, 0, 0);
  wg.fillStyle = pal.well; wg.fillRect(0, 0, W, H);
  // the whole video; this instrument's region is the bright part
  const V = I.video, dur = V.dur, av = I.avOffset / 1000, TH = 50, tw = TH * 16 / 9, n = Math.max(1, Math.floor(W / tw));
  for (let k = 0; k < n; k++) drawCover(wg, videoFrame(V, (k + 0.5) / n * dur + av), k * (W / n), 0, W / n - 1, TH);
  const tx = t => t / dur * W;
  wg.fillStyle = alpha(pal.acc2, .14); wg.fillRect(tx(I.start), TH, tx(I.hit) - tx(I.start), H - TH);
  if (loops(I)) { wg.fillStyle = alpha(pal.green, .1); wg.fillRect(tx(I.loopStart), TH, tx(I.loopEnd) - tx(I.loopStart), H - TH); }
  const mid = TH + (H - TH) / 2, amp = (H - TH) / 2 - 4, np = V.peaks.length / 2, bd = V.buffer.duration;
  wg.strokeStyle = pal.acc2; wg.beginPath();
  for (let px = 0; px < W; px++) {
    const t = px / W * dur; if (t > bd) break;
    const i = Math.floor(t / bd * np) * 2;
    wg.moveTo(px + 0.5, mid - V.peaks[i + 1] * amp); wg.lineTo(px + 0.5, mid - V.peaks[i] * amp + 1);
  }
  wg.stroke();
  wg.fillStyle = alpha(pal.black, .65); wg.fillRect(0, 0, tx(I.start), H); wg.fillRect(tx(I.end), 0, W - tx(I.end), H);
  for (const [k, col] of handlesOf(I).reverse()) {
    const x = Math.round(tx(I[k])) + 0.5;
    wg.strokeStyle = wg.fillStyle = pal[col]; wg.lineWidth = k === 'hit' ? 2 : 1;
    wg.beginPath(); wg.moveTo(x, 0); wg.lineTo(x, H); wg.stroke(); wg.fillRect(x - 4, 0, 8, 8);
  }
  wg.lineWidth = 1; wg.fillStyle = pal.acc2; wg.font = '8px dos8, ui-monospace, monospace';
  if (tx(I.hit) - tx(I.start) > 60) wg.fillText('pre-roll', tx(I.start) + 6, TH + 14);
  wg.fillStyle = pal.red; wg.fillText(`hit ${I.hit.toFixed(3)}s`, Math.min(tx(I.hit) + 5, W - 95), H - 6);
  if (hoverT != null) { wg.strokeStyle = alpha(pal.white, .5); wg.beginPath(); wg.moveTo(tx(hoverT), 0); wg.lineTo(tx(hoverT), H); wg.stroke(); }
  const img = videoFrame(V, (hoverT ?? I.hit) + av);
  drawCover(fpg, img, 0, 0, fp.width, fp.height);
  // the focus point, and what a one-channel (9:16) tile sees around it
  if (I.focus.length) {
    const p = fpPos(img), f = focusAt(I, (hoverT ?? I.hit) + av), tile = coverRect(img.width, img.height, 9 / 16, f);
    const [x0, y0] = p.to(tile.x / img.width, tile.y / img.height), [x1, y1] = p.to((tile.x + tile.w) / img.width, (tile.y + tile.h) / img.height), [fx, fy] = p.to(f.x, f.y);
    fpg.fillStyle = alpha(pal.black, .45); fpg.fillRect(0, 0, x0, fp.height); fpg.fillRect(x1, 0, fp.width - x1, fp.height);
    fpg.strokeStyle = pal.acc; fpg.lineWidth = 2; fpg.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    fpg.fillStyle = pal.acc; fpg.fillRect(fx - 7, fy - 1, 14, 2); fpg.fillRect(fx - 1, fy - 7, 2, 14);
  }
  fpg.fillStyle = alpha(pal.black, .6); fpg.fillRect(0, fp.height - 22, fp.width, 22);
  fpg.fillStyle = hoverT != null ? pal.white : pal.red; fpg.font = '16px dos, ui-monospace, monospace';
  fpg.fillText(hoverT != null ? `${hoverT.toFixed(3)} s` : `hit frame ${I.hit.toFixed(3)} s`, 8, fp.height - 7);
}
// the frame preview shows the middle of the frame: from 0–1 frame coordinates to its pixels and back
function fpPos(img) {
  const r = coverRect(img.width, img.height, fp.width / fp.height);
  return { to: (x, y) => [(x * img.width - r.x) / r.w * fp.width, (y * img.height - r.y) / r.h * fp.height],
    from: (px, py) => [clamp((r.x + px / fp.width * r.w) / img.width, 0, 1), clamp((r.y + py / fp.height * r.h) / img.height, 0, 1)] };
}
// click: the tiles keep this point in view · Alt+click: back to the middle
fp.onclick = e => {
  const I = curInst(); if (!I) return;
  if (e.altKey) return instCmd({ focus: [] }, 'focus');
  const b = fp.getBoundingClientRect(), [x, y] = fpPos(videoFrame(I.video, I.hit + I.avOffset / 1000)).from((e.clientX - b.left) / b.width * fp.width, (e.clientY - b.top) / b.height * fp.height);
  instCmd({ focus: [{ t: round3(I.start), x: round3(x), y: round3(y) }] }, 'focus');
};
let waveDrag = null;
const waveX = e => e.clientX - wave.getBoundingClientRect().left;
const waveT = e => clamp(waveX(e) / wave.clientWidth, 0, 1) * curInst().video.dur;
// handles under the mouse; several when they sit on the same spot (e.g. loop start on the hit)
function handlesAt(e) {
  const I = curInst(), x = waveX(e), px = k => I[k] / I.video.dur * wave.clientWidth;
  let best = null, bd = 6;
  for (const [k] of handlesOf(I)) { const d = Math.abs(px(k) - x); if (d < bd) { bd = d; best = k; } }
  return best ? handlesOf(I).map(([k]) => k).filter(k => Math.abs(px(k) - px(best)) < 1) : [];
}
function dragTo(e) {
  const I = curInst(), k = waveDrag.key, [a, b] = handleRange(I, k);
  I[k] = round3(clamp(waveT(e), a, b));
  if (k === 'start' || k === 'end') sliceRegion(I);
  drawWave(null);
}
// a click on empty space moves the hit; every drag becomes one command on release
wave.addEventListener('mousedown', e => {
  const I = curInst(); if (!I) return;
  const keys = handlesAt(e);
  if (keys.length > 1) { waveDrag = { keys, x0: waveX(e) }; return; } // stacked handles: the drag direction picks one
  const key = keys[0] || 'hit';
  waveDrag = { key, before: { [key]: I[key] } };
  dragTo(e);
});
window.addEventListener('mousemove', e => {
  if (!waveDrag) return;
  if (!waveDrag.key) {
    const dx = waveX(e) - waveDrag.x0; if (Math.abs(dx) < 2) return;
    // the handle that can move that way (the others are blocked by their ranges)
    const I = curInst(), key = waveDrag.keys.find(k => { const [a, b] = handleRange(I, k); return dx > 0 ? b > I[k] : a < I[k]; });
    if (!key) return;
    waveDrag = { key, before: { [key]: I[key] } };
  }
  dragTo(e);
});
window.addEventListener('mouseup', () => {
  if (!waveDrag) return;
  const { key, before } = waveDrag; waveDrag = null;
  if (!key) return;
  instCmd({ [key]: curInst()[key] }, HANDLES.find(h => h[0] === key)[2], before);
});
wave.addEventListener('mousemove', e => { if (!waveDrag && curInst()) { wave.style.cursor = handlesAt(e).length ? 'ew-resize' : 'crosshair'; drawWave(waveT(e)); } });
wave.addEventListener('mouseleave', () => { if (!waveDrag) drawWave(null); });
window.addEventListener('resize', () => drawWave(null));

export function refreshInstrumentPanel() {
  if (!instruments[ed.inst]) ed.inst = instruments.length - 1;
  $('#instEd').style.visibility = instruments[ed.inst] ? '' : 'hidden';
  if (instruments[ed.inst]) selectInst(ed.inst); else refreshInstList();
}
