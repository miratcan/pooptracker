// The song as it is right now, kept in the browser (IndexedDB), so a closed tab, a reload or a swipe back doesn't
// lose it. Every visit keeps its own song: a new one never writes over the last, and Recover lists the last few
// (BeepBox's "recover recent songs"). The start opens none of them: opening a song decodes all its videos' frames, a
// wait nobody asked for. Nothing to press to keep a song and nothing asked [ZEN-NO-CONFIRMATION].
// Kept like a .poop: song.txt + patterns/NN.txt, each video file stored once and shared by the songs that use it
// (a write only adds the new ones; a file goes with the last song that uses it). A visit that changes nothing keeps
// nothing. The demo's videos have no file; they are kept by name and taken from the demo the start has made.
import { song, instruments } from './core/song.js';
import PTFormat from './ptformat.js';
import { onChange } from './core/commands.js';
import { decodeVideo, openSongZip } from './io.js';
import { demoVideos } from './demo.js';

const DB = 'pooptracker', STORE = 'autosave', KEEP = 10, WAIT = 1000; // songs kept; ms after the last change
const SONG = id => `song:${id}`, HANDLE = id => `handle:${id}`;
const ids = new WeakMap(); // video file → its key in the store
let nextId = Date.now();
const idOf = file => { if (!ids.has(file)) ids.set(file, `file:${(nextId++).toString(36)}`); return ids.get(file); };
let me = Date.now().toString(36); // the song of this visit (Recover makes another one its own); null while one opens

let db = null;
function openDb() {
  return db ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = e => {
      if (e.oldVersion < 1) return req.result.createObjectStore(STORE);
      // version 1 kept one song ('song', its file 'handle'): it is the first of the list
      const st = req.transaction.objectStore(STORE), was = Date.now() - 1;
      st.get('song').onsuccess = ev => { const s = ev.target.result; if (s) { st.put({ ...s, at: was }, SONG(was.toString(36))); st.delete('song'); } };
      st.get('handle').onsuccess = ev => { const h = ev.target.result; if (h) { st.put(h, HANDLE(was.toString(36))); st.delete('handle'); } };
    };
    // a newer PoopTracker in another tab changes the store: this one lets go, or that one would wait for it
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); db = null; }; ok(req.result); };
    req.onerror = () => fail(req.error);
  });
}
const done = tx => new Promise((ok, fail) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => fail(tx.error); });
const result = req => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });
const range = prefix => IDBKeyRange.bound(prefix, prefix + '￿');
// the kept songs: [{ id, text, files: [key], at }]
async function songsIn(st) {
  const [keys, vals] = await Promise.all([result(st.getAllKeys(range('song:'))), result(st.getAll(range('song:')))]);
  return vals.map((v, k) => ({ id: keys[k].slice(5), ...v }));
}

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

// this visit's song, written over its last copy; past the KEEP newest, the oldest goes
export async function save() {
  if (!me) return;
  const { text, files } = snapshot(), mine = { text, files: Object.keys(files), at: Date.now() };
  const tx = (await openDb()).transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
  const others = (await songsIn(st)).filter(s => s.id !== me).sort((a, b) => b.at - a.at);
  const stored = new Set(await result(st.getAllKeys(range('file:'))));
  st.put(mine, SONG(me));
  for (const s of others.slice(KEEP - 1)) { st.delete(SONG(s.id)); st.delete(HANDLE(s.id)); }
  const used = new Set([mine, ...others.slice(0, KEEP - 1)].flatMap(s => s.files));
  for (const [k, f] of Object.entries(files)) if (!stored.has(k)) st.put(f, k);
  for (const k of stored) if (!used.has(k)) st.delete(k);
  await done(tx);
}

// the other kept songs, newest first: [{ id, title, at, patterns, instruments }]
export async function recent() {
  const songs = await songsIn((await openDb()).transaction(STORE).objectStore(STORE));
  return songs.filter(s => s.id !== me).sort((a, b) => b.at - a.at).map(s => ({
    id: s.id, at: s.at, title: /^title=(.*)$/m.exec(s.text['song.txt'])?.[1].trim() ?? '',
    patterns: Object.keys(s.text).filter(k => k.startsWith('patterns/')).length,
    instruments: (s.text['song.txt'].match(/^=== INSTRUMENT /gm) ?? []).length,
  }));
}

// A kept song replaces the current one, which stays kept as it was, and is this visit's song from then on.
// Returns its file's handle (see keepHandle), null without one.
export async function restore(id, progress) {
  if (timer) await flush(); // the song being replaced, with its last change
  const d = await openDb(), st = d.transaction(STORE).objectStore(STORE);
  const [kept, handle] = await Promise.all([result(st.get(SONG(id))), result(st.get(HANDLE(id)))]);
  if (!kept) throw new Error('that song is no longer kept');
  const files = new Map(await Promise.all(kept.files.map(async k => [k, await result(d.transaction(STORE).objectStore(STORE).get(k))])));
  const enc = new TextEncoder(), zip = new Map(Object.entries(kept.text).map(([name, t]) => [name, enc.encode(t)]));
  for (const k of files.keys()) zip.set(k, new Uint8Array(0)); // parseSong only checks the path is there
  for (const V of demoVideos) zip.set('demo/' + V.name, new Uint8Array(0));
  const was = me; me = null; // opening it is no change to either song
  try {
    const res = await openSongZip(zip, async (path, p) => {
      const f = path.startsWith('demo/') ? demoVideos.find(V => 'demo/' + V.name === path) : files.get(path);
      if (!f) throw new Error(`the video ${path} is gone`);
      if (!(f instanceof Blob)) return f; // a demo video, as the start made it
      const V = await decodeVideo(f, p); ids.set(V.file, path);
      return V;
    }, progress);
    if (res.errors) throw new Error(res.errors.join('\n'));
  } catch (err) { me = was; throw err; }
  me = id;
  return handle ?? null;
}

// the song's file (a FileSystemFileHandle, see ui/files.js), kept beside it so a reload still saves over it; null: none
export async function keepHandle(handle) {
  if (!me) return;
  const tx = (await openDb()).transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
  if (handle) st.put(handle, HANDLE(me)); else st.delete(HANDLE(me));
  await done(tx);
}
export async function keptHandle() { return result((await openDb()).transaction(STORE).objectStore(STORE).get(HANDLE(me))); }

// from now on, every change is kept a moment after it settles, and right away when the page goes away
let timer = null;
const flush = () => { clearTimeout(timer); timer = null; return save().catch(err => console.warn("Couldn't keep the song:", err)); };
export function keep() {
  onChange(() => { clearTimeout(timer); timer = setTimeout(flush, WAIT); });
  addEventListener('pagehide', () => { if (timer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) flush(); });
}
