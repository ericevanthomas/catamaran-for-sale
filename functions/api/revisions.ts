// Going back to how the site was.
//
// ⚠️ WHY THIS IS NOT THE OLD REVERT. The arrow in the section panel used to walk
// backwards through `content_log`, which held PATCHES addressed by path into a
// config tree. Stepping back through patches against a base that had itself
// moved is incoherent, and it showed: on 2026-10-30 pressing it oscillated
// between two wrong photographs and then stopped changing anything at all,
// because a deploy had meanwhile baked the mistake in as the new "original".
//
// A row in `revision` is the WHOLE SITE as it was at one publish. Going back to
// it is not a walk, it is a comparison: what does that version say that the
// site says differently now? Each difference becomes a draft, the client sees
// the old version staged in front of them, and publishing is still their
// decision. Nothing is overwritten behind their back, and "restore" cannot half
// -apply, because it does not apply anything — it stages.
import { readSession, type EditorEnv } from '../_editor-session';
import { diffFrom } from '../_versions';
import { assemble, TABLES } from '../../scripts/_assemble.mjs';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

interface Env extends EditorEnv { DB: D1Database }

const site = async (db: D1Database) => {
  const tables: Record<string, unknown[]> = {};
  const got = await db.batch(Object.entries(TABLES).map(([n, o]) => db.prepare(`SELECT * FROM ${n} ORDER BY ${o}`)));
  Object.keys(TABLES).forEach((n, i) => { tables[n] = (got[i] as any).results || []; });
  return assemble(tables);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in' }, 401);
  const rows = (await env.DB.prepare(
    `SELECT id, created_at, created_by FROM revision WHERE entity = 'site' ORDER BY created_at DESC LIMIT 30`,
  ).all<{ id: string; created_at: string; created_by: string }>()).results || [];
  return json({ versions: rows });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in' }, 401);

  let body: { id?: string; preview?: boolean };
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (!body.id) return json({ error: 'which version?' }, 400);

  const row = await env.DB.prepare(`SELECT value_json, created_at FROM revision WHERE id = ?1 AND entity = 'site'`)
    .bind(body.id).first<{ value_json: string; created_at: string }>();
  if (!row) return json({ error: 'no such version' }, 404);

  const then = JSON.parse(row.value_json);
  const now = await site(env.DB);

  // What that version says that the site says differently today.
  const changes = diffFrom(then, now);

  if (body.preview) return json({ ok: true, from: row.created_at, changes: changes.length });
  if (!changes.length) return json({ ok: true, from: row.created_at, staged: 0, note: 'the site already matches that version' });

  const ts = new Date().toISOString();
  await env.DB.batch(changes.map((c) => env.DB.prepare(
    `INSERT INTO content (field, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(c.field, JSON.stringify(c.value), ts, who)));

  return json({ ok: true, from: row.created_at, staged: changes.length });
};
