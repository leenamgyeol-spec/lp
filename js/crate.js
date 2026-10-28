// The first screen: record sleeves in a cover flow. Flip through them and pull one out.
import { clampIndex, stepFromWheel, stepFromSwipe, coverflowTransform, createWheelGate, clampFloat } from './crate-math.js';

const PICK_MS = 420;
const WHEEL_GAP_MS = 250;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const chevron = (d) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function createCrate(root, albums, { onPick, onFront = () => {} }) {
  root.replaceChildren();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (albums.length === 0) {
    const empty = el('div', 'crate-empty');
    empty.append(
      el('p', null, 'albums/ 폴더에 앨범을 넣어주세요.'),
      el('p', 'crate-empty-hint', '앨범마다 폴더 하나에 cover.jpg와 노래 파일을 넣고 푸시하면 여기에 꽂혀요.'),
    );
    root.append(empty);
    return { show() {}, hide() {}, focusAlbum() {}, setTint() {}, setNowPlaying() {}, element: empty };
  }

  const stage = el('div', 'crate-stage');
  const prev = el('button', 'crate-nav prev');
  prev.type = 'button';
  prev.setAttribute('aria-label', '이전 레코드');
  prev.innerHTML = chevron('M15 5l-7 7 7 7');
  const next = el('button', 'crate-nav next');
  next.type = 'button';
  next.setAttribute('aria-label', '다음 레코드');
  next.innerHTML = chevron('M9 5l7 7-7 7');

  const box = el('div', 'coverflow');
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', '레코드');
  box.tabIndex = 0;
  const list = box;

  const caption = el('div', 'crate-caption');
  caption.setAttribute('aria-live', 'polite');
  const capTitle = el('h2', 'crate-album');
  const capMeta = el('p', 'crate-meta');
  caption.append(capTitle, capMeta);

  stage.append(box, prev, next);
  root.append(stage, caption);

  const cards = albums.map((album, i) => {
    const card = el('div', 'sleeve-card');
    card.setAttribute('role', 'option');
    card.id = `sleeve-${i}`;
    card.setAttribute('aria-label', `${album.title}${album.artist ? `, ${album.artist}` : ''}`);
    const disc = el('span', 'sleeve-disc');
    disc.append(el('span', 'disc-face')); // turns on its own while the sleeve slides
    // a real jacket: printed front, two spines with the title, a top edge and shrink-wrap
    const jacket = el('span', 'jacket');
    if (album.cover) {
      const img = el('img');
      img.src = album.cover;
      img.alt = '';
      img.decoding = 'async';
      img.onerror = () => { img.remove(); jacket.prepend(el('span', 'jacket-plain', album.title)); };
      jacket.append(img);
    } else {
      jacket.append(el('span', 'jacket-plain', album.title));
    }
    const spineText = [album.title, album.artist].filter(Boolean).join('  ·  ');
    const right = el('span', 'spine spine-r');
    right.append(el('span', 'spine-text', spineText));
    const left = el('span', 'spine spine-l');
    left.append(el('span', 'spine-text', spineText));
    const top = el('span', 'spine-top');
    const wrap = el('span', 'wrap');
    const sticker = el('span', 'sticker');
    sticker.append(el('b', null, album.year ? String(album.year) : 'NEW'), el('span', null, 'LP'));
    jacket.append(wrap, sticker);
    card.append(disc, left, right, top, jacket);
    card.addEventListener('click', () => {
      if (moved) return;
      if (i === index) pick();
      else go(i);
    });
    list.append(card);
    return card;
  });

  let index = 0;
  let picking = false;
  let playingId = null; // the album still on the platter, its record half out of the sleeve
  let playingNow = false;

  // pos may be fractional while a finger drags the row
  function layout(pos = index) {
    const size = cards[0].offsetWidth || 300;
    const front = Math.round(pos);
    cards.forEach((card, i) => {
      const t = coverflowTransform(i - pos, size);
      card.style.transform = `translate3d(${t.x}px, 0, ${t.z}px) rotateY(${t.rotY}deg)`;
      card.style.opacity = t.opacity;
      card.style.zIndex = String(t.zIndex);
      card.style.pointerEvents = t.opacity ? '' : 'none';
      card.style.setProperty('--tilt', (t.rotY / 58).toFixed(3)); // moves the shine on the wrap
      const on = i === front;
      card.classList.toggle('is-front', on && pos === index);
      card.setAttribute('aria-selected', String(on));
    });
    if (pos !== index) return;
    list.setAttribute('aria-activedescendant', cards[index].id);
    const a = albums[index];
    onFront(a);
    capTitle.textContent = a.title;
    capMeta.textContent = [a.artist, `${a.tracks.length}곡`, a.id === playingId && (playingNow ? '♪ 재생 중' : '일시정지')]
      .filter(Boolean).join(' · ');
    prev.disabled = index === 0;
    next.disabled = index === albums.length - 1;
  }

  function bump(dir) {
    if (reduced) return;
    box.classList.remove('bump-start', 'bump-end');
    void box.offsetWidth; // restart the animation
    box.classList.add(dir < 0 ? 'bump-start' : 'bump-end');
  }

  function step(delta) {
    if (!delta || picking) return;
    const to = clampIndex(index + delta, albums.length);
    if (to === index) return bump(delta);
    index = to;
    layout();
  }

  function go(i) {
    if (picking) return;
    index = clampIndex(i, albums.length);
    layout();
  }

  function pick() {
    if (picking) return;
    picking = true;
    const card = cards[index];
    card.classList.add('picking');
    setTimeout(() => {
      onPick(albums[index], card);
      picking = false;
    }, reduced ? 0 : PICK_MS);
  }

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  // one sleeve per wheel gesture, however many events a trackpad fires
  const wheelGate = createWheelGate(WHEEL_GAP_MS);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = stepFromWheel(Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
    if (wheelGate(performance.now()) && d) step(d);
  }, { passive: false });

  // drag: the row follows the finger, then springs to the nearest sleeve
  let start = null;
  let moved = false;
  let dragPos = null;
  const STEP_PX = () => (cards[0].offsetWidth || 300) * 0.38;
  stage.addEventListener('pointerdown', (e) => {
    if (picking || e.target.closest?.('button')) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, lastT: performance.now(), vx: 0 };
    moved = false;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!start) return;
    // the button was let go outside the stage: that drag is over
    if (e.pointerType === 'mouse' && e.buttons === 0) return endDrag(e);
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) > 10) moved = true;
    if (dragPos === null && moved && Math.abs(dx) > Math.abs(dy)) {
      box.classList.add('dragging');
      try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const now = performance.now();
    start.vx = (e.clientX - start.lastX) / Math.max(1, now - start.lastT);
    start.lastX = e.clientX; start.lastT = now;
    if (box.classList.contains('dragging')) {
      dragPos = clampFloat(index - dx / STEP_PX(), albums.length);
      layout(dragPos);
    }
  });
  const endDrag = (e) => {
    if (!start) return;
    if (dragPos !== null) {
      // a quick flick carries on a little further
      const fling = Math.abs(start.vx) > 0.6 ? (-start.vx * 100) / STEP_PX() : 0;
      index = clampIndex(Math.round(dragPos + fling), albums.length);
      dragPos = null;
      box.classList.remove('dragging');
      layout();
    } else if (e && e.type === 'pointerup') {
      const d = stepFromSwipe(e.clientX - start.x, e.clientY - start.y);
      if (d) step(d);
    }
    start = null;
    setTimeout(() => { moved = false; }, 0); // let the click that follows a swipe be ignored
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  let active = true;
  document.addEventListener('keydown', (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if ((e.key === 'Enter' || e.code === 'Space') && !e.target.closest?.('button, a')) { e.preventDefault(); pick(); }
  });

  layout();
  addEventListener('resize', () => layout()); // not layout itself: the event would arrive as pos

  return {
    element: stage,
    show() {
      active = true;
      for (const c of cards) c.classList.remove('picking');
      layout();
    },
    hide() { active = false; },
    focusAlbum(id) {
      const i = albums.findIndex((a) => a.id === id);
      if (i >= 0) go(i);
    },
    // np: { id, image?, playing, spinning, secPerTurn } or null when nothing is left playing
    setNowPlaying(np) {
      playingId = np?.id ?? null;
      playingNow = !!np?.playing;
      albums.forEach((album, i) => {
        const card = cards[i];
        const on = album.id === playingId;
        card.classList.toggle('now-playing', on);
        card.classList.toggle('spinning', on && !!np.spinning);
        const face = card.querySelector('.disc-face');
        if (on && np.image) {
          face.style.backgroundImage = `url("${np.image}")`;
          face.classList.add('decorated');
        } else if (!on) {
          face.style.backgroundImage = '';
          face.classList.remove('decorated');
        }
        if (on) card.style.setProperty('--turn', `${np.secPerTurn}s`);
      });
      layout();
    },
    setTint(id, color) {
      const i = albums.findIndex((a) => a.id === id);
      if (i >= 0) {
        cards[i].style.setProperty('--vinyl-label', color);
        cards[i].style.setProperty('--spine', color);
      }
    },
  };
}
