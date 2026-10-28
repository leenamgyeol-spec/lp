// Tells the phone what is playing, so the lock screen and the Dynamic Island show the
// song, the album and its cover, and their buttons control the turntable.
import { startOf } from './timeline.js';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

export function nowPlayingInfo(album, index, baseHref, lpArtwork = null) {
  const cover = album.cover
    ? { src: new URL(album.cover, baseHref).href, sizes: '512x512', type: TYPES[album.cover.split('.').pop().toLowerCase()] ?? 'image/jpeg' }
    : { src: new URL('icons/icon-512.png', baseHref).href, sizes: '512x512', type: 'image/png' };
  return {
    title: album.tracks[index]?.title ?? album.title,
    artist: album.artist || '',
    album: album.title,
    artwork: lpArtwork ? [lpArtwork, cover] : [cover], // the record itself first, the cover as a fallback
  };
}

export function connectMediaSession(player, deck) {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
  if (!ms || typeof MediaMetadata === 'undefined') return;
  const audio = player.audio;

  const position = () => {
    const d = player.durations[player.index];
    if (!(d > 0) || !ms.setPositionState) return;
    try { ms.setPositionState({ duration: d, position: Math.min(d, audio.currentTime || 0), playbackRate: 1 }); } catch { /* not supported */ }
  };
  const refresh = () => {
    if (!player.album) return;
    const lp = deck.lpArtwork?.();
    ms.metadata = new MediaMetadata(nowPlayingInfo(player.album, player.index, document.baseURI,
      lp ? { src: lp, sizes: '512x512', type: 'image/jpeg' } : null));
    position();
  };

  player.addEventListener('track', refresh);
  player.addEventListener('durations', refresh);
  deck.onArtwork?.(refresh);
  player.addEventListener('unload', () => { ms.metadata = null; ms.playbackState = 'none'; });
  audio.addEventListener('play', () => { ms.playbackState = 'playing'; refresh(); });
  audio.addEventListener('pause', () => { ms.playbackState = 'paused'; position(); });
  audio.addEventListener('seeked', position);

  const on = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* action not supported */ } };
  on('play', () => deck.remotePlay());
  on('pause', () => deck.remotePause());
  on('previoustrack', () => deck.skip(-1));
  on('nexttrack', () => deck.skip(1));
  on('seekto', (e) => {
    if (e.seekTime != null) player.seek(startOf(player.durations, player.index) + e.seekTime);
  });
}
