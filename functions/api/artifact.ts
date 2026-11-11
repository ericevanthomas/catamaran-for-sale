// The build's read path into this site's own content.
//
// ── why this exists (2026-11-11) ───────────────────────────────────────────
// Until today this site could only be published from Eric's laptop:
// `npm run deploy:prod` pulls the content through `wrangler d1 execute` and
// uploads the result. The editor told the client "everything is already live"
// and that sentence was false, because nothing but a person at a terminal ever
// moved the built site.
//
// The thing that makes it true is a GitHub Actions workflow a Worker can ask
// for (.github/workflows/deploy.yml). That workflow has to read this site's
// content, and the obvious way — a Cloudflare API token with D1 rights in the
// repository's secrets — is REJECTED: a D1 token is scoped to an ACCOUNT, not
// to a database, so one secret in one repository would read every client's
// `leads` table on the platform. That is the tenant isolation law broken by a
// build variable, and it would break it for every client at once.
//
// This site does not have that problem. It is already bound to its own
// database and to nothing else (wrangler.prod.toml, binding DB), so it can
// answer questions about itself without anybody holding an account-wide
// credential. CI asks the site; the site reads its own binding.
//
//   GET /api/artifact?what=watermark   -> { watermark, last_edit_at }
//   GET /api/artifact?what=all         -> { watermark, fields, media, tables, last_edit_at }
//
// ⚠️ `tables` IS THE PART THAT MAKES THIS SITE BUILDABLE IN CI AT ALL, and it is
// new here (2026-11-11). On the Fourlakes demo the page content is rows in
// `setting`, `block`, `block_pick` and `faq`, and the only reader was
// scripts/build-site-data.mjs shelling out to `wrangler d1 execute` — which a CI
// runner has no credentials for. PROVISIONING.md names that as the one reason
// rp-fourlakes-publisher has to stay in shadow mode: "until the kit grows its
// own functions/api/artifact.ts and a worker/http lane in
// scripts/_content-source.mjs, the kit's workflow must not be given a
// CLOUDFLARE_API_TOKEN with D1 rights". This is that endpoint, with that lane,
// and it is why this tenant's publisher can be live.
//
// It returns ROWS, not an assembled site. Assembling is scripts/_assemble.mjs's
// job and there is exactly one copy of it; an endpoint that assembled would be
// a second implementation of the page's content, and the first rule about
// having one of those is not to have two.
//
//   Authorization: Bearer <RP_BUILD_KEY>
//
// ⚠️ Its OWN key, deliberately not RP_SERVICE_KEY. That one mints editor
// sessions (functions/api/edit-session.ts); this lane only ever reads content
// that is already on the page. A build server has no business holding a key
// that can impersonate an editor, and rotating one should not disturb the
// other. Same split electromagneticweb.com made on 2026-10-27.
//
// ⚠️ The watermark comes from scripts/_watermark.mjs, the same module the
// build's guard and the publisher Worker use. A dirty signal computed two
// slightly different ways is worse than none, because the guard would then
// refuse every build or wave every build through, and both look like the
// pipeline working.
import { SQL, fold, wmKey } from '../../scripts/_watermark.mjs';
// The four tables this site's page content actually lives in. Imported rather
// than listed again, from the same module scripts/_assemble.mjs reads them with,
// so this endpoint cannot start serving a different set than the build expects.
import { TABLES as CONTENT_TABLES } from '../../scripts/_assemble.mjs';

interface Env {
  DB: D1Database;
  RP_BUILD_KEY?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Constant-time compare, so a wrong key cannot be found a character at a time.
// Same shape as functions/_editor-session.ts uses for the service key.
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const key = env.RP_BUILD_KEY;
  // ⚠️ No key configured is a REFUSAL, never an open door. A deploy that drops
  // the secret must stop the build, not serve this site's content to anyone who
  // asks. 503 rather than 401 so the failure says WHICH side is unconfigured.
  if (!key) return json({ error: 'not configured' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!given || !sameKey(given, key)) return json({ error: 'unauthorized' }, 401);

  const db = env.DB;

  try {
    // Which tables exist. A site before migrations/0001 legitimately has none
    // of them, and `rp-rp` has no `media` table at all today — the photo
    // library was never used on this site. Asking anyway would fail the whole
    // query and report "no content" for a site with fifteen edits.
    const tables = new Set(
      ((await db.prepare(SQL.tables).all<{ name: string }>()).results || []).map((r) => r.name),
    );
    const one = async (table: string, sql: string) => {
      if (!tables.has(table)) return null;
      const r = await db.prepare(sql).first<{ n: number; t: string | null }>();
      return r ? { n: Number(r.n) || 0, t: r.t ?? null } : null;
    };

    // ⚠️ The watermark is read BEFORE the rows and returned WITH them, so a
    // caller can never pair a stamp with content written after it. An edit that
    // lands mid-request shows up as a watermark the build does not carry, which
    // fails the freshness guard — the safe way round.
    // ⚠️ ALL FIVE TABLES, including `posts`. scripts/_watermark.mjs on this site
    // is the kit's five-table version — its `wmKey` always prints `|p…|pl…` —
    // and functions/api/publish.ts already folds all five when it answers the
    // editor's "is what I changed on my site". Folding three here and five
    // there means the two agree only while `posts` is empty, which it is today
    // and would stop being the day somebody writes one: the editor would then
    // say "not live yet" for ever, about a build that was perfectly current.
    // Cheap to get right now, and invisible to find later.
    const wm = fold({
      content: await one('content', SQL.content),
      media: await one('media', SQL.media),
      log: await one('content_log', SQL.log),
      posts: await one('posts', SQL.posts),
      posts_log: await one('posts_log', SQL.posts_log),
    });
    const watermark = wmKey(wm);

    const what = new URL(request.url).searchParams.get('what') || 'watermark';
    if (what === 'watermark') return json({ watermark, last_edit_at: wm.max_ts });
    if (what !== 'all') return json({ error: "what must be 'watermark' or 'all'" }, 400);

    const rows = async <T>(table: string, sql: string): Promise<T[]> =>
      tables.has(table) ? (((await db.prepare(sql).all<T>()).results || []) as T[]) : [];

    const fields: Record<string, unknown> = {};
    for (const r of await rows<{ field: string; value: string }>('content', 'SELECT field, value FROM content')) {
      try { fields[r.field] = JSON.parse(r.value); } catch { fields[r.field] = r.value; }
    }

    // The same SHAPE scripts/_content-source.mjs builds from the wrangler lane:
    // keyed by `src`, because that is what the editor's photo picker looks a
    // photo up by. Two lanes, one output, so nothing downstream knows or cares
    // which one ran — and `srcset` rides along because the picker needs a
    // thumbnail rather than the 1600px copy of every photo at once.
    const media: Record<string, { alt: string; title: string; srcset: string }> = {};
    for (const r of await rows<{ src: string; alt: string | null; title: string | null; srcset: string | null }>(
      'media', 'SELECT src, alt, title, srcset FROM media',
    )) {
      media[r.src] = { alt: r.alt || '', title: r.title || '', srcset: r.srcset || '' };
    }

    // ⚠️ Read AFTER the watermark and returned WITH it, for the reason above:
    // an edit landing mid-request shows up as a watermark the build does not
    // carry, which fails the freshness guard — the safe way round.
    const content: Record<string, unknown[]> = {};
    for (const [name, order] of Object.entries(CONTENT_TABLES as Record<string, string>)) {
      content[name] = tables.has(name)
        ? ((await db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all()).results || [])
        : [];
    }

    return json({ watermark, last_edit_at: wm.max_ts, fields, media, tables: content });
  } catch (e) {
    // An unreachable database is a FAILURE, never an empty site: the guard on
    // the other end treats "cannot check" and "stale" as the same answer, and
    // this must not be the thing that turns one into a cheerful 200 with no
    // content in it.
    console.error('artifact ' + String(e).slice(0, 200));
    return json({ error: 'unavailable' }, 503);
  }
};
