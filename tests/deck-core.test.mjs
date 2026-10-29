import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeAudio } from './helpers/fake-audio.mjs';
installFakeAudio();
const { Player } = await import('../js/player.js');
const { createDeckCore } = await import('../js/deck-core.js');
const { angleForRadius } = await import('../js/arm.js');
const { timeToRadius } = await import('../js/timeline.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const album = { id: 'a', title: 'A', artist: 'X', rpm: 33, tracks: [{ title: 'one', src: 'ok-1' }, { title: 'two', src: 'ok-2' }] };

function setup() {
  const player = new Player();
  const draws = [];
  const view = {
    setHint() {},
    loadArt: async () => ({ cover: null, design: {} }),
    drawVinyl: (...args) => draws.push(args),
  };
  return { player, core: createDeckCore(player, view), draws };
}

async function mounted() {
  const t = setup();
  await t.core.mount(album);
  await sleep(10);
  return t;
}

function drop(core, r) {
  core.startDrag();
  core.dragTo(angleForRadius(r));
  core.endDrag();
}

test('dropping the needle mid-song plays from right there', async () => {
  const { player, core } = await mounted();
  core.setMotor(true);
  drop(core, 0.82); // a quarter of the way through 20s → 5 s into track 1
  await sleep(450);
  assert.equal(core.state.needleDown, true);
  assert.equal(player.index, 0);
  assert.ok(Math.abs(player.time - 5) < 0.05, `time ${player.time}`);
});

test('picking a song from the list plays it from its start', async () => {
  const { player, core } = await mounted();
  const swing = core.playTrack(1);
  for (let i = 0; i < 10; i++) core.tick(0.1, performance.now() + 1000); // let the arm swing in
  await swing;
  await sleep(450);
  assert.equal(core.state.needleDown, true);
  assert.equal(core.state.motorOn, true);
  assert.equal(player.index, 1);
  assert.equal(player.time, 10);
  core.playTrack(0); // with the needle already down it hops straight there
  assert.equal(player.index, 0);
  assert.equal(player.time, 0);
});

test('setting the needle on the record starts it; parking the arm stops it', async () => {
  const { player, core } = await mounted();
  drop(core, 0.68);
  assert.equal(core.state.motorOn, true);
  await sleep(450);
  for (let i = 0; i < 10; i++) core.tick(0.1, 1e6 + i * 100); // the platter comes up to speed
  assert.equal(core.state.needleDown, true);
  assert.equal(player.audio.paused, false);
  core.startDrag();
  core.dragTo(90);
  core.endDrag();
  assert.equal(core.state.motorOn, false);
  assert.equal(core.state.needleDown, false);
});

test('the run-out stops the record', async () => {
  const { player, core } = await mounted();
  core.setMotor(true);
  drop(core, 0.38);
  await sleep(450);
  assert.equal(core.state.ended, true);
  assert.equal(player.audio.paused, true);
});

test('after a long hidden gap, tick puts the arm at the current playback position', async () => {
  const { player, core } = await mounted();
  core.remotePlay();
  player.seek(15);
  await sleep(10);
  player.audio.currentTime = 7; // played on while the page was hidden
  core.tick(30, 1e6);
  assert.ok(Math.abs(core.state.angle - angleForRadius(timeToRadius(17, 20))) < 1e-9);
});

test('remotePlay with the needle up drops it at the start and plays', async () => {
  const { player, core } = await mounted();
  core.remotePlay();
  await sleep(10);
  assert.equal(core.state.needleDown, true);
  assert.equal(core.state.motorOn, true);
  assert.equal(player.audio.paused, false);
  assert.equal(player.time, 0);
});

test('idle() is true when stopped and settled, false while spinning', async () => {
  const { core } = setup();
  core.tick(1, 1e6);
  assert.equal(core.idle(), true);
  core.setMotor(true);
  core.tick(0.1, 1e6 + 100);
  assert.equal(core.idle(), false);
});

test('mount draws the record twice: before and after durations are known', async () => {
  const { draws } = await mounted();
  assert.equal(draws.length, 2);
  assert.deepEqual(draws[1][3], [10, 10]);
});

test('info() describes the album and the track under the needle', async () => {
  const { core } = await mounted();
  assert.deepEqual([core.info().title, core.info().artist, core.info().line], ['A', 'X', '2곡  0:20']);
});

test('lifting the needle after the run-out clears the "listened to the end" state', async () => {
  const { core } = await mounted();
  core.setMotor(true);
  drop(core, 0.38);
  await sleep(450);
  assert.equal(core.state.ended, true);
  core.startDrag();
  core.dragTo(90);
  core.endDrag();
  assert.equal(core.state.ended, false);
  assert.equal(core.info().line, '2곡  0:20');
});

test('a mount that was overtaken does not apply its colours', async () => {
  const player = new Player();
  const applied = [];
  let releaseA;
  const view = {
    setHint() {},
    loadArt: (album) => album.id === 'slow'
      ? new Promise((r) => { releaseA = () => r({ cover: null, design: {}, apply: () => applied.push('slow') }); })
      : Promise.resolve({ cover: null, design: {}, apply: () => applied.push(album.id) }),
    drawVinyl() {},
  };
  const core = createDeckCore(player, view);
  const first = core.mount({ ...album, id: 'slow' });
  await sleep(10);
  core.eject();
  await core.mount({ ...album, id: 'fast' });
  releaseA();
  await first;
  assert.deepEqual(applied, ['fast']);
});

test('eject lets go of the album so the lock screen can clear', async () => {
  const { player, core } = await mounted();
  let unloaded = false;
  player.addEventListener('unload', () => { unloaded = true; });
  core.eject();
  assert.equal(player.album, null);
  assert.equal(unloaded, true);
});

test('on a 7-inch record the needle plays from where it lands', async () => {
  const { player, core } = await mounted();
  core.setGroove({ outer: 0.5568, inner: 0.232 });
  core.setMotor(true);
  drop(core, (0.5568 + 0.232) / 2 - 0.01); // a bit past halfway → early in track 2
  await sleep(450);
  assert.equal(player.index, 1);
  assert.ok(player.time > 10 && player.time < 11, `time ${player.time}`);
});

test('dropping on the mat around a small record sends the arm back to rest', async () => {
  const { core } = await mounted();
  core.setGroove({ outer: 0.5568, inner: 0.232 });
  drop(core, 0.8);
  await sleep(450);
  assert.equal(core.state.needleDown, false);
});

test('maxAngle lets the arm reach the run-out of a small record', async () => {
  const { core } = await mounted();
  core.setGroove({ outer: 0.5568, inner: 0.232 });
  assert.ok(Math.abs(core.maxAngle() - angleForRadius(0.192)) < 1e-9);
});

test('scratching pauses the player and stops tick from driving the record', async () => {
  const { player, core } = await mounted();
  core.remotePlay(); await sleep(10);
  core.startScratch();
  assert.equal(player.audio.paused, true);
  core.scratchTo(123, 4);
  core.tick(0.1, 1e6);
  assert.equal(core.state.rotation, 123);
  assert.ok(Math.abs(core.state.angle - angleForRadius(timeToRadius(4, 20))) < 1e-9);
});

test('letting go resumes playback from where the hand left it', async () => {
  const { player, core } = await mounted();
  core.remotePlay(); await sleep(10);
  core.startScratch();
  core.endScratch(13);
  await sleep(20);
  core.tick(0.1, 1e6 + 100);
  assert.equal(player.time, 13);
  assert.equal(player.audio.paused, false);
});

test('with the needle up, spinning the record by hand never plays', async () => {
  const { player, core } = await mounted();
  core.startScratch(); core.scratchTo(90, 5); core.endScratch(5); await sleep(20);
  core.setMotor(true); core.tick(0.1, 1e6);
  assert.equal(player.audio.paused, true);
  assert.equal(core.state.needleDown, false);
});

test('ejecting mid-scratch ends the scratch', async () => {
  const { core } = await mounted();
  core.startScratch();
  core.eject();
  assert.equal(core.state.scratching, false);
});

test('autoStart with instant drops the needle at the start and plays', async () => {
  const { player, core } = await mounted();
  await core.autoStart({ instant: true });
  await sleep(10);
  assert.equal(core.state.needleDown, true);
  assert.equal(player.audio.paused, false);
  assert.equal(player.time, 0);
});

test('autoStart after the run-out lifts the needle and swings back to the first groove', async () => {
  const { core } = await mounted();
  core.setMotor(true);
  drop(core, 0.38);
  await sleep(450);
  assert.equal(core.state.ended, true);
  const going = core.autoStart();
  assert.equal(core.state.needleDown, false);
  for (let i = 1; i <= 10; i++) core.tick(0.1, 1e9 + i * 100); // the arm swings across
  await going;
  await sleep(450);
  assert.equal(core.state.ended, false);
  assert.equal(core.state.needleDown, true);
  assert.equal(core.state.motorOn, true);
});
