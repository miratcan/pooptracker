// The command layer: the ONLY place that writes the song. Every change is a command. A command factory
// validates first and throws CmdError if the change is invalid (nothing is applied); otherwise it returns
// { label, scope, apply, revert } (or null when nothing would change). Keyboard, mouse and MCP all use
// the same factories, so they share validation and undo.
//
// After a command is applied, undone or redone, every onChange listener hears { cmd, scope, how }:
//   scope: 'cells' | 'song' | 'order' | 'patterns' | 'instrument' | 'instruments' | 'channels' | 'all'
//   how:   undefined (applied) | 'undo' | 'redo' | 'open' (a whole song was loaded; not undoable)
// The engine and the screens react to these; nothing else needs to tell them what changed.
import PTFormat from '../ptformat.js';
import { MAX_CH, hex2, copy, same } from '../util.js';
import { song, instruments, videos, nch, emptyCell, isEmptyCell, newPattern } from './song.js';
import { sliceRegion } from './instrument.js';

export class CmdError extends Error {}
export const fail = msg => { throw new CmdError(msg); };

const listeners = [];
export const onChange = fn => listeners.push(fn);
const emit = (cmd, how) => listeners.forEach(fn => fn({ cmd, scope: cmd.scope, how }));

// some structural changes are refused while something outside the song is going on (e.g. recording);
// guard(action) returns an error message or null. action: 'channels' | 'newSong'
let guard = () => null;
export const setGuard = fn => { guard = fn; };
const guarded = action => { const msg = guard(action); if (msg) fail(msg); };

export const hist = { undo: [], redo: [] };
// applies a command and records it for undo; throws CmdError if invalid. Returns the command (null = no change).
export function exec(factory) {
  const cmd = factory();
  if (!cmd) return null;
  cmd.apply(); hist.undo.push(cmd); hist.redo.length = 0;
  if (hist.undo.length > 1000) hist.undo.shift();
  emit(cmd);
  return cmd;
}
// returns the command undone / redone, or null if there was nothing to do
export function undo() { const c = hist.undo.pop(); if (!c) return null; c.revert(); hist.redo.push(c); emit(c, 'undo'); return c; }
export function redo() { const c = hist.redo.pop(); if (!c) return null; c.apply(); hist.undo.push(c); emit(c, 'redo'); return c; }

const where = (P, row, ch) => `pattern ${hex2(song.patterns.indexOf(P))} row ${hex2(row)} channel ${ch + 1}`;
// changes: [{ pat, row, ch, n?, i?, v?, f?, p? }] — fields left out keep their value
export function setCells(changes, label = 'cell') {
  const nInst = instruments.length - 1, list = [];
  for (const c of changes) {
    const P = song.patterns[c.pat];
    if (!P) fail(`pattern ${hex2(c.pat)} doesn't exist (there are 00–${hex2(song.patterns.length - 1)})`);
    if (!(c.row >= 0 && c.row < P.rows.length)) fail(`pattern ${hex2(c.pat)}: row ${c.row} doesn't exist (00–${hex2(P.rows.length - 1)})`);
    if (!(c.ch >= 0 && c.ch < nch())) fail(`channel ${c.ch + 1} doesn't exist (1–${nch()})`);
    const old = P.rows[c.row][c.ch], nu = { ...old };
    for (const k of ['n', 'i', 'v', 'f', 'p']) if (k in c) nu[k] = c[k];
    const err = PTFormat.checkCell(nu, nInst);
    if (err) fail(`${where(P, c.row, c.ch)}: ${err}`);
    if (!same(old, nu)) list.push({ P, row: c.row, ch: c.ch, old: { ...old }, nu });
  }
  if (!list.length) return null;
  return { label, scope: 'cells', n: list.length, P: list[0].P, at: { row: list[0].row, ch: list[0].ch },
    apply: () => list.forEach(x => x.P.rows[x.row][x.ch] = { ...x.nu }),
    revert: () => list.slice().reverse().forEach(x => x.P.rows[x.row][x.ch] = { ...x.old }) };
}
export function setSong(fields, label) {
  const err = PTFormat.checkSong(fields); if (err) fail(err);
  const old = {}; for (const k in fields) old[k] = song[k];
  if (same(old, fields)) return null;
  return { label, scope: 'song', fields: Object.keys(fields), apply: () => Object.assign(song, fields), revert: () => Object.assign(song, old) };
}
export function setOrder(order, label = 'order') {
  const err = PTFormat.checkOrder(order, song.patterns.length); if (err) fail(err);
  const old = song.order.slice(), nu = order.slice();
  if (same(old, nu)) return null;
  return { label, scope: 'order', apply: () => { song.order = nu.slice(); }, revert: () => { song.order = old.slice(); } };
}
export function addPattern(P, label) {
  if (song.patterns.length >= 256) fail('a song can have at most 256 patterns');
  return { label, scope: 'patterns', P, apply: () => song.patterns.push(P), revert: () => song.patterns.splice(song.patterns.indexOf(P), 1) };
}
export function deletePattern(idx) {
  const P = song.patterns[idx]; if (!P) fail(`pattern ${hex2(idx)} doesn't exist`);
  if (song.patterns.length === 1) fail("the last pattern can't be deleted");
  const used = song.order.map((o, k) => o === idx ? hex2(k) : null).filter(Boolean);
  if (used.length) fail(`pattern ${hex2(idx)} is used in the order (position ${used.join(', ')}); remove it from the order first`);
  // patterns after it move down one number; the order follows them
  const old = song.order.slice(), nu = old.map(o => o > idx ? o - 1 : o);
  return { label: `delete pattern ${hex2(idx)}`, scope: 'patterns',
    apply: () => { song.patterns.splice(idx, 1); song.order = nu.slice(); },
    revert: () => { song.patterns.splice(idx, 0, P); song.order = old.slice(); } };
}
export function setPatternLength(idx, len) {
  const P = song.patterns[idx]; if (!P) fail(`pattern ${hex2(idx)} doesn't exist`);
  const err = PTFormat.checkRows(len); if (err) fail(err);
  if (len === P.rows.length) return null;
  const old = P.rows, nu = old.slice(0, len);
  while (nu.length < len) nu.push(Array.from({ length: nch() }, emptyCell));
  return { label: `pattern ${hex2(idx)} length ${len}`, scope: 'patterns', P, apply: () => { P.rows = nu; }, revert: () => { P.rows = old; } };
}

export const INST_KEYS = ['name', 'start', 'end', 'hit', 'baseNote', 'vol', 'A', 'D', 'S', 'R', 'loop', 'loopStart', 'loopEnd', 'avOffset'];
export const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, copy(o[k])]));
// another video for an instrument, every setting kept; times that fall past a shorter video are pulled in
export function setInstrumentVideo(idx, V) {
  const I = instruments[idx]; if (!I) fail(`instrument ${hex2(idx)} doesn't exist`);
  const oldVideo = I.video, old = pick(I, INST_KEYS), nu = pick(I, INST_KEYS), d = V.dur, notes = [];
  if (nu.end > d) { nu.end = d; notes.push(`region end pulled in to ${d.toFixed(3)} s`); }
  if (nu.start >= nu.end) { nu.start = 0; notes.push('region start set to 0'); }
  if (nu.hit < nu.start || nu.hit > nu.end) { nu.hit = nu.start; notes.push('hit point moved to the region start'); }
  const ls = nu.loopStart, le = nu.loopEnd;
  if (nu.loopEnd > nu.end) nu.loopEnd = nu.end;
  if (nu.loopStart < nu.hit || nu.loopStart >= nu.loopEnd) nu.loopStart = Math.min(nu.hit, nu.loopEnd);
  if (nu.loop !== 'none' && (ls !== nu.loopStart || le !== nu.loopEnd)) notes.push('loop points pulled into the region');
  if (nu.loop !== 'none' && nu.loopStart >= nu.loopEnd) { nu.loop = 'none'; notes.push('loop turned off'); }
  const err = PTFormat.checkInstrument(nu); if (err) fail(`instrument ${hex2(idx)}: ${err}`);
  const set = (vals, video) => { Object.assign(I, copy(vals)); I.video = video; sliceRegion(I); };
  return { label: `${hex2(idx)} replace video`, scope: 'instrument', inst: I, notes, apply: () => set(nu, V), revert: () => set(old, oldVideo) };
}
// before: values to restore on undo, for edits that were previewed live (slider / waveform drag)
export function setInstrument(idx, fields, label = 'instrument', before) {
  const I = instruments[idx]; if (!I) fail(`instrument ${hex2(idx)} doesn't exist`);
  const keys = Object.keys(fields), old = before || pick(I, keys), nu = { ...pick(I, INST_KEYS), ...copy(fields) };
  const err = PTFormat.checkInstrument(nu) || (nu.end > I.video.dur ? `region end (${nu.end.toFixed(3)}) is past the end of the video (${I.video.dur.toFixed(3)})` : null);
  if (err) fail(`instrument ${hex2(idx)}: ${err}`);
  if (same(old, pick(nu, keys))) return null;
  const set = vals => { Object.assign(I, copy(vals)); if ('start' in vals || 'end' in vals) sliceRegion(I); };
  return { label: `${hex2(idx)} ${label}`, scope: 'instrument', inst: I, apply: () => set(fields), revert: () => set(old) };
}
export function addInstrument(I, label) {
  if (instruments.length > 255) fail('a song can have at most 255 instruments');
  return { label, scope: 'instruments', inst: I, apply: () => instruments.push(I), revert: () => instruments.splice(instruments.indexOf(I), 1) };
}
// renumber instruments in every pattern cell (new cell objects: the history keeps its own copies)
function remapInst(map) { for (const P of song.patterns) for (const r of P.rows) for (let ch = 0; ch < r.length; ch++) if (r[ch].i > 0) { const j = map(r[ch].i); if (j !== r[ch].i) r[ch] = { ...r[ch], i: j }; } }
export function deleteInstrument(idx) {
  const I = instruments[idx]; if (!I) fail(`instrument ${hex2(idx)} doesn't exist`);
  const used = [];
  song.patterns.forEach((P, pi) => P.rows.forEach((r, ri) => r.forEach((c, ch) => { if (c.i === idx) used.push(`pattern ${hex2(pi)} row ${hex2(ri)} channel ${ch + 1}`); })));
  if (used.length) fail(`instrument ${hex2(idx)} is in use: ${used.slice(0, 3).join(', ')}${used.length > 3 ? ` and ${used.length - 3} more` : ''}`);
  return { label: `delete instrument ${hex2(idx)}`, scope: 'instruments', inst: I,
    apply: () => { instruments.splice(idx, 1); remapInst(i => i > idx ? i - 1 : i); },
    revert: () => { instruments.splice(idx, 0, I); remapInst(i => i >= idx ? i + 1 : i); } };
}
export function moveInstrument(idx, d) {
  const j = idx + d, I = instruments[idx];
  if (!I) fail(`instrument ${hex2(idx)} doesn't exist`);
  if (j < 1 || j >= instruments.length) return null;
  const swap = () => { [instruments[idx], instruments[j]] = [instruments[j], instruments[idx]]; remapInst(i => i === idx ? j : i === j ? idx : i); };
  return { label: `instrument ${hex2(idx)} → ${hex2(j)}`, scope: 'instruments', inst: I, apply: swap, revert: swap };
}
// channels: added at the end, deleted at the cursor; a channel with notes in it is never deleted
export function addChannel() {
  if (nch() >= MAX_CH) fail(`a song can have at most ${MAX_CH} channels`);
  guarded('channels');
  const ch = { name: '', pan: 0x80 };
  return { label: `add channel ${nch() + 1}`, scope: 'channels',
    apply: () => { song.channels.push(ch); song.patterns.forEach(P => P.rows.forEach(r => r.push(emptyCell()))); },
    revert: () => { song.channels.pop(); song.patterns.forEach(P => P.rows.forEach(r => r.pop())); } };
}
export function deleteChannel(ch) {
  if (nch() <= 1) fail('a song needs at least 1 channel');
  guarded('channels');
  const used = [];
  song.patterns.forEach((P, pi) => P.rows.forEach((r, ri) => { if (!isEmptyCell(r[ch])) used.push(`pattern ${hex2(pi)} row ${hex2(ri)}`); }));
  if (used.length) fail(`channel ${ch + 1} isn't empty: ${used.slice(0, 3).join(', ')}${used.length > 3 ? ` and ${used.length - 3} more` : ''}. Delete these notes first.`);
  const C = song.channels[ch];
  return { label: `delete channel ${ch + 1}`, scope: 'channels',
    apply: () => { song.channels.splice(ch, 1); song.patterns.forEach(P => P.rows.forEach(r => r.splice(ch, 1))); },
    revert: () => { song.channels.splice(ch, 0, C); song.patterns.forEach(P => P.rows.forEach(r => r.splice(ch, 0, emptyCell()))); } };
}
// a fresh, empty song: 4 channels, one empty 64-row pattern, no instruments. One command → Ctrl+Z brings it all back
export function newSong() {
  guarded('newSong');
  const keep = { title: song.title, bpm: song.bpm, speed: song.speed, rowsPerBeat: song.rowsPerBeat, channels: song.channels, patterns: song.patterns, order: song.order };
  const oldInst = instruments.slice(), oldVideos = videos.slice();
  const set = (S, insts, vids) => { Object.assign(song, S); instruments.length = 0; instruments.push(...insts); videos.length = 0; videos.push(...vids); };
  const fresh = { title: '', bpm: 125, speed: 6, rowsPerBeat: 4, channels: Array.from({ length: 4 }, () => ({ name: '', pan: 0x80 })), order: [0] };
  return { label: 'new song', scope: 'all', resetEditor: true,
    apply: () => { set({ ...fresh, patterns: [] }, [null], []); song.patterns = [newPattern(64)]; },
    revert: () => set(keep, oldInst, oldVideos) };
}

// Not commands (no undo): a loaded video joins the list of videos; a whole song replaces the current one.
export const addVideo = V => { videos.push(V); };
// S = parsed song fields, insts = ready instruments (in order), vids = their videos. Clears the history.
export function replaceSong(S, insts, vids) {
  Object.assign(song, S);
  instruments.length = 1; instruments.push(...insts);
  videos.length = 0; videos.push(...vids);
  hist.undo.length = hist.redo.length = 0; // opening a song is not an edit
  emit({ label: 'open song', scope: 'all' }, 'open');
}
