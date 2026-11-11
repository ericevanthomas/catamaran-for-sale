#!/usr/bin/env node
// Put this site's content into this site's own database.
//
//   node scripts/seed-content.mjs --remote                 (staging, wrangler.toml)
//   RP_TARGET=prod node scripts/seed-content.mjs --remote  (production)
//   node scripts/seed-content.mjs --sql-only               (just print the file)
//
// ── what this is for ───────────────────────────────────────────────────────
// It ran once, on 2026-11-11, to move this site's words out of 250 markdown
// files and a few dozen literals in .astro templates and into rows. After that
// the ROWS are the content: the editor writes them, scripts/build-site-data.mjs
// reads them, and src/config/site.seed.json is kept only as the provenance of
// the move and as the fixture scripts/check-content-roundtrip.mjs compares
// against.
//
// ⚠️ IT IS NOT A WAY TO EDIT THE SITE, and running it again overwrites whatever
// a client has published with the snapshot from the migration. It refuses to run
// without --force once the database already holds content, precisely because
// "let me just re-seed" is the shape of a mistake that silently discards a
// client's work.
//
// Everything it writes is scoped to the keys and owners this map claims
// (scripts/_content-map.mjs), so a `setting` row some other part of the
// platform put in this vault is not touched.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, dbName, configFile } from './_content-source.mjs';
import {
  SECTIONS, ITEM_COLUMNS, BARE_STRING, MD_CHILD, SETTING_ROOTS, FAQ_BLOCK,
  blockId, leaves, readPath,
} from './_content-map.mjs';

const site = JSON.parse(readFileSync(join(ROOT, 'src', 'config', 'site.seed.json'), 'utf8'));
const NOW = new Date().toISOString();
const BY = 'rp-migration-2026-11-11';

// ── SQL, by hand, because this runs once and a dependency would outlive it ──
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => q(JSON.stringify(v ?? null));
const out = [];
// ⚠️ DO NOT NORMALISE WHITESPACE IN THE STATEMENT. The first version of this
// collapsed runs of whitespace to keep the generated file readable, which also
// collapsed it INSIDE every string literal: a double space in one Recent
// Upgrades card became a single space, and every blank line between the
// paragraphs of an FAQ answer became a space, which turned two paragraphs into
// one. Twenty-three values came back changed and the round-trip check named
// each of them, which is the only reason it was not a silent rewrite of a
// client's words. Statements are written whole and the file is simply longer.
const push = (sql) => out.push(sql.trimEnd() + ';');

// ── the site's own facts ────────────────────────────────────────────────────
let settingCount = 0;
for (const root of SETTING_ROOTS) {
  const value = site[root];
  if (value === undefined) continue;
  const pairs = leaves(value, root);
  if (!pairs.length) {
    // An empty object or an array with nothing in it has no leaves, so it cannot
    // be stored and would come back absent. Say so rather than lose it quietly.
    console.warn(`seed-content: ⚠ ${root} flattened to nothing — it will come back absent`);
    continue;
  }
  push(`DELETE FROM setting WHERE key = ${q(root)} OR key LIKE ${q(root + '.')} || '%'`);
  for (const [key, v] of pairs) {
    push(`INSERT INTO setting (key, value_json, updated_at, updated_by)
          VALUES (${q(key)}, ${j(v)}, ${q(NOW)}, ${q(BY)})`);
    settingCount += 1;
  }
}

// ── the sections, their repeated things, and the things inside those ────────
const PAGES = [...new Set(SECTIONS.map((s) => s.page))];
for (const page of PAGES) {
  push(`DELETE FROM block WHERE owner_type = 'page' AND owner_id = ${q(page)}`);
}

let blockCount = 0;
const insertBlock = ({ id, page, parent, type, sort, cols = {}, data }) => {
  push(`INSERT INTO block (id, owner_type, owner_id, parent_id, type, sort,
                           eyebrow, headline, body, asset_id, cta_text, cta_href, data,
                           created_at, updated_at)
        VALUES (${q(id)}, 'page', ${q(page)}, ${parent ? q(parent) : 'NULL'}, ${q(type)}, ${sort},
                ${q(cols.eyebrow)}, ${q(cols.headline)}, ${q(cols.body)}, ${q(cols.asset_id)},
                ${q(cols.cta_text)}, ${q(cols.cta_href)},
                ${data && Object.keys(data).length ? j(data) : 'NULL'},
                ${q(NOW)}, ${q(NOW)})`);
  blockCount += 1;
};

// Split an object into the columns a map claims and the leftovers that go to
// `data`. The leftovers are kept rather than dropped: the round-trip check
// compares every key, so anything this does not understand fails loudly at
// migration time instead of vanishing from the page.
const split = (obj, map) => {
  const cols = {};
  const data = { ...obj };
  for (const [col, key] of Object.entries(map || {})) {
    if (data[key] === undefined) continue;
    // ⚠️ `asset_id` IS NOT A PATH, and nothing this migration moves has one.
    // The column is a foreign key into `asset`, where a row's id is the content
    // hash of bytes in R2; every photograph here is a build output under /_img/
    // whose public path is already content-addressed. Writing the path into the
    // column fails the foreign key outright — which is the good failure, and is
    // how this was caught — so the path stays in `data` under its own key, the
    // same fallback the kit's resolver writes for a picture that did not come
    // out of R2, and assemble() prefers an asset only when there is one.
    if (col === 'asset_id') continue;
    cols[col] = data[key];
    delete data[key];
  }
  return { cols, data };
};

SECTIONS.forEach((sec, order) => {
  const id = blockId(sec.page, sec.type);

  if (sec.md) {
    insertBlock({ id, page: sec.page, type: sec.type, sort: order, cols: { body: readPath(site, sec.md) ?? '' } });
    return;
  }

  let cols = {};
  let data;
  if (sec.own) {
    const obj = readPath(site, sec.own);
    if (obj === undefined) throw new Error(`seed-content: ${sec.own} is not in site.seed.json`);
    // The section's list lives in its CHILD rows, so it must not also be
    // copied into the parent's `data` — two homes for one list is two
    // answers to "what is on this page".
    const whole = { ...obj };
    if (sec.list && sec.list.startsWith(sec.own + '.')) delete whole[sec.list.slice(sec.own.length + 1)];
    ({ cols, data } = split(whole, sec.cols));
  }
  insertBlock({ id, page: sec.page, type: sec.type, sort: order, cols, data });

  if (!sec.list) return;
  const items = readPath(site, sec.list);
  if (!Array.isArray(items)) throw new Error(`seed-content: ${sec.list} is not a list`);
  items.forEach((item, i) => {
    const kidId = blockId(sec.page, sec.type, i);
    if (BARE_STRING.has(sec.item)) {
      insertBlock({ id: kidId, page: sec.page, parent: id, type: sec.item, sort: i, cols: { body: item } });
      return;
    }
    const whole = { ...item };
    const mdKey = MD_CHILD[sec.item];
    const md = mdKey ? whole[mdKey] : undefined;
    if (mdKey) delete whole[mdKey];
    const nested = sec.nested ? whole[sec.nested.key] : undefined;
    if (sec.nested) delete whole[sec.nested.key];

    const s = split(whole, ITEM_COLUMNS[sec.item]);
    insertBlock({ id: kidId, page: sec.page, parent: id, type: sec.item, sort: i, cols: s.cols, data: s.data });

    if (mdKey) {
      insertBlock({ id: `${kidId}:md`, page: sec.page, parent: kidId, type: 'md', sort: 0, cols: { body: md ?? '' } });
    }
    (nested || []).forEach((g, k) => {
      const gs = split({ ...g }, ITEM_COLUMNS[sec.nested.item]);
      insertBlock({
        id: blockId(sec.page, sec.type, i, k), page: sec.page, parent: kidId,
        type: sec.nested.item, sort: k, cols: gs.cols, data: gs.data,
      });
    });
  });
});

// ── the question pool, and which questions the FAQ page shows ──────────────
push('DELETE FROM faq_tag');
push('DELETE FROM faq');
push(`DELETE FROM block_pick WHERE block_id = ${q(FAQ_BLOCK)}`);
site.faqs.forEach((f, i) => {
  // `faq.sort` is the POOL's own order — the order the questions are offered in
  // a picker. WHERE each one sits on the page is the pick's `sort`, which is a
  // different fact: a question can be in the pool and not on the page. They
  // start out agreeing because the migration put every question on the page in
  // the order the markdown files gave them.
  push(`INSERT INTO faq (id, question, answer, sort, created_at, updated_at)
        VALUES (${q(f.id)}, ${q(f.question)}, ${q(f.answer)}, ${i}, ${q(NOW)}, ${q(NOW)})`);
  // The category is the FIRST tag; a question's own tags follow it. The order
  // is the contract, and scripts/_assemble.mjs reads it back the same way.
  for (const tag of [f.category, ...(f.tags || [])].filter(Boolean)) {
    push(`INSERT OR REPLACE INTO faq_tag (faq_id, tag) VALUES (${q(f.id)}, ${q(tag)})`);
  }
  push(`INSERT OR REPLACE INTO block_pick (block_id, kind, record_id, sort)
        VALUES (${q(FAQ_BLOCK)}, 'faq', ${q(f.id)}, ${i})`);
});

// ── write it, then send it ──────────────────────────────────────────────────
const dir = join(ROOT, '.wrangler', 'seed');
mkdirSync(dir, { recursive: true });
const file = join(dir, 'seed-content.sql');
writeFileSync(file, out.join('\n') + '\n');

console.log(`seed-content: ${out.length} statement(s) — ${settingCount} setting(s), ${blockCount} block(s), ${site.faqs.length} question(s)`);
console.log(`              ${file}`);

if (process.argv.includes('--sql-only')) process.exit(0);

const db = dbName();
const force = process.argv.includes('--force');
console.log(`              target: ${db}  (${configFile()})`);

// ⚠️ Refuse to overwrite a database that already holds content. Re-seeding is
// the shape of a mistake that discards whatever a client has published since
// the migration, and it looks like success while it does it.
const run = (sql, extra = []) => {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--json', ...extra, ...(sql ? ['--command', sql] : [])],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(raw.slice(raw.search(/[[{]/)));
};

if (!force) {
  const n = run("SELECT (SELECT COUNT(*) FROM block) + (SELECT COUNT(*) FROM setting) AS n")[0].results[0].n;
  if (Number(n) > 0) {
    console.error(`\n  ✖ ${db} already holds ${n} content row(s).`);
    console.error('    Re-seeding would overwrite whatever has been published since the migration.');
    console.error('    If that is genuinely what you want: --force\n');
    process.exit(1);
  }
}

run(null, ['--file', file]);
console.log('              applied.');
