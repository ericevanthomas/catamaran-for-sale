// Where the build gets this client's content, and how it proves it is current.
//
// There are exactly two transports, and which one is in use is printed by every
// script that uses them. Both return the same shape, so nothing downstream has
// to know which ran.
//
//   wrangler  — `wrangler d1 execute`, talking to this site's own D1. Needs a
//               logged-in CLI, so this is the laptop path and the only one that
//               can reach `--local`.
//
//   http      — an HTTPS GET to this site's OWN /api/artifact, which reads the
//               same D1 through the binding it is already bound to. This is the
//               CI path (.github/workflows/deploy.yml).
//
// ── why CI cannot use wrangler, and what that forced ──────────────────────
// A CI runner has no wrangler credentials. The answer until 2026-11-11 was to
// pull on a laptop and COMMIT src/config/overrides.json, so anything but a
// laptop builds from the committed file — which works, and silently publishes
// whatever was true at the last pull. An automatic trigger on its own does not
// fix that; it makes it worse, because now the stale artifact ships on a
// schedule, and "I haven't deployed yet" stops being visible to anyone.
//
// The obvious fix is to put a Cloudflare API token in the build environment so
// the pull works there. It was rejected: a D1 token is scoped to an ACCOUNT,
// not to a database, so the token in this repository's secrets would also read
// Hazley's `leads` table — names, emails and phone numbers — and every build of
// every branch would have it. That is the tenant isolation law broken by a
// build variable, for every client at once.
//
// So the credential that reaches CI is RP_BUILD_KEY instead, which opens one
// endpoint on this one site and returns this site's own publishable copy
// (functions/api/artifact.ts). Worst case it leaks the headline we are about to
// publish ourselves. Nothing else, and nothing belonging to anybody else. Same
// split electromagneticweb.com made on 2026-10-27, and the same reasoning.
//
// ⚠️ ON THIS LANE THE URL IS THE TENANT. The wrangler lane reads
// `database_name` out of wrangler.toml or wrangler.prod.toml, so RP_TARGET
// decides which database it talks to; over HTTP the HOST decides, and nothing
// here can check that RP_ARTIFACT_URL and RP_TARGET agree. A prod build pointed
// at the staging host would render staging's edits on the live site. They are
// set together, in one place, in the workflow.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SQL, fold, wmKey } from './_watermark.mjs';
// The content tables themselves. On this site the page content IS rows in these
// four (scripts/_content-map.mjs), so the build reads them here rather than
// shelling out to a second tool -- and it reads them in the SAME pass as the
// watermark, so the two cannot disagree.
import { TABLES as CONTENT_TABLES } from './_assemble.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export { wmKey };

/**
 * Which Cloudflare config this build belongs to.
 *
 * ⚠️ This repo builds TWO projects, and each has its OWN database. A pull
 * that read wrangler.toml unconditionally would put STAGING's saved edits into
 * a PRODUCTION build — one tenant's content rendered on another's site, which
 * is the isolation law broken by a default argument rather than by a token.
 * The target comes from the same single flag the rest of the build reads.
 */
export function configFile() {
  return process.env.RP_TARGET === 'prod' ? 'wrangler.prod.toml' : 'wrangler.toml';
}

export function dbName() {
  const file = configFile();
  const m = readFileSync(join(ROOT, file), 'utf8').match(/database_name\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`no database_name in ${file}`);
  return m[1];
}

/**
 * Which transport, from argv and the environment.
 *
 * `--local` / `--remote` / `--http` win. Then RP_CONTENT_SOURCE. Then: if
 * RP_ARTIFACT_URL and RP_BUILD_KEY are both set we are in CI, where the site's
 * own endpoint is the only thing that can answer, so use it. Otherwise
 * `remote`, which is what this repo has always defaulted to — a tool whose
 * default is the scratch copy is a tool that quietly does nothing.
 */
export function source(argv = process.argv) {
  const flag = argv.find((a) => a === '--local' || a === '--remote' || a === '--http');
  if (flag) return flag.slice(2);
  const env = process.env.RP_CONTENT_SOURCE;
  if (env === 'local' || env === 'remote' || env === 'http') return env;
  return process.env.RP_ARTIFACT_URL && process.env.RP_BUILD_KEY ? 'http' : 'remote';
}

// ── the HTTP transport ─────────────────────────────────────────────────────
//
// One GET per question, against this site's own functions/api/artifact.ts.
// There is no POST lane and nothing here writes: a build has no business
// changing a client's content, and an endpoint that cannot be asked to is one
// fewer thing a leaked build key could do.

const base = () => (process.env.RP_ARTIFACT_URL || '').replace(/\/+$/, '');

async function ask(what) {
  if (!base()) throw new Error('RP_ARTIFACT_URL is not set (the site origin to read from)');
  if (!process.env.RP_BUILD_KEY) throw new Error('RP_BUILD_KEY is not set');
  const url = `${base()}/api/artifact?what=${what}`;
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.RP_BUILD_KEY}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.text();
  // ⚠️ Never echo the key, and never let a refusal read as "no content". The
  // status is named because the two failures have different fixes and both look
  // identical from the build log otherwise.
  if (r.status === 401) throw new Error(`${url} → 401: the build key was rejected (check RP_BUILD_KEY on both sides)`);
  if (r.status === 503) throw new Error(`${url} → 503: the site has no RP_BUILD_KEY set (wrangler pages secret put RP_BUILD_KEY)`);
  if (!r.ok) throw new Error(`/api/artifact → HTTP ${r.status} ${body.slice(0, 120)}`);
  try { return JSON.parse(body); } catch { throw new Error(`/api/artifact → not JSON: ${body.slice(0, 120)}`); }
}

// ── the wrangler transport ─────────────────────────────────────────────────

// WRANGLER=/path/to/wrangler runs a copy that is already installed, which is
// how this is tested without adding a dependency to the site.
function run(sql, mode) {
  const bin = process.env.WRANGLER;
  const cmd = bin || 'npx';
  const args = (bin ? [] : ['wrangler']).concat([
    'd1', 'execute', dbName(), mode === 'local' ? '--local' : '--remote', '--json', '--command', sql,
  ]);
  const raw = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  // Wrangler prints a banner before the JSON on some versions, so take the
  // document rather than the stream. A multi-statement --command comes back as
  // one entry per statement, in order.
  const parsed = JSON.parse(raw.slice(raw.search(/[[{]/)));
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => p?.results || []);
}

// `wrangler d1 execute --json` renders SQL NULL as the four-character string
// "null", which is indistinguishable from the text "null". Only the columns
// that CAN be NULL here are converted, and every one of them is a timestamp.
const ts = (v) => (v == null || v === 'null' ? null : v);
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * Everything the build needs, in two wrangler calls.
 *
 * The first asks which tables exist; the second asks only about those, as one
 * multi-statement command. Two calls rather than five, and a day-one site with
 * no `content` table still gets an answer instead of an exception.
 */
function readViaWrangler(mode, withTables = false) {
  const have = new Set(run(SQL.tables, mode)[0].map((r) => r.name));
  const plan = [];
  if (have.has('content')) plan.push(['content', SQL.content], ['fields', 'SELECT field, value FROM content']);
  if (have.has('media')) plan.push(['media', SQL.media], ['mediaRows', 'SELECT src, alt, title, srcset FROM media']);
  if (have.has('content_log')) plan.push(['log', SQL.log]);
  // ⚠️ THE CONTENT TABLES, in the same multi-statement command as the
  // watermark. On this site the page content IS these rows — `setting`, `block`,
  // `block_pick`, `faq` — so a build that read the watermark in one call and the
  // rows in another could be stamped with a watermark it does not carry. Same
  // reason artifact() is one pass: one read, or the proof is worthless.
  if (withTables) {
    for (const [name, order] of Object.entries(CONTENT_TABLES)) {
      if (have.has(name)) plan.push([`t:${name}`, `SELECT * FROM ${name} ORDER BY ${order}`]);
    }
  }
  if (!plan.length) return { wm: fold({}), fields: [], mediaRows: [], tables: {} };

  const out = run(plan.map(([, s]) => s).join('; '), mode);
  const got = {};
  plan.forEach(([k], i) => { got[k] = out[i] || []; });

  const one = (k) => (got[k]?.[0] ? { n: num(got[k][0].n), t: ts(got[k][0].t) } : null);
  const tables = {};
  for (const name of Object.keys(CONTENT_TABLES)) tables[name] = got[`t:${name}`] || [];
  return {
    wm: fold({ content: one('content'), media: one('media'), log: one('log') }),
    fields: got.fields || [],
    mediaRows: got.mediaRows || [],
    tables,
  };
}

// ── what the callers use ───────────────────────────────────────────────────

/** The watermark alone — cheap, and the only thing the stale guard needs. */
export async function watermark(src) {
  if (src === 'http') {
    const r = await ask('watermark');
    if (!r || typeof r.watermark !== 'string' || !r.watermark) throw new Error('/api/artifact gave no watermark');
    // ⚠️ The same SHAPE the wrangler lane returns — `{ key, wm, last_edit_at }`,
    // not a bare string. A lane that returns the string makes `now.key`
    // undefined one caller away, and the guard then prints "database holds
    // undefined": a real refusal with a meaningless reason, which is worse than
    // either a pass or a clear failure.
    return { key: r.watermark, wm: null, last_edit_at: r.last_edit_at ?? null };
  }
  const { wm } = readViaWrangler(src);
  return { key: wmKey(wm), wm, last_edit_at: wm.max_ts };
}

/**
 * The content itself, plus the watermark it goes with.
 *
 * Read in ONE pass per transport so the watermark and the rows cannot disagree:
 * fetching the rows and then separately asking "and what is current?" leaves a
 * window in which an edit lands between the two, and the artifact would be
 * stamped with a watermark it does not actually contain — a stale build that
 * proves itself fresh, which is the exact failure this pipeline exists to stop.
 */
export async function artifact(src) {
  if (src === 'http') {
    const r = await ask('all');
    if (!r || typeof r.watermark !== 'string' || !r.fields || !r.media || !r.tables) {
      throw new Error('/api/artifact gave an incomplete answer');
    }
    return { key: r.watermark, fields: r.fields, media: r.media, tables: r.tables };
  }
  const { wm, fields, mediaRows, tables } = readViaWrangler(src, true);
  const out = {};
  for (const r of fields) {
    try { out[r.field] = JSON.parse(r.value); } catch { out[r.field] = r.value; }
  }
  const media = {};
  // srcset rides along because the picker needs a THUMBNAIL. The library shows
  // every photo at once, and serving the 1600px copy of each to fill a small
  // square is what makes an editor feel slow on a phone.
  for (const r of mediaRows) media[r.src] = { alt: ts(r.alt) || '', title: ts(r.title) || '', srcset: ts(r.srcset) || '' };
  // ⚠️ NOTE ON NULLS, because the comment on `ts()` above is out of date and
  // acting on it here would have introduced a bug. It says `wrangler d1 execute
  // --json` renders SQL NULL as the four-character string "null"; on wrangler
  // 4.160 it does not — it renders a real JSON null (checked 2026-11-11,
  // `SELECT NULL AS a, 'null' AS b`). The rows going into assemble() are full of
  // nullable columns, so a "null"-to-null conversion applied to them would also
  // have turned any genuine string "null" into an absent value. Both lanes
  // therefore hand assemble() real nulls and nothing is rewritten here.
  return { key: wmKey(wm), fields: out, media, tables };
}
