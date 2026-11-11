#!/usr/bin/env node
// Register the photographs this site already ships in the editor's photo library.
//
//   node scripts/seed-media.mjs --remote                 (staging)
//   RP_TARGET=prod node scripts/seed-media.mjs --remote  (production)
//
// ⚠️ NOTHING IS UPLOADED AND NOTHING IS MOVED. The ~160 photographs on this
// site are build outputs: scripts/optimize-images.mjs reads public/images/ and
// writes five or six WebP widths per picture into public/_img/, keyed by the
// SHA-1 of the source file, and the pages reference them through
// src/generated/image-manifest.json. Those URLs are already content-addressed
// and they are already on the CDN.
//
// Copying them into R2 would mean 160 photographs times six widths = ~1,000
// objects, a changed `src` on every <img> on the site, and a second copy of
// every byte — to make the photo library show pictures it can describe perfectly
// well where they are. So the library is pointed AT THEM: one `media_blob` row
// per photograph keyed by the same SHA-1 the variant directory is named after,
// one `media_item` so it appears in a folder, and one `media` row carrying the
// srcset the picker uses for a thumbnail.
//
// New photographs a client uploads through the editor DO go to R2
// (functions/api/media.ts) and get rows the same shape. The two live side by
// side, which is the point: a path under /_img/ and a path under /media/uploads/
// are both this tenant's own pictures, and src/config/editable.js accepts both.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, dbName, configFile } from './_content-source.mjs';

const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'generated', 'image-manifest.json'), 'utf8'));
const hashFile = join(ROOT, 'public', '_img', '.source-hashes.json');
if (!existsSync(hashFile)) {
  console.error('seed-media: public/_img/.source-hashes.json is missing — run npm run optimize-images first');
  process.exit(1);
}
const hashes = JSON.parse(readFileSync(hashFile, 'utf8'));
const site = JSON.parse(readFileSync(join(ROOT, 'src', 'config', 'site.seed.json'), 'utf8'));

// What this site says about each picture, so the library's description is the
// one the page already used rather than a filename.
const described = new Map();
for (const g of site.gallery || []) described.set(g.image, { alt: g.alt, title: g.caption });
for (const key of ['topPhotos', 'bottomPhotos']) {
  for (const p of site[key] || []) if (!described.has(p.image)) described.set(p.image, { alt: p.alt, title: null });
}
for (const [path, alt] of [
  [site.hero?.photo, site.hero?.photoAlt],
  [site.whyChose?.photo, site.whyChose?.photoAlt],
  [site.pageCopy?.about?.photo, site.pageCopy?.about?.photoAlt],
  [site.pageCopy?.specs?.layout?.image, site.pageCopy?.specs?.layout?.alt],
]) if (path && !described.has(path)) described.set(path, { alt, title: null });

const NOW = new Date().toISOString();
const BY = 'rp-migration-2026-11-11';
const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// Which folder a picture lands in, from where it lives on the public drive. One
// folder per directory under /images/, so the library opens looking like the
// drive the photographs were filed on rather than one flat wall of 160 tiles.
const folderOf = (src) => {
  const m = /^\/images\/([^/]+)\//.exec(src);
  return m ? m[1] : null;
};
const FOLDER_NAMES = { gallery: 'Gallery', home: 'Home page', about: 'About', icons: 'Icons' };

const out = [];
const push = (sql) => out.push(sql.replace(/\s+/g, ' ').trim() + ';');

const folders = new Set();
let n = 0;
for (const [src, entry] of Object.entries(manifest)) {
  const raw = hashes[src];
  if (!raw) { console.warn(`seed-media: no source hash for ${src} — skipped`); continue; }
  // The hash key is `<config-tag>-<sha1>`; the SHA-1 is the identity of the
  // bytes and the config tag only says which widths were rendered from them.
  const hash = raw.slice(raw.lastIndexOf('-') + 1);
  const srcset = (entry.variants || []).map((v) => `${v.src} ${v.w}w`).join(', ');
  const largest = entry.variants?.length ? entry.variants[entry.variants.length - 1].src : src;
  const d = described.get(src) || {};
  const folder = folderOf(src);
  if (folder) folders.add(folder);

  push(`INSERT OR REPLACE INTO media_blob (hash, src, srcset, master, alt, width, height, bytes, created_at, created_by)
        VALUES (${q(hash)}, ${q(src)}, ${q(srcset)}, ${q(largest)}, ${q(d.alt)},
                ${entry.width || 'NULL'}, ${entry.height || 'NULL'}, NULL, ${q(NOW)}, ${q(BY)})`);
  push(`INSERT OR REPLACE INTO media_item (id, hash, name, folder_id, created_at, created_by, updated_at)
        VALUES (${q(hash)}, ${q(hash)}, ${q(src.split('/').pop())}, ${q(folder)}, ${q(NOW)}, ${q(BY)}, ${q(NOW)})`);
  push(`INSERT OR REPLACE INTO media (src, alt, title, updated_at, updated_by, srcset, master)
        VALUES (${q(src)}, ${q(d.alt)}, ${q(d.title)}, ${q(NOW)}, ${q(BY)}, ${q(srcset)}, ${q(largest)})`);
  n += 1;
}

// The folders go in FIRST, or every item above lands in one that does not exist
// and the library shows 160 loose files.
const prelude = [...folders].sort().map((id, i) =>
  `INSERT OR REPLACE INTO media_folder (id, name, parent_id, ord, created_at, created_by) `
  + `VALUES (${q(id)}, ${q(FOLDER_NAMES[id] || id)}, NULL, ${i}, ${q(NOW)}, ${q(BY)});`);

const dir = join(ROOT, '.wrangler', 'seed');
mkdirSync(dir, { recursive: true });
const file = join(dir, 'seed-media.sql');
writeFileSync(file, [...prelude, ...out].join('\n') + '\n');

const db = dbName();
console.log(`seed-media: ${n} photograph(s) in ${folders.size} folder(s) → ${db} (${configFile()})`);
console.log(`            ${file}`);
if (process.argv.includes('--sql-only')) process.exit(0);

execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--file', file],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
console.log('            applied.');
