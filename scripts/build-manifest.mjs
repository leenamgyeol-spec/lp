// Scans albums/ and writes albums.json, the list the site loads.
// Usage: node scripts/build-manifest.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLook, lookDiff } from '../js/look.js';

const AUDIO = new Set(['.mp3', '.m4a', '.ogg', '.wav', '.flac']);
const COVERS = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif'];
const STYLES = new Set(['solid', 'translucent', 'marble', 'splatter', 'picture']);
const HEX = /^#[0-9a-f]{6}$/i;

export function trackTitle(filename) {
  const base = filename.slice(0, filename.length - extname(filename).length);
  const stripped = base.replace(/^\d+[\s._-]*/, '').trim();
  return stripped || base;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a, b) => collator.compare(a, b);

export const encodePath = (...segments) => segments.map(encodeURIComponent).join('/');

function pickColors(obj, keys) {
  const out = {};
  for (const k of keys) if (typeof obj?.[k] === 'string' && HEX.test(obj[k])) out[k] = obj[k];
  return out;
}

async function readAlbumJson(path, warnings, id) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { return {}; }
  try {
    const data = JSON.parse(text.replace(/^﻿/, ''));
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    warnings.push(`${id}: album.json을 읽을 수 없어 기본값을 사용합니다 (${e.message})`);
    return {};
  }
}

export async function buildManifest(albumsDir, publicPrefix = 'albums') {
  const warnings = [];
  let entries;
  try { entries = await readdir(albumsDir, { withFileTypes: true }); } catch { return { albums: [], warnings }; }

  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(naturalCompare);
  const albums = [];
  for (const id of folders) {
    const files = (await readdir(join(albumsDir, id), { withFileTypes: true }))
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name);
    const audio = files.filter((f) => AUDIO.has(extname(f).toLowerCase())).sort(naturalCompare);
    if (audio.length === 0) {
      warnings.push(`${id}: 오디오 파일이 없어 건너뜁니다`);
      continue;
    }
    const coverFile = COVERS.map((c) => files.find((f) => f.toLowerCase() === c)).find(Boolean);
    const meta = await readAlbumJson(join(albumsDir, id, 'album.json'), warnings, id);
    const vinyl = pickColors(meta.vinyl, ['color', 'accent']);
    if (STYLES.has(meta.vinyl?.style)) vinyl.style = meta.vinyl.style;

    albums.push({
      id,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : id,
      artist: typeof meta.artist === 'string' ? meta.artist : '',
      year: Number.isInteger(meta.year) ? meta.year : null,
      cover: coverFile ? encodePath(publicPrefix, id, coverFile) : null,
      tracks: audio.map((f) => ({ title: trackTitle(f), src: encodePath(publicPrefix, id, f) })),
      vinyl,
      label: pickColors(meta.label, ['color', 'text']),
      rpm: meta.rpm === 45 ? 45 : 33,
      // how the record should look (customizer fields); invalid values are dropped
      look: lookDiff(normalizeLook(meta), normalizeLook({})),
    });
  }
  return { albums, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { albums, warnings } = await buildManifest(resolve('albums'));
  for (const w of warnings) console.error(`warning: ${w}`);
  await writeFile('albums.json', JSON.stringify({ albums }, null, 2) + '\n');
  console.log(`${albums.length} albums`);
}
