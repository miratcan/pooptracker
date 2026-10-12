// Files: loading videos (→ instruments), replacing an instrument's video, saving an instrument into its
// video's metadata, and saving / opening .poop songs. Every song change still goes through a command.
import PTFormat from '../ptformat.js';
import { FPS, FRAME_SHORT, MAX_SAMPLE_SEC, hex2, round3 } from '../util.js';
import { song, instruments } from '../core/song.js';
import { makeVideo, makeInstrument, detectHit, normalizeVideoAudio } from '../core/instrument.js';
import { CmdError, exec, addInstrument, setInstrumentVideo, newSong, addVideo, replaceSong, pick, INST_KEYS } from '../core/commands.js';
import { ctx } from '../engine/audio.js';
import { $, ed, run, setStatus, showError, escHtml } from './common.js';
import { curInst } from './instrumentPanel.js';

$('#bLoad').onclick = () => $('#file').click();
$('#bSwap').onclick = () => { if (curInst()) $('#fileSwap').click(); };
$('#fileSwap').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await swapVideo(ed.inst, f); };
async function swapVideo(idx, file) {
  try {
    const V = await decodeVideo(file);
    let cmd = null;
    try { cmd = exec(() => setInstrumentVideo(idx, V)); } catch (e) { if (!(e instanceof CmdError)) throw e; return showError(e.message); }
    addVideo(V);
    const msg = `instrument ${hex2(idx)} ${instruments[idx].name}: video → ${file.name}, settings kept`;
    if (cmd.notes.length) showError(`${msg} (the new video is shorter: ${cmd.notes.join(', ')})`); else setStatus(escHtml(msg));
  } catch (err) { console.error(err); showError(`Couldn't replace the video: ${file.name} (${err.message})`); }
}
$('#file').onchange = async e => { for (const f of e.target.files) await loadVideoFile(f); e.target.value = ''; };
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drop').style.display = 'flex'; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').style.display = 'none'; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#drop').style.display = 'none';
  for (const f of e.dataTransfer.files) if (/\.poop$/i.test(f.name)) return openSong(f);
  // one video dropped on an instrument in the list: that instrument's video is replaced
  const row = e.target.closest && e.target.closest('.inst'), vids = [...e.dataTransfer.files].filter(f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name));
  if (row && vids.length === 1) return swapVideo(+row.dataset.idx, vids[0]);
  for (const f of e.dataTransfer.files) if (f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)) await loadVideoFile(f);
});
const once = (el, ev) => new Promise((res, rej) => { el.addEventListener(ev, res, { once: true }); el.addEventListener('error', () => rej(el.error || new Error('video error')), { once: true }); });
// a video saved by PoopTracker carries its instrument in its metadata (POC-01); otherwise the hit is detected
export async function loadVideoFile(file) {
  try {
    let line = null;
    try { line = PTFormat.mp4ReadTag(new Uint8Array(await file.arrayBuffer())); } catch {} // not an MP4/MOV: no metadata
    const s = line == null ? null : PTFormat.parse(line);
    if (s && 'video' in s) throw new Error("the instrument line in the metadata can't have a 'video' field");
    const V = await decodeVideo(file);
    if (s && s.end > V.dur) throw new Error(`metadata: region end (${s.end.toFixed(3)}) is past the readable end of the video (${V.dur.toFixed(3)})`);
    const hit = s ? 0 : round3(Math.min(detectHit(V.buffer), V.dur));
    const I = makeInstrument(V, s || { name: file.name.replace(/\.[^.]+$/, '').slice(0, 16), hit, loopStart: hit });
    addVideo(V);
    run(() => addInstrument(I, `load ${file.name}`));
    setStatus(s ? `${escHtml(file.name)} loaded → instrument ${hex2(instruments.length - 1)} ${escHtml(I.name)} (settings from the video's metadata)`
      : `${escHtml(file.name)} loaded → instrument ${hex2(instruments.length - 1)} (hit found automatically at ${I.hit.toFixed(3)}s, check it)`);
  } catch (err) {
    console.error(err); showError(`Couldn't load: ${file.name} (${err.message})`);
  }
}
// the current instrument written into a copy of its video's file (MP4/MOV; audio and video untouched)
export async function saveInstrumentVideo(I) {
  if (!I.video.file) return showError("This demo instrument has no video file. Load a real video.");
  const ext = (/\.(mp4|m4v|mov)$/i.exec(I.video.file.name) || ['.mp4'])[0], mime = /\.mov$/i.test(ext) ? 'video/quicktime' : 'video/mp4';
  try {
    const saved = await saveAs(safeName(I.name.trim() || 'instrument') + ext, 'Video', mime, ext,
      async () => new Blob([PTFormat.mp4WriteTag(new Uint8Array(await I.video.file.arrayBuffer()), PTFormat.format(I))], { type: mime }));
    if (saved) setStatus(`Saved: ${escHtml(saved.name)} (instrument ${escHtml(I.name)} is in the video's metadata)`);
  } catch (err) { showError(`Couldn't save: ${err.message}`); }
}
// video file → frames + audio (first MAX_SAMPLE_SEC seconds); throws with a readable message
async function decodeVideo(file) {
  setStatus(`Loading: ${file.name}`);
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  await once(video, 'loadedmetadata');
  if (video.readyState < 2) await once(video, 'loadeddata');
  if (!isFinite(video.duration)) throw new Error("couldn't read the video's duration");
  const dur = Math.min(video.duration, MAX_SAMPLE_SEC);
  // audio track → AudioBuffer
  let buffer;
  try {
    const full = await ctx.decodeAudioData(await file.arrayBuffer());
    const len = Math.min(full.length, Math.ceil(dur * full.sampleRate));
    buffer = ctx.createBuffer(full.numberOfChannels, len, full.sampleRate);
    for (let c = 0; c < full.numberOfChannels; c++) buffer.copyToChannel(full.getChannelData(c).subarray(0, len), c);
  } catch (err) {
    console.warn('audio decode failed', err);
    buffer = ctx.createBuffer(1, Math.ceil(dur * ctx.sampleRate), ctx.sampleRate);
  }
  normalizeVideoAudio(buffer);
  // frames → ImageBitmaps, uncropped (each output tile crops its own shape). Seeking happens ONCE here, never during playback.
  const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, FRAME_SHORT / Math.min(vw, vh));
  const cv = document.createElement('canvas'); cv.width = Math.round(vw * k); cv.height = Math.round(vh * k);
  const cg = cv.getContext('2d');
  const n = Math.max(1, Math.floor(dur * FPS)), frames = [];
  for (let i = 0; i < n; i++) {
    video.currentTime = (i + 0.25) / FPS;
    await once(video, 'seeked');
    cg.drawImage(video, 0, 0, cv.width, cv.height);
    frames.push(await createImageBitmap(cv));
    if (i % 5 === 0) setStatus(`${file.name}: extracting frames ${i + 1}/${n}`);
  }
  URL.revokeObjectURL(url);
  return makeVideo(file.name, frames, buffer, file);
}

// ── .poop save / open: a self-contained zip: song.txt + patterns/NN.txt + every used video once (the original file, untouched)
export const safeName = n => n.replace(/[\/\\:*?"<>|;=%\x00-\x1f]/g, '_') || 'video';
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
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
  const insts = instruments.slice(1);
  const demo = insts.map((I, k) => I.video.file ? null : `${hex2(k + 1)} ${I.name}`).filter(Boolean);
  if (demo.length) return showError(`Couldn't save: ${demo.join(', ')} ${demo.length > 1 ? 'are demo instruments' : 'is a demo instrument'} with no video file. Make instruments from real videos or delete these.`);
  const saved = await saveAs(safeName(song.title.trim() || 'song') + '.poop', 'PoopTracker song', 'application/octet-stream', '.poop', () => buildSong(insts));
  if (!saved) return null;
  setStatus(`Saved: ${escHtml(saved.name)} (${(saved.blob.size / 1048576).toFixed(1)} MB, ${saved.blob.nVideos} videos)`);
  return saved.blob;
}
async function buildSong(insts) {
  setStatus('Saving…');
  const paths = new Map(), videoEntries = [];
  for (const I of insts) {
    const V = I.video; if (paths.has(V)) continue;
    const data = new Uint8Array(await V.file.arrayBuffer()), crc = PTFormat.crc32(data);
    // the same file loaded twice is stored once as well
    const dup = videoEntries.find(e => e.crc === crc && sameBytes(e.data, data));
    if (dup) { paths.set(V, dup.name); continue; }
    const base = safeName(V.name); let name = 'videos/' + base;
    for (let k = 2; videoEntries.some(e => e.name === name); k++) name = 'videos/' + base.replace(/(\.[^.]*)?$/, `-${k}$1`);
    paths.set(V, name); videoEntries.push({ name, data, crc });
  }
  const text = PTFormat.formatSong(song, insts.map(I => ({ I, video: paths.get(I.video) }))), enc = new TextEncoder();
  const blob = new Blob(PTFormat.zipStore([...Object.entries(text).map(([name, t]) => ({ name, data: enc.encode(t) })), ...videoEntries]), { type: 'application/zip' });
  blob.nVideos = videoEntries.length;
  return blob;
}
function showErrors(fname, errs) {
  console.warn(errs.join('\n'));
  const more = errs.length > 6 ? `<br>… and ${errs.length - 6} more errors (all in the console)` : '';
  setStatus(`<span class="err">⚠ Couldn't open ${escHtml(fname)}:<br>${errs.slice(0, 6).map(escHtml).join('<br>')}${more}</span>`);
}
// nothing changes unless the whole file is valid and every video decodes
export async function openSong(file) {
  try {
    setStatus(`Opening: ${escHtml(file.name)}`);
    const zip = await PTFormat.unzip(new Uint8Array(await file.arrayBuffer()));
    const res = PTFormat.parseSong(zip);
    if (res.errors.length) return showErrors(file.name, res.errors);
    const vids = new Map();
    for (const s of res.instruments) if (!vids.has(s.video))
      vids.set(s.video, await decodeVideo(new File([zip.get(s.video)], s.video.split('/').pop())));
    // the playable length of a video is only known after decoding it
    const errs = res.instruments.map((s, k) => s.end > vids.get(s.video).dur ? `${s.where}  instrument ${hex2(k + 1)}: region end (${s.end.toFixed(3)}) is past the readable end of the video (${vids.get(s.video).dur.toFixed(3)})` : null).filter(Boolean);
    if (errs.length) return showErrors(file.name, errs);
    replaceSong(res.song, res.instruments.map(s => makeInstrument(vids.get(s.video), pick(s, INST_KEYS))), [...vids.values()]);
    setStatus(`Opened: ${escHtml(file.name)} (${song.patterns.length} patterns, ${instruments.length - 1} instruments, ${vids.size} videos)`);
  } catch (err) {
    console.error(err); showError(`Couldn't open ${file.name}: ${err.message}`);
  }
}
$('#bSave').onclick = () => saveSong();
$('#bNew').onclick = () => { if (run(() => newSong())) setStatus('New song. Ctrl+Z brings the previous one back.'); };
$('#bOpen').onclick = () => $('#songFile').click();
$('#songFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await openSong(f); };
