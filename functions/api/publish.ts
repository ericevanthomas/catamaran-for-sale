// Put the client's saved changes on their live website.
//
// ⚠️ THIS IS THE STEP THAT NEVER EXISTED. A client could edit all day, see every
// change in their own browser, and nothing reached the public until WE happened
// to deploy the site for some unrelated reason — and when we did, the deploy
// baked whatever they had in flight into the source and made it permanent
// (Eric, 2026-10-30). Publishing is now theirs, and it is the only thing that
// moves a change onto the live site.
//
// The `content` table is the DRAFT: what they have changed and not yet
// published. The entity tables are what is published, and the build reads only
// those, which is why a deploy can no longer carry unfinished work. Publishing
// applies each draft to the rows it belongs in, records the site as it was, and
// asks Cloudflare for a build.
import { readSession, type EditorEnv } from '../_editor-session';
import { resolve } from '../_resolve';
import { assemble, TABLES } from '../../scripts/_assemble.mjs';
import { SQL, fold, wmKey } from '../../scripts/_watermark.mjs';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

interface PublishEnv extends EditorEnv {
  DB: D1Database;
  // ⚠️ A DEPLOY HOOK CANNOT WORK ON THIS PROJECT. rp-test-site is a direct-upload
  // Pages project with no git source, and a deploy hook only rebuilds a project
  // Cloudflare itself builds. Asking GitHub Actions to build is the path that
  // exists, and it is the one electromagneticweb.com already uses.
  GITHUB_REPO?: string;          // owner/repo — committed, not secret
  GITHUB_EVENT_TYPE?: string;
  GITHUB_TOKEN?: string;         // secret
  RP_DEPLOY_HOOK?: string;       // for a project that IS git-connected
}

// Ask for a build. Returns false rather than throwing: the content is already
// published either way, and the five-minute publisher will notice and build.
async function askForABuild(env: PublishEnv): Promise<boolean> {
  if (env.RP_DEPLOY_HOOK) {
    try { return (await fetch(env.RP_DEPLOY_HOOK, { method: 'POST' })).ok; } catch { return false; }
  }
  if (env.GITHUB_REPO && env.GITHUB_TOKEN) {
    try {
      const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
          'user-agent': 'rp-publish/1',   // GitHub rejects a request without one
        },
        body: JSON.stringify({
          event_type: env.GITHUB_EVENT_TYPE || 'publish',
          client_payload: { asked_at: new Date().toISOString(), by: 'publish-button' },
        }),
        signal: AbortSignal.timeout(20000),
      });
      return r.status === 204;
    } catch { return false; }
  }
  return false;
}

export const onRequestPost: PagesFunction<PublishEnv> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in to publish' }, 401);

  const drafts = (await env.DB.prepare('SELECT field, value FROM content ORDER BY field').all<{ field: string; value: string }>()).results || [];
  if (!drafts.length) return json({ ok: true, published: 0, note: 'nothing to publish' });

  // ⚠️ ALL OR NOTHING, AND SAY WHICH. An address the resolver does not understand
  // would otherwise be dropped silently — the client presses Publish, it reports
  // success, and those words never appear. Refusing the whole publish and naming
  // the address is the only honest answer: it is a bug in the mapping, and it is
  // ours to fix, not theirs to discover on their live site.
  const plan: { field: string; writes: ReturnType<typeof resolve>; value: unknown }[] = [];
  const unresolved: string[] = [];
  for (const d of drafts) {
    let value: unknown;
    try { value = JSON.parse(d.value); } catch { value = d.value; }
    const writes = resolve(d.field, value, who);
    if (!writes) { unresolved.push(d.field); continue; }
    plan.push({ field: d.field, writes, value });
  }
  if (unresolved.length) {
    return json({ error: 'Some changes could not be published. Nothing was published.', fields: unresolved }, 422);
  }

  // The site exactly as it is now, before anything moves — one complete value, so
  // going back to it later is an assignment and not a walk backwards through
  // patches against a base that has itself moved.
  const tables: Record<string, unknown[]> = {};
  const fetched = await env.DB.batch(Object.entries(TABLES).map(([name, order]) =>
    env.DB.prepare(`SELECT * FROM ${name} ORDER BY ${order}`)));
  Object.keys(TABLES).forEach((name, i) => { tables[name] = (fetched[i] as any).results || []; });
  const before = assemble(tables);

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO revision (id, entity, row_id, value_json, state, created_at, created_by, published_at)
                    VALUES (?1, 'site', 'site', ?2, 'published', ?3, ?4, ?3)`)
      .bind(`pub-${Date.now()}`, JSON.stringify(before), now, who),
  ];
  for (const p of plan) {
    for (const w of p.writes!) stmts.push(env.DB.prepare(w.sql).bind(...(w.args as any[])));
    stmts.push(env.DB.prepare(`INSERT INTO content_log (id, ts, field, before, after, who, path, revert)
                               VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'publish', 0)`)
      .bind(`pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, now, p.field, JSON.stringify(p.value), who));
    stmts.push(env.DB.prepare('DELETE FROM content WHERE field = ?1').bind(p.field));
  }
  await env.DB.batch(stmts);

  // Ask Cloudflare to rebuild. A publish that cannot reach the hook has still
  // moved the content — saying so is better than pretending it failed, because
  // the five-minute publisher will notice and build anyway.
  const built = await askForABuild(env);
  return json({ ok: true, published: plan.length, building: built });
};

// What is waiting to be published, for the button to count.
// ── how a change actually reaches this tenant's live site ──────────────────
//
// ⚠️ 2026-11-11, AND THIS IS A CORRECTION. The editor said two things that were
// not true on this site: the menu row read "Everything is already live" whenever
// the draft table happened to be empty, and the composer promised a published
// post would be "going live on your site in about ten minutes". Both are true of
// a tenant whose publisher Worker is in live mode. Neither is true of one in
// shadow, which is what rp-fourlakes is: the Worker ticks, decides correctly and
// posts nothing, because the kit's CI cannot read D1 yet (PROVISIONING.md).
//
// So nothing in the editor hardcodes a claim any more. It asks here, and this
// answers from two pieces of ground truth:
//
//   · `publish_state.last_note` — the publisher writes it every tick, prefixed
//     "[shadow]" when it is only deciding. Together with `last_tick_at` that
//     says whether anything is going to carry this change by itself.
//   · /rp-build.json on this very origin — what the DEPLOYED build carries,
//     stamped by scripts/stamp-build.mjs. Compared against the watermark D1
//     holds right now, it answers "is what I changed on my site" exactly,
//     without asking the Worker and without believing a build's own report.
const SHADOW = /^\s*\[shadow\]/;

/** The watermark the live site is serving, read off its own stamp. */
async function liveStamp(request: Request): Promise<string | null> {
  try {
    const url = new URL('/rp-build.json', request.url);
    url.searchParams.set('t', String(Date.now()));          // past the edge cache
    const r = await fetch(url.toString(), {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { watermark?: unknown };
    return typeof d.watermark === 'string' && d.watermark ? d.watermark : null;
  } catch { return null; }
}

export const onRequestGet: PagesFunction<PublishEnv> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in' }, 401);
  const r = await env.DB.prepare('SELECT count(*) AS n FROM content').first<{ n: number }>();

  // Each of the three reads is allowed to fail on its own. A site without
  // migrations/0017_publish_state.sql, or whose stamp is missing, still gets a
  // pending count — and `delivery: 'unknown'` makes the editor say less rather
  // than say something it cannot stand behind.
  let delivery: 'auto' | 'shadow' | 'unknown' = 'unknown';
  let live: boolean | null = null;
  try {
    const st = await env.DB.prepare(
      'SELECT last_tick_at, last_note FROM publish_state WHERE id = 1',
    ).first<{ last_tick_at: string | null; last_note: string | null }>();
    // Twenty minutes: the cron is every five, so three missed ticks in a row is
    // a Worker that is not running rather than one that was briefly late.
    const ticked = st?.last_tick_at ? Date.now() - Date.parse(st.last_tick_at) < 20 * 60 * 1000 : false;
    if (ticked) delivery = SHADOW.test(st?.last_note || '') ? 'shadow' : 'auto';
  } catch { /* no publish_state: delivery stays unknown */ }

  try {
    const [stamp, wm] = await Promise.all([liveStamp(request), currentWatermark(env.DB)]);
    if (stamp && wm) live = stamp === wm;
  } catch { /* live stays null */ }

  return json({ pending: r?.n ?? 0, delivery, live });
};

/** The same key the publisher and the build compare. One definition, shared. */
async function currentWatermark(db: D1Database): Promise<string | null> {
  const one = async (sql: string) => {
    try {
      const row = await db.prepare(sql).first<{ n: number; t: string | null }>();
      return row ? { n: Number(row.n) || 0, t: row.t ?? null } : null;
    } catch (e) {
      if (/no such table/i.test(String(e))) return null;
      throw e;
    }
  };
  const [content, media, log, posts, posts_log] = await Promise.all([
    one(SQL.content), one(SQL.media), one(SQL.log), one(SQL.posts), one(SQL.posts_log),
  ]);
  if (!content && !media && !log && !posts && !posts_log) return null;
  return wmKey(fold({ content, media, log, posts, posts_log }));
}
