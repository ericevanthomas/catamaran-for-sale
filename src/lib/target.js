// Which of the two projects this build is for.
//
// One repo, two Cloudflare Pages projects, the pattern rp-launch set:
//
//   staging  wrangler.toml       catamaran-for-sale-staging.pages.dev   noindex ×3
//   prod     wrangler.prod.toml  www.catamaran-for-sale.com             indexable
//
// ⚠️ THE DEFAULT IS STAGING, AND THAT IS DELIBERATE. Everything about the
// noindex mandate points one way: a build that forgets to say which target it
// is for must come out NOINDEX, because the cost of a staging host slipping
// into the index is real and the cost of a production build needing one
// explicit flag is a flag. `RP_TARGET=prod` is the only thing that makes this
// site indexable, it is set in exactly one place (`npm run build:prod`), and
// scripts/target-noindex.mjs checks afterwards that the build actually came out
// the way the target asked for — in BOTH directions, so a production build
// quietly carrying `noindex` fails just as loudly.
// ⚠️ GUARDED, because this module is reachable from a Pages Function.
// functions/api/folders.ts imports src/config/site.config.js for the site's own
// name, and that imports this file; a bare `process.env` is a ReferenceError in
// a Worker, so /api/folders would have answered 500 and the editor's photo
// library would have opened empty with nothing on the page to say why. The
// build is the only caller that has an environment, and a Worker reading
// `staging` here changes nothing it uses.
const env = typeof process !== 'undefined' && process.env ? process.env : {};
export const TARGET = env.RP_TARGET === 'prod' ? 'prod' : 'staging';
export const IS_PROD = TARGET === 'prod';

// The staging host. Production's canonical host is CONTENT — `seo.siteUrl` in
// the database — because it is a fact about the business and the client can see
// it in the editor; this one is a fact about our deployment and belongs here.
//
// ⚠️ www, not the apex. The apex 301s to www (checked 2026-11-11), www is what
// astro.config.mjs names as `site`, and it is the host the dashboard registry
// points the edit handoff at — because the cookies that handoff sets are
// host-only, and set on the apex they would not be sent to www, which is where
// every link goes. That is exactly how the R button went missing on
// remodelerpilot.com (2026-10-19).
export const STAGING_URL = 'https://catamaran-for-sale-staging.pages.dev';

// ── visit tracking ──────────────────────────────────────────────────────────
// ⚠️ PROD ONLY. Staging stays silent on purpose, the same reasoning as the
// noindex mandate: a staging host quietly filing visits into the live vault
// poisons the numbers Eric reads, and nobody would notice for weeks.
//
// `data-record` adds session replay. It does NOT add bytes to the page: t.js is
// about 1 KB gzipped either way, and the recorder is fetched by t.js only after
// the window load event and inside requestIdleCallback — after every metric
// Lighthouse scores has already been decided.
export const TRACKING = IS_PROD
  ? { host: 'https://rp-dashboard-cw0.pages.dev', site: 'catamaran', record: true }
  : null;

export default { TARGET, IS_PROD, STAGING_URL, TRACKING };
