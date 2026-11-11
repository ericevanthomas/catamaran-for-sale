// Make the live site say what it is serving.
//
//   node scripts/stamp-build.mjs        (runs at the end of npm run build)
//
// Writes dist/rp-build.json: the watermark this build carried, when it was
// built, and the commit it came from if the builder knew one.
//
// ── why the LIVE SITE and not a report ─────────────────────────────────────
// publisher/ has to know whether the client's latest edit has reached
// production, or it will either never trigger a deploy or trigger one every
// five minutes forever. The obvious way is for the build to report in — POST
// "I built watermark X" at the end. Two things are wrong with that:
//
//   1. A build is not a deploy. `npm run build` on a laptop, a preview
//      deployment of a branch, a build whose upload then failed — each of them
//      would have reported, and the Worker would believe production was current
//      while production was not. The client's edit then sits unpublished and
//      nothing is ever going to notice.
//   2. It needs a write endpoint and a credential to use it, for a fact that
//      can simply be looked up.
//
// So nothing reports. The build stamps the file, Pages publishes it with the
// rest of dist, and the Worker fetches https://<site>/rp-build.json. The answer
// is then about what is ACTUALLY on the internet, which is the question it was
// trying to ask in the first place.
//
// ── what a visitor sees ────────────────────────────────────────────────────
// Nothing. No page links it, it is not in the sitemap (it is written after
// astro build, so the sitemap integration never sees it), and it holds a
// timestamp and three row counts — a watermark is an opaque equality token, not
// content. It is also genuinely useful at a terminal: curl it and you know,
// without asking anybody, exactly which content the live site is serving.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_content-source.mjs';

const dist = join(ROOT, 'dist');
if (!existsSync(dist)) {
  console.error('stamp-build: no dist/ — run astro build first');
  process.exit(1);
}

let doc;
try { doc = JSON.parse(readFileSync(join(ROOT, 'src', 'config', 'site.data.json'), 'utf8')); } catch (e) {
  console.error('stamp-build: cannot read src/config/site.data.json: ' + String(e.message).slice(0, 160));
  process.exit(1);
}

// No watermark, no stamp. check-fresh.mjs refuses to let a build get this far
// without one, so reaching here unstamped means someone ran astro directly —
// and a rp-build.json with a guessed watermark would tell the Worker the site
// is current when nobody knows that.
if (typeof doc.watermark !== 'string' || !doc.watermark) {
  console.error('stamp-build: src/config/site.data.json records no watermark — run npm run content');
  process.exit(1);
}

// Cloudflare Pages sets these in CI; locally they are simply absent, and absent
// is more honest than a placeholder.
const ref = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || null;

const stamp = {
  watermark: doc.watermark,
  built_at: new Date().toISOString(),
  ref: ref ? ref.slice(0, 12) : null,
  branch: process.env.CF_PAGES_BRANCH || null,
};

writeFileSync(join(dist, 'rp-build.json'), JSON.stringify(stamp, null, 2) + '\n');
console.log(`rp-build.json: ${stamp.watermark}${stamp.ref ? ' @ ' + stamp.ref : ''}`);
