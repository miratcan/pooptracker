// The command layer: the only writer of the song. Every change validates, undoes, redoes and announces itself.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestSong, testInstrument, testPattern } from './helpers.js';
import { song, instruments } from '../src/core/song.js';
import * as C from '../src/core/commands.js';

const changes = [];
C.onChange(c => changes.push({ scope: c.scope, how: c.how }));
beforeEach(() => { openTestSong({ instruments: [testInstrument(), testInstrument({ name: 'b' })] }); changes.length = 0; });

test('setCells applies, undoes and redoes, and announces each step', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 3, ch: 1, n: 48, i: 1 }], 'note'));
  assert.equal(song.patterns[0].rows[3][1].n, 48);
  C.undo(); assert.equal(song.patterns[0].rows[3][1].n, -1);
  C.redo(); assert.equal(song.patterns[0].rows[3][1].n, 48);
  assert.deepEqual(changes, [{ scope: 'cells', how: undefined }, { scope: 'cells', how: 'undo' }, { scope: 'cells', how: 'redo' }]);
});

test('an invalid change throws CmdError and changes nothing', () => {
  assert.throws(() => C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 7 }])), C.CmdError);
  assert.throws(() => C.exec(() => C.setCells([{ pat: 0, row: 99, ch: 0, n: 48 }])), /row 99 doesn't exist/);
  assert.equal(song.patterns[0].rows[0][0].n, -1);
  assert.equal(changes.length, 0);
});

test('a change to the same values is not a command', () => {
  assert.equal(C.exec(() => C.setSong({ bpm: song.bpm }, 'BPM')), null);
  assert.equal(C.hist.undo.length, 0);
});

test('a channel with notes in it is not deleted', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 2, n: 48, i: 1 }]));
  assert.throws(() => C.exec(() => C.deleteChannel(2)), /channel 3 isn't empty/);
  C.exec(() => C.deleteChannel(3));
  assert.equal(song.channels.length, 3);
  assert.equal(song.patterns[0].rows[0].length, 3);
  C.undo(); assert.equal(song.patterns[0].rows[0].length, 4);
});

test('the guard can refuse structural changes (e.g. while recording)', () => {
  C.setGuard(a => a === 'channels' ? 'busy' : null);
  try { assert.throws(() => C.exec(() => C.addChannel()), /busy/); }
  finally { C.setGuard(() => null); }
});

test('an instrument in use is not deleted; moving one renumbers its cells', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 2 }]));
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, i: 0 }]));
  C.exec(() => C.setCells([{ pat: 0, row: 1, ch: 0, n: 48, i: 2 }]));
  assert.throws(() => C.exec(() => C.deleteInstrument(2)), /instrument 02 is in use/);
  C.exec(() => C.moveInstrument(2, -1));
  assert.equal(song.patterns[0].rows[1][0].i, 1);
  assert.equal(instruments[1].name, 'b');
});

test('loop start can never be before the hit point', () => {
  assert.throws(() => C.exec(() => C.setInstrument(1, { loop: 'forward', loopStart: 0.5, loopEnd: 1.5 })), /loop start \(0\.500\) can't be before the hit point/);
  C.exec(() => C.setInstrument(1, { loop: 'forward', loopStart: 1.2, loopEnd: 1.5 }));
  assert.equal(instruments[1].loop, 'forward');
});

test('a new song is one command: undo brings everything back', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 1 }]));
  C.exec(() => C.newSong());
  assert.equal(instruments.length, 1);
  assert.equal(song.patterns.length, 1);
  C.undo();
  assert.equal(instruments.length, 3);
  assert.equal(song.patterns[0].rows[0][0].n, 48);
});

test('opening a song clears the history', () => {
  C.exec(() => C.setCells([{ pat: 0, row: 0, ch: 0, n: 48, i: 1 }]));
  openTestSong({ patterns: [testPattern(16)] });
  assert.equal(C.undo(), null);
  assert.equal(song.patterns[0].rows.length, 16);
});
