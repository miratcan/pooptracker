// WebM/MKV for the cutter (mp4cut.js): reads where the packets of a Matroska file are and when they play, and describes
// them as an MP4 movie would (a moov with one trak per track, and its sample tables). The cutter then writes the piece
// as an ordinary MP4, copying the packets byte for byte: nothing is re-encoded ([ZEN-NOT-A-VIDEO-EDITOR]).
// Only codecs that have a place in MP4 can go: AV1, VP9, H.264 and HEVC pictures, Opus and AAC sound.
//
// Only the clusters around the piece are read: their timestamps first (a few bytes each), then the ones the piece needs.
import { boxes, box, be32 } from './mp4.js';

const fail = msg => { throw new Error(msg); };
const bad = () => fail('the WebM/MKV file is damaged');
const ID = { EBML: 0x1A45DFA3, Segment: 0x18538067, Info: 0x1549A966, TimestampScale: 0x2AD7B1, Tracks: 0x1654AE6B, TrackEntry: 0xAE,
  TrackNumber: 0xD7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63A2, DefaultDuration: 0x23E383, Video: 0xE0, PixelWidth: 0xB0,
  PixelHeight: 0xBA, Audio: 0xE1, SamplingFrequency: 0xB5, Channels: 0x9F, ContentEncodings: 0x6D80, Cluster: 0x1F43B675, Timestamp: 0xE7,
  SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, BlockDuration: 0x9B, ReferenceBlock: 0xFB, Tags: 0x1254C367, Tag: 0x7373,
  SimpleTag: 0x67C8, TagName: 0x45A3, TagString: 0x4487 };
// the elements that sit next to clusters in a segment: where a cluster of unknown size ends
const TOP = new Set([ID.Cluster, 0x1C53BB6B, 0x1254C367, 0x1043A770, 0x1941A469, ID.Info, ID.Tracks, 0x114D9B74]);

// an EBML number: an element ID keeps its length marker, a size loses it (all ones = unknown size)
function vint(b, o, keepMarker) {
  const first = b[o]; if (first === undefined || !first) bad();
  const len = Math.clz32(first) - 23;
  let v = keepMarker ? first : first & (0xFF >> len), ones = (first & (0xFF >> len)) === 0xFF >> len;
  for (let k = 1; k < len; k++) { v = v * 256 + b[o + k]; if (b[o + k] !== 0xFF) ones = false; }
  return { v, len, unknown: !keepMarker && ones };
}
// the element at o: { id, body, end } (end is null when its size is unknown)
function element(b, o, base = 0) {
  const id = vint(b, o, true), size = vint(b, o + id.len, false), body = o + id.len + size.len;
  return { id: id.v, at: base + o, body: base + body, end: size.unknown ? null : base + body + size.v };
}
function children(b, start, end) {
  const out = [];
  for (let o = start; o < end;) { const e = element(b, o); if (e.end === null || e.end > end) bad(); out.push(e); o = e.end; }
  return out;
}
const uint = (b, e) => { let v = 0; for (let o = e.body; o < e.end; o++) v = v * 256 + b[o]; return v; };
const float = (b, e) => { const d = new DataView(b.buffer, b.byteOffset + e.body, e.end - e.body); return e.end - e.body === 4 ? d.getFloat32(0) : d.getFloat64(0); };
const str = (b, e) => new TextDecoder().decode(b.subarray(e.body, e.end)).replace(/\0+$/, '');
const kid = (b, e, id) => children(b, e.body, e.end).find(k => k.id === id);

function readTracks(b, tracksEl) {
  return children(b, tracksEl.body, tracksEl.end).filter(e => e.id === ID.TrackEntry).map(te => {
    const get = id => kid(b, te, id), video = get(ID.Video), audio = get(ID.Audio), cp = get(ID.CodecPrivate), dd = get(ID.DefaultDuration);
    return { num: uint(b, get(ID.TrackNumber)), type: uint(b, get(ID.TrackType)), codec: str(b, get(ID.CodecID)),
      priv: cp ? b.slice(cp.body, cp.end) : null, defaultDur: dd ? uint(b, dd) : 0, encoded: !!get(ID.ContentEncodings),
      width: video && kid(b, video, ID.PixelWidth) ? uint(b, kid(b, video, ID.PixelWidth)) : 0,
      height: video && kid(b, video, ID.PixelHeight) ? uint(b, kid(b, video, ID.PixelHeight)) : 0,
      rate: audio && kid(b, audio, ID.SamplingFrequency) ? float(b, kid(b, audio, ID.SamplingFrequency)) : 8000,
      channels: audio && kid(b, audio, ID.Channels) ? uint(b, kid(b, audio, ID.Channels)) : 1 };
  });
}

// the segment's parts: info, tracks, and every cluster with its timestamp (only their first bytes are read)
async function layout(read, size) {
  const head = await read(0, Math.min(64, size)), ebml = element(head, 0);
  if (ebml.id !== ID.EBML || ebml.end === null) bad();
  const seg = element(await read(ebml.end, 16), 0, ebml.end);
  if (seg.id !== ID.Segment) bad();
  const segEnd = seg.end === null ? size : Math.min(seg.end, size), out = { clusters: [] };
  for (let o = seg.body; o < segEnd;) {
    const h = await read(o, Math.min(64, segEnd - o)); if (h.length < 2) break;
    const e = element(h, 0, o);
    if (e.id === ID.Info || e.id === ID.Tracks || e.id === ID.Tags) { const end = e.end ?? bad(); out[{ [ID.Info]: 'info', [ID.Tracks]: 'tracks', [ID.Tags]: 'tags' }[e.id]] = { b: await read(e.at, end - e.at), e: { ...e, body: e.body - e.at, end: end - e.at } }; }
    if (e.id === ID.Cluster) {
      // its timestamp is among its first elements (after a CRC-32 at most)
      let tsEl = null; for (let p = e.body - o; !tsEl && p + 2 < h.length;) { const k = element(h, p); if (k.id === ID.Timestamp) tsEl = k; else if (k.end === null) break; else p = k.end; }
      out.clusters.push({ body: e.body, end: e.end ?? await clusterEnd(read, e.body, segEnd), ts: tsEl && tsEl.end <= h.length ? uint(h, tsEl) : bad() });
      o = out.clusters.at(-1).end; continue;
    }
    if (e.end === null) bad();
    o = e.end;
  }
  if (!out.info || !out.tracks) bad();
  return out;
}
// a cluster written while recording (MediaRecorder) doesn't say how long it is: it ends where the next top-level element starts
async function clusterEnd(read, o, end) {
  while (o < end) {
    const h = await read(o, Math.min(16, end - o)); if (h.length < 2) break;
    const e = element(h, 0, o); if (TOP.has(e.id) || e.end === null) return o;
    o = e.end;
  }
  return end;
}

// the packets of the tracks we keep, in one cluster: { track, pts (in timestamp units), off, size, key, dur }
async function readCluster(read, c, want) {
  const b = await read(c.body, c.end - c.body), out = [];
  for (const e of children(b, 0, b.length)) {
    let blk = e, key = null, dur = null;
    if (e.id === ID.BlockGroup) {
      const ks = children(b, e.body, e.end); blk = ks.find(k => k.id === ID.Block); if (!blk) continue;
      key = !ks.some(k => k.id === ID.ReferenceBlock); const d = ks.find(k => k.id === ID.BlockDuration); if (d) dur = uint(b, d);
    } else if (e.id !== ID.SimpleBlock) continue;
    const tn = vint(b, blk.body, false), o = blk.body + tn.len, track = want.get(tn.v); if (!track) continue;
    const flags = b[o + 2];
    if (flags & 0x06) fail('the WebM/MKV file packs several packets in one block (lacing), which can\'t be cut yet');
    out.push({ track, pts: c.ts + ((b[o] << 24 >> 16) | b[o + 1]), off: c.body + o + 3, size: blk.end - (o + 3), key: key ?? !!(flags & 0x80), dur });
  }
  return out;
}

// MP4 sample entries: the codec and its settings, as MP4 writes them
const enc = new TextEncoder(), bytes = (...a) => new Uint8Array(a), u16 = n => bytes(n >> 8 & 255, n & 255);
function visualEntry(type, w, h, ...config) {
  return box(type, new Uint8Array(6), u16(1), new Uint8Array(16), u16(w), u16(h), be32(0x480000), be32(0x480000), be32(0), u16(1),
    new Uint8Array(32), u16(0x18), u16(0xFFFF), ...config);
}
const audioEntry = (type, channels, rate, ...config) => box(type, new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), be32(0),
  be32(Math.min(rate, 65535) * 65536), ...config);
// VP9 has no settings in WebM: profile and bit depth come from the first keyframe's header
function vpcC(first) {
  const p = first ? (first[0] >> 5 & 1) | (first[0] >> 3 & 2) : 0;
  return box('vpcC', bytes(1, 0, 0, 0, p, 10, (p >= 2 ? 10 : 8) << 4 | 1 << 1, 2, 2, 2), u16(0));
}
// Opus: WebM keeps the OpusHead (little-endian), MP4 the dOps (big-endian) with the same fields. preSkip: the samples
// (at 48 kHz) to drop at the start, the file's own when not given
const opusHead = h => h && new TextDecoder().decode(h.subarray(0, 8)) === 'OpusHead' ? h : fail('the Opus sound has no settings (OpusHead)');
function dOps(h, preSkip) {
  const d = new DataView(opusHead(h).buffer, h.byteOffset), out = new DataView(new ArrayBuffer(11));
  out.setUint8(1, h[9]); out.setUint16(2, preSkip ?? d.getUint16(10, true)); out.setUint32(4, d.getUint32(12, true)); out.setInt16(8, d.getInt16(16, true)); out.setUint8(10, h[18]);
  return box('dOps', new Uint8Array(out.buffer), h.subarray(19));
}
// AAC: the decoder settings (AudioSpecificConfig) inside an MPEG-4 elementary stream descriptor
function esds(asc) {
  if (!asc) fail('the AAC sound has no settings (AudioSpecificConfig)');
  const desc = (tag, ...p) => { const body = p.reduce((a, x) => [...a, ...x], []); return [tag, body.length, ...body]; };
  const dec = desc(4, [0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], desc(5, [...asc]));
  return box('esds', be32(0), new Uint8Array(desc(3, [0, 1, 0], dec, desc(6, [2]))));
}
function sampleEntry(t, firstPacket) {
  const need = what => t.priv ?? fail(`the ${what} picture has no settings (CodecPrivate)`);
  switch (t.codec) {
    case 'V_AV1': return visualEntry('av01', t.width, t.height, box('av1C', need('AV1')));
    case 'V_VP9': return visualEntry('vp09', t.width, t.height, vpcC(firstPacket));
    case 'V_MPEG4/ISO/AVC': return visualEntry('avc1', t.width, t.height, box('avcC', need('H.264')));
    case 'V_MPEGH/ISO/HEVC': return visualEntry('hvc1', t.width, t.height, box('hvcC', need('HEVC')));
    case 'A_OPUS': return audioEntry('Opus', t.channels, 48000, dOps(t.priv));
    case 'A_AAC': return audioEntry('mp4a', t.channels, t.rate, esds(t.priv));
  }
  if (/^A_AAC\//.test(t.codec)) fail(`the sound is ${t.codec}, AAC without its settings, which can't be cut yet`);
  fail(`the ${t.type === 1 ? 'picture' : 'sound'} is ${t.codec.replace(/^[VA]_/, '')}, which can't go into an MP4 piece (only AV1, VP9, H.264, HEVC pictures and Opus, AAC sound can; yt-dlp: -f mp4)`);
}

// the parts of a movie the cutter reads from an MP4 (mvhd; per track tkhd, mdhd, hdlr, minf with stsd), written for the WebM's tracks
const full = (type, v, flags, ...p) => box(type, bytes(v, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...p);
const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(be32);
function trak(id, kind, scale, w, h, entry, hasCtts) {
  return box('trak',
    full('tkhd', 0, 3, be32(0), be32(0), be32(id), be32(0), be32(0), new Uint8Array(8), u16(0), u16(0), u16(kind === 'soun' ? 0x100 : 0), u16(0), ...MATRIX, be32(w * 65536), be32(h * 65536)),
    box('mdia', full('mdhd', 0, 0, be32(0), be32(0), be32(scale), be32(0), u16(0x55C4), u16(0)),
      full('hdlr', 0, 0, be32(0), enc.encode(kind), new Uint8Array(12), enc.encode(kind === 'vide' ? 'VideoHandler\0' : 'SoundHandler\0')),
      box('minf', kind === 'vide' ? full('vmhd', 0, 1, new Uint8Array(8)) : full('smhd', 0, 0, new Uint8Array(4)),
        box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))),
        box('stbl', full('stsd', 0, 0, be32(1), entry), ...(hasCtts ? [full('ctts', 1, 0, be32(0))] : [])))));
}

// a text from a video's metadata as the link it comes from: only an http(s) link counts (a comment can be anything)
export const asLink = s => typeof s === 'string' && /^https?:\/\/\S+$/.test(s.trim()) && s.trim().length <= 400 ? s.trim() : null;
// the link the file says it comes from (its PURL tag, else its COMMENT; yt-dlp --embed-metadata writes both), or null
function tagLink(L) {
  if (!L.tags) return null;
  const { b, e } = L.tags, found = {};
  for (const tag of children(b, e.body, e.end).filter(x => x.id === ID.Tag))
    for (const st of children(b, tag.body, tag.end).filter(x => x.id === ID.SimpleTag)) {
      const name = kid(b, st, ID.TagName), value = kid(b, st, ID.TagString);
      if (name && value) found[str(b, name).toUpperCase()] ??= str(b, value);
    }
  return asLink(found.PURL) ?? asLink(found.COMMENT);
}
export const webmLink = async (read, size) => tagLink(await layout(read, size));

// a WebM/MKV as the cutter sees an MP4: { b (a moov), mvhd, movieScale, tracks, ftyp, link }, with the packets around [t0, t1]
export async function indexWebm(read, size, t0, t1) {
  const L = await layout(read, size), { b: ib, e: ie } = L.info, ts = kid(ib, ie, ID.TimestampScale);
  const unit = (ts ? uint(ib, ts) : 1e6) / 1e9, scale = Math.round(1 / unit); // seconds per timestamp unit; MP4 counts in whole units
  if (Math.abs(scale * unit - 1) > 1e-9) fail('the WebM/MKV file counts time in steps that don\'t fit a whole second');
  const all = readTracks(L.tracks.b, L.tracks.e), vt = all.find(t => t.type === 1) ?? fail('the video has no picture'), at = all.find(t => t.type === 2);
  for (const t of [vt, at]) if (t?.encoded) fail('the WebM/MKV file compresses or encrypts its packets, which can\'t be cut');
  const want = new Map([[vt.num, vt], ...(at ? [[at.num, at]] : [])]), C = L.clusters;
  if (!C.length) fail('the video has no picture');
  // the clusters from the one that holds the last keyframe at or before t0 to the first one that starts after t1
  let k = 0; for (let i = 0; i < C.length; i++) if (C[i].ts * unit <= t0) k = i;
  let packets = [];
  for (let i = k; i < C.length && C[i].ts * unit <= t1 + 1; i++) packets.push(...await readCluster(read, C[i], want));
  for (; k > 0 && !packets.some(p => p.track === vt && p.key && p.pts * unit <= t0 + 1e-9); k--) packets = [...await readCluster(read, C[k - 1], want), ...packets];

  const movieScale = 1000, traks = [], tracks = [];
  for (const t of [vt, at].filter(Boolean)) {
    const P = packets.filter(p => p.track === t), n = P.length; if (!n) continue;
    const kind = t === vt ? 'vide' : 'soun', T = { kind, scale };
    // Matroska stores when each packet is shown; MP4 also wants when it is decoded: the shown times, in order
    const sorted = P.map(p => p.pts).sort((a, b) => a - b);
    T.dts = Float64Array.from(sorted); T.cto = Int32Array.from(P, (p, i) => p.pts - sorted[i]);
    T.size = Uint32Array.from(P, p => p.size); T.off = Float64Array.from(P, p => p.off);
    T.sync = kind === 'vide' ? Uint8Array.from(P, p => +p.key) : null;
    const last = P[n - 1].dur ?? (t.defaultDur ? Math.round(t.defaultDur / 1e9 / unit) : n > 1 ? sorted[n - 1] - sorted[n - 2] : 1);
    T.dur = Uint32Array.from(P, (p, i) => i + 1 < n ? sorted[i + 1] - sorted[i] : Math.max(1, last));
    T.cttsVersion = 1; T.delay = 0; T.mediaTime = 0;
    T.pts = i => (T.dts[i] + T.cto[i]) / scale;
    const firstKey = kind === 'vide' ? P.find(p => p.key) : null;
    traks.push(trak(traks.length + 1, kind, scale, t.width, t.height, sampleEntry(t, firstKey && await read(firstKey.off, 1)), T.cto.some(x => x)));
    // Opus: a packet's sound comes out of the decoder the file's pre-skip before its timestamp (WebM times count after
    // it), so the edit list starts that much later (lead). In MP4 the pre-skip must say the same as the edit list's start:
    // Chrome reads only the pre-skip, ffmpeg the edit list
    if (t.codec === 'A_OPUS') {
      T.lead = new DataView(opusHead(t.priv).buffer, t.priv.byteOffset).getUint16(10, true) / 48000;
      T.stsdFor = P => full('stsd', 0, 0, be32(1), audioEntry('Opus', t.channels, 48000, dOps(t.priv, Math.min(65535, Math.round(P.mediaTime / scale * 48000)))));
    }
    tracks.push(T);
  }
  if (!tracks.some(T => T.kind === 'vide')) fail('the video has no picture around the piece');
  const b = box('moov', full('mvhd', 0, 0, be32(0), be32(0), be32(movieScale), be32(0), be32(0x10000), u16(0x100), new Uint8Array(10), ...MATRIX,
    new Uint8Array(24), be32(traks.length + 1)), ...traks);
  const moov = { body: 8, end: b.length }, top = boxes(b, moov.body, moov.end, bad), find = (x, type) => boxes(b, x.body, x.end, bad).find(k => k.type === type);
  top.filter(x => x.type === 'trak').forEach((x, i) => {
    const T = tracks[i], stbl = find(find(find(x, 'mdia'), 'minf'), 'stbl');
    Object.assign(T, { trak: x, stbl, stsd: find(stbl, 'stsd') });
  });
  const brands = ['isom', 'iso6', 'mp41', ...(vt.codec === 'V_AV1' ? ['av01'] : [])];
  return { b, mvhd: top.find(x => x.type === 'mvhd'), movieScale, tracks, ftyp: box('ftyp', enc.encode('isom'), be32(0x200), ...brands.map(s => enc.encode(s))), link: tagLink(L) };
}
