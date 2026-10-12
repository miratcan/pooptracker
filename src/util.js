// Small helpers and constants shared by every layer. No DOM, no Web Audio: runs in Node too.
import PTFormat from './ptformat.js';

// output is 9:16 (TikTok, Reels); video frames are kept uncropped (short side FRAME_SHORT px), each tile crops its own shape
export const TILE_W = 320, TILE_H = 180, OUT_W = 540, OUT_H = 960, FRAME_SHORT = 240, FPS = 30, MAX_CH = PTFormat.MAX_CHANNELS, MAX_SAMPLE_SEC = 8;
export const { KEYOFF, FXCH, FX_ALLOWED, E_ALLOWED } = PTFormat;
export const FX = Object.fromEntries([...FXCH].map((c, i) => [c, i]));
const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
export const round3 = x => Math.round(x * 1000) / 1000;
export const noteName = n => n < 0 ? '···' : n === KEYOFF ? '===' : NOTE_NAMES[n % 12] + Math.floor(n / 12);
export function parseNote(s) {
  s = s.toUpperCase().trim();
  if (s === '===' || s === 'OFF') return KEYOFF;
  const m = /^([A-G])([-#]?)(\d)$/.exec(s);
  if (!m) return -1;
  return { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : 0) + (+m[3]) * 12;
}
export const copy = o => JSON.parse(JSON.stringify(o));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
