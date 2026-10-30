// PoopTracker instrument line: `TURD1;name=…;start=…;hit=…;…`
// One text "language" shared by the video metadata and song.txt in .poop.
// An ES module: the same file runs in the browser and in Node (tests).
import { u32, fourcc, be32, box, boxes as scan } from './mp4.js';

const VERSION = 'TURD1';
const NOTES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
const noteStr = n => NOTES[n % 12] + Math.floor(n / 12);
function noteNum(s) {
  const m = /^([A-G][-#])([0-7])$/.exec(s.toUpperCase());
  if (!m || !NOTES.includes(m[1])) return -1;
  return NOTES.indexOf(m[1]) + 12 * m[2];
}
const t3 = x => x.toFixed(3);
const round3 = x => Math.round(x * 1000) / 1000;
const esc = s => s.replace(/%/g, '%25').replace(/;/g, '%3B').replace(/=/g, '%3D');
const unesc = s => s.replace(/%3B/gi, ';').replace(/%3D/gi, '=').replace(/%25/g, '%');
const envStr = e => e.v + (e.u === 'ms' ? 'ms' : 't');
const ENV_MAX = { t: 999, ms: 30000 };
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
const MAX_CHANNELS = 10;
const KEYOFF = 97, FXCH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// effects kept from FT2; E only as E9x / ECx / EDx
const FX_ALLOWED = '3489AEFSIG', E_ALLOWED = [0x9, 0xC, 0xD];
// loop modes: none, forward (loop start → end, again), pingpong (start → end → start…)
const LOOP_MODES = ['none', 'forward', 'pingpong'];
// the focus path: where the picture looks (the point a tile keeps in its middle), as time:x,y keys joined by '|'.
// x, y are 0–1 across the frame (0,0 top left); between two keys the point moves in a straight line. No keys: the middle.
const MAX_FOCUS_KEYS = 1000;
const focusStr = keys => keys.map(k => `${t3(k.t)}:${k.x.toFixed(3)},${k.y.toFixed(3)}`).join('|');
// amplify, FT2's sample editor Volume: steps applied to the sample one after the other, each a gain in percent going
// from a at the region's start to b at its end (150-150 louder, 100-0 a fade out), clipped at full scale after each.
// It changes the sample itself (the video file stays as it is): 200-200 twice is not 400-400 once.
const MAX_AMP = 200, MAX_AMP_STEPS = 100;
const MAX_SOURCE = 500;
// tags: what the sound is, to find it by (snare, hit, crash): lowercase letters and digits, words joined by dashes,
// written joined by '|'. tagsFrom reads them as people type them: '#Snare #hit, crash' → ['snare', 'hit', 'crash']
const MAX_TAGS = 16, MAX_TAG = 24, TAG = /^[\p{Ll}\p{Lo}\p{N}]+(-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
const tagsFrom = text => [...new Set(String(text).split(/[\s,|]+/).map(t => t.replace(/^#+/, '').toLowerCase()).filter(Boolean))];
const ampStr = steps => steps.map(s => `${s.a}-${s.b}`).join('|');

function format(I, video) {
  const f = [VERSION, 'name=' + esc(I.name)];
  if (video) f.push('video=' + esc(video));
  f.push('start=' + t3(I.start), 'end=' + t3(I.end), 'hit=' + t3(I.hit), 'base=' + noteStr(I.baseNote), ...(I.fine ? ['fine=' + I.fine] : []),
    'vol=' + I.vol.toString(16).toUpperCase().padStart(2, '0'), 'rev=' + I.reverb.toString(16).toUpperCase().padStart(2, '0'),
    'a=' + envStr(I.A), 'd=' + envStr(I.D), 's=' + I.S.toString(16).toUpperCase().padStart(2, '0'), 'r=' + envStr(I.R),
    'loop=' + I.loop, 'ls=' + t3(I.loopStart), 'le=' + t3(I.loopEnd), 'av=' + Math.round(I.avOffset));
  if (I.amp?.length) f.push('amp=' + ampStr(I.amp));
  if (I.focus?.length) f.push('focus=' + focusStr(I.focus));
  if (I.tags?.length) f.push('tags=' + I.tags.join('|'));
  if (I.source) f.push('src=' + esc(I.source));
  return f.join(';');
}

// value parsers: return the value or throw a message that names the valid range
const bad = (k, v, why) => { throw new Error(`${VERSION} line: '${k}' value '${v}' is invalid (${why})`); };
const time = (k, v) => /^\d+(\.\d+)?$/.test(v) ? round3(+v) : bad(k, v, 'seconds, e.g. 1.250');
function env(k, v) {
  const m = /^(\d+)(t|ms)$/i.exec(v); // the unit is always written, never guessed
  if (!m) bad(k, v, 'must be written with its unit, e.g. 4t or 800ms');
  const u = m[2].toLowerCase(), n = +m[1];
  return n <= ENV_MAX[u] ? { v: n, u } : bad(k, v, `at most ${ENV_MAX[u]}${u}`);
}
const unit = /^(0(\.\d+)?|1(\.0+)?|\.\d+)$/; // 0–1
const focus = (k, v) => v.split('|').map(s => {
  const m = /^(\d+(?:\.\d+)?):([\d.]+),([\d.]+)$/.exec(s.trim());
  return m && unit.test(m[2]) && unit.test(m[3]) ? { t: round3(+m[1]), x: round3(+m[2]), y: round3(+m[3]) }
    : bad(k, v, `'${s}' must be time:x,y with x and y 0–1, e.g. 1.250:0.300,0.450`);
});
const amp = (k, v) => v.split('|').map(s => {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(s.trim());
  return m && +m[1] <= MAX_AMP && +m[2] <= MAX_AMP ? { a: +m[1], b: +m[2] } : bad(k, v, `'${s}' must be start-end in percent, 0–${MAX_AMP} each, e.g. 150-150 or 100-0`);
});
const PARSE = {
  name: (k, v) => unesc(v),
  video: (k, v) => unesc(v),
  start: time, end: time, hit: time, ls: time, le: time,
  base: (k, v) => { const n = noteNum(v); return n >= 0 ? n : bad(k, v, 'C-0…B-7'); },
  // finetune, FT2's: 1/128 of a semitone; written only when it isn't 0
  fine: (k, v) => /^[-+]?\d+$/.test(v) && +v >= -128 && +v <= 127 ? +v : bad(k, v, '-128–127, integer'),
  vol: (k, v) => /^[0-9A-F]{1,2}$/i.test(v) && parseInt(v, 16) <= 64 ? parseInt(v, 16) : bad(k, v, '00–40'),
  // how much of the sound goes to the reverb, hex like vol (00 = dry)
  rev: (k, v) => /^[0-9A-F]{1,2}$/i.test(v) && parseInt(v, 16) <= 64 ? parseInt(v, 16) : bad(k, v, '00–40'),
  a: env, d: env, r: env,
  // sustain level, hex like vol (00–40), always two digits. Files written before 2026-10-13 have it as 0–1 ('1', '0.4'):
  // one digit or a dot, so it can never be mistaken for the hex form; it is read as what it meant (1 → 40).
  s: (k, v) => /^[0-9A-F]{2}$/i.test(v) && parseInt(v, 16) <= 64 ? parseInt(v, 16)
    : /^(0|1)(\.\d+)?$|^0?\.\d+$/.test(v) && +v <= 1 ? Math.round(+v * 64) : bad(k, v, 'two hex digits 00–40'),
  // loop mode; files written before 2026-10-13 have 0 (off) / 1 (on), read as none / forward
  loop: (k, v) => LOOP_MODES.includes(v) ? v : v === '0' ? 'none' : v === '1' ? 'forward' : bad(k, v, 'none, forward or pingpong'),
  av: (k, v) => /^-?\d+$/.test(v) ? +v : bad(k, v, 'milliseconds, integer'),
  amp,
  focus,
  // where the video comes from: a link (a YouTube one with the second the piece starts at) or any text
  src: (k, v) => unesc(v),
  tags: (k, v) => { const t = v.split('|').map(s => s.trim()), e = checkTags(t); if (e) throw new Error(`${VERSION} line: ${e}`); return t; },
};
const KEYS = { name: 'name', video: 'video', start: 'start', end: 'end', hit: 'hit', base: 'baseNote', fine: 'fine', vol: 'vol', rev: 'reverb',
  a: 'A', d: 'D', s: 'S', r: 'R', loop: 'loop', ls: 'loopStart', le: 'loopEnd', av: 'avOffset', amp: 'amp', focus: 'focus', src: 'source', tags: 'tags' };
const REQUIRED = ['name', 'start', 'end', 'hit', 'base'];

function parse(line) {
  const parts = line.trim().split(';').map(s => s.trim()).filter(Boolean);
  if (parts[0] !== VERSION) throw new Error(`An instrument line must start with '${VERSION}' (found: '${parts[0] || ''}')`);
  const kv = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i < 1) throw new Error(`${VERSION} line: '${p}' is not in key=value form`);
    const k = p.slice(0, i).trim().toLowerCase(), v = p.slice(i + 1).trim();
    if (!(k in PARSE)) throw new Error(`${VERSION} line: unknown field '${k}' (valid: ${Object.keys(PARSE).join(', ')})`);
    if (k in kv) throw new Error(`${VERSION} line: '${k}' is written twice`);
    kv[k] = PARSE[k](k, v);
  }
  for (const k of REQUIRED) if (!(k in kv)) throw new Error(`${VERSION} line: field '${k}' is missing`);
  const I = { fine: 0, vol: 64, reverb: 0, A: { v: 0, u: 't' }, D: { v: 0, u: 't' }, S: 64, R: { v: 0, u: 't' }, loop: 'none',
    loopStart: kv.hit, loopEnd: kv.end, avOffset: 0, amp: [], focus: [], source: '', tags: [] };
  for (const k in kv) I[KEYS[k]] = kv[k];
  const e = checkInstrument(I);
  if (e) throw new Error(`${VERSION} line: ${e}`);
  return I;
}

// ───── validator: one set of rules for the UI, files and MCP. Each check returns an error text or null;
// the text says what is wrong and what the valid values are.
const isInt = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
const isTime = x => typeof x === 'number' && isFinite(x) && x >= 0;
const showHex = x => Number.isInteger(x) && x >= 0 ? hex2(x) : String(x);

function checkInstrument(I) {
  if (typeof I.name !== 'string' || I.name.length > 16 || /[\r\n]/.test(I.name)) return 'name must be at most 16 characters, on one line';
  for (const [k, label] of [['start', 'region start'], ['end', 'region end'], ['hit', 'hit point'], ['loopStart', 'loop start'], ['loopEnd', 'loop end']])
    if (!isTime(I[k])) return `${label} '${I[k]}' is invalid (seconds, 0 or more)`;
  if (!isInt(I.baseNote, 0, 95)) return `base note is invalid (C-0…B-7)`;
  if (!isInt(I.fine, -128, 127)) return `finetune '${I.fine}' is invalid (-128–127, integer)`;
  if (!isInt(I.vol, 0, 64)) return `volume '${showHex(I.vol)}' is invalid (range 00–40)`;
  if (!isInt(I.reverb, 0, 64)) return `reverb '${showHex(I.reverb)}' is invalid (range 00–40)`;
  for (const k of ['A', 'D', 'R']) {
    const e = I[k];
    if (!e || !(e.u in ENV_MAX)) return `${k} unit must be 't' or 'ms'`;
    if (!isInt(e.v, 0, ENV_MAX[e.u])) return `${k} '${e.v}${e.u}' is invalid (0–${ENV_MAX[e.u]}${e.u}, integer)`;
  }
  if (!isInt(I.S, 0, 64)) return `S '${showHex(I.S)}' is invalid (range 00–40)`;
  if (!LOOP_MODES.includes(I.loop)) return `loop '${I.loop}' is invalid (none, forward or pingpong)`;
  if (!Number.isInteger(I.avOffset)) return `A/V offset '${I.avOffset}' is invalid (milliseconds, integer)`;
  const ae = checkAmp(I.amp); if (ae) return ae;
  const fe = checkFocus(I.focus); if (fe) return fe;
  const te = checkTags(I.tags); if (te) return te;
  if (typeof I.source !== 'string' || I.source.length > MAX_SOURCE || /[\r\n]/.test(I.source)) return `source must be at most ${MAX_SOURCE} characters, on one line`;
  if (I.start >= I.end) return `region start (${t3(I.start)}) must be before region end (${t3(I.end)})`;
  if (I.hit < I.start || I.hit > I.end) return `hit point (${t3(I.hit)}) must be inside the region (${t3(I.start)}–${t3(I.end)})`;
  if (I.loop !== 'none' && (I.loopStart < I.start || I.loopEnd > I.end || I.loopStart >= I.loopEnd))
    return `loop (${t3(I.loopStart)}–${t3(I.loopEnd)}) must be inside the region, with loop start before loop end (region ${t3(I.start)}–${t3(I.end)})`;
  if (I.loop !== 'none' && I.loopStart < I.hit) return `loop start (${t3(I.loopStart)}) can't be before the hit point (${t3(I.hit)})`;
  return null;
}
function checkTags(tags) {
  if (!Array.isArray(tags)) return 'tags must be a list of words';
  if (tags.length > MAX_TAGS) return `there are ${tags.length} tags; at most ${MAX_TAGS}`;
  for (const t of tags)
    if (typeof t !== 'string' || t.length > MAX_TAG || !TAG.test(t)) return `tag '${t}' is invalid (lowercase letters and digits, words joined by dashes, at most ${MAX_TAG} characters, e.g. snare or big-room)`;
  if (new Set(tags).size !== tags.length) return 'a tag is written twice';
  return null;
}
function checkAmp(steps) {
  if (!Array.isArray(steps)) return 'amp must be a list of { a, b } steps';
  if (steps.length > MAX_AMP_STEPS) return `amp has ${steps.length} steps; at most ${MAX_AMP_STEPS}`;
  for (const [i, s] of steps.entries())
    if (!s || !isInt(s.a, 0, MAX_AMP) || !isInt(s.b, 0, MAX_AMP)) return `amp step ${i + 1}: '${s?.a}-${s?.b}' is invalid (start-end in percent, 0–${MAX_AMP} each, integers)`;
  return null;
}
function checkFocus(keys) {
  if (!Array.isArray(keys)) return 'focus must be a list of { t, x, y } keys';
  if (keys.length > MAX_FOCUS_KEYS) return `focus has ${keys.length} keys; at most ${MAX_FOCUS_KEYS}`;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], at = `focus key ${i + 1}`;
    if (!k || !isTime(k.t)) return `${at}: time '${k?.t}' is invalid (seconds, 0 or more)`;
    for (const c of ['x', 'y']) if (typeof k[c] !== 'number' || !(k[c] >= 0 && k[c] <= 1)) return `${at}: ${c} '${k[c]}' is invalid (0–1 across the frame)`;
    if (i && k.t <= keys[i - 1].t) return `${at}: time ${t3(k.t)} must be after the key before it (${t3(keys[i - 1].t)})`;
  }
  return null;
}
// a pattern cell { n: note, i: instrument, v: volume, f: effect index in FXCH, p: effect parameter }
function checkCell(c, nInst) {
  if (!(c.n === -1 || c.n === KEYOFF || isInt(c.n, 0, 95))) return 'note is invalid (C-0…B-7, === or empty)';
  if (!isInt(c.i, 0, 255)) return 'instrument number is invalid (00–FF)';
  if (c.i > nInst) return `instrument '${hex2(c.i)}' doesn't exist (${nInst ? `existing: 01–${hex2(nInst)}` : 'there are no instruments'})`;
  if (!(c.v === -1 || isInt(c.v, 0, 64))) return `volume '${showHex(c.v)}' is invalid (range 00–40)`;
  if (c.f === -1) return c.p === 0 ? null : 'a parameter needs an effect (enter the effect letter first)';
  const L = FXCH[c.f];
  if (!L || !FX_ALLOWED.includes(L)) return `there is no '${L ?? c.f}' effect (effects: ${[...FX_ALLOWED].join(' ')})`;
  if (!isInt(c.p, 0, 255)) return 'effect parameter is invalid (00–FF)';
  // a 00 parameter is always allowed: "no parameter yet" / reuse the last one
  if (L === 'E' && c.p !== 0 && !E_ALLOWED.includes(c.p >> 4)) return `there is no 'E${hex2(c.p)}': the only E commands are E9x, ECx, EDx`;
  return null;
}
function checkSong(s) {
  if ('title' in s && (typeof s.title !== 'string' || s.title.length > 64 || /[\r\n]/.test(s.title))) return 'title must be at most 64 characters, on one line';
  if ('rowsPerBeat' in s && !isInt(s.rowsPerBeat, 1, 32)) return `rowsPerBeat '${s.rowsPerBeat}' is invalid (1–32)`;
  if ('bpm' in s && !isInt(s.bpm, 32, 255)) return `BPM '${s.bpm}' is invalid (32–255)`;
  if ('speed' in s && !isInt(s.speed, 1, 31)) return `speed '${s.speed}' is invalid (1–31)`;
  return null;
}
function checkOrder(order, nPat) {
  if (!Array.isArray(order) || !order.length) return "order can't be empty";
  if (order.length > 256) return 'order can have at most 256 positions';
  for (let k = 0; k < order.length; k++)
    if (!isInt(order[k], 0, nPat - 1)) return `order position ${hex2(k)}: there is no pattern '${showHex(order[k])}' (existing: 00–${hex2(nPat - 1)})`;
  return null;
}
function checkChannel(c) {
  if (typeof c.name !== 'string' || c.name.length > 16 || /[\r\n]/.test(c.name)) return 'channel name must be at most 16 characters, on one line';
  if (!isInt(c.pan, 0, 255)) return `pan '${showHex(c.pan)}' is invalid (00 left – 80 center – FF right)`;
  return null;
}
const checkRows = n => isInt(n, 1, 256) ? null : `pattern length '${n}' is invalid (1–256 rows)`;

// ───── song text (song.txt + patterns/NN.txt): the formatter always writes the standard form,
// the reader is tolerant of spacing / case but never guesses a meaning; every error says file:line.
const SONG_MAGIC = 'POOPTRACKER SONG 1';
// one field of a pattern cell as text (note 'C-4' / '===' / '...', instrument '01' / '..', volume '30' / '..',
// effect 'A20' / '...') → value; throws a message with the valid values. Used by the file reader and MCP.
function cellField(kind, text) {
  const t = String(text).trim(), u = t.toUpperCase();
  if (kind === 'note') {
    if (u === '...') return -1; if (u === '===') return KEYOFF;
    const n = noteNum(u); if (n < 0) throw new Error(`note '${t}' is invalid (C-0…B-7, === or ...)`); return n;
  }
  if (kind === 'inst') {
    if (u === '..') return 0;
    if (!/^[0-9A-F]{2}$/.test(u) || u === '00') throw new Error(`instrument '${t}' is invalid (01–FF or ..)`); return parseInt(u, 16);
  }
  if (kind === 'vol') {
    if (u === '..') return -1;
    if (!/^[0-9A-F]{2}$/.test(u)) throw new Error(`volume '${t}' is invalid (00–40 or ..)`); return parseInt(u, 16);
  }
  if (u === '...') return { f: -1, p: 0 };
  const m = /^([0-9A-Z])([0-9A-F]{2})$/.exec(u);
  if (!m) throw new Error(`effect '${t}' is invalid (e.g. A20 or ...)`);
  return { f: FXCH.indexOf(m[1]), p: parseInt(m[2], 16) };
}
const cellStr = c => `${c.n === -1 ? '...' : c.n === KEYOFF ? '===' : noteStr(c.n)} ${c.i ? hex2(c.i) : '..'} ${c.v >= 0 ? hex2(c.v) : '..'} ${c.f >= 0 ? FXCH[c.f] + hex2(c.p) : '...'}`;
// S = { title, bpm, speed, rowsPerBeat, channels: [{ name, pan }], order, patterns: [{ rows }] }
// insts = [{ I, video }] in instrument order (01, 02, …), video = path inside the zip
function formatSong(S, insts) {
  const L = [SONG_MAGIC, `title=${S.title}`, `bpm=${S.bpm}`, `speed=${S.speed}`, `rowsPerBeat=${S.rowsPerBeat}`,
    `channels=${S.channels.length}`, `order=${S.order.map(hex2).join(' ')}`, '', '=== CHANNELS ===',
    ...S.channels.map((c, k) => `${k + 1};name=${esc(c.name)};pan=${hex2(c.pan)}`)];
  insts.forEach(({ I, video }, k) => L.push('', `=== INSTRUMENT ${hex2(k + 1)} ===`, format(I, video)));
  const files = { 'song.txt': L.join('\n') + '\n' };
  S.patterns.forEach((P, k) => { files[`patterns/${hex2(k)}.txt`] = P.rows.map((r, ri) => `${hex2(ri)} | ${r.map(cellStr).join(' | ')}`).join('\n') + '\n'; });
  return files;
}

// zip: Map name → bytes. The song decides its channel count (1–MAX_CHANNELS).
// Returns { song, instruments: [{ ...settings, video, where }], errors: ['file:line  message', …] }
function parseSong(zip) {
  const errors = [], err = (file, line, msg) => errors.push(`${file}${line ? ':' + line : ''}  ${msg}`);
  const text = name => zip.has(name) ? new TextDecoder().decode(zip.get(name)).replace(/^﻿/, '') : null;
  const src = text('song.txt');
  if (src == null) { err('song.txt', 0, "file is missing (it must be at the root of the zip)"); return { errors }; }
  const lines = src.split(/\r?\n/), first = lines[0].trim();
  if (first !== SONG_MAGIC) {
    err('song.txt', 1, /^POOPTRACKER SONG \d+$/.test(first) ? `format version '${first.slice(16)}' is not supported (this tracker: 1)` : `the first line must be '${SONG_MAGIC}'`);
    return { errors };
  }
  const head = {}, hl = {}, channels = [], chSeen = {}, insts = [];
  let sec = null;
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i].trim(), ln = i + 1;
    if (!L) continue;
    const m = /^===\s*(.*?)\s*===$/.exec(L);
    if (m) {
      const name = m[1].toUpperCase(), mi = /^INSTRUMENT\s+([0-9A-F]{2})$/.exec(name);
      if (sec && sec.inst && !sec.done) { err('song.txt', sec.ln, `INSTRUMENT ${sec.num} section has no TURD1 line`); insts.push(null); }
      if (name === 'CHANNELS') sec = { ch: true };
      else if (mi) {
        const want = hex2(insts.length + 1);
        if (mi[1] !== want) err('song.txt', ln, `expected INSTRUMENT ${want}, found ${mi[1]} (instruments must start at 01 and have no gaps)`);
        sec = { inst: true, num: mi[1], ln };
      } else { err('song.txt', ln, `unknown section '${m[1]}' (valid: CHANNELS, INSTRUMENT NN)`); sec = { skip: true }; }
      continue;
    }
    if (!sec) {
      const k = L.indexOf('=');
      if (k < 1) { err('song.txt', ln, `'${L}' is not in key=value form`); continue; }
      const key = L.slice(0, k).trim(), val = L.slice(k + 1).trim();
      if (!['title', 'bpm', 'speed', 'rowsPerBeat', 'channels', 'order'].includes(key)) { err('song.txt', ln, `unknown field '${key}' (valid: title, bpm, speed, rowsPerBeat, channels, order)`); continue; }
      if (key in head) { err('song.txt', ln, `'${key}' is written twice`); continue; }
      head[key] = val; hl[key] = ln;
    } else if (sec.ch) {
      const cm = /^(\d+)\s*;(.*)$/.exec(L);
      if (!cm) { err('song.txt', ln, `a channel line must look like 'N;name=…;pan=…'`); continue; }
      const n = +cm[1], c = { name: '', pan: 0x80 };
      for (const part of cm[2].split(';').map(x => x.trim()).filter(Boolean)) {
        const q = part.indexOf('='), key = part.slice(0, q).trim(), val = part.slice(q + 1).trim();
        if (q < 1 || !['name', 'pan'].includes(key)) { err('song.txt', ln, `channel ${n}: '${part}' is invalid (fields: name, pan)`); continue; }
        if (key === 'name') c.name = unesc(val);
        else if (/^[0-9A-F]{2}$/i.test(val)) c.pan = parseInt(val, 16);
        else err('song.txt', ln, `channel ${n}: pan '${val}' is invalid (00 left – 80 center – FF right)`);
      }
      const e = checkChannel(c);
      if (e) err('song.txt', ln, `channel ${n}: ${e}`);
      else if (chSeen[n]) err('song.txt', ln, `channel ${n} is written twice`);
      else { chSeen[n] = ln; channels[n - 1] = c; }
    } else if (sec.inst) {
      if (sec.done) { err('song.txt', ln, `INSTRUMENT ${sec.num} section must have exactly one line`); continue; }
      sec.done = true;
      try {
        const I = parse(L);
        if (!I.video) err('song.txt', ln, `instrument ${sec.num}: field 'video' is missing`);
        else if (!zip.has(I.video)) err('song.txt', ln, `instrument ${sec.num}: video '${I.video}' is not in the zip`);
        insts.push({ ...I, where: `song.txt:${ln}` });
      } catch (e) { err('song.txt', ln, e.message); insts.push(null); }
    }
  }
  if (sec && sec.inst && !sec.done) { err('song.txt', sec.ln, `INSTRUMENT ${sec.num} section has no TURD1 line`); insts.push(null); }

  // header values
  const S = { title: head.title ?? '' };
  for (const k of ['bpm', 'speed', 'rowsPerBeat', 'channels', 'order']) if (!(k in head)) err('song.txt', 0, `line '${k}=' is missing`);
  for (const k of ['bpm', 'speed', 'rowsPerBeat', 'channels']) if (k in head) {
    if (!/^\d+$/.test(head[k])) { err('song.txt', hl[k], `${k} '${head[k]}' is not a number`); continue; }
    S[k] = +head[k];
  }
  for (const k of ['title', 'bpm', 'speed', 'rowsPerBeat']) if (k in S) { const e = checkSong({ [k]: S[k] }); if (e) err('song.txt', hl[k] || 0, e); }
  let nCh = S.channels;
  if (nCh != null && !isInt(nCh, 1, MAX_CHANNELS)) { err('song.txt', hl.channels, `channels=${nCh} is invalid (1–${MAX_CHANNELS})`); nCh = null; }
  if (nCh != null) for (const n in chSeen) if (n > nCh) err('song.txt', chSeen[n], `there is no channel ${n} (channels=${nCh}: 1–${nCh})`);
  S.channels = Array.from({ length: nCh || 0 }, (_, k) => channels[k] || { name: '', pan: 0x80 });

  // patterns: patterns/00.txt, 01, … without gaps
  const nums = [...zip.keys()].map(n => /^patterns\/([0-9A-F]{2})\.txt$/i.exec(n)).filter(Boolean).map(m => parseInt(m[1], 16)).sort((a, b) => a - b);
  S.patterns = [];
  if (!nums.length) err('patterns/', 0, 'there are no patterns (patterns/00.txt must exist)');
  nums.forEach((n, k) => { if (n !== k && !nums.includes(k)) err(`patterns/${hex2(k)}.txt`, 0, `file is missing (patterns must start at 00 and have no gaps; ${hex2(n)} exists)`); });
  const nInst = insts.length;
  for (const n of nums) {
    const name = [...zip.keys()].find(k => k.toLowerCase() === `patterns/${hex2(n)}.txt`.toLowerCase());
    const rowsTxt = text(name).split(/\r?\n/);
    while (rowsTxt.length && !rowsTxt[rowsTxt.length - 1].trim()) rowsTxt.pop();
    const rows = [];
    rowsTxt.forEach((L, ri) => {
      const ln = ri + 1, m = /^\s*([0-9A-F]{2})\s*\|(.*)$/i.exec(L);
      if (!m) { err(name, ln, `a row must look like 'NN | cell | cell …'`); return; }
      if (parseInt(m[1], 16) !== ri) err(name, ln, `row number must be ${hex2(ri)} (found ${m[1].toUpperCase()})`);
      const cells = m[2].split('|');
      if (nCh != null && cells.length !== nCh) { err(name, ln, `must have ${nCh} channels (channels=${nCh}), found ${cells.length}`); return; }
      rows.push(cells.map((cs, ch) => {
        const t = cs.trim().split(/\s+/), c = { n: -1, i: 0, v: -1, f: -1, p: 0 }, e = msg => { err(name, ln, `channel ${ch + 1}: ${msg}`); return c; };
        if (t.length !== 4) return e(`a cell must have 4 fields (note instrument volume effect), found '${cs.trim()}'`);
        try { c.n = cellField('note', t[0]); c.i = cellField('inst', t[1]); c.v = cellField('vol', t[2]); Object.assign(c, cellField('fx', t[3])); }
        catch (x) { return e(x.message); }
        const ce = checkCell(c, nInst);
        return ce ? e(ce) : c;
      }));
    });
    const re = checkRows(rows.length);
    if (re) err(name, 0, re);
    S.patterns[n] = { rows };
  }
  if ('order' in head) {
    const toks = head.order.split(/\s+/).filter(Boolean);
    if (toks.some(t => !/^[0-9A-F]{2}$/i.test(t))) err('song.txt', hl.order, `order '${head.order}' is invalid (hex pattern numbers, e.g. 00 01 00 02)`);
    else { S.order = toks.map(t => parseInt(t, 16)); const e = checkOrder(S.order, nums.length ? nums[nums.length - 1] + 1 : 0); if (e) err('song.txt', hl.order, e); }
  }
  return { song: S, instruments: insts, errors };
}

// ───── zip (store; reading also accepts deflate, so a re-zipped file still opens)
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC_T[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// entries: [{ name, data: Uint8Array, crc? }] → array of Uint8Array parts (new Blob(parts) in the browser)
function zipStore(entries, date = new Date()) {
  const enc = new TextEncoder(), parts = [], cd = [];
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), crc = e.crc ?? crc32(e.data), n = e.data.length;
    const h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
    [[0, 0x04034b50, 4], [4, 20], [6, 0x0800], [10, time], [12, day], [14, crc, 4], [18, n, 4], [22, n, 4], [26, name.length]]
      .forEach(([o, v, w]) => w === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    [[0, 0x02014b50, 4], [4, 20], [6, 20], [8, 0x0800], [12, time], [14, day], [16, crc, 4], [20, n, 4], [24, n, 4], [28, name.length], [42, off, 4]]
      .forEach(([o, v, w]) => w === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    parts.push(new Uint8Array(h.buffer), name, e.data); cd.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + n;
    if (off > 0xFFFFFFFF) throw new Error('the song file is larger than 4 GB');
  }
  const cdSize = cd.reduce((a, p) => a + p.length, 0), z = new DataView(new ArrayBuffer(22));
  z.setUint32(0, 0x06054b50, true); z.setUint16(8, entries.length, true); z.setUint16(10, entries.length, true);
  z.setUint32(12, cdSize, true); z.setUint32(16, off, true);
  return [...parts, ...cd, new Uint8Array(z.buffer)];
}
async function unzip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder(), out = new Map();
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip file, or it is damaged');
  let p = dv.getUint32(e + 16, true);
  for (let k = 0, count = dv.getUint16(e + 10, true); k < count; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip directory is damaged');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), lo = dv.getUint32(p + 42, true);
    const nl = dv.getUint16(p + 28, true), name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name}: encrypted zip is not supported`);
    if (csize === 0xFFFFFFFF || lo === 0xFFFFFFFF) throw new Error(`${name}: zip64 is not supported`);
    if (lo + 30 > b.length || dv.getUint32(lo, true) !== 0x04034b50) throw new Error(`${name}: zip entry is damaged`);
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = b.subarray(start, start + csize);
    if (raw.length !== csize) throw new Error(`${name}: file is incomplete (the zip is cut off)`);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`${name}: zip compression method ${method} is not supported`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${name}: content is damaged (CRC mismatch)`);
    out.set(name, data);
  }
  // a zip program may have put everything into one folder (mysong/song.txt)
  if (!out.has('song.txt')) {
    const roots = [...out.keys()].filter(n => /^[^/]+\/song\.txt$/.test(n));
    if (roots.length === 1) { const pre = roots[0].slice(0, -8); return new Map([...out].filter(([n]) => n.startsWith(pre)).map(([n, d]) => [n.slice(pre.length), d])); }
  }
  return out;
}

// ───── the instrument inside its own video file: an MP4/MOV metadata key, like iPhone's location tag.
// QuickTime 'mdta' metadata (ffmpeg: -movflags use_metadata_tags): meta → hdlr 'mdta' + keys + ilst, UTF-8 value.
// Written without touching the video or audio: only the moov box changes (chunk offsets fixed when it grows).
const MP4_KEY = 'pooptracker';
const notMp4 = () => { throw new Error('the file is not MP4/MOV (metadata can only be written to MP4/MOV videos)'); };
const boxes = (b, start, end) => scan(b, start, end, notMp4);
const enc = new TextEncoder(), dec = new TextDecoder();
// the mdta meta box inside moov or moov/udta → { box, entries: [[key, value bytes, data type]] } or null
function findMeta(b, moov) {
  for (const parent of [moov, ...boxes(b, moov.body, moov.end).filter(x => x.type === 'udta')])
    for (const m of boxes(b, parent.body, parent.end).filter(x => x.type === 'meta')) {
      const full = fourcc(b, m.body + 4) !== 'hdlr'; // ISO style has version/flags first, Apple's has not
      const kids = boxes(b, m.body + (full ? 4 : 0), m.end), hdlr = kids.find(x => x.type === 'hdlr');
      if (!hdlr || fourcc(b, hdlr.body + 8) !== 'mdta') continue;
      const keysBox = kids.find(x => x.type === 'keys'), ilst = kids.find(x => x.type === 'ilst'), keys = [];
      if (keysBox) for (let o = keysBox.body + 8, k = 0, n = u32(b, keysBox.body + 4); k < n; k++) { const sz = u32(b, o); keys.push(dec.decode(b.subarray(o + 8, o + sz))); o += sz; }
      const entries = [];
      if (ilst) for (const it of boxes(b, ilst.body, ilst.end)) {
        const data = boxes(b, it.body, it.end).find(x => x.type === 'data'), key = keys[u32(b, it.start + 4) - 1];
        if (data && key != null) entries.push([key, b.slice(data.body + 8, data.end), u32(b, data.body)]);
      }
      return { box: m, parent, full, kids, entries };
    }
  return null;
}
function moovOf(b) {
  const top = boxes(b, 0, b.length);
  if (!top.length || !['ftyp', 'wide', 'free', 'mdat', 'moov', 'skip', 'pnot'].includes(top[0].type)) notMp4();
  const moov = top.find(x => x.type === 'moov');
  if (!moov) notMp4();
  return { top, moov };
}
// the 'pooptracker' value (text) or null
function mp4ReadTag(b) {
  const { moov } = moovOf(b), M = findMeta(b, moov), e = M && M.entries.find(x => x[0] === MP4_KEY);
  return e ? dec.decode(e[1]) : null;
}
// a new file with key = value (other keys kept); value null removes the key
function mp4WriteTag(b, value) {
  const { top, moov } = moovOf(b), M = findMeta(b, moov);
  const entries = (M ? M.entries : []).filter(x => x[0] !== MP4_KEY);
  if (value != null) entries.push([MP4_KEY, enc.encode(value), 1]);
  const keys = box('keys', be32(0), be32(entries.length), ...entries.map(([k]) => box('mdta', enc.encode(k))));
  const ilst = box('ilst', ...entries.map(([, v, t], i) => box(be32(i + 1), box('data', be32(t), be32(0), v))));
  const hdlr = M ? b.slice(M.kids.find(x => x.type === 'hdlr').start, M.kids.find(x => x.type === 'hdlr').end)
    : box('hdlr', be32(0), be32(0), enc.encode('mdta'), new Uint8Array(13));
  const rest = M ? M.kids.filter(x => !['hdlr', 'keys', 'ilst'].includes(x.type)).map(x => b.slice(x.start, x.end)) : [];
  const meta = box('meta', ...(M && !M.full ? [] : [be32(0)]), hdlr, keys, ilst, ...rest);
  const kidsOf = x => boxes(b, x.body, x.end).map(k => b.slice(k.start, k.end));
  // rebuild moov (and udta) around the new meta box
  let moovKids;
  if (M && M.parent === moov) moovKids = boxes(b, moov.body, moov.end).map(k => k.start === M.box.start ? meta : b.slice(k.start, k.end));
  else {
    const udta = M ? M.parent : boxes(b, moov.body, moov.end).find(x => x.type === 'udta');
    const newUdta = udta ? box('udta', ...boxes(b, udta.body, udta.end).map(k => M && k.start === M.box.start ? meta : b.slice(k.start, k.end)), ...(M ? [] : [meta])) : box('udta', meta);
    moovKids = udta ? boxes(b, moov.body, moov.end).map(k => k.start === udta.start ? newUdta : b.slice(k.start, k.end)) : [...kidsOf(moov), newUdta];
  }
  const newMoov = box('moov', ...moovKids), delta = newMoov.length - moov.size;
  // media data after moov moves by delta: fix every chunk offset that points past the old moov
  if (delta) {
    if (top.some(x => x.type === 'moof')) throw new Error('can\'t write metadata to a fragmented MP4');
    const fix = (s, e) => { for (const x of boxes(newMoov, s, e)) {
      if (['trak', 'mdia', 'minf', 'stbl'].includes(x.type)) fix(x.body, x.end);
      else if (x.type === 'stco') for (let k = 0, n = u32(newMoov, x.body + 4); k < n; k++) {
        const o = x.body + 8 + 4 * k, v = u32(newMoov, o);
        if (v >= moov.end) { if (v + delta > 0xFFFFFFFF) throw new Error('the video exceeds the 4 GB limit'); new DataView(newMoov.buffer).setUint32(o, v + delta); }
      } else if (x.type === 'co64') for (let k = 0, n = u32(newMoov, x.body + 4); k < n; k++) {
        const o = x.body + 8 + 8 * k, dv = new DataView(newMoov.buffer), v = dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);
        if (v >= moov.end) { const w = v + delta; dv.setUint32(o, Math.floor(w / 4294967296)); dv.setUint32(o + 4, w >>> 0); }
      } } };
    fix(8, newMoov.length);
  }
  const out = new Uint8Array(b.length + delta);
  out.set(b.subarray(0, moov.start)); out.set(newMoov, moov.start); out.set(b.subarray(moov.end), moov.start + newMoov.length);
  return out;
}

export const PTFormat = { VERSION, LOOP_MODES, format, tagsFrom, checkTags, focusStr, ampStr, MAX_AMP, MAX_AMP_STEPS, parse, noteStr, noteNum, ENV_MAX, KEYOFF, MAX_CHANNELS, FXCH, FX_ALLOWED, E_ALLOWED,
  checkInstrument, checkFocus, checkCell, checkSong, checkOrder, checkRows, checkChannel, formatSong, parseSong, zipStore, unzip, crc32,
  cellField, cellStr, mp4ReadTag, mp4WriteTag, field: (k, v) => PARSE[k](k, String(v).trim()) };
export default PTFormat;
