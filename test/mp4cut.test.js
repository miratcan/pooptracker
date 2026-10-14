// Cutting a piece out of a video without re-encoding (the workbench). The fixture is 6 s of ffmpeg's testsrc2 at
// 30 fps (H.264 with B-frames, a keyframe every second) with a 440 Hz AAC tone, made by:
//   ffmpeg -f lavfi -i testsrc2=size=96x54:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 6 \
//     -c:v libx264 -g 30 -bf 2 -pix_fmt yuv420p -c:a aac -b:a 32k av.mp4
// bigscale.mp4: 7 s, 64x36 15 fps, a keyframe every 10 s, -movie_timescale 771888000.
// The same 6 s as WebM/MKV (the piece is an MP4 all the same):
//   vp9.webm  -c:v libvpx-vp9 -g 30 -b:v 60k -c:a libopus -b:a 24k
//   av1.webm  size 96x64, -c:v libsvtav1 -g 30 -b:v 60k -c:a libopus -b:a 24k
//   av.mkv    ffmpeg -i av.mp4 -c copy av.mkv (H.264 with B-frames, AAC)
//   vp8.webm  1 s of 32x18 at 10 fps, -c:v libvpx (VP8 has no place in MP4)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cutVideo, reader } from '../src/mp4cut.js';
import { boxes, box, u32, fourcc, be32 } from '../src/mp4.js';
import PTFormat from '../src/ptformat.js';

const SRC = new Uint8Array(readFileSync(new URL('./fixtures/av.mp4', import.meta.url)));
const cut = (t0, t1, b = SRC) => cutVideo(reader(b), b.length, t0, t1);
const bad = () => { throw new Error('bad box'); };
const find = (b, x, ...path) => path.reduce((p, t) => boxes(b, p.body, p.end, bad).find(k => k.type === t), x);
// per track: [handler, sample count, first sample is a keyframe]
function tracks(b) {
  const moov = boxes(b, 0, b.length, bad).find(x => x.type === 'moov');
  return boxes(b, moov.body, moov.end, bad).filter(x => x.type === 'trak').map(t => {
    const stbl = find(b, t, 'mdia', 'minf', 'stbl'), stss = find(b, stbl, 'stss');
    return [fourcc(b, find(b, t, 'mdia', 'hdlr').body + 8), u32(b, find(b, stbl, 'stsz').body + 8), !stss || u32(b, stss.body + 8) === 1];
  });
}

test('a piece holds the frames from the keyframe before the selection and plays exactly the selection', async () => {
  const r = await cut(2.4, 3.3);
  assert.ok(r.start === 0 && Math.abs(r.end - 0.9) < 1e-6, `${r.start} ${r.end}`);
  assert.deepEqual(tracks(r.bytes), [['vide', 39, true], ['soun', 44, true]]); // 2.0…3.27 s of frames, 0.9 s of sound + 1 warm-up frame
});

test('a movie that counts time very finely still gets a piece as long as the selection (64-bit edit lists)', async () => {
  // made with -movie_timescale 771888000 (as some phones write): 6 s of it doesn't fit in 32 bits
  const B = new Uint8Array(readFileSync(new URL('./fixtures/bigscale.mp4', import.meta.url))), r = await cut(0.5, 6.5, B);
  const moov = boxes(r.bytes, 0, r.bytes.length, bad).find(x => x.type === 'moov'), mvhd = find(r.bytes, moov, 'mvhd');
  const scale = u32(r.bytes, mvhd.body + (r.bytes[mvhd.body] ? 20 : 12));
  for (const t of boxes(r.bytes, moov.body, moov.end, bad).filter(x => x.type === 'trak')) {
    const elst = find(r.bytes, t, 'edts', 'elst'), n = u32(r.bytes, elst.body + 4), last = elst.body + 8 + 20 * (n - 1);
    assert.equal(r.bytes[elst.body], 1);
    const shown = (u32(r.bytes, last) * 4294967296 + u32(r.bytes, last + 4)) / scale;
    assert.ok(Math.abs(shown - 6) < 0.1, `${shown} s`);
  }
});

test('only the needed bytes of the source are read', async () => {
  let n = 0; const read = reader(SRC);
  await cutVideo((o, len) => { n += len; return read(o, len); }, SRC.length, 2.4, 2.6);
  assert.ok(n < SRC.length / 2, `${n} of ${SRC.length} bytes read`);
});

test('a piece is an ordinary MP4: it can be cut again and carry an instrument tag', async () => {
  const r = await cut(2.4, 3.3), again = await cut(0.2, 0.6, r.bytes);
  assert.ok(again.start === 0 && Math.abs(again.end - 0.4) < 1e-6, `${again.end}`);
  const line = 'TURD1;name=x;start=0;end=1;hit=0.2;base=C-4';
  assert.equal(PTFormat.mp4ReadTag(PTFormat.mp4WriteTag(r.bytes, line)), line);
});

test('what can\'t be cut says why', async () => {
  await assert.rejects(cut(1, 1), /the piece is empty/);
  await assert.rejects(cut(0, 1, new Uint8Array([0, 0, 0, 8, 0x41, 0x56, 0x49, 0x20, 0, 0, 0, 0])), /not MP4\/MOV, WebM or MKV/);
  await assert.rejects(cut(0, 1, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), /WebM\/MKV file is damaged/);
  const frag = new Uint8Array([...box('ftyp', new TextEncoder().encode('isom'), be32(0)), ...box('moov'), ...box('moof'), ...box('mdat')]);
  await assert.rejects(cut(0, 1, frag), /fragmented MP4/);
});

// ffmpeg isn't needed to run the tests; where it is installed it checks that the piece decodes and matches the source
let ffmpeg = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
test('ffmpeg decodes the piece and its frames are the source\'s frames', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp4cut-')), src = join(dir, 'src.mp4'), out = join(dir, 'cut.mp4');
  const r = await cut(2.4, 3.3);
  writeFileSync(src, SRC); writeFileSync(out, r.bytes);
  assert.equal(execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), '');
  const frame = (f, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  for (const t of [2.417, 2.95, 3.25]) assert.ok(frame(src, t).equals(frame(out, t - 2.4)), `frame at ${t}`);
});

const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
for (const name of ['vp9.webm', 'av1.webm', 'av.mkv']) {
  test(`a piece of ${name} is an MP4 cut the same way: from the keyframe before, exactly the selection`, async () => {
    const r = await cut(2.4, 3.3, fixture(name));
    assert.ok(r.start === 0 && Math.abs(r.end - 0.9) < 1e-6, `${r.start} ${r.end}`);
    const [v, a] = tracks(r.bytes);
    assert.deepEqual([v[0], v[2], a[0]], ['vide', true, 'soun']);
    assert.ok(v[1] >= 27 && v[1] <= 40, `${v[1]} frames`); // 0.9 s and the frames from the keyframe before it
    const line = 'TURD1;name=x;start=0;end=0.9;hit=0.2;base=C-4';
    assert.equal(PTFormat.mp4ReadTag(PTFormat.mp4WriteTag(r.bytes, line)), line);
  });
  test(`ffmpeg decodes the piece of ${name} and its frames are the source's frames`, { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webmcut-')), src = join(dir, name), out = join(dir, 'cut.mp4'), S = fixture(name);
    const r = await cut(2.4, 3.3, S);
    writeFileSync(src, S); writeFileSync(out, r.bytes);
    assert.equal(execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), '');
    const frame = (f, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    for (const t of [2.417, 2.95, 3.25]) assert.ok(frame(src, t).equals(frame(out, t - 2.4)), `frame at ${t}`);
  });
}
test('a codec MP4 has no place for is refused by name', async () => {
  await assert.rejects(cut(0.2, 0.6, fixture('vp8.webm')), /the picture is VP8, which can't go into an MP4 piece/);
});
test('an Opus piece says where its sound starts twice, the same: in the edit list (ffmpeg) and the pre-skip (Chrome)', async () => {
  const r = await cut(2.41, 3.3, fixture('vp9.webm')), b = r.bytes;
  const moov = boxes(b, 0, b.length, bad).find(x => x.type === 'moov');
  const t = boxes(b, moov.body, moov.end, bad).filter(x => x.type === 'trak').find(x => fourcc(b, find(b, x, 'mdia', 'hdlr').body + 8) === 'soun');
  const mdhd = find(b, t, 'mdia', 'mdhd'), scale = u32(b, mdhd.body + 12);
  const elst = find(b, t, 'edts', 'elst'), mediaTime = u32(b, elst.body + 8 + 8) * 4294967296 + u32(b, elst.body + 8 + 12); // version 1: duration, then media time
  const entry = boxes(b, find(b, t, 'mdia', 'minf', 'stbl', 'stsd').body + 8, find(b, t, 'mdia', 'minf', 'stbl', 'stsd').end, bad)[0];
  const dops = boxes(b, entry.body + 28, entry.end, bad).find(x => x.type === 'dOps'), preSkip = (b[dops.body + 2] << 8) | b[dops.body + 3];
  assert.ok(Math.abs(preSkip / 48000 - mediaTime / scale) < 1 / 1000, `pre-skip ${preSkip / 48} ms, edit list ${mediaTime / scale * 1000} ms`);
  assert.ok(preSkip / 48 > 6.5, `${preSkip / 48} ms: the file's own pre-skip (312 samples) and the warm-up packet`);
});
