// The file format [ZEN-EXPLICIT], [ZEN-PLAIN-TEXT]: instrument lines, song files, MP4 metadata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PTFormat from '../src/ptformat.js';

const LINE = 'TURD1;name=Kick 2;start=0.600;end=1.200;hit=0.850;base=D-4;vol=40;a=3t;d=0t;s=0.4;r=250ms;loop=forward;ls=0.900;le=1.100;av=20';

test('an instrument line round-trips', () => {
  const I = PTFormat.parse(LINE);
  assert.equal(I.name, 'Kick 2');
  assert.deepEqual(I.A, { v: 3, u: 't' });
  assert.deepEqual(I.R, { v: 250, u: 'ms' });
  assert.equal(PTFormat.format(I), LINE);
});

test('a missing optional field gets its default', () => {
  const I = PTFormat.parse('TURD1;name=x;start=0;end=1;hit=0.2;base=C-4');
  assert.equal(I.vol, 64);
  assert.equal(I.loop, 'none');
});

test('the format never guesses: an ADSR value without its unit is an error', () => {
  assert.throws(() => PTFormat.parse(LINE.replace('a=3t', 'a=3')), /'a' value '3' is invalid \(must be written with its unit/);
});

test('the old loop=1 is refused, and the error says what to write now', () => {
  assert.throws(() => PTFormat.parse(LINE.replace('loop=forward', 'loop=1')), /'loop' value '1' is invalid \(none, forward or pingpong; the old 1 is now 'forward'\)/);
});

test('loop start before the hit point is an error', () => {
  assert.throws(() => PTFormat.parse(LINE.replace('ls=0.900', 'ls=0.700')), /loop start \(0\.700\) can't be before the hit point \(0\.850\)/);
});

test('another format version is refused', () => {
  assert.throws(() => PTFormat.parse(LINE.replace('TURD1', 'TURD2')), /must start with 'TURD1'/);
});

function songZip(S, insts) {
  const enc = new TextEncoder(), files = PTFormat.formatSong(S, insts);
  return PTFormat.zipStore([...Object.entries(files).map(([name, t]) => ({ name, data: enc.encode(t) })), { name: 'videos/a.mp4', data: new Uint8Array([1, 2, 3]) }]);
}
const SONG = { title: 'T', bpm: 125, speed: 6, rowsPerBeat: 4, channels: [{ name: 'kick', pan: 0x80 }, { name: '', pan: 0x40 }], order: [0, 0],
  patterns: [{ rows: [[{ n: 48, i: 1, v: 0x20, f: 15, p: 0x90 }, { n: 97, i: 0, v: -1, f: -1, p: 0 }], [{ n: -1, i: 0, v: -1, f: -1, p: 0 }, { n: -1, i: 0, v: -1, f: -1, p: 0 }]] }] };

test('a song round-trips through a .poop zip', async () => {
  const I = PTFormat.parse(LINE);
  const zip = await PTFormat.unzip(new Uint8Array(await new Blob(songZip(SONG, [{ I, video: 'videos/a.mp4' }])).arrayBuffer()));
  const res = PTFormat.parseSong(zip);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.song.order, [0, 0]);
  assert.deepEqual(res.song.channels, SONG.channels);
  assert.deepEqual(res.song.patterns[0].rows, SONG.patterns[0].rows);
  assert.equal(res.instruments[0].video, 'videos/a.mp4');
});

test('song errors say file:line', async () => {
  const zip = await PTFormat.unzip(new Uint8Array(await new Blob(songZip({ ...SONG, channels: SONG.channels }, [{ I: PTFormat.parse(LINE), video: 'videos/a.mp4' }])).arrayBuffer()));
  const txt = new TextDecoder().decode(zip.get('song.txt')).replace('channels=2', 'channels=9');
  zip.set('song.txt', new TextEncoder().encode(txt));
  const { errors } = PTFormat.parseSong(zip);
  assert.match(errors[0], /^song\.txt:\d+ +channels=9 is invalid \(1–8\)/);
});

// a minimal MP4 (ftyp + moov + mdat): the tag goes into moov/udta/meta, chunk offsets move with it
function box(type, ...parts) {
  const len = 8 + parts.reduce((a, p) => a + p.length, 0), b = new Uint8Array(len);
  new DataView(b.buffer).setUint32(0, len); b.set(new TextEncoder().encode(type), 4);
  let o = 8; for (const p of parts) { b.set(p, o); o += p.length; }
  return b;
}
test('an instrument line is written into MP4 metadata and read back', () => {
  const mvhd = box('mvhd', new Uint8Array(100));
  const mp4 = new Uint8Array([...box('ftyp', new TextEncoder().encode('isom\0\0\0\0isom')), ...box('moov', mvhd), ...box('mdat', new Uint8Array(16))]);
  assert.equal(PTFormat.mp4ReadTag(mp4), null);
  const tagged = PTFormat.mp4WriteTag(mp4, LINE);
  assert.equal(PTFormat.mp4ReadTag(tagged), LINE);
  assert.equal(PTFormat.mp4ReadTag(PTFormat.mp4WriteTag(tagged, LINE.replace('Kick 2', 'Kick 3'))), LINE.replace('Kick 2', 'Kick 3'));
});
