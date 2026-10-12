// File buttons, drag & drop and the save dialog. The work itself is in ../io.js (shared with MCP);
// this module only asks for files and reports the result in the status bar.
import { hex2 } from '../util.js';
import { song, instruments } from '../core/song.js';
import { CmdError, newSong } from '../core/commands.js';
import { importVideo, replaceVideo, buildSong, whyNotSavable, readSong, instrumentVideo, instrumentVideoType, safeName } from '../io.js';
import { $, ed, run, setStatus, showError, escHtml } from './common.js';
import { curInst } from './instrumentPanel.js';

export { safeName };
const progress = text => setStatus(escHtml(text));

export async function loadVideoFile(file) {
  try {
    const { idx, I, fromMetadata } = await importVideo(file, progress);
    setStatus(fromMetadata ? `${escHtml(file.name)} loaded → instrument ${hex2(idx)} ${escHtml(I.name)} (settings from the video's metadata)`
      : `${escHtml(file.name)} loaded → instrument ${hex2(idx)} (hit found automatically at ${I.hit.toFixed(3)}s, check it)`);
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    showError(`Couldn't load: ${file.name} (${err.message})`);
  }
}
async function swapVideo(idx, file) {
  try {
    const cmd = await replaceVideo(idx, file, progress);
    const msg = `instrument ${hex2(idx)} ${instruments[idx].name}: video → ${file.name}, settings kept`;
    if (cmd.notes.length) showError(`${msg} (the new video is shorter: ${cmd.notes.join(', ')})`); else setStatus(escHtml(msg));
  } catch (err) {
    if (err instanceof CmdError) return showError(err.message);
    console.error(err); showError(`Couldn't replace the video: ${file.name} (${err.message})`);
  }
}
export async function openSong(file) {
  try {
    setStatus(`Opening: ${escHtml(file.name)}`);
    const res = await readSong(file, progress);
    if (res.errors) {
      const errs = res.errors; console.warn(errs.join('\n'));
      const more = errs.length > 6 ? `<br>… and ${errs.length - 6} more errors (all in the console)` : '';
      return setStatus(`<span class="err">⚠ Couldn't open ${escHtml(file.name)}:<br>${errs.slice(0, 6).map(escHtml).join('<br>')}${more}</span>`);
    }
    setStatus(`Opened: ${escHtml(file.name)} (${song.patterns.length} patterns, ${instruments.length - 1} instruments, ${res.nVideos} videos)`);
  } catch (err) {
    console.error(err); showError(`Couldn't open ${file.name}: ${err.message}`);
  }
}

// "Save as" dialog where the browser has one (Chrome/Edge), otherwise a plain download.
// The dialog has to open right at the click, so it is asked first and make() builds the file afterwards.
// Returns { blob, name }, or null when the user cancels.
export async function saveAs(fname, desc, mime, ext, make) {
  let handle = null;
  if (window.showSaveFilePicker) {
    try { handle = await showSaveFilePicker({ suggestedName: fname, types: [{ description: desc, accept: { [mime]: [ext] } }] }); }
    catch (e) { if (e.name === 'AbortError') { setStatus('Save cancelled'); return null; } } // no click to ride on → download
  }
  const blob = await make();
  if (handle) { const w = await handle.createWritable(); await w.write(blob); await w.close(); return { blob, name: handle.name }; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { blob, name: fname };
}
async function saveSong() {
  const why = whyNotSavable(); if (why) return showError(`Couldn't save: ${why}`);
  try {
    const saved = await saveAs(safeName(song.title.trim() || 'song') + '.poop', 'PoopTracker song', 'application/octet-stream', '.poop', () => { setStatus('Saving…'); return buildSong(); });
    if (saved) setStatus(`Saved: ${escHtml(saved.name)} (${(saved.blob.size / 1048576).toFixed(1)} MB, ${saved.blob.nVideos} videos)`);
  } catch (err) { showError(`Couldn't save: ${err.message}`); }
}
export async function saveInstrumentVideo(I) {
  let type;
  try { type = instrumentVideoType(I); } catch (err) { return showError(err.message); }
  try {
    const saved = await saveAs(safeName(I.name.trim() || 'instrument') + type.ext, 'Video', type.mime, type.ext, () => instrumentVideo(I));
    if (saved) setStatus(`Saved: ${escHtml(saved.name)} (instrument ${escHtml(I.name)} is in the video's metadata)`);
  } catch (err) { showError(`Couldn't save: ${err.message}`); }
}

$('#bLoad').onclick = () => $('#file').click();
$('#file').onchange = async e => { for (const f of e.target.files) await loadVideoFile(f); e.target.value = ''; };
$('#bSwap').onclick = () => { if (curInst()) $('#fileSwap').click(); };
$('#fileSwap').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await swapVideo(ed.inst, f); };
$('#bSave').onclick = () => saveSong();
$('#bNew').onclick = () => { if (run(() => newSong())) setStatus('New song. Ctrl+Z brings the previous one back.'); };
$('#bOpen').onclick = () => $('#songFile').click();
$('#songFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await openSong(f); };

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drop').style.display = 'flex'; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').style.display = 'none'; } });
window.addEventListener('dragover', e => e.preventDefault());
const isVideo = f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name);
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#drop').style.display = 'none';
  for (const f of e.dataTransfer.files) if (/\.poop$/i.test(f.name)) return openSong(f);
  // one video dropped on an instrument in the list: that instrument's video is replaced
  const row = e.target.closest && e.target.closest('.inst'), vids = [...e.dataTransfer.files].filter(isVideo);
  if (row && vids.length === 1) return swapVideo(+row.dataset.idx, vids[0]);
  for (const f of vids) await loadVideoFile(f);
});
