// File buttons, drag & drop and the save dialog. The work itself is in ../io.js (shared with MCP);
// this module only asks for files and reports the result in the status bar.
import { hex2 } from '../util.js';
import { song, instruments } from '../core/song.js';
import { CmdError, newSong, onChange } from '../core/commands.js';
import { NO_SOUND, importVideo, replaceVideo, newInstrument, trimInstrument, buildSong, whyNotSavable, readSong, instrumentVideo, instrumentVideoType, safeName, importMidi } from '../io.js';
import { $, ed, run, setStatus, showError, escHtml } from './common.js';
import { curInst } from './instrumentPanel.js';
import { activeScreen } from './screens.js';
import { benchScreen, putOnBench } from './bench.js';
import { opening } from './opening.js';
import * as autosave from '../autosave.js';

export { safeName };
const progress = text => setStatus(escHtml(text));

export async function loadVideoFile(file) {
  try {
    const { idx, I, fromMetadata, noSound } = await importVideo(file, progress);
    setStatus((fromMetadata ? `${escHtml(file.name)} loaded → instrument ${hex2(idx)} ${escHtml(I.name)} (settings from the video's metadata)`
      : `${escHtml(file.name)} loaded → instrument ${hex2(idx)} (hit found automatically at ${I.hit.toFixed(3)}s, check it)`) + (noSound ? `<span class="err">${NO_SOUND}</span>` : ''));
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    showError(`Couldn't load: ${file.name} (${err.message})`);
  }
}
async function swapVideo(idx, file) {
  try {
    const { fromMetadata, noSound } = await replaceVideo(idx, file, progress), I = instruments[idx];
    setStatus(escHtml(`instrument ${hex2(idx)} ${I.name}: video → ${file.name}, ` +
      (fromMetadata ? 'with all its settings from the video\'s metadata' : `sound kept; hit found automatically at ${I.hit.toFixed(3)}s, check it`)) + (noSound ? `<span class="err">${NO_SOUND}</span>` : ''));
  } catch (err) {
    if (err instanceof CmdError) return showError(err.message);
    console.error(err); showError(`Couldn't replace the video: ${file.name} (${err.message})`);
  }
}
export async function trimInstrumentVideo(idx) {
  const I = instruments[idx]; if (!I) return;
  try {
    const size = I.video.file?.size;
    if (!await trimInstrument(idx, progress)) return setStatus(`${hex2(idx)} ${escHtml(I.name)}: the region is already the whole video`);
    setStatus(escHtml(`${hex2(idx)} ${I.name}: video trimmed to its region (${I.end.toFixed(3)} s, ${mb(size)} → ${mb(I.video.file.size)}, not re-encoded; Ctrl+Z brings the whole video back)`));
  } catch (err) {
    if (err instanceof CmdError) return showError(err.message);
    console.error(err); showError(`Couldn't trim: ${err.message}`);
  }
}
const mb = n => n < 1048576 ? Math.ceil(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
// The file the song was opened from (or last saved as), where the browser lets us write to it (Chrome/Edge: a
// FileSystemFileHandle): Save writes over it, without a dialog or a download. Kept with the song in the browser, so a
// reload still saves there. Forgotten when the whole song is replaced (Zap, a MIDI import, MCP opening one, their
// undo): Save then asks where, and never writes a song over another one's file.
let songFile = null;
export function setSongFile(handle = null) { if (handle === songFile) return; songFile = handle; autosave.keepHandle(handle).catch(() => {}); }
onChange(c => { if (c.scope === 'all') setSongFile(null); });
export async function openSong(file, handle = null) {
  try {
    setStatus(`Opening: ${escHtml(file.name)}`);
    const res = await opening(`Opening ${file.name}`, p => readSong(file, p));
    if (res.errors) {
      const errs = res.errors; console.warn(errs.join('\n'));
      const more = errs.length > 6 ? `<br>… and ${errs.length - 6} more errors (all in the console)` : '';
      return setStatus(`<span class="err">⚠ Couldn't open ${escHtml(file.name)}:<br>${errs.slice(0, 6).map(escHtml).join('<br>')}${more}</span>`);
    }
    setSongFile(handle);
    setStatus(`Opened: ${escHtml(file.name)} (${song.patterns.length} patterns, ${instruments.length - 1} instruments, ${res.nVideos} videos)` +
      (handle ? '. <b>Save</b> writes over it.' : ''));
  } catch (err) {
    console.error(err); showError(`Couldn't open ${file.name}: ${err.message}`);
  }
}

// "Save as" dialog where the browser has one (Chrome/Edge), otherwise a plain download.
// The dialog has to open right at the click, so it is asked first and make() builds the file afterwards.
// Returns { blob, name, handle } (handle: the file chosen in the dialog, null for a download), or null when the user cancels.
export async function saveAs(fname, desc, mime, ext, make) {
  let handle = null;
  if (window.showSaveFilePicker) {
    try { handle = await showSaveFilePicker({ suggestedName: fname, types: [{ description: desc, accept: { [mime]: [ext] } }] }); }
    catch (e) { if (e.name === 'AbortError') { setStatus('Save cancelled'); return null; } } // no click to ride on → download
  }
  const blob = await make();
  if (handle) { await writeTo(handle, blob); return { blob, name: handle.name, handle }; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { blob, name: fname, handle: null };
}
async function writeTo(handle, blob) { const w = await handle.createWritable(); await w.write(blob); await w.close(); }
// may we write to it? Asked of the browser at the click (Chrome asks the user once); false: no
async function writable(handle) {
  const mode = { mode: 'readwrite' };
  try { return (await handle.queryPermission(mode)) === 'granted' || (await handle.requestPermission(mode)) === 'granted'; } catch { return false; }
}
// Save: over the file the song came from; without one (or with as: Shift+click, ⌘/Ctrl+Shift+S) the dialog asks where,
// and that file is the song's from then on
async function saveSong(as = false) {
  const why = whyNotSavable(); if (why) return showError(`Couldn't save: ${why}`);
  const mb = b => `${(b.size / 1048576).toFixed(1)} MB, ${b.nVideos} videos`;
  try {
    if (songFile && !as && await writable(songFile)) {
      setStatus('Saving…');
      const blob = await buildSong();
      try { await writeTo(songFile, blob); }
      catch (err) { const name = songFile.name; setSongFile(null); return showError(`Couldn't write over ${name} (${err.message}): ⌘/Ctrl+S again asks where to save`); }
      return setStatus(`Saved over ${escHtml(songFile.name)} (${mb(blob)})`);
    }
    const saved = await saveAs(safeName(song.title.trim() || 'song') + '.poop', 'PoopTracker song', 'application/octet-stream', '.poop', () => { setStatus('Saving…'); return buildSong(); });
    if (!saved) return;
    if (saved.handle) setSongFile(saved.handle);
    setStatus(`Saved: ${escHtml(saved.name)} (${mb(saved.blob)})` + (saved.handle ? '. From now on <b>Save</b> writes over it.' : ''));
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

// Load gives the selected instrument a video (how it sounds is kept); with none selected, the video is a new one.
// New adds an empty instrument to load into: Load never adds one by surprise.
$('#bLoad').onclick = () => $('#file').click();
$('#file').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await (curInst() ? swapVideo(ed.inst, f) : loadVideoFile(f)); };
$('#iNew').onclick = async () => {
  try { const { idx } = await newInstrument(progress); setStatus(`Instrument ${hex2(idx)} added, waiting for its video: <b>Load</b> one into it, or drop one on it`); }
  catch (err) { if (!(err instanceof CmdError)) console.error(err); showError(`Couldn't add an instrument: ${err.message}`); }
};
$('#bSave').onclick = e => saveSong(e.shiftKey);
// Zap asks what to empty, as FT2's does: all, the tracks or the instruments
const ZAPPED = { all: 'a new empty song', tracks: 'the tracks are empty, the instruments stay', instruments: 'no instruments, the notes stay' };
const zapDlg = $('#zapDlg');
$('#bNew').onclick = () => { zapDlg.returnValue = ''; zapDlg.showModal(); };
zapDlg.addEventListener('close', () => {
  const what = zapDlg.returnValue;
  if (ZAPPED[what] && run(() => newSong(what))) setStatus(`Zapped: ${ZAPPED[what]}. Ctrl+Z brings it back.`);
});
// Load: where the browser has an open dialog with a file handle (Chrome/Edge), so that Save can write back to the file
$('#bOpen').onclick = async () => {
  if (!window.showOpenFilePicker) return $('#songFile').click();
  let handle;
  try { [handle] = await showOpenFilePicker({ types: [{ description: 'PoopTracker song or MIDI', accept: { 'application/octet-stream': ['.poop'], 'audio/midi': ['.mid', '.midi'] } }] }); }
  catch (e) { if (e.name !== 'AbortError') $('#songFile').click(); return; }
  const f = await handle.getFile();
  await (isMidi(f) ? openMidi(f) : openSong(f, handle));
};
const isMidi = f => /\.(mid|midi)$/i.test(f.name);
$('#songFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await (isMidi(f) ? openMidi(f) : openSong(f)); };
// a MIDI file: its notes become a new song; every instrument waits for a video (Load)
export async function openMidi(file) {
  try {
    setStatus(`Importing: ${escHtml(file.name)}`);
    const { report, nInst } = await importMidi(file, progress);
    setStatus(`Imported ${escHtml(file.name)}: ${nInst} instruments, each with a REPLACE ME video: select each and <b>Load</b> its own (Ctrl+Z brings the previous song back)` +
      (report.length ? `<br>${report.map(escHtml).join('<br>')}` : ''));
  } catch (err) {
    if (!(err instanceof CmdError)) console.error(err);
    showError(`Couldn't import ${file.name}: ${err.message}`);
  }
}

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drop').style.display = 'flex'; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').style.display = 'none'; } });
window.addEventListener('dragover', e => e.preventDefault());
const isVideo = f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name);
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#drop').style.display = 'none';
  // the dropped files' handles (Chrome/Edge), asked for now: the drop's data is gone after the first await
  const handles = [...e.dataTransfer.items].filter(i => i.kind === 'file').map(i => i.getAsFileSystemHandle?.().then(h => h?.kind === 'file' ? h : null, () => null) ?? null);
  const files = [...e.dataTransfer.files], k = files.findIndex(f => /\.poop$/i.test(f.name));
  if (k >= 0) return openSong(files[k], await handles[k]);
  for (const f of files) if (isMidi(f)) return openMidi(f);
  // one video dropped on an instrument in the list: that instrument's video is replaced
  const row = e.target.closest && e.target.closest('.inst'), vids = files.filter(isVideo);
  if (row && vids.length === 1) return swapVideo(+row.dataset.idx, vids[0]);
  // with the bench open, a video goes onto the bench
  if (activeScreen() === benchScreen && vids.length) return putOnBench(vids[0]);
  for (const f of vids) await loadVideoFile(f);
});
