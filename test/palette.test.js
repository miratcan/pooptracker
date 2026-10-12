// The palette: every UI color is a variable in index.html's :root; nothing else writes a color by hand.
// (src/demo.js is exempt: it paints the demo clips, which are material like any video, not UI.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const COLOR = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b(?![\w-])|\brgba?\(/g;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const root = html.match(/:root\{[\s\S]*?\n\}/)[0];

test('index.html writes colors only in the :root palette', () => {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(root, '');
  assert.deepEqual(style.match(COLOR) ?? [], []);
});

test('the UI code has no hand-written colors (it uses pal.name / var(--name))', () => {
  const files = readdirSync(join(ROOT, 'src'), { recursive: true }).filter(f => f.endsWith('.js') && f !== 'demo.js');
  const found = files.flatMap(f => (readFileSync(join(ROOT, 'src', f), 'utf8').match(/['"`(:=\s]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?['"`;)\s]|\brgba?\(/g) ?? []).map(m => `${f}: ${m.trim()}`))
    .filter(m => !m.startsWith('ui/palette.js: rgba(')); // alpha() builds rgba from a palette color
  assert.deepEqual(found, []);
});

test('every pal.name and var(--name) used is in the palette', () => {
  const defined = new Set([...root.matchAll(/--([\w]+):/g)].map(m => m[1]));
  const src = readdirSync(join(ROOT, 'src'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => readFileSync(join(ROOT, 'src', f), 'utf8')).join('\n');
  const used = [...(html + src).matchAll(/var\(--([\w]+)\)|\bpal\.(\w+)/g)].map(m => m[1] ?? m[2]);
  const handles = src.match(/const HANDLES = (\[.*\]);/)[1]; // the waveform handles name their colors
  const handleColors = [...handles.matchAll(/\['\w+', '(\w+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set([...used, ...handleColors])].filter(n => !defined.has(n)), []);
});
