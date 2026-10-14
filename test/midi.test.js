// MIDI import: .mid bytes → song. The files are written here, byte by byte, so each test shows what it feeds in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, midiToSong } from '../src/midi.js';
import PTFormat from '../src/ptformat.js';

// a Standard MIDI File: tracks = [[deltaTicks, ...eventBytes], …] (a track name is a meta event like any other)
const vlq = n => { const b = [n & 0x7F]; while ((n >>= 7)) b.unshift(0x80 | (n & 0x7F)); return b; };
const u32 = n => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
function smf(tracks, { ppq = 96, format = 1 } = {}) {
  const out = [...'MThd'].map(c => c.charCodeAt(0)).concat(u32(6), [0, format, 0, tracks.length, ppq >> 8, ppq & 255]);
  for (const t of tracks) {
    const body = t.flatMap(([dt, ...ev]) => [...vlq(dt), ...ev]).concat([0, 0xFF, 0x2F, 0]);
    out.push(...[...'MTrk'].map(c => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(out);
}
const name = s => [0, 0xFF, 0x03, s.length, ...[...s].map(c => c.charCodeAt(0))];
const tempo = (dt, bpm) => { const us = Math.round(60e6 / bpm); return [dt, 0xFF, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255]; };
const on = (dt, key, vel = 100, ch = 0) => [dt, 0x90 | ch, key, vel];
const off = (dt, key, ch = 0) => [dt, 0x80 | ch, key, 0];
const cellsOf = (S, ch) => S.patterns[S.order[0]].rows.map(r => r[ch]);
const valid = S => { for (const P of S.patterns) for (const r of P.rows) for (const c of r) assert.equal(PTFormat.checkCell(c, 255), null); };

test('a track becomes an instrument; sixteenths land on rows, tempo is the BPM, note-off is a key-off', () => {
  const S = midiToSong(parseMidi(smf([
    [tempo(0, 100)],
    [name('Bass'), on(0, 60, 127), off(48, 60), on(0, 62, 64), off(24, 62)], // C4 for 2 rows, D4 for 1 (ppq 96: a row is 24 ticks)
  ])), 'song');
  assert.deepEqual(S.names, ['Bass']);
  assert.deepEqual([S.song.bpm, S.song.speed, S.song.rowsPerBeat, S.song.channels.length], [100, 6, 4, 1]);
  const c = cellsOf(S.song, 0);
  assert.deepEqual(c[0], { n: 48, i: 1, v: -1, f: -1, p: 0 }); // C4 = C-4, velocity 127 = the instrument's own volume
  assert.deepEqual([c[2].n, c[2].v], [50, 32]);                // D-4, velocity 64 → volume 20
  assert.equal(c[3].n, PTFormat.KEYOFF);
  assert.deepEqual(S.report, []);
  valid(S.song);
});

test('a chord spreads over channels; drums are one instrument per sound, at C-4, with no key-off', () => {
  const S = midiToSong(parseMidi(smf([
    [name('Keys'), on(0, 60), on(0, 64), on(0, 67), off(96, 60), off(0, 64), off(0, 67)],
    [name('Drums'), on(0, 36, 100, 9), off(6, 36, 9), on(42, 38, 100, 9), off(6, 38, 9)],
  ])));
  assert.deepEqual(S.names, ['Keys', 'Kick', 'Snare']);
  assert.equal(S.song.channels.length, 5); // 3 for the chord, 1 each for kick and snare
  const row0 = S.song.patterns[0].rows[0];
  assert.deepEqual(row0.map(c => c.i), [1, 1, 1, 2, 0]);
  assert.deepEqual(row0.slice(0, 3).map(c => c.n), [48, 52, 55]);
  assert.equal(row0[3].n, 48);
  const snare = S.song.patterns[0].rows[2].find(c => c.i === 3);
  assert.equal(snare.n, 48);
  assert.ok(!S.song.patterns[0].rows.some(r => r[3].n === PTFormat.KEYOFF)); // the kick's channel has no key-off
  valid(S.song);
});

test('each instrument keeps to its own channels when they fit in 10', () => {
  const S = midiToSong(parseMidi(smf([
    [name('Drums'), on(0, 36, 100, 9), off(6, 36, 9), on(18, 42, 100, 9), off(6, 42, 9), on(18, 38, 100, 9), off(6, 38, 9), on(18, 42, 100, 9), off(6, 42, 9)],
    [name('Bass'), on(0, 36, 100, 1), off(60, 36, 1), on(36, 38, 100, 1), off(60, 38, 1)],
  ])));
  assert.deepEqual(S.names, ['Kick', 'Snare', 'Hi-hat', 'Bass']);
  const where = new Map();
  for (const r of S.song.patterns[0].rows) r.forEach((c, ch) => { if (c.i) (where.get(c.i) ?? where.set(c.i, new Set()).get(c.i)).add(ch); });
  assert.deepEqual([...where].sort((a, b) => a[0] - b[0]).map(([i, chs]) => [i, [...chs]]), [[1, [0]], [2, [1]], [3, [2]], [4, [3]]]);
});

test('the grid holds every note: triplets get 3 rows per beat; notes off every grid are moved and said so', () => {
  const trip = midiToSong(parseMidi(smf([[on(0, 60), off(32, 60), on(0, 62), off(32, 62), on(0, 64), off(32, 64)]])));
  assert.deepEqual([trip.song.rowsPerBeat, trip.song.speed], [3, 8]);
  assert.deepEqual(trip.song.patterns[0].rows.slice(0, 3).map(r => r[0].n), [48, 50, 52]);
  const played = midiToSong(parseMidi(smf([[on(5, 60), off(40, 60), on(53, 62), off(40, 62)]])));
  assert.equal(played.song.rowsPerBeat, 4);
  assert.match(played.report.join('\n'), /2 notes moved to the nearest row/);
});

test('more than 10 notes at once: the rest are dropped and counted; a tempo change is an Fxx; repeated patterns are stored once', () => {
  const chord = [...Array(12)].map((_, k) => on(0, 50 + k)), S = midiToSong(parseMidi(smf([[...chord, off(96, 50)]])));
  assert.equal(S.song.channels.length, 10);
  assert.match(S.report.join('\n'), /2 notes dropped: more than 10 at once/);
  const bar = [on(0, 36, 100, 9), off(24, 36, 9), [24 * 63, 0xB0, 0, 0]]; // one kick, then 64 rows of nothing
  const T = midiToSong(parseMidi(smf([[tempo(0, 120), tempo(1536, 140)], [...bar, ...bar, ...bar]])));
  assert.deepEqual(T.song.order, [0, 1, 0]); // the tempo change at row 40 makes the second pattern differ
  const F = T.song.patterns.flatMap(P => P.rows).find(r => r.some(c => c.f === PTFormat.FXCH.indexOf('F')));
  assert.ok(F && F.some(c => c.p === 140));
});

test('a file that is not MIDI, or a kind we do not read, is refused with a reason', () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])), /not a MIDI file/);
  assert.throws(() => parseMidi(smf([[on(0, 60)]], { format: 2 })), /type 2 files aren't supported/);
  assert.throws(() => midiToSong(parseMidi(smf([[tempo(0, 120)]]))), /has no notes/);
});
