// What the screens share: the editor state, the status bar, and the way the UI runs commands.
import { clamp } from '../util.js';
import { CmdError, exec } from '../core/commands.js';

export const $ = s => document.querySelector(s);
export const escHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const setStatus = html => { $('#status').innerHTML = html; };
export const showError = msg => setStatus(`<span class="err">⚠ ${escHtml(msg)}</span>`);
export const num = el => el.value.trim() === '' ? NaN : +el.value;

// editor state (not part of the song): cursor, selection, current pattern / instrument / order position
// sel = block selection in the current pattern (whole cells): anchor r0/c0, end r1/c1
export const ed = { pat: 0, row: 0, ch: 0, col: 0, oct: 4, step: 1, inst: 1, follow: true, sel: null, ord: 0 };
// view: patDirty = the pattern canvas needs a redraw; vis = the row being heard right now (while playing)
export const view = { patDirty: true, vis: null };

// Every panel registers how it syncs itself with the song; refreshUI() runs them all
// (after commands, undo/redo, a rejected edit, or a whole new song).
const refreshers = [];
export const onRefresh = fn => refreshers.push(fn);
export function refreshUI() { refreshers.forEach(fn => fn()); view.patDirty = true; }

// for the UI: true if applied (or nothing to do); on error shows the message and resyncs the UI
export function run(factory) {
  try { exec(factory); return true; } catch (e) { if (!(e instanceof CmdError)) throw e; showError(e.message); refreshUI(); return false; }
}
export const clampEditor = (song, nch) => {
  ed.pat = clamp(ed.pat, 0, song.patterns.length - 1);
  ed.row = clamp(ed.row, 0, song.patterns[ed.pat].rows.length - 1);
  ed.ord = clamp(ed.ord, 0, song.order.length - 1);
  ed.ch = clamp(ed.ch, 0, nch - 1);
  if (ed.sel) { ed.sel.c0 = Math.min(ed.sel.c0, nch - 1); ed.sel.c1 = Math.min(ed.sel.c1, nch - 1); }
};
