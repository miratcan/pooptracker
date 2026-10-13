// MP4/MOV boxes: the small reading and writing tools shared by the metadata tag (ptformat.js) and the cutter
// (mp4cut.js). An ES module: the same file runs in the browser and in Node (tests).
export const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
export const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
export const be32 = n => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n); return a; };
const enc = new TextEncoder();

// the boxes between start and end → [{ type, start, size, body, end }]; bad() is called when they don't fit
export function boxes(b, start, end, bad) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    let size = u32(b, o), hdr = 8;
    if (size === 1) { if (o + 16 > end) bad(); size = u64(b, o + 8); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) bad();
    out.push({ type: fourcc(b, o + 4), start: o, size, body: o + hdr, end: o + size });
    o += size;
  }
  return out;
}
// type: 4 letters, or 4 raw bytes (ilst items are named by their key's number)
export function box(type, ...parts) {
  const len = 8 + parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len); out.set(typeof type === 'string' ? enc.encode(type) : type, 4);
  let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
