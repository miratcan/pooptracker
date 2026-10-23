// The song as it is right now, kept in the browser (IndexedDB), so a closed tab, a reload or a swipe back doesn't
// lose it: the next start opens it instead of the demo. Nothing to press and nothing asked [ZEN-NO-CONFIRMATION].
// Kept like a .poop: song.txt + patterns/NN.txt, each video file stored once (a write only adds the new ones).
// The demo's videos have no file; they are kept by name and taken from the demo the start has just made.
import PTFormat from './ptformat.js';
import { song, instruments, videos } from './core/song.js';
import { onChange } from './core/commands.js';
import { decodeVideo, openSongZip } from './io.js';

const DB = 'pooptracker', STORE = 'autosave', SONG = 'song', WAIT = 1000; // ms after the last change
const ids = new WeakMap(); // video file → its key in the store
let nextId = Date.now();
const idOf = file => { if (!ids.has(file)) ids.set(file, `file:${(nextId++).toString(36)}`); return ids.get(file); };

let db = null;
function openDb() {
  return db ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
const done = tx => new Promise((ok, fail) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => fail(tx.error); });
const result = req => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });

// the song → { text: { 'song.txt': …, 'patterns/00.txt': … }, files: { key: File } }
function snapshot() {
  const paths = new Map(), files = {};
  for (const I of instruments.slice(1)) {
    const V = I.video; if (paths.has(V)) continue;
    if (V.file) { const k = idOf(V.file); files[k] = V.file; paths.set(V, k); }
    else paths.set(V, 'demo/' + V.name);
  }
  return { text: PTFormat.formatSong(song, instruments.slice(1).map(I => ({ I, video: paths.get(I.video) }))), files };
}

export async function save() {
  const { text, files } = snapshot(), d = await openDb();
  const kept = new Set(await result(d.transaction(STORE).objectStore(STORE).getAllKeys()));
  const tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
  st.put({ text, files: Object.keys(files) }, SONG);
  for (const [k, f] of Object.entries(files)) if (!kept.has(k)) st.put(f, k);
  for (const k of kept) if (k !== SONG && !(k in files)) st.delete(k);
  await done(tx);
}

// The kept song replaces the current one (the demo). Returns true when there was one and it opened.
export async function restore(progress) {
  const d = await openDb(), st = d.transaction(STORE).objectStore(STORE);
  const kept = await result(st.get(SONG)); if (!kept) return false;
  const files = new Map(await Promise.all(kept.files.map(async k => [k, await result(d.transaction(STORE).objectStore(STORE).get(k))])));
  const enc = new TextEncoder(), zip = new Map(Object.entries(kept.text).map(([name, t]) => [name, enc.encode(t)]));
  for (const k of files.keys()) zip.set(k, new Uint8Array(0)); // parseSong only checks the path is there
  for (const V of videos) if (!V.file) zip.set('demo/' + V.name, new Uint8Array(0));
  const res = await openSongZip(zip, async path => {
    const f = path.startsWith('demo/') ? videos.find(V => !V.file && 'demo/' + V.name === path) : files.get(path);
    if (!f) throw new Error(`the video ${path} is gone`);
    if (!(f instanceof Blob)) return f; // a demo video, as the start made it
    const V = await decodeVideo(f, progress); ids.set(V.file, path);
    return V;
  });
  if (res.errors) throw new Error(res.errors.join('\n'));
  return true;
}

// from now on, every change is kept a moment after it settles, and right away when the page goes away
export function keep() {
  let timer = null;
  const now = () => { clearTimeout(timer); timer = null; save().catch(err => console.warn("Couldn't keep the song:", err)); };
  onChange(() => { clearTimeout(timer); timer = setTimeout(now, WAIT); });
  addEventListener('pagehide', () => { if (timer) now(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) now(); });
}
