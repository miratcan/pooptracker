#!/usr/bin/env node
// PoopTracker MCP server. No dependencies.
//   LLM client ⇄ (MCP over stdio) ⇄ this server ⇄ (WebSocket, localhost:8767) ⇄ open tracker tab
// The tools run inside the tracker tab, through its command layer: same validation as the keyboard,
// changes appear immediately, and Ctrl+Z in the tracker undoes them.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cutVideo } from '../src/mp4cut.js';

const PORT = +process.env.POOPTRACKER_MCP_PORT || 8767; // the tab connects to 8767 unless its URL says ?mcp=<port>
const log = (...a) => process.stderr.write(`[pooptracker-mcp] ${a.join(' ')}\n`);

// ───── tools (the tracker tab implements them; here: names, descriptions, input schemas)
const hex = d => ({ type: 'string', pattern: '^[0-9A-Fa-f]{2}$', description: d });
const chan = { type: 'integer', minimum: 1, maximum: 10, description: 'channel number, 1–N (N = the song\'s channel count, at most 10; get_song tells it)' };
const range = { from_row: hex('first row (default 00)'), to_row: hex('last row, inclusive (default: the last row)') };
const filePath = d => ({ type: 'string', description: `${d}; an absolute path (or ~/…)` });
const focusArg = { type: 'string', description: 'where the picture looks: the point the tiles keep in view, as time:x,y keys joined by | (x, y 0–1 across the frame, 0,0 top left; time in seconds on the video\'s timeline; between keys the point moves in a straight line), e.g. "0:0.30,0.45" or "0:0.3,0.5|1.2:0.6,0.5"; "" = the middle' };
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const TOOLS = [
  ['get_song', 'Song summary: title, bpm, speed, rowsPerBeat, channels, order and the pattern list. Call this first.', obj({})],
  ['list_instruments', 'Instrument list: number, name, base note, volume, reverb, region in the video, hit point, ADSR, loop.', obj({})],
  ['view_rows', 'Row view: shows a pattern row by row, like the tracker screen (each cell: note instrument volume effect).',
    obj({ pattern: hex('pattern number'), ...range }, ['pattern'])],
  ['view_channel', 'Channel view: the filled rows of one channel as a list, with instrument names. Use this to read a channel from top to bottom.',
    obj({ pattern: hex('pattern number'), channel: chan }, ['pattern', 'channel'])],
  ['view_sparse', 'Sparse view: every filled cell (row, channel) of a pattern; empty rows are skipped.', obj({ pattern: hex('pattern number') }, ['pattern'])],
  ['get_state', 'What each channel is playing at an order position and row (or a row range): new hit / sustaining / sliding / fading / silent, with note, instrument and volume. Includes notes and effects carried over from earlier patterns (computed by silently playing the song from the start). No interpretation.',
    obj({ order_pos: hex('position in the order (not the pattern number)'), row: hex('row'), to_row: hex('last row, for a range (optional)') }, ['order_pos', 'row'])],
  ['set_cells', 'Set several cells at once (one undo step). Fields that are not given stay unchanged.',
    obj({ pattern: hex('pattern number'), cells: { type: 'array', minItems: 1, items: obj({
      row: hex('row'), channel: chan, note: { type: 'string', description: 'C-4, C#4 …, "===" key-off, "..." empty' },
      instrument: { type: 'string', description: '"01"… or ".." empty' }, volume: { type: 'string', description: '"00"–"40" or ".." empty' },
      effect: { type: 'string', description: 'e.g. "A20", "E93" or "..." empty' } }, ['row', 'channel']) } }, ['pattern', 'cells'])],
  ['write_notes', 'Write notes to one channel, starting at start_row, one every `every` rows: "C-4 E-4 G-4 C-5". "===" is a key-off, "..." empties that row. One undo step.',
    obj({ pattern: hex('pattern number'), channel: chan, start_row: hex('row of the first note'), notes: { type: 'string', description: 'notes separated by spaces' },
      every: { type: 'integer', minimum: 1, description: 'rows between notes (decimal, default 1)' },
      instrument: { type: 'string', description: 'instrument written with the notes, "01"…' }, volume: { type: 'string', description: 'volume written with the notes, "00"–"40"' } },
    ['pattern', 'channel', 'start_row', 'notes'])],
  ['clear', 'Clear a range (pattern, channels, row range).', obj({ pattern: hex('pattern number'), channels: { type: 'array', items: chan, description: 'default: all' }, ...range }, ['pattern'])],
  ['transpose', 'Shift the notes in a range by semitones (key-offs and empty cells stay unchanged).',
    obj({ pattern: hex('pattern number'), semitones: { type: 'integer', description: 'semitones, negative = down' }, channels: { type: 'array', items: chan, description: 'default: all' }, ...range }, ['pattern', 'semitones'])],
  ['copy_pattern', 'Copy a pattern and append it as a new pattern; returns the new number. It is not added to the order.', obj({ pattern: hex('pattern to copy') }, ['pattern'])],
  ['new_pattern', 'Append a new empty pattern; returns the new number. It is not added to the order.', obj({ rows: { type: 'integer', minimum: 1, maximum: 256, description: 'number of rows (decimal, default 64)' } })],
  ['set_order', 'Replace the whole order list.', obj({ order: { type: 'array', minItems: 1, items: hex('pattern number') } }, ['order'])],
  ['set_song', 'Song settings.', obj({ title: { type: 'string' }, bpm: { type: 'integer', minimum: 32, maximum: 255 }, speed: { type: 'integer', minimum: 1, maximum: 31 }, rowsPerBeat: { type: 'integer', minimum: 1, maximum: 32 } })],
  ['set_instrument', 'Change the settings of an existing instrument. Times are seconds on the video\'s timeline; the loop start can\'t be before the hit point.',
    obj({ instrument: hex('instrument number'), name: { type: 'string' }, base_note: { type: 'string', description: 'the note that plays at the original speed, e.g. C-4' }, fine: { type: 'integer', minimum: -128, maximum: 127, description: 'finetune (FT2): 1/128 of a semitone; the clip\'s own pitch is base_note plus this' },
      volume: { type: 'string', description: '"00"–"40"' }, reverb: { type: 'string', description: 'how much goes into the hall (one for the whole song), "00"–"40"; "00" = dry' }, attack: { type: 'string', description: 'with its unit: "4t" (ticks, follows the tempo) or "120ms"' },
      decay: { type: 'string', description: 'with its unit, e.g. "8t"' }, sustain: { type: 'string', description: 'level after the decay, "00"–"40" like volume' }, release: { type: 'string', description: 'with its unit, e.g. "800ms"' },
      loop: { type: 'string', enum: ['none', 'forward', 'pingpong'], description: 'none: plays once · forward: loop start → end, again · pingpong: start → end → start… (the video plays backward too)' }, loop_start: { type: 'number', description: 'seconds, time in the video' }, loop_end: { type: 'number', description: 'seconds, time in the video' },
      region_start: { type: 'number', description: 'seconds: where the instrument starts in the video' }, region_end: { type: 'number', description: 'seconds: where it ends' },
      hit: { type: 'number', description: 'seconds: the hit point, the moment that lands exactly on the row' }, av_offset: { type: 'integer', description: 'milliseconds: shifts the picture against the sound, for a video whose audio track is off' },
      focus: focusArg }, ['instrument'])],
  ['tune_instrument', 'Find the pitch of an instrument (after its hit) and set its base note and finetune to it, so written notes sound as written. The clip is not changed; a bend in it stays (one pitch per instrument). Fails on a sound with no clear pitch (a snare, a hi-hat, noise); a kick or a tom has one.', obj({ instrument: hex('instrument number') }, ['instrument'])],
  ['fit_instrument', 'Repitch an instrument (like Renoise\'s beat sync, repitch mode) so that, played at C-4, its whole region lasts a whole number of rows at the current BPM and speed (so it repeats seamlessly when played every that many rows): sets its base note and finetune; picture and sound speed up or slow down together. For drum loops. Without rows, the power of two nearest to its length now. Do it again after a tempo change.', obj({ instrument: hex('instrument number'), rows: { type: 'integer', minimum: 1, maximum: 256, description: 'how many rows it should last' } }, ['instrument'])],
  ['detect_hit', 'Find the hit point of an instrument in its audio (the loudest onset in its region) and set it.', obj({ instrument: hex('instrument number') }, ['instrument'])],
  ['trim_instrument', 'Cut an instrument\'s video down to its region and throw the rest away (not re-encoded): it plays the same, its hit, loop points and focus move with it, and the song file gets smaller. Ctrl+Z brings the whole video back.', obj({ instrument: hex('instrument number') }, ['instrument'])],
  ['duplicate_instrument', 'A new instrument with the same video and settings (then change its region, hit or pitch).', obj({ instrument: hex('instrument number') }, ['instrument'])],
  ['move_instrument', 'Swap an instrument with its neighbour; the pattern cells follow it.', obj({ instrument: hex('instrument number'), direction: { type: 'string', enum: ['up', 'down'] } }, ['instrument', 'direction'])],
  ['delete_instrument', 'Delete an instrument no pattern uses; the instruments after it move down one number.', obj({ instrument: hex('instrument number') }, ['instrument'])],
  ['new_song', 'Replace the song with a new empty one (4 channels, one 64-row pattern, no instruments). One Ctrl+Z brings the old one back.', obj({})],
  ['add_channel', 'Add a channel at the end (at most 10).', obj({})],
  ['delete_channel', 'Delete an empty channel; the channels after it move down one number.', obj({ channel: chan }, ['channel'])],
  ['delete_pattern', 'Delete a pattern the order doesn\'t use; the patterns after it move down one number and the order follows them.', obj({ pattern: hex('pattern number') }, ['pattern'])],
  ['set_pattern_length', 'Change the number of rows of a pattern (rows past the new end are cut off; Ctrl+Z brings them back).', obj({ pattern: hex('pattern number'), rows: { type: 'integer', minimum: 1, maximum: 256 } }, ['pattern', 'rows'])],
  ['load_video', 'Load a video file as a new instrument. A video saved by PoopTracker brings its settings from its metadata; otherwise the hit point is found automatically. Only the first 8 seconds are used. With start and end, a piece is cut out of a long video (MP4, MOV, WebM or MKV, any length) like on the workbench: without re-encoding; the instrument is exactly start–end.',
    obj({ path: filePath('the video file (mp4, mov, webm…)'), start: { type: 'number', minimum: 0, description: 'cut a piece: where it starts in the video (seconds); needs end' }, end: { type: 'number', description: 'where the piece ends (seconds); at most 8 s after start' }, focus: focusArg }, ['path'])],
  ['replace_video', 'Give an instrument another video. It keeps how it sounds (name, base note, volume, reverb, envelope, loop mode); region, hit and loop points are found again in the new video (the whole video, hit detected). A video saved by PoopTracker brings all its settings from its metadata instead. With start and end, a piece of a long video becomes its video, cut like on the workbench (the region is exactly start–end).',
    obj({ instrument: hex('instrument number'), path: filePath('the new video file'), start: { type: 'number', minimum: 0, description: 'cut a piece: where it starts in the video (seconds); needs end' }, end: { type: 'number', description: 'where the piece ends (seconds); at most 8 s after start' }, focus: focusArg }, ['instrument', 'path'])],
  ['open_song', 'Open a .poop song file. It replaces the current song and CAN\'T be undone: save the current song first if it matters. Nothing changes if the file has errors.', obj({ path: filePath('the .poop file') }, ['path'])],
  ['import_midi', 'Import a MIDI file (.mid, type 0 or 1) as a new song: one instrument per track (on the drum channel, one per drum sound), each with a silent REPLACE ME video until replace_video gives it its own. Undoable. The answer lists what was moved, clamped or dropped (grid, more than 10 notes at once…).', obj({ path: filePath('the .mid file') }, ['path'])],
  ['save_song', 'Save the song with its videos as one .poop file.', obj({ path: filePath('where to write the .poop file'), overwrite: { type: 'boolean', description: 'replace an existing file (default false: an existing file is never touched)' } }, ['path'])],
  ['save_instrument_video', 'Save a copy of an instrument\'s video with the instrument\'s settings in its metadata (MP4/MOV; the video isn\'t re-encoded). Dropped on a tracker, it arrives as this instrument.',
    obj({ instrument: hex('instrument number'), path: filePath('where to write the video (.mp4 / .mov, like the original)'), overwrite: { type: 'boolean', description: 'replace an existing file (default false)' } }, ['instrument', 'path'])],
];
// tools whose `path` is read here and sent to the tab, or written here with what the tab sends back
const READS = new Set(['load_video', 'replace_video', 'open_song', 'import_midi']), WRITES = new Set(['save_song', 'save_instrument_video']);
const INSTRUCTIONS = `PoopTracker: an FT2-style tracker that uses videos as samples. The tools are connected to the open tracker tab; everything you write shows up on screen immediately and the user can undo it with Ctrl+Z. An invalid change is never applied; the error message says where the problem is and what the valid values are.
Numbers are in the tracker's language: pattern, row, order position, instrument and volume are 2-digit HEX strings ("00", "0C", "3F"); a channel is an integer 1–N (N = the song's channel count, 1–10); notes are C-0…B-7 ("C-4", "C#4"), "===" is a key-off, "..." is empty. Counts like every, semitones and rows are decimal.
Cell: note instrument volume effect. Volume 00–40 (40 = full). Effects (xy = two hex digits): 3xx tone portamento (slide from the previous note to this one, xx = speed) · 4xy vibrato (x speed, y depth) · 8xx pan (00 left, 80 center, FF right) · 9xx sample offset (start at xx/256 of the region length) · Axy volume slide (x up, y down) · E9x retrigger (replay from the hit every x ticks) · ECx note cut (silence at tick x) · EDx note delay (delay by x ticks) · Fxx speed (01–1F) / BPM (20–FF) · Sxx video zoom/shake · Ixx video color invert · Gxy grow the channel's tile over x columns and y rows of the output grid, rightwards and down as far as it goes (0 = the whole width/height, G00 = full screen; it covers the tiles under it, which play on unseen), until the channel goes silent. An effect with parameter 00 reuses its previous value.
Time: 1 row = speed ticks, 1 tick = 2.5/BPM seconds; rowsPerBeat rows = 1 beat. Pitch = video speed: 12 semitones above the base note plays the video twice as fast.
Start with get_song and list_instruments to get to know the song; use view_channel to read a channel, and get_state to know what is playing at a given moment.
Files (load_video, replace_video, open_song, import_midi, save_song, save_instrument_video) take absolute paths on this computer. Saving never replaces an existing file unless overwrite is true; open_song replaces the current song and can't be undone.`;

// ───── WebSocket server (just enough of RFC 6455 for one local tab)
let tab = null, nextId = 1;
const pending = new Map();
function wsSend(sock, text) {
  const data = Buffer.from(text), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  sock.write(Buffer.concat([head, data]));
}
const httpServer = http.createServer((req, res) => { res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' }); res.end('PoopTracker MCP bridge: the tracker tab connects here over WebSocket.\n'); });
httpServer.on('upgrade', (req, sock) => {
  // only tracker pages served from this machine may connect
  const origin = req.headers.origin || '';
  if (!/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|null)$/.test(origin)) { log('rejected, origin:', origin); sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  if (tab) tab.destroy(); // the newest tab wins
  tab = sock; log('tracker tab connected');
  let buf = Buffer.alloc(0), frags = [];
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, o = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
      const mask = masked ? buf.subarray(o, o + 4) : null; if (masked) o += 4;
      if (buf.length < o + len) return;
      const payload = Buffer.from(buf.subarray(o, o + len)); buf = buf.subarray(o + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op === 8) { sock.end(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8A, payload.length]), payload])); continue; }
      if (op === 1 || op === 0) { frags.push(payload); if (fin) { onTabMessage(Buffer.concat(frags).toString()); frags = []; } }
    }
  });
  const gone = () => { if (tab === sock) { tab = null; log('tracker tab disconnected'); for (const [, p] of pending) p.reject(new Error('lost the connection to the tracker tab')); pending.clear(); } };
  sock.on('close', gone); sock.on('error', gone);
});
function onTabMessage(text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  const p = pending.get(m.id); if (!p) return;
  pending.delete(m.id);
  m.error != null ? p.reject(new Error(m.error)) : p.resolve(m);
}
function callTab(tool, args, timeout = 20000) {
  if (!tab) return Promise.reject(new Error('No tracker tab is connected. Open the tracker in a browser (e.g. http://localhost:8765/index.html); its header should show "MCP ●".'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    wsSend(tab, JSON.stringify({ id, tool, args }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`the tracker did not answer within ${timeout / 1000} seconds`)); }, timeout);
  });
}

// files never travel as paths to the tab (a browser can't open them): they are read and written here.
// Paths must be absolute [ZEN-EXPLICIT]; an existing file is only replaced with overwrite: true.
const MAX_FILE = 512 * 1048576;
function resolvePath(p) {
  if (typeof p !== 'string' || !p) throw new Error('path is missing');
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) throw new Error(`path must be absolute (or start with ~/), got: ${p}`);
  return p;
}
// a piece of a long video, cut here (only the piece travels to the tab); its region goes along as args.region
async function cutPiece(p, size, args) {
  const { start, end } = args; delete args.start; delete args.end;
  if (typeof start !== 'number' || typeof end !== 'number') throw new Error('a piece needs both start and end (seconds)');
  if (!(end > start)) throw new Error(`end (${end}) must be after start (${start})`);
  if (end - start > 8) throw new Error(`the piece is ${(end - start).toFixed(3)} s; an instrument can be at most 8 s`);
  const fd = await fs.promises.open(p, 'r');
  try {
    const read = async (o, n) => { const b = new Uint8Array(n); await fd.read(b, 0, n, o); return b; };
    const piece = await cutVideo(read, size, start, end);
    const base = path.basename(p).replace(/\.[^.]+$/, '');
    args.region = { start: piece.start, end: piece.end, name: `${base.slice(0, 8)} ${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')}` };
    return { name: `${base} ${start.toFixed(3)}.mp4`, data: Buffer.from(piece.bytes).toString('base64') };
  } finally { await fd.close(); }
}
async function runTool(name, args) {
  let out = null;
  if (READS.has(name)) {
    const p = resolvePath(args.path); delete args.path;
    const st = await fs.promises.stat(p).catch(() => { throw new Error(`no such file: ${p}`); });
    if (!st.isFile()) throw new Error(`not a file: ${p}`);
    if ((name === 'load_video' || name === 'replace_video') && (args.start != null || args.end != null)) args.file = await cutPiece(p, st.size, args);
    else {
      if (st.size > MAX_FILE) throw new Error(`${p} is ${(st.size / 1048576).toFixed(0)} MB; files up to ${MAX_FILE / 1048576} MB are accepted`);
      args.file = { name: path.basename(p), data: (await fs.promises.readFile(p)).toString('base64') };
    }
  }
  if (WRITES.has(name)) {
    out = resolvePath(args.path); delete args.path;
    if (!args.overwrite && fs.existsSync(out)) throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    delete args.overwrite;
    if (!fs.existsSync(path.dirname(out))) throw new Error(`the folder doesn't exist: ${path.dirname(out)}`);
  }
  const m = await callTab(name, args, READS.has(name) || WRITES.has(name) ? 180000 : 20000);
  if (out) {
    if (!m.file) throw new Error('the tracker sent no file');
    await fs.promises.writeFile(out, Buffer.from(m.file, 'base64'));
    return `${m.text} → ${out}`;
  }
  return m.text;
}
httpServer.on('error', e => { log(e.code === 'EADDRINUSE' ? `port ${PORT} is in use (another pooptracker MCP server may be running)` : e.message); process.exit(1); });
httpServer.listen(PORT, '127.0.0.1', () => log(`WebSocket: ws://localhost:${PORT}`));

// ───── MCP over stdio (JSON-RPC 2.0, one message per line)
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(m) {
  const { id, method, params } = m;
  if (id === undefined) return; // notifications (initialized, cancelled …) need no answer
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'pooptracker', version: '0.1.0' }, instructions: INSTRUCTIONS } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const name = params?.name;
      if (!TOOLS.some(t => t[0] === name)) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } });
      try { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: await runTool(name, { ...(params.arguments || {}) }) }] } }); }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } }); }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported method: ${method}` } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }); }
}
let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  inBuf += d;
  for (let i; (i = inBuf.indexOf('\n')) >= 0;) {
    const line = inBuf.slice(0, i).trim(); inBuf = inBuf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'could not parse JSON' } }); continue; }
    handle(m);
  }
});
process.stdin.on('end', () => process.exit(0));
