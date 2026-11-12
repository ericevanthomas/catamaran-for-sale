// rp-<slug>-publisher — a client's edit reaches their live site without anyone
// running a command.
//
// The editor saves; functions/api/edit.ts writes the row to D1 and the browser
// shows the change immediately, which is why this has been easy to forget. But
// the BUILT site only moves when something builds it, and until this existed
// that something was a person remembering. This Worker is that something.
//
// ONE PER CLIENT. Copy it with the kit and change nothing in this file: the
// client is named in publisher/wrangler.toml, in four lines that change
// together (`name`, `database_name`, `database_id`, `SITE_URL`).
//
// ── ⚠️ 2026-11-11: this file was the EMW one, and it could not run ─────────
// On 2026-10-30 the kit took electromagneticweb's publisher wholesale, because
// it was the evolved one. What came with it was EMW's DATABASE BINDING
// (`DB_EMW`, which does not exist here — publisher/wrangler.toml binds `DB`) and
// EMW's five-table watermark, which asks for `posts` and `posts_log` through
// SQL keys that scripts/_watermark.mjs in THIS repo does not define.
//
// So every tick threw on its first database call. rp-fourlakes-publisher has
// been deployed and on a five-minute cron since 2026-10-30 and `publish_state`
// in rp-fourlakes was still entirely NULL twelve days later: no tick, no note,
// nothing — about 3,400 failures that nobody saw, because a Worker whose
// scheduled handler throws is silent unless someone is tailing it.
//
// Two lessons, both already written down elsewhere and both re-learned here:
// a binding name is a tenant-shaped detail, and `MODE = "shadow"` proves a
// Worker DECIDES correctly, which is not the same as proving it RUNS.
//
// ── the trigger is repository_dispatch, fleetwide ──────────────────────────
// Not a Cloudflare Pages deploy hook. Every RP Pages project is DIRECT UPLOAD
// (the API reports `source: null` for rp-test-site, rp-launch-prod and
// electromagneticweb alike), and Cloudflare only issues deploy hooks for
// projects it builds itself, so there is no hook to create for any of them.
// GitHub Actions is the one mechanism that works everywhere, so it is the one
// mechanism all three use.
//
// ── and a triggered build has to READ THE DATABASE ────────────────────────
// This is the consequence most likely to be missed. src/config/*.json are
// COMMITTED, so a build that just ran `astro build` would faithfully rebuild
// last week's content and publish it under a green deployment — turning a
// visible staleness ("I haven't deployed yet") into an invisible one, which is
// worse than no pipeline at all.
//
// So .github/workflows/deploy.yml reads the content on every run and refuses to
// build what it cannot prove is current (scripts/check-fresh.mjs).
//
// ⚠️ HOW it reads was the open question in this repo until 2026-11-12. It used
// to shell out to wrangler (scripts/build-site-data.mjs), which needs a
// Cloudflare API token with D1 rights in the repository's secrets, and D1
// permissions on a token are scoped to an ACCOUNT, not to a database, so that
// one secret would read every client's `leads` table and break tenant isolation
// for the whole fleet. The kit now answers it the way rp-launch and
// electromagneticweb do: the SITE serves its own content over one keyed endpoint
// (functions/api/artifact.ts), bound to one database and holding no credential
// at all, and the workflow reads it with RP_BUILD_KEY. Proved on a runner with
// no Cloudflare credential of any kind.
//
// ⚠️ SO THE REASON MODE STAYS "shadow" HAS CHANGED, and it is now one thing:
// ericevanthomas/rp-site-kit has no CLOUDFLARE_API_TOKEN, so the workflow
// builds correctly and cannot UPLOAD. A live tick would fire a dispatch, the
// build would go green, the upload would fail, and the client would have been
// promised automatic delivery that never arrives. Flipping MODE to "live" is
// the only remaining step once that token exists, and the token must be
// Pages:Edit ONLY. See PROVISIONING.md, blocker 2.
//
// ── the credential: ONE GitHub App, not a PAT per client ───────────────────
// 2026-11-11. This Worker used to hold a fine-grained GitHub PAT per
// repository, which does not scale: one credential to mint by hand in a UI, and
// one expiry to remember, for every client. It now authenticates as a GitHub
// App instead — one app, one private key, the SAME key in every Worker — and
// mints its own hour-long installation token, scoped to its own repository,
// looking the installation up FROM that repository at run time. So adding a
// client needs no new credential: install the app on the repo and this works.
// publisher/src/github-app.ts carries the whole flow, the caching, and the
// PKCS#1-vs-PKCS#8 trap that comes with it.
//
// ── the loop ───────────────────────────────────────────────────────────────
//   every 5 min   compare the watermark in D1 against the one the live site
//                 publishes at /rp-build.json
//   dirty?        wait for QUIET_SECONDS of no edits (so a burst of saves is
//                 one rebuild), then fire repository_dispatch
//   the build     pulls content, refuses to proceed if it is stale
//                 (scripts/check-fresh.mjs), stamps /rp-build.json
//   next tick     the live site now says what D1 says, and there is nothing
//                 to do
//
// MODE=shadow decides and logs and posts nothing. It is the default.
import { SQL, fold, wmKey } from '../../scripts/_watermark.mjs';
import { appCredentialGap, appHealth, installationToken } from './github-app';

export interface Env {
  // DB, the same binding name functions/ uses, so no file in this repo needs a
  // second name for the same database. WHICH database it is comes from
  // publisher/wrangler.toml, and it is production's.
  DB: D1Database;
  MODE?: string;                 // shadow | live
  RP_SITE?: string;
  SITE_URL?: string;
  QUIET_SECONDS?: string;
  MAX_DEFER_SECONDS?: string;
  COOLDOWN_SECONDS?: string;
  GITHUB_REPO?: string;          // owner/repo — committed, not secret
  GITHUB_EVENT_TYPE?: string;    // the repository_dispatch event type
  RP_PUBLISHER_KEY?: string;     // secret — opens /watermark, /status, /tick
  // The GitHub App that fires repository_dispatch. The id is a plain var in
  // wrangler.toml because it is not sensitive; the key is a Worker secret, and
  // is the same key in every publisher Worker on the fleet.
  GH_APP_ID?: string;            // var — the app's numeric id
  GH_APP_PRIVATE_KEY?: string;   // secret — PKCS#8 PEM, see github-app.ts
}

// Three tables, not five. The kit has no composer and no `posts` table, and
// scripts/_watermark.mjs HERE defines the key over content, media and
// content_log only. That is what makes the watermark this Worker computes
// byte-identical to the one the build stamps into /rp-build.json, which is the
// only reason the comparison in `decide` means anything — and asking for the two
// tables EMW has is what made every tick throw for twelve days.
type Wm = {
  max_ts: string | null;
  content_n: number; media_n: number; log_n: number;
};
type State = {
  triggered_watermark: string | null; triggered_at: string | null;
  live_watermark: string | null; live_seen_at: string | null;
  last_tick_at: string | null; last_note: string | null;
};
type Live = { watermark: string; built_at: string | null; ref: string | null } | null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const secs = (iso: string | null | undefined, now: number) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((now - t) / 1000) : null;
};

// ── authentication ─────────────────────────────────────────────────────────
// One key, one purpose. Compared without an early return on the first differing
// byte, which costs nothing and means the comparison tells an attacker nothing
// about how much of the key they got right.
function authed(request: Request, env: Env): boolean {
  const want = env.RP_PUBLISHER_KEY || '';
  const got = request.headers.get('x-rp-publisher-key') || '';
  if (!want || want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

// ── reading the database ───────────────────────────────────────────────────
//
// One query per table, each tolerant of the table not existing. A client's
// database before the migrations are applied has none of them, and a client who
// has never opened the photo library has no `media` rows — which
// scripts/_content-source.mjs has always treated as "no photos yet" rather than
// an error, and a UNION over all three would fail whole instead of reporting the
// tables that are there.
async function one(db: D1Database, sql: string): Promise<{ n: number; t: string | null } | null> {
  try {
    const r = await db.prepare(sql).first<{ n: number; t: string | null }>();
    return r ? { n: Number(r.n) || 0, t: r.t ?? null } : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
}

async function watermark(db: D1Database): Promise<Wm> {
  // ⚠️ POSTS, since 2026-11-11, when the composer and /api/post arrived in this
  // kit. A blog post is a change to the site exactly as a headline edit is, and
  // a watermark that could not see one meant an afternoon of writing read as an
  // idle site. `one()` already tolerates the tables being absent, which is the
  // state of a client whose migrations/0023_posts.sql has not been applied.
  const [content, media, log, posts, posts_log] = await Promise.all([
    one(db, SQL.content), one(db, SQL.media), one(db, SQL.log),
    one(db, SQL.posts), one(db, SQL.posts_log),
  ]);
  return fold({ content, media, log, posts, posts_log }) as Wm;
}

async function readState(db: D1Database): Promise<State> {
  try {
    const r = await db.prepare(
      `SELECT triggered_watermark, triggered_at, live_watermark, live_seen_at, last_tick_at, last_note
       FROM publish_state WHERE id = 1`,
    ).first<State>();
    if (r) return r;
  } catch (e) {
    // The table is created by migrations/0017_publish_state.sql. Missing means
    // the migration has not been applied, which is worth saying out loud rather
    // than behaving as though the debounce were working.
    if (!/no such table/i.test(String(e))) throw e;
    throw new Error('publish_state is missing — apply migrations/0017_publish_state.sql');
  }
  await db.prepare('INSERT OR IGNORE INTO publish_state (id) VALUES (1)').run();
  return { triggered_watermark: null, triggered_at: null, live_watermark: null, live_seen_at: null, last_tick_at: null, last_note: null };
}

/**
 * What has been changed that production has not got.
 *
 * Derived from content_log, which is append-only and already carries every
 * save, so this needs no bookkeeping of its own: everything logged after the
 * live build's timestamp is by definition unpublished. It gives the dashboard
 * its "3 edits pending" and gives the debounce its ceiling — the age of the
 * OLDEST pending edit is what stops a long editing session deferring forever.
 *
 * TWO logs since 2026-11-11, which is the day the paragraph that used to be
 * here came true: the composer and /api/post shipped into this kit, so a post
 * written here is a change to the site exactly as a headline edit is. Counting
 * only content_log would have read an afternoon of writing as an idle site,
 * right up to the moment the ceiling never fired.
 */
async function pending(db: D1Database, since: string | null) {
  if (!since) return { n: null as number | null, oldest: null as string | null };
  const count = async (table: string) => {
    try {
      const r = await db.prepare(`SELECT COUNT(*) AS n, MIN(ts) AS t FROM ${table} WHERE ts > ?1`)
        .bind(since).first<{ n: number; t: string | null }>();
      return { n: Number(r?.n) || 0, t: r?.t ?? null };
    } catch (e) {
      if (/no such table/i.test(String(e))) return { n: 0, t: null };
      throw e;
    }
  };
  const [c, p] = await Promise.all([count('content_log'), count('posts_log')]);
  // ISO 8601 sorts lexicographically, so the earliest is a plain string min
  // over the two logs' own minimums.
  const stamps = [c.t, p.t].filter((t): t is string => typeof t === 'string' && !!t);
  return { n: c.n + p.n, oldest: stamps.length ? stamps.reduce((a, b) => (b < a ? b : a)) : null };
}

// ── reading the live site ──────────────────────────────────────────────────
//
// Ground truth. Not "a build told me it shipped this" — a build is not a
// deploy, and a laptop build, a branch preview, or a build whose upload failed
// would all have reported while production stood still.
async function readLive(env: Env): Promise<Live> {
  const base = (env.SITE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  try {
    const r = await fetch(`${base}/rp-build.json?t=${Date.now()}`, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'rp-publisher/1' },
      cf: { cacheTtl: 0, cacheEverything: false },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    // A stamp whose watermark is null is a real state, not a malformed one:
    // scripts/stamp-build.mjs writes it when the committed artifacts record no
    // watermark. Treating it as unreadable is correct — the site genuinely
    // cannot say what it is serving — and `decide` says so in words.
    return typeof d?.watermark === 'string' && d.watermark
      ? { watermark: d.watermark, built_at: d.built_at ?? null, ref: d.ref ?? null }
      : null;
  } catch {
    return null;
  }
}

// ── firing the build ───────────────────────────────────────────────────────
//
// POST /repos/{owner}/{repo}/dispatches, which GitHub answers 204 to. The
// workflow matches on `event_type`; client_payload is carried through to
// github.event.client_payload and is here so a run's log says which watermark
// asked for it.
async function dispatch(env: Env, key: string, token: string): Promise<{ ok: boolean; detail: string }> {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      // An installation token minted for THIS repository and good for an hour.
      // Used exactly as the PAT was: GitHub does not care which kind it is.
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      // GitHub rejects an API request with no User-Agent.
      'user-agent': 'rp-publisher/1',
    },
    body: JSON.stringify({
      event_type: env.GITHUB_EVENT_TYPE || 'publish',
      client_payload: { watermark: key, site: env.RP_SITE || null, asked_at: new Date().toISOString() },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 204) return { ok: true, detail: `repository_dispatch ${env.GITHUB_EVENT_TYPE || 'publish'} accepted` };
  const body = (await r.text()).slice(0, 200);
  return { ok: false, detail: `HTTP ${r.status} ${body}` };
}

// ── the decision ───────────────────────────────────────────────────────────

type Verdict = { act: boolean; note: string };

function decide(env: Env, wm: Wm, st: State, live: Live, pend: { n: number | null; oldest: string | null }, now: number): Verdict {
  const key = wmKey(wm);
  const QUIET = num(env.QUIET_SECONDS, 300);
  const DEFER = num(env.MAX_DEFER_SECONDS, 1800);
  const COOL = num(env.COOLDOWN_SECONDS, 1200);

  if (!env.SITE_URL) return { act: false, note: 'SITE_URL is not set — cannot tell what is published, so not triggering' };
  if (!live) {
    return {
      act: false,
      note: `${env.SITE_URL}/rp-build.json does not give a watermark — the live site cannot say what it is serving. ` +
            'Deploy once with this pipeline in place (npm run deploy) to establish it. ' +
            'Not triggering: a Worker that deploys a site it cannot measure is a Worker that publishes something nobody looked at.',
    };
  }
  if (live.watermark === key) return { act: false, note: `current — the live site carries ${key}` };

  // GITHUB_REPO is a committed var. Missing, nothing downstream can be decided,
  // in either mode.
  if (!env.GITHUB_REPO) {
    return { act: false, note: `dirty (live ${live.watermark} vs ${key}) but GITHUB_REPO is not set — nothing to post to` };
  }

  // ⚠️ A MISSING CREDENTIAL STOPS A LIVE TICK HERE AND A SHADOW TICK NOWHERE
  // (2026-11-11, and deliberately preserved through the move from a PAT to a
  // GitHub App later the same day). It used to stop both, which quietly broke
  // the one job shadow mode has: every tenant was installed BEFORE the
  // credential existed, so every shadow tick answered "nothing to post to" and
  // never reached the debounce — the part a person watches before flipping to
  // live. Shadow posts nothing whatever it concludes, so there is nothing here
  // for a missing credential to protect, and a mode that cannot report its
  // reasoning until the secret is in place is a mode nobody can use to decide
  // whether to set the secret.
  //
  // Only the two config halves are checked here. Whether the app is actually
  // INSTALLED on the repository cannot be known without asking GitHub, so that
  // one is reported by the dispatch attempt itself and by /status, in words.
  const gap = appCredentialGap(env);
  if (gap && env.MODE === 'live') {
    return { act: false, note: `dirty (live ${live.watermark} vs ${key}) but ${gap} — nothing to post to` };
  }

  // Trailing debounce. Every save moves max_ts forward, so the deadline moves
  // with it and a burst of twenty saves fires exactly once, QUIET seconds after
  // the last one. A brand-new database with no edits at all has no max_ts; if
  // the live site nonetheless disagrees, waiting for quiet would wait forever.
  const quietFor = wm.max_ts ? secs(wm.max_ts, now) ?? 0 : Number.MAX_SAFE_INTEGER;
  const pendingFor = secs(pend.oldest, now);

  if (quietFor < QUIET && !(pendingFor !== null && pendingFor >= DEFER)) {
    return { act: false, note: `editing in progress — last edit ${quietFor}s ago, waiting for ${QUIET}s of quiet` };
  }

  if (st.triggered_watermark === key) {
    const asked = secs(st.triggered_at, now);
    if (asked !== null && asked < COOL) {
      return { act: false, note: `a build of ${key} was already requested ${asked}s ago — waiting (cooldown ${COOL}s)` };
    }
    return {
      act: true,
      note: `re-requesting a build of ${key}: asked ${asked ?? '?'}s ago and the live site still carries ${live.watermark}`,
    };
  }

  const why = quietFor >= QUIET
    ? `${quietFor}s since the last edit`
    : `the oldest unpublished edit is ${pendingFor}s old (ceiling ${DEFER}s), so building mid-session`;
  return { act: true, note: `requesting a build of ${key} — ${why}${pend.n ? `, ${pend.n} edit${pend.n === 1 ? '' : 's'} pending` : ''}` };
}

/**
 * A scheduled post whose day has come, published.
 *
 * ⚠️ IT RUNS IN SHADOW MODE TOO, and that is deliberate. MODE is about whether
 * this Worker may ASK FOR A DEPLOY; the flip is not a deploy, it is the
 * client's own record reaching the state they asked for. Holding it back in
 * shadow would mean a schedule that silently did nothing on a site whose
 * publisher is not live yet — and the flip moving `touched_at` is exactly what
 * makes the next build carry it, whenever that build happens.
 *
 * ⚠️ THE HOUR COMES FROM `extra.publish_at`, NOT FROM `published_at`. The
 * latter is the DISPLAY date, stored at noon UTC so the printed date is the
 * day the client picked whatever timezone reads it (src/lib/posts.js); writing
 * a real instant there would move the date on the page. The composer writes
 * the instant into `extra` instead (functions/api/post.ts), and this is the
 * only thing that reads it.
 *
 * The fallback is for a row scheduled before the hour existed: noon UTC on its
 * published_at, which is the promise that was made at the time.
 *
 * `deleted_at IS NULL` because a scheduled post that was thrown away is still a
 * row with a future date on it. Without this it was flipped to published on its
 * day: invisible on the site, which excludes trashed rows at build time, but the
 * record was quietly rewritten, so restoring it later brought it back as
 * Published instead of Scheduled. Found 2026-11-12 while fixing the drawer that
 * listed binned posts twice.
 *
 * The cron is every five minutes, so that is the real resolution of any
 * schedule here. Do not draw a minute picker on top of it.
 */
async function due(db: D1Database, nowIso: string): Promise<number> {
  try {
    const r = await db.prepare(
      `UPDATE posts SET status = 'published', touched_at = ?1, touched_by = 'schedule'
         WHERE status = 'scheduled'
           AND deleted_at IS NULL
           AND COALESCE(json_extract(extra, '$.publish_at'), published_at) IS NOT NULL
           AND COALESCE(json_extract(extra, '$.publish_at'), published_at) <= ?1`,
    ).bind(nowIso).run();
    return r.meta?.changes ?? 0;
  } catch (e) {
    // A site whose database predates the posts table is not an error here.
    if (!/no such table/i.test(String(e))) console.error('due failed: ' + String(e).slice(0, 200));
    return 0;
  }
}

async function tick(env: Env): Promise<Record<string, unknown>> {
  const isLive = env.MODE === 'live';
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Before the watermark is read, so a post that went live on this tick is
  // part of what the watermark says and the deploy decision below sees it.
  const flipped = await due(env.DB, nowIso);

  const wm = await watermark(env.DB);
  const key = wmKey(wm);
  const st = await readState(env.DB);
  const live = await readLive(env);
  const pend = await pending(env.DB, live?.built_at ?? null);

  const v = decide(env, wm, st, live, pend, now);
  let posted: string | null = null;
  let note = v.note;

  if (v.act && isLive) {
    try {
      // Authenticate first, and report a credential problem as itself rather
      // than as a dispatch failure. "the app is not installed on this repo" is
      // a click to fix and "GitHub refused the dispatch" is not, so the note
      // has to be able to tell them apart. Cached between ticks: a five-minute
      // cron does not mint a token every tick (see github-app.ts).
      const auth = await installationToken(env);
      if (!auth.ok) {
        note = `cannot authenticate as the GitHub App [${auth.kind}]: ${auth.detail}`;
      } else {
        const r = await dispatch(env, key, auth.token);
        if (!r.ok) {
          note = `repository_dispatch refused: ${r.detail}`;
        } else {
          posted = r.detail;
          await env.DB.prepare('UPDATE publish_state SET triggered_watermark = ?1, triggered_at = ?2 WHERE id = 1')
            .bind(key, nowIso).run();
        }
      }
    } catch (e) {
      note = `repository_dispatch failed: ${String(e).slice(0, 160)}`;
    }
  } else if (v.act) {
    // Say both things: what it would have done, and whether it COULD have. A
    // shadow note that reads like a ready system is the kind of line somebody
    // flips to live on, so this checks the credential for real — all the way to
    // a minted token, which posts nothing and is cached exactly as a live
    // tick's is.
    //
    // ⚠️ It has to go to GitHub to be honest. With a PAT, "is the credential
    // there" was a var test. With an app it is two questions, and the second —
    // is the app INSTALLED on this repository — is a fact about GitHub rather
    // than about this config, so no amount of reading wrangler.toml answers it.
    // A shadow Worker that cannot say "the app is not installed yet" is back to
    // the problem this mode was fixed for this morning.
    const gap = appCredentialGap(env);
    let can = gap ? ` (but ${gap}, so live would refuse)` : '';
    if (!gap) {
      try {
        const auth = await installationToken(env);
        if (!auth.ok) can = ` (but live would refuse: [${auth.kind}] ${auth.detail})`;
      } catch (e) {
        can = ` (but the GitHub App credential could not be checked: ${String(e).slice(0, 120)})`;
      }
    }
    note = `[shadow] would have fired repository_dispatch — ${v.note}${can}`;
  }

  // ⚠️ THE MODE IS IN EVERY NOTE, not only in the ones where shadow changed
  // the outcome. It used to be: a shadow tick that WOULD have acted said
  // "[shadow] would have fired…", and a shadow tick with nothing to do said
  // plain "current — the live site carries …". That is honest about the tick
  // and silent about the Worker, and on 2026-11-11 something started reading
  // this column — functions/api/publish.ts, to tell the client whether a saved
  // change reaches their site by itself. It saw an unprefixed note from a
  // shadow Worker and reported automatic delivery, which is the exact kind of
  // claim that whole change was made to stop. One line, and the state says what
  // the Worker IS rather than only what it just did.
  const stamped = isLive || /^\s*\[shadow\]/.test(note) ? note : `[shadow] ${note}`;

  await env.DB.prepare(
    `UPDATE publish_state SET live_watermark = ?1, live_seen_at = ?2, last_tick_at = ?3, last_note = ?4 WHERE id = 1`,
  ).bind(live?.watermark ?? null, live ? nowIso : st.live_seen_at, nowIso, stamped).run();

  console.log(`${nowIso} ${isLive ? '' : '[shadow] '}${env.RP_SITE || '?'} ${note}`
    + (flipped ? ` (+${flipped} scheduled post${flipped === 1 ? '' : 's'} published)` : ''));
  return { ok: true, mode: isLive ? 'live' : 'shadow', watermark: key, live: live?.watermark ?? null, acted: v.act, posted, note, flipped };
}

// ── the surfaces ───────────────────────────────────────────────────────────

export default {
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    try { await tick(env); } catch (e) { console.error('tick failed: ' + String(e).slice(0, 300)); throw e; }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!authed(request, env)) {
      // No hint about which half was wrong, matching functions/api/edit-session.
      return new Response('Not found', { status: 404 });
    }

    try {
      // What the live site is compared against, and what a person checks by
      // hand. There is deliberately no /artifact here any more, and it is not
      // coming back: the SITE serves its own content now
      // (functions/api/artifact.ts), bound to one database and keyed with
      // RP_BUILD_KEY, so nothing needs this Worker to serve content. The dead
      // `worker` lane in scripts/_content-source.mjs that used to call this
      // removed route was deleted on 2026-11-12 rather than left as a third
      // mechanism for somebody to find at 2am.
      if (url.pathname === '/watermark' && request.method === 'GET') {
        const wm = await watermark(env.DB);
        return json({ site: env.RP_SITE || null, watermark: wmKey(wm), wm, last_edit_at: wm.max_ts });
      }

      // Everything a dashboard needs for "last built 10 minutes ago, 3 edits
      // pending". No UI here — this repo does not own the dashboard.
      if (url.pathname === '/status' && request.method === 'GET') {
        const now = Date.now();
        const wm = await watermark(env.DB);
        const key = wmKey(wm);
        const st = await readState(env.DB);
        const live = await readLive(env);
        const pend = await pending(env.DB, live?.built_at ?? null);
        const v = decide(env, wm, st, live, pend, now);
        return json({
          site: env.RP_SITE || null,
          mode: env.MODE === 'live' ? 'live' : 'shadow',
          dirty: !!live && live.watermark !== key,
          watermark: key,
          last_edit_at: wm.max_ts,
          last_edit_seconds_ago: secs(wm.max_ts, now),
          live_watermark: live?.watermark ?? null,
          built_at: live?.built_at ?? null,
          built_seconds_ago: secs(live?.built_at ?? null, now),
          built_ref: live?.ref ?? null,
          pending_edits: pend.n,
          oldest_pending_at: pend.oldest,
          triggered_watermark: st.triggered_watermark,
          triggered_at: st.triggered_at,
          triggered_seconds_ago: secs(st.triggered_at, now),
          last_tick_at: st.last_tick_at,
          last_tick_seconds_ago: secs(st.last_tick_at, now),
          last_note: st.last_note,
          would_act_now: v.act,
          verdict: v.note,
          dispatch_configured: !!(env.GITHUB_REPO && !appCredentialGap(env)),
          // The whole auth chain, proved without posting anything: the PEM
          // import, the installation lookup and the token exchange, with the
          // failure named if any of them refuses. Safe in either mode, and the
          // only way to tell a ready Worker from one that merely looks ready
          // before MODE is flipped. No token or key material is returned.
          github_app: await appHealth(env),
        });
      }

      // Run the tick by hand, for proving it works without waiting for the
      // cron. Honours MODE exactly as the cron does, so this cannot publish
      // anything the schedule would not have published.
      if (url.pathname === '/tick' && request.method === 'POST') return json(await tick(env));

      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.error(String(e).slice(0, 300));
      return json({ error: String(e).slice(0, 300) }, 500);
    }
  },
};
