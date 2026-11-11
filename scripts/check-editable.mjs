// Nothing on a client's site may be dead in the editor.
//
// The promise is NOT that a client can type over every pixel. It is that every
// piece of text, every photo and every element either has an address and can be
// changed, or says in plain English why it cannot and offers to have us do it.
// An element with neither is a client clicking and getting nothing back, and
// once one of those ships, the whole editor stops feeling trustworthy.
//
// This walks the BUILT pages and fails on anything uncovered, so a template
// change that quietly drops an address is caught here rather than by Eric
// (Eric, 2026-09-29).
//
//   node scripts/check-editable.mjs           report, exit 1 if anything is dead
//   node scripts/check-editable.mjs --list    every finding, not just a sample
//
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'parse5';

const DIST = new URL('../dist/', import.meta.url).pathname;

// An address, or an explanation. Either one covers everything inside it.
const COVERS = [
  'data-rp-field',    // editable: has a home in the config
  'data-rp-fixed',    // fixed: the drawer says why, and offers to change it
  'data-rp-auto',     // automatic: fills itself from the client's own content
  'data-rp-tied',     // tied to a record: choosing, not typing
  'data-rp-ordinal',  // counts itself
  // A whole RECORD: pressing anywhere in it opens that record in its own
  // editor. It covers its contents for the same reason `data-rp-fixed` does —
  // a click lands somewhere and says something — and it is the one of these
  // five that leads to an EDIT rather than to a request.
  'data-rp-post',
];
// Deliberately NOT here: data-rp-section and data-rp-item. A section frame
// under every orphaned line is exactly the vagueness this check exists to find.

// Things that carry words a visitor reads.
const TEXTY = new Set(['h1','h2','h3','h4','h5','h6','p','li','a','button','span','td','th',
  'blockquote','figcaption','caption','summary','dt','dd','label','strong','em','address','time','small']);
const SKIP = new Set(['script','style','svg','head','noscript','template','title','meta','link','path','option','br','hr']);
// Read aloud but never hovered, so there is nothing to explain to anyone.
const HIDDEN = /(^|\s)(visually-hidden|sr-only|skip-link|skip)(\s|$)/;

const attr = (n, name) => (n.attrs || []).find((a) => a.name === name)?.value;
const cls = (n) => attr(n, 'class') || '';

function pages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function check(file) {
  const doc = parse(readFileSync(file, 'utf8'));
  const dead = [];

  function walk(node, covered, trail) {
    const tag = node.nodeName;
    if (SKIP.has(tag)) return;
    if (node.attrs) {
      if (COVERS.some((a) => attr(node, a) != null)) covered = true;
      if (attr(node, 'hidden') != null) return;
      if (HIDDEN.test(cls(node))) return;
      if (attr(node, 'aria-hidden') === 'true') return;
    }
    const where = tag + (cls(node) ? '.' + cls(node).split(/\s+/)[0] : '');
    const here = node.nodeName === '#document' ? trail : trail.concat(where);

    // Its own words, not a child's.
    const own = (node.childNodes || [])
      .filter((c) => c.nodeName === '#text')
      .map((c) => c.value)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!covered && own.length > 1 && TEXTY.has(tag)) {
      dead.push({ what: here.slice(-3).join(' > '), text: own.slice(0, 64) });
    }
    if (!covered && tag === 'img') {
      dead.push({ what: here.slice(-3).join(' > '), text: 'IMG ' + (attr(node, 'src') || '') });
    }
    for (const kid of node.childNodes || []) walk(kid, covered, here);
  }
  walk(doc, false, []);
  return dead;
}

const list = process.argv.includes('--list');
// ⚠️ THE PRINT SOURCES ARE NOT PAGES OF THIS SITE, which is why they are
// skipped rather than mapped. `specs-sheet.html`, `disclosure-draft.html` and
// `documents/build/*` are hand-written HTML in public/, laid out for paper and
// rendered to the PDFs the site links to (public/specs-sheet.pdf,
// public/documents/*.pdf). Nothing navigates to them, nothing links to them,
// and the editor is for the pages a visitor reads.
//
// ⚠️ THEY ARE STILL SERVED, THOUGH, and that is worth knowing rather than
// hiding behind this filter: /specs-sheet.html is reachable and still says
// "for sale by owner, $379,000" on a site whose every other page says Sold,
// and /disclosure-draft.html is a draft. Neither is in the sitemap and neither
// is linked, so neither is likely to be found, but "unlikely to be found" is
// not the same as "not published". Flagged on 2026-11-11 and deliberately not
// changed: what a sold listing should still publish about its price is Eric's
// call, not a side effect of a content migration.
const PRINT_SOURCES = /^(library[/.]|styleguide\.html|specs-sheet\.html|disclosure-draft\.html|documents[/])/;
const files = pages(DIST).filter((f) => !PRINT_SOURCES.test(relative(DIST, f))).sort();
let total = 0;
const byPage = [];
for (const f of files) {
  const dead = check(f);
  if (dead.length) { total += dead.length; byPage.push({ page: '/' + relative(DIST, f).replace(/index\.html$/, ''), dead }); }
}

byPage.sort((a, b) => b.dead.length - a.dead.length);
for (const { page, dead } of byPage) {
  console.log(`\n${page}  —  ${dead.length} with no address and no explanation`);
  for (const d of (list ? dead : dead.slice(0, 8))) console.log(`   ${d.what.padEnd(46)} ${d.text}`);
  if (!list && dead.length > 8) console.log(`   … and ${dead.length - 8} more`);
}
console.log(`\n${total} dead element(s) across ${byPage.length} of ${files.length} pages.`);
process.exit(total ? 1 : 0);
