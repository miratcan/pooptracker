// The instrument panel: the list of instruments, their settings and the waveform editor.
// Sliders and waveform drags preview live and become ONE command when released.
import PTFormat from '../ptformat.js';
import { clamp, hex2, noteName, round3, copy } from '../util.js';
import { song, instruments } from '../core/song.js';
import { makeInstrument, videoFrame, frameAt, focusAt, hitPos, sliceRegion, tickDur, detectHit, detectPitch, tuneFor, noteOfHz, fitFor, loops } from '../core/instrument.js';
import { setInstrument, addInstrument, deleteInstrument, moveInstrument } from '../core/commands.js';
import { previewNote, syncTest, referenceTone } from '../engine/player.js';
import { $, ed, run, num, showError, refreshUI, setStatus } from './common.js';
import { drawCover, coverRect } from './output.js';
import { pal, alpha } from './palette.js';
import { saveInstrumentVideo, trimInstrumentVideo } from './files.js';

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
  $('#iName').value = I.name; $('#iTune').textContent = tuneTxt(I); $('#iVol').value = hex2(I.vol); $('#iRev').value = hex2(I.reverb);
  ['A', 'D', 'R'].forEach(p => { $('#i' + p).value = I[p].v; $('#i' + p + 'u').value = I[p].u; }); $('#iS').value = hex2(I.S);
  $('#iStart').value = I.start.toFixed(3); $('#iEnd').value = I.end.toFixed(3);
  $('#iHit').value = I.hit.toFixed(3); $('#iAV').value = I.avOffset;
  $('#iTags').value = I.tags.join(' '); $('#iSrc').value = I.source; $('#bSrc').disabled = !isLink(I.source);
  $('#iLoop').value = I.loop; $('#iLS').disabled = $('#iLE').disabled = I.loop === 'none'; $('#iLS').value = I.loopStart.toFixed(3); $('#iLE').value = I.loopEnd.toFixed(3);
  refreshInstList(); drawWave(null);
}
const instCmd = (fields, label, before) => run(() => setInstrument(ed.inst, fields, label, before));
$('#iName').onchange = e => instCmd({ name: e.target.value }, 'name');
// Base and Fine are shown, not typed: Auto, Manual (a click on them opens it) and Fit set them
const tuneTxt = I => `${noteName(I.baseNote)} ${I.fine >= 0 ? '+' : ''}${I.fine}`;
$('#iTune').onclick = () => $('#bTuneMan').click();
// Tune: the pitch heard after the hit becomes Base + Fine (a bend in the clip stays: one pitch for the whole instrument)
$('#bTune').onclick = () => {
  const I = curInst(); if (!I) return;
  const hz = detectPitch(I.buffer, hitPos(I)), t = hz && tuneFor(hz);
  if (!t) return showError(`${hex2(ed.inst)} ${I.name}: no clear pitch after the hit (a noisy sound like a snare or a hi-hat has none)`);
  instCmd(t, 'tune');
  setStatus(`${hex2(ed.inst)} ${I.name}: ${hz.toFixed(1)} Hz → Base ${noteName(t.baseNote)}, Fine ${t.fine > 0 ? '+' : ''}${t.fine}`);
};
// Manual tune: by ear against a reference C-4. Base and Fine change live, closing makes them ONE command.
// The fine step is 4/128 of a semitone (~3 cents); past ±128 it carries into Base.
const tuneDlg = $('#tuneDlg'); let tuning = null;
// the meter: the clip's detected pitch (found once, as Auto finds it) against Base + Fine, in cents off at C-4
function showTune(I) {
  $('#tuneNow').textContent = `${hex2(ed.inst)} ${I.name}: Base ${noteName(I.baseNote)}, Fine ${I.fine > 0 ? '+' : ''}${I.fine}`;
  const meter = $('#tuneNeedle').parentElement, n = tuning.detected;
  meter.classList.toggle('none', n == null);
  if (n == null) return void ($('#tuneHeard').textContent = 'No clear pitch detected (a noisy sound like a snare has none): by ear only.');
  // the needle: the cents off the nearest semitone (so ←→ always move it); the semitones are in the words
  const c = Math.round((n - I.baseNote - I.fine / 128) * 100), semi = Math.round(c / 100), rest = c - semi * 100;
  $('#tuneNeedle').style.left = `${50 + rest}%`; $('#tuneNeedle').classList.toggle('ok', !semi && Math.abs(rest) <= 3);
  const centsTxt = !semi && Math.abs(rest) <= 3 ?`in tune (${rest > 0 ? '+' : ''}${rest} cents)` : `${Math.abs(rest)} cents ${rest > 0 ? 'sharp (→)' : 'flat (←)'}`;
  // whole octaves apart: the ear hears them as the same note, and pitch detection can land an octave off too
  const octs = semi && semi % 12 === 0 ? `${Math.abs(semi / 12)} octave${Math.abs(semi) > 12 ? 's' : ''} ${semi > 0 ? 'sharp' : 'flat'}` : null;
  $('#tuneHeard').textContent = `Detected: ${octs ? `${octs} (same note, octave apart), then ` : semi ? `${Math.abs(semi)} semitone${Math.abs(semi) > 1 ? 's' : ''} ${semi > 0 ? 'sharp (↑)' : 'flat (↓)'}, then ` : ''}${centsTxt}`;
}
function tuneBy(semi, fine) {
  const I = tuning?.I; if (!I) return;
  let n = I.baseNote + semi, f = I.fine + fine;
  if (f > 127) { n++; f -= 128; } else if (f < -128) { n--; f += 128; }
  if (n >= 0 && n <= 95) { I.baseNote = n; I.fine = f; }
  showTune(I); previewNote(I, ed.ch, 48); referenceTone(48);
}
$('#bTuneMan').onclick = () => {
  const I = curInst(); if (!I) return;
  const hz = detectPitch(I.buffer, hitPos(I));
  tuning = { I, idx: ed.inst, before: { baseNote: I.baseNote, fine: I.fine }, detected: hz ? noteOfHz(hz) : null };
  tuneDlg.showModal(); tuneBy(0, 0);
};
tuneDlg.addEventListener('close', () => {
  const t = tuning; tuning = null; if (!t) return;
  run(() => setInstrument(t.idx, { baseNote: t.I.baseNote, fine: t.I.fine }, 'manual tune', t.before));
});
// the keys, and the on-screen button each one presses down while held
const TUNE_KEYS = { ArrowUp: [1, 0, 'tUp'], ArrowDown: [-1, 0, 'tDown'], ArrowRight: [0, 4, 'tRight'], ArrowLeft: [0, -4, 'tLeft'], Space: [0, 0, 'tPlay'] };
tuneDlg.addEventListener('keydown', e => {
  const k = TUNE_KEYS[e.code]; if (!k || e.altKey || e.metaKey || e.ctrlKey) return;
  // Shift: ↑↓ an octave, ←→ the smallest finetune step
  e.preventDefault(); $('#' + k[2]).classList.add('down'); tuneBy(e.shiftKey ? k[0] * 12 : k[0], e.shiftKey ? Math.sign(k[1]) : k[1]);
});
tuneDlg.addEventListener('keyup', e => { const k = TUNE_KEYS[e.code]; if (k) $('#' + k[2]).classList.remove('down'); });
[['tUp', 1, 0], ['tDown', -1, 0], ['tRight', 0, 4], ['tLeft', 0, -4], ['tPlay', 0, 0]].forEach(([id, s, f]) => { $('#' + id).onclick = () => tuneBy(s, f); });
// Fit: repitched so that, at C-4, its region lasts a whole number of rows (at this tempo)
$('#bFit').onclick = () => {
  const I = curInst(); if (!I) return;
  const f = fitFor(I.end - I.start, song.bpm, song.speed);
  if (!f) return showError(`${hex2(ed.inst)} ${I.name}: it can't be made to fit (it would play outside C-0…B-7)`);
  instCmd({ baseNote: f.baseNote, fine: f.fine }, 'fit');
  setStatus(`${hex2(ed.inst)} ${I.name}: at C-4 its region now lasts ${f.rows} rows (BPM ${song.bpm}, speed ${song.speed}) → Base ${noteName(f.baseNote)}, Fine ${f.fine > 0 ? '+' : ''}${f.fine}`);
};
// Amp: FT2's sample editor Volume. Each Apply is one step added to the instrument's amp (a command: Ctrl+Z takes it back)
const ampDlg = $('#ampDlg');
const ampTxt = I => I.amp.length ? I.amp.map(s => `${s.a}→${s.b}%`).join(', then ') : 'as loaded';
const showAmp = I => { $('#ampNow').textContent = `${hex2(ed.inst)} ${I.name}: ${ampTxt(I)}`; };
$('#bAmp').onclick = () => {
  const I = curInst(); if (!I) return;
  $('#ampA').value = $('#ampB').value = 100; showAmp(I);
  ampDlg.showModal(); $('#ampA').select();
};
$('#ampForm').onsubmit = e => {
  e.preventDefault();
  const I = curInst(), a = +$('#ampA').value, b = +$('#ampB').value; if (!I) return;
  if (![a, b].every(x => Number.isInteger(x) && x >= 0 && x <= 200)) return showError(`amp '${$('#ampA').value}–${$('#ampB').value}' is invalid (percent, 0–200 each, integers)`);
  if (a === 100 && b === 100) return; // changes nothing
  if (instCmd({ amp: [...I.amp, { a, b }] }, `amp ${a}–${b}%`)) { showAmp(I); setStatus(`${hex2(ed.inst)} ${I.name}: amplified ${a}→${b}% (${I.amp.length} step${I.amp.length > 1 ? 's' : ''}; ⌘/Ctrl+Z takes it back)`); }
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
const isLink = s => /^https?:\/\/\S+$/.test(s);
$('#iTags').onchange = e => instCmd({ tags: PTFormat.tagsFrom(e.target.value) }, 'tags');
$('#iSrc').onchange = e => instCmd({ source: e.target.value.trim() }, 'source');
$('#bSrc').onclick = () => { const I = curInst(); if (I && isLink(I.source)) window.open(I.source, '_blank', 'noopener'); };
$('#iLoop').onchange = e => {
  const I = curInst(), mode = e.target.value;
  // turning loop on: if the old loop points don't fit (inside the region, starting at or after the hit), start with hit → region end
  const fits = I.loopStart >= I.hit && I.loopEnd <= I.end && I.loopStart < I.loopEnd;
  instCmd(mode !== 'none' && !fits ? { loop: mode, loopStart: I.hit, loopEnd: I.end } : { loop: mode }, `loop: ${mode}`);
};
$('#iLS').onchange = e => instCmd({ loopStart: round3(num(e.target)) }, 'loop start');
$('#iLE').onchange = e => instCmd({ loopEnd: round3(num(e.target)) }, 'loop end');
$('#bTrimInst').onclick = () => trimInstrumentVideo(ed.inst);
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
  // the region as it sounds (amplified: I.peaks), the rest as the video has it
  const mid = TH + (H - TH) / 2, amp = (H - TH) / 2 - 4, bd = V.buffer.duration, id = I.buffer.duration;
  wg.strokeStyle = pal.acc2; wg.beginPath();
  for (let px = 0; px < W; px++) {
    const t = px / W * dur; if (t > bd) break;
    const inI = I.peaks && t >= I.start && t - I.start < id, P = inI ? I.peaks : V.peaks;
    const i = Math.floor((inI ? (t - I.start) / id : t / bd) * P.length / 2) * 2;
    wg.moveTo(px + 0.5, mid - P[i + 1] * amp); wg.lineTo(px + 0.5, mid - P[i] * amp + 1);
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
