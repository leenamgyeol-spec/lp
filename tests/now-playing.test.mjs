import test from 'node:test';
import assert from 'node:assert/strict';
import { nowPlayingInfo, connectMediaSession } from '../js/now-playing.js';

const album = {
  id: 'channel-orange', title: 'Channel ORANGE', artist: 'Frank Ocean',
  cover: 'albums/channel-orange/cover.jpg',
  tracks: [{ title: 'Start', src: 'a' }, { title: 'Thinkin Bout You', src: 'b' }],
};
const base = 'https://charaing.github.io/lp/';

test('nowPlayingInfo names the current track, artist and album', () => {
  const info = nowPlayingInfo(album, 1, base);
  assert.equal(info.title, 'Thinkin Bout You');
  assert.equal(info.artist, 'Frank Ocean');
  assert.equal(info.album, 'Channel ORANGE');
});

test('artwork is an absolute URL to the cover under the site subpath, with its type', () => {
  const [art] = nowPlayingInfo(album, 0, base).artwork;
  assert.equal(art.src, 'https://charaing.github.io/lp/albums/channel-orange/cover.jpg');
  assert.equal(art.type, 'image/jpeg');
});

test('webp and png covers get the right type', () => {
  assert.equal(nowPlayingInfo({ ...album, cover: 'albums/x/cover.webp' }, 0, base).artwork[0].type, 'image/webp');
  assert.equal(nowPlayingInfo({ ...album, cover: 'albums/x/cover.png' }, 0, base).artwork[0].type, 'image/png');
});

test('an album without a cover falls back to the site icon', () => {
  const [art] = nowPlayingInfo({ ...album, cover: null }, 0, base).artwork;
  assert.equal(art.src, 'https://charaing.github.io/lp/icons/icon-512.png');
  assert.equal(art.sizes, '512x512');
});

test('an out-of-range index uses the album title instead of failing', () => {
  assert.equal(nowPlayingInfo(album, 9, base).title, 'Channel ORANGE');
});

test('the LP picture comes first, the cover stays as a fallback', () => {
  const lp = { src: 'blob:x', sizes: '512x512', type: 'image/png' };
  const art = nowPlayingInfo(album, 0, base, lp).artwork;
  assert.deepEqual(art[0], lp);
  assert.equal(art[1].src, 'https://charaing.github.io/lp/albums/channel-orange/cover.jpg');
});

test('without an LP picture the cover is used', () => {
  assert.equal(nowPlayingInfo(album, 0, base).artwork.length, 1);
});

test('while playing, the lock screen steps through the turned LP pictures', async () => {
  const shown = [];
  const ms = {
    set metadata(m) { if (m) shown.push(m.artwork[0].src); },
    playbackState: 'none',
    setActionHandler() {},
  };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: ms }, configurable: true }); // Node's own is read-only
  globalThis.MediaMetadata = class { constructor(info) { Object.assign(this, info); } };
  globalThis.document = { baseURI: base };
  const audio = new EventTarget();
  audio.currentTime = 0;
  const player = Object.assign(new EventTarget(), { audio, album, index: 0, durations: [10, 10] });
  const deck = { lpArtwork: (step) => `frame-${((step % 12) + 12) % 12}`, onArtwork() {} };
  connectMediaSession(player, deck);
  audio.dispatchEvent(new Event('play'));
  await new Promise((r) => setTimeout(r, 2150));
  audio.dispatchEvent(new Event('pause'));
  const stopped = shown.length;
  await new Promise((r) => setTimeout(r, 1100));
  assert.deepEqual(shown.slice(0, 3), ['frame-0', 'frame-1', 'frame-2']);
  assert.equal(shown.length, stopped); // paused: the picture stops turning
});
