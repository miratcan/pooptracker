#!/usr/bin/env node
// PoopTracker MCP server (POC-02 / B). No dependencies.
//   LLM client ⇄ (MCP over stdio) ⇄ this server ⇄ (WebSocket, localhost:8767) ⇄ open tracker tab
// The tools run inside the tracker tab, through its command layer: same validation as the keyboard,
// changes appear immediately, and Ctrl+Z in the tracker undoes them.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 8767;
const log = (...a) => process.stderr.write(`[pooptracker-mcp] ${a.join(' ')}\n`);

// ───── tools (the tracker tab implements them; here: names, descriptions, input schemas)
const hex = d => ({ type: 'string', pattern: '^[0-9A-Fa-f]{2}$', description: d });
const chan = { type: 'integer', minimum: 1, maximum: 8, description: 'channel number, 1–N (N = the song\'s channel count, at most 8; get_song tells it)' };
const range = { from_row: hex('first row (default 00)'), to_row: hex('last row, inclusive (default: the last row)') };
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const TOOLS = [
  ['get_song', 'Song summary: title, bpm, speed, rowsPerBeat, channels, order and the pattern list. Call this first.', obj({})],
  ['list_instruments', 'Instrument list: number, name, base note, volume, region in the video, hit point, ADSR, loop.', obj({})],
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
  ['set_instrument', 'Change the settings of an existing instrument. Creating an instrument, or changing its region / hit point in the video, is the human\'s job (it needs seeing the video).',
    obj({ instrument: hex('instrument number'), name: { type: 'string' }, base_note: { type: 'string', description: 'the note that plays at the original speed, e.g. C-4' },
      volume: { type: 'string', description: '"00"–"40"' }, attack: { type: 'string', description: 'with its unit: "4t" (ticks, follows the tempo) or "120ms"' },
      decay: { type: 'string', description: 'with its unit, e.g. "8t"' }, sustain: { type: 'number', minimum: 0, maximum: 1 }, release: { type: 'string', description: 'with its unit, e.g. "800ms"' },
      loop: { type: 'boolean' }, loop_start: { type: 'number', description: 'seconds, time in the video' }, loop_end: { type: 'number', description: 'seconds, time in the video' } }, ['instrument'])],
];
const INSTRUCTIONS = `PoopTracker: an FT2-style tracker that uses videos as samples. The tools are connected to the open tracker tab; everything you write shows up on screen immediately and the user can undo it with Ctrl+Z. An invalid change is never applied; the error message says where the problem is and what the valid values are.
Numbers are in the tracker's language: pattern, row, order position, instrument and volume are 2-digit HEX strings ("00", "0C", "3F"); a channel is an integer 1–N (N = the song's channel count, 1–8); notes are C-0…B-7 ("C-4", "C#4"), "===" is a key-off, "..." is empty. Counts like every, semitones and rows are decimal.
Cell: note instrument volume effect. Volume 00–40 (40 = full). Effects (xy = two hex digits): 3xx tone portamento (slide from the previous note to this one, xx = speed) · 4xy vibrato (x speed, y depth) · 8xx pan (00 left, 80 center, FF right) · 9xx sample offset (start at xx/256 of the region length) · Axy volume slide (x up, y down) · E9x retrigger (replay from the hit every x ticks) · ECx note cut (silence at tick x) · EDx note delay (delay by x ticks) · Fxx speed (01–1F) / BPM (20–FF) · Sxx video zoom/shake · Ixx video color invert. An effect with parameter 00 reuses its previous value.
Time: 1 row = speed ticks, 1 tick = 2.5/BPM seconds; rowsPerBeat rows = 1 beat. Pitch = video speed: 12 semitones above the base note plays the video twice as fast.
Start with get_song and list_instruments to get to know the song; use view_channel to read a channel, and get_state to know what is playing at a given moment.`;

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
  m.error != null ? p.reject(new Error(m.error)) : p.resolve(m.text);
}
function callTab(tool, args) {
  if (!tab) return Promise.reject(new Error('No tracker tab is connected. Open the tracker in a browser (e.g. http://localhost:8765/index.html); its header should show "MCP ●".'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    wsSend(tab, JSON.stringify({ id, tool, args }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error('the tracker did not answer within 20 seconds')); }, 20000);
  });
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
      try { return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: await callTab(name, params.arguments || {}) }] } }); }
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
