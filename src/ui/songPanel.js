// Song-level controls: tempo fields, pattern buttons, channel buttons and the order list.
import { MAX_CH, clamp, hex2 } from '../util.js';
import { song, nch, newPattern, clonePattern } from '../core/song.js';
import { setSong, setOrder, addPattern, deletePattern, setPatternLength, addChannel, deleteChannel } from '../core/commands.js';
import { $, ed, view, run, num } from './common.js';

$('#tBpm').onchange = e => run(() => setSong({ bpm: num(e.target) }, 'BPM'));
$('#tSpd').onchange = e => run(() => setSong({ speed: num(e.target) }, 'speed'));
$('#tTitle').onchange = e => run(() => setSong({ title: e.target.value.trim() }, 'title'));
$('#tOct').onchange = e => { ed.oct = clamp(+e.target.value, 0, 7); };
$('#tStep').onchange = e => { ed.step = clamp(+e.target.value, 0, 16); };
$('#tFollow').onchange = e => { ed.follow = e.target.checked; };

export function gotoPat(i) { ed.pat = clamp(i, 0, song.patterns.length - 1); ed.row = Math.min(ed.row, song.patterns[ed.pat].rows.length - 1); ed.sel = null; view.patDirty = true; }
$('#pPrev').onclick = () => gotoPat(ed.pat - 1);
$('#pNext').onclick = () => gotoPat(ed.pat + 1);
$('#pAdd').onclick = () => run(() => addPattern(newPattern(song.patterns[ed.pat].rows.length), 'new empty pattern'));
$('#pNew').onclick = () => run(() => addPattern(clonePattern(song.patterns[ed.pat]), `copy of pattern ${hex2(ed.pat)}`));
$('#pDel').onclick = () => run(() => deletePattern(ed.pat));
$('#cAdd').onclick = () => run(() => addChannel());
$('#cDel').onclick = () => run(() => deleteChannel(ed.ch));
$('#pLen').onchange = e => run(() => setPatternLength(ed.pat, num(e.target)));

// order list: ed.ord = selected position; every edit is one setOrder command
function renderOrder() {
  const el = $('#ordList'); el.innerHTML = '';
  song.order.forEach((p, k) => {
    const d = document.createElement('div'); d.className = 'ord' + (k === ed.ord ? ' sel' : '');
    d.innerHTML = `${hex2(k)} · <b>${hex2(p)}</b>`;
    d.onclick = () => { ed.ord = k; gotoPat(p); renderOrder(); };
    el.appendChild(d);
  });
}
// fn edits a copy of the order and returns the position to select afterwards (null = no change)
function orderEdit(fn, label) {
  const o = song.order.slice(), k = fn(o);
  if (k == null) return;
  if (run(() => setOrder(o, label))) { ed.ord = k; gotoPat(song.order[k]); renderOrder(); }
}
const swapOrd = (o, a, b) => { if (b < 0 || b >= o.length) return null; [o[a], o[b]] = [o[b], o[a]]; return b; };
$('#oAdd').onclick = () => orderEdit(o => { o.splice(ed.ord + 1, 0, ed.pat); return ed.ord + 1; }, 'order: insert');
$('#oDel').onclick = () => orderEdit(o => { o.splice(ed.ord, 1); return Math.min(ed.ord, o.length - 1); }, 'order: delete');
$('#oUp').onclick = () => orderEdit(o => swapOrd(o, ed.ord, ed.ord - 1), 'order: up');
$('#oDown').onclick = () => orderEdit(o => swapOrd(o, ed.ord, ed.ord + 1), 'order: down');
$('#oPrev').onclick = () => orderEdit(o => { o[ed.ord]--; return ed.ord; }, 'order: pattern number');
$('#oNext').onclick = () => orderEdit(o => { o[ed.ord]++; return ed.ord; }, 'order: pattern number');

export function refreshSongPanel() {
  $('#tBpm').value = song.bpm; $('#tSpd').value = song.speed; $('#tTitle').value = song.title;
  $('#cDel').disabled = nch() <= 1; $('#cAdd').disabled = nch() >= MAX_CH;
  renderOrder();
}
