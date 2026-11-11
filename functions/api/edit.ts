// The editor's only write path.
//
// GET  → every override this site currently carries, so the editor can show
//        the client what they have already changed.
// POST → one field, validated against the same allowlist the browser used,
//        written to D1, and logged with its before value so it can be put back.
//
// There is deliberately no bulk endpoint. One edit is one row is one log line;
// a batch would make "undo the thing I just did" ambiguous.
import { validateField, staleUnder } from '../../src/config/editable.js';
import { mintSession, sessionCookie, readSession, readSessionFull, type EditorEnv } from '../_editor-session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const onRequestGet: PagesFunction<EditorEnv> = async ({ request, env }) => {
  // The PERSON, not just their name. The renewal below re-mints this cookie,
  // and minting it from `who` alone silently dropped the uid the dashboard
  // vouched for — so a correct handoff was undone by the next editor load,
  // and every chat started here was written as nobody (Eric 2026-10-06).
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  const who = sess?.who || null;
  if (!who) return json({ error: 'sign in to edit' }, 401);
  try {
    const rows = await env.DB.prepare('SELECT field, value, updated_at FROM content').all<{ field: string; value: string; updated_at: string }>();
    const fields: Record<string, unknown> = {};
    for (const r of rows.results || []) {
      try { fields[r.field] = JSON.parse(r.value); } catch { fields[r.field] = r.value; }
    }
    // Sliding renewal. The clock restarts every time the editor asks, so a
    // session only lapses for someone who has genuinely stopped working on
    // their site — not for someone who worked on it yesterday (Eric,
    // 2026-09-29).
    // `rp` is what the editor builds the Review mappings row from. THIS is the
    // endpoint it boots against — `var API = '/api/edit'` — not
    // /api/edit-session, which it only ever reaches by redirect. Adding the role
    // to edit-session alone (2026-10-13) left `d.rp` undefined here, so the row
    // never appeared however correct the cookie was.
    // `caps` is what this TENANT has, which is a different question from who is
    // signed in, and the composer's "Write a new post" row is built from it
    // (2026-11-11). Same lesson as `rp` above: this is the endpoint the editor
    // BOOTS against — `var API = '/api/edit'` — so a capability added to
    // /api/edit-session alone would never reach the menu.
    const body = json({ who, rp: sess?.rp === true, caps: sess?.caps || [], fields, dash: env.RP_DASH || null });
    if (env.RP_SERVICE_KEY) {
      // The ROLE has to survive the sliding renewal. Re-minting without it
      // silently demoted a creator to a client on the very next request the
      // editor made, which is every page load.
      // The CAPABILITIES have to survive the sliding renewal too, for the same
      // reason the role does: re-minting without them would switch a client's
      // blog off on the very next request the editor made, which is every page
      // load.
      body.headers.append('set-cookie', sessionCookie(await mintSession(who, env.RP_SERVICE_KEY, sess?.uid ?? null, sess?.rp === true, sess?.caps ?? null)));
      body.headers.append('set-cookie',
        `rp_edit_on=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; Secure; SameSite=Lax`);
    }
    return body;
  } catch (e) {
    console.error('edit get', String(e).slice(0, 160));
    return json({ error: 'unavailable' }, 503);
  }
};

export const onRequestPost: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in to edit' }, 401);

  let body: { field?: string; value?: unknown; revert?: boolean; path?: string };
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const field = String(body.field || '');

  // Putting back the FIRST edit to a field. There is no earlier value to write
  // — the earlier value is the one we shipped — so the honest revert is to drop
  // the override and let the page fall back to the config. Logged like any
  // other change, so it can itself be undone.
  if (body.revert) {
    // No allowlist check here, on purpose. Dropping an override can never put
    // something on a page that was not already there, and a field we RETIRE
    // from the allowlist would otherwise leave data nobody could delete
    // (Eric, 2026-09-28: `services.*.cardName` became `services.*.labels.*`).
    if (!/^[A-Za-z0-9_.\-]{1,120}$/.test(field)) return json({ error: 'bad field' }, 422);
    try {
      const prev = await env.DB.prepare('SELECT value FROM content WHERE field = ?1').bind(field).first<{ value: string }>();
      if (!prev) return json({ ok: true, unchanged: true });
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM content WHERE field = ?1').bind(field),
        env.DB.prepare('INSERT INTO content_log (id, ts, field, before, after, who, path) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)')
          .bind(crypto.randomUUID(), now, field, prev.value, who, String(body.path || '') || null),
      ]);
      return json({ ok: true, reverted: true, field, saved_at: now });
    } catch (e) {
      console.error('edit revert', String(e).slice(0, 160));
      return json({ error: 'That did not save. Try again.' }, 503);
    }
  }

  let value: unknown;
  try { value = validateField(field, body.value); } catch (e) {
    // The message is the reason, and the reason is shown to the client, so it
    // is written for them: "too long", not "ZodError at path hero.headline".
    return json({ error: String((e as Error).message) }, 422);
  }

  const stored = JSON.stringify(value);
  const now = new Date().toISOString();
  try {
    const prev = await env.DB.prepare('SELECT value FROM content WHERE field = ?1').bind(field).first<{ value: string }>();
    // Saving the same thing twice is not an edit. It happens on every blur of
    // an untouched field, and logging it would bury the real changes.
    if (prev && prev.value === stored) return json({ ok: true, unchanged: true });

    const writes = [
      env.DB.prepare(
        `INSERT INTO content (field, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).bind(field, stored, now, who),
    ];

    // Reordering a list writes the whole array back, and that array already
    // carries the client's own edits, because the page renders from the merged
    // config. Any edit saved against a POSITION inside it is now redundant and
    // wrong: re-applied on top, at a spot that holds something else. Dropping
    // them here is what stops a rename following the drag onto its neighbour
    // (Eric, 2026-09-29).
    if (Array.isArray(value)) {
      const held = await env.DB.prepare('SELECT field FROM content').all<{ field: string }>();
      const rows: Record<string, unknown> = {};
      for (const r of held.results || []) rows[r.field] = 1;
      for (const dead of staleUnder(field, rows)) {
        writes.push(env.DB.prepare('DELETE FROM content WHERE field = ?1').bind(dead));
        writes.push(
          env.DB.prepare('INSERT INTO content_log (id, ts, field, before, after, who, path) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5)')
            .bind(crypto.randomUUID(), now, dead, who, 'superseded by reorder'),
        );
      }
    }

    writes.push(
      // ⚠️ `revert` MARKS A STEP BACK, so the next step back can skip it. Without
      // it a revert is just another change, and stepping back a second time
      // undoes the revert — oscillating between the last two values forever
      // (Eric, 2026-10-30). The row is still written: an audit trail that hides
      // corrections is not one.
      env.DB.prepare('INSERT INTO content_log (id, ts, field, before, after, who, path, revert) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(crypto.randomUUID(), now, field, prev ? prev.value : null, stored, who,
              String(body.path || '') || null, body.revert ? 1 : 0),
    );

    // A description describes the photograph, so it is stored against the FILE
    // as well as the slot. Write it once here and every future use of that
    // photo — on this page or any other — arrives already saying what it shows.
    const img = value as { src?: string; alt?: string };
    if (img && typeof img === 'object' && img.src && typeof img.alt === 'string' && img.alt.trim()) {
      writes.push(
        env.DB.prepare(
          `INSERT INTO media (src, alt, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(src) DO UPDATE SET alt = excluded.alt, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        ).bind(img.src, img.alt.trim(), now, who),
      );
    }

    await env.DB.batch(writes);
    return json({ ok: true, field, value, saved_at: now });
  } catch (e) {
    console.error('edit post', String(e).slice(0, 160));
    return json({ error: 'That did not save. Try again.' }, 503);
  }
};

// ── history ────────────────────────────────────────────────────────────────
// Every save, newest first, with what it was before. This is what makes the
// undo stepper possible: an undo is not a special operation, it is an ordinary
// save of the previous value, so it lands in the log like anything else and can
// itself be undone.
export const onRequestPut: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in to edit' }, 401);
  try {
    const rows = await env.DB.prepare(
      `SELECT id, ts, field, before, after, who, path, revert FROM content_log ORDER BY ts DESC, rowid DESC LIMIT 60`,
    ).all<{ id: string; ts: string; field: string; before: string | null; after: string | null;
            who: string; path: string | null; revert: number }>();
    const parse = (v: string | null) => { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };
    return json({
      history: (rows.results || []).map((r) => ({
        id: r.id, ts: r.ts, field: r.field, who: r.who, path: r.path,
        revert: !!r.revert,
        before: parse(r.before), after: parse(r.after),
      })),
    });
  } catch (e) {
    console.error('edit history', String(e).slice(0, 160));
    return json({ history: [] });
  }
};
