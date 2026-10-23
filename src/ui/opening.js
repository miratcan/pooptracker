// While a whole song opens, a box in the middle of the screen says how far it has got: reading its videos takes a
// while, and the song under it is about to be replaced, so nothing can be touched meanwhile. Esc doesn't close it;
// it closes itself when the song is in (or isn't). It shows up with the first video, so a quick "no song" never flashes.
import { $ } from './common.js';

const dlg = $('#opening'), bar = $('#openBar');
dlg.addEventListener('cancel', e => e.preventDefault());

// work(progress) opens the song; progress(text, done) moves the box (done: 0–1). Returns what work returns.
export async function opening(title, work) {
  const progress = (text, done = 0) => {
    if (!dlg.open) { $('#openTitle').textContent = title; dlg.showModal(); }
    $('#openNow').textContent = text;
    bar.style.width = `${Math.round(done * 100)}%`;
  };
  try { return await work(progress); }
  finally { dlg.close(); }
}
