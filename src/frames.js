// A video's frames by decoding its picture once, in order (WebCodecs), instead of seeking a <video> to each frame:
// a seek decodes again from the keyframe before it, which for a 4K AV1 clip, or a piece whose keyframe is hidden
// before its start, costs a quarter of a second a frame. Only MP4/MOV with H.264 or AV1 and no rotation; for
// anything else (or a browser without VideoDecoder) decodeFrames returns null and the caller seeks, as before.
import { u32, fourcc, boxes } from './mp4.js';
import { indexMp4, reader } from './mp4cut.js';

const no = () => { throw new Error('not readable here'); };
const hex = n => n.toString(16).padStart(2, '0');
// the decoder's settings from the track's sample entry: { codec, description } or null
function configOf(b, t) {
  const e = boxes(b, t.stsd.body + 8, t.stsd.end, no)[0]; if (!e) return null;
  const kids = boxes(b, e.body + 78, e.end, no), cfg = type => kids.find(k => k.type === type);
  const desc = k => b.slice(k.body, k.end);
  if (e.type === 'avc1' || e.type === 'avc3') {
    const c = cfg('avcC'); if (!c) return null;
    return { codec: `avc1.${hex(b[c.body + 1])}${hex(b[c.body + 2])}${hex(b[c.body + 3])}`, description: desc(c) };
  }
  if (e.type === 'av01') {
    const c = cfg('av1C'); if (!c) return null;
    const p = b[c.body + 1] >> 5, level = b[c.body + 1] & 31, x = b[c.body + 2], depth = x & 0x40 ? (x & 0x20 ? 12 : 10) : 8;
    return { codec: `av01.${p}.${String(level).padStart(2, '0')}${x & 0x80 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`, description: desc(c) };
  }
  return null;
}
// tkhd's matrix is the identity: a phone video turned on its side (which <video> turns back) isn't decoded here
function upright(b, trak) {
  const tkhd = boxes(b, trak.body, trak.end, no).find(k => k.type === 'tkhd'); if (!tkhd) return false;
  const m = tkhd.body + (b[tkhd.body] ? 52 : 40);
  return u32(b, m) === 0x10000 && u32(b, m + 4) === 0 && u32(b, m + 12) === 0 && u32(b, m + 16) === 0x10000;
}

// the frame shown at each of times (seconds, rising), scaled to w × h, as ImageBitmaps; null when it can't be done here.
// done(k) is told how many are ready
export async function decodeFrames(bytes, times, w, h, done = () => {}) {
  if (typeof VideoDecoder === 'undefined' || fourcc(bytes, 4) !== 'ftyp') return null;
  let index; try { index = await indexMp4(reader(bytes), bytes.length); } catch { return null; }
  const { b, tracks } = index, t = tracks.find(x => x.kind === 'vide' && x.size.length);
  const cfg = t && upright(b, t.trak) && configOf(b, t);
  if (!cfg || !(await VideoDecoder.isConfigSupported(cfg).catch(() => ({}))).supported) return null;
  const out = new Array(times.length), last = times[times.length - 1];
  let k = 0, prev = null, chain = Promise.resolve(), error = null;
  const shot = f => createImageBitmap(f, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
  // frames come out in the order they are shown: the one before holds every time up to this one's
  const take = async (f, until) => { for (; k < times.length && times[k] < until; k++) { out[k] = await shot(f); done(k + 1); } };
  const dec = new VideoDecoder({
    output: f => { const p = prev, at = f.timestamp / 1e6; prev = f; chain = chain.then(async () => { if (p) { await take(p, at); p.close(); } }); },
    error: e => { error = e; },
  });
  dec.configure(cfg);
  // where the edit list starts in the middle of a frame, Chrome (and ffmpeg) don't show that frame: the first one that
  // starts at or after it is at 0. The same here, so the frames are the ones a seek shows
  const n = t.size.length; let zero = Infinity;
  for (let i = 0; i < n; i++) { const p = t.pts(i); if (p >= -1e-9 && p < zero) zero = p; }
  const at = i => t.pts(i) - (isFinite(zero) ? zero : 0);
  // in decode order, from the first sample, until a frame shown past the last time is in
  for (let i = 0; i < n && at(i) <= last + 1; i++)
    dec.decode(new EncodedVideoChunk({ type: !t.sync || t.sync[i] ? 'key' : 'delta', timestamp: Math.round(at(i) * 1e6), data: bytes.subarray(t.off[i], t.off[i] + t.size[i]) }));
  try { await dec.flush(); } catch (e) { error ??= e; }
  dec.close(); await chain;
  if (prev) { if (!error) await take(prev, Infinity); prev.close(); }
  if (error || k < times.length) { out.forEach(x => x?.close()); return null; }
  return out;
}
