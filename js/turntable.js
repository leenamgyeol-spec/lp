// The turntable seen from straight above: a solid-colour body taking its colour from the
// album, a black record with the cover as its label, a silver tonearm and three round keys.
// Behaviour lives in deck-core.js; this file draws it and turns input into calls on the core.
import { PLINTH, PIVOT, ARM_LENGTH, clampAngle } from './arm.js';
import { loadCover, designFor, renderVinyl, coverPalette } from './vinyl.js';
import { deckColors, rgbToHsl, hexToRgb } from './palette.js';
import { createDeckCore, bindDeckKeys } from './deck-core.js';
import { defaultLook, mergeLook, normalizeLook, lookDiff, albumJsonSnippet, grooveFor, SIZE_FACTOR, INSCRIBED } from './look.js';
import { createLookStore } from './look-store.js';
import { createCustomizer } from './customizer.js';
import { createScratchEngine } from './scratch.js';
import { unwrapDelta, rateFromVelocity, smoothVelocity } from './scratch-math.js';
import { locate, startOf } from './timeline.js';

// tonearm metal: tube gradient stops and pivot dome stops
const ARM_METAL = {
  silver: { tube: ['#8d9190', '#ffffff', '#c9cccb', '#7c807f'], dome: ['#ffffff', '#c3c6c5', '#6f7372'] },
  gold: { tube: ['#7d5f26', '#fff2c8', '#d9b566', '#6e5220'], dome: ['#fff6d8', '#d4b062', '#6e5220'] },
  black: { tube: ['#0b0b0b', '#5a5a5a', '#262626', '#0a0a0a'], dome: ['#6a6a6a', '#262626', '#050505'] },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// The arm is drawn pointing straight down (90°) from the pivot and rotated into place.
function buildArm() {
  const root = svg('svg', { class: 'tt-arm', viewBox: `0 0 ${PLINTH.w} ${PLINTH.h}` });
  const P = PIVOT, tip = P.y + ARM_LENGTH;
  root.innerHTML = `
    <defs>
      <linearGradient id="tt-tube" x1="0" x2="1">
        <stop offset="0" stop-color="#8d9190"/><stop offset=".35" stop-color="#ffffff"/><stop offset=".6" stop-color="#c9cccb"/><stop offset="1" stop-color="#7c807f"/>
      </linearGradient>
      <radialGradient id="tt-dome" cx=".38" cy=".32" r=".75">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#c3c6c5"/><stop offset="1" stop-color="#6f7372"/>
      </radialGradient>
      <linearGradient id="tt-shell" x1="0" x2="1">
        <stop offset="0" stop-color="#0d0d0d"/><stop offset=".5" stop-color="#2a2a2a"/><stop offset="1" stop-color="#0d0d0d"/>
      </linearGradient>
      <filter id="tt-arm-shadow" x="-30%" y="-10%" width="160%" height="130%">
        <feDropShadow id="tt-arm-shadow-offset" dx="14" dy="16" stdDeviation="7" flood-color="#000" flood-opacity=".32"/>
      </filter>
    </defs>`;

  // the base the arm turns on, set into the body
  root.append(
    svg('circle', { cx: P.x, cy: P.y, r: 92, fill: 'rgba(0,0,0,.12)' }),
    svg('circle', { cx: P.x, cy: P.y, r: 86, fill: 'url(#tt-dome)', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 2 }),
    svg('circle', { cx: P.x, cy: P.y, r: 58, fill: 'none', stroke: 'rgba(0,0,0,.18)', 'stroke-width': 2 }),
  );
  // the rest the arm parks on
  root.append(svg('rect', { x: P.x - 20, y: P.y + 452, width: 40, height: 30, rx: 10, fill: '#1a1a1a', opacity: '.85' }));

  const arm = svg('g', { class: 'arm', filter: 'url(#tt-arm-shadow)' });
  arm.append(
    // counterweight behind the pivot
    svg('rect', { x: P.x - 30, y: P.y - 122, width: 60, height: 84, rx: 12, fill: 'url(#tt-tube)', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 2 }),
    svg('rect', { x: P.x - 30, y: P.y - 66, width: 60, height: 8, fill: '#151515' }),
    // the tube
    svg('rect', { x: P.x - 9, y: P.y - 40, width: 18, height: ARM_LENGTH - 70, rx: 9, fill: 'url(#tt-tube)' }),
    svg('circle', { cx: P.x, cy: P.y, r: 30, fill: 'url(#tt-dome)', stroke: 'rgba(0,0,0,.3)', 'stroke-width': 2 }),
  );
  // headshell and cartridge, angled like a real offset headshell; the stylus is exactly at the tip
  const head = svg('g', { transform: `rotate(22 ${P.x} ${tip})` });
  head.append(
    svg('rect', { x: P.x - 26, y: tip - 96, width: 52, height: 112, rx: 10, fill: 'url(#tt-shell)' }),
    svg('rect', { x: P.x + 26, y: tip - 86, width: 34, height: 10, rx: 5, fill: 'url(#tt-tube)' }),
    svg('rect', { x: P.x - 16, y: tip - 44, width: 32, height: 50, rx: 4, fill: '#3a3a3a' }),
    svg('circle', { cx: P.x, cy: tip, r: 4, fill: '#ff8a1f' }),
  );
  arm.append(head);
  const grab = svg('circle', { class: 'arm-grab', cx: P.x, cy: tip - 60, r: 95, fill: 'transparent' });
  arm.append(grab);
  root.append(arm);
  return { root, arm, grab, shadow: root.querySelector('#tt-arm-shadow-offset') };
}

const icon = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M18 6l-9 6 9 6z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M6 6l9 6-9 6z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
};

export function createTurntable(root, player, { notify = () => {} } = {}) {
  root.replaceChildren();
  const tt = document.createElement('div');
  tt.className = 'tt';
  tt.innerHTML = `
    <div class="tt-record empty">
      <div class="tt-mat"></div>
      <div class="tt-slot">
        <div class="tt-record-shadow"></div>
        <div class="tt-spin"><canvas width="1024" height="1024"></canvas></div>
        <div class="tt-sheen"></div>
      </div>
      <div class="tt-spindle"></div>
    </div>
    <span class="tt-pilot" aria-hidden="true"></span>
    <div class="tt-speed" role="group" aria-label="회전 속도">
      <button type="button" data-rpm="33" aria-pressed="true">33</button>
      <button type="button" data-rpm="45" aria-pressed="false">45</button>
    </div>
    <div class="tt-controls">
      <button type="button" class="tt-btn play" aria-pressed="false"><span class="key"></span><span class="cap">PLAY</span></button>
      <div class="group">
        <button type="button" class="tt-btn prev" aria-label="이전 곡"><span class="key"></span><span class="cap">${icon.prev}</span></button>
        <button type="button" class="tt-btn next" aria-label="다음 곡"><span class="key"></span><span class="cap">${icon.next}</span></button>
      </div>
    </div>`;
  const { root: armLayer, arm, grab, shadow } = buildArm();
  tt.querySelector('.tt-record').after(armLayer);

  const side = document.createElement('div');
  side.className = 'deck-side';
  side.innerHTML = '<div class="nowplaying" aria-live="off"><p class="eyebrow np-eyebrow"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="np-state"></span></p><p class="np-title"></p><p class="np-artist"></p><p class="np-track"></p></div><p class="deck-hint"></p>';
  root.append(tt, side);

  const q = (sel) => tt.querySelector(sel);
  const record = q('.tt-record'), spin = q('.tt-spin'), canvas = q('canvas');
  const playBtn = q('.tt-btn.play'), playCap = playBtn.querySelector('.cap');
  const hint = side.querySelector('.deck-hint');
  const npState = side.querySelector('.np-state');
  const npTitle = side.querySelector('.np-title'), npArtist = side.querySelector('.np-artist'), npTrack = side.querySelector('.np-track');

  arm.setAttribute('tabindex', '0');
  arm.setAttribute('role', 'slider');
  arm.setAttribute('aria-label', '톤암');
  arm.setAttribute('aria-valuemin', '0');

  const screen = root.closest('.deck-screen');
  const store = createLookStore();
  const sheen = q('.tt-sheen');
  const tubeStops = armLayer.querySelectorAll('#tt-tube stop'), domeStops = armLayer.querySelectorAll('#tt-dome stop');
  let current = null; // { album, cover, palette, base, look }

  // Everything a look changes besides the record drawing itself.
  function applyLook(c) {
    const { look, palette } = c;
    let colors = deckColors(palette);
    if (look.deck.body !== 'auto') {
      const l = rgbToHsl(...hexToRgb(look.deck.body))[2];
      colors = { body: look.deck.body, bg: deckColors([look.deck.body]).bg, ink: l >= 0.52 ? '#1c1a18' : '#f4efe6' };
    }
    for (const [k, v] of Object.entries({ '--deck-body': colors.body, '--deck-bg': colors.bg, '--deck-ink': colors.ink })) {
      (screen ?? root).style.setProperty(k, v);
    }
    core.setGroove(grooveFor(look));
    // the reflection sits over the grooved part of this record only
    record.classList.toggle('shaped', look.vinyl.shape !== 'round');
    record.style.setProperty('--rec', `${SIZE_FACTOR[look.vinyl.size] * 100}%`);
    const span = SIZE_FACTOR[look.vinyl.size] * INSCRIBED[look.vinyl.shape];
    sheen.style.setProperty('--span', `${span * 100}%`);
    sheen.style.setProperty('--hole', `${(look.label.size / INSCRIBED[look.vinyl.shape]) * 100}%`);
    // gloss 0–0.6 fades the reflection in, 0.6–1 makes it brighter
    sheen.style.opacity = String(Math.min(1, look.finish.gloss / 0.6));
    sheen.style.filter = `brightness(${1 + Math.max(0, look.finish.gloss - 0.6) * 2.5})`;
    const metal = ARM_METAL[look.deck.arm];
    tubeStops.forEach((st, i) => st.setAttribute('stop-color', metal.tube[i]));
    domeStops.forEach((st, i) => st.setAttribute('stop-color', metal.dome[i]));
  }

  let saveTimer = 0, drawQueued = false;
  function lookChanged(look) {
    current.look = look;
    current.design = designFor(current.album, current.cover, look, current.palette);
    applyLook(current);
    if (!drawQueued) {
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        if (current && lastDraw) draw(current.album, current.cover, current.design, lastDraw[3]);
      });
    }
    clearTimeout(saveTimer);
    const { album, base } = current;
    saveTimer = setTimeout(() => store.save(album.id, lookDiff(look, base)), 200);
  }

  const customizer = createCustomizer(screen ?? root, {
    change: lookChanged,
    reset() {
      if (!current) return;
      store.clear(current.album.id);
      lookChanged(current.base);
      clearTimeout(saveTimer);
      store.clear(current.album.id);
      customizer.refresh(current.base);
    },
    copy: () => albumJsonSnippet(current.album, current.look, normalizeLook({})),
    notify,
  });

  const core = createDeckCore(player, {
    setHint(text) { hint.textContent = text; hint.hidden = !text; },
    async loadArt(album) {
      const cover = await loadCover(album.cover);
      const palette = coverPalette(cover);
      const base = defaultLook(album, palette, !!cover);
      const look = mergeLook(base, store.load(album.id));
      const design = designFor(album, cover, look, palette);
      const apply = () => {
        current = { album, cover, palette, base, look, design };
        applyLook(current);
        customizer.attach({ album, look, palette, available: store.available });
      };
      return { cover, design, apply };
    },
    // once tweaked, draw the current look even when deck-core redraws with the one it loaded
    drawVinyl: (album, cover, design, durations) => draw(album, cover, current?.album === album ? current.design : design, durations),
  });
  const s = core.state;

  // ---- tonearm dragging ----
  function pointerAngle(e) {
    const m = armLayer.getScreenCTM();
    if (!m) return s.angle;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return clampAngle((Math.atan2(p.y - PIVOT.y, p.x - PIVOT.x) * 180) / Math.PI, core.maxAngle());
  }
  grab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { grab.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    core.startDrag();
  });
  grab.addEventListener('pointermove', (e) => core.dragTo(pointerAngle(e)));
  grab.addEventListener('pointerup', () => core.endDrag());
  grab.addEventListener('pointercancel', () => core.endDrag());

  // ---- spinning the record by hand (scratching) ----
  const engine = createScratchEngine();
  const GRAB_DEG = 3; // a tap is not a scratch: the record must actually move first
  let touch = null;   // finger on the record, not yet turning it
  let sc = null;      // { lastAngle, rotation, vel, lastT, trackStart, pos, dur, ready, idle, index }
  let releasing = null; // the last scratch while its sound fades out, so a quick re-grab carries on
  const angleAt = (e) => {
    const r = record.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const clampPos = (p, dur) => Math.max(0, Math.min(dur, p));

  record.addEventListener('pointerdown', (e) => {
    if (!s.album || s.phase !== 'loaded' || sc || touch) return;
    const r = record.getBoundingClientRect();
    const half = r.width / 2;
    const dist = Math.hypot(e.clientX - (r.left + half), e.clientY - (r.top + half));
    if (dist > half * SIZE_FACTOR[current?.look.vinyl.size ?? 12]) return; // the mat, not the record
    if (dist < half * 0.12) return; // at the spindle a tiny move is a huge angle
    e.preventDefault();
    try { record.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    engine.wake();
    touch = { angle: angleAt(e), moved: 0 };
  });

  function beginScratch() {
    const t = touch;
    touch = null;
    // carry on from a scratch whose sound is still fading out, else from where the music is
    const from = releasing;
    releasing = null;
    let index, trackStart, pos, dur;
    if (from) {
      ({ index, trackStart, dur } = from);
      pos = from.pos;
    } else {
      const loc = locate(player.durations, player.time);
      index = loc.index;
      trackStart = startOf(player.durations, index);
      pos = loc.offset;
      dur = player.durations[index] || 0;
    }
    const mine = { lastAngle: t.angle, rotation: s.rotation, vel: 0, lastT: performance.now(), trackStart, pos, dur, index, ready: false, idle: 0 };
    sc = mine;
    if (!from) core.startScratch();
    core.scratchTo(mine.rotation, trackStart + pos);
    record.classList.add('scratching');
    if (s.needleDown && engine.supported && dur > 0) {
      // decoding takes a moment the first time; the record turns meanwhile and sound joins in
      engine.prepare(s.album.tracks[index].src, pos, dur).then((ok) => {
        if (!ok || sc !== mine) return;
        mine.ready = true;
        engine.start(mine.pos);
        engine.setRate(rateFromVelocity(mine.vel, s.rpm));
      });
    }
  }

  record.addEventListener('pointermove', (e) => {
    if (touch) {
      touch.moved += Math.abs(unwrapDelta(touch.angle, angleAt(e)));
      if (touch.moved < GRAB_DEG) return;
      beginScratch();
    }
    if (!sc) return;
    const now = performance.now();
    const a = angleAt(e);
    const d = unwrapDelta(sc.lastAngle, a);
    const dt = Math.max(0.001, (now - sc.lastT) / 1000);
    sc.lastAngle = a;
    sc.lastT = now;
    sc.rotation += d;
    sc.vel = smoothVelocity(sc.vel, d / dt, dt);
    const rate = s.needleDown ? rateFromVelocity(sc.vel, s.rpm) : 0;
    if (sc.ready) engine.setRate(rate);
    else sc.pos = clampPos(sc.pos + rate * dt, sc.dur);
    core.scratchTo(sc.rotation, sc.trackStart + sc.pos);
    // a hand that stops moving stops the sound
    clearTimeout(sc.idle);
    const held = sc;
    sc.idle = setTimeout(() => { if (sc === held) { held.vel = 0; if (held.ready) engine.setRate(0); } }, 80);
  });

  engine.onPosition((sec) => {
    if (!sc?.ready) return;
    sc.pos = clampPos(sec, sc.dur);
    core.scratchTo(sc.rotation, sc.trackStart + sc.pos);
  });

  async function releaseRecord() {
    engine.wake(); // iOS unlocks audio when a touch ends
    if (touch) { touch = null; return; } // just a tap: the music never stopped
    if (!sc) return;
    const done = sc;
    sc = null;
    clearTimeout(done.idle);
    record.classList.remove('scratching');
    releasing = done;
    const pos = done.ready ? await engine.stop() : done.pos;
    if (releasing !== done) return; // grabbed again while fading out: that scratch carries on
    releasing = null;
    core.endScratch(done.trackStart + clampPos(pos, done.dur));
  }
  record.addEventListener('pointerup', releaseRecord);
  record.addEventListener('pointercancel', releaseRecord);

  // leaving the record mid-scratch (eject, another album): drop the grab and its sound
  function dropGrab() {
    if (sc) clearTimeout(sc.idle);
    touch = null;
    sc = null;
    releasing = null;
    record.classList.remove('scratching');
    engine.stop();
  }

  // ---- keys ----
  playBtn.addEventListener('click', () => { engine.wake(); core.togglePlay(); });
  q('.tt-btn.prev').addEventListener('click', () => core.skip(-1));
  q('.tt-btn.next').addEventListener('click', () => core.skip(1));
  for (const b of tt.querySelectorAll('.tt-speed button')) b.addEventListener('click', () => core.setRpm(Number(b.dataset.rpm)));
  let active = true;
  bindDeckKeys(core, () => active);

  // ---- frame loop ----
  let last = performance.now();
  let lastText = 0;
  function frame(now) {
    // the deck keeps running behind the crate, so a record left playing carries on
    core.tick((now - last) / 1000, now);
    if (active) {
      spin.style.transform = `rotate(${s.rotation}deg)`;
      arm.setAttribute('transform', `rotate(${s.angle - 90} ${PIVOT.x} ${PIVOT.y})`);
      const lift = Math.max(0, s.lift);
      shadow.setAttribute('dx', 6 + 14 * lift);
      shadow.setAttribute('dy', 7 + 16 * lift);
      shadow.setAttribute('stdDeviation', 4 + 6 * lift);
      tt.classList.toggle('dragging', s.dragging);
      if (now - lastText > 250) { lastText = now; updateText(); }
    }
    last = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function updateText() {
    const playing = s.motorOn && s.needleDown;
    playCap.textContent = playing ? 'STOP' : 'PLAY';
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.setAttribute('aria-label', playing ? '정지' : '재생');
    tt.classList.toggle('motor-on', s.motorOn);
    side.classList.toggle('is-playing', playing && !s.ended);
    npState.textContent = !s.album ? '' : s.ended ? 'Side finished' : playing ? 'Now playing' : s.needleDown ? 'Paused' : 'On the platter';
    for (const b of tt.querySelectorAll('.tt-speed button')) b.setAttribute('aria-pressed', String(Number(b.dataset.rpm) === s.rpm));
    record.classList.toggle('empty', s.phase !== 'loaded');
    const i = core.info();
    npTitle.textContent = i.title;
    npArtist.textContent = i.artist;
    npTrack.textContent = i.line;
    arm.setAttribute('aria-valuemax', String(i.ariaMax));
    arm.setAttribute('aria-valuenow', String(i.ariaNow));
    arm.setAttribute('aria-valuetext', i.ariaText);
  }
  core.onChange(updateText);

  // ---- lock-screen picture: the record as it looks now, on the deck's background ----
  let artworkUrl = null;
  const artworkListeners = new Set();
  let artTimer = 0;
  function scheduleArtwork(delay = 500) {
    clearTimeout(artTimer);
    artTimer = setTimeout(buildArtwork, delay);
  }
  function buildArtwork() {
    if (!current || !lastDraw) return;
    const { album } = current;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = getComputedStyle(screen ?? root).getPropertyValue('--deck-bg').trim() || '#f3f1ec';
    ctx.fillRect(0, 0, 512, 512);
    const rc = document.createElement('canvas');
    rc.width = rc.height = 456;
    renderVinyl(rc, album, current.design, current.cover, lastDraw[3]);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(rc, 28, 22);
    // a data: URL, not blob:, so the system's Now Playing can always read it
    artworkUrl = c.toDataURL('image/jpeg', 0.86);
    for (const fn of artworkListeners) fn();
  }

  // Draw the record at the size it is shown, so grooves don't alias into stripes on phones.
  let lastDraw = null;
  function draw(album, cover, design, durations) {
    lastDraw = [album, cover, design, durations];
    scheduleArtwork();
    const shown = record.offsetWidth * (window.devicePixelRatio || 1);
    const px = shown > 0 ? Math.min(1400, Math.max(256, Math.round(shown))) : 1024;
    if (canvas.width !== px) canvas.width = canvas.height = px;
    renderVinyl(canvas, album, design, cover, durations);
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (lastDraw && s.album === lastDraw[0]) draw(...lastDraw); }, 200);
  });

  return {
    mount(album) {
      dropGrab();
      return core.mount(album);
    },
    eject() {
      dropGrab();
      current = null;
      clearTimeout(artTimer);
      artworkUrl = null;
      customizer.detach();
      core.eject();
    },
    remotePlay: core.remotePlay,
    remotePause: core.remotePause,
    skip: core.skip,
    setVisible(on) { active = on; },
    // what the crate shows on the sleeve of the record left on the platter
    nowPlaying() {
      if (!s.album || s.phase !== 'loaded') return null;
      return { album: s.album, playing: s.motorOn && s.needleDown && !s.ended, spinning: s.motorOn, rpm: s.rpm };
    },
    // the record as it is decorated now, drawn small and without a background
    recordImage(px = 480) {
      if (!current || !lastDraw) return null;
      const c = document.createElement('canvas');
      c.width = c.height = px;
      renderVinyl(c, current.album, current.design, current.cover, lastDraw[3]);
      return c.toDataURL('image/png');
    },
    onChange: core.onChange,
    lpArtwork: () => artworkUrl,
    onArtwork(fn) { artworkListeners.add(fn); },
  };
}
