// The push gate: a section is editable only if every element in it is mapped.
//
// Implements wires/EDITOR-RULES.md §10. Markup and mapping are produced in the
// same commit, so they cannot drift apart — this is what enforces that, rather
// than trusting whoever (or whatever) last touched the section to remember.
//
//   node scripts/check-mapping.mjs          compare the build to the mappings
//   node scripts/check-mapping.mjs --write  regenerate them (then review the diff)
//
// Exit 1 on anything unmapped, stale, or needing Eric.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import { fieldDef, KEYED } from '../src/config/editable.js';

// A section's SHAPE, as one value.
//
// Approval is bound to the shape, and since 2026-09-30 the approval lives in
// the client's D1 rather than in this file's output (migrations/0014). A row
// in another system cannot be compared against a list, so the list becomes a
// hash: add an element, remove one, reorder them, change what one is FOR, and
// the hash moves and the approval stops matching. That is RULES §10's "a
// structural change lapses the approval", enforced by data.
//
// Twelve hex characters, because this is a fingerprint for a human to glance
// at in a diff, not a cryptographic commitment. The same three lines live in
// src/pages/rp-approvals.json.js, which is what publishes the value the
// editor compares against; both hash the SAME input — the ordered element
// shapes, joined — so they cannot disagree without one of them being edited
// on its own.
const sectionShape = (els) =>
  createHash('sha256').update(els.map((e) => e.shape).join('|')).digest('hex').slice(0, 12);

const DIST = new URL('../dist/', import.meta.url).pathname;
const MAPS = new URL('../mappings/', import.meta.url).pathname;
const WRITE = process.argv.includes('--write');

// RULES §9. These need Eric, and an agent may not approve them.
// Only a RECORD has a name that renames menus and URLs. `whyUs.items.0.title`
// is a heading in a list, and flagging it as a rename buried the real ones.
// ⚠️ A CARVE-OUT FOR THIS SITE, and only this site (Eric, 2026-10-19).
//
// The rule behind ASK_ERIC is that renaming a record changes menus, URLs and
// breadcrumbs, so a human signs it off. That is true of a service, a project
// or a guide. It is not true of anything here: this is ONE page with no
// routes, no menu built from data and no breadcrumbs, so a "name" in these
// two collections is a line of copy and nothing more.
//
// Left alone the rule flagged 22 fields — every label in the included list
// and every row title in the three system cards — which meant a client
// editing one of them raised a request instead of saving it, to protect URLs
// that do not exist.
//
// The collections are named rather than the test being weakened, so the day
// this site grows a routed record type the flag comes back on its own.
const NOT_RECORDS_HERE = ['included.rows', 'system.cards'];

const isRecord = (path) =>
  !NOT_RECORDS_HERE.some((c) => path === c || path.startsWith(c + '.'))
  && Object.keys(KEYED).some((c) => path === c || path.startsWith(c + '.'));
const ASK_ERIC = [
  [/\.(name|slug|title)$/, 'renames a record — changes menus, URLs and breadcrumbs', true],
  [/\.faqIds$|\.reviewId$|\.guides$|\.press$|\.reviews$|\.faqs$/, 'changes which records appear', false],
];
const askWhy = (path, el) => {
  if (el.shared) return 'marked shared across pages';
  for (const [re, why, recordsOnly] of ASK_ERIC) {
    if (!re.test(path)) continue;
    if (recordsOnly && !isRecord(path)) continue;
    return why;
  }
  return null;
};

const attr = (n, name) => (n.attrs || []).find((a) => a.name === name)?.value;

function pages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

// Everything the editor treats as a thing, in document order, grouped by the
// section it sits in. An undeclared section is still a section (§1).
function read(file) {
  const doc = parse(readFileSync(file, 'utf8'));
  const sections = [];
  let current = null;

  const open = (id, name) => { current = { section: id || '(undeclared)', name: name || null, els: [] }; sections.push(current); };

  (function walk(n) {
    if (['script', 'style', 'svg', 'head'].includes(n.nodeName)) return;
    if (n.attrs) {
      const sid = attr(n, 'data-rp-section');
      if (sid != null) open(sid, attr(n, 'data-rp-section-name'));
      const field = attr(n, 'data-rp-field');
      const fixed = attr(n, 'data-rp-fixed');
      const auto = attr(n, 'data-rp-auto');
      // A whole RECORD the client writes, opening its own editor. It is a
      // mapped element like any other and it has to be IN the mapping: without
      // it a blog post's two sections came out with no elements at all and an
      // empty-string fingerprint, so the mapping said "nothing here" about the
      // one thing on the page a client can change (RULES §1, at the level of
      // the mapping rather than the page).
      const record = attr(n, 'data-rp-post');
      if (field || fixed || auto || record) {
        if (!current) open(null, null);
        const e = { el: field || fixed || auto || `record:${(record || '').split('/')[0]}` };
        if (record && !field && !fixed && !auto) {
          e.record = (record || '').split('/')[0];
          e.kind = 'record';
          e.label = attr(n, 'data-rp-post-label') || null;
        } else if (field) {
          e.field = field;
          e.kind = attr(n, 'data-rp-kind') || 'text';
          e.label = attr(n, 'data-rp-label') || null;
          if (attr(n, 'data-rp-global') != null) e.shared = true;
        } else {
          e.locked = true;
          e.explain = fixed || auto;
        }
        current.els.push(e);
      }
    }
    for (const kid of n.childNodes || []) walk(kid);
  })(doc);

  // Collapse repeats: a list of eight cards is one shape, not eight.
  for (const s of sections) {
    const seen = new Set();
    s.els = s.els.filter((e) => {
      const k = (e.field || e.explain || (e.record ? `record:${e.record}` : ''))
        .replace(/\.[a-z0-9-]+\./g, '.*.').replace(/\.\d+/g, '.*');
      if (seen.has(k)) return false;
      seen.add(k);
      e.shape = k;
      return true;
    });
  }
  return sections;
}

// ⚠️ THE SAME EXCLUSION AS scripts/check-editable.mjs, AND FOR THE SAME REASON.
// `specs-sheet.html`, `disclosure-draft.html`, `documents/` and `admin/` are
// hand-written HTML in public/, laid out for paper or for us, and rendered to
// the PDFs the site links to. They are not pages of this site, nobody
// navigates to them, and mapping them would mean a client's approval queue
// filling up with print sources. The note in check-editable.mjs records that
// they are nonetheless SERVED, which is a separate thing worth knowing.
const PRINT_SOURCES = /^(library[/.]|styleguide\.html|specs-sheet\.html|disclosure-draft\.html|documents[/]|admin[/])/;
const files = pages(DIST).filter((f) => !PRINT_SOURCES.test(relative(DIST, f)));
let unmapped = 0, stale = 0, wrote = 0, fresh = 0;
// Sections whose stored fingerprint no longer matches the markup. Not a
// failure — the mapping is regenerated with `npm run map` and reviewed in a
// diff — but it is the reason a page's approvals would all read as lapsed.
const drifted = [];
// Flags are DISTINCT decisions, not occurrences. The footer's tagline needing
// Eric is one decision, not one per page — counting occurrences buried the
// eleven real ones under three hundred repeats.
const decisions = new Map();

for (const file of files) {
  const page = '/' + relative(DIST, file).replace(/(index)?\.html$/, '');
  const live = read(file);
  const mapFile = join(MAPS, relative(DIST, file).replace(/\.html$/, '.json'));
  const held = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : null;

  // Which of this page's elements an agent may not sign off.
  const flagged = [];
  for (const s of live) for (const e of s.els) {
    if (!e.field) continue;
    const why = askWhy(e.field, e);
    if (why) {
      flagged.push(`${s.section} · ${e.field} — ${why}`);
      const k = `${e.field} — ${why}`;
      if (!decisions.has(k)) decisions.set(k, []);
      decisions.get(k).push(page);
    }
    if (!fieldDef(e.field)) { console.log(`  ✗ ${page} · ${e.field} is not in the allowlist`); unmapped += 1; }
  }

  if (WRITE) {
    mkdirSync(dirname(mapFile), { recursive: true });
    // No `approved` key any more, and that is the point.
    //
    // It used to carry one, and re-running this script had to work out which
    // approvals survived a regeneration. That is gone: the mapping is code
    // and says only what the section IS, while whether it has been signed off
    // is this client's data and lives in their D1 (migrations/0014). So this
    // file writes the shape and nothing else, a regeneration can never
    // un-approve anything by accident, and the approval lapses on its own
    // when the shape it was given for stops matching.
    for (const s of live) s.shape = sectionShape(s.els);
    writeFileSync(mapFile, JSON.stringify({ page, sections: live }, null, 2) + '\n');
    wrote += 1;
    continue;
  }

  if (!held) {
    console.log(`  ✗ ${page} has no mapping — every section ships LOCKED`);
    unmapped += live.reduce((n, s) => n + s.els.length, 0);
    continue;
  }

  const shapeOf = (m) => new Set(m.flatMap((s) => s.els.map((e) => s.section + '|' + e.shape)));
  const now = shapeOf(live), was = shapeOf(held.sections || []);
  for (const k of now) if (!was.has(k)) { console.log(`  ✗ ${page} · ${k} is not mapped`); unmapped += 1; }
  for (const k of was) if (!now.has(k)) { console.log(`  · ${page} · ${k} is mapped but no longer rendered`); stale += 1; }
  // Whether each section has been signed off is no longer a question this
  // script can answer: the answer is in the client's database, not in the
  // repo (migrations/0014). What it CAN say is whether the fingerprint in the
  // mapping still describes what the build just produced — because a stale
  // one means the published shape disagrees with the markup, every approval
  // on this page lapses at once, and the cause is a mapping nobody
  // regenerated rather than anything Eric did.
  for (const sx of held.sections || []) {
    const now2 = live.filter((s) => s.section === sx.section)[0];
    if (!now2) continue;
    if (sx.shape && sx.shape === sectionShape(now2.els)) fresh += 1;
    else drifted.push(`${page} · ${sx.section}`);
  }

}

if (WRITE) {
  console.log(`\nwrote ${wrote} mapping(s) to mappings/. Review the diff, then record approval.`);
  process.exit(0);
}
if (decisions.size) {
  console.log('\nNeeds Eric before these can be unlocked (RULES §9):');
  for (const [what, where] of [...decisions].sort()) {
    console.log(`  ⚑ ${what}`);
    console.log(`      on ${where.length === 1 ? where[0] : where.length + ' pages'}`);
  }
}
console.log(`\n${files.length} pages · ${unmapped} unmapped · ${stale} stale · ${fresh} section(s) fingerprinted`);
if (drifted.length) {
  console.log(`\n${drifted.length} section(s) have no current fingerprint, so their approvals read as lapsed:`);
  for (const d of drifted.slice(0, 12)) console.log(`  · ${d}`);
  if (drifted.length > 12) console.log(`  · and ${drifted.length - 12} more`);
  console.log('Run `npm run map`, review the diff, and re-approve what changed.');
}
if (unmapped) {
  console.log('An unmapped element means its whole section ships LOCKED, which still hovers, explains itself and takes a request.');
} else if (!drifted.length) {
  console.log('Every rendered element is mapped, and every section carries the fingerprint its approval is bound to.');
}
console.log('Who has approved what is in this client’s database, not in the repo: `node scripts/approve.mjs --list`.');
if (decisions.size) console.log(`${decisions.size} of the mapped fields are the kind only Eric may sign off (listed above).`);
process.exit(unmapped ? 1 : 0);
