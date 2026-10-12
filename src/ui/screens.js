// Screens [ZEN-FLAT-SCREENS]: a screen owns a part of the page and its keys. One screen is active at a time;
// screens are never nested. The keyboard goes to the active screen first, then to the global keys.
//
// A screen: { name, el?, keys?: { 'Mod+KeyC': fn, … }, onKey?(e) → true if handled, enter?(), leave?() }
// Key names: optional 'Mod+' (Ctrl or ⌘), 'Alt+' (⌥) and 'Shift+', then KeyboardEvent.code (physical key, as FT2).
// keys holds the fixed shortcuts and comes first; onKey handles the rest (note entry, hex digits, navigation…).
import { $, view } from './common.js';

let current = null;
const global = {};
export const setGlobalKeys = keys => Object.assign(global, keys);
export function showScreen(s) {
  if (current === s) return;
  if (current) { current.leave?.(); if (current.el) current.el.hidden = true; }
  current = s;
  if (s.el) s.el.hidden = false;
  s.enter?.();
}
const keyName = e => `${e.metaKey || e.ctrlKey ? 'Mod+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;

document.addEventListener('keydown', e => {
  // typing in a field or reading the Keys dialog: no shortcuts
  if (e.target.matches('input,select,textarea') || $('#keys').open) return;
  const fn = current?.keys?.[keyName(e)] ?? global[keyName(e)];
  if (fn) { fn(e); e.preventDefault(); view.patDirty = true; return; }
  if (e.altKey || e.metaKey || e.ctrlKey) return;
  if (current?.onKey?.(e)) { e.preventDefault(); view.patDirty = true; }
});
