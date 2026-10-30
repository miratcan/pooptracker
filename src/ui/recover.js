// Recover: the songs kept in the browser (../autosave.js), newest first, and the one clicked opens in place of this
// one. This one stays kept as it was, so it is in the list the next time.
import { song, instruments } from '../core/song.js';
import * as autosave from '../autosave.js';
import { $, setStatus, showError, escHtml } from './common.js';
import { opening } from './opening.js';
import { setSongFile } from './files.js';

const dlg = $('#recDlg'), list = $('#recList');

export const songName = s => s.title || 'untitled';
const count = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;
export function ago(at) {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 24 * 7) return `${Math.round(m / 60 / 24)} days ago`;
  return new Date(at).toLocaleDateString();
}

async function draw() {
  list.replaceChildren();
  let songs = [];
  try { songs = await autosave.recent(); } catch (err) { console.warn("Couldn't read the kept songs:", err); }
  if (!songs.length) { const p = document.createElement('p'); p.className = 'dim'; p.textContent = 'No other songs kept yet: each one you work on is kept here.'; list.append(p); }
  for (const s of songs) {
    const b = document.createElement('button'), name = document.createElement('span'), what = document.createElement('span');
    b.className = 'recItem'; name.textContent = songName(s);
    what.className = 'dim'; what.textContent = `${ago(s.at)} · ${count(s.patterns, 'pattern')}, ${count(s.instruments, 'instrument')}`;
    b.append(name, what);
    b.onclick = () => { dlg.close(); open(s); };
    list.append(b);
  }
  list.querySelector('button')?.focus();
}

async function open(s) {
  try {
    const handle = await opening(`Recovering ${songName(s)}`, p => autosave.restore(s.id, p));
    setSongFile(handle);
    setStatus(`Recovered: ${escHtml(songName(s))} (${count(song.patterns.length, 'pattern')}, ${count(instruments.length - 1, 'instrument')}).` +
      (handle ? ` <b>Save</b> writes over ${escHtml(handle.name)}.` : ''));
  } catch (err) {
    console.error(err); showError(`Couldn't recover ${songName(s)}: ${err.message}`);
  }
}

$('#bRecover').onclick = () => { dlg.showModal(); draw(); };
