// Play / stop / record. Recording: the output canvas + the master bus go straight into a MediaRecorder.
import { song } from '../core/song.js';
import { setGuard } from '../core/commands.js';
import { ensureAudio, recDest } from '../engine/audio.js';
import { player, startPlay, stopPlay, onPlayer } from '../engine/player.js';
import { $, ed, view, setStatus, escHtml } from './common.js';
import { out } from './output.js';
import { saveAs, safeName } from './files.js';

let recorder = null;
// the channel count can't change, and the song can't be replaced, in the middle of a recording
setGuard(action => !recorder ? null : action === 'newSong' ? "can't start a new song while recording" : "the channel count can't change while recording");

export function updateButtons() {
  $('#bSong').classList.toggle('on', player.playing && player.mode === 'song');
  $('#bPat').classList.toggle('on', player.playing && player.mode === 'pattern');
  $('#bRec').classList.toggle('on', !!recorder);
}
onPlayer(() => { updateButtons(); if (!player.playing) view.vis = null; view.patDirty = true; });

export const playSong = () => startPlay('song');
export const playPattern = () => startPlay('pattern', () => ed.pat);
// Stop / Space: playback stops, and a running recording ends (→ save dialog)
export function userStop() { stopPlay(); if (recorder && recorder.state === 'recording') recorder.stop(); }
$('#bSong').onclick = playSong;
$('#bPat').onclick = playPattern;
$('#bStop').onclick = () => userStop();

$('#bRec').onclick = () => {
  if (recorder) { recorder.stop(); return; }
  ensureAudio();
  const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const mime = mimes.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) { setStatus("This browser doesn't support MediaRecorder."); return; }
  const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    recorder = null; updateButtons();
    const blob = new Blob(chunks, { type: mime }), ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const saved = await saveAs(safeName(song.title.trim() || 'pooptracker') + '.' + ext, 'Video', mime.split(';')[0], '.' + ext, () => blob);
    if (saved) setStatus(`Recording saved: ${escHtml(saved.name)} (${(blob.size / 1048576).toFixed(1)} MB)`);
  };
  recorder.start(250);
  if (!player.playing) playSong();
  setStatus('● Recording… Stop, Space or Rec again to finish');
  updateButtons();
};
