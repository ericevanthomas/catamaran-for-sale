// How one page is doing, asked from the page itself.
//
// The numbers already exist — this site's visits and leads are in its own D1,
// the same tables the dashboard reads. What has never existed is the answer
// standing where the question gets asked: looking at a page and wondering
// whether it is pulling its weight.
//
// Deliberately few numbers. Visits, people, conversions, how long they stay,
// and where this page ranks among the others. Anything more is the dashboard's
// job, and there is a link to it.
import { readSession, type EditorEnv } from '../_editor-session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const DAYS = 30;

export const onRequestGet: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in first' }, 401);

  const url = new URL(request.url);
  const path = (url.searchParams.get('path') || '/').slice(0, 300);
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const site = env.RP_SITE || 'fourlakes';
  const dash = `https://app.remodelerpilot.com/${site}/traffic`;

  try {
    // One batch. A page's own numbers, then its rank among the rest, so
    // "is this page doing well" has something to be well COMPARED TO.
    const [mine, ranked, source, conv] = await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS people,
                AVG(NULLIF(duration_ms, 0)) / 1000.0 AS avg_s
           FROM visits WHERE path = ?1 AND ts >= ?2`,
      ).bind(path, since),
      env.DB.prepare(
        `SELECT path, COUNT(*) AS n FROM visits WHERE ts >= ?1 GROUP BY path ORDER BY n DESC`,
      ).bind(since),
      env.DB.prepare(
        `SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(referrer, ''), 'a direct visit') AS s, COUNT(*) AS n
           FROM visits WHERE path = ?1 AND ts >= ?2 AND entry = 1
          GROUP BY s ORDER BY n DESC LIMIT 1`,
      ).bind(path, since),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM leads WHERE source_path = ?1 AND created_at >= ?2`,
      ).bind(path, since),
    ]);

    const m = (mine.results || [])[0] as { visits: number; people: number; avg_s: number | null } | undefined;
    const rows = (ranked.results || []) as Array<{ path: string; n: number }>;
    const at = rows.findIndex((r) => r.path === path);
    const src = (source.results || [])[0] as { s: string } | undefined;
    const c = (conv.results || [])[0] as { n: number } | undefined;

    // A referrer is a hostname to us and a place to them.
    const pretty = (s?: string) => {
      if (!s) return null;
      if (s === 'a direct visit') return 'typing your address in';
      try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s.replace(/^www\./, ''); }
    };

    return json({
      tracking: true,
      path,
      visits: m?.visits || 0,
      people: m?.people || 0,
      conversions: c?.n || 0,
      avg_seconds: m?.avg_s ? Math.round(m.avg_s) : null,
      rank: at >= 0 ? at + 1 : null,
      pages: rows.length,
      top_source: pretty(src?.s),
      dash,
    });
  } catch (e) {
    // A site with no visits table has no tracking yet, which is a state, not a
    // fault: say so rather than showing a client an error for being new.
    if (/no such table/i.test(String(e))) return json({ tracking: false, dash });
    console.error('page-stats', String(e).slice(0, 160));
    return json({ error: 'unavailable' }, 503);
  }
};
