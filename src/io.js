// Files ⇄ song, for every participant (the UI and MCP): decode a video, turn it into an instrument, replace an
// instrument's video, read and build .poop songs, write an instrument into its video's metadata.
// These functions return results or throw errors with readable messages; showing them is the caller's job.
// Every song change goes through the command layer (or replaceSong, for a whole song).
import PTFormat from './ptformat.js';
import { FPS, FRAME_SHORT, MAX_SAMPLE_SEC, hex2, round3 } from './util.js';
import { song, instruments } from './core/song.js';
import { makeVideo, makeInstrument, detectHit, normalizeVideoAudio } from './core/instrument.js';
import { exec, addInstrument, setInstrumentVideo, addVideo, replaceSong, importSong, pick, INST_KEYS } from './core/commands.js';
import { parseMidi, midiToSong } from './midi.js';
import { ctx } from './engine/audio.js';

const once = (el, ev) => new Promise((res, rej) => { el.addEventListener(ev, res, { once: true }); el.addEventListener('error', () => rej(el.error || new Error('video error')), { once: true }); });
// video file → frames + audio (first MAX_SAMPLE_SEC seconds). progress(text) is told what is happening.
export async function decodeVideo(file, progress = () => {}) {
  progress(`Loading: ${file.name}`);
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
    if (i % 5 === 0) progress(`${file.name}: extracting frames ${i + 1}/${n}`);
  }
  URL.revokeObjectURL(url);
  return makeVideo(file.name, frames, buffer, file);
}

// a video → a new instrument (one command). A video saved by PoopTracker carries its instrument in its
// metadata (POC-01); otherwise the hit is detected. A piece cut on the workbench comes with its region
// ({ start, end, name }: the selection inside the piece) and its hit is looked for there. region.focus (also without a
// piece) is where the picture looks.
// Returns { idx, I, fromMetadata }.
export async function importVideo(file, progress, region = null) {
  let line = null;
  try { line = PTFormat.mp4ReadTag(new Uint8Array(await file.arrayBuffer())); } catch {} // not an MP4/MOV: no metadata
  const s = line == null ? null : PTFormat.parse(line);
  if (s && 'video' in s) throw new Error("the instrument line in the metadata can't have a 'video' field");
  const V = await decodeVideo(file, progress);
  if (s && s.end > V.dur) throw new Error(`metadata: region end (${s.end.toFixed(3)}) is past the readable end of the video (${V.dur.toFixed(3)})`);
  if (region?.end != null && region.end > V.dur + 0.001) throw new Error(`the piece is ${region.end.toFixed(3)} s; an instrument can be at most ${MAX_SAMPLE_SEC} s`);
  const name = region?.name ?? file.name.replace(/\.[^.]+$/, '').slice(0, 16);
  const span = region?.end != null ? { start: round3(region.start), end: round3(Math.min(region.end, V.dur)) } : {};
  const hit = s ? 0 : round3(Math.min((span.start ?? 0) + detectHit(makeInstrument(V, span).buffer), V.dur));
  const I = makeInstrument(V, s || { name, ...span, hit, loopStart: hit, focus: region?.focus ?? [] });
  exec(() => addInstrument(I, `load ${file.name}`));
  addVideo(V);
  return { idx: instruments.indexOf(I), I, fromMetadata: !!s };
}
// another video for an instrument (one command): it keeps how it sounds; region, hit and loop points are found
// again in the new video (or read from its metadata, when it was saved by PoopTracker).
// Returns { cmd, fromMetadata }.
export async function replaceVideo(idx, file, progress) {
  let line = null;
  try { line = PTFormat.mp4ReadTag(new Uint8Array(await file.arrayBuffer())); } catch {} // not an MP4/MOV: no metadata
  const place = line == null ? null : PTFormat.parse(line);
  if (place && 'video' in place) throw new Error("the instrument line in the metadata can't have a 'video' field");
  const V = await decodeVideo(file, progress);
  if (place && place.end > V.dur) throw new Error(`metadata: region end (${place.end.toFixed(3)}) is past the readable end of the video (${V.dur.toFixed(3)})`);
  const cmd = exec(() => setInstrumentVideo(idx, V, place));
  addVideo(V);
  return { cmd, fromMetadata: !!place };
}

// ── MIDI: the notes come in, the sounds don't. Every instrument starts with the same 1 s silent "REPLACE ME" video
// (a real video, so nothing else needs to know about it); Repl. gives each one its own.
const PLACEHOLDER = new URL('../media/replace-me.mp4', import.meta.url);
// a .mid file → a new song (one command, Ctrl+Z brings the old one back). Returns { report: [lines], nInst }.
export async function importMidi(file, progress) {
  const { song: S, names, report } = midiToSong(parseMidi(new Uint8Array(await file.arrayBuffer())), file.name.replace(/\.[^.]+$/, ''));
  progress('Loading the placeholder video…');
  const res = await fetch(PLACEHOLDER);
  if (!res.ok) throw new Error(`couldn't load the placeholder video (${res.status})`);
  const V = await decodeVideo(new File([await res.blob()], 'replace-me.mp4', { type: 'video/mp4' }), progress);
  const insts = names.map(name => makeInstrument(V, { name, hit: 0, loopStart: 0 }));
  exec(() => importSong(S, insts, [V], `import ${file.name}`));
  return { report, nInst: insts.length };
}

// ── .poop: a self-contained zip: song.txt + patterns/NN.txt + every used video once (the original file, untouched)
export const safeName = n => n.replace(/[\/\\:*?"<>|;=%\x00-\x1f]/g, '_') || 'video';
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// why the song can't be saved (instruments without a video file: the demo ones), or null
export function whyNotSavable() {
  const demo = instruments.slice(1).map((I, k) => I.video.file ? null : `${hex2(k + 1)} ${I.name}`).filter(Boolean);
  return demo.length ? `${demo.join(', ')} ${demo.length > 1 ? 'are demo instruments' : 'is a demo instrument'} with no video file. Make instruments from real videos or delete these.` : null;
}
// the current song as a .poop file
export async function buildSong() {
  const why = whyNotSavable(); if (why) throw new Error(why);
  const insts = instruments.slice(1);
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
// a .poop file replaces the current song. Nothing changes unless the whole file is valid and every video decodes.
// Returns { errors } (each 'file:line  message'), or { nVideos } when it was opened.
export async function readSong(file, progress) {
  const zip = await PTFormat.unzip(new Uint8Array(await file.arrayBuffer()));
  const res = PTFormat.parseSong(zip);
  if (res.errors.length) return { errors: res.errors };
  const vids = new Map();
  for (const s of res.instruments) if (!vids.has(s.video))
    vids.set(s.video, await decodeVideo(new File([zip.get(s.video)], s.video.split('/').pop()), progress));
  // the playable length of a video is only known after decoding it
  const errors = res.instruments.map((s, k) => s.end > vids.get(s.video).dur ? `${s.where}  instrument ${hex2(k + 1)}: region end (${s.end.toFixed(3)}) is past the readable end of the video (${vids.get(s.video).dur.toFixed(3)})` : null).filter(Boolean);
  if (errors.length) return { errors };
  replaceSong(res.song, res.instruments.map(s => makeInstrument(vids.get(s.video), pick(s, INST_KEYS))), [...vids.values()]);
  return { nVideos: vids.size };
}
// an instrument written into a copy of its video's file (MP4/MOV; audio and video untouched)
export function instrumentVideoType(I) {
  if (!I.video.file) throw new Error('This demo instrument has no video file. Load a real video.');
  const ext = (/\.(mp4|m4v|mov)$/i.exec(I.video.file.name) || ['.mp4'])[0];
  return { ext, mime: /\.mov$/i.test(ext) ? 'video/quicktime' : 'video/mp4' };
}
export async function instrumentVideo(I) {
  const { mime } = instrumentVideoType(I);
  return new Blob([PTFormat.mp4WriteTag(new Uint8Array(await I.video.file.arrayBuffer()), PTFormat.format(I))], { type: mime });
}
