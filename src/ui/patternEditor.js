// The pattern editor: the FT2-style grid (canvas), its mouse and its keys. It is the main screen.
import { KEYOFF, FX, FXCH, clamp, hex2, noteName } from '../util.js';
import { song, instruments, nch, emptyCell } from '../core/song.js';
import { setCells } from '../core/commands.js';
import { ensureAudio, isMuted } from '../engine/audio.js';
import { player, startPlay, previewNote } from '../engine/player.js';
import { $, ed, view, run, setStatus } from './common.js';
import { muteChannel } from './output.js';
import { userStop, playPattern } from './transport.js';
import { selectInst } from './instrumentPanel.js';
import { selectOrd } from './songPanel.js';

const pc = $('#pat'), pg = pc.getContext('2d');
const PAT = { font: '12px ui-monospace, Menlo, Consolas, monospace', RH: 16, HDR: 22, VIS: 35, x0: 0, chW: 0, CW: 7 };
const COL_OFF = [0, 4, 5, 7, 8, 10, 11, 12], COL_W = [3, 1, 1, 1, 1, 1, 1, 1];
let dpr = 1;
let viewTop = null; // while dragging a selection the view stays still (normally the cursor row is centered)
export function setupPat() {
  dpr = window.devicePixelRatio || 1;
  pg.font = PAT.font; PAT.CW = pg.measureText('M').width;
  PAT.x0 = 8 + 3 * PAT.CW; PAT.chW = 14 * PAT.CW;
  // as many rows as the window leaves room for (the page itself never scrolls)
  PAT.VIS = Math.max(5, Math.floor(($('#patBox').clientHeight - PAT.HDR) / PAT.RH));
  const w = Math.ceil(PAT.x0 + nch() * PAT.chW + 4), h = PAT.HDR + PAT.VIS * PAT.RH;
  pc.style.width = w + 'px'; pc.style.height = h + 'px'; pc.width = w * dpr; pc.height = h * dpr;
  view.patDirty = true;
}
export function selRect() {
  const s = ed.sel && ed.sel.pat === ed.pat ? ed.sel : { r0: ed.row, r1: ed.row, c0: ed.ch, c1: ed.ch };
  const N = song.patterns[ed.pat].rows.length;
  return { top: Math.min(s.r0, s.r1), bot: Math.min(N - 1, Math.max(s.r0, s.r1)), left: Math.min(s.c0, s.c1), right: Math.max(s.c0, s.c1) };
}
// when the cursor moves to a channel outside the visible part, the box scrolls to it
let lastCurCh = -1;
function keepCursorVisible() {
  if (ed.ch === lastCurCh) return; lastCurCh = ed.ch;
  const b = $('#patBox'), l = PAT.x0 + ed.ch * PAT.chW, r = l + PAT.chW;
  if (l - PAT.x0 < b.scrollLeft) b.scrollLeft = l - PAT.x0; else if (r > b.scrollLeft + b.clientWidth) b.scrollLeft = r - b.clientWidth;
}
export function drawPattern() {
  keepCursorVisible();
  const { RH, HDR, VIS, x0, chW, CW } = PAT;
  pg.setTransform(dpr, 0, 0, dpr, 0, 0);
  pg.font = PAT.font; pg.textBaseline = 'middle';
  const W = pc.width / dpr, H = pc.height / dpr;
  pg.fillStyle = '#0a0e13'; pg.fillRect(0, 0, W, H);
  const pat = song.patterns[ed.pat], N = pat.rows.length, top = viewTop ?? ed.row - Math.floor(VIS / 2);
  const playing = player.playing && view.vis && view.vis.pat === ed.pat, rpb = song.rowsPerBeat;
  const rowBg = r => r === ed.row ? (playing && !ed.follow ? '#1d2a3a' : (player.playing ? '#3a2c10' : '#1d2a3a'))
    : playing && !ed.follow && r === view.vis.row ? '#3a2c10' : r % (rpb * 4) === 0 ? '#1a212b' : r % rpb === 0 ? '#141a22' : '#0a0e13';
  for (let ch = 0; ch < nch(); ch++) {
    const cx = x0 + ch * chW;
    pg.fillStyle = isMuted(ch) ? '#3a1d1d' : '#151b23'; pg.fillRect(cx, 0, chW - 2, HDR - 3);
    pg.fillStyle = isMuted(ch) ? '#ff5d5d' : '#7d8896';
    pg.fillText(`${song.channels[ch].name ? `${ch + 1} ${song.channels[ch].name}` : `CHANNEL ${ch + 1}`}${isMuted(ch) ? ' MUTE' : ''}`, cx + 4, HDR / 2 - 1);
  }
  const S = ed.sel && ed.sel.pat === ed.pat ? selRect() : null;
  for (let i = 0; i < VIS; i++) {
    const r = top + i; if (r < 0 || r >= N) continue;
    const y = HDR + i * RH;
    pg.fillStyle = rowBg(r); pg.fillRect(0, y, W, RH);
    if (S && r >= S.top && r <= S.bot) { pg.fillStyle = 'rgba(79,195,247,.22)'; pg.fillRect(x0 + S.left * chW - CW * 0.6, y, (S.right - S.left + 1) * chW, RH); }
    pg.fillStyle = r % rpb === 0 ? '#c9d1d9' : '#5d6876'; pg.fillText(hex2(r), 4, y + RH / 2);
    for (let ch = 0; ch < nch(); ch++) {
      const c = pat.rows[r][ch], cx = x0 + ch * chW, ty = y + RH / 2;
      pg.fillStyle = c.n < 0 ? '#39424e' : c.n === KEYOFF ? '#ff8a65' : '#e6edf3'; pg.fillText(noteName(c.n), cx, ty);
      pg.fillStyle = c.i > 0 ? '#4fc3f7' : '#39424e'; pg.fillText(c.i > 0 ? hex2(c.i) : '··', cx + 4 * CW, ty);
      pg.fillStyle = c.v >= 0 ? '#6bd968' : '#39424e'; pg.fillText(c.v >= 0 ? hex2(c.v) : '··', cx + 7 * CW, ty);
      const vfx = c.f === FX.S || c.f === FX.I;
      pg.fillStyle = c.f >= 0 ? (vfx ? '#e58cff' : '#f2b53a') : '#39424e'; pg.fillText(c.f >= 0 ? FXCH[c.f] + hex2(c.p) : '···', cx + 10 * CW, ty);
    }
  }
  pg.strokeStyle = '#232b36'; pg.lineWidth = 1;
  for (let ch = 0; ch <= nch(); ch++) { const lx = Math.round(x0 + ch * chW - CW * 0.6) + 0.5; pg.beginPath(); pg.moveTo(lx, 0); pg.lineTo(lx, H); pg.stroke(); }
  // scrolled sideways: the row numbers stay at the left edge of the box
  const sx = $('#patBox').scrollLeft, gw = Math.round(x0 - CW * 0.6);
  if (sx > 0) {
    pg.fillStyle = '#0a0e13'; pg.fillRect(sx, 0, gw, H);
    for (let i = 0; i < VIS; i++) {
      const r = top + i; if (r < 0 || r >= N) continue;
      const y = HDR + i * RH; pg.fillStyle = rowBg(r); pg.fillRect(sx, y, gw, RH);
      pg.fillStyle = r % rpb === 0 ? '#c9d1d9' : '#5d6876'; pg.fillText(hex2(r), sx + 4, y + RH / 2);
    }
    pg.strokeStyle = '#232b36'; pg.beginPath(); pg.moveTo(sx + gw + 0.5, 0); pg.lineTo(sx + gw + 0.5, H); pg.stroke();
  }
  // cursor
  const cy = HDR + (ed.row - top) * RH, cx = x0 + ed.ch * chW + COL_OFF[ed.col] * CW;
  pg.strokeStyle = '#f2b53a'; pg.lineWidth = 1.5; pg.strokeRect(cx - 1, cy + 0.5, COL_W[ed.col] * CW + 2, RH - 1);
  $('#pNum').textContent = hex2(ed.pat);
  if (document.activeElement !== $('#pLen')) $('#pLen').value = N;
}
// the cell under the mouse, in the view that is on screen now (clamped into the pattern)
function patCellAt(e) {
  const r = pc.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const top = viewTop ?? ed.row - Math.floor(PAT.VIS / 2), N = song.patterns[ed.pat].rows.length;
  return { mx, my, ch: Math.floor((mx - PAT.x0 + PAT.CW * 0.6) / PAT.chW), row: top + Math.floor((my - PAT.HDR) / PAT.RH), N, top };
}
let patDrag = null;
pc.addEventListener('mousedown', e => {
  pc.focus();
  const { mx, my, ch, row, N, top } = patCellAt(e);
  if (ch < 0 || ch >= nch()) return;
  if (my < PAT.HDR) { muteChannel(ch); return; }
  if (row < 0 || row >= N) return;
  const c = Math.floor((mx - PAT.x0 - ch * PAT.chW) / PAT.CW);
  ed.ch = ch; ed.row = row; ed.sel = null;
  ed.col = c <= 3 ? 0 : c === 4 ? 1 : c <= 6 ? 2 : c === 7 ? 3 : c <= 9 ? 4 : c === 10 ? 5 : c === 11 ? 6 : 7;
  patDrag = { row, ch }; viewTop = top;
  view.patDirty = true;
});
window.addEventListener('mousemove', e => {
  if (!patDrag) return;
  const { ch, row, N } = patCellAt(e), r1 = clamp(row, 0, N - 1), c1 = clamp(ch, 0, nch() - 1);
  if (r1 !== patDrag.row || c1 !== patDrag.ch || ed.sel) { ed.sel = { pat: ed.pat, r0: patDrag.row, c0: patDrag.ch, r1, c1 }; view.patDirty = true; }
});
window.addEventListener('mouseup', () => { if (patDrag) { patDrag = null; viewTop = null; view.patDirty = true; } });

// ── block operations (all through setCells, so they undo)
let clip = null;
function copySel() {
  const R = selRect(), P = song.patterns[ed.pat];
  clip = [];
  for (let r = R.top; r <= R.bot; r++) clip.push(P.rows[r].slice(R.left, R.right + 1).map(c => ({ ...c })));
  setStatus(`Copied: ${clip.length} rows × ${R.right - R.left + 1} channels`);
}
function clearChanges(R) {
  const out = [];
  for (let r = R.top; r <= R.bot; r++) for (let ch = R.left; ch <= R.right; ch++) out.push({ pat: ed.pat, row: r, ch, ...emptyCell() });
  return out;
}
// edit mode off: keys that would change the pattern say so instead
const editOff = () => { setStatus('Edit mode is off: <b>Space</b> turns it on'); return true; };
export function setEditMode(on) {
  ed.edit = on; $('#patBox').classList.toggle('editing', on); view.patDirty = true;
  setStatus(on ? 'Edit mode <b>on</b>: notes are written into the pattern (Space: off)' : 'Edit mode <b>off</b>: notes only play (Space: on)');
}
function cutSel() { if (!ed.edit) return editOff(); copySel(); run(() => setCells(clearChanges(selRect()), 'cut')); }
function deleteSel() { run(() => setCells(clearChanges(selRect()), 'delete selection')); }
function paste() {
  if (!ed.edit) return editOff();
  if (!clip) return setStatus('Clipboard is empty: copy or cut a block first');
  const N = song.patterns[ed.pat].rows.length, changes = [];
  clip.forEach((row, dr) => row.forEach((c, dc) => { const r = ed.row + dr, ch = ed.ch + dc; if (r < N && ch < nch()) changes.push({ pat: ed.pat, row: r, ch, ...c }); }));
  if (run(() => setCells(changes, 'paste')))
    ed.sel = { pat: ed.pat, r0: ed.row, c0: ed.ch, r1: Math.min(N - 1, ed.row + clip.length - 1), c1: Math.min(nch() - 1, ed.ch + clip[0].length - 1) };
}

const NOTE_KEYS = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};
export function moveRow(d) { const N = song.patterns[ed.pat].rows.length; ed.row = ((ed.row + d) % N + N) % N; }
// edit the cell under the cursor; moves down by the step only if the change was valid
export const editCell = (fields, label) => { if (run(() => setCells([{ pat: ed.pat, row: ed.row, ch: ed.ch, ...fields }], label))) { moveRow(ed.step); return true; } return false; };
const NAV = { ArrowUp: -1, ArrowDown: 1, PageUp: -16, PageDown: 16 };
// the block selection grows from the cursor (rows and whole channels)
function extendSel(k) {
  const N = song.patterns[ed.pat].rows.length;
  if (!ed.sel || ed.sel.pat !== ed.pat) ed.sel = { pat: ed.pat, r0: ed.row, c0: ed.ch };
  if (k in NAV) ed.row = clamp(ed.row + NAV[k], 0, N - 1);
  else if (k === 'Home') ed.row = 0;
  else if (k === 'End') ed.row = N - 1;
  else ed.ch = clamp(ed.ch + (k === 'ArrowLeft' ? -1 : 1), 0, nch() - 1);
  ed.sel.r1 = ed.row; ed.sel.c1 = ed.ch;
}
// key-off: 1, CapsLock, or the key right of the left Shift (ISO keyboards), as in FT2
const KEYOFF_KEYS = ['Digit1', 'CapsLock', 'IntlBackslash'];
// insert: the rows from the cursor down move one down (the last falls off); delete: they move one up
function shiftRows(ins, channels) {
  const pat = song.patterns[ed.pat], N = pat.rows.length, changes = [];
  for (const ch of channels) for (let r = ed.row; r < N; r++) {
    const from = ins ? r - 1 : r + 1;
    changes.push({ pat: ed.pat, row: r, ch, ...(from >= ed.row && from < N ? pat.rows[from][ch] : emptyCell()) });
  }
  run(() => setCells(changes, ins ? 'insert row' : 'delete row'));
}
// every key that isn't a fixed shortcut: navigation, selection, note entry, hex digits
function onKey(e) {
  const k = e.key, code = e.code, clears = k === 'Delete' || (k === 'Backspace' && !e.shiftKey);
  const pat = song.patterns[ed.pat], N = pat.rows.length, cell = pat.rows[ed.row][ed.ch];
  let handled = true;
  ensureAudio();
  // navigation; with Shift it extends the block selection (rows and whole channels)
  if (e.shiftKey && (k === 'PageUp' || k === 'PageDown' || k === 'Home' || k === 'End')) extendSel(k);
  else if (k === 'Escape') ed.sel = null;
  else if (k in NAV) { moveRow(NAV[k]); ed.sel = null; }
  else if (k === 'Home') { ed.row = 0; ed.sel = null; }
  else if (k === 'End') { ed.row = N - 1; ed.sel = null; }
  else if (k === 'ArrowLeft') { if (--ed.col < 0) { ed.col = 7; ed.ch = (ed.ch + nch() - 1) % nch(); } ed.sel = null; }
  else if (k === 'ArrowRight') { if (++ed.col > 7) { ed.col = 0; ed.ch = (ed.ch + 1) % nch(); } ed.sel = null; }
  else if (k === 'Tab') { ed.ch = (ed.ch + (e.shiftKey ? nch() - 1 : 1)) % nch(); ed.col = 0; ed.sel = null; }
  // edit mode off: the note keys play the current instrument on this channel; nothing else changes the pattern
  else if (!ed.edit && ed.col === 0 && code in NOTE_KEYS) { if (!e.repeat) previewNote(instruments[ed.inst], ed.ch, clamp(ed.oct * 12 + NOTE_KEYS[code], 0, 95)); }
  else if (!ed.edit && (clears || k === 'Insert' || k === 'Backspace' || (ed.col === 0 && KEYOFF_KEYS.includes(code)) || (ed.col > 0 && k.length === 1 && !e.metaKey && !e.ctrlKey))) editOff();
  // Backspace is the Mac's "delete" key: it clears, like Del (FT2's Backspace deletes the note above and pulls the
  // channel up; we don't: it surprised everyone). Shift+Backspace pulls the rows below up
  else if (clears && ed.sel && ed.sel.pat === ed.pat) deleteSel();
  else if (clears) {
    editCell(e.shiftKey ? emptyCell() : ed.col === 0 ? { n: -1, i: 0 } : ed.col <= 2 ? { i: 0 } : ed.col <= 4 ? { v: -1 } : { f: -1, p: 0 }, 'clear');
  }
  // Insert (Alt+Backspace on keyboards without it) pushes the rest of the channel down; Shift+Backspace pulls it up
  else if (k === 'Insert' || (k === 'Backspace' && e.shiftKey)) shiftRows(k !== 'Backspace', [ed.ch]);
  else if (ed.col === 0 && KEYOFF_KEYS.includes(code)) editCell({ n: KEYOFF, i: 0 }, 'key-off');
  else if (ed.col === 0 && code in NOTE_KEYS) {
    if (e.repeat) { e.preventDefault(); return false; }
    const n = clamp(ed.oct * 12 + NOTE_KEYS[code], 0, 95), ch = ed.ch;
    if (editCell(instruments[ed.inst] ? { n, i: ed.inst } : { n }, 'note')) previewNote(instruments[ed.inst], ch, n);
  }
  else if (ed.col > 0 && k.length === 1) {
    const ch = k.toUpperCase(), hv = parseInt(ch, 16);
    if (ed.col === 5 && FXCH.includes(ch)) editCell({ f: FX[ch] }, 'effect');
    else if (/^[0-9A-F]$/.test(ch)) {
      const hi = ed.col === 1 || ed.col === 3 || ed.col === 6;
      const setNib = (val) => hi ? (hv << 4) | (val & 15) : (val & 0xF0) | hv;
      editCell(ed.col <= 2 ? { i: setNib(cell.i) } : ed.col <= 4 ? { v: setNib(Math.max(0, cell.v)) } : { p: setNib(cell.p) },
        ed.col <= 2 ? 'instrument' : ed.col <= 4 ? 'volume' : 'effect parameter');
    } else handled = false;
  }
  else handled = false;
  return handled;
}

export const focusPattern = () => pc.focus();

// ── FT2 shortcuts [ZEN-FT2]
const edits = fn => (...a) => ed.edit ? fn(...a) : editOff(); // keys that change the pattern need edit mode
const allChannels = () => Array.from({ length: nch() }, (_, ch) => ch);
// a block op on a whole channel or the whole pattern: the selection is set for the op, then put back
function onBlock(c0, c1, fn) {
  const keep = { sel: ed.sel, row: ed.row, ch: ed.ch };
  ed.sel = { pat: ed.pat, r0: 0, r1: song.patterns[ed.pat].rows.length - 1, c0, c1 }; ed.row = 0; ed.ch = c0;
  fn();
  if (fn !== paste) Object.assign(ed, keep);
}
const track = fn => () => onBlock(ed.ch, ed.ch, fn), whole = fn => () => onBlock(0, nch() - 1, fn);
function setOctave(o) { ed.oct = o; $('#tOct').value = o; setStatus(`Octave ${o}`); }
function stepBy(d) { ed.step = (ed.step + d + 17) % 17; $('#tStep').value = ed.step; setStatus(`Edit step ${ed.step}`); }
function jumpRow(q) { ed.row = Math.floor(song.patterns[ed.pat].rows.length * q / 4); ed.sel = null; }
const goTrack = ch => () => { if (ch < nch()) { ed.ch = ch; ed.col = 0; ed.sel = null; } };
// Space: stops; when stopped, turns edit mode on/off
function spaceKey(e) { if (e.repeat) return; if (player.playing) userStop(); else setEditMode(!ed.edit); }
// Enter: plays the song from the pattern being edited (from the selected order position)
const playFromHere = () => startPlay('song', null, song.order[ed.ord] === ed.pat ? ed.ord : Math.max(0, song.order.indexOf(ed.pat)));
// Shift+↑↓: the previous / next instrument that exists
function instBy(d) { for (let i = ed.inst + d; i > 0 && i < instruments.length; i += d) if (instruments[i]) { selectInst(i); setStatus(`Instrument ${hex2(i)}: ${instruments[i].name}`); return; } }
function toggleFollow() { ed.follow = !ed.follow; $('#tFollow').checked = ed.follow; setStatus(`Follow ${ed.follow ? 'on' : 'off'}`); }
const keys = {
  'Space': spaceKey, 'Enter': playFromHere, 'Mod+Enter': playPattern, 'Mod+KeyF': toggleFollow,
  'Shift+Enter': () => startPlay('pattern', () => ed.pat, 0, ed.row),
  'Shift+ArrowUp': () => instBy(-1), 'Shift+ArrowDown': () => instBy(1),
  'Shift+ArrowLeft': () => selectOrd(ed.ord - 1), 'Shift+ArrowRight': () => selectOrd(ed.ord + 1),
  'Backquote': () => stepBy(1), 'Shift+Backquote': () => stepBy(-1),
  'F9': () => jumpRow(0), 'F10': () => jumpRow(1), 'F11': () => jumpRow(2), 'F12': () => jumpRow(3),
  'Shift+KeyM': () => muteChannel(ed.ch), 'Shift+KeyU': () => allChannels().forEach(ch => isMuted(ch) && muteChannel(ch)),
  'Mod+Shift+KeyM': () => allChannels().forEach(muteChannel),
  'Mod+ArrowLeft': () => $('#oPrev').click(), 'Mod+ArrowRight': () => $('#oNext').click(),
  'Mod+F9': () => $('#oDel').click(), 'Mod+F10': () => $('#oAdd').click(), 'Mod+F11': () => $('#oPrev').click(), 'Mod+F12': () => $('#oNext').click(),
  'Mod+Delete': edits(() => editCell({ v: -1, f: -1, p: 0 }, 'clear volume and effect')),
  'Alt+Delete': edits(() => editCell({ f: -1, p: 0 }, 'clear effect')),
  'Alt+Backspace': edits(() => shiftRows(true, [ed.ch])), 'Shift+Insert': edits(() => shiftRows(true, allChannels())),
  'Shift+Alt+Backspace': edits(() => shiftRows(true, allChannels())),
  'Mod+KeyC': copySel, 'Mod+KeyX': cutSel, 'Mod+KeyV': paste,
  'Alt+F3': cutSel, 'Alt+F4': copySel, 'Alt+F5': paste,
  'Shift+F3': track(cutSel), 'Shift+F4': track(copySel), 'Shift+F5': track(paste),
  'Mod+F3': whole(cutSel), 'Mod+F4': whole(copySel), 'Mod+F5': whole(paste),
};
for (let o = 0; o < 8; o++) keys[`F${o + 1}`] = () => setOctave(o);
// Alt+arrows select a block (FT2); Shift+arrows pick the instrument and the order position
for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) keys[`Alt+${k}`] = keys[`Shift+Alt+${k}`] = () => extendSel(k);
// Alt + the top / middle letter row jumps to channel 0–7 / 8–15
['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'].forEach((c, ch) => { keys[`Alt+${c}`] = goTrack(ch); });
export const patternScreen = { name: 'pattern', keys, onKey };
new ResizeObserver(() => setupPat()).observe($('#patBox'));
$('#patBox').addEventListener('scroll', () => { view.patDirty = true; });
