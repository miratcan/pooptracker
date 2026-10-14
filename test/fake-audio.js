// Just enough of Web Audio for the engine to run in Node: nothing makes sound, everything is recorded.
// ctx.currentTime is a plain number the test moves forward.

class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); }
  setTargetAtTime(v, t, k) { this.events.push(['target', v, t, k]); }
  cancelScheduledValues(t) { this.events = this.events.filter(e => e[2] < t); }
}
class Node {
  constructor() { this.outputs = []; }
  connect(n) { this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; }
}

export class FakeAudioBuffer {
  constructor({ numberOfChannels = 1, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels; this.length = length; this.sampleRate = sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(c) { return this.data[c]; }
  copyToChannel(src, c) { this.data[c].set(src.subarray(0, this.length)); }
}

export class FakeAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'running';
    this.destination = new Node(); this.sources = [];
  }
  resume() { return Promise.resolve(); }
  createGain() { const n = new Node(); n.gain = new Param(1); return n; }
  createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; }
  createDynamicsCompressor() { const n = new Node(); for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[p] = new Param(); return n; }
  createConvolver() { const n = new Node(); n.buffer = null; n.normalize = true; return n; }
  createOscillator() { const n = new Node(); n.frequency = new Param(440); n.start = () => {}; n.stop = () => {}; return n; }
  createBuffer(numberOfChannels, length, sampleRate) { return new FakeAudioBuffer({ numberOfChannels, length, sampleRate }); }
  createBufferSource() {
    const n = new Node(); n.playbackRate = new Param(1); n.loop = false; n.loopStart = 0; n.loopEnd = 0;
    // like the browser: the buffer can be set only once
    let buf = null;
    Object.defineProperty(n, 'buffer', { get: () => buf, set: b => { if (buf) throw new Error('InvalidStateError: the buffer was already set'); buf = b; } });
    n.start = (when = 0, offset = 0) => { n.started = { when, offset }; };
    n.stop = (when = 0) => { n.stopped = when; };
    this.sources.push(n);
    return n;
  }
}

// the browser globals the core and engine use
globalThis.AudioBuffer = FakeAudioBuffer;
