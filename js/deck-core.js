// How the turntable behaves, independent of how it is drawn: motor, speed, needle,
// tonearm angle and keeping the audio in step. The 2D and 3D decks both render this state.
import { GROOVE, radiusToTime, timeToRadius, startOf, locate } from './timeline.js';
import { ARM, angleForRadius, radiusForAngle } from './arm.js';
import { armLift } from './deck-geometry.js';

export const DEG_PER_SEC = { 33: 200, 45: 270 };
const NEEDLE_DROP_MS = 350;
const LIFT_MS = 350;
const SWAP_MS = 380;

export const fmt = (sec) => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// view: { setHint(text), loadArt(album) → Promise<{ cover, design, apply? }>, drawVinyl(album, cover, design, durations) }
// apply() runs only if the album is still the one being mounted (e.g. to recolour the deck).
export function createDeckCore(player, view, { now = () => performance.now() } = {}) {
  const s = {
    album: null, phase: 'empty', // 'empty' | 'swapping' | 'loaded'
    motorOn: false, rpm: 33, speed: 0, rotation: 0,
    angle: ARM.rest, lift: 1, needleDown: false, dragging: false, ended: false, audible: false,
    groove: GROOVE, // where the grooves are on this record (changes with size and shape)
    scratching: false, scratchTime: 0, // a hand is turning the record
  };
  let tween = null, liftAnim = null, dropTimer = 0, mountToken = 0, pendingR = null;
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) fn(); };

  view.setHint('레코드를 골라 플래터에 올리세요');

  function setMotor(on) { s.motorOn = on; changed(); }
  function setRpm(rpm) { s.rpm = rpm === 45 ? 45 : 33; changed(); }

  function setNeedle(down) {
    if (s.needleDown === down) return;
    s.needleDown = down;
    liftAnim = { from: s.lift, down, start: now() };
    changed();
  }

  function tweenTo(target, ms = 600) {
    return new Promise((resolve) => {
      tween = { from: s.angle, to: target, start: now(), ms, resolve };
      changed();
    });
  }

  // The needle plays from exactly where it lands, mid-song included; in the run-out it stays silent.
  function seekToTrackUnder(r) {
    player.seek(radiusToTime(r, player.total, s.groove));
  }

  // atSec: an exact time to play from (a track picked from the list), else the groove under r
  function dropNeedleAt(r, atSec = null) {
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => {
      setNeedle(true);
      s.ended = false;
      // Track lengths may still be loading; seek again by position once they arrive.
      pendingR = player.total > 0 ? null : r;
      if (atSec != null && player.total > 0) player.seek(atSec);
      else seekToTrackUnder(r);
      view.setHint('');
      changed();
    }, NEEDLE_DROP_MS);
  }

  function liftNeedle() {
    clearTimeout(dropTimer);
    pendingR = null;
    s.ended = false;
    setNeedle(false);
  }

  async function returnToRest() {
    liftNeedle();
    await tweenTo(ARM.rest);
  }

  function setGroove(groove) {
    s.groove = groove;
    changed();
  }

  // the arm can swing in as far as just past the run-out of this record
  function maxAngle() {
    return angleForRadius(s.groove.inner - 0.04);
  }

  function startDrag() {
    s.dragging = true;
    tween = null;
    liftNeedle();
    changed();
  }

  function dragTo(angle) {
    if (s.dragging) s.angle = Math.min(angle, maxAngle());
  }

  function endDrag() {
    if (!s.dragging) return;
    s.dragging = false;
    const r = radiusForAngle(s.angle);
    // there is no play key: setting the needle on the record starts it, parking the arm stops it
    if (s.album && r <= s.groove.outer + 0.02) { setMotor(true); dropNeedleAt(r); }
    else { setMotor(false); returnToRest(); }
    changed();
  }

  async function togglePlay() {
    if (!s.album) return;
    if (!s.needleDown) {
      setMotor(true);
      await tweenTo(angleForRadius(s.groove.outer));
      dropNeedleAt(s.groove.outer);
      return;
    }
    setMotor(!s.motorOn);
  }

  // A song picked from the track list: the arm swings to the start of its groove and drops there.
  async function playTrack(index) {
    if (!s.album || s.dragging || s.scratching) return;
    const durations = player.durations;
    const i = Math.max(0, Math.min(s.album.tracks.length - 1, index));
    const t = startOf(durations, i);
    setMotor(true);
    s.ended = false;
    if (s.needleDown) { // already playing: the needle hops across
      player.seek(t);
      changed();
      return;
    }
    const r = player.total > 0 ? timeToRadius(t, player.total, s.groove) : s.groove.outer;
    await tweenTo(angleForRadius(r));
    dropNeedleAt(r, t);
  }

  function skip(delta) {
    if (!s.album || !s.needleDown) return;
    const durations = player.durations;
    const { index, offset } = locate(durations, player.time);
    let target = index + delta;
    if (delta < 0 && offset > 3) target = index; // restart the current track first
    target = Math.max(0, Math.min(durations.length - 1, target));
    s.ended = false;
    player.seek(startOf(durations, target));
    changed();
  }

  player.addEventListener('durations', () => {
    if (pendingR != null && s.needleDown) seekToTrackUnder(pendingR);
    pendingR = null;
  });

  player.addEventListener('ended', () => {
    if (!s.needleDown) return;
    s.ended = true;
    s.audible = false;
    s.angle = angleForRadius(s.groove.inner - 0.03);
    changed();
  });

  // Advance everything that moves by dt seconds. Returns true if anything visible changed.
  function tick(dt, t = now()) {
    const step = Math.min(0.1, Math.max(0, dt));
    const before = [s.rotation, s.angle, s.lift];
    const target = s.motorOn ? DEG_PER_SEC[s.rpm] : 0;
    if (!s.scratching) { // while a hand holds the record, the hand turns it
      s.speed += (target - s.speed) * (1 - Math.exp(-step / 0.25));
      if (Math.abs(s.speed) < 0.05 && !s.motorOn) s.speed = 0;
      s.rotation = (s.rotation + s.speed * step) % 360;
    }

    if (tween) {
      const k = Math.min(1, (t - tween.start) / tween.ms);
      s.angle = tween.from + (tween.to - tween.from) * (1 - (1 - k) ** 3);
      if (k === 1) { const done = tween.resolve; tween = null; done(); }
    } else if (s.needleDown && !s.dragging && !s.scratching && !s.ended && player.total > 0) {
      // follows the music, so after the page was hidden the arm jumps straight to where playback is
      s.angle = angleForRadius(timeToRadius(player.time, player.total, s.groove));
    }

    if (liftAnim) {
      const k = Math.min(1, (t - liftAnim.start) / LIFT_MS);
      s.lift = liftAnim.down ? liftAnim.from * armLift(k) : liftAnim.from + (1 - liftAnim.from) * (1 - (1 - k) ** 3);
      if (k === 1) { s.lift = liftAnim.down ? 0 : 1; liftAnim = null; }
    }

    const shouldPlay = s.album && s.needleDown && s.motorOn && !s.dragging && !s.scratching && !s.ended && s.speed > target * 0.6;
    if (shouldPlay && !s.audible) { s.audible = true; player.play(); }
    else if (!shouldPlay && s.audible) { s.audible = false; player.pause(); }

    return before[0] !== s.rotation || before[1] !== s.angle || before[2] !== s.lift;
  }

  function idle() {
    return s.speed === 0 && !s.motorOn && !tween && !liftAnim && !s.dragging && !s.scratching;
  }

  function info() {
    if (!s.album) return { title: '', artist: '', line: '', ariaNow: 0, ariaMax: 0, ariaText: '거치대에 있음' };
    const total = player.total;
    const now = s.scratching ? s.scratchTime : player.time;
    const { index, offset } = locate(player.durations, now);
    const track = s.album.tracks[index];
    let line;
    if (s.ended) line = `끝까지 들었어요  ${fmt(total)}`;
    else if (s.needleDown) line = `${index + 1}/${s.album.tracks.length}  ${track?.title ?? ''}   ${fmt(offset)} / ${fmt(player.durations[index])}`;
    else line = `${s.album.tracks.length}곡  ${fmt(total)}`;
    return {
      title: s.album.title,
      artist: s.album.artist || '',
      line,
      ariaNow: Math.round(s.needleDown ? now : 0),
      ariaMax: Math.round(total),
      ariaText: s.needleDown ? `${track?.title ?? ''} ${fmt(offset)}` : '거치대에 있음',
    };
  }

  async function mount(album) {
    const token = ++mountToken;
    s.scratching = false;
    s.ended = false;
    s.audible = false;
    player.pause();
    if (s.album) {
      returnToRest();
      s.phase = 'swapping';
      changed();
      await new Promise((r) => setTimeout(r, SWAP_MS));
    } else {
      liftNeedle();
    }
    if (token !== mountToken) return;
    s.album = album;
    // Start loading audio before the cover so an early needle drop seeks this album.
    const loading = player.load(album);
    s.audible = false; // load() paused the player
    if (s.needleDown) returnToRest(); // dropped on the outgoing record during the swap
    const { cover, design, apply } = await view.loadArt(album);
    if (token !== mountToken) return; // another record went on while this cover loaded
    apply?.();
    setRpm(album.rpm);
    view.drawVinyl(album, cover, design, album.tracks.map(() => 0));
    s.phase = 'loaded';
    view.setHint('톤암을 레코드 위로 끌어다 놓으세요');
    changed();
    const durations = await loading;
    if (token !== mountToken) return;
    view.drawVinyl(album, cover, design, durations);
    changed();
  }

  // ---- spinning the record by hand ----
  // While scratching the audio comes from the scratch engine, so the player stays paused.
  function startScratch() {
    s.scratching = true;
    s.scratchTime = player.time;
    s.audible = false;
    player.pause();
    changed();
  }

  function scratchTo(rotationDeg, albumTimeSec) {
    if (!s.scratching) return;
    s.rotation = ((rotationDeg % 360) + 360) % 360;
    s.scratchTime = albumTimeSec;
    if (s.needleDown && !s.ended && player.total > 0) {
      s.angle = angleForRadius(timeToRadius(albumTimeSec, player.total, s.groove));
    }
  }

  function endScratch(albumTimeSec) {
    if (!s.scratching) return;
    s.scratching = false;
    if (s.needleDown) {
      s.ended = false;
      player.seek(albumTimeSec); // the run-out still stops the record
    }
    s.speed = s.motorOn ? DEG_PER_SEC[s.rpm] : 0; // the motor takes the record straight back
    changed();
  }

  function eject() {
    s.scratching = false;
    mountToken++;
    s.album = null;
    s.phase = 'empty';
    s.audible = false;
    player.unload();
    setMotor(false);
    returnToRest();
    view.setHint('레코드를 골라 플래터에 올리세요');
    changed();
  }

  // Lock screen and Dynamic Island buttons. They can arrive while the page is hidden and
  // animation frames are paused, so they set the state and drive the player directly.
  function remotePlay() {
    if (!s.album) return;
    if (!s.needleDown || s.ended) {
      tween = null;
      s.angle = angleForRadius(s.groove.outer);
      setNeedle(true);
      s.ended = false;
      player.seek(0);
      view.setHint('');
    }
    setMotor(true);
    s.speed = DEG_PER_SEC[s.rpm];
    s.audible = true;
    player.play();
  }

  function remotePause() {
    setMotor(false);
    s.audible = false;
    player.pause();
  }

  return {
    state: s,
    tick, idle, info, setGroove, maxAngle, startScratch, scratchTo, endScratch,
    startDrag, dragTo, endDrag,
    setMotor, toggleMotor: () => setMotor(!s.motorOn), setRpm, togglePlay, skip, playTrack,
    remotePlay, remotePause, mount, eject,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// Space plays or pauses, ← → change tracks — except while typing or on a focused button.
export function bindDeckKeys(core, isActive = () => true) {
  document.addEventListener('keydown', (e) => {
    if (!isActive() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('button, input, textarea, select, a')) return;
    if (e.code === 'Space') { e.preventDefault(); core.togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); core.skip(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); core.skip(-1); }
  });
}
