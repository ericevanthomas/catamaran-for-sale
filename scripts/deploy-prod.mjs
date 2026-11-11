// Deploy the production project without ever putting the staging config in
// front of wrangler.
//
//   node scripts/deploy-prod.mjs            (what `npm run deploy:prod` runs)
//
// ── the problem this exists for ───────────────────────────────────────────
// `wrangler pages deploy` reads wrangler.toml for the project's BINDINGS and
// [vars] and applies them to the project it is deploying to. It finds that
// file by walking up from the working directory, and it refuses a custom path:
//
//     ✘ Pages does not support custom paths for the Wrangler configuration file
//
// So `-c wrangler.prod.toml` is not available, and a plain deploy from the
// repo root would hand the production project STAGING's D1 and STAGING's R2 —
// one tenant's database bound to another tenant's site, which is the isolation
// law broken by a file-discovery rule.
//
// The usual workaround is to swap wrangler.toml aside and put it back
// afterwards. That is rejected: if anything fails in between — a network
// error, a Ctrl-C, a crash — the repo is left with the wrong wrangler.toml and
// the next `npm run deploy` sends production's bindings to staging. A window
// where the wrong thing is true is a window where the wrong thing ships.
//
// Instead: write the production config into its own scratch directory and run
// wrangler from THERE. wrangler.toml at the repo root is never touched, never
// moved, and is still the staging config the whole time, including while this
// is running and including if this fails.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'wrangler.prod.toml');
const STAGE = join(ROOT, '.wrangler', 'prod-deploy');
const DIST = join(ROOT, 'dist');

if (!existsSync(SRC)) { console.error('✗ wrangler.prod.toml is missing'); process.exit(1); }
if (!existsSync(join(DIST, 'index.html'))) { console.error('✗ dist/index.html is missing — run npm run build:prod first'); process.exit(1); }

// The build must be the production one. dist/ carries the proof: a production
// build has no `noindex` meta tag and robots.txt says Allow (see
// scripts/target-noindex.mjs, which refuses to lie about either).
// ⚠️ THE NOINDEX STRING, not the presence of a robots meta tag. rp-launch's
// copy of this script tests `html.includes('name="robots"')`, because on that
// site a production page carries no robots directive at all. This one always
// carries one — `follow, index, max-snippet:-1, …` on production — so that test
// would have refused every production deploy of this site. What must not be
// here is the NOINDEX directive, the X-Robots-Tag header, or a robots.txt that
// disallows everything.
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
const headers = existsSync(join(DIST, '_headers')) ? readFileSync(join(DIST, '_headers'), 'utf8') : '';
const carried = [
  html.includes('content="noindex, nofollow"') && 'the noindex meta tag',
  headers.includes('X-Robots-Tag: noindex') && 'X-Robots-Tag in _headers',
  robots.includes('Disallow: /') && 'Disallow: / in robots.txt',
  existsSync(join(DIST, 'robots.prod.txt')) && 'an unswapped robots.prod.txt',
].filter(Boolean);
if (carried.length) {
  console.error(`✗ dist/ is a STAGING build — it still carries ${carried.join(', ')}.`);
  console.error('  Refusing to deploy it to production. Run: npm run build:prod');
  process.exit(1);
}

const name = (readFileSync(SRC, 'utf8').match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
if (!name) { console.error('✗ no project name in wrangler.prod.toml'); process.exit(1); }

// `pages_build_output_dir` is resolved relative to the config file, so it is
// rewritten to point back up at the real dist/. Nothing is copied: the deploy
// reads the same directory the build wrote.
const config = readFileSync(SRC, 'utf8').replace(
  /^pages_build_output_dir\s*=.*$/m,
  'pages_build_output_dir = "../../dist"',
);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(join(STAGE, 'wrangler.toml'), config, 'utf8');

// ⚠️ functions/ IS FOUND FROM THE WORKING DIRECTORY TOO, and the first two
// attempts at this script each learned one half of that the hard way:
//
//   1. functions/ left behind  → the deploy SUCCEEDED, said "Uploading
//      _headers", never said "Uploading Functions bundle", and /api/lead on
//      production answered 405 from the static asset handler instead of 400
//      from the endpoint. The page would have taken a sign-up and written it
//      nowhere, and nothing in the deploy output said so.
//
//   2. functions/ copied alone → the build failed outright, which is the good
//      kind of failure: `functions/api/edit.ts` imports
//      '../../src/config/editable.js', the one place the API and the browser
//      share an allowlist, and that path has to resolve from the working
//      directory too.
//
// So both come across. Copied rather than symlinked: what wrangler globs and
// what esbuild resolves through a symlink is not a thing to find out on a
// launch, and the whole scratch directory is deleted the moment the deploy
// returns.
//
// ⚠️ AND scripts/, FOR THE THIRD TIME THE SAME LESSON (2026-11-11).
// functions/api/artifact.ts imports '../../scripts/_watermark.mjs' — the one
// definition of "has anything changed", shared by this endpoint, the build's
// freshness guard and the publisher Worker, precisely so that no two of them
// can compute the dirty signal slightly differently. esbuild resolves that path
// from the working directory like the other two, so without this the production
// deploy fails outright with "Could not resolve". That is the good kind of
// failure, and it is how this was found; the bad kind would have been shipping
// without the endpoint and watching CI report a 404 as "no content".
for (const dir of ['functions', 'src', 'scripts']) {
  const from = join(ROOT, dir);
  if (!existsSync(from)) { console.error(`✗ ${dir}/ is missing`); process.exit(1); }
  cpSync(from, join(STAGE, dir), { recursive: true });
}

console.log(`deploy-prod: ${name}, from a config in .wrangler/prod-deploy — the repo's wrangler.toml is untouched`);

// ⚠️ WHICH BRANCH A DIRECT-UPLOAD DEPLOY CLAIMS DECIDES WHETHER IT IS
// PRODUCTION. `wrangler pages deploy` works it out from git when nothing says
// otherwise, and on a laptop that is right: the branch is `main`, which is this
// project's production branch, so the upload lands on www.remodelerpilot.com.
//
// In GitHub Actions it is not safe to assume. `actions/checkout` on a
// `repository_dispatch` leaves a DETACHED HEAD, so the branch reads as `HEAD`
// and wrangler would publish a PREVIEW deployment — green, uploaded, and
// nowhere a visitor can see it. The client's edit would sit unpublished and the
// run would look like a success.
//
// So .github/workflows/deploy.yml sets RP_DEPLOY_BRANCH=main and says it out
// loud. Unset — every laptop deploy — nothing is passed and the behaviour is
// exactly what it has always been.
const branch = (process.env.RP_DEPLOY_BRANCH || '').trim();
if (branch) console.log(`deploy-prod: claiming branch ${branch} (RP_DEPLOY_BRANCH)`);

const r = spawnSync(
  'npx',
  ['wrangler', 'pages', 'deploy', DIST, '--project-name', name, ...(branch ? ['--branch', branch] : [])],
  { cwd: STAGE, stdio: 'inherit', env: process.env },
);

rmSync(STAGE, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);

// The deploy reports success before the endpoints are reachable, and "it said
// Success" is not the same claim as "the API is there". Ask it.
const origin = `https://${name}.pages.dev`;
process.stdout.write(`deploy-prod: checking the Functions actually shipped … `);
let ok = false;
for (let i = 0; i < 10 && !ok; i += 1) {
  await new Promise((res) => setTimeout(res, 3000));
  try {
    // ⚠️ A GET THAT MUST BE REFUSED BY THE ENDPOINT, not a POST that must be
    // rejected by it. The question is only "did the Functions bundle ship", and
    // /api/artifact answers it without writing anything and without a
    // credential: with no `authorization` header the ENDPOINT answers 401 (or
    // 503 if the site has no RP_BUILD_KEY), while the static asset handler
    // answers 404, which is what "no functions" looks like. rp-launch probes
    // /api/lead with a deliberately invalid sign-up, which works there and on
    // this site would post a fake enquiry at the owner's own contact endpoint
    // on every deploy.
    const probe = await fetch(`${origin}/api/artifact?what=watermark`, { headers: { accept: 'application/json' } });
    if (probe.status === 401 || probe.status === 503) ok = true;
    else process.stdout.write(`${probe.status} `);
  } catch { process.stdout.write('. '); }
}
if (!ok) {
  console.error(`\n✗ /api/artifact on ${origin} is not answering as an endpoint.`);
  console.error('  The Functions bundle did not ship, so the editor, the enquiry form and the');
  console.error('  content read CI builds from are all absent — and the pages would still render.');
  process.exit(1);
}
console.log('yes.');
