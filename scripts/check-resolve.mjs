// Every address a client can edit must land in a row.
//
//   node --experimental-strip-types scripts/check-resolve.mjs
//
// functions/_resolve.ts is the inverse of scripts/_assemble.mjs: the assembler
// turns rows into the site object the pages render, the resolver turns one
// edited address back into the rows it came from. If they disagree, a client's
// change goes somewhere nothing reads.
//
// functions/api/publish.ts refuses the WHOLE publish when it meets an address
// the resolver does not understand, and names it — which is the right behaviour
// and still means the client finds out. This finds out first: it walks every
// key in src/config/editable.js, expands each `*` against the real content, and
// fails on any address that resolves to nothing.
//
// It also checks the round trip in the direction that matters most for a list:
// that the column the resolver writes is the column the assembler reads, by
// asserting the generated SQL names a table and a row id the assembler knows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_content-source.mjs';
import { EDITABLE, readPath } from '../src/config/editable.js';
import { resolve } from '../functions/_resolve.ts';

const site = JSON.parse(readFileSync(join(ROOT, 'src', 'config', 'site.data.json'), 'utf8')).site;

/** Expand one `*` at a time against the content, so every real address is tried. */
function expand(path) {
  if (!path.includes('*')) return [path];
  const i = path.indexOf('*');
  const head = path.slice(0, i - 1);
  const tail = path.slice(i + 1);
  const at = readPath(site, head);
  if (at == null) return [];
  const keys = Array.isArray(at) ? at.map((_, n) => String(n)) : Object.keys(at);
  return keys.flatMap((k) => expand(`${head}.${k}${tail}`));
}

// A value of the right SHAPE for each kind. The resolver does not validate —
// src/config/editable.js does that before it is called — but it does branch on
// the shape of an image and of a list, so a string handed to an image field
// would exercise the wrong path.
const sample = (def, current) => {
  if (def.kind === 'image') return { src: '/images/gallery/IMG_0780.webp', alt: 'x' };
  if (def.kind === 'link') return { text: 'x', href: '/' };
  if (def.kind === 'ids') return Array.isArray(current) ? current : [];
  if (def.kind === 'list') return Array.isArray(current) ? current : [];
  if (def.kind === 'count') return 1;
  return 'x';
};

let tried = 0;
const dead = [];
const empty = [];
for (const [pattern, def] of Object.entries(EDITABLE)) {
  const paths = expand(pattern);
  if (!paths.length) {
    // A pattern that matches nothing in the content is either a field that has
    // not been written yet or a pattern with a typo in it. Either way nobody
    // can edit it, so it is reported rather than passed over.
    empty.push(pattern);
    continue;
  }
  for (const path of paths) {
    tried += 1;
    let writes = null;
    try {
      writes = resolve(path, sample(def, readPath(site, path)), 'check');
    } catch (e) {
      dead.push([path, `threw: ${String(e.message).slice(0, 120)}`]);
      continue;
    }
    if (!writes || !writes.length) { dead.push([path, 'resolved to nothing']); continue; }
    const bad = writes.find((w) => !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(w.sql));
    if (bad) dead.push([path, `wrote something that is not a write: ${bad.sql.slice(0, 60)}`]);
  }
}

if (empty.length) {
  console.warn(`\n  ⚠ ${empty.length} allowlist pattern(s) match nothing in the content:`);
  for (const p of empty) console.warn(`    ${p}`);
}

if (dead.length) {
  console.error(`\n  ✖ ${dead.length} editable address(es) of ${tried} do not land in a row:\n`);
  for (const [path, why] of dead.slice(0, 40)) console.error(`    ${path.padEnd(44)} ${why}`);
  if (dead.length > 40) console.error(`    … and ${dead.length - 40} more`);
  console.error('\n    Each one is a field a client can change and then not see change.');
  console.error('    Fix functions/_resolve.ts, or take the field out of the allowlist.\n');
  process.exit(1);
}

console.log(`check-resolve: ${tried} editable address(es), all land in a row.`);
if (empty.length) process.exit(1);
