// A small Chrome driver for the browser tests, over the Chrome DevTools Protocol (CDP): no package, only what Node
// has ([ZEN-STANDALONE]). It serves the repository, starts a headless Chrome on a profile of its own and drives
// pages: runs JavaScript in them, clicks, drags, presses keys, gives file inputs their files.
// Without Chrome the browser tests are skipped (CHROME=<path> points to it when it isn't where it usually is).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURES = join(ROOT, 'test/fixtures');

export const chromePath = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find(p => p && existsSync(p));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };
// what the page throws, kept from its first line (for drivers that can't hear the page's errors themselves)
const CATCH = '<script>window.__errors = []; addEventListener("error", e => __errors.push(e.message)); '
  + 'addEventListener("unhandledrejection", e => __errors.push(String(e.reason && e.reason.stack || e.reason)));</script>';
// the repository over HTTP on a free port (ES modules don't load from file://)
export function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(file.endsWith('index.html') ? readFileSync(file, 'utf8').replace('<head>', '<head>' + CATCH) : readFileSync(file));
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

// one WebSocket to the browser; pages are sessions on it (flattened targets), told apart by sessionId
class Connection {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = new Set();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id)) {
        const { ok, fail, method } = this.waiting.get(m.id); this.waiting.delete(m.id);
        m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
      } else for (const h of this.handlers) h(m);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.waiting.set(id, { ok, fail, method }));
  }
}

export class Browser {
  static async launch() {
    const server = await serve(), dir = mkdtempSync(join(tmpdir(), 'pooptracker-test-'));
    const proc = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run',
      '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1400,900', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    const url = await new Promise((ok, fail) => {
      let err = '';
      proc.stderr.on('data', d => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) ok(m[1]); });
      proc.on('exit', code => fail(new Error(`Chrome exited (${code}) before it listened:\n${err}`)));
    });
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('no CDP connection')); });
    const b = new Browser(); Object.assign(b, { server, dir, proc, ws, conn: new Connection(ws), base: `http://127.0.0.1:${server.address().port}/` });
    return b;
  }
  // a new tab with the app loaded: no MCP (a port nothing listens on, so it never reaches the user's real server)
  // and the "read the manual?" question already answered. before(page) runs before the app loads; scale: pixels per
  // CSS pixel (2 for crisp pictures of the pixel fonts)
  async app({ before, scale = 1 } = {}) {
    const { targetId } = await this.conn.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.conn, sessionId, targetId);
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('DOM.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: scale, mobile: false });
    // and no song kept from an earlier test: the kept one is thrown away once per tab, so a reload still finds it
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('pooptracker.manualAsked', '1'); } catch {}" +
      "if (!sessionStorage.getItem('pooptracker.fresh')) { sessionStorage.setItem('pooptracker.fresh', '1'); indexedDB.deleteDatabase('pooptracker'); }" });
    if (before) await before(page);
    await page.goto(this.base + 'index.html?mcp=9');
    await page.waitFor(() => document.querySelectorAll('#instList .inst').length > 0, 10000); // the demo song is there
    return page;
  }
  async close() {
    try { await this.conn.send('Browser.close'); } catch {}
    this.ws.close(); this.proc.kill(); this.server.close();
    await new Promise(ok => this.proc.exitCode != null ? ok() : this.proc.on('exit', ok));
    // Chrome's helpers may still be writing the profile as it goes; a temporary folder left behind fails nothing
    await rm(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
export class Page {
  constructor(conn, sessionId, targetId) {
    Object.assign(this, { conn, sessionId, targetId, errors: [] });
    conn.handlers.add(m => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Page.loadEventFired') this.loaded?.();
    });
  }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  // events of this page: fn({ method, params })
  on(fn) { this.conn.handlers.add(m => { if (m.sessionId === this.sessionId) fn(m); }); }
  // files whose URL matches pattern (e.g. '*.ttf') arrive ms later
  async delay(pattern, ms) {
    this.on(m => { if (m.method === 'Fetch.requestPaused') setTimeout(() => this.send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}), ms); });
    await this.send('Fetch.enable', { patterns: [{ urlPattern: pattern }] });
  }
  async goto(url) {
    const loaded = new Promise(ok => { this.loaded = ok; });
    await this.send('Page.navigate', { url }); await loaded;
  }
  async reload() {
    const loaded = new Promise(ok => { this.loaded = ok; });
    await this.send('Page.reload'); await loaded;
  }
  // fn runs in the page with args (JSON); its (awaited) value comes back
  async eval(fn, ...args) {
    const r = await this.send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(fn, timeout = 5000, ...args) {
    for (const end = Date.now() + timeout; ;) {
      if (await this.eval(fn, ...args)) return;
      if (Date.now() > end) throw new Error(`timed out waiting for: ${fn}`);
      await sleep(50);
    }
  }
  // the page's modules, as the app loaded them (the same instances: imports inside src/ carry no ?v=)
  mod(path) { return `import(${JSON.stringify('/' + path)})`; }
  async box(sel) {
    const b = await this.eval(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    if (!b) throw new Error(`no element ${sel}`);
    return b;
  }
  mouse(type, x, y, buttons = 0) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left', buttons, clickCount: 1 });
  }
  async click(sel) {
    const b = await this.box(sel), x = b.x + b.w / 2, y = b.y + b.h / 2;
    await this.mouse('mouseMoved', x, y); await this.mouse('mousePressed', x, y, 1); await this.mouse('mouseReleased', x, y);
  }
  // press at (x0, y0), move to (x1, y1) in steps, release unless release: false (a release that never comes)
  async drag(x0, y0, x1, y1, { steps = 6, release = true } = {}) {
    await this.mouse('mouseMoved', x0, y0); await this.mouse('mousePressed', x0, y0, 1);
    for (let i = 1; i <= steps; i++) await this.mouse('mouseMoved', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, 1);
    if (release) await this.mouse('mouseReleased', x1, y1);
  }
  // 'Mod+Shift+KeyZ': Mod is sent as Ctrl, which the app takes for ⌘ too
  async key(name) {
    const parts = name.split('+'), code = parts.pop(), mods = parts.reduce((m, p) => m | ({ Mod: MOD.ctrl, Shift: MOD.shift, Alt: MOD.alt }[p] ?? 0), 0);
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : { Space: ' ', Escape: 'Escape', Enter: 'Enter' }[code] ?? code;
    for (const type of ['rawKeyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, code, key, modifiers: mods, windowsVirtualKeyCode: 0 });
  }
  async setFiles(sel, files) {
    const { root } = await this.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await this.send('DOM.setFileInputFiles', { nodeId, files });
  }
  // a PNG of clip ({ x, y, width, height } in CSS pixels), at the page's scale
  async shot(clip) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    return Buffer.from(data, 'base64');
  }
  close() { return this.conn.send('Target.closeTarget', { targetId: this.targetId }); }
}
export const sleep = ms => new Promise(ok => setTimeout(ok, ms));
