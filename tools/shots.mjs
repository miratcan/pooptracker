// The manual's pictures (docs/manual/*.png), made from the app itself: each one opens the app in a headless Chrome
// (test/browser.js), brings it to the state the manual shows, draws the numbers its table uses and takes the picture
// at twice the size (the pixel fonts stay sharp). A number's place is an element or a rectangle on the page, so the
// pictures follow the app when it changes.
//   npm run shots                                   the demo song, test/fixtures/av.mp4 on the workbench
//   npm run shots -- --song my.poop --video long.mp4 your own song and video (they look better)
//   npm run shots -- --only header,bench --out /tmp only these, somewhere else
import { writeFileSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { Browser, FIXTURES, chromePath, sleep } from '../test/browser.js';

const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = resolve(arg('out') ?? new URL('../docs/manual', import.meta.url).pathname);
const SONG = arg('song') && resolve(arg('song')), VIDEO = resolve(arg('video') ?? join(FIXTURES, 'av.mp4'));
const ONLY = arg('only')?.split(',');
if (!chromePath) { console.error('No Chrome found (set CHROME=<path>).'); process.exit(1); }

// ── in the page: where things are, and the numbers drawn over them
// a place: a CSS selector, 'legend:Sample' (the fieldset with that name), or { in: selector, x, y, w, h } (a rectangle
// inside that element, e.g. a column of the pattern canvas)
function rectOf(place) {
  if (typeof place === 'object') {
    const r = document.querySelector(place.in).getBoundingClientRect();
    return { left: r.left + place.x, top: r.top + place.y, width: place.w, height: place.h };
  }
  const el = place.startsWith('legend:')
    ? [...document.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent.trim().toLowerCase() === place.slice(7).toLowerCase())
    : document.querySelector(place);
  if (!el) throw new Error(`no ${place}`);
  return el.getBoundingClientRect();
}
// marks: [{ n, at, side: 'top' | 'bottom' | 'left' | 'right' | 'inside' | 'legend' (after a fieldset's name) | 'tl' | 'tr' |
// 'bl' | 'br' (inside that corner), box }]
function drawMarks(marks, rectOfSrc) {
  const rectOf = eval(`(${rectOfSrc})`), PINK = '#ff2d78';
  const layer = document.createElement('div');
  layer.id = 'shotMarks'; layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99';
  for (const m of marks) {
    const R = 13, gap = 4;
    const r = m.side === 'legend'
      ? (() => { const f = [...document.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent.trim().toLowerCase() === m.at.slice(7).toLowerCase());
                 const l = f.querySelector('legend').getBoundingClientRect(); return { left: l.right + gap, top: l.top, width: 2 * R, height: l.height }; })()
      : rectOf(m.at);
    if (m.box) {
      const b = document.createElement('div');
      b.style.cssText = `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border:3px solid ${PINK};border-radius:6px;box-sizing:border-box`;
      layer.append(b);
    }
    const side = m.side === 'legend' ? 'inside' : m.side ?? 'top', inL = r.left + R + 8, inR = r.left + r.width - R - 8, inT = r.top + R + 8, inB = r.top + r.height - R - 8;
    const cx = { left: r.left - R - gap, right: r.left + r.width + R + gap, tl: inL, bl: inL, tr: inR, br: inR }[side] ?? r.left + r.width / 2;
    const cy = { top: r.top - R - gap, bottom: r.top + r.height + R + gap, tl: inT, tr: inT, bl: inB, br: inB }[side] ?? r.top + r.height / 2;
    const c = document.createElement('div');
    c.textContent = m.n;
    c.style.cssText = `position:fixed;left:${cx - R}px;top:${cy - R}px;width:${2 * R}px;height:${2 * R}px;border-radius:50%;background:#fff;
      border:3px solid ${PINK};box-sizing:border-box;color:${PINK};font:bold 15px/20px system-ui,sans-serif;text-align:center`;
    layer.append(c);
  }
  document.body.append(layer);
}
// room for numbers: strips in the panel's colour, [selector, 'before' | 'after' | 'prepend' | 'append', px] (the layout
// gives way to them); and no ladybug in the pictures
function makeRoom(spaces) {
  document.querySelector('#bug')?.remove();
  for (const [sel, where, h] of spaces) {
    const d = document.createElement('div');
    d.className = 'shotRoom'; d.style.cssText = `height:${h}px;flex:none;background:var(--panel)`;
    document.querySelector(sel)[where](d);
  }
}
// the union of some places, with room around it (the picture's frame)
function clipOf(places, pad, rectOfSrc) {
  const rectOf = eval(`(${rectOfSrc})`), rs = places.map(rectOf);
  const x0 = Math.max(0, Math.min(...rs.map(r => r.left)) - pad), y0 = Math.max(0, Math.min(...rs.map(r => r.top)) - pad);
  const x1 = Math.min(innerWidth, Math.max(...rs.map(r => r.left + r.width)) + pad), y1 = Math.min(innerHeight, Math.max(...rs.map(r => r.top + r.height)) + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ── helpers that bring the app to a state
const setVal = (page, sel, v) => page.eval((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('change')); }, sel, v);
async function onBench(page, t0, t1) {
  await page.click('#bScreenBench');
  await page.setFiles('#bFile', [VIDEO]);
  await page.waitFor(() => /·/.test(document.querySelector('#bName').textContent), 20000);
  for (const [t, key] of [[t0, 'KeyI'], [t1, 'KeyO']]) {
    await page.eval(t => new Promise(ok => { const v = document.querySelector('#bVideo'); v.onseeked = ok; v.currentTime = t; }), t);
    await page.key(key);
  }
  await sleep(1500); // the waveform
}
// a rectangle inside the pattern canvas: rows and character columns as the editor lays them out (8 px characters)
const CW = 8, RH = 16, HDR = 22, X0 = 8 + 3 * CW, CHW = 14 * CW;
const patTop = page => page.eval(async () => { const { ed } = await import('/src/ui/common.js'); return ed.row - Math.floor(Math.max(5, Math.floor((document.querySelector('#patBox').clientHeight - 22) / 16)) / 2); });
const patCell = (top, row, ch, col, w) => ({ in: '#pat', x: X0 + ch * CHW + col * CW, y: HDR + (row - top) * RH, w: w * CW, h: RH });
// the x of video time t on the instrument's waveform (it shows the whole video)
const waveX = page => page.eval(async () => {
  const { instruments } = await import('/src/core/song.js'), { ed } = await import('/src/ui/common.js'), I = instruments[ed.inst];
  return { start: I.start / I.video.dur, hit: I.hit / I.video.dur };
});

// the strips each picture needs for its numbers
const SPACE = { header: [['header', 'after', 34]], statusbar: [['#statusBar', 'before', 34]], pattern: [['#patCol', 'prepend', 30]],
  bench: [['#bench', 'append', 34]], order: [['#ordCol', 'append', 34]], instrument: [['#instPanel', 'before', 30]] };
// ── the pictures: setup(page) → { clip: [places], pad, marks }
const SHOTS = {
  hero: async page => { await page.click('#bSong'); await sleep(1200); return { clip: ['body'], pad: 0, marks: [], after: () => page.click('#bStop') }; },
  overview: async () => ({ clip: ['body'], pad: 0, marks: [
    { n: 1, at: 'header', side: 'br' }, { n: 2, at: '#ordCol', side: 'bl' }, { n: 3, at: '#patCol', side: 'br' }, { n: 4, at: '#instCard', side: 'tr' },
    { n: 5, at: '#instEd', side: 'br' }, { n: 6, at: '#outCard', side: 'br' }, { n: 7, at: { in: '#statusBar', x: 760, y: 0, w: 30, h: 26 }, side: 'inside' }].map(m => ({ ...m, box: true })) }),
  header: async () => ({ clip: ['header', 'header + .shotRoom'], pad: 0, marks: [
    '#bNew', '#bOpen', '#bSave', '#tTitle', '#bSong', '#bPat', '#bStop', '#bRec', '#tBpm', '#tSpd', '#tOct', '#tStep', '#tFollow', '#bScreenPat', '#bScreenBench']
    .map((at, i) => ({ n: i + 1, at, side: 'bottom' })) }),
  pattern: async page => {
    await page.click('#pat'); await page.key('Space'); // edit mode: the red frame
    // the cursor (the click put it somewhere) half a screen down, so the rows start at the top
    await page.eval(async () => { const { ed, view } = await import('/src/ui/common.js'); ed.row = Math.floor(Math.max(5, Math.floor((document.querySelector('#patBox').clientHeight - 22) / 16)) / 2); ed.ch = 1; view.patDirty = true; });
    await sleep(200);
    const top = await patTop(page), box = await page.box('#patBox');
    return { clip: ['#patCol'], pad: 0, marks: [
      { n: 1, at: '#pNum', side: 'top' }, { n: 2, at: '#pNew', side: 'top' }, { n: 3, at: '#pLen', side: 'top' }, { n: 4, at: '#cAdd', side: 'top' },
      { n: 5, at: { in: '#pat', x: X0 + 3 * CHW - 22, y: 0, w: 10, h: HDR }, side: 'inside' },
      { n: 6, at: { in: '#pat', x: 8, y: HDR + (16.4 - top) * RH, w: 2 * CW, h: RH }, side: 'inside' },
      { n: 7, at: patCell(top, 10, 2, 0, 3), side: 'bottom' }, { n: 8, at: patCell(top, 10, 2, 4, 2), side: 'top' },
      { n: 9, at: patCell(top, 10, 2, 7, 2), side: 'bottom' }, { n: 10, at: patCell(top, 10, 2, 10, 3), side: 'top' },
      { n: 11, at: { in: '#pat', x: X0 + 3 * CHW + 40, y: HDR + (12 - top) * RH, w: 8, h: RH }, side: 'inside' },
      { n: 12, at: { in: '#patBox', x: box.w - 2, y: 60, w: 4, h: 30 }, side: 'left' }],
      after: () => page.key('Space') };
  },
  mute: async page => {
    const b = await page.box('#out'); await page.mouse('mouseMoved', b.x + b.w * 0.75, b.y + b.h * 0.75);
    await page.mouse('mousePressed', b.x + b.w * 0.75, b.y + b.h * 0.75, 1); await page.mouse('mouseReleased', b.x + b.w * 0.75, b.y + b.h * 0.75);
    await sleep(200);
    return { clip: ['body'], pad: 0, marks: [] };
  },
  order: async page => {
    await page.eval(async () => { const C = await import('/src/core/commands.js'); C.exec(() => C.setOrder([0, 0, 0, 0], 'shots')); });
    await sleep(100);
    return { clip: ['#ordCol'], pad: 2, marks: [
      { n: 1, at: { in: '#ordList > *:nth-child(2)', x: 60, y: 0, w: 30, h: 20 }, side: 'inside' }, ...['#oAdd', '#oDel', '#oUp', '#oDown', '#oPrev', '#oNext'].map((at, i) => ({ n: i + 2, at, side: i < 4 ? 'top' : 'bottom' }))] };
  },
  instrument: async page => {
    const w = await page.box('#wave'), x = await waveX(page), row = await page.box('#instList .inst.sel');
    return { clip: ['#instPanel', '.shotRoom'], pad: 0, marks: [
      { n: 1, at: { in: '#instList .inst.sel', x: row.w - 40, y: 0, w: 30, h: row.h }, side: 'inside' }, { n: 2, at: '#iNew', side: 'top' }, { n: 3, at: '#bLoad', side: 'top' }, { n: 4, at: '#bVidSave', side: 'top' },
      { n: 5, at: '#bSplit', side: 'top' }, { n: 6, at: '#iDel', side: 'right' }, { n: 7, at: '#bHitPlay', side: 'top' }, { n: 8, at: '#bFull', side: 'top' },
      { n: 9, at: '#bSync', side: 'top' }, ...['Sample', 'Region', 'Hit', 'Loop', 'Env.'].map((l, i) => ({ n: 10 + i, at: `legend:${l}`, side: 'legend' })),
      { n: 15, at: { in: '#wave', x: x.start * w.w, y: 0, w: 2, h: 8 }, side: 'left' }, { n: 16, at: { in: '#wave', x: x.hit * w.w, y: 80, w: 2, h: 20 }, side: 'right' },
      { n: 17, at: { in: '#wave', x: (x.start * w.w + x.hit * w.w) / 2, y: 95, w: 2, h: 20 }, side: 'inside' },
      { n: 18, at: { in: '#wave', x: w.w * 0.7, y: 10, w: 2, h: 30 }, side: 'inside' }, { n: 19, at: '#framePrev', side: 'inside' },
      { n: 20, at: 'legend:Source', side: 'legend' }, { n: 21, at: 'legend:Tags', side: 'legend' }] };
  },
  // channel 1 plays with G21, as the manual says: its tile covers the top row. The label and the hit flash are drawn on
  // the canvas, so they are pointed at by place, in tile 3 (bottom left)
  output: async page => {
    await page.eval(async () => {
      const C = await import('/src/core/commands.js'), { FX } = await import('/src/util.js'), { song } = await import('/src/core/song.js');
      const P = song.order[0], rows = song.patterns[P].rows.length;
      C.exec(() => C.setCells(Array.from({ length: rows }, (_, row) => ({ pat: P, row, ch: 0, ...(row ? {} : { n: 48, i: 1 }), f: FX.G, p: 0x21 })), 'shots'));
    });
    await page.click('#bSong'); await sleep(900);
    const o = await page.box('#out'), tw = o.w / 2, th = o.h / 2;
    return { clip: ['#outCard'], pad: 0, after: () => page.click('#bStop'), marks: [
      { n: 1, at: { in: '#out', x: tw / 2, y: th * 1.5, w: 1, h: 1 }, side: 'inside' }, { n: 2, at: { in: '#out', x: 6, y: 2 * th - 14, w: 60, h: 12 }, side: 'top' },
      { n: 3, at: { in: '#out', x: tw - 3, y: th * 1.3, w: 3, h: 3 }, side: 'left' }, { n: 4, at: '#stats', side: 'top' },
      { n: 5, at: { in: '#out', x: tw, y: th / 2, w: 1, h: 1 }, side: 'inside' }] };
  },
  bench: async page => {
    await onBench(page, 1, 3);
    const t = await page.box('#bTime'), D = await page.eval(() => document.querySelector('#bVideo').duration);
    return { clip: ['#bench', '#bench .shotRoom'], pad: 0, marks: [
      { n: 1, at: '#bBenchLoad', side: 'bottom' }, { n: 2, at: '#bName', side: 'bottom' }, { n: 3, at: '#bTrim', side: 'bottom' }, { n: 4, at: '#bClear', side: 'bottom' },
      { n: 5, at: '#bView', side: 'inside' }, { n: 6, at: { in: '#bTime', x: 2 / D * t.w, y: 0, w: 1, h: 1 }, side: 'top' },
      { n: 7, at: { in: '#bTime', x: t.w * 0.75, y: t.h / 2, w: 1, h: 1 }, side: 'inside' }, { n: 8, at: { in: '#bSel', x: 0, y: 0, w: 200, h: 20 }, side: 'bottom' },
      { n: 9, at: '#bStopSel', side: 'bottom' }, { n: 10, at: '#bCut', side: 'bottom' }, { n: 11, at: '#bCutRepl', side: 'bottom' }] };
  },
  'bench-cut': async page => {
    await onBench(page, 1, 2);
    await page.click('#bCut');
    await page.waitFor(() => /→ instrument/.test(document.querySelector('#status').textContent), 20000);
    await sleep(500);
    return { clip: ['#instPanel'], pad: 0, marks: [] };
  },
  statusbar: async page => {
    await page.eval(() => { document.querySelector('#status').textContent = 'Ready: Enter plays, Space stops / turns on edit mode, the note keys jam.'; });
    return { clip: ['#statusBar', '.shotRoom'], pad: 0, marks: [{ n: 1, at: { in: '#status', x: 0, y: 0, w: 120, h: 20 }, side: 'top' }, ...['#manLink', '#bKeys', '#mcpState', '#ghLink'].map((at, i) => ({ n: i + 2, at, side: 'top' }))] };
  },
};

const browser = await Browser.launch();
try {
  for (const [name, setup] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const page = await browser.app({ scale: 2 });
    if (SONG) {
      await page.eval(async (data, name) => {
        const { openSong } = await import('/src/ui/files.js');
        await openSong(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], name));
      }, readFileSync(SONG).toString('base64'), basename(SONG));
      await page.waitFor(() => /opened/i.test(document.querySelector('#status').textContent), 60000);
    }
    await page.eval(makeRoom, SPACE[name] ?? []); await sleep(150);
    const s = await setup(page);
    await page.eval(drawMarks, s.marks, rectOf.toString());
    const clip = await page.eval(clipOf, s.clip, s.pad, rectOf.toString());
    writeFileSync(join(OUT, `${name}.png`), await page.shot(clip));
    await s.after?.();
    if (page.errors.length) console.warn(`${name}: errors in the page:\n${page.errors.join('\n')}`);
    console.log(`${name}.png`);
    await page.close();
  }
} finally { await browser.close(); }
