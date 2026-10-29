import test from 'node:test';
import assert from 'node:assert/strict';
import { knobAngle, gainFor, levelAfterDrag, nextAlbum, createDeckSettings, KNOB_SWEEP } from '../js/deck-settings.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('the knob sweeps evenly either side of twelve o\'clock', () => {
  assert.equal(knobAngle(0), -KNOB_SWEEP / 2);
  assert.equal(knobAngle(0.5), 0);
  assert.equal(knobAngle(1), KNOB_SWEEP / 2);
  assert.equal(knobAngle(7), KNOB_SWEEP / 2);
});

test('gain follows a loudness curve: silent, full, quieter in between', () => {
  assert.equal(gainFor(0), 0);
  assert.equal(gainFor(1), 1);
  assert.equal(gainFor(0.5), 0.25);
  assert.equal(gainFor(-1), 0);
  assert.equal(gainFor(NaN), 0);
});

test('dragging up turns it up and stays within 0–1', () => {
  assert.equal(levelAfterDrag(0.5, -100, 200), 1);
  assert.equal(levelAfterDrag(0.5, 50, 200), 0.25);
  assert.equal(levelAfterDrag(0.2, 999), 0);
});

test('nextAlbum goes to the following record and round to the first', () => {
  const albums = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(nextAlbum(albums, 'a').id, 'b');
  assert.equal(nextAlbum(albums, 'c').id, 'a');
  assert.equal(nextAlbum(albums, 'gone').id, 'a');
  assert.equal(nextAlbum([{ id: 'only' }], 'only').id, 'only');
  assert.equal(nextAlbum([], 'a'), null);
});

test('settings default to full volume with the auto-changer on', () => {
  const s = createDeckSettings(memoryStorage());
  assert.equal(s.volume, 1);
  assert.equal(s.autoChange, true);
});

test('settings are remembered', () => {
  const storage = memoryStorage();
  const s = createDeckSettings(storage);
  s.setVolume(0.4);
  s.setAutoChange(false);
  const again = createDeckSettings(storage);
  assert.equal(again.volume, 0.4);
  assert.equal(again.autoChange, false);
});

test('broken or blocked storage falls back to the defaults', () => {
  const corrupt = createDeckSettings(memoryStorage({ 'lp:deck': '{nope' }));
  assert.equal(corrupt.volume, 1);
  const blocked = createDeckSettings({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(blocked.setVolume(2), 1);
  assert.equal(blocked.autoChange, true);
});
