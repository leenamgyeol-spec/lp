import { Player } from './player.js';
import { createCrate } from './crate.js';
import { createTurntable } from './turntable.js';
import { loadCover, designFor } from './vinyl.js';
import { connectMediaSession } from './now-playing.js';
import { DEG_PER_SEC } from './deck-core.js';
import { albumIdFromHash, hashForAlbum } from './router.js';

const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

async function loadAlbums() {
  try {
    const res = await fetch('albums.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.albums) ? data.albums : [];
  } catch {
    return [];
  }
}

const player = new Player();
player.addEventListener('error', (e) => toast(`재생할 수 없는 트랙: ${e.detail.title}`));

const crateScreen = document.getElementById('crate-screen');
const deckScreen = document.getElementById('deck-screen');
const deck = createTurntable(document.getElementById('deck'), player, { notify: toast });
connectMediaSession(player, deck);

const albums = await loadAlbums();
let current = null; // album on the platter

// The room takes its light from a cover: the sleeve in front, or the record on the deck.
function setBackdrop(screen, album) {
  const url = album?.cover ? new URL(album.cover, document.baseURI).href : null;
  screen.style.setProperty('--cover', url ? `url("${url}")` : 'none');
}

const crate = createCrate(document.getElementById('crate'), albums, {
  onPick(album) {
    history.pushState({ fromCrate: true }, '', hashForAlbum(album.id));
    openDeck(album);
  },
  onFront: (album) => setBackdrop(crateScreen, album),
});
document.getElementById('crate-count').textContent =
  albums.length ? `${String(albums.length).padStart(2, '0')} Records` : '';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hideTimers = new Map();
function swapScreens(show, hide) {
  if (!hide.hidden) {
    hide.classList.add('leaving');
    clearTimeout(hideTimers.get(hide));
    hideTimers.set(hide, setTimeout(() => { hide.hidden = true; hide.classList.remove('leaving'); }, reduced ? 0 : 250));
  }
  // a screen coming back before its fade-out finished must not be hidden by that old timer
  clearTimeout(hideTimers.get(show));
  show.classList.remove('leaving');
  show.hidden = false;
  show.classList.add('entering');
  requestAnimationFrame(() => requestAnimationFrame(() => show.classList.remove('entering')));
}

function openDeck(album) {
  crate.hide();
  crate.setNowPlaying(null);
  setBackdrop(deckScreen, album);
  deck.setVisible(true);
  swapScreens(deckScreen, crateScreen);
  if (current !== album) {
    current = album;
    deck.mount(album);
  }
  document.title = `${album.title} — lp`;
}

// The record left on the platter, shown sticking out of its sleeve in the crate.
let recordImage = null;
function syncNowPlaying() {
  document.body.classList.toggle('is-spinning', !!deck.nowPlaying()?.spinning);
  if (crateScreen.hidden || crateScreen.classList.contains('leaving')) return;
  const np = deck.nowPlaying();
  if (!np || np.album !== current) return crate.setNowPlaying(null);
  crate.setNowPlaying({
    id: np.album.id,
    image: recordImage,
    playing: np.playing,
    spinning: np.spinning,
    secPerTurn: 360 / DEG_PER_SEC[np.rpm],
  });
}
deck.onChange(syncNowPlaying);

function openCrate() {
  if (current) crate.focusAlbum(current.id);
  // a record that is playing keeps playing; anything else goes back in its sleeve
  if (current && deck.nowPlaying()?.playing) {
    recordImage = deck.recordImage();
  } else {
    current = null;
    recordImage = null;
    deck.eject();
  }
  deck.setVisible(false);
  swapScreens(crateScreen, deckScreen);
  crate.show();
  syncNowPlaying();
  document.title = current ? `♪ ${current.title} — lp` : 'LP 턴테이블';
}

function route() {
  const id = albumIdFromHash(location.hash);
  const album = id != null ? albums.find((a) => a.id === id) : null;
  if (album) return openDeck(album);
  if (id != null) history.replaceState(null, '', location.pathname + location.search);
  if (!crateScreen.hidden && deckScreen.hidden) return;
  openCrate();
}

document.getElementById('back').addEventListener('click', () => {
  if (history.state?.fromCrate) history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search);
    openCrate();
  }
});
window.addEventListener('popstate', route);

deck.setVisible(false);
route();

// The record tucked in each sleeve gets a label in the cover's main colour.
for (const album of albums) {
  loadCover(album.cover).then((cover) => {
    const { palette } = designFor(album, cover);
    if (palette[0]) crate.setTint(album.id, palette[0]);
  });
}
