import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackTitle, naturalCompare, encodePath, buildManifest } from '../scripts/build-manifest.mjs';

async function fixture(albums) {
  const root = await mkdtemp(join(tmpdir(), 'lp-'));
  const dir = join(root, 'albums');
  for (const [name, files] of Object.entries(albums)) {
    const a = join(dir, name);
    await mkdir(a, { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      if (file.endsWith('/')) { await mkdir(join(a, file), { recursive: true }); continue; }
      await mkdir(join(a, file, '..'), { recursive: true });
      await writeFile(join(a, file), body);
    }
  }
  return { root, dir };
}

test('trackTitle strips leading number, separators and extension', () => {
  assert.equal(trackTitle('01 첫곡.mp3'), '첫곡');
  assert.equal(trackTitle('2-Side B.MP3'), 'Side B');
  assert.equal(trackTitle('10_Intro.flac'), 'Intro');
  assert.equal(trackTitle('Song.ogg'), 'Song');
  assert.equal(trackTitle('01.mp3'), '01');
});

test('naturalCompare orders 2 before 10', () => {
  assert.deepEqual(['10 a.mp3', '2 b.mp3', '1 c.mp3'].sort(naturalCompare), ['1 c.mp3', '2 b.mp3', '10 a.mp3']);
});

test('encodePath encodes Korean, spaces, # and ?', () => {
  assert.equal(encodePath('albums', '내 앨범', '01 #1?.mp3'),
    'albums/' + encodeURIComponent('내 앨범') + '/' + encodeURIComponent('01 #1?.mp3'));
});

test('buildManifest reads tracks, cover (case-insensitive), album.json', async () => {
  const { dir } = await fixture({
    '밤 산책': {
      'Cover.JPG': 'x', '02 둘.MP3': 'x', '01 하나.mp3': 'x', '.DS_Store': 'x', 'desktop.ini': 'x',
      'notes.txt': 'x', 'sub/03.mp3': 'x',
      'album.json': JSON.stringify({ title: 'Night', artist: 'A', vinyl: { style: 'marble' }, rpm: 45 }),
    },
  });
  const { albums, warnings } = await buildManifest(dir);
  assert.equal(albums.length, 1);
  const a = albums[0];
  assert.equal(a.id, '밤 산책'); assert.equal(a.title, 'Night'); assert.equal(a.artist, 'A'); assert.equal(a.rpm, 45);
  assert.equal(a.vinyl.style, 'marble');
  assert.equal(a.cover, encodePath('albums', '밤 산책', 'Cover.JPG'));
  assert.deepEqual(a.tracks.map((t) => t.title), ['하나', '둘']);
  assert.equal(a.tracks[0].src, encodePath('albums', '밤 산책', '01 하나.mp3'));
  assert.deepEqual(warnings, []);
});

test('buildManifest takes an AVIF cover', async () => {
  const { dir } = await fixture({ single: { 'cover.avif': 'x', '01 a.mp3': 'x' } });
  const { albums } = await buildManifest(dir);
  assert.equal(albums[0].cover, encodePath('albums', 'single', 'cover.avif'));
});

test('buildManifest skips folders without audio and warns', async () => {
  const { dir } = await fixture({ empty: { 'cover.png': 'x' } });
  const { albums, warnings } = await buildManifest(dir);
  assert.equal(albums.length, 0);
  assert.match(warnings[0], /empty/);
});

test('invalid album.json falls back to defaults with a warning', async () => {
  const { dir } = await fixture({ x: { '1.mp3': 'x', 'album.json': '{not json' } });
  const { albums, warnings } = await buildManifest(dir);
  assert.equal(albums[0].title, 'x'); assert.equal(albums[0].rpm, 33); assert.equal(albums[0].cover, null);
  assert.match(warnings[0], /album\.json/);
});

test('invalid style, colors and rpm are ignored', async () => {
  const { dir } = await fixture({
    x: { '1.mp3': 'x', 'album.json': JSON.stringify({ vinyl: { style: 'glitter', color: 'red', accent: '#AABBCC' }, label: { color: '#12345' }, rpm: 78 }) },
  });
  const { albums } = await buildManifest(dir);
  assert.equal(albums[0].vinyl.style, undefined);
  assert.equal(albums[0].vinyl.color, undefined);
  assert.equal(albums[0].vinyl.accent, '#AABBCC');
  assert.equal(albums[0].label.color, undefined);
  assert.equal(albums[0].rpm, 33);
});

test('albums are sorted naturally by folder name', async () => {
  const { dir } = await fixture({ 'a10': { '1.mp3': 'x' }, 'a2': { '1.wav': 'x' } });
  assert.deepEqual((await buildManifest(dir)).albums.map((a) => a.id), ['a2', 'a10']);
});

test('missing albums dir returns empty list', async () => {
  const { root } = await fixture({});
  assert.deepEqual((await buildManifest(join(root, 'nope'))).albums, []);
});

import { normalizeLook, mergeLook, albumJsonSnippet } from '../js/look.js';

test('album.json look values pass through, invalid ones are dropped', async () => {
  const { dir } = await fixture({
    x: { '1.mp3': 'x', 'album.json': JSON.stringify({ vinyl: { style: 'glitter', shape: 'flower', size: 7, color: '#112233' }, label: { mode: 'text', size: 0.3 }, deck: { arm: 'gold', body: 'teal' }, finish: { gloss: 9 } }) },
  });
  const { albums } = await buildManifest(dir);
  assert.deepEqual(albums[0].look, { vinyl: { style: 'glitter', color: '#112233', shape: 'flower', size: 7 }, label: { mode: 'text', size: 0.3 }, finish: { gloss: 1 }, deck: { arm: 'gold' } });
});

test('a copied snippet round-trips through the build', async () => {
  const look = normalizeLook({ vinyl: { style: 'half', color: '#aa0000', accent: '#0000aa', shape: 'flower', size: 10 }, label: { mode: 'color', ring: false, showTitle: true }, finish: { grooves: 0.8 }, deck: { arm: 'black', body: '#123456' } });
  const snippet = albumJsonSnippet({ title: 'T', artist: 'A', year: 2020 }, look, normalizeLook({}));
  const { dir } = await fixture({ y: { '1.mp3': 'x', 'album.json': snippet } });
  const { albums } = await buildManifest(dir);
  assert.deepEqual(mergeLook(normalizeLook({}), albums[0].look), look);
  assert.equal(albums[0].title, 'T');
});
