// The song: the data everything else reads. Only the command layer (core/commands.js) writes it.
// videos: every loaded video (frames + audio), never modified. instruments: 1-based like FT2 (instruments[0] = null).
export const song = { title: '', bpm: 125, speed: 6, rowsPerBeat: 4, channels: Array.from({ length: 4 }, () => ({ name: '', pan: 0x80 })), patterns: [], order: [0] };
export const instruments = [null];
export const videos = [];
// the workbench (ui/bench.js): the long video on it and the piece marked on it. Not part of the song and never saved;
// which video is on it changes only through a command, so throwing one away can be undone. The marks are like a cursor.
export const bench = { file: null, in: null, out: null, focus: null };

// the song decides how many channels it has (1–MAX_CH); per-channel audio/visual state is allocated for MAX_CH
export const nch = () => song.channels.length;
export const emptyCell = () => ({ n: -1, i: 0, v: -1, f: -1, p: 0 });
export const isEmptyCell = c => c.n === -1 && !c.i && c.v === -1 && c.f === -1 && !c.p;
export const newPattern = (rows = 64) => ({ rows: Array.from({ length: rows }, () => Array.from({ length: nch() }, emptyCell)) });
export const clonePattern = p => ({ rows: p.rows.map(r => r.map(c => ({ ...c }))) });
