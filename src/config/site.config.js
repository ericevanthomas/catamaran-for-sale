// What this site says.
//
// ⚠️ IT COMES FROM THIS TENANT'S OWN DATABASE, not from this repository. The
// rows are assembled by scripts/pull-content.mjs into src/config/site.data.json
// at the start of every build, and this file validates and exports them.
//
// This replaced 250 markdown files plus several dozen literals typed into the
// .astro templates. The literals were the real problem: a headline spelled out
// in a template cannot be changed by the person whose boat it is, however good
// the editor is — they could hover it, press it, and get nothing. The markdown
// was better but still needed one of us, a commit and a deploy.
//
// There is NO MERGE. The kit used to lay a patch table of client edits over a
// 1,139-line literal at build time, and that merge is why a deploy could bake a
// client's pending edit into the source and make it the new "original": their
// accidental photograph became the thing the revert arrow stepped back to, and
// the one that belonged there was only recoverable from git (Eric, 2026-10-30).
// Our deploys now render what is already published, which is why they can no
// longer freeze, expose or overwrite the owner's work.
//
// src/config/site.seed.json beside this file is NOT a second source. It is a
// dated snapshot of the migration, read by nothing but
// scripts/check-content-roundtrip.mjs, which is what proves the rows still say
// what the markdown said.
import { validateSite } from './schema.js';
import data from './site.data.json' with { type: 'json' };
import { IS_PROD, STAGING_URL, TRACKING } from '../lib/target.js';

const site = validateSite(data.site);

// ── the one value that differs between the two projects ─────────────────────
// The canonical host. On production it is CONTENT — `seo.siteUrl`, a fact about
// the business that the owner can see in the editor — and on staging it is a
// fact about our deployment, so it comes from src/lib/target.js. Everything that
// needs the host (the canonical link, og:url, the structured data) reads it from
// here, so there is one override rather than four, and nothing is addressed in
// one place and rendered from another (EDITOR-RULES §6.1): `seo.siteUrl` has no
// entry in src/config/editable.js.
export const SITE_URL = IS_PROD ? site.seo.siteUrl : STAGING_URL;
site.seo.siteUrl = SITE_URL;

export { TRACKING };

/** The watermark this build carries, stamped into /rp-build.json by the build. */
export const watermark = data.watermark || null;
export const pulledAt = data.pulled_at || null;

export default site;
