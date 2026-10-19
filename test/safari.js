// The same browser tests in Safari (the engine of the Mac app's WKWebView), over safaridriver: W3C WebDriver, plain
// HTTP, no package. Pages have the API of browser.js's Page; what only CDP can do (send) isn't there.
// Run with BROWSER=safari; Safari needs Develop → Allow Remote Automation once.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { createServer } from 'node:net';
import { serve, ROOT, Page, sleep } from './browser.js';

export const safariPath = existsSync('/usr/bin/safaridriver') ? '/usr/bin/safaridriver' : null;
const freePort = () => new Promise(ok => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); });

export class SafariBrowser {
  static async launch() {
    const server = await serve(), port = await freePort();
    const proc = spawn(safariPath, ['-p', String(port)], { stdio: 'ignore' });
    const b = Object.assign(new SafariBrowser(), { server, proc, wd: `http://127.0.0.1:${port}`, base: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; ; i++) {
      try { await b.newSession(); break; } catch (e) { if (i > 40) throw e; await sleep(100); }
    }
    return b;
  }
  // a fresh Safari for every test: one page after another in the same one runs into Safari's limit on audio contexts
  // (the old pages' aren't freed at once), and then sound quietly fails to decode
  async newSession() {
    if (this.session) await this.call('DELETE', `/session/${this.session}`).catch(() => {});
    this.session = (await this.call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
    await this.call('POST', `/session/${this.session}/timeouts`, { script: 60000 });
    await this.call('POST', `/session/${this.session}/window/rect`, { width: 1400, height: 1000 });
  }
  async call(method, path, body) {
    const r = await fetch(this.wd + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`WebDriver ${method} ${path}: ${j.value?.error}: ${j.value?.message}`);
    return j.value;
  }
  // one window, loaded afresh for each test; the "read the manual?" question answered before the app asks it
  async app({ before } = {}) {
    if (before) throw new Error('before() needs CDP (Chrome)');
    if (this.used) await this.newSession();
    this.used = true;
    const page = new SafariPage(this);
    await this.call('POST', `/session/${this.session}/url`, { url: this.base + 'blank' }); // the app's origin, before the app
    await page.eval(() => { try { localStorage.setItem('pooptracker.manualAsked', '1'); } catch {} });
    await this.call('POST', `/session/${this.session}/url`, { url: this.base + 'index.html?mcp=9' });
    await page.waitFor(() => document.querySelectorAll('#instList .inst').length > 0, 15000);
    return page;
  }
  async close() {
    try { await this.call('DELETE', `/session/${this.session}`); } catch {}
    this.proc.kill(); this.server.close();
  }
}

const KEYS = { Mod: '\uE009', Shift: '\uE008', Alt: '\uE00A', Space: ' ', Escape: '\uE00C', Enter: '\uE007' };
class SafariPage extends Page {
  constructor(b) { super({ handlers: new Set() }); Object.assign(this, { b, s: `/session/${b.session}`, errors: [] }); }
  send() { throw new Error('this test needs CDP (Chrome)'); }
  async eval(fn, ...args) {
    const r = await this.b.call('POST', `${this.s}/execute/async`, { args: [], script:
      `const done = arguments[arguments.length - 1]; Promise.resolve().then(() => (${fn})(...${JSON.stringify(args)}))
        .then(v => done({ v }), e => done({ e: String(e && e.stack || e) }));` });
    if (r && 'e' in r) throw new Error(`in the page: ${r.e}`);
    return r?.v;
  }
  // the errors the page caught (window.__errors, from browser.js's server)
  async collectErrors() { this.errors = await this.eval(() => window.__errors || []).catch(e => [String(e)]); }
  // a click is WebDriver's own Element Click: Safari's synthesized pointer actions drop clicks now and then
  async click(sel) {
    const el = await this.b.call('POST', `${this.s}/element`, { using: 'css selector', value: sel });
    await this.b.call('POST', `${this.s}/element/${Object.values(el)[0]}/click`, {});
  }
  actions(...list) { return this.b.call('POST', `${this.s}/actions`, { actions: list }); }
  mouse(type, x, y) {
    const move = { type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport', duration: 0 };
    const act = type === 'mouseMoved' ? [move] : [move, { type: type === 'mousePressed' ? 'pointerDown' : 'pointerUp', button: 0 }];
    return this.actions({ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: act });
  }
  // a drag is one action sequence (press, moves, release) with time between the steps: split into separate calls,
  // Safari doesn't deliver it at all
  async drag(x0, y0, x1, y1, { steps = 6, release = true } = {}) {
    const at = (x, y, duration = 30) => ({ type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport', duration });
    await this.actions({ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [at(x0, y0, 0), { type: 'pointerDown', button: 0 },
      ...Array.from({ length: steps }, (_, i) => at(x0 + (x1 - x0) * (i + 1) / steps, y0 + (y1 - y0) * (i + 1) / steps)),
      ...(release ? [{ type: 'pointerUp', button: 0 }] : [])] });
  }
  async key(name) {
    const parts = name.split('+'), code = parts.pop(), mods = parts.map(p => KEYS[p]);
    const key = KEYS[code] ?? (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : code);
    await this.actions({ type: 'key', id: 'keyboard', actions: [...mods.map(value => ({ type: 'keyDown', value })), { type: 'keyDown', value: key },
      { type: 'keyUp', value: key }, ...mods.reverse().map(value => ({ type: 'keyUp', value }))] });
  }
  // safaridriver can't type a path into a file input: the page fetches the file from the test server and hands it over
  async setFiles(sel, files) {
    await this.eval(async (sel, urls) => {
      const dt = new DataTransfer();
      for (const u of urls) dt.items.add(new File([await (await fetch(u)).blob()], u.split('/').pop()));
      const input = document.querySelector(sel); input.files = dt.files; input.dispatchEvent(new Event('change'));
    }, sel, files.map(f => '/' + relative(ROOT, f).split('\\').join('/')));
  }
  close() {}
}
