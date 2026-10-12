// The instrument panel: the list of instruments, their settings and the waveform editor.
// Sliders and waveform drags preview live and become ONE command when released.
import { clamp, hex2, noteName, parseNote, round3, copy } from '../util.js';
import { song, instruments } from '../core/song.js';
import { makeInstrument, videoFrame, frameAt, hitPos, sliceRegion, tickDur, envSec, detectHit, loops } from '../core/instrument.js';
import { setInstrument, addInstrument, deleteInstrument, moveInstrument } from '../core/commands.js';
import { previewNote, syncTest } from '../engine/player.js';
import { $, ed, run, num, showError, refreshUI } from './common.js';
import { drawCover } from './output.js';
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
  $('#iName').value = I.name; $('#iBase').value = noteName(I.baseNote); $('#iVol').value = hex2(I.vol);
  ['A', 'D', 'R'].forEach(p => { $('#i' + p).value = I[p].v; $('#i' + p + 'u').value = I[p].u; }); $('#iS').value = I.S;
  $('#iStart').value = I.start.toFixed(3); $('#iEnd').value = I.end.toFixed(3);
  $('#iVideo').textContent = `video: ${I.video.name} (${I.video.dur.toFixed(3)} s)`;
  $('#iHit').value = I.hit.toFixed(3); $('#iAV').value = I.avOffset;
  $('#iLoop').value = I.loop; $('#iLS').disabled = $('#iLE').disabled = I.loop === 'none'; $('#iLS').value = I.loopStart.toFixed(3); $('#iLE').value = I.loopEnd.toFixed(3);
  showAdsr(); refreshInstList(); drawWave(null);
}
const showAdsr = () => {
  const I = curInst(), td = tickDur(song.bpm), s = e => envSec(e, td).toFixed(3) + 's';
  $('#iAdsrV').textContent = `S ${I.S.toFixed(2)} · A ${s(I.A)} D ${s(I.D)} R ${s(I.R)} @${song.bpm}`;
  $('#iAdsrV').title = `In seconds at ${song.bpm} BPM: ${$('#iAdsrV').textContent}. tick follows the tempo (1 tick = 2.5/BPM s), ms stays fixed.`;
};
const instCmd = (fields, label, before) => run(() => setInstrument(ed.inst, fields, label, before));
$('#iName').onchange = e => instCmd({ name: e.target.value }, 'name');
$('#iBase').onchange = e => {
  const n = parseNote(e.target.value);
  if (n < 0 || n > 95) { showError(`base note '${e.target.value}' is invalid (C-0…B-7)`); refreshUI(); } else instCmd({ baseNote: n }, 'base note');
};
// sliders preview live; one command is made when the slider is released
let liveBefore = null;
function liveSet(key, val) { const I = curInst(); if (!liveBefore) liveBefore = { [key]: copy(I[key]) }; I[key] = val; }
function liveCommit(key, label) { const b = liveBefore; liveBefore = null; instCmd({ [key]: curInst()[key] }, label, b || undefined); }
// volume is hex, as everywhere in the tracker (00–40)
$('#iVol').onchange = e => {
  const t = e.target.value.trim();
  if (!/^[0-9a-f]{1,2}$/i.test(t)) { showError(`volume '${t}' is invalid (hex 00–40)`); refreshUI(); } else instCmd({ vol: parseInt(t, 16) }, 'volume');
};
$('#iS').oninput = e => { liveSet('S', Math.round(+e.target.value * 100) / 100); showAdsr(); };
$('#iS').onchange = () => liveCommit('S', 'S');
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
const HANDLES = [['hit', '#ff5d5d', 'hit point'], ['loopStart', '#6bd968', 'loop start'], ['loopEnd', '#6bd968', 'loop end'], ['start', '#f2b53a', 'region start'], ['end', '#f2b53a', 'region end']];
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
  wg.fillStyle = '#07090c'; wg.fillRect(0, 0, W, H);
  // the whole video; this instrument's region is the bright part
  const V = I.video, dur = V.dur, av = I.avOffset / 1000, TH = 50, tw = TH * 16 / 9, n = Math.max(1, Math.floor(W / tw));
  for (let k = 0; k < n; k++) drawCover(wg, videoFrame(V, (k + 0.5) / n * dur + av), k * (W / n), 0, W / n - 1, TH);
  const tx = t => t / dur * W;
  wg.fillStyle = 'rgba(79,195,247,.14)'; wg.fillRect(tx(I.start), TH, tx(I.hit) - tx(I.start), H - TH);
  if (loops(I)) { wg.fillStyle = 'rgba(107,217,104,.10)'; wg.fillRect(tx(I.loopStart), TH, tx(I.loopEnd) - tx(I.loopStart), H - TH); }
  const mid = TH + (H - TH) / 2, amp = (H - TH) / 2 - 4, np = V.peaks.length / 2, bd = V.buffer.duration;
  wg.strokeStyle = '#4fc3f7'; wg.beginPath();
  for (let px = 0; px < W; px++) {
    const t = px / W * dur; if (t > bd) break;
    const i = Math.floor(t / bd * np) * 2;
    wg.moveTo(px + 0.5, mid - V.peaks[i + 1] * amp); wg.lineTo(px + 0.5, mid - V.peaks[i] * amp + 1);
  }
  wg.stroke();
  wg.fillStyle = 'rgba(0,0,0,.65)'; wg.fillRect(0, 0, tx(I.start), H); wg.fillRect(tx(I.end), 0, W - tx(I.end), H);
  for (const [k, col] of handlesOf(I).reverse()) {
    const x = Math.round(tx(I[k])) + 0.5;
    wg.strokeStyle = wg.fillStyle = col; wg.lineWidth = k === 'hit' ? 2 : 1;
    wg.beginPath(); wg.moveTo(x, 0); wg.lineTo(x, H); wg.stroke(); wg.fillRect(x - 4, 0, 8, 8);
  }
  wg.lineWidth = 1; wg.fillStyle = '#4fc3f7'; wg.font = '11px ui-monospace,Menlo,monospace';
  if (tx(I.hit) - tx(I.start) > 60) wg.fillText('pre-roll', tx(I.start) + 6, TH + 14);
  wg.fillStyle = '#ff5d5d'; wg.fillText(`hit ${I.hit.toFixed(3)}s`, Math.min(tx(I.hit) + 5, W - 95), H - 6);
  if (hoverT != null) { wg.strokeStyle = 'rgba(255,255,255,.5)'; wg.beginPath(); wg.moveTo(tx(hoverT), 0); wg.lineTo(tx(hoverT), H); wg.stroke(); }
  drawCover(fpg, videoFrame(V, (hoverT ?? I.hit) + av), 0, 0, fp.width, fp.height);
  fpg.fillStyle = 'rgba(0,0,0,.6)'; fpg.fillRect(0, fp.height - 22, fp.width, 22);
  fpg.fillStyle = hoverT != null ? '#fff' : '#ff5d5d'; fpg.font = '14px ui-monospace,Menlo,monospace';
  fpg.fillText(hoverT != null ? `${hoverT.toFixed(3)} s` : `hit frame ${I.hit.toFixed(3)} s`, 8, fp.height - 7);
}
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
