// MCP [ZEN-AI-PARITY]: mcp/server.mjs talks to this tab over a local WebSocket. Every write tool is ONE command
// of the command layer: same validation as the keyboard, and one Ctrl+Z undoes it. Numbers are the tracker's:
// pattern / row / instrument / volume as 2-digit hex strings ("0C"), channels 1–(song's channel count), notes like C-4.
import PTFormat from './ptformat.js';
import { FX, KEYOFF, hex2, noteName, same } from './util.js';
import { song, instruments, nch, emptyCell, newPattern, clonePattern } from './core/song.js';
import { CmdError, fail, exec, setCells, addPattern, setOrder, setSong, setInstrument } from './core/commands.js';
import { processRow, newChan } from './engine/player.js';
import { $, setStatus, escHtml } from './ui/common.js';

const hexArg = (v, what) => typeof v === 'string' && /^[0-9A-Fa-f]{2}$/.test(v) ? parseInt(v, 16) : fail(`${what} must be 2-digit hex (e.g. "0C"), got: ${JSON.stringify(v)}`);
const patArg = v => { const p = hexArg(v, 'pattern'); return song.patterns[p] ? p : fail(`pattern ${hex2(p)} doesn't exist (there are 00–${hex2(song.patterns.length - 1)})`); };
const rowArg = (v, pi, what = 'row') => { const r = hexArg(v, what), N = song.patterns[pi].rows.length; return r < N ? r : fail(`${what} ${hex2(r)} doesn't exist (pattern ${hex2(pi)}: 00–${hex2(N - 1)})`); };
const chArg = v => Number.isInteger(v) && v >= 1 && v <= nch() ? v - 1 : fail(`channel must be an integer 1–${nch()} (the song has ${nch()} channels), got: ${JSON.stringify(v)}`);
const instArg = v => { const i = hexArg(v, 'instrument'); return instruments[i] && i > 0 ? i : fail(`instrument ${hex2(i)} doesn't exist (there are 01–${hex2(instruments.length - 1)})`); };
const fieldArg = (kind, v) => { try { return PTFormat.cellField(kind, v); } catch (e) { fail(e.message); } };
const chList = v => v == null ? [...Array(nch()).keys()] : Array.isArray(v) && v.length ? v.map(chArg) : fail('channels must be a list of channels, e.g. [1, 3]');
function rowRange(a, pi) { const N = song.patterns[pi].rows.length, r0 = a.from_row == null ? 0 : rowArg(a.from_row, pi, 'from_row'), r1 = a.to_row == null ? N - 1 : rowArg(a.to_row, pi, 'to_row'); return r0 <= r1 ? [r0, r1] : fail(`from_row (${hex2(r0)}) is after to_row (${hex2(r1)})`); }
const instLabel = i => instruments[i] ? `${instruments[i].name || '(unnamed)'} (${hex2(i)})` : `?? (${hex2(i)})`;
const cellText = (c, withName) => PTFormat.cellStr(c) + (withName && c.i ? `  ${instLabel(c.i)}` : '');
const chName = ch => song.channels[ch].name ? `${ch + 1} ${song.channels[ch].name}` : `${ch + 1}`;
const done = (cmd, what) => cmd ? `ok: ${what} (Ctrl+Z in the tracker undoes it)` : 'no change (the values were already like this)';
const fmtTime = x => x.toFixed(3);
const envTxt = e => e.v + (e.u === 'ms' ? 'ms' : 't');

// silent replay of the song (same processRow as playback) → each channel's state at tick 0 of the asked rows
function describeState(ordPos, r0, r1) {
  const sim = { mode: 'song', ord: 0, row: 0, bpm: song.bpm, speed: song.speed, nextRowTime: 0,
    chans: Array.from({ length: nch() }, (_, ch) => ({ ...newChan(_, ch), sim: true })) };
  const total = song.order.slice(0, ordPos).reduce((a, p) => a + song.patterns[p].rows.length, 0) + r1 + 1;
  const pi = song.order[ordPos], out = [];
  for (let k = 0; k < total; k++) {
    if (k >= total - (r1 - r0 + 1)) {
      const row = sim.row, cells = song.patterns[pi].rows[row];
      const snap = { ...sim, chans: sim.chans.map(C => ({ ...C, voice: C.voice && C.voice.clone() })) };
      const before = snap.chans.map(C => C.voice), t = snap.nextRowTime;
      processRow(snap, true);
      out.push(`order ${hex2(ordPos)} · pattern ${hex2(pi)} · row ${hex2(row)} (speed ${snap.speed}, ${snap.bpm} BPM)`);
      snap.chans.forEach((C, ch) => {
        const cell = cells[ch], v = C.voice, d = cell.f === FX.E && (cell.p >> 4) === 0xD ? cell.p & 15 : 0;
        const inst = I => `${I ? `${I.name || '(unnamed)'} (${hex2(instruments.indexOf(I))})` : 'no instrument'} · volume ${hex2(C.vol)}`;
        const what = (note, I) => ` · ${noteName(note)} · ${inst(I)}`;
        let s;
        if (d > 0 && cell.n >= 0 && cell.n < 96) s = d < snap.speed ? `new hit, delayed ${d} ticks (EDx)` + what(cell.n, instruments[cell.i || C.inst]) : `note delayed by EDx past speed (${snap.speed}), doesn't play`;
        else if (v && v !== before[ch]) s = 'new hit' + what(v.note, v.I);
        else if (!v || !v.alive(t)) s = 'silent';
        else if (cell.f === 3 && Math.abs(C.pitch - C.target) > 0.01) s = `sliding · ${noteName(Math.round(C.pitch))} → ${noteName(C.target)} · ${inst(v.I)}`;
        else if (v.relT != null) s = 'fading (key-off)' + what(Math.round(C.pitch), v.I);
        else s = 'still playing' + what(Math.round(C.pitch), v.I);
        out.push(`  channel ${chName(ch)}: ${s}`);
      });
    }
    processRow(sim);
  }
  return out.join('\n');
}

const MCP_TOOLS = {
  get_song() {
    return [`title: ${song.title || '(none)'}`, `bpm ${song.bpm} · speed ${song.speed} · rowsPerBeat ${song.rowsPerBeat} (1 beat = ${song.rowsPerBeat} rows)`,
      `channels: ${song.channels.map((c, ch) => `${chName(ch)} (pan ${hex2(c.pan)})`).join(' | ')}`,
      `order: ${song.order.map((p, k) => `${hex2(k)}→${hex2(p)}`).join(' ')}`,
      'patterns:', ...song.patterns.map((P, k) => `  ${hex2(k)}: ${P.rows.length} rows, ${P.rows.reduce((a, r) => a + r.filter(c => !same(c, emptyCell())).length, 0)} filled cells`)].join('\n');
  },
  list_instruments() {
    return instruments.slice(1).map((I, k) => `${hex2(k + 1)} ${I.name || '(unnamed)'} · base ${noteName(I.baseNote)} · volume ${hex2(I.vol)} · region ${fmtTime(I.start)}–${fmtTime(I.end)} s · hit ${fmtTime(I.hit)} s · a=${envTxt(I.A)} d=${envTxt(I.D)} s=${+I.S.toFixed(2)} r=${envTxt(I.R)} · ${I.loop ? `loop ${fmtTime(I.loopStart)}–${fmtTime(I.loopEnd)} s` : 'no loop'}`).join('\n') || 'no instruments';
  },
  view_rows(a) {
    const pi = patArg(a.pattern), [r0, r1] = rowRange(a, pi), P = song.patterns[pi];
    const lines = [`pattern ${hex2(pi)} · ${P.rows.length} rows · channels: ${song.channels.map((c, ch) => chName(ch)).join(' | ')} · cell: note instrument volume effect`];
    for (let r = r0; r <= r1; r++) lines.push(`${hex2(r)} | ${P.rows[r].map(c => PTFormat.cellStr(c)).join(' | ')}`);
    return lines.join('\n');
  },
  view_channel(a) {
    const pi = patArg(a.pattern), ch = chArg(a.channel), P = song.patterns[pi];
    const ev = P.rows.map((r, k) => same(r[ch], emptyCell()) ? null : `${hex2(k)}  ${cellText(r[ch], true)}`).filter(Boolean);
    return [`pattern ${hex2(pi)} · channel ${chName(ch)} · ${P.rows.length} rows · empty rows skipped`, ...(ev.length ? ev : ['(empty)'])].join('\n');
  },
  view_sparse(a) {
    const pi = patArg(a.pattern), P = song.patterns[pi], ev = [];
    P.rows.forEach((r, k) => r.forEach((c, ch) => { if (!same(c, emptyCell())) ev.push(`${hex2(k)}  channel ${ch + 1}  ${cellText(c, true)}`); }));
    return [`pattern ${hex2(pi)} · ${P.rows.length} rows · filled cells only`, ...(ev.length ? ev : ['(empty)'])].join('\n');
  },
  get_state(a) {
    const o = hexArg(a.order_pos, 'order_pos');
    if (o >= song.order.length) fail(`order_pos ${hex2(o)} doesn't exist (order: 00–${hex2(song.order.length - 1)})`);
    const pi = song.order[o], r0 = rowArg(a.row, pi), r1 = a.to_row == null ? r0 : rowArg(a.to_row, pi, 'to_row');
    if (r1 < r0) fail(`to_row (${hex2(r1)}) is before row (${hex2(r0)})`);
    return describeState(o, r0, r1);
  },
  set_cells(a) {
    const pi = patArg(a.pattern);
    if (!Array.isArray(a.cells) || !a.cells.length) fail("cells can't be empty");
    const changes = a.cells.map(c => {
      const x = { pat: pi, row: rowArg(c.row, pi), ch: chArg(c.channel) };
      if ('note' in c) x.n = fieldArg('note', c.note);
      if ('instrument' in c) x.i = fieldArg('inst', c.instrument);
      if ('volume' in c) x.v = fieldArg('vol', c.volume);
      if ('effect' in c) Object.assign(x, fieldArg('fx', c.effect));
      return x;
    });
    const cmd = exec(() => setCells(changes, 'MCP: set_cells'));
    return done(cmd, `${cmd ? cmd.n : 0} cells changed (pattern ${hex2(pi)})`);
  },
  write_notes(a) {
    const pi = patArg(a.pattern), ch = chArg(a.channel), r0 = rowArg(a.start_row, pi, 'start_row'), N = song.patterns[pi].rows.length;
    const every = a.every ?? 1;
    if (!Number.isInteger(every) || every < 1) fail(`every must be an integer ≥ 1 (rows between notes), got: ${JSON.stringify(a.every)}`);
    const notes = typeof a.notes === 'string' ? a.notes.trim().split(/\s+/).filter(Boolean) : fail('notes must be notes separated by spaces, e.g. "C-4 E-4 G-4 ==="');
    const last = r0 + (notes.length - 1) * every;
    if (last >= N) fail(`${notes.length} notes, ${every} rows apart: the last note would be on row ${hex2(last)}, but pattern ${hex2(pi)} has rows 00–${hex2(N - 1)}`);
    const inst = a.instrument == null ? null : fieldArg('inst', a.instrument), vol = a.volume == null ? null : fieldArg('vol', a.volume);
    const changes = notes.map((t, k) => {
      const n = fieldArg('note', t), x = { pat: pi, row: r0 + k * every, ch, n };
      if (n >= 0 && n < 96) { if (inst != null) x.i = inst; if (vol != null) x.v = vol; }
      if (n === KEYOFF) x.i = 0;
      if (n < 0) Object.assign(x, emptyCell());
      return x;
    });
    const cmd = exec(() => setCells(changes, 'MCP: write_notes'));
    return done(cmd, `${notes.length} notes written (pattern ${hex2(pi)}, channel ${ch + 1}, rows ${hex2(r0)}–${hex2(last)})`);
  },
  clear(a) {
    const pi = patArg(a.pattern), [r0, r1] = rowRange(a, pi), chs = chList(a.channels), changes = [];
    for (let r = r0; r <= r1; r++) for (const ch of chs) changes.push({ pat: pi, row: r, ch, ...emptyCell() });
    const cmd = exec(() => setCells(changes, 'MCP: clear'));
    return done(cmd, `${cmd ? cmd.n : 0} cells cleared (pattern ${hex2(pi)})`);
  },
  transpose(a) {
    const pi = patArg(a.pattern), [r0, r1] = rowRange(a, pi), chs = chList(a.channels), st = a.semitones, P = song.patterns[pi], changes = [];
    if (!Number.isInteger(st) || st === 0) fail('semitones must be a non-zero integer (negative = down)');
    for (let r = r0; r <= r1; r++) for (const ch of chs) {
      const n = P.rows[r][ch].n; if (n < 0 || n >= 96) continue;
      if (n + st < 0 || n + st > 95) fail(`row ${hex2(r)} channel ${ch + 1}: ${noteName(n)} ${st > 0 ? '+' : ''}${st} semitones goes outside C-0…B-7`);
      changes.push({ pat: pi, row: r, ch, n: n + st });
    }
    if (!changes.length) return 'no notes in that range';
    exec(() => setCells(changes, `MCP: transpose ${st}`));
    return done(true, `${changes.length} notes moved ${st > 0 ? '+' : ''}${st} semitones (pattern ${hex2(pi)})`);
  },
  copy_pattern(a) {
    const pi = patArg(a.pattern);
    exec(() => addPattern(clonePattern(song.patterns[pi]), `MCP: copy of pattern ${hex2(pi)}`));
    return done(true, `pattern ${hex2(song.patterns.length - 1)} created (a copy of ${hex2(pi)}); use set_order to add it to the order`);
  },
  new_pattern(a) {
    const n = a.rows ?? 64, e = PTFormat.checkRows(n); if (e) fail(e);
    exec(() => addPattern(newPattern(n), 'MCP: new pattern'));
    return done(true, `pattern ${hex2(song.patterns.length - 1)} created (${n} rows, empty); use set_order to add it to the order`);
  },
  set_order(a) {
    if (!Array.isArray(a.order)) fail('order must be a list of pattern numbers, e.g. ["00", "01", "00"]');
    const cmd = exec(() => setOrder(a.order.map(p => hexArg(p, 'order entry')), 'MCP: set_order'));
    return done(cmd, `order: ${song.order.map(hex2).join(' ')}`);
  },
  set_song(a) {
    const f = {};
    for (const k of ['title', 'bpm', 'speed', 'rowsPerBeat']) if (k in a) f[k] = a[k];
    if (!Object.keys(f).length) fail('nothing to change (title, bpm, speed, rowsPerBeat)');
    const cmd = exec(() => setSong(f, 'MCP: set_song'));
    return done(cmd, Object.entries(f).map(([k, v]) => `${k}=${v}`).join(', '));
  },
  set_instrument(a) {
    const idx = instArg(a.instrument), f = {}, map = { name: 'name', base_note: 'base', volume: 'vol', attack: 'a', decay: 'd', sustain: 's', release: 'r', loop: 'loop', loop_start: 'ls', loop_end: 'le' };
    for (const [k, key] of Object.entries(map)) if (k in a) {
      if (k === 'loop' && typeof a.loop !== 'boolean') fail('loop must be true or false');
      try { f[{ name: 'name', base: 'baseNote', vol: 'vol', a: 'A', d: 'D', s: 'S', r: 'R', loop: 'loop', ls: 'loopStart', le: 'loopEnd' }[key]] = k === 'loop' ? a.loop : k === 'name' ? String(a.name) : PTFormat.field(key, a[k]); }
      catch (e) { fail(e.message.replace(/^TURD1\b[^:]*:\s*/, '')); } // drop the parser's line prefix, whatever its wording
    }
    if (!Object.keys(f).length) fail(`nothing to change (${Object.keys(map).join(', ')})`);
    const cmd = exec(() => setInstrument(idx, f, 'MCP: set_instrument'));
    return done(cmd, `instrument ${hex2(idx)}: ${Object.keys(f).join(', ')}`);
  },
};

// the bridge: reconnects quietly (3 s → 30 s) until mcp/server.mjs is running
const MCP_PORT = 8767;
let mcpWs = null, mcpRetry = 3000;
function mcpBadge() { const b = $('#mcpState'); b.textContent = mcpWs ? 'MCP ●' : 'MCP ○'; b.style.color = mcpWs ? 'var(--green)' : 'var(--dim)'; b.title = mcpWs ? 'MCP server connected' : `MCP server not connected (node mcp/server.mjs, port ${MCP_PORT})`; }
function mcpConnect() {
  const ws = new WebSocket(`ws://localhost:${MCP_PORT}`);
  ws.onopen = () => { mcpWs = ws; mcpRetry = 3000; mcpBadge(); };
  ws.onclose = () => { if (mcpWs === ws) { mcpWs = null; mcpBadge(); } setTimeout(mcpConnect, mcpRetry); mcpRetry = Math.min(30000, mcpRetry * 2); };
  ws.onmessage = e => {
    const { id, tool, args } = JSON.parse(e.data);
    let res;
    try {
      if (!Object.hasOwn(MCP_TOOLS, tool)) fail(`unknown tool '${tool}'`);
      res = { id, text: MCP_TOOLS[tool](args || {}) };
      if (res.text.startsWith('ok:')) setStatus(`MCP · ${escHtml(res.text.replace(/ \(Ctrl\+Z in the tracker.*\)$/, ''))}`);
    } catch (err) {
      if (!(err instanceof CmdError)) console.error(err);
      res = { id, error: err.message };
    }
    ws.send(JSON.stringify(res));
  };
}
export function startMcp() { mcpBadge(); mcpConnect(); }
