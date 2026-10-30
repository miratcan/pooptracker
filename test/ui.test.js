// The app in a real browser: what only shows on the page. Each test opens the app afresh with the demo song.
// Chrome (headless, over CDP: browser.js) by default; BROWSER=safari runs them in Safari (safari.js), the engine of
// the Mac app. Skipped when that browser isn't there; the tests that need CDP are skipped in Safari.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// Zap asks what to empty: all, tracks or instruments
// (the dialog's close event comes a task later: wait for the status it sets)
const zap = async (page, what) => {
  await page.click('#bNew');
  await page.eval(() => { document.querySelector('#status').textContent = ''; });
  await page.click(`#zapDlg button[value="${what}"]`);
  await page.waitFor(() => /^Zapped/.test(document.querySelector('#status').textContent));
};
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
  const saved = [await text(page, '#iTune'), await val(page, '#iLoop')];
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
  assert.deepEqual([await text(page, '#iTune'), await val(page, '#iLoop')], saved);
  assert.deepEqual(saved, ['A-4 +0', 'forward']);
});

test('the song is kept: a reload opens it as it was, its own videos and the demo\'s, instead of the demo', { skip }, async t => {
  const page = await app(t);
  await page.click('#instList .inst:nth-child(2)');
  await page.eval(() => { const e = document.querySelector('#iVol'); e.value = '20'; e.dispatchEvent(new Event('change')); });
  await loadFixture(page);
  await page.eval(async () => { const c = await import('/src/core/commands.js'); c.exec(() => c.setSong({ title: 'kept' }, 'title')); });
  await sleep(1500); // kept a moment after the last change
  await page.reload();
  await page.waitFor(() => /back where you left off/.test(document.querySelector('#status').textContent), SLOW);
  assert.deepEqual(await instNames(page), ['01 Kick', '02 Snare', '03 HiHat']);
  await page.click('#instList .inst:nth-child(2)');
  assert.equal(await val(page, '#iVol'), '20');
  assert.deepEqual(await page.eval(() => [pooptracker.song.title, pooptracker.instruments[2].video.name, !!pooptracker.instruments[1].video.file]), ['kept', 'av.mp4', false]);
});

test('instruments: Tune finds A-4 in a 440 Hz clip; Fit makes its region last a power of two rows at C-4', { skip }, async t => {
  const page = await app(t);
  await loadFixture(page);
  await page.click('#bTune');
  assert.equal(await text(page, '#iTune'), 'A-4 +0');
  await page.click('#bFit');
  const rows = await page.eval(async () => {
    const { instruments, song } = await import('/src/core/song.js'), { rateFor } = await import('/src/core/instrument.js'), { ed } = await import('/src/ui/common.js');
    const I = instruments[ed.inst]; return (I.end - I.start) / rateFor(I, 48) / (song.speed * 2.5 / song.bpm);
  });
  assert.ok(Math.abs(rows - 64) < 0.02, `${rows} rows`); // 6 s at 125 BPM, speed 6: 50 rows now, 64 the nearest power of two
  await page.key('Mod+KeyZ');
  assert.equal(await text(page, '#iTune'), 'A-4 +0');
});

test('instruments: Manual tune moves Base and Fine with the arrow keys (Shift+↑↓ an octave); closing makes it one step Ctrl+Z takes back', { skip }, async t => {
  const page = await app(t);
  await loadFixture(page);
  await page.click('#bTune');
  await page.click('#bTuneMan');
  await page.waitFor(() => document.querySelector('#tuneDlg').open);
  assert.match(await page.eval(() => document.querySelector('#tuneHeard').textContent), /in tune/); // a 440 Hz clip on A-4 after Auto
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Shift+ArrowLeft']) await page.key(k);
  assert.match(await page.eval(() => document.querySelector('#tuneNow').textContent), /Base A#4, Fine \+3$/);
  assert.match(await page.eval(() => document.querySelector('#tuneHeard').textContent), /1 semitone flat \(↓\), then 2 cents flat/);
  await page.click('#tLeft'); await page.click('#tLeft');
  await page.click('#tuneDlg .close');
  await page.waitFor(() => document.querySelector('#iTune').textContent === 'A#4 -5'); // kept on the dialog's close event, a moment later
  await page.key('Mod+KeyZ');
  assert.equal(await text(page, '#iTune'), 'A-4 +0');
  // Base and Fine are shown, not typed: a click on them opens Manual, where Shift+↑↓ moves an octave
  await page.click('#iTune');
  await page.waitFor(() => document.querySelector('#tuneDlg').open);
  await page.key('Shift+ArrowUp');
  await page.click('#tuneDlg .close');
  await page.waitFor(() => document.querySelector('#iTune').textContent === 'A-5 +0');
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

test('CapsLock writes a key-off at every press, also on a Mac, where turning it off comes as a lone keyup', { skip }, async t => {
  const page = await app(t);
  await page.key('Space'); // edit mode on
  await page.waitFor(() => document.querySelector('#patBox').classList.contains('editing'));
  const n = () => page.eval(() => window.pooptracker.song.patterns[0].rows.slice(0, 3).map(r => r[0].n));
  const caps = types => page.eval(ts => ts.forEach(type => document.querySelector('#pat').dispatchEvent(new KeyboardEvent(type, { code: 'CapsLock', key: 'CapsLock', bubbles: true }))), types);
  const row2 = (await n())[2];
  await caps(['keydown', 'keyup']); // it turns on: keydown and keyup, one press
  await caps(['keyup']); // it turns off (macOS): the keyup alone
  const [a, b, c] = await n();
  assert.equal(a, b); assert.notEqual(a, row2);
  assert.equal(c, row2, 'the keyup after a keydown is not a second press');
});

test('instruments: Amp adds a step that changes the sample (above 100% it clips); Ctrl+Z takes it back', { skip }, async t => {
  const page = await app(t);
  await page.click('#bAmp');
  await page.waitFor(() => document.querySelector('#ampDlg').open);
  await page.eval(() => { document.querySelector('#ampA').value = 300; document.querySelector('#ampB').value = 300; });
  await page.click('#ampGo');
  assert.deepEqual(await page.eval(() => window.pooptracker.instruments[1].amp), []); // past 200: the field itself refuses it
  await page.eval(() => { document.querySelector('#ampA').value = 200; document.querySelector('#ampB').value = 200; });
  await page.click('#ampGo');
  const peak = () => page.eval(() => Math.max(...window.pooptracker.instruments[1].buffer.getChannelData(0).map(Math.abs)));
  assert.equal(await peak(), 1);
  assert.match(await text(page, '#ampNow'), /200→200%/);
  await page.click('#ampDlg .close');
  await page.key('Mod+KeyZ');
  assert.deepEqual(await page.eval(() => window.pooptracker.instruments[1].amp), []);
  assert.ok(await peak() < 1);
});

test('frames decoded in order (WebCodecs) are the frames a seek shows: a whole video, and pieces cut mid-frame (H.264, AV1)', { skip: cdp }, async t => {
  const page = await app(t);
  const res = await page.eval(async () => {
    const { decodeFrames } = await import('./src/frames.js');
    const { cutVideo, reader } = await import('./src/mp4cut.js');
    const get = async p => new Uint8Array(await (await fetch(p)).arrayBuffer());
    const piece = async (p, t0) => { const b = await get(p); return (await cutVideo(reader(b), b.length, t0, t0 + 1)).bytes; };
    const once = (el, ev) => new Promise(ok => el.addEventListener(ev, ok, { once: true }));
    const out = {};
    for (const [name, bytes] of [['whole', await get('test/fixtures/av.mp4')], ['h264 piece', await piece('test/fixtures/av.mp4', 1.0137)], ['av1 piece', await piece('test/fixtures/av1.webm', 2.0219)]]) {
      const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([bytes])); await once(v, 'loadeddata');
      const w = v.videoWidth, h = v.videoHeight, n = Math.floor(Math.min(v.duration, 1) * 30), times = Array.from({ length: n }, (_, i) => (i + 0.25) / 30);
      const fr = await decodeFrames(bytes, times, w, h);
      if (!fr) { out[name] = 'not decoded'; continue; }
      const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }), px = s => { g.drawImage(s, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
      const seek = []; for (const t of times) { v.currentTime = t; await once(v, 'seeked'); seek.push(px(v)); }
      const diff = (a, b) => { let d = 0; for (let j = 0; j < a.length; j++) d += Math.abs(a[j] - b[j]); return d / a.length; };
      out[name] = fr.map((f, i) => { const c = px(f), ds = [seek[i - 1], seek[i], seek[i + 1]].map(s => s ? diff(s, c) : Infinity); return ds[1] <= Math.min(ds[0], ds[2]) ? null : i; }).filter(i => i != null);
    }
    return out;
  });
  assert.deepEqual(res, { whole: [], 'h264 piece': [], 'av1 piece': [] });
});

test('Save writes over the file the song was opened from, also after a reload; Zap forgets the file', { skip: cdp }, async t => {
  const page = await app(t);
  await zap(page, 'all'); // the demo's instruments have no video file and can't be saved
  await page.setFiles('#file', [`${FIXTURES}/av.mp4`]);
  await page.waitFor(() => /av\.mp4 loaded/.test(document.querySelector('#status').textContent), 15000);
  // a file with a handle, as Load or a drop gives one in Chrome (here from the page's private file system)
  await page.eval(async () => {
    const { buildSong } = await import('/src/io.js'), { openSong } = await import('/src/ui/files.js');
    const h = await (await navigator.storage.getDirectory()).getFileHandle('test.poop', { create: true });
    const w = await h.createWritable(); await w.write(await buildSong()); await w.close();
    await openSong(await h.getFile(), h);
  });
  assert.match(await text(page, '#status'), /Opened: test\.poop.*Save writes over it/);
  const bpmInFile = () => page.eval(async () => {
    const PT = (await import('/src/ptformat.js')).default, h = await (await navigator.storage.getDirectory()).getFileHandle('test.poop');
    const zip = await PT.unzip(new Uint8Array(await (await h.getFile()).arrayBuffer()));
    return +/bpm=(\d+)/.exec(new TextDecoder().decode(zip.get('song.txt')))[1];
  });
  const setBpm = bpm => page.eval(async b => { const c = await import('/src/core/commands.js'); c.exec(() => c.setSong({ bpm: b }, 'bpm')); }, bpm);
  const save = async () => { await page.key('Mod+KeyS'); await page.waitFor(() => /^Saved over test\.poop/.test(document.querySelector('#status').textContent), 15000); };
  await setBpm(140); await save();
  assert.equal(await bpmInFile(), 140);
  await sleep(1500); // the song is kept a moment after the last change
  await page.reload();
  await page.waitFor(() => /back where you left off/.test(document.querySelector('#status').textContent), SLOW);
  await setBpm(150); await save();
  assert.equal(await bpmInFile(), 150);
  await zap(page, 'all');
  await page.waitFor(() => import('/src/autosave.js').then(a => a.keptHandle()).then(h => h === undefined));
});

test('Zap opens a dialog: Tracks keeps the instruments, Instruments keeps the notes, closing it zaps nothing', { skip }, async t => {
  const page = await app(t);
  const state = () => page.eval(() => { const { song, instruments } = window.pooptracker; return { insts: instruments.length, notes: song.patterns.flatMap(P => P.rows.flat()).filter(c => c.n >= 0).length }; });
  const before = await state();
  assert.ok(before.insts > 1 && before.notes > 0);
  await page.click('#bNew');
  assert.equal(await page.eval(() => document.querySelector('#zapDlg').open), true);
  await page.click('#zapDlg .close'); // (as Esc: CDP's synthetic Escape doesn't cancel a dialog)
  await page.waitFor(() => !document.querySelector('#zapDlg').open);
  assert.deepEqual(await state(), before);
  await zap(page, 'instruments');
  assert.deepEqual(await state(), { insts: 1, notes: before.notes });
  await page.key('Mod+KeyZ');
  await zap(page, 'tracks');
  assert.deepEqual(await state(), { insts: before.insts, notes: 0 });
  assert.match(await text(page, '#status'), /Zapped: the tracks are empty/);
});

test('− Chn. deletes the last channel (as + Chn. adds one at the end), whichever channel the cursor is in', { skip }, async t => {
  const page = await app(t);
  const n = () => page.eval(() => window.pooptracker.song.channels.length);
  assert.equal(await n(), 4);
  await page.click('#cAdd'); await page.click('#cAdd');
  assert.equal(await n(), 6);
  await page.click('#cDel'); await page.click('#cDel'); // the cursor is in channel 1, which has notes
  assert.equal(await n(), 4);
  assert.doesNotMatch(await text(page, '#status'), /isn't empty/);
});

// Saving an instrument over its own video: Chrome empties the chosen file as soon as it is picked, before the video is
// read to be written into it. A video kept as a reference to the file couldn't be read any more (NotReadableError)
test('a loaded video is kept in memory: its file can change on disk and the instrument is still saved', { skip: cdp }, async t => {
  const page = await app(t), file = join(mkdtempSync(join(tmpdir(), 'pooptracker-')), 'clip.mp4');
  copyFileSync(`${FIXTURES}/av.mp4`, file);
  await page.setFiles('#file', [file]);
  await page.waitFor(() => /video → clip\.mp4/.test(document.querySelector('#status').textContent), 15000);
  writeFileSync(file, '');
  const size = await page.eval(async () => {
    const { instrumentVideo } = await import('/src/io.js'), { instruments } = await import('/src/core/song.js'), { ed } = await import('/src/ui/common.js');
    return (await instrumentVideo(instruments[ed.inst])).size;
  });
  assert.ok(size > 60000, `${size} bytes`);
});

// the library, from a copy served with the app (test/fixtures/library: an index.json and two videos, one with its
// instrument in its metadata): never the network
test('the library lists its instruments by folder, finds them, adds one with its settings and replaces a video', { skip: cdp }, async t => {
  const page = await app(t, { query: '&library=/test/fixtures/library/' });
  const rows = () => page.eval(() => [...document.querySelectorAll('#libList > div')].map(e => e.textContent.trim()));
  await page.click('#bLib');
  await page.waitFor(() => document.querySelectorAll('#libList .libItem').length === 3, 5000);
  assert.deepEqual(await rows(), ['snare', '<i>Odd</i>1.00 s', 'Lib Click#click #hit1.00 s', 'vocal', 'Tone6.00 s']); // a name is text, never HTML
  await page.eval(() => { const f = document.querySelector('#libFind'); f.value = '#hit'; f.dispatchEvent(new Event('input')); });
  assert.deepEqual(await rows(), ['snare', 'Lib Click#click #hit1.00 s']);
  await page.click('#libList .libItem');
  assert.equal(await text(page, '#libPrevNow'), 'Loading…'); // over the black picture until the video is in
  await page.waitFor(() => document.querySelector('#libPrevNow').hidden, 8000);
  assert.equal(await page.eval(() => document.querySelector('#libPrev').style.objectPosition), '0% 50%'); // cropped around its focus (left edge)
  assert.match(await text(page, '#libInfo'), /^41 KB\s*from: https:\/\/example\.com\/click/);
  const n = await page.eval(async () => (await import('/src/core/song.js')).instruments.length);
  await page.click('#libAdd');
  await page.waitFor(() => /→ instrument/.test(document.querySelector('#libNow').textContent), 15000);
  const I = await page.eval(async () => { const I = (await import('/src/core/song.js')).instruments.at(-1); return [I.name, I.baseNote, I.vol, I.hit, I.tags, I.source]; });
  assert.deepEqual(I, ['Lib Click', 50, 48, 2, ['click', 'hit'], 'https://example.com/click']);
  assert.equal(await page.eval(async () => (await import('/src/core/song.js')).instruments.length), n + 1);
  assert.match(await text(page, '#status'), /Lib Click → instrument 04, selected\. To put it in the song: Space \(edit mode\), then a note key/);
  // Repl.: the selected instrument (01) gets Tone's video; it has no instrument in it, so 01 keeps how it sounds
  await page.eval(async () => { (await import('/src/ui/instrumentPanel.js')).selectInst(1); const f = document.querySelector('#libFind'); f.value = ''; f.dispatchEvent(new Event('input')); });
  await page.eval(() => [...document.querySelectorAll('#libList .libItem')].find(e => e.textContent.startsWith('Tone')).click());
  await page.click('#libRepl');
  await page.waitFor(() => /Tone → instrument 01/.test(document.querySelector('#libNow').textContent), 15000);
  assert.deepEqual(await page.eval(async () => { const I = (await import('/src/core/song.js')).instruments[1]; return [I.name, I.video.file.name]; }), ['Kick', 'tone.mp4']);
});

// a note key pressed off the note column did nothing and said nothing: now the status says what the column takes
test('a key the cursor\'s column doesn\'t take says so, and changes nothing', { skip: cdp }, async t => {
  const page = await app(t);
  await page.key('Space');
  await page.waitFor(() => document.querySelector('#patBox').classList.contains('editing'));
  const rows = () => page.eval(() => JSON.stringify(window.pooptracker.song.patterns[0].rows));
  const before = await rows();
  await page.key('ArrowRight'); await page.key('KeyQ'); // the instrument column
  assert.equal(await rows(), before);
  assert.match(await text(page, '#status'), /^The instrument column takes hex digits \(0–9, A–F\)\. Notes go in the note column: ← to it$/);
  for (let i = 0; i < 4; i++) await page.key('ArrowRight'); // the effect column
  await page.eval(() => document.querySelector('#pat').dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', key: ',', bubbles: true })));
  assert.match(await text(page, '#status'), /^The effect column takes an effect letter/);
});
