// Bring this site's content out of its own database and into the build.
//
//   node scripts/pull-content.mjs [--remote | --local | --http]
//
// Writes two artifacts, from ONE read:
//
//   src/config/site.data.json   every word, every photograph reference, every
//                               specification — assembled from `setting`,
//                               `block`, `block_pick` and `faq` by
//                               scripts/_assemble.mjs. src/config/site.config.js
//                               validates it and the pages render it.
//   src/config/media.json       the photo library's own descriptions, so the
//                               editor's picker can show what each file shows
//                               without a database read per thumbnail.
//
// ⚠️ THERE IS NO MERGE. The database holds the content; this reads it; the build
// renders what it reads. The kit used to lay a patch table over a 1,139-line
// literal in git, and that merge is why a deploy could bake a client's pending
// edit into the SOURCE and make it the new "original" — their accidental
// photograph became the thing the revert arrow stepped back to (Eric,
// 2026-10-30). There is no literal left to bake anything into: the only copy of
// the words in this repository is src/config/site.seed.json, which is a dated
// snapshot of the migration and is read by nothing but the round-trip check.
//
// ⚠️ DRAFTS ARE NOT PULLED, on purpose. A save lands in `content` and the editor
// shows it back to the client immediately; the BUILT site does not move until
// they press Publish, which applies the draft to the rows above
// (functions/api/publish.ts). Pulling drafts here would publish unfinished work
// on the next deploy, which is the behaviour that change removed.
//
// Per-site by construction: the database name comes from wrangler.toml or
// wrangler.prod.toml depending on RP_TARGET, and the HTTP lane reads one
// endpoint on one host. Neither can reach another tenant's content.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, source, artifact, configFile } from './_content-source.mjs';
import { assemble } from './_assemble.mjs';

const dataOut = join(ROOT, 'src', 'config', 'site.data.json');
const mediaOut = join(ROOT, 'src', 'config', 'media.json');
const src = source();

const held = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const lane = src === 'http'
  ? `${(process.env.RP_ARTIFACT_URL || '').replace(/\/+$/, '')}/api/artifact`
  : `wrangler ${src} (${configFile()})`;
console.log(`pull-content: reading via ${lane}`);

let got = null;
try {
  got = await artifact(src);
} catch (e) {
  console.warn('pull-content: ' + String(e.stderr || e.message || e).split('\n')[0].slice(0, 300));
}

// ⚠️ On a failed read, KEEP what is committed and say so — do not blank it.
// Blanking would silently unpublish every edit, and deciding whether a build may
// proceed is not this script's job: scripts/check-fresh.mjs re-reads the
// watermark independently and fails the build if what is here is not current. A
// pull that vouched for its own freshness would wave through its own failures.
if (!got) {
  const d = held(dataOut);
  console.warn('pull-content: could not read the content — keeping the artifacts already committed.');
  console.warn(`  site.data.json: unchanged, watermark ${d?.watermark || '(none recorded)'}`);
  console.warn('  check-fresh will decide whether this build may ship.');
  process.exit(0);
}

const site = assemble(got.tables);

// A read that came back empty is a failure wearing a success's clothes: it would
// build a site with no words in it and deploy that over a real one.
const n = (site.specs || []).length + (site.faqs || []).length + Object.keys(site.pageCopy || {}).length;
if (!n) {
  console.error('pull-content: the database returned nothing. Refusing to write an empty site.');
  process.exit(1);
}

const stamp = new Date().toISOString();
writeFileSync(dataOut, JSON.stringify({ pulled_at: stamp, watermark: got.key, site }, null, 2) + '\n');
writeFileSync(mediaOut, JSON.stringify({ pulled_at: stamp, watermark: got.key, media: got.media }, null, 2) + '\n');

const drafts = Object.keys(got.fields || {}).length;
console.log(`site.data.json: ${(site.features || []).length} feature(s), ${(site.specs || []).length} spec row(s), `
  + `${(site.faqs || []).length} question(s), ${(site.gallery || []).length} photo(s), `
  + `${(site.equipment || []).reduce((t, s) => t + (s.items || []).length, 0)} equipment line(s)`);
console.log(`media.json: ${Object.keys(got.media).length} photo(s) described`);
console.log(`watermark: ${got.key}`);
if (drafts) {
  console.log(`\n  ${drafts} unpublished draft edit(s) in this database. They are NOT in this build:`);
  console.log('  a save is the client\'s to make and a publish is the client\'s to press.');
}
