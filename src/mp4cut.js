// Cutting a piece out of an MP4/MOV without re-encoding: the workbench takes samples from a video the way a sampler
// takes a slice of a recording ([ZEN-NOT-A-VIDEO-EDITOR]). The picture and sound packets are copied byte for byte;
// only the tables that say where they are and when they play are written anew.
//
// A video can only be decoded from a keyframe, so the piece holds the frames from the last keyframe before the selection;
// its edit list hides them: the piece plays from the selection's start and is exactly as long as the selection.
// The source is read in pieces (read(offset, length) → Uint8Array): an hour-long video is never loaded whole.
// A WebM/MKV is read by webm.js, which describes it the way an MP4 is described here; the piece is an MP4 either way.
import { u32, u64, fourcc, be32, box, boxes as scan } from './mp4.js';
import { indexWebm } from './webm.js';

const fail = msg => { throw new Error(msg); };
const notMp4 = () => fail('the video is not MP4/MOV, WebM or MKV (only those can be cut)');
const boxes = (b, x) => scan(b, x.body, x.end, notMp4);
const kid = (b, x, type) => boxes(b, x).find(k => k.type === type);
const need = (b, x, type) => kid(b, x, type) ?? notMp4();
const i32 = (b, o) => u32(b, o) | 0;
const CHUNK = 0.5; // seconds of one track per chunk in the new file; the tracks take turns

async function topBoxes(read, size) {
  const out = [];
  for (let o = 0; o + 8 <= size;) {
    const h = await read(o, Math.min(16, size - o));
    let len = u32(h, 0), hdr = 8;
    if (len === 1) { if (h.length < 16) notMp4(); len = u64(h, 8); hdr = 16; } else if (len === 0) len = size - o;
    if (len < hdr || o + len > size) notMp4();
    out.push({ type: fourcc(h, 4), start: o, size: len, body: o + hdr, end: o + len });
    o += len;
  }
  if (!out.length || !['ftyp', 'wide', 'free', 'mdat', 'moov', 'skip', 'pnot'].includes(out[0].type)) notMp4();
  return out;
}

// a track's sample table, one entry per sample: decode time, duration, composition offset, size, place in the file
function readTrack(b, trak, movieScale) {
  const mdia = need(b, trak, 'mdia'), kind = fourcc(b, need(b, mdia, 'hdlr').body + 8);
  const mdhd = need(b, mdia, 'mdhd'), scale = u32(b, mdhd.body + (b[mdhd.body] ? 20 : 12));
  const stbl = need(b, need(b, mdia, 'minf'), 'stbl');
  const t = { trak, kind, scale, stbl, stsd: need(b, stbl, 'stsd') };
  const entry = fourcc(b, t.stsd.body + 12);
  if (entry === 'encv' || entry === 'enca') fail('the video is encrypted and can\'t be cut');
  if (kid(b, stbl, 'stz2')) fail('the video uses compact sample sizes (stz2), which can\'t be cut yet');
  const stsz = need(b, stbl, 'stsz'), n = u32(b, stsz.body + 8), fixed = u32(b, stsz.body + 4);
  t.size = new Uint32Array(n); for (let i = 0; i < n; i++) t.size[i] = fixed || u32(b, stsz.body + 12 + 4 * i);
  t.dts = new Float64Array(n); t.dur = new Uint32Array(n); t.cto = new Int32Array(n); t.off = new Float64Array(n);
  const stts = need(b, stbl, 'stts');
  for (let e = 0, i = 0, d = 0, m = u32(b, stts.body + 4); e < m; e++)
    for (let k = 0, c = u32(b, stts.body + 8 + 8 * e), dl = u32(b, stts.body + 12 + 8 * e); k < c && i < n; k++, i++) { t.dts[i] = d; t.dur[i] = dl; d += dl; }
  const ctts = kid(b, stbl, 'ctts');
  if (ctts) { t.cttsVersion = b[ctts.body];
    for (let e = 0, i = 0, m = u32(b, ctts.body + 4); e < m; e++)
      for (let k = 0, c = u32(b, ctts.body + 8 + 8 * e), v = i32(b, ctts.body + 12 + 8 * e); k < c && i < n; k++, i++) t.cto[i] = v; }
  const stss = kid(b, stbl, 'stss');
  if (stss) { t.sync = new Uint8Array(n); for (let e = 0, m = u32(b, stss.body + 4); e < m; e++) t.sync[u32(b, stss.body + 8 + 4 * e) - 1] = 1; }
  // where each sample is: chunk offsets (stco/co64) and how many samples each chunk holds (stsc)
  const stco = kid(b, stbl, 'stco'), co64 = kid(b, stbl, 'co64'), co = stco ?? co64 ?? notMp4();
  const nChunks = u32(b, co.body + 4), chunkOff = k => stco ? u32(b, co.body + 8 + 4 * k) : u64(b, co.body + 8 + 8 * k);
  const stsc = need(b, stbl, 'stsc'), runs = u32(b, stsc.body + 4);
  for (let r = 0, i = 0; r < runs; r++) {
    const o = stsc.body + 8 + 12 * r, first = u32(b, o) - 1, per = u32(b, o + 4);
    if (u32(b, o + 8) !== 1) fail('the video changes its codec settings midway and can\'t be cut');
    const last = r + 1 < runs ? u32(b, o + 12) - 1 : nChunks;
    for (let c = first; c < last && i < n; c++) for (let k = 0, p = chunkOff(c); k < per && i < n; k++, i++) { t.off[i] = p; p += t.size[i]; }
  }
  // the edit list: when the track's media starts playing (an optional empty edit, then one normal edit)
  t.delay = 0; t.mediaTime = 0;
  const edts = kid(b, trak, 'edts'), elst = edts && kid(b, edts, 'elst');
  if (elst) {
    const v = b[elst.body], w = v ? 20 : 12, edits = [];
    for (let e = 0, m = u32(b, elst.body + 4); e < m; e++) {
      const o = elst.body + 8 + w * e;
      edits.push(v ? { dur: u64(b, o), time: u32(b, o + 8) === 0xFFFFFFFF ? -1 : u64(b, o + 8) } : { dur: u32(b, o), time: i32(b, o + 4) });
    }
    if (edits.length && edits[0].time === -1) t.delay = edits.shift().dur / movieScale;
    if (edits.length > 1) fail('the video has an edit list this cutter can\'t follow (it was cut together in an editor without re-encoding)');
    if (edits.length) t.mediaTime = edits[0].time;
  }
  t.pts = i => (t.dts[i] + t.cto[i] - t.mediaTime) / scale + t.delay;
  return t;
}

// the samples [from, to] of a track, as new tables (decode times start at 0) and the bytes to copy
function pick(t, from, to, t0, t1) {
  const n = to - from + 1, base = t.dts[from], dur = t.dur.subarray(from, to + 1), cto = t.cto.subarray(from, to + 1);
  const media = t.dts[to] + t.dur[to] - base;
  // presentation time 0 of the new file is t0: mediaTime' = mediaTime − base + (t0 − delay)·scale
  let mediaTime = Math.round(t.mediaTime - base + (t0 - t.delay) * t.scale), delay = 0;
  if (mediaTime < 0) { delay = -mediaTime / t.scale; mediaTime = 0; }
  // how long it shows: until the end of the sample shown last (with B-frames that isn't the one decoded last)
  let last = 0; for (let k = 0; k < n; k++) last = Math.max(last, t.dts[from + k] - base + cto[k] + dur[k]);
  const shown = Math.max(0, Math.min((last - mediaTime) / t.scale, t1 - t0 - delay));
  return { t, from, to, n, dur, cto, media, mediaTime, delay, shown };
}

const runs = (n, val) => { const out = []; for (let i = 0; i < n; i++) { const v = val(i); if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++; else out.push([1, v]); } return out; };
const table = (type, version, rows, w) => {
  const a = new Uint8Array(8 + rows.length * 4 * w), d = new DataView(a.buffer);
  d.setUint32(0, version << 24); d.setUint32(4, rows.length);
  rows.forEach((r, k) => r.forEach((v, j) => d.setUint32(8 + (k * w + j) * 4, v >>> 0)));
  return box(type, a);
};
// a full box's version/flags + fields, the 64-bit duration written at `at` (offset in body)
function withDuration(b, x, at32, at64, value) {
  const out = b.slice(x.start, x.end), d = new DataView(out.buffer), o = x.body - x.start;
  if (b[x.body]) { d.setUint32(o + at64, Math.floor(value / 4294967296)); d.setUint32(o + at64 + 4, value >>> 0); }
  else d.setUint32(o + at32, Math.min(value, 0xFFFFFFFF));
  return out;
}

function trackBox(b, P, movieScale, chunks) {
  const { t } = P, mdia = need(b, t.trak, 'mdia'), minf = need(b, mdia, 'minf');
  const segment = Math.round(P.shown * movieScale), whole = Math.round(P.delay * movieScale) + segment;
  const stsc = []; runs(chunks.length, k => chunks[k].n).reduce((first, [count, per]) => (stsc.push([first, per, 1]), first + count), 1);
  // 64-bit edits (version 1): some movies count time in hundreds of millions per second, and seconds of that overflow 32 bits
  const hi = n => Math.floor(n / 4294967296), edit = (d, m) => [hi(d), d >>> 0, ...(m < 0 ? [0xFFFFFFFF, 0xFFFFFFFF] : [hi(m), m >>> 0]), 0x10000];
  const edits = [...(P.delay ? [edit(Math.round(P.delay * movieScale), -1)] : []), edit(segment, P.mediaTime)];
  // a track may write its codec settings for the piece (Opus: what to skip at its start)
  const stbl = [t.stsdFor ? t.stsdFor(P) : b.slice(t.stsd.start, t.stsd.end),
    table('stts', 0, runs(P.n, i => P.dur[i]), 2),
    ...(kid(b, t.stbl, 'ctts') ? [table('ctts', t.cttsVersion, runs(P.n, i => P.cto[i]), 2)] : []),
    ...(t.sync ? [table('stss', 0, [...Array(P.n).keys()].filter(i => t.sync[P.from + i]).map(i => [i + 1]), 1)] : []),
    table('stsc', 0, stsc, 3),
    box('stsz', be32(0), be32(0), be32(P.n), ...Array.from(t.size.subarray(P.from, P.to + 1), be32)),
    table('stco', 0, chunks.map(c => [c.at]), 1)];
  return box('trak',
    withDuration(b, need(b, t.trak, 'tkhd'), 20, 28, whole),
    box('edts', table('elst', 1, edits, 5)),
    box('mdia', withDuration(b, need(b, mdia, 'mdhd'), 16, 24, P.media), b.slice(need(b, mdia, 'hdlr').start, need(b, mdia, 'hdlr').end),
      box('minf', ...boxes(b, minf).map(k => k.type === 'stbl' ? box('stbl', ...stbl) : b.slice(k.start, k.end)))));
}

// an MP4/MOV as the cutter needs it: its moov (b), the mvhd in it, the movie's time scale, the tracks' sample tables, its ftyp
async function indexMp4(read, size) {
  const top = await topBoxes(read, size);
  if (top.some(x => x.type === 'moof')) fail('the video is a fragmented MP4 (as streamed), which can\'t be cut yet');
  const moovBox = top.find(x => x.type === 'moov') ?? notMp4(), ftypBox = top.find(x => x.type === 'ftyp');
  const b = await read(moovBox.start, moovBox.size), moov = { body: moovBox.body - moovBox.start, end: moovBox.size, start: 0 };
  const mvhd = need(b, moov, 'mvhd'), movieScale = u32(b, mvhd.body + (b[mvhd.body] ? 20 : 12));
  const tracks = boxes(b, moov).filter(x => x.type === 'trak').map(x => readTrack(b, x, movieScale));
  return { b, mvhd, movieScale, tracks, ftyp: ftypBox ? await read(ftypBox.start, ftypBox.size) : new Uint8Array(0) };
}
const isMatroska = async read => u32(await read(0, 4), 0) === 0x1A45DFA3;

// cut [t0, t1] (seconds) out of an MP4/MOV or a WebM/MKV → { bytes, start, end }: the new MP4, and where the selection is
// inside it (start is 0; end is the selection's length, shorter when the video ends first)
export async function cutVideo(read, size, t0, t1) {
  if (!(t1 > t0)) fail('the piece is empty: its end must be after its start');
  return cutIndex(await isMatroska(read) ? await indexWebm(read, size, t0, t1) : await indexMp4(read, size), read, t0, t1);
}
// only the sound of pieces of one video, as audio-only MP4s a browser can decode (the workbench's waveform and loop):
// none of the picture is read. An MP4/MOV is indexed once, here; a WebM/MKV per piece (its index is made around the
// piece, and its clusters hold picture and sound together). Returns cut(t0, t1) → { bytes, start, end } as cutVideo.
export async function soundCutter(read, size) {
  if (await isMatroska(read)) return async (t0, t1) => cutIndex(await indexWebm(read, size, t0, t1), read, t0, t1, true);
  const index = await indexMp4(read, size);
  return (t0, t1) => cutIndex(index, read, t0, t1, true);
}
async function cutIndex({ b, mvhd, movieScale, tracks, ftyp }, read, t0, t1, soundOnly = false) {
  if (!(t1 > t0)) fail('the piece is empty: its end must be after its start');
  const aud = tracks.find(t => t.kind === 'soun' && t.size.length);
  if (soundOnly) {
    if (!aud) fail('the video has no sound');
    return cutParts([pickSound(aud, t0, t1)], { b, mvhd, movieScale, ftyp }, read, t0, t1);
  }
  const vid = tracks.find(t => t.kind === 'vide' && t.size.length) ?? fail('the video has no picture');

  // picture: from the last keyframe at or before t0 to the last frame shown before t1
  const nv = vid.size.length; let s = 0;
  for (let i = 0; i < nv; i++) if ((!vid.sync || vid.sync[i]) && vid.pts(i) <= t0 + 1e-9) s = i;
  let e = s; for (let i = s; i < nv; i++) if (vid.pts(i) < t1 - 1e-9) e = i;
  // (with B-frames a frame decoded among those can be shown after t1: it is in the file, the edit list stops at t1)
  let end = vid.pts(s);
  for (let i = s; i <= e; i++) end = Math.max(end, vid.pts(i) + vid.dur[i] / vid.scale);
  end = Math.min(end, t1);
  const parts = [pick(vid, s, e, t0, end)];
  if (aud) parts.push(pickSound(aud, t0, end));
  return cutParts(parts, { b, mvhd, movieScale, ftyp }, read, t0, end);
}
// sound: from t0, one frame earlier (a decoder needs it to warm up; the edit list hides it), to end.
// lead: how much earlier than its timestamps a track's sound comes out of the decoder (Opus: its pre-skip); the edit
// list starts and ends that much later
function pickSound(aud, t0, end) {
  const na = aud.size.length, lead = aud.lead ?? 0; let a0 = 0, a1 = 0;
  for (let i = 0; i < na; i++) { if (aud.pts(i) <= t0 + 1e-9) a0 = i; if (aud.pts(i) < end + lead - 1e-9) a1 = i; }
  return pick(aud, Math.max(0, a0 - 1), Math.max(a0, a1), t0 + lead, end + lead);
}
// the new file from the picked parts: ftyp, moov, then one mdat where the tracks take turns
async function cutParts(parts, { b, mvhd, movieScale, ftyp }, read, t0, end) {
  // half a second of each track at a time
  const chunks = parts.map(P => { const out = []; let c = null;
    for (let i = P.from; i <= P.to; i++) {
      if (!c || P.t.dts[i] - c.dts >= CHUNK * P.t.scale) out.push(c = { dts: P.t.dts[i], time: P.t.dts[i] / P.t.scale, first: i, n: 0, bytes: 0 });
      c.n++; c.bytes += P.t.size[i];
    } return out; });
  const order = chunks.flatMap((cs, p) => cs.map(c => ({ c, p }))).sort((x, y) => x.c.time - y.c.time || x.p - y.p);
  const moovOf = () => box('moov', withDuration(b, mvhd, 16, 24, Math.max(...parts.map(P => Math.round((P.delay + P.shown) * movieScale)))),
    ...parts.map((P, p) => trackBox(b, P, movieScale, chunks[p])));
  const dataLen = order.reduce((a, { c }) => a + c.bytes, 0), head = ftyp.length + moovOf().length + 8;
  if (head + dataLen > 0xFFFFFFFF) fail('the piece is over 4 GB');
  let at = head; for (const { c } of order) { c.at = at; at += c.bytes; }
  const newMoov = moovOf(), out = new Uint8Array(head + dataLen);
  out.set(ftyp, 0); out.set(newMoov, ftyp.length);
  new DataView(out.buffer).setUint32(ftyp.length + newMoov.length, 8 + dataLen); out.set([109, 100, 97, 116], ftyp.length + newMoov.length + 4); // 'mdat'
  // copy the packets: neighbouring samples are read in one go
  for (const { c, p } of order) {
    const t = parts[p].t;
    for (let i = c.first, w = c.at; i < c.first + c.n;) {
      let j = i, len = t.size[i]; while (j + 1 < c.first + c.n && t.off[j + 1] === t.off[j] + t.size[j]) len += t.size[++j];
      out.set(await read(t.off[i], len), w); w += len; i = j + 1;
    }
  }
  return { bytes: out, start: 0, end: end - t0 };
}

// read(offset, length) for a Blob/File (browser) or a Uint8Array (tests, Node)
export const reader = src => src instanceof Uint8Array ? async (o, n) => src.subarray(o, o + n)
  : async (o, n) => new Uint8Array(await src.slice(o, o + n).arrayBuffer());
