// The library: ready instruments shared by PoopTracker users, in the pooptracker-instruments repository. Each one is a
// video with its instrument in its metadata, so it is loaded as Load or a drop would load it. index.json lists them;
// it is written from the videos themselves, never by hand.
//
// The list and the videos come from jsDelivr at the repository's latest commit (asked of GitHub), so a new instrument
// shows up at once and the list never points at videos it doesn't know. Without GitHub's answer: @main, which jsDelivr
// can keep for up to a day. ?library=<url> loads it from elsewhere (the tests: a copy served with the app).
import { hex2 } from '../util.js';
import { instruments } from '../core/song.js';
import { CmdError } from '../core/commands.js';
import { importVideo, replaceVideo, NO_SOUND } from '../io.js';
import { $, ed, setStatus } from './common.js';

const REPO = 'miratcan/pooptracker-instruments', FORMAT = 1;
const CUSTOM = new URLSearchParams(location.search).get('library');
const dlg = $('#libDlg'), list = $('#libList'), find = $('#libFind'), prev = $('#libPrev'), wait = $('#libPrevNow');
let lib = null;    // { base, items: [{ path, name, length, bytes, tags?, source? }] }
let shown = [];    // the items the search lets through, in list order
let sel = null;    // the selected item
let busy = false;

const now = text => { $('#libNow').textContent = text; };
const url = item => lib.base + item.path.split('/').map(encodeURIComponent).join('/');
const folder = item => item.path.split('/').slice(0, -1).join('/');
const size = n => n < 1048576 ? Math.ceil(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const isLink = s => /^https?:\/\/\S+$/.test(s);

async function base() {
  if (CUSTOM) return CUSTOM.endsWith('/') ? CUSTOM : CUSTOM + '/';
  let at = 'main';
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: 'application/vnd.github.sha' } });
    if (res.ok) { const sha = (await res.text()).trim(); if (/^[0-9a-f]{40}$/.test(sha)) at = sha; }
  } catch {} // offline, or GitHub's hourly limit: @main
  return `https://cdn.jsdelivr.net/gh/${REPO}@${at}/`;
}
async function load() {
  lib = null; sel = null; draw(); now('Loading the list…');
  try {
    const b = await base(), res = await fetch(b + 'index.json');
    if (!res.ok) throw new Error(`the list couldn't be loaded (${res.status})`);
    const data = await res.json();
    if (data.format !== FORMAT || !Array.isArray(data.instruments)) throw new Error('the list is in a newer format: reload PoopTracker');
    lib = { base: b, items: data.instruments.filter(x => x && typeof x.path === 'string' && typeof x.name === 'string') };
    now(`${lib.items.length} instruments`);
  } catch (err) {
    now(`⚠ ${err.message === 'Failed to fetch' ? "the library can't be reached (offline?)" : err.message}`);
  }
  draw();
}

// every word of the search in its name, tags or folder
function matches(item, words) {
  const text = [item.name, ...(item.tags ?? []), item.path].join(' ').toLowerCase();
  return words.every(w => text.includes(w));
}
function draw() {
  const words = find.value.toLowerCase().split(/[\s,#]+/).filter(Boolean);
  shown = lib ? lib.items.filter(x => matches(x, words)).sort((a, b) => folder(a).localeCompare(folder(b)) || a.name.localeCompare(b.name)) : [];
  if (sel && !shown.includes(sel)) sel = null;
  list.replaceChildren();
  let group = null;
  for (const item of shown) {
    if (folder(item) !== group) {
      group = folder(item);
      const h = document.createElement('div'); h.className = 'libGroup'; h.textContent = group; list.append(h);
    }
    const row = document.createElement('div'), name = document.createElement('span'), tags = document.createElement('span'), len = document.createElement('span');
    row.className = 'libItem' + (item === sel ? ' sel' : ''); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', item === sel);
    name.textContent = item.name; tags.className = 'tags'; tags.textContent = (item.tags ?? []).map(t => '#' + t).join(' ');
    len.className = 'dim'; len.textContent = `${(+item.length).toFixed(2)} s`;
    row.append(name, tags, len);
    row.onclick = () => pick(item);
    row.ondblclick = () => take(item, false);
    list.append(row);
  }
  if (lib && !shown.length) { const p = document.createElement('div'); p.className = 'libGroup'; p.textContent = 'nothing found'; list.append(p); }
  side();
}
// the selected one: heard and seen once, with what it is. The video comes over the network: until its first frame is
// in, the picture says so instead of staying black
function pick(item) {
  if (item === sel && prev.src) return;
  sel = item; draw();
  list.querySelector('.libItem.sel')?.scrollIntoView({ block: 'nearest' });
  waiting('Loading…');
  prev.src = url(item); prev.play().catch(() => {});
}
function waiting(text, err = false) { wait.hidden = !text; wait.textContent = text ?? ''; wait.classList.toggle('err', err); }
prev.addEventListener('loadeddata', () => waiting(null));
prev.addEventListener('error', () => { if (prev.getAttribute('src')) waiting("⚠ the video couldn't be loaded", true); });
function side() {
  const info = $('#libInfo'); info.replaceChildren();
  $('#libAdd').disabled = $('#libRepl').disabled = !sel || busy;
  if (!sel) { prev.removeAttribute('src'); prev.load(); waiting(null); return; }
  info.append(size(sel.bytes));
  if (sel.source) {
    info.append(document.createElement('br'), 'from: ');
    if (isLink(sel.source)) { const a = document.createElement('a'); a.href = sel.source; a.target = '_blank'; a.rel = 'noopener'; a.textContent = sel.source; info.append(a); }
    else info.append(sel.source);
  }
}

// into the song: a new instrument, or the selected one's video (replace), with all the settings in its metadata
async function take(item, replace) {
  if (!item || busy) return;
  const idx = ed.inst;
  if (replace && !instruments[idx]) return now('⚠ Select the instrument whose video it replaces');
  busy = true; side();
  const progress = t => now(t);
  try {
    now(`Loading ${item.name}…`);
    const res = await fetch(url(item));
    if (!res.ok) throw new Error(`the video couldn't be loaded (${res.status})`);
    const file = new File([await res.blob()], item.path.split('/').pop(), { type: 'video/mp4' });
    if (replace) {
      const { noSound } = await replaceVideo(idx, file, progress);
      now(`${item.name} → instrument ${hex2(idx)}` + (noSound ? NO_SOUND : ''));
    } else {
      const { idx: n, noSound } = await importVideo(file, progress);
      now(`${item.name} → instrument ${hex2(n)}` + (noSound ? NO_SOUND : ''));
    }
    setStatus(`From the library: ${$('#libNow').textContent}`);
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    now(`⚠ Couldn't load ${item.name}: ${err.message === 'Failed to fetch' ? "the library can't be reached (offline?)" : err.message}`);
  } finally { busy = false; side(); }
}

$('#bLib').onclick = () => { dlg.showModal(); find.select(); if (!lib) load(); };
dlg.addEventListener('close', () => prev.pause());
$('#libReload').onclick = load;
find.oninput = draw;
prev.onclick = () => { if (prev.src) { prev.currentTime = 0; prev.play().catch(() => {}); } };
$('#libAdd').onclick = () => take(sel, false);
$('#libRepl').onclick = () => take(sel, true);
// ↑↓ move through the list (from the search too), Enter adds, Shift+Enter replaces
dlg.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!shown.length) return;
    e.preventDefault();
    const i = shown.indexOf(sel), j = sel ? Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))) : 0;
    pick(shown[j]);
  } else if (e.key === 'Enter' && sel && !e.target.matches('button, a')) { e.preventDefault(); take(sel, e.shiftKey); }
});
