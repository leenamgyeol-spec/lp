// Audio thread: plays a decoded stretch of the track at whatever speed and direction the hand
// gives it, like a needle in a groove that someone is pushing back and forth.
/* global sampleRate, registerProcessor, AudioWorkletProcessor */

function readLinear(samples, pos) {
  if (!(pos >= 0) || pos > samples.length - 1) return 0;
  const i = Math.floor(pos), t = pos - i;
  const a = samples[i], b = i + 1 < samples.length ? samples[i + 1] : a;
  return a + (b - a) * t;
}

class LpScratch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = null;
    this.srcRate = sampleRate;
    this.startSec = 0;
    this.pos = 0;           // read position in source samples
    this.rate = 0;          // current playback rate (smoothed)
    this.target = 0;        // rate the hand asks for
    this.gain = 0;
    this.gainTarget = 0;
    this.stopping = false;
    this.sinceReport = 0;
    // the needle dragged through the groove: hiss and crackle that grow with the hand's speed
    this.hp = 0; this.lastWhite = 0; // one-pole high-pass on the hiss
    this.pop = 0;                    // the click now ringing out
    this.popDecay = Math.exp(-1 / (0.0007 * sampleRate)); // ~0.7 ms clicks
    this.rateAlpha = 1 - Math.exp(-1 / (0.016 * sampleRate)); // 16 ms glide between rates
    this.gainStep = 1 / (0.015 * sampleRate);                  // 15 ms fades
    this.port.onmessage = ({ data }) => {
      if (data.type === 'load') {
        // a new stretch of sound: nothing plays until 'start' says where
        this.samples = data.samples;
        this.srcRate = data.sampleRate;
        this.startSec = data.startSec;
        this.pos = 0;
        this.gain = 0;
        this.gainTarget = 0;
        this.target = 0;
        this.rate = 0;
        this.stopping = false;
      } else if (data.type === 'start') {
        this.pos = (data.positionSec - this.startSec) * this.srcRate;
        this.rate = 0;
        this.target = 0;
        this.gainTarget = 1;
        this.stopping = false;
      } else if (data.type === 'rate') {
        this.target = data.rate;
      } else if (data.type === 'stop') {
        this.gainTarget = 0;
        this.stopping = true;
      }
    };
  }

  seconds() {
    return this.startSec + this.pos / this.srcRate;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    const s = this.samples;
    const step = this.srcRate / sampleRate;
    for (let i = 0; i < frames; i++) {
      this.rate += (this.target - this.rate) * this.rateAlpha;
      if (this.gain < this.gainTarget) this.gain = Math.min(this.gainTarget, this.gain + this.gainStep);
      else if (this.gain > this.gainTarget) this.gain = Math.max(this.gainTarget, this.gain - this.gainStep);
      let v = 0;
      if (s && this.gain > 0) {
        const speed = Math.min(3, Math.abs(this.rate));
        // hiss: white noise with the lows taken out, only while the record moves
        const white = Math.random() * 2 - 1;
        this.hp = 0.92 * (this.hp + white - this.lastWhite);
        this.lastWhite = white;
        // crackle: random clicks, more of them the faster the groove passes the needle
        if (Math.random() < speed * (24 / sampleRate)) this.pop = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.22);
        else this.pop *= this.popDecay;
        const grit = this.hp * 0.035 * Math.min(1, speed) + this.pop * Math.min(1, speed * 2);
        v = (readLinear(s, this.pos) + grit) * this.gain;
      }
      for (let c = 0; c < out.length; c++) out[c][i] = v;
      if (s && this.gain > 0) {
        // stops dead at either end of the decoded stretch instead of reading past it
        this.pos = Math.min(s.length - 1, Math.max(0, this.pos + this.rate * step));
      }
    }
    this.sinceReport += frames;
    if (this.sinceReport >= sampleRate * 0.05) {
      this.sinceReport = 0;
      if (this.gainTarget > 0) this.port.postMessage({ type: 'position', sec: this.seconds() });
    }
    if (this.stopping && this.gain === 0) {
      this.stopping = false;
      this.port.postMessage({ type: 'stopped', sec: this.seconds() });
    }
    return true;
  }
}

registerProcessor('lp-scratch', LpScratch);
