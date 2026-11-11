// The SHAPE of every section on every page. Not whether it is approved.
//
// Split on 2026-09-30, along the line the two things were always on. The
// mapping is code: generated from the markup, reviewed in a diff, identical
// for every client running this kit. The approval is data: per client, in
// that client's own D1, written the moment somebody says go rather than the
// next time somebody deploys (Eric: "I would just need somewhere to quickly
// glance at it and say go").
//
// So this file publishes the half that is code—a fingerprint per section —
// and /api/approvals serves the half that is data. A section is editable when
// the database holds a row for it whose shape equals the one published here.
// Add an element, remove one, reorder them, and the fingerprint moves, the
// row stops matching, and the approval lapses on its own: RULES §10 enforced
// by arithmetic instead of by memory.
//
// Read from mappings/ at build time, so the shape that ships is the shape in
// the commit.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// ⚠️ TWO CANDIDATES, AND A BUILD THAT FAILS IF NEITHER HOLDS ANYTHING.
//
// `new URL('../../mappings/', import.meta.url)` is what rp-launch uses and it
// resolves correctly there. In this project's Astro build it does not: this
// module is bundled into dist/.prerender/chunks/ before it runs, so the
// relative walk lands in a directory that does not exist, `walk()` returns
// nothing, and the endpoint happily publishes `{"pages":{}}`.
//
// That is as quiet a failure as this platform has. The editor compares a
// section's approved SHAPE against the shape published here; with no published
// shape nothing can match, so every section of every page says "Not ready to
// edit yet — we are still setting this section up for editing" and offers to
// take a request instead. The mappings are right, the approvals are in the
// database, the editor loads, and nothing on the screen or in any log says
// what is wrong. It cost an hour on 2026-11-11 and it would cost it again.
//
// So: try the relative path, fall back to the working directory (which is the
// repository root for `astro build`), and REFUSE TO BUILD if what we find has
// no mappings in it. An empty shape map is never a legitimate state — a site
// with no mappings fails `npm run check` long before it gets here.
const CANDIDATES = [
  new URL('../../mappings/', import.meta.url).pathname,
  join(process.cwd(), 'mappings'),
];
const DIR = CANDIDATES.find((d) => existsSync(d)) || CANDIDATES[0];

// The same three lines as scripts/check-mapping.mjs, over the same input —
// the section's element shapes, in order, joined. Computed here rather than
// only read from the file so a mapping written before fingerprints existed
// still publishes a usable one, and so this endpoint can never publish a
// shape that disagrees with the elements beside it.
const sectionShape = (els) =>
  createHash('sha256').update((els || []).map((e) => e.shape).join('|')).digest('hex').slice(0, 12);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

export function GET() {
  const pages = {};
  for (const file of walk(DIR)) {
    let d;
    try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (!d || !d.page) continue;
    const shapes = {};
    const els = {};
    for (const s of d.sections || []) {
      if (!s || !s.section) continue;
      shapes[s.section] = sectionShape(s.els);
      // What is in the section, so the staff review panel can list it without
      // a second request. Eric does not want to read a mapping—he wants to
      // confirm the section behaves—but when he presses Approve the panel
      // has to be able to say what he is approving (2026-09-30).
      els[s.section] = (s.els || []).map((e) => ({
        el: e.el,
        field: e.field || null,
        kind: e.kind || null,
        label: e.label || null,
        explain: e.explain || null,
      }));
    }
    const key = d.page.replace(/\/$/, '') || '/';
    pages[key] = { shapes, els };
  }
  if (!Object.keys(pages).length) {
    throw new Error(
      `rp-approvals.json: no mappings found.\n`
      + `  looked in: ${CANDIDATES.join('\n             ')}\n\n`
      + `  Publishing an empty shape map would ship an editor that cannot edit\n`
      + `  anything and cannot say why: every section would read "Not ready to\n`
      + `  edit yet". Run \`npm run map\` to write mappings/, then build again.`,
    );
  }
  return new Response(JSON.stringify({ pages }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
