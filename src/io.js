// Files ⇄ song, for every participant (the UI and MCP): decode a video, turn it into an instrument, replace an
// instrument's video, read and build .poop songs, write an instrument into its video's metadata.
// These functions return results or throw errors with readable messages; showing them is the caller's job.
// Every song change goes through the command layer (or replaceSong, for a whole song).
import PTFormat from './ptformat.js';
import { FPS, FRAME_SHORT, MAX_SAMPLE_SEC, hex2, round3 } from './util.js';
import { song, instruments, videos } from './core/song.js';
import { makeVideo, makeInstrument, detectHit, normalizeVideoAudio, focusAt, fitToVideo } from './core/instrument.js';
import { cutVideo, reader } from './mp4cut.js';
import { decodeFrames } from './frames.js';
import { exec, addInstrument, setInstrumentVideo, addVideo, replaceSong, importSong, pick, INST_KEYS } from './core/commands.js';
import { parseMidi, midiToSong } from './midi.js';
import { ctx } from './engine/audio.js';

const once = (el, ev) => new Promise((res, rej) => { el.addEventListener(ev, res, { once: true }); el.addEventListener('error', () => rej(el.error || new Error('video error')), { once: true }); });
// video file → frames + audio (first MAX_SAMPLE_SEC seconds). progress(text, done) is told what is happening, done
// being how much of it is over (0–1).
export async function decodeVideo(file, progress = () => {}) {
  progress(`Loading: ${file.name}`, 0);
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  await once(video, 'loadedmetadata');
  // the duration as the file states it: once Chrome has decoded some of a VP9/AV1 piece it counts the frames its edit
  // list hides too, and the duration grows (to the keyframe before the piece)
  const stated = video.duration;
  if (video.readyState < 2) await once(video, 'loadeddata');
  if (!isFinite(stated)) throw new Error("couldn't read the video's duration");
  const dur = Math.min(stated, MAX_SAMPLE_SEC);
  // audio track → AudioBuffer. A video with no sound this browser can read (none at all, or e.g. Opus in Safari) gets
  // silence, and says so (V.noSound): it is never silent without a word
  let buffer, noSound = false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const full = await ctx.decodeAudioData(bytes.slice().buffer); // it takes the buffer over
    const len = Math.min(full.length, Math.ceil(dur * full.sampleRate));
    buffer = ctx.createBuffer(full.numberOfChannels, len, full.sampleRate);
    for (let c = 0; c < full.numberOfChannels; c++) buffer.copyToChannel(full.getChannelData(c).subarray(0, len), c);
  } catch (err) {
    console.warn('audio decode failed', err);
    buffer = ctx.createBuffer(1, Math.ceil(dur * ctx.sampleRate), ctx.sampleRate); noSound = true;
  }
  normalizeVideoAudio(buffer);
  // frames → ImageBitmaps, uncropped (each output tile crops its own shape). Seeking happens ONCE here, never during
  // playback; decoded in order (frames.js) where it can be, the same frames many times faster
  const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, FRAME_SHORT / Math.min(vw, vh));
  const cv = document.createElement('canvas'); cv.width = Math.round(vw * k); cv.height = Math.round(vh * k);
  const cg = cv.getContext('2d');
  const n = Math.max(1, Math.floor(dur * FPS)), times = Array.from({ length: n }, (_, i) => (i + 0.25) / FPS);
  const frames = await decodeFrames(bytes, times, cv.width, cv.height, i => progress(`${file.name}: extracting frames ${i}/${n}`, i / n)) ?? [];
  for (let i = frames.length; i < n; i++) {
    video.currentTime = times[i];
    await once(video, 'seeked');
    cg.drawImage(video, 0, 0, cv.width, cv.height);
    frames.push(await createImageBitmap(cv));
    progress(`${file.name}: extracting frames ${i + 1}/${n}`, (i + 1) / n);
  }
  URL.revokeObjectURL(url);
  const V = makeVideo(file.name, frames, buffer, file);
  if (noSound) V.noSound = true;
  return V;
}

// a video → a new instrument (one command). A video saved by PoopTracker carries its instrument in its
// metadata; otherwise the hit is detected. A piece cut on the workbench comes with its region
// ({ start, end, name }: the selection inside the piece) and its hit is looked for there. region.focus (also without a
// piece) is where the picture looks.
// Returns { idx, I, fromMetadata }.
export async function importVideo(file, progress, region = null) {
  let line = null;
  try { line = PTFormat.mp4ReadTag(new Uint8Array(await file.arrayBuffer())); } catch {} // not an MP4/MOV: no metadata
  const tag = line == null ? null : PTFormat.parse(line);
  if (tag && 'video' in tag) throw new Error("the instrument line in the metadata can't have a 'video' field");
  const V = await decodeVideo(file, progress), s = tag && fitToVideo(tag, V.dur);
  if (tag && !s) throw new Error(`metadata: region end (${tag.end.toFixed(3)}) is past the readable end of the video (${V.dur.toFixed(3)})`);
  if (region?.end != null && region.end - (region.start ?? 0) > MAX_SAMPLE_SEC + 0.001) throw new Error(`the piece is ${(region.end - (region.start ?? 0)).toFixed(3)} s; an instrument can be at most ${MAX_SAMPLE_SEC} s`);
  const name = region?.name ?? file.name.replace(/\.[^.]+$/, '').slice(0, 16);
  const span = region?.end != null ? { start: round3(region.start), end: round3(Math.min(region.end, V.dur)) } : {};
  const hit = s ? 0 : round3(Math.min((span.start ?? 0) + detectHit(makeInstrument(V, span).buffer), V.dur));
  const I = makeInstrument(V, s || { name, ...span, hit, loopStart: hit, focus: region?.focus ?? [] });
  exec(() => addInstrument(I, `load ${file.name}`));
  addVideo(V);
  return { idx: instruments.indexOf(I), I, fromMetadata: !!s, noSound: !!V.noSound };
}
// another video for an instrument (one command): it keeps how it sounds; region, hit and loop points are found
// again in the new video (or read from its metadata, when it was saved by PoopTracker). A piece cut on the workbench
// comes with its region ({ start, end, focus }: the selection inside the piece), and its hit is looked for there.
// Returns { cmd, fromMetadata }.
export async function replaceVideo(idx, file, progress, region = null) {
  let line = null;
  if (!region) try { line = PTFormat.mp4ReadTag(new Uint8Array(await file.arrayBuffer())); } catch {} // not an MP4/MOV: no metadata
  const tag = line == null ? null : PTFormat.parse(line);
  if (tag && 'video' in tag) throw new Error("the instrument line in the metadata can't have a 'video' field");
  const V = await decodeVideo(file, progress);
  let place = tag && fitToVideo(tag, V.dur);
  if (tag && !place) throw new Error(`metadata: region end (${tag.end.toFixed(3)}) is past the readable end of the video (${V.dur.toFixed(3)})`);
  if (region) {
    const span = { start: round3(region.start), end: round3(Math.min(region.end, V.dur)) };
    const hit = round3(Math.min(span.start + detectHit(makeInstrument(V, span).buffer), V.dur));
    // a whole instrument line, as metadata would give, with the instrument's own sound fields: they are kept
    place = { ...pick(instruments[idx], INST_KEYS), ...span, hit, loopStart: hit, loopEnd: span.end, avOffset: 0, amp: [], focus: region.focus ?? [] };
  }
  const cmd = exec(() => setInstrumentVideo(idx, V, place));
  addVideo(V);
  return { cmd, fromMetadata: !!line, noSound: !!V.noSound };
}

// an instrument's video cut down to its region, without re-encoding: the rest of the video is thrown away (the song
// file gets smaller) and it plays the same, its hit, loop points and focus moving with it. Only this instrument gets
// the new video (another one using the old video keeps it). One command: Ctrl+Z brings the whole video back.
// Returns the command, or null when the region is already the whole video.
export async function trimInstrument(idx, progress) {
  const I = instruments[idx]; if (!I) throw new Error(`instrument ${hex2(idx)} doesn't exist`);
  const file = I.video.file; if (!file) throw new Error('This demo instrument has no video file. Load a real video.');
  if (I.start === 0 && I.end >= I.video.dur && I.video.dur < MAX_SAMPLE_SEC) return null;
  progress(`Trimming ${I.name} to its region…`);
  const piece = await cutVideo(reader(file), file.size, I.start, I.end);
  const V = await decodeVideo(new File([piece.bytes], file.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' }), progress);
  if (V.noSound && !I.video.noSound) throw new Error("this browser can't read the trimmed video's sound, so the instrument would go silent; nothing changed");
  const len = round3(Math.min(piece.end, V.dur)), at = t => round3(Math.max(0, Math.min(len, t - I.start)));
  // the focus where the region starts, then the keys inside it
  const f0 = focusAt(I, I.start), inside = I.focus.filter(k => k.t > I.start && k.t < I.end).map(k => ({ ...k, t: at(k.t) }));
  const focus = I.focus.length ? [{ t: 0, x: round3(f0.x), y: round3(f0.y) }, ...inside] : [];
  const place = { ...pick(I, INST_KEYS), start: 0, end: len, hit: at(I.hit), loopStart: at(I.loopStart), loopEnd: at(I.loopEnd), focus };
  const cmd = exec(() => setInstrumentVideo(idx, V, place, 'trim to region'));
  addVideo(V);
  return cmd;
}

// ── An instrument waiting for its video (New, and every instrument a MIDI file brings) has the same 1 s silent
// "REPLACE ME" video: a real video, so nothing else needs to know about it. Load gives it its own.
const PLACEHOLDER = new URL('../media/replace-me.mp4', import.meta.url);
let placeholder = null; // decoded once, shared by all of them
async function placeholderVideo(progress) {
  if (placeholder) return placeholder;
  progress('Loading the placeholder video…');
  const res = await fetch(PLACEHOLDER);
  if (!res.ok) throw new Error(`couldn't load the placeholder video (${res.status})`);
  return placeholder = await decodeVideo(new File([await res.blob()], 'replace-me.mp4', { type: 'video/mp4' }), progress);
}
// New: an empty instrument at the end of the list (one command). Returns { idx, I }.
export async function newInstrument(progress) {
  const V = await placeholderVideo(progress), I = makeInstrument(V, { name: 'empty', hit: 0, loopStart: 0 });
  exec(() => addInstrument(I, 'new instrument'));
  if (!videos.includes(V)) addVideo(V);
  return { idx: instruments.indexOf(I), I };
}
// a .mid file → a new song (one command, Ctrl+Z brings the old one back). Returns { report: [lines], nInst }.
export async function importMidi(file, progress) {
  const { song: S, names, report } = midiToSong(parseMidi(new Uint8Array(await file.arrayBuffer())), file.name.replace(/\.[^.]+$/, ''));
  const V = await placeholderVideo(progress);
  const insts = names.map(name => makeInstrument(V, { name, hit: 0, loopStart: 0 }));
  exec(() => importSong(S, insts, [V], `import ${file.name}`));
  return { report, nInst: insts.length };
}

// ── .poop: a self-contained zip: song.txt + patterns/NN.txt + every used video once (the original file, untouched)
// what a status line adds when a video came in without sound
export const NO_SOUND = ' ⚠ no sound: the video has none this browser can read (in Safari: WebM sound, Opus), so this instrument is silent';
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
  return openSongZip(zip, (path, p) => decodeVideo(new File([zip.get(path)], path.split('/').pop()), p), progress);
}
// the same, from a zip that is already open; videoAt(path, progress) gives the decoded video stored at that path.
// progress(text, done) counts the videos: done is how much of the whole song is read (0–1)
export async function openSongZip(zip, videoAt, progress = () => {}) {
  const res = PTFormat.parseSong(zip);
  if (res.errors.length) return { errors: res.errors };
  const paths = [...new Set(res.instruments.map(s => s.video))], vids = new Map();
  for (const [k, path] of paths.entries())
    vids.set(path, await videoAt(path, (text, done = 0) => progress(`video ${k + 1}/${paths.length} · ${text}`, (k + done) / paths.length)));
  // the playable length of a video is only known after decoding it
  const fitted = res.instruments.map(s => fitToVideo(s, vids.get(s.video).dur));
  const errors = res.instruments.map((s, k) => fitted[k] ? null : `${s.where}  instrument ${hex2(k + 1)}: region end (${s.end.toFixed(3)}) is past the readable end of the video (${vids.get(s.video).dur.toFixed(3)})`).filter(Boolean);
  if (errors.length) return { errors };
  replaceSong(res.song, fitted.map(s => makeInstrument(vids.get(s.video), pick(s, INST_KEYS))), [...vids.values()]);
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
