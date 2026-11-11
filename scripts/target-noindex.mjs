// The noindex signals, checked and set against the build target.
//
//   node scripts/target-noindex.mjs
//
// Runs at the END of every build, after astro has written dist/.
//
// The staging noindex mandate says a staging site carries three signals, not
// one: the `noindex, nofollow` meta tag, the `X-Robots-Tag` header in _headers,
// and `Disallow: /` in robots.txt. They were deliberately put in three places
// so that taking them off is a deliberate act (Eric, 2026-08).
//
// Taking them off is now exactly one deliberate act — `RP_TARGET=prod` — and
// this script is what makes that act honest in BOTH directions:
//
//   staging build  →  ASSERTS all three are present in dist/, and FAILS the
//                     build if any one of them is missing. A refactor that
//                     drops a signal can no longer ship quietly.
//   prod build     →  removes all three, and FAILS the build if any one of
//                     them is not where it expected to find it — because a
//                     signal it could not find is a signal it cannot promise
//                     it removed, and a production page silently carrying
//                     `noindex` is the same size of mistake the other way.
//
// Nothing here edits a source file. public/_headers and public/robots.txt stay
// noindex in the repo, so the fail-safe direction is also the committed one.
//
// ── how this one differs from rp-launch's, and why ────────────────────────
// rp-launch REWRITES its robots.txt in place, turning `Disallow` into `Allow`,
// because its production robots.txt is two lines long. This site's is 60 lines
// and names eighteen AI crawlers one at a time; carrying that inside a build
// script, or generating it from a template, would mean the live robots.txt was
// no longer a file anybody could read and diff. So BOTH versions are committed
// files — public/robots.txt (noindex, the safe default) and
// public/robots.prod.txt (the real one) — and a production build swaps one for
// the other and asserts that it did. public/robots.prod.txt is byte-identical
// to what the site served before this pipeline existed.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IS_PROD, TARGET } from '../src/lib/target.js';
import site from '../src/config/site.config.js';

const DIST = new URL('../dist/', import.meta.url).pathname;

const META = '<meta name="robots" content="noindex, nofollow">';
const HEADER_RULE = 'X-Robots-Tag: noindex, nofollow';
const HEADER_BLOCK = '/*\n  X-Robots-Tag: noindex, nofollow\n';
const HEADER_NOTE_FROM = '# ⚠️⚠️ STAGING NOINDEX MANDATE';
const ROBOTS_DISALLOW = 'Disallow: /';
const ROBOTS_ALLOW = 'Allow: /';

const fail = (msg) => { console.error(`\n✗ target-noindex (${TARGET}): ${msg}\n`); process.exit(1); };

const read = (rel) => {
  const p = join(DIST, rel);
  if (!existsSync(p)) fail(`dist/${rel} is missing — did astro build run?`);
  return { p, text: readFileSync(p, 'utf8') };
};

const html = read('index.html');
const headers = read('_headers');
const robots = read('robots.txt');
const prodRobots = join(DIST, 'robots.prod.txt');

// Whichever target this is, the OTHER robots file must not ship: two robots
// files is one more than a crawler can be told about, and the one it would find
// at a path nobody linked is the one nobody checked.
const dropSpare = () => { if (existsSync(prodRobots)) rmSync(prodRobots); };

if (!IS_PROD) {
  // The mandate, enforced rather than remembered.
  const missing = [];
  if (!html.text.includes(META)) missing.push('the meta tag in dist/index.html');
  if (!headers.text.includes(HEADER_RULE)) missing.push('X-Robots-Tag in dist/_headers');
  if (!robots.text.includes(ROBOTS_DISALLOW)) missing.push(`"${ROBOTS_DISALLOW}" in dist/robots.txt`);
  if (robots.text.includes(ROBOTS_ALLOW)) missing.push('dist/robots.txt says Allow — it is the production file');
  if (missing.length) fail(`this build is NOT indexable-safe. Missing: ${missing.join('; ')}`);
  dropSpare();
  console.log(`noindex: all three signals present (staging) · ${site.seo.siteUrl}`);
  process.exit(0);
}

// ── production ────────────────────────────────────────────────────────────────
// Every change is asserted first. "I did not find what I expected" is a
// failure, never a shrug: the whole value of this script is that after it
// exits 0 you know exactly which of the two shapes the build has.

// 1. The meta tag. BaseHead.astro emits the indexable directive on a prod
//    build, so the noindex one should already be gone. If it is here, the
//    layout and src/lib/target.js disagree about the target and neither can be
//    trusted — say so rather than papering over it with a string replace.
if (html.text.includes(META)) {
  fail('the noindex meta tag is in a PRODUCTION build — src/components/BaseHead.astro and src/lib/target.js disagree about the target');
}
if (!html.text.includes(`<meta name="robots" content="${site.seo.robots}">`)) {
  fail('a production build with no indexable robots directive — expected the one in `seo.robots`');
}

// 2. The header. Removed whole, including its `/*` section header, so no empty
//    section is left behind for the next person to wonder about.
if (!headers.text.includes(HEADER_BLOCK)) {
  fail('expected the exact "/*" + X-Robots-Tag block in dist/_headers and did not find it — check public/_headers has not been reworded');
}
if (!headers.text.includes(HEADER_NOTE_FROM)) {
  fail('expected the staging-mandate comment at the top of dist/_headers and did not find it — check public/_headers');
}
const noteStart = headers.text.indexOf(HEADER_NOTE_FROM);
const noteEnd = headers.text.indexOf('\n\n', noteStart);
if (noteEnd === -1) fail('could not find the end of the staging-mandate comment in dist/_headers');
writeFileSync(
  headers.p,
  (headers.text.slice(0, noteStart) + headers.text.slice(noteEnd + 2)).replace(HEADER_BLOCK, ''),
  'utf8',
);

// 3. robots.txt: the real one takes the place of the stub.
if (!existsSync(prodRobots)) fail('dist/robots.prod.txt is missing — it is public/robots.prod.txt and it is what production serves');
const real = readFileSync(prodRobots, 'utf8');
if (!real.includes(ROBOTS_ALLOW)) fail('public/robots.prod.txt does not say "Allow: /" — it is not the production file');
if (real.includes(ROBOTS_DISALLOW)) fail('public/robots.prod.txt contains "Disallow: /" — refusing to serve it as the production file');
writeFileSync(robots.p, real, 'utf8');
rmSync(prodRobots);

// Read the files back off disk rather than trusting the strings we just built:
// this is the line the whole script exists to be able to print.
const after = {
  meta: readFileSync(html.p, 'utf8').includes(META),
  header: readFileSync(headers.p, 'utf8').includes(HEADER_RULE),
  robots: readFileSync(robots.p, 'utf8'),
  spare: existsSync(prodRobots),
};
if (after.meta || after.header || after.robots.includes(ROBOTS_DISALLOW)) {
  fail('a signal survived the removal — refusing to call this build indexable');
}
if (!after.robots.includes(ROBOTS_ALLOW)) fail('robots.txt does not say Allow: / after the swap');
if (after.spare) fail('dist/robots.prod.txt is still there — two robots files would ship');
if (readFileSync(headers.p, 'utf8').includes(HEADER_NOTE_FROM)) fail('_headers still carries the staging-mandate comment');

// The sitemap, pointed at from robots.txt. A crawler holding robots.txt should
// not have to guess the file name. Asserted rather than assumed: a production
// build with no sitemap in dist/ means the integration silently stopped running
// and the line would point at a 404.
const SITEMAP = join(DIST, 'sitemap-index.xml');
if (!existsSync(SITEMAP)) fail('no sitemap-index.xml in a production build');
if (!after.robots.includes('Sitemap:')) {
  writeFileSync(robots.p, `${after.robots.trimEnd()}\nSitemap: ${site.seo.siteUrl}/sitemap-index.xml\n`);
}

console.log(`noindex: all three signals REMOVED (production) · ${site.seo.siteUrl}`);
