// What this site currently hands out, and the two ways to change it.
//
// GET  ?path=/about  → the approvals and locks that apply to that page, so
//      the editor can decide, element by element, what to offer.
// POST { section, shape }  → this section's mapping has been read and is fit
//      to edit. Recorded against the shape it was approved at.
// POST { el, lock: true }  → take this element back. Immediate, because
//      locking is always safe (wires/EDITOR-RULES.md §9).
//
// Why an endpoint at all, when approval used to be a JSON file in the repo:
// because approving was a deploy, and a review step that needs a push is a
// review step nobody does on the spot (Eric, 2026-09-30). The mapping stays
// in git — it is code, generated from the markup. The approval is this
// client's data and lives in this client's D1. See migrations/0014.
//
// ⚠️ THE GATE, CORRECTED 2026-10-13. It used to be the editor's own gate
// verbatim — `readSession`, 401 without it — on the reasoning that "there is no
// separate approver identity, because there is no separate approver: the person
// who can edit this site is the person we let look at it" (Eric, 2026-09-29).
// That was true when only Eric could sign in. It stopped being true the moment
// a client could, and it emptied the approval gate: approving is what UNLOCKS a
// section for the client, so a client who could approve could unlock every
// field we had mapped and not yet signed off, just by flipping rp_view=staff in
// their own cookie jar. GET stays open to any editor — it is how the page knows
// what to offer, and the mapping is in the markup anyway. POST is RP only.
// The role rides inside the session HMAC (see _editor-session.ts), so a browser
// cannot grant it to itself.
import { readSessionFull, readSession, type EditorEnv } from '../_editor-session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const clip = (s: unknown, n: number) => String(s == null ? '' : s).slice(0, n);

// A path, a section id and a field address are all things we put in the
// markup, so anything outside this shape is not ours and is not a near miss
// worth guessing at.
const OK_PATH = /^\/[A-Za-z0-9/_.-]{0,300}$/;
const OK_NAME = /^[A-Za-z0-9_()*.-]{1,200}$/;
const OK_SHAPE = /^[a-f0-9]{6,64}$/;

// Who is asking. The signed cookie first, then the same machine lane
// /api/edit-session already opens with the service key — Sam approves the
// sections he was told to seed, and a rig with no browser cannot hold a
// cookie (edit-session.ts, 2026-09-29). `as` names the person it is acting
// for, so a row never says "a machine did it".
async function whoAsks(request: Request, env: EditorEnv): Promise<{ who: string; rp: boolean } | null> {
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  if (sess) return { who: sess.who, rp: sess.rp };
  const url = new URL(request.url);
  const key = url.searchParams.get('k') || '';
  // Holding the service key is the RP lane; it is a Pages secret.
  if (env.RP_SERVICE_KEY && key === env.RP_SERVICE_KEY) {
    return { who: clip(url.searchParams.get('as'), 120) || 'Eric Thomas', rp: true };
  }
  return null;
}

// The page an ask is about. Trailing slash off, empty means the home page, so
// '/about/' and '/about' can never be two different rows.
const norm = (p: string) => (p.replace(/\/+$/, '') || '/');

export const onRequestGet: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const asker = await whoAsks(request, env);
  if (!asker) return json({ error: 'sign in to edit' }, 401);

  const url = new URL(request.url);
  const raw = url.searchParams.get('path') || '/';
  if (!OK_PATH.test(raw)) return json({ error: 'bad path' }, 422);
  const page = norm(raw);

  try {
    const [ok, locks] = await Promise.all([
      env.DB.prepare(
        'SELECT section, shape, approved_by, approved_at FROM section_approvals WHERE page = ?1',
      ).bind(page).all<{ section: string; shape: string; approved_by: string; approved_at: string }>(),
      // Locks are read for the WHOLE site, not just this page. An address is
      // an address: `about.headline` locked on /about is the same value
      // wherever else it renders, and offering it on one page and not another
      // would be the editor disagreeing with itself.
      env.DB.prepare('SELECT el, locked_by, locked_at FROM element_locks')
        .all<{ el: string; locked_by: string; locked_at: string }>(),
    ]);

    const approvals: Record<string, { shape: string; by: string; at: string }> = {};
    for (const r of ok.results || []) {
      approvals[r.section] = { shape: r.shape, by: r.approved_by, at: r.approved_at };
    }
    const locked: Record<string, { by: string; at: string }> = {};
    for (const r of locks.results || []) locked[r.el] = { by: r.locked_by, at: r.locked_at };

    return json({ page, approvals, locks: locked });
  } catch (e) {
    // Not knowing is not the same as "nothing is approved". The editor treats
    // a missing answer as "leave the page alone" rather than locking a
    // working site, and saying so explicitly is what lets it (see
    // loadApprovals in public/rp-edit.js).
    console.error('approvals get', String(e).slice(0, 160));
    return json({ error: 'unavailable' }, 503);
  }
};

export const onRequestPost: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const asker = await whoAsks(request, env);
  if (!asker) return json({ error: 'sign in to edit' }, 401);
  // Approving is what hands a section to the client, and locking takes one
  // back. Both are Remodeler Pilot's to do. A client signing in to edit their
  // own words is not an approver, however correctly they are signed in.
  if (!asker.rp) return json({ error: 'not yours to approve' }, 403);
  const who = asker.who;

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const rawPath = clip(b.path, 300) || '/';
  if (!OK_PATH.test(rawPath)) return json({ error: 'bad path' }, 422);
  const page = norm(rawPath);
  const now = new Date().toISOString();

  // ── locking one element ──────────────────────────────────────────────────
  // Safe enough to be a button, which is why it is one. There is no unlock
  // beside it: see migrations/0014.
  if (b.el) {
    const el = clip(b.el, 200);
    if (!OK_NAME.test(el)) return json({ error: 'bad element' }, 422);
    try {
      await env.DB.prepare(
        `INSERT INTO element_locks (page, el, locked_by, locked_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(page, el) DO UPDATE SET locked_by = excluded.locked_by, locked_at = excluded.locked_at`,
      ).bind(page, el, who, now).run();
      return json({ ok: true, page, el, locked_by: who, locked_at: now });
    } catch (e) {
      console.error('approvals lock', String(e).slice(0, 160));
      return json({ error: 'That did not save. Try again.' }, 503);
    }
  }

  // ── approving one section ────────────────────────────────────────────────
  const section = clip(b.section, 200);
  const shape = clip(b.shape, 64);
  if (!OK_NAME.test(section)) return json({ error: 'bad section' }, 422);
  // The shape is the whole value of the row. An approval with no shape would
  // never lapse, which is the one thing approval has to do.
  if (!OK_SHAPE.test(shape)) return json({ error: 'bad shape' }, 422);

  try {
    await env.DB.prepare(
      `INSERT INTO section_approvals (page, section, shape, approved_by, approved_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(page, section) DO UPDATE SET
         shape = excluded.shape, approved_by = excluded.approved_by, approved_at = excluded.approved_at`,
    ).bind(page, section, shape, who, now).run();
    return json({ ok: true, page, section, shape, approved_by: who, approved_at: now });
  } catch (e) {
    console.error('approvals post', String(e).slice(0, 160));
    return json({ error: 'That did not save. Try again.' }, 503);
  }
};
