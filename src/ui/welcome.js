// The first visit asks once whether to read the manual (on GitHub). However the question is closed, it isn't asked
// again in this browser. Without storage (a private window, blocked site data) it is simply asked every time.
import { $ } from './common.js';

const KEY = 'pooptracker.manualAsked';
const dlg = $('#welcome');
dlg.addEventListener('close', () => { try { localStorage.setItem(KEY, '1'); } catch {} });
$('#wRead').addEventListener('click', () => dlg.close());

export function askManual() {
  let asked = false;
  try { asked = localStorage.getItem(KEY) === '1'; } catch {}
  if (!asked) dlg.showModal();
}
