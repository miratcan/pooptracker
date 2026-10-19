// The app in a real browser: what only shows on the page. Each test opens the app afresh with the demo song.
// Chrome (headless, over CDP: browser.js) by default; BROWSER=safari runs them in Safari (safari.js), the engine of
// the Mac app. Skipped when that browser isn't there; the tests that need CDP are skipped in Safari.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Browser as Chrome, FIXTURES, chromePath, sleep } from './browser.js';
import { SafariBrowser, safariPath } from './safari.js';

const SAFARI = process.env.BROWSER === 'safari', Browser = SAFARI ? SafariBrowser : Chrome;
const skip = SAFARI ? !safariPath && 'no safaridriver' : !chromePath && 'no Chrome found (set CHROME=<path>)';
const cdp = skip || (SAFARI && 'needs CDP (Chrome)');
const SLOW = SAFARI ? 30000 : 8000; // Safari decodes a video's frames (seek by seek) several times slower
let browser;
before(async () => { if (!skip) browser = await Browser.launch(); });
after(async () => { await browser?.close(); });

// a fresh tab; the page's errors fail the test
async function app(t, opts) {
  const page = await browser.app(opts);
  t.after(async () => { await page.collectErrors?.(); const errors = page.errors.slice(); await page.close(); assert.deepEqual(errors, [], 'errors in the page'); });
  return page;
}
const isDown = (page, sel) => page.eval(s => document.querySelector(s).classList.contains('down'), sel);
const text = (page, sel) => page.eval(s => document.querySelector(s).textContent, sel);
const val = (page, sel) => page.eval(s => document.querySelector(s).value, sel);
const instNames = page => page.eval(() => [...document.querySelectorAll('#instList .inst')].map(e => e.textContent.trim()));
const video = (page, prop) => page.eval(p => document.querySelector('#bVideo')[p], prop);

// the bench with the fixture (6 s, a 440 Hz tone) on it
async function onBench(page) {
  await page.click('#bScreenBench');
  await page.setFiles('#bFile', [`${FIXTURES}/av.mp4`]);
  await page.waitFor(() => /0:06/.test(document.querySelector('#bName').textContent), 10000);
}
// mark [t0, t1] with I and O
async function mark(page, t0, t1) {
  for (const [t, key] of [[t0, 'KeyI'], [t1, 'KeyO']]) {
    await page.eval(t => new Promise(ok => { const v = document.querySelector('#bVideo'); v.onseeked = ok; v.currentTime = t; }), t);
    await page.key(key);
  }
}
// the selected instrument gets the fixture (Load); done when the status says so ("Loading: av.mp4" comes first)
async function loadFixture(page) {
  await page.setFiles('#file', [`${FIXTURES}/av.mp4`]);
  await page.waitFor(() => /video → av\.mp4/.test(document.querySelector('#status').textContent), 15000);
}

test('the pattern is measured in the DOS font, even when the font arrives late', { skip: cdp }, async t => {
  const page = await app(t, { before: p => p.delay('*.ttf', 600) });
  await page.eval(() => document.fonts.ready);
  await page.waitFor(() => document.fonts.check('16px dos'), 5000);
  await sleep(100);
  // 4 channels of 14 characters, 3 for the row numbers, 8 px each (IBM VGA 8x16): 8 + 24 + 448 + 4
  assert.equal(await page.eval(() => document.querySelector('#pat').style.width), '484px');
});

test('transport: ▶ Song stays down while it plays, Stop lets it up; the open screen\'s key stays down', { skip }, async t => {
  const page = await app(t);
  assert.ok(await isDown(page, '#bScreenPat'));
  await page.click('#bSong');
  await page.waitFor(() => document.querySelector('#bSong').classList.contains('down'));
  assert.ok(!await isDown(page, '#bPat'));
  await page.click('#bStop');
  await page.waitFor(() => !document.querySelector('#bSong').classList.contains('down'));
  await page.click('#bScreenBench');
  assert.deepEqual([await isDown(page, '#bScreenBench'), await isDown(page, '#bScreenPat')], [true, false]);
});

test('bench: dragging on the timeline marks a piece; a drag whose release was lost doesn\'t go on dragging', { skip }, async t => {
  const page = await app(t);
  await onBench(page);
  const b = await page.box('#bTime'), y = b.y + b.h / 2, x = f => b.x + b.w * f;
  await page.drag(x(0.2), y, x(0.4), y);
  assert.match(await text(page, '#bSel'), /^0:01\.\d+ – 0:02\.\d+/);
  if (SAFARI) return; // WebDriver keeps the button down between its actions: a release that never came can't be made there
  // a drag on the start's handle whose release never comes, then the pointer moves with no button down
  await page.drag(x(0.2), y, x(0.25), y, { release: false });
  const after = await text(page, '#bSel');
  await page.mouse('mouseMoved', x(0.7), y); await page.mouse('mouseMoved', x(0.8), y);
  assert.equal(await text(page, '#bSel'), after);
  await page.mouse('mouseReleased', x(0.8), y);
  await page.drag(x(0.5), y, x(0.6), y);
  assert.match(await text(page, '#bSel'), /^0:0[23]\.\d+ – 0:03\.\d+/); // a new piece from about 3 s
});

test('bench: ▶ Piece stays down while the piece plays, up at its end and after Stop', { skip }, async t => {
  const page = await app(t);
  await onBench(page);
  await mark(page, 1, 1.5);
  await page.click('#bPlaySel');
  assert.ok(await isDown(page, '#bPlaySel'));
  await page.waitFor(() => document.querySelector('#bVideo').paused, 3000);
  assert.ok(!await isDown(page, '#bPlaySel'));
  assert.ok(Math.abs(await video(page, 'currentTime') - 1.5) < 0.1); // stopped at the piece's end
  await page.click('#bPlaySel'); await sleep(200);
  await page.click('#bStopSel');
  await page.waitFor(() => !document.querySelector('#bPlaySel').classList.contains('down')); // the pause event comes after
  assert.ok(await video(page, 'paused'));
});

test('bench: with Loop down the piece plays again and again; letting Loop go ends it after this turn', { skip }, async t => {
  const page = await app(t);
  await onBench(page);
  await mark(page, 2, 2.6);
  await page.click('#bLoopSel');
  assert.ok(await isDown(page, '#bLoopSel'));
  await page.click('#bPlaySel');
  await page.waitFor(() => !document.querySelector('#bVideo').paused, 3000);
  const times = [];
  for (let i = 0; i < 16; i++) { await sleep(100); times.push(await video(page, 'currentTime')); }
  assert.ok(times.every(x => x > 1.9 && x < 2.75), `stays in the piece: ${times}`);
  assert.ok(times.some((x, i) => i && x < times[i - 1]), `goes back to the start: ${times}`);
  await page.click('#bLoopSel');
  await page.waitFor(() => document.querySelector('#bVideo').paused, 3000);
  assert.ok(!await isDown(page, '#bPlaySel'));
});

test('bench: Trim keeps only the piece, marked; Ctrl+Z brings back the whole video and its marks', { skip }, async t => {
  const page = await app(t);
  await onBench(page);
  await mark(page, 1, 3);
  await page.click('#bTrim');
  await page.waitFor(() => /0:02\.000/.test(document.querySelector('#bName').textContent), 8000);
  assert.match(await text(page, '#bSel'), /^0:00\.000 – 0:02\.000/);
  await page.key('Mod+KeyZ');
  await page.waitFor(() => /av\.mp4 · 0:06/.test(document.querySelector('#bName').textContent), 8000);
  assert.match(await text(page, '#bSel'), /^0:01\.000 – 0:03\.000/);
  await page.key('Mod+Shift+KeyZ');
  await page.waitFor(() => /0:02\.000/.test(document.querySelector('#bName').textContent), 8000);
});

test('instruments: New adds an empty one; Load gives the selected one a video and keeps how it sounds', { skip }, async t => {
  const page = await app(t);
  await page.click('#instList .inst:nth-child(2)');
  await page.eval(() => { const e = document.querySelector('#iVol'); e.value = '20'; e.dispatchEvent(new Event('change')); });
  await loadFixture(page);
  assert.deepEqual(await instNames(page), ['01 Kick', '02 Snare', '03 HiHat']);
  assert.equal(await val(page, '#iVol'), '20');
  await page.click('#iNew');
  await page.waitFor(() => document.querySelectorAll('#instList .inst').length === 4, SLOW);
  assert.equal((await instNames(page))[3], '04 empty');
  await page.key('Mod+KeyZ');
  await page.waitFor(() => document.querySelectorAll('#instList .inst').length === 3);
});

test('instruments: a video saved with Save brings all its settings, the loop mode too', { skip }, async t => {
  const page = await app(t);
  await loadFixture(page);
  await page.eval(() => { const e = document.querySelector('#iLoop'); e.value = 'forward'; e.dispatchEvent(new Event('change')); });
  await page.click('#bTune');
  const saved = [await val(page, '#iBase'), await val(page, '#iFine'), await val(page, '#iLoop')];
  // the saved video goes into a new, empty instrument
  await page.eval(async () => {
    const io = await import('/src/io.js'), { instruments } = await import('/src/core/song.js'), { ed } = await import('/src/ui/common.js');
    window.savedVideo = await io.instrumentVideo(instruments[ed.inst]);
  });
  await page.click('#iNew');
  await page.waitFor(() => document.querySelectorAll('#instList .inst').length === 4, SLOW);
  await page.eval(() => {
    const dt = new DataTransfer(), input = document.querySelector('#file');
    dt.items.add(new File([window.savedVideo], 'saved.mp4', { type: 'video/mp4' })); input.files = dt.files; input.dispatchEvent(new Event('change'));
  });
  await page.waitFor(() => /video → saved\.mp4/.test(document.querySelector('#status').textContent), 15000);
  assert.deepEqual([await val(page, '#iBase'), await val(page, '#iFine'), await val(page, '#iLoop')], saved);
  assert.deepEqual(saved, ['A-4', '0', 'forward']);
});

test('instruments: Tune finds A-4 in a 440 Hz clip; Fit makes its region last a power of two rows at C-4', { skip }, async t => {
  const page = await app(t);
  await loadFixture(page);
  await page.click('#bTune');
  assert.deepEqual([await val(page, '#iBase'), await val(page, '#iFine')], ['A-4', '0']);
  await page.click('#bFit');
  const rows = await page.eval(async () => {
    const { instruments, song } = await import('/src/core/song.js'), { rateFor } = await import('/src/core/instrument.js'), { ed } = await import('/src/ui/common.js');
    const I = instruments[ed.inst]; return (I.end - I.start) / rateFor(I, 48) / (song.speed * 2.5 / song.bpm);
  });
  assert.ok(Math.abs(rows - 64) < 0.02, `${rows} rows`); // 6 s at 125 BPM, speed 6: 50 rows now, 64 the nearest power of two
  await page.key('Mod+KeyZ');
  assert.equal(await val(page, '#iBase'), 'A-4');
});

test('instruments: Trim cuts the video down to the region, the hit moving with it; Ctrl+Z brings it back', { skip }, async t => {
  const page = await app(t);
  await loadFixture(page);
  for (const [sel, v] of [['#iHit', '2.5'], ['#iStart', '2'], ['#iEnd', '4.5']])
    await page.eval((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('change')); }, sel, v);
  await page.click('#bTrimInst');
  await page.waitFor(() => /trimmed to its region/.test(document.querySelector('#status').textContent), 15000);
  assert.deepEqual([await val(page, '#iStart'), await val(page, '#iEnd'), await val(page, '#iHit')], ['0.000', '2.500', '0.500']);
  await page.key('Mod+KeyZ');
  assert.deepEqual([await val(page, '#iStart'), await val(page, '#iEnd'), await val(page, '#iHit')], ['2.000', '4.500', '2.500']);
});

test('resizing the window: no ResizeObserver loop, and the output still fits its box at 9:16', { skip: cdp }, async t => {
  const page = await app(t);
  await page.eval(() => { window.loopErrors = []; addEventListener('error', e => window.loopErrors.push(e.message)); });
  for (const [width, height] of [[1200, 800], [900, 700], [1600, 1000], [1000, 600], [1400, 900]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(250);
  }
  assert.deepEqual(await page.eval(() => window.loopErrors), []);
  const [w, h, boxH] = await page.eval(() => [document.querySelector('#out').clientWidth, document.querySelector('#out').clientHeight, document.querySelector('#outBox').clientHeight]);
  assert.equal(h, boxH);
  assert.ok(Math.abs(w / h - 9 / 16) < 0.01, `${w}×${h}`);
});

test('a piece cut on the workbench sounds exactly from the cut, to the sample, as the whole video does', { skip }, async t => {
  // click.mp4 clicks at exactly 2.000 s; Safari needs the sound's sample groups in the piece to get this right
  const page = await app(t);
  const at = await page.eval(async () => {
    const { cutVideo, reader } = await import('/src/mp4cut.js'), { ctx } = await import('/src/engine/audio.js');
    const file = new File([await (await fetch('/test/fixtures/click.mp4')).arrayBuffer()], 'click.mp4'), out = [];
    for (const t0 of [1.5, 1.97, 0.9]) {
      const buf = await ctx.decodeAudioData((await cutVideo(reader(file), file.size, t0, t0 + 1.5)).bytes.buffer), d = buf.getChannelData(0);
      let i = 0; while (i < d.length && Math.abs(d[i]) < 0.3) i++;
      out.push(+(i / buf.sampleRate - (2 - t0)).toFixed(4));
    }
    return out;
  });
  assert.deepEqual(at, [0, 0, 0], 'how far the click is from where it belongs, in seconds');
});

test('a video whose sound this browser can\'t read says so: on the bench at once, and when it becomes an instrument', { skip }, async t => {
  // vp8.webm has no sound at all; Safari can't read the Opus in WebM pieces either, and gets the same words
  const page = await app(t);
  await page.setFiles('#file', [`${FIXTURES}/vp8.webm`]);
  await page.waitFor(() => /video → vp8\.webm/.test(document.querySelector('#status').textContent), SLOW);
  assert.match(await text(page, '#status'), /no sound: the video has none this browser can read/);
  await page.click('#bScreenBench');
  await page.setFiles('#bFile', [`${FIXTURES}/vp8.webm`]);
  await page.waitFor(() => /can't read the sound of vp8\.webm/.test(document.querySelector('#status').textContent), SLOW);
});
