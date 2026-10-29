// Plays an album as one continuous timeline across its tracks.
import { locate, startOf } from './timeline.js';

export function nextPlayableIndex(failed, from, count) {
  for (let i = from + 1; i < count; i++) if (!failed.has(i)) return i;
  return -1;
}

function measure(src) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d) => { clearTimeout(timer); a.removeAttribute('src'); a.load(); resolve(d); }; // load() with no src frees the connection
    const timer = setTimeout(() => done(null), 15000);
    a.addEventListener('loadedmetadata', () => done(Number.isFinite(a.duration) ? a.duration : null), { once: true });
    a.addEventListener('error', () => done(null), { once: true });
    a.src = src;
  });
}

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.album = null;
    this.durations = [];
    this.failed = new Set();
    this._index = 0;
    this._want = false; // the needle is down and the platter is spinning
    this._loadToken = 0;
    this._pendingOffset = null; // where to jump once the current src has metadata
    this.audio.addEventListener('ended', () => this._advance());
    this.audio.addEventListener('loadedmetadata', () => {
      if (this._pendingOffset == null) return;
      this.audio.currentTime = this._pendingOffset;
      this._pendingOffset = null;
      if (this._want) this.audio.play().catch(() => {});
    });
    this.audio.addEventListener('error', () => {
      if (!this.album || !this.audio.getAttribute('src')) return;
      this._pendingOffset = null;
      this._fail(this._index);
      if (this._want) this._advance();
    });
  }

  _fail(index) {
    if (this.failed.has(index)) return;
    this.failed.add(index);
    this._emit('error', { index, title: this.album.tracks[index].title });
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async load(album) {
    const token = ++this._loadToken;
    this.pause();
    this.album = album;
    this.failed = new Set();
    this.durations = album.tracks.map(() => 0);
    this._index = 0;
    this._pendingOffset = null;
    this.audio.src = album.tracks[0].src;
    const measured = await Promise.all(album.tracks.map((t) => measure(t.src)));
    if (token !== this._loadToken) return this.durations;
    this.durations = measured.map((d) => d ?? 0);
    measured.forEach((d, i) => { if (d == null) this._fail(i); });
    this._emit('durations', { durations: this.durations });
    return this.durations;
  }

  // The record came off the platter: stop, forget the album and free the audio.
  unload() {
    this._loadToken++;
    this.pause();
    this.album = null;
    this.durations = [];
    this.failed = new Set();
    this._index = 0;
    this._pendingOffset = null;
    this.audio.removeAttribute('src');
    this.audio.load();
    this._emit('unload');
  }

  get total() { return this.durations.reduce((a, d) => a + d, 0); }
  get index() { return this._index; }
  get playing() { return !this.audio.paused; }
  // 0–1. iOS ignores this (the phone's buttons set the volume) — see canSetVolume.
  get volume() { return this.audio.volume; }
  set volume(v) { this.audio.volume = Math.max(0, Math.min(1, v)); }

  get time() { return startOf(this.durations, this._index) + (this.audio.currentTime || 0); }

  seek(t) {
    if (!this.album) return;
    if (this.total > 0 && t >= this.total) return this._runOut();
    const { index, offset } = locate(this.durations, t);
    this._setTrack(index, offset);
  }

  _setTrack(index, offset) {
    const src = this.album.tracks[index].src;
    const changed = index !== this._index;
    this._index = index;
    if (changed || this.audio.getAttribute('src') !== src) {
      this._pendingOffset = offset;
      this.audio.src = src;
    } else if (this._pendingOffset != null) {
      this._pendingOffset = offset; // metadata still loading; the newest seek wins
    } else {
      this.audio.currentTime = offset;
    }
    if (changed) this._emit('track', { index });
  }

  // The needle sits in the run-out groove: stop at the end of the last track.
  _runOut() {
    const last = this.album.tracks.length - 1;
    this._pendingOffset = null;
    if (this._index !== last) { this._index = last; this.audio.src = this.album.tracks[last].src; this._emit('track', { index: last }); }
    this._want = false;
    this.audio.pause();
    this._emit('ended', { natural: false });
  }

  _advance() {
    const next = nextPlayableIndex(this.failed, this._index, this.album.tracks.length);
    if (next === -1) {
      this._want = false;
      this.audio.pause();
      this._emit('ended', { natural: true }); // the side played out on its own
      return;
    }
    this._setTrack(next, 0);
  }

  async play() {
    this._want = true;
    if (this.failed.has(this._index)) return this._advance();
    try { await this.audio.play(); } catch { /* reported through the audio 'error' event */ }
  }

  pause() {
    this._want = false;
    this.audio.pause();
  }
}
