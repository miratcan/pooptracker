// MIDI files (.mid, Standard MIDI File type 0 / 1) → a song: patterns, order and one name per instrument.
// No DOM, no audio: the caller gives the instruments their videos. The rules (agreed 2026-10-13):
//   · one instrument per MIDI track (per track and channel in a type 0 file); on the drum channel (10) one per
//     drum sound, all played at C-4, never released (a drum hit is a one-shot)
//   · the grid is the coarsest of 4, 8, 3, 6, 12, 24 rows per beat that holds every note exactly; when none does
//     (played, not drawn), 4, and the notes that moved are counted. No EDx: a note sits on a row.
//   · MIDI tempo → BPM (speed × rowsPerBeat = 24, so the BPM is the MIDI tempo); tempo changes → Fxx
//   · velocity → volume column (127 = empty, the instrument's own volume); note-off → === (key-off)
//   · a channel plays one note at a time: notes that overlap go to other channels, at most 10; the rest are dropped.
//     Each instrument keeps to its own channels when they fit (a channel is a tile on screen)
// Nothing is done silently: everything that was moved, clamped or dropped is in the returned report.
import PTFormat from './ptformat.js';

const { KEYOFF, MAX_CHANNELS } = PTFormat;
const F_EFFECT = PTFormat.FXCH.indexOf('F'), ROWS = 64, MAX_ORDER = 256, DRUM_CH = 9;
const GRIDS = [[4, 6], [8, 3], [3, 8], [6, 4], [12, 2], [24, 1]]; // [rowsPerBeat, speed]: speed × rowsPerBeat = 24
const GM_DRUMS = { 35: 'Kick 2', 36: 'Kick', 37: 'Side stick', 38: 'Snare', 39: 'Clap', 40: 'Snare 2', 41: 'Low tom 2', 42: 'Hi-hat',
  43: 'Low tom', 44: 'Pedal hat', 45: 'Mid tom 2', 46: 'Open hat', 47: 'Mid tom', 48: 'High tom 2', 49: 'Crash', 50: 'High tom',
  51: 'Ride', 52: 'China', 53: 'Ride bell', 54: 'Tambourine', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 59: 'Ride 2' };

// bytes → { ppq, tempos: [{ tick, bpm }], parts: [{ name, drum, key?, notes: [{ tick, end, key, vel }] }] }
export function parseMidi(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 14 || tag(0) !== 'MThd') throw new Error("not a MIDI file (it doesn't start with MThd)");
  const format = d.getUint16(8), ntrk = d.getUint16(10), division = d.getUint16(12);
  if (format > 1) throw new Error(`MIDI type ${format} files aren't supported (only type 0 and 1)`);
  if (division & 0x8000) throw new Error('MIDI files timed in SMPTE frames aren\'t supported (only ticks per beat)');
  const ppq = division, tempos = [], parts = new Map();
  let o = 8 + d.getUint32(4);
  for (let t = 0; t < ntrk; t++) {
    if (o + 8 > bytes.length || tag(o) !== 'MTrk') throw new Error(`MIDI track ${t + 1} is missing or damaged`);
    const end = o + 8 + d.getUint32(o + 4);
    if (end > bytes.length) throw new Error(`MIDI track ${t + 1} is cut short`);
    o += 8;
    const vlq = () => { let v = 0, b; do { b = bytes[o++]; v = v * 128 + (b & 0x7F); } while (b & 0x80 && o < end); return v; };
    let tick = 0, status = 0, name = '';
    const on = new Map(); // channel·key → the sounding note
    const part = ch => {
      const k = `${t}:${ch}`;
      if (!parts.has(k)) parts.set(k, { track: t, ch, name: '', notes: [] });
      return parts.get(k);
    };
    const noteOff = (ch, key) => { const n = on.get(ch * 128 + key); if (n) { n.end = tick; on.delete(ch * 128 + key); } };
    while (o < end) {
      tick += vlq();
      let s = bytes[o];
      if (s & 0x80) o++; else s = status; // running status
      if (s === 0xFF) {
        const type = bytes[o++], len = vlq(), data = bytes.subarray(o, o + len); o += len;
        if (type === 0x03 && !name) name = new TextDecoder('latin1').decode(data).trim();
        else if (type === 0x51 && len === 3) tempos.push({ tick, bpm: 60e6 / (data[0] << 16 | data[1] << 8 | data[2]) });
        else if (type === 0x2F) break;
        continue;
      }
      // SysEx: skipped. (Not `o += vlq()`: that adds to o as it was before vlq() read the length, losing those bytes.)
      if (s === 0xF0 || s === 0xF7) { const len = vlq(); o += len; continue; }
      if (s < 0x80) throw new Error(`MIDI track ${t + 1}: unreadable data at byte ${o}`);
      status = s;
      const ch = s & 15, kind = s >> 4, a = bytes[o], b = bytes[o + 1];
      o += kind === 0xC || kind === 0xD ? 1 : 2;
      if (kind === 0x9 && b > 0) { noteOff(ch, a); const n = { tick, end: null, key: a, vel: b }; on.set(ch * 128 + a, n); part(ch).notes.push(n); }
      else if (kind === 0x8 || kind === 0x9) noteOff(ch, a);
    }
    for (const n of on.values()) n.end = tick; // never released: it ends with the track
    for (const p of parts.values()) if (p.track === t) p.name = name;
    o = end;
  }
  // drums: one part per drum sound
  const out = [], used = [...parts.values()].filter(p => p.notes.length);
  for (const p of used) {
    const name = p.name || `Track ${p.track + 1}`, shared = used.filter(q => q.track === p.track).length > 1; // a type 0 file: one track, many channels
    if (p.ch !== DRUM_CH) { out.push({ name: shared ? `${name.slice(0, 11)} ch${p.ch + 1}` : name, drum: false, notes: p.notes }); continue; }
    const byKey = new Map();
    for (const n of p.notes) { if (!byKey.has(n.key)) byKey.set(n.key, []); byKey.get(n.key).push(n); }
    for (const [key, notes] of [...byKey].sort((x, y) => x[0] - y[0])) out.push({ name: GM_DRUMS[key] ?? `Drum ${key}`, drum: true, key, notes });
  }
  tempos.sort((x, y) => x.tick - y.tick);
  return { ppq, tempos, parts: out };
}

// parsed MIDI → { song: { title, bpm, speed, rowsPerBeat, channels, patterns, order }, names: [instrument names], report: [lines] }
export function midiToSong(midi, title = '') {
  const { ppq, tempos, parts } = midi, report = [];
  if (!parts.length) throw new Error('the MIDI file has no notes');
  const starts = parts.flatMap(p => p.notes.map(n => n.tick));
  const [rpb, speed] = GRIDS.find(([r]) => starts.every(t => (t * r) % ppq === 0)) ?? GRIDS[0];
  const row = t => Math.round(t * rpb / ppq);
  const moved = starts.filter(t => (t * rpb) % ppq !== 0).length;
  if (moved) report.push(`${moved} note${moved > 1 ? 's' : ''} moved to the nearest row (the notes don't sit on a grid; the grid is ${rpb} rows per beat)`);

  // tempo: the first one is the song's BPM, later ones are Fxx
  const bpmOf = b => Math.max(32, Math.min(255, Math.round(b)));
  const t0 = tempos.find(x => x.tick === 0) ?? { bpm: 120 }, bpm = bpmOf(t0.bpm);
  if (Math.round(t0.bpm) !== bpm) report.push(`tempo ${t0.bpm.toFixed(1)} is outside 32–255: BPM ${bpm}`);
  const changes = []; let last = bpm;
  for (const x of tempos) if (x.tick > 0 && bpmOf(x.bpm) !== last) { last = bpmOf(x.bpm); changes.push({ row: row(x.tick), bpm: last }); }

  // instruments: in the file's order; drum sounds after their track
  const names = parts.map(p => p.name.slice(0, 16));
  if (names.length > 255) throw new Error(`the MIDI file has ${names.length} tracks and drum sounds; at most 255 instruments`);

  // notes → channels. A channel is a tile on screen, so each instrument gets channels of its own (as many as it
  // plays at once) when they all fit in 10; otherwise the channels are shared and a note takes any free one
  // (the one its instrument used last, first). A channel is free once its note has ended.
  const notes = parts.flatMap((p, k) => p.notes.map(n => ({ r: row(n.tick), off: Math.max(row(n.tick) + 1, row(n.end)), key: p.drum ? 60 : n.key, vel: n.vel, inst: k + 1, drum: p.drum })))
    .sort((a, b) => a.r - b.r || a.inst - b.inst);
  const until = n => n.drum ? n.r + 1 : n.off;
  const poly = parts.map((_, k) => {
    const ends = []; let most = 0;
    for (const n of notes) if (n.inst === k + 1) { ends.push(until(n)); most = Math.max(most, ends.filter(e => e > n.r).length); }
    return most;
  });
  const own = poly.reduce((a, b) => a + b, 0) <= MAX_CHANNELS;
  const home = []; let next = 0;
  poly.forEach((m, k) => { home[k + 1] = [...Array(m)].map(() => next++); });
  const busy = Array(MAX_CHANNELS).fill(-1), lastCh = new Map(), perCh = Array.from({ length: MAX_CHANNELS }, () => []);
  let dropped = 0, clamped = 0, nch = 1;
  for (const n of notes) {
    const free = c => busy[c] <= n.r;
    let c;
    if (own) c = home[n.inst].find(free) ?? -1;
    else { c = lastCh.get(n.inst); if (c == null || !free(c)) c = busy.findIndex((_, k) => free(k)); }
    if (c < 0) { dropped++; continue; }
    busy[c] = until(n); lastCh.set(n.inst, c); perCh[c].push(n); nch = Math.max(nch, c + 1);
  }
  if (dropped) report.push(`${dropped} note${dropped > 1 ? 's' : ''} dropped: more than ${MAX_CHANNELS} at once`);

  // rows → cells
  const kept = perCh.flat(), endRow = Math.max(...kept.map(n => n.drum ? n.r + 1 : n.off), ...changes.map(x => x.row + 1));
  let total = Math.ceil(endRow / ROWS) * ROWS;
  if (total / ROWS > MAX_ORDER) { report.push(`the song is longer than ${MAX_ORDER} patterns of ${ROWS} rows: the rest is cut`); total = MAX_ORDER * ROWS; }
  const empty = () => ({ n: -1, i: 0, v: -1, f: -1, p: 0 });
  const grid = Array.from({ length: total }, () => Array.from({ length: nch }, empty));
  perCh.forEach((list, c) => list.forEach((n, k) => {
    if (n.r >= total) return;
    let note = n.key - 12;
    if (note < 0 || note > 95) { clamped++; note = Math.max(0, Math.min(95, note)); }
    Object.assign(grid[n.r][c], { n: n.drum ? 48 : note, i: n.inst, v: n.vel >= 127 ? -1 : Math.round(n.vel / 127 * 64) });
    const next = list[k + 1];
    if (!n.drum && n.off < total && (!next || next.r > n.off)) grid[n.off][c].n = KEYOFF;
  }));
  if (clamped) report.push(`${clamped} note${clamped > 1 ? 's' : ''} outside C-0…B-7 moved to the nearest end`);
  for (const x of changes) {
    if (x.row >= total) continue;
    const c = grid[x.row].findIndex(cell => cell.f === -1);
    Object.assign(grid[x.row][c], { f: F_EFFECT, p: x.bpm });
  }
  if (changes.length) report.push(`${changes.length} tempo change${changes.length > 1 ? 's' : ''} written as Fxx`);

  // 64-row patterns; the same pattern twice is stored once
  const patterns = [], order = [], seen = new Map();
  for (let r = 0; r < total; r += ROWS) {
    const rows = grid.slice(r, r + ROWS), key = JSON.stringify(rows);
    if (!seen.has(key)) { seen.set(key, patterns.length); patterns.push({ rows }); }
    order.push(seen.get(key));
  }
  return {
    song: { title: title.slice(0, 64), bpm, speed, rowsPerBeat: rpb, channels: Array.from({ length: nch }, () => ({ name: '', pan: 0x80 })), patterns, order },
    names, report,
  };
}
