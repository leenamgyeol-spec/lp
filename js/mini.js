// The desktop mini player: one record at a time, spinning while it plays.
// Flip between records with ‹ ›, tap the record or the round key to play or pause.
import { loadCover, designFor, renderVinyl } from './vinyl.js';
import { DEG_PER_SEC } from './deck-core.js';

const $ = (id) => document.getElementById(id);
const recordBtn = $('record'), canvas = recordBtn.querySelector('canvas');
const playBtn = $('play'), trackEl = $('track'), albumEl = $('album'), bar = $('bar'), open = $('open');
const backdrop = document.querySelector('.mini-backdrop');
const audio = new Audio();
audio.preload = 'auto';

let albums = [];
let a = 0;     // record on the platter
let t = 0;     // track on that record
let wantPlay = false;
let drawToken = 0;

const STORE = 'lp-mini';
function remember() {
  try { localStorage.setItem(STORE, JSON.stringify({ id: albums[a]?.id, t })); } catch { /* storage blocked */ }
}
function recalled() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; }
}

async function showRecord() {
  const album = albums[a];
  const mine = ++drawToken;
  albumEl.textContent = [album.title, album.artist].filter(Boolean).join(' · ');
  open.href = `./#${encodeURIComponent(album.id)}`;
  document.body.style.setProperty('--turn', `${360 / DEG_PER_SEC[album.rpm === 45 ? 45 : 33]}s`);
  backdrop.style.backgroundImage = album.cover ? `url("${new URL(album.cover, document.baseURI).href}")` : 'none';
  const cover = await loadCover(album.cover);
  if (mine !== drawToken) return; // flipped on before this cover arrived
  renderVinyl(canvas, album, designFor(album, cover), cover, album.tracks.map(() => 0));
}

function loadTrack(play) {
  const album = albums[a];
  const track = album.tracks[t];
  trackEl.textContent = album.tracks.length > 1 ? `${t + 1}. ${track.title}` : track.title;
  audio.src = track.src;
  bar.style.width = '0%';
  remember();
  if (play) audio.play().catch(() => {});
  if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: album.artist || '', album: album.title,
      artwork: album.cover ? [{ src: new URL(album.cover, document.baseURI).href, sizes: '512x512' }] : [],
    });
  }
}

function setRecord(i, play = wantPlay) {
  a = (i + albums.length) % albums.length;
  t = 0;
  showRecord();
  loadTrack(play);
}

function toggle() {
  if (!albums.length) return;
  if (audio.paused) { wantPlay = true; audio.play().catch(() => {}); }
  else { wantPlay = false; audio.pause(); }
}

function reflect() {
  const playing = !audio.paused;
  document.body.classList.toggle('playing', playing);
  playBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
  recordBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
}

audio.addEventListener('play', reflect);
audio.addEventListener('pause', reflect);
audio.addEventListener('timeupdate', () => {
  if (audio.duration > 0) bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
});
// the side plays through, then the next record goes on
audio.addEventListener('ended', () => {
  if (t < albums[a].tracks.length - 1) { t++; loadTrack(true); }
  else setRecord(a + 1, true);
});

playBtn.addEventListener('click', toggle);
recordBtn.addEventListener('click', toggle);
$('prev').addEventListener('click', () => setRecord(a - 1));
$('next').addEventListener('click', () => setRecord(a + 1));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.target.closest('button, a')) { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowLeft') setRecord(a - 1);
  else if (e.key === 'ArrowRight') setRecord(a + 1);
});
if ('mediaSession' in navigator) {
  const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported */ } };
  on('play', toggle);
  on('pause', toggle);
  on('previoustrack', () => setRecord(a - 1));
  on('nexttrack', () => setRecord(a + 1));
}

try {
  const res = await fetch('albums.json', { cache: 'no-cache' });
  albums = res.ok ? (await res.json()).albums ?? [] : [];
} catch { albums = []; }

if (!albums.length) {
  trackEl.textContent = '레코드가 없어요';
} else {
  const last = recalled();
  const i = albums.findIndex((x) => x.id === last.id);
  a = i >= 0 ? i : 0;
  t = i >= 0 && last.t < albums[a].tracks.length ? last.t : 0;
  showRecord();
  loadTrack(false);
}
reflect();
