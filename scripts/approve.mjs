// Record that a section's mapping has been looked at and is fit to edit.
//
// Approving a SECTION does not unlock anything inside it that is deliberately
// locked: a locked element carries no field at all, so there is nothing for
// approval to hand out. It only says "the fields in here have been checked"
// (wires/EDITOR-RULES.md §9).
//
// Since 2026-09-30 this writes to the CLIENT'S D1, not to mappings/*.json.
// The reason is the whole point of the review surface: approval used to be a
// file in the repo baked in at build time, so saying go meant a deploy, and a
// review step that needs a deploy is a review step nobody does on the spot.
// Eric approves from inside the page now (the section panel in staff view);
// this script is how a site gets SEEDED — a fresh clone of the kit, or a bulk
// re-approve after a shape change nobody disputes.
//
// Approval is still bound to the section's SHAPE, which is published by
// src/pages/rp-approvals.json.js and read here from the same module, so the
// hash written to the database is by construction the hash the editor will
// compare against.
//
//   node scripts/approve.mjs --all --by "Eric"      approve every section
//   node scripts/approve.mjs /services/kitchens --by "Eric"
//   node scripts/approve.mjs --list                 what is approved, and what has lapsed
//   node scripts/approve.mjs --all --local          against the local D1
import { execFileSync } from 'node:child_process';
import { GET } from '../src/pages/rp-approvals.json.js';
import { dbName, configFile } from './_content-source.mjs';

// ⚠️ WHICH DATABASE, FROM THE SAME PLACE EVERYTHING ELSE READS IT. The kit's
// copy of this file hardcodes `rp-fourlakes`; this repo builds two projects
// with two databases, so a hardcoded name here would approve sections on one
// site while the other stayed locked — and the symptom is "Not ready to edit
// yet" on a page whose mapping is perfectly good, with nothing to say why.
// RP_TARGET picks the config, exactly as the build does.
const DB = dbName();
const args = process.argv.slice(2);
const byAt = args.indexOf('--by');
const by = byAt === -1 ? 'Eric' : args[byAt + 1];
const all = args.includes('--all');
const list = args.includes('--list');
const where = args.includes('--local') ? '--local' : '--remote';
const only = args.filter((a) => a.startsWith('/')).map((p) => p.replace(/\/+$/, '') || '/');

console.log(`approve: ${DB} (${configFile()})`);

if (!all && !list && !only.length) {
  console.log('Nothing to do. Pass --all, --list, or one or more page paths.');
  process.exit(0);
}

// One place the SQL goes out, so there is one place it can be wrong.
//
// `--json` on a read, nothing on a write: wrangler prints a table otherwise
// and a table is not something to parse. A statement is passed with --command
// rather than written to a temp file because these are short and a temp file
// is one more thing to clean up on a failure.
function d1(sql, read) {
  const flags = ['wrangler', 'd1', 'execute', DB, where, '--command', sql];
  if (read) flags.push('--json');
  const out = execFileSync('npx', flags, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (!read) return null;
  // wrangler prints its own preamble before the JSON on some versions, so
  // take the document from the first bracket rather than trusting the whole
  // of stdout to be JSON.
  const at = out.indexOf('[');
  if (at === -1) return [];
  const parsed = JSON.parse(out.slice(at));
  return (parsed[0] && parsed[0].results) || [];
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// What the build published: page → section → shape. The same values the
// editor reads, from the same module, so nothing can drift between them.
const published = JSON.parse(await (await GET()).text()).pages;

if (list) {
  const rows = d1('SELECT page, section, shape, approved_by, approved_at FROM section_approvals ORDER BY page, section', true);
  const held = new Map(rows.map((r) => [r.page + '\u0000' + r.section, r]));
  let ok = 0, lapsed = 0, waiting = 0;
  for (const page of Object.keys(published).sort()) {
    const shapes = published[page].shapes || {};
    const lines = [];
    for (const section of Object.keys(shapes)) {
      const row = held.get(page + '\u0000' + section);
      if (!row) { waiting += 1; lines.push(`    · ${section} — never approved`); continue; }
      if (row.shape !== shapes[section]) {
        lapsed += 1;
        lines.push(`    ⚠ ${section} — approved at ${row.shape}, now ${shapes[section]}: LAPSED`);
        continue;
      }
      ok += 1;
      lines.push(`    ✓ ${section} — ${row.approved_by}, ${String(row.approved_at).slice(0, 10)}`);
    }
    if (lines.length) console.log(`  ${page}\n${lines.join('\n')}`);
  }
  console.log(`\n${ok} approved · ${lapsed} lapsed on a shape change · ${waiting} never approved`);
  // A lapsed approval is not an error: it is the gate working. The section
  // ships locked, which still hovers, explains itself and takes a request.
  process.exit(0);
}

const at = new Date().toISOString();
const values = [];
for (const page of Object.keys(published)) {
  if (!all && !only.includes(page)) continue;
  const shapes = published[page].shapes || {};
  for (const section of Object.keys(shapes)) {
    values.push(`(${q(page)}, ${q(section)}, ${q(shapes[section])}, ${q(by)}, ${q(at)})`);
  }
}

if (!values.length) {
  console.log(only.length ? `No mapping found for ${only.join(', ')}.` : 'No sections found in mappings/.');
  process.exit(1);
}

// One statement. Approving is one decision, and half of it landing is worse
// than none of it: a page where four sections went in and three did not is a
// page nobody can reason about from the outside.
d1(
  'INSERT INTO section_approvals (page, section, shape, approved_by, approved_at) VALUES '
  + values.join(', ')
  + ' ON CONFLICT(page, section) DO UPDATE SET shape = excluded.shape,'
  + ' approved_by = excluded.approved_by, approved_at = excluded.approved_at',
);
console.log(`approved ${values.length} section(s) as ${by}, ${where.replace('--', '')}.`);
console.log('No deploy needed: the editor reads this from the database on the next page load.');
