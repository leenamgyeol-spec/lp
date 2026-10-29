// Sets up the scratch sound: decodes the track once into a light mono copy and hands it to the
// audio-thread player (scratch-worklet.js), which follows the hand's speed and direction.
import { windowAround } from './scratch-math.js';

const KEEP_RATE = 22050;      // mono at 22 kHz: a 5-minute track is about 26 MB
const WHOLE_TRACK_MAX = 720;  // longer tracks keep only a ±60 s stretch around the needle

// Mix to mono and resample (linear) to `rate`, only between fromSec and toSec.
function monoSlice(buf, fromSec, toSec, rate) {
  const n = Math.max(1, Math.floor((toSec - fromSec) * rate));
  const out = new Float32Array(n);
  const ratio = buf.sampleRate / rate;
  const first = fromSec * buf.sampleRate;
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const last = buf.length - 1;
  for (let i = 0; i < n; i++) {
    const p = Math.min(last, first + i * ratio);
    const j = Math.floor(p), t = p - j, k = Math.min(last, j + 1);
    let v = 0;
    for (const ch of chans) v += ch[j] + (ch[k] - ch[j]) * t;
    out[i] = v / chans.length;
  }
  return out;
}

export function createScratchEngine() {
  const AC = globalThis.AudioContext;
  // the old webkitAudioContext has no AudioWorklet, so it doesn't count
  const supported = !!(AC && globalThis.AudioWorkletNode && 'audioWorklet' in AC.prototype);
  let ctx = null, node = null, gain = null, loading = null;
  let volume = 1;
  let loaded = null;      // { src, start, end } now inside the worklet
  let request = 0;        // newest prepare wins when they overlap
  const decoding = new Map(); // src → Promise<AudioBuffer>
  let lastSec = 0;
  let stopWaiters = [];
  const listeners = new Set();

  // Starts inside a pointer gesture: iOS only lets audio begin from one.
  function ensure() {
    if (loading) return loading;
    ctx = new AC();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS 17+ only */ }
    ctx.resume();
    loading = ctx.audioWorklet.addModule(new URL('./scratch-worklet.js', import.meta.url)).then(() => {
      node = new AudioWorkletNode(ctx, 'lp-scratch', { numberOfInputs: 0, outputChannelCount: [2] });
      gain = new GainNode(ctx, { gain: volume });
      node.connect(gain).connect(ctx.destination);
      node.port.onmessage = ({ data }) => {
        lastSec = data.sec;
        if (data.type === 'position') for (const fn of listeners) fn(data.sec);
        if (data.type === 'stopped') {
          const waiters = stopWaiters;
          stopWaiters = [];
          for (const w of waiters) w(data.sec);
          ctx.suspend(); // nothing to play: let the phone rest
        }
      };
    });
    return loading;
  }

  function decode(src) {
    if (!decoding.has(src)) {
      decoding.clear(); // keep at most one track's decode around
      decoding.set(src, fetch(src).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)));
    }
    return decoding.get(src);
  }

  return {
    supported,

    // Call from pointer gestures (down and up): iOS unlocks audio on a touch's end.
    wake() {
      if (!supported) return;
      ensure();
      ctx.resume();
    },

    // Make sure the sound around positionSec is in the worklet. Resolves false on failure
    // or when a newer prepare took over.
    async prepare(src, positionSec, durationSec) {
      if (!supported) return false;
      const mine = ++request;
      try {
        const ready = ensure();
        ctx.resume();
        await ready;
        if (loaded && loaded.src === src && positionSec >= loaded.start + 2 && positionSec <= loaded.end - 2) return mine === request;
        const buf = await decode(src);
        if (mine !== request) return false;
        const whole = buf.duration <= WHOLE_TRACK_MAX;
        const w = whole ? { start: 0, end: buf.duration } : windowAround(Math.min(positionSec, buf.duration), buf.duration);
        const samples = monoSlice(buf, w.start, w.end, KEEP_RATE);
        if (whole) decoding.delete(src); // the mono copy now lives in the worklet
        node.port.postMessage({ type: 'load', samples, sampleRate: KEEP_RATE, startSec: w.start }, [samples.buffer]);
        loaded = { src, start: w.start, end: w.end };
        return true;
      } catch {
        return false;
      }
    },

    start(positionSec) {
      if (!node) return;
      ctx.resume();
      // a grab that comes back before the previous stop finished takes over from there
      const waiters = stopWaiters;
      stopWaiters = [];
      for (const w of waiters) w(lastSec);
      lastSec = positionSec;
      node.port.postMessage({ type: 'start', positionSec });
    },

    setRate(rate) {
      node?.port.postMessage({ type: 'rate', rate });
    },

    // the volume knob turns the scratch sound too (0–1, already on the loudness curve)
    setVolume(v) {
      volume = v;
      if (gain) gain.gain.value = v;
    },

    // Fades out and resolves with where the needle ended up (seconds into the track).
    stop() {
      if (!node) return Promise.resolve(lastSec);
      return new Promise((resolve) => {
        stopWaiters.push(resolve);
        node.port.postMessage({ type: 'stop' });
        setTimeout(() => {
          if (stopWaiters.includes(resolve)) {
            stopWaiters = stopWaiters.filter((w) => w !== resolve);
            resolve(lastSec);
          }
        }, 250);
      });
    },

    onPosition(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
