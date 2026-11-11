// Prove the database still says what the site said before it moved there.
//
//   node scripts/check-content-roundtrip.mjs [--remote | --local]
//
// Reads every content table out of this site's own D1, runs the SAME assemble()
// the build runs, and compares the result to src/config/site.seed.json — the
// snapshot taken from the markdown and the templates on the day the content
// moved (2026-11-11).
//
// ── why this is the check that matters ─────────────────────────────────────
// A content migration has exactly one failure mode worth defending against:
// something arrives in the database in a shape nothing reads, and the page goes
// quiet where those words were. On a boat listing the words in question are
// engine hours, tank capacities and a price, so "mostly moved" is not a state
// anybody can inspect by looking at the page.
//
// ⚠️ IT IS A MIGRATION CHECK, NOT A MONITOR, and it stops being green the first
// time the owner publishes a change — which is the system working. The snapshot
// is dated: it is what the markdown and the templates said on 2026-11-11, and
// the whole point of the migration is that the database is allowed to move away
// from it. So this is run against a freshly seeded database (it was, on both
// the staging twin and production, with 2,569 of 2,569 leaf values identical),
// and after that a difference here means "somebody edited the site", not "the
// content is wrong". It is deliberately NOT part of `npm run check`.
//
// It compares LEAF BY LEAF and prints the paths, not a boolean. A diff that
// says "not equal" sends somebody reading 190 KB of JSON; a diff that says
// `specs.11.value: "3,323 & 3,213 hours" → "3,323 and 3,213 hours"` is the bug.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, dbName, configFile } from './_content-source.mjs';
import { assemble, TABLES } from './_assemble.mjs';
import { leaves } from './_content-map.mjs';

const mode = process.argv.includes('--local') ? '--local' : '--remote';
const db = dbName();

const query = (sql) => {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', db, mode, '--json', '--command', sql],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(raw.slice(raw.search(/[[{]/)))[0].results;
};

console.log(`check-content-roundtrip: reading ${db} (${configFile()})`);
const tables = {};
for (const [name, order] of Object.entries(TABLES)) tables[name] = query(`SELECT * FROM ${name} ORDER BY ${order}`);

const got = assemble(tables);
const want = JSON.parse(readFileSync(join(ROOT, 'src', 'config', 'site.seed.json'), 'utf8'));

const flat = (o) => Object.fromEntries(leaves(o).map(([k, v]) => [k, v]));
const a = flat(want);
const b = flat(got);

const missing = Object.keys(a).filter((k) => !(k in b));
const extra = Object.keys(b).filter((k) => !(k in a));
const changed = Object.keys(a).filter((k) => k in b && a[k] !== b[k]);

const show = (label, list, fmt) => {
  if (!list.length) return;
  console.error(`\n  ${label} (${list.length}):`);
  for (const k of list.slice(0, 25)) console.error('    ' + fmt(k));
  if (list.length > 25) console.error(`    … and ${list.length - 25} more`);
};

show('LOST — in the snapshot, not in the database', missing, (k) => `${k} = ${JSON.stringify(a[k])}`);
show('EXTRA — in the database, not in the snapshot', extra, (k) => `${k} = ${JSON.stringify(b[k])}`);
show('CHANGED', changed, (k) => `${k}\n      was ${JSON.stringify(a[k])}\n      now ${JSON.stringify(b[k])}`);

const bad = missing.length + extra.length + changed.length;
if (bad) {
  console.error(`\n  ✖ ${bad} difference(s) across ${Object.keys(a).length} leaf value(s). The content did not survive the move.\n`);
  process.exit(1);
}
console.log(`check-content-roundtrip: ${Object.keys(a).length} leaf value(s), all identical.`);
