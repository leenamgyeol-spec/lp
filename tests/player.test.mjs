import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPlayableIndex } from '../js/player.js';

test('nextPlayableIndex skips failed tracks', () => {
  assert.equal(nextPlayableIndex(new Set([1]), 0, 3), 2);
});

test('nextPlayableIndex returns -1 when every later track failed', () => {
  assert.equal(nextPlayableIndex(new Set([1, 2]), 0, 3), -1);
});

test('nextPlayableIndex returns -1 after the last track', () => {
  assert.equal(nextPlayableIndex(new Set(), 2, 3), -1);
});

import { FakeAudio, installFakeAudio } from './helpers/fake-audio.mjs';
installFakeAudio();
const { Player } = await import('../js/player.js');
const album = (...names) => ({ id: 'a', tracks: names.map((n) => ({ title: n, src: n })) });
const tick = () => new Promise((r) => setTimeout(r, 5));

test('load reports each track that failed measurement exactly once', async () => {
  FakeAudio.hold = false;
  const p = new Player();
  const errors = [];
  p.addEventListener('error', (e) => errors.push(e.detail.title));
  await p.load(album('bad-1', 'ok-2', 'bad-3'));
  await tick();
  assert.deepEqual(errors.sort(), ['bad-1', 'bad-3']);
  assert.deepEqual(p.durations, [0, 10, 0]);
});

test('a failing first track does not end the album while nothing is playing', async () => {
  FakeAudio.hold = false;
  const p = new Player();
  let ended = false;
  p.addEventListener('ended', () => { ended = true; });
  await p.load(album('bad-only'));
  await tick();
  assert.equal(ended, false);
});

test('the latest seek wins when metadata arrives late', async () => {
  FakeAudio.hold = false;
  const p = new Player();
  await p.load(album('ok-1', 'ok-2'));
  await tick();
  FakeAudio.hold = true;
  p.seek(15); // track 2 at 5s, switches src
  p.seek(17); // same track, metadata still pending
  p.audio.fire('loadedmetadata');
  assert.equal(p.index, 1);
  assert.equal(p.audio.currentTime, 7);
  FakeAudio.hold = false;
});

test('seeking to the end of the album ends it instead of replaying the last track', async () => {
  FakeAudio.hold = false;
  const p = new Player();
  await p.load(album('ok-1', 'ok-2'));
  await tick();
  let ended = false;
  p.addEventListener('ended', () => { ended = true; });
  p.play();
  p.seek(p.total);
  await tick();
  assert.equal(ended, true);
  assert.equal(p.audio.paused, true);
});

test('loading the next album after the run-out measures its tracks', async () => {
  FakeAudio.hold = false;
  const p = new Player();
  await p.load(album('ok-1', 'ok-2'));
  await tick();
  p.play();
  p.seek(p.total); // run-out
  await tick();
  const durations = await p.load(album('ok-a', 'ok-b', 'ok-c'));
  assert.deepEqual(durations, [10, 10, 10]);
  assert.equal(p.total, 30);
});

test('ended says whether the side played out on its own', async () => {
  FakeAudio.hold = false;
  const p = new Player();
  await p.load(album('ok-1', 'ok-2'));
  await tick();
  const ends = [];
  p.addEventListener('ended', (e) => ends.push(e.detail.natural));
  p.play();
  p.seek(p.total); // the needle set in the run-out
  p.play();
  p.seek(15);
  await tick();
  p.audio.dispatchEvent(new Event('ended')); // the last track finished
  assert.deepEqual(ends, [false, true]);
});
