// PoopTracker: wires the layers together and starts the app.
//   core/    the song and the commands that change it (no DOM, no audio)
//   engine/  plays the song on an AudioContext (no DOM)
//   ui/      screens and panels; they change the song only through commands
// See docs/ARCHITECTURE.md.
import { instruments, song, videos, nch } from './core/song.js';
import * as commands from './core/commands.js';
import { onChange, undo, redo } from './core/commands.js';
import { initAudio, ensureAudio, visualTime, ctx } from './engine/audio.js';
import { player } from './engine/player.js';
import * as engine from './engine/player.js';
import { $, ed, view, setStatus, refreshUI, onRefresh, clampEditor } from './ui/common.js';
import { showScreen, setGlobalKeys, activeScreen } from './ui/screens.js';
import { drawOutput, sizeOut, fitOut, updateStats } from './ui/output.js';
import { patternScreen, setupPat, drawPattern, focusPattern } from './ui/patternEditor.js';
import { refreshSongPanel, followOrd } from './ui/songPanel.js';
import { refreshInstrumentPanel } from './ui/instrumentPanel.js';
import { benchScreen } from './ui/bench.js';
import './ui/transport.js';
import './ui/files.js';
import './ui/bug.js';
import { askManual } from './ui/welcome.js';
import { opening } from './ui/opening.js';
import { startMcp } from './mcp.js';
import { loadDemo } from './demo.js';
import * as autosave from './autosave.js';

// ── how the UI follows the song: every applied / undone / redone command, and every opened song
onRefresh(() => clampEditor(song, nch()));
onRefresh(refreshSongPanel);
onRefresh(() => { sizeOut(); setupPat(); });
onRefresh(refreshInstrumentPanel);
onChange(({ cmd, scope, how }) => {
  if (how === 'open') { Object.assign(ed, { pat: 0, row: 0, sel: null, ord: 0, inst: instruments.length > 1 ? 1 : 0 }); refreshUI(); return; }
  if (cmd.resetEditor) Object.assign(ed, { pat: 0, row: 0, ch: 0, col: 0, sel: null, ord: 0, inst: instruments.length > 1 ? 1 : 0 });
  // show where it happened
  if (cmd.P) { const i = song.patterns.indexOf(cmd.P); if (i >= 0 && i !== ed.pat) { ed.pat = i; ed.sel = null; } }
  if (how && cmd.at) { ed.row = cmd.at.row; ed.ch = cmd.at.ch; }
  if (cmd.inst) { const i = instruments.indexOf(cmd.inst); if (i > 0) ed.inst = i; }
  if (scope === 'cells') view.patDirty = true; else if (scope !== 'bench') refreshUI(); // the bench follows by itself
  if (how) setStatus(`${how === 'undo' ? '↶ undone' : '↷ redone'}: ${cmd.label}`);
});
setGlobalKeys({
  'Mod+KeyZ': () => undo() || setStatus('Nothing to undo'),
  'Mod+Shift+KeyZ': () => redo() || setStatus('Nothing to redo'),
  'Mod+KeyY': () => redo() || setStatus('Nothing to redo'),
  'Mod+KeyB': () => showScreen(activeScreen() === benchScreen ? patternScreen : benchScreen),
  // the browser's own Save / Open would save the page itself, not the song
  'Mod+KeyS': () => $('#bSave').click(),
  'Mod+KeyO': () => $('#bOpen').click(),
});
$('#bScreenPat').onclick = () => showScreen(patternScreen);
$('#bScreenBench').onclick = () => showScreen(benchScreen);

// ── small page behaviour
document.querySelectorAll('header input, header select, header button').forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Escape') el.blur(); }));
document.querySelectorAll('button').forEach(b => b.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); } }));
$('#bKeys').onclick = e => { e.preventDefault(); $('#keys').showModal(); };

// ── one frame: follow the row being heard, draw the output, redraw the pattern if needed
let fpsCount = 0, fpsLast = performance.now(), fpsVal = 0;
export function frame() {
  const now = visualTime();
  if (player.playing) {
    const q = player.uiQueue;
    while (q.length > 1 && q[1].t <= now) q.shift();
    if (q.length && q[0].t <= now && (!view.vis || view.vis.row !== q[0].row || view.vis.pat !== q[0].pat)) {
      view.vis = q[0];
      if (ed.follow) { ed.pat = q[0].pat; ed.row = q[0].row; if (player.mode === 'song') followOrd(q[0].ord); }
      view.patDirty = true;
    }
  }
  drawOutput(now);
  if (view.patDirty) { drawPattern(); view.patDirty = false; }
  fpsCount++;
  const pn = performance.now();
  if (pn - fpsLast > 500) { fpsVal = fpsCount * 1000 / (pn - fpsLast); fpsCount = 0; fpsLast = pn; updateStats(fpsVal); }
}
function loop() { requestAnimationFrame(loop); frame(); }

async function boot() {
  initAudio(new AudioContext({ latencyHint: 'interactive' }));
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => ensureAudio()));
  showScreen(patternScreen);
  setupPat(); fitOut();
  setStatus('Making demo instruments…');
  await loadDemo(ctx.sampleRate);
  // the song from last time, if there is one, opens in place of the demo
  let back = false;
  try { back = await opening('Opening the song from last time', autosave.restore); }
  catch (err) { console.warn("Couldn't open the song from last time:", err); }
  autosave.keep();
  requestAnimationFrame(loop);
  startMcp();
  setStatus(back ? 'Ready: back where you left off. <b>Zap</b> starts an empty song (Ctrl+Z brings this one back).'
    : 'Ready: <b>Enter</b> plays, <b>Space</b> stops / turns on edit mode, the note keys jam. Drag and drop to load your own video.');
  focusPattern();
  askManual();
}
// for tests and the browser console: the layers, as they are
window.pooptracker = { song, instruments, videos, player, engine, commands, frame, get ctx() { return ctx; } };
boot();
