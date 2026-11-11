// Refuse to publish a site built out of stale content.
//
//   node scripts/check-fresh.mjs            (runs inside npm run build / build:prod)
//
// Runs between the pull and `astro build`, so a refusal produces no dist at all
// and there is nothing for anyone to deploy by accident.
//
// ── what this is actually for (2026-11-11) ─────────────────────────────────
// Before today a saved edit reached www.remodelerpilot.com only when Eric
// remembered to run `npm run deploy:prod`. That is bad, but it is bad in a
// VISIBLE way: the staleness is "I haven't deployed yet", and the person who
// has not deployed knows it. The moment a build fires on a schedule — which is
// what publisher/ now asks for — the same staleness becomes invisible: the site
// rebuilds, the deployment is green, and it publishes whatever the committed
// artifact happened to hold. A pipeline that publishes stale content is worse
// than no pipeline, so this step makes that outcome impossible rather than
// unlikely.
//
// scripts/pull-content.mjs has promised in its own header since 2026-10-07 that
// this file runs straight after it. It did not exist until now, which is the
// gap this closes.
//
// ── why it re-reads instead of trusting the pull ───────────────────────────
// pull-content.mjs stamps the artifact with the watermark it read. If this
// check simply believed that stamp it would prove nothing: a pull that FAILED
// keeps the committed artifact — deliberately, because blanking it would
// silently unpublish every edit — and that file is still carrying the committed
// stamp, so it would still pass. So this is an INDEPENDENT read of the current
// watermark, compared against what the artifacts say they hold.
//
// ── and why it fails when it cannot check ──────────────────────────────────
// A guard that waves the build through when it cannot reach the content is not
// a guard; it is a guard-shaped thing that is open exactly when it matters,
// because an unreachable database is also the commonest reason a pull came back
// empty. Unreachable is a failure. The only way past is RP_ALLOW_STALE=1, which
// is loud, prints the staleness it is ignoring, and is for the day something is
// genuinely broken and a code fix has to ship anyway. It must never be set in a
// build environment.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, source, watermark, configFile } from './_content-source.mjs';

// Both artifacts, because both ship. They are written by ONE read in
// pull-content.mjs, so they must agree; if they ever do not, something wrote
// one of them by hand and the pair no longer describes one state of the site.
const ARTIFACTS = {
  'src/config/site.data.json': 'site',
  'src/config/media.json': 'media',
};

const die = (lines) => {
  console.error('\n  ✖ STALE CONTENT — not building.\n');
  for (const l of lines) console.error('    ' + l);
  console.error('\n    Fix it:   npm run content   (then build again)');
  console.error('    Override: RP_ALLOW_STALE=1 npm run build   — ships old content on purpose\n');
  process.exit(1);
};

const allow = process.env.RP_ALLOW_STALE === '1';
const src = source();

// ── 1. what do the artifacts say they carry ────────────────────────────────
const carried = {};
for (const [rel, key] of Object.entries(ARTIFACTS)) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); } catch (e) {
    die([`${rel} could not be read: ${String(e.message).slice(0, 120)}`]);
  }
  if (typeof doc.watermark !== 'string' || !doc.watermark) {
    die([
      `${rel} does not record which content it carries.`,
      '',
      'An artifact that cannot say what is in it cannot be checked, so it is',
      'treated as stale. One `npm run content` fixes it permanently.',
    ]);
  }
  if (!doc[key]) die([`${rel} has no "${key}" — it is not a content artifact.`]);
  carried[rel] = doc.watermark;
}

const stamps = [...new Set(Object.values(carried))];
if (stamps.length > 1) {
  die([
    'the artifacts disagree about what they carry:',
    ...Object.entries(carried).map(([f, w]) => `  ${f.padEnd(28)} ${w}`),
    '',
    'Re-pull so both come from one read.',
  ]);
}
const held = stamps[0];

// ── 2. what is actually current ────────────────────────────────────────────
// ⚠️ WHICH TENANT this reads is decided by the lane, and the two lanes decide
// it differently: `remote` reads `database_name` from wrangler.toml or
// wrangler.prod.toml (so RP_TARGET picks it), `http` reads whatever host
// RP_ARTIFACT_URL names. A prod build checked against staging would pass while
// publishing the wrong site's words, so the lane is printed on every run and
// the two values are set together in .github/workflows/deploy.yml.
const lane = src === 'http'
  ? `${(process.env.RP_ARTIFACT_URL || '').replace(/\/+$/, '')}/api/artifact`
  : `wrangler ${src} (${configFile()})`;

let now;
try {
  now = await watermark(src);
} catch (e) {
  const msg = String(e.stderr || e.message || e).split('\n')[0].slice(0, 300);
  if (allow) {
    console.warn(`\n  ⚠ RP_ALLOW_STALE=1 — could not check freshness via ${lane} and building anyway.`);
    console.warn(`    ${msg}`);
    console.warn(`    The build will carry watermark ${held}, and nobody knows whether that is current.\n`);
    process.exit(0);
  }
  die([
    `could not read the current watermark via ${lane}:`,
    `  ${msg}`,
    '',
    'This is a failure, not a pass. An unreachable database is the commonest',
    'reason a pull comes back with nothing, so "cannot check" and "stale" are',
    'the same outcome from the build\'s point of view.',
    '',
    'In CI: check RP_ARTIFACT_URL and RP_BUILD_KEY, and that the site still has',
    'the RP_BUILD_KEY secret. On a laptop: npx wrangler whoami.',
  ]);
}

// ── 3. the verdict ─────────────────────────────────────────────────────────
if (now.key === held) {
  console.log(`check-fresh: current via ${lane} · ${held}`);
  process.exit(0);
}

const detail = [
  'the artifacts are not what this site currently holds:',
  `  artifacts carry    ${held}`,
  `  database holds     ${now.key}`,
  ...(now.last_edit_at ? [`  last edit          ${now.last_edit_at}`] : []),
  `  read via           ${lane}`,
];

if (allow) {
  console.warn('\n  ⚠ RP_ALLOW_STALE=1 — building stale content on purpose.');
  for (const l of detail) console.warn('    ' + l);
  console.warn('    Whatever was changed since those artifacts were pulled will NOT ship.\n');
  process.exit(0);
}
die(detail);
