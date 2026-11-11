// Folders for the photo library.
//
//   GET    ?site=X                     the tree, with counts
//   POST   {op:'create', name, parent}  a new custom folder
//   POST   {op:'rename', id, name}
//   POST   {op:'retire', id}            hides the folder; the photos stay
//   POST   {op:'add',    id, srcs[]}    put photographs in a folder
//   POST   {op:'remove', id, srcs[]}    take them out of THAT folder only
//
// ⚠️ PROJECT FOLDERS ARE SEEDED ONCE AND THEN THEY BELONG TO THE CLIENT.
// They were DERIVED from each project's cover and gallery until 2026-10-29,
// read-only because a project decides its own pictures. That conflated two
// different sets:
//
//   the GALLERY is what the SITE shows — chosen by the project, and still is
//   the FOLDER  is where the CLIENT keeps the material for that job
//
// A shoot yields forty photographs and the site uses six. The client also has
// the before shots, the permit PDF, the walkthrough video. A folder derived
// from the gallery has room for none of it, so the client builds "Baker
// kitchen – all photos" NEXT TO ours and the structure we gave them is dead
// weight (Eric, 2026-10-29).
//
// So we seed: at launch, a 'Projects' folder with one subfolder per project,
// each holding what that project currently shows. From then on they are
// ordinary folders — rename them, nest them, add a video, throw the whole card
// in. A photograph the site uses is still MARKED as used, so the link is not
// lost; the marking lives on the photograph, where it belongs, not on a folder
// pretending to be the project.
//
// ⚠️ A PHOTOGRAPH IS NEVER COPIED. Uploads are content-addressed, so the same
// picture put in two folders is one object in R2, one row in `media`, and two
// rows here. "Add to Kitchens" costs a row, not a file.
// ⚠️ site.config.js has ONE export, a default, and it is the validated site
// object. Importing a named `CONTENT` built clean and failed at DEPLOY, which
// is the only place that bundles a Pages Function.
import SITE from '../../src/config/site.config.js';
import { readSession } from '../_editor-session';
// ⚠️ Emptied here rather than on the media read: this endpoint is called once
// when the drawer opens, while /api/media is called again on every refresh.
import { emptyTrash } from '../_trash';

interface Env { DB: D1Database; MEDIA?: R2Bucket; RP_SERVICE_KEY?: string }

// ⚠️ EVERY route here is behind the editor session, the same gate
// functions/api/media.ts uses. The first version of this file had no check at
// all: /api/folders answered 200 to anyone, and POST would have let a stranger
// create, rename and retire folders on a client's site and file their
// photographs. Caught by curling the deployed preview with no cookie, which is
// the only test that would have caught it — it builds and runs identically
// either way.
const guard = async (request: Request, env: Env) =>
  (await readSession(request, env.RP_SERVICE_KEY)) ? null : json({ error: 'sign in to edit' }, 401);

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const slugify = (s: string) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'folder';

/** What each project SHOWS today. Used to seed its folder, and to mark which
 *  photographs the site is using. It is not the folder's contents. */
function projectShows() {
  const out: { slug: string; title: string; srcs: string[] }[] = [];
  for (const p of (SITE as any).projects || []) {
    const srcs: string[] = [];
    if (p.cover?.src) srcs.push(p.cover.src);
    for (const g of p.gallery || []) if (g?.src) srcs.push(g.src);
    if (srcs.length) out.push({ slug: p.slug, title: p.title || p.slug, srcs });
  }
  return out;
}

/** ⚠️ ONCE. The seed runs when the library has no folders at all, and writes a
 *  marker row so it can never run twice — a client who deletes our Projects
 *  folder has decided something, and we do not undo it on the next page load. */
export async function seedOnce(db: D1Database, now: string) {
  const done = await db.prepare(`SELECT 1 FROM media_folder WHERE id = 'projects' LIMIT 1`).first();
  const any = await db.prepare(`SELECT 1 FROM media_folder LIMIT 1`).first();
  if (done || any) return;

  const shows = projectShows();
  if (!shows.length) return;

  const stmts: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO media_folder (id,name,parent_id,ord,created_at,created_by,deleted_at)
                VALUES ('projects','Projects',NULL,0,?,'seed',NULL)`).bind(now),
  ];
  shows.forEach((p, i) => {
    const id = `proj-${p.slug}`.slice(0, 64);
    stmts.push(db.prepare(`INSERT INTO media_folder (id,name,parent_id,ord,created_at,created_by,deleted_at)
                           VALUES (?,?,'projects',?,?,'seed',NULL)`).bind(id, p.title, i, now));
    // ⚠️ The seed MOVES the existing items rather than making new ones: the
    // photographs are already in the library, they just have no home yet.
    // Making items here would give the client two of each (0020).
    for (const src of [...new Set(p.srcs)]) {
      stmts.push(db.prepare(
        `UPDATE media_item SET folder_id = ?2
          WHERE folder_id IS NULL AND deleted_at IS NULL
            AND hash = (SELECT hash FROM media_blob WHERE src = ?1)`,
      ).bind(src, id));
    }
  });
  await db.batch(stmts);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const no = await guard(request, env); if (no) return no;
  const db = env.DB;
  await seedOnce(db, new Date().toISOString()).catch(() => {});
  // Thirty days is a promise the confirmation dialog makes; this keeps it.
  await emptyTrash(db, env.MEDIA).catch(() => {});
  const rows = await db.prepare(
    // ⚠️ Counted in ITEMS, not files. A folder holding one copy of a photograph
    // that also lives in two others counts one — which is what the client sees
    // when they open it (0020).
    // ⚠️ `updated` is the last time anything LANDED in the folder, falling back
    // to when the folder itself was made. The landing's "recently updated
    // folders" had nothing to sort on, so it sorted by SIZE and called the
    // result recent (Eric, 2026-10-30).
    `SELECT f.id, f.name, f.parent_id, f.ord,
            (SELECT count(*) FROM media_item i
              WHERE i.folder_id = f.id AND i.deleted_at IS NULL) AS n,
            COALESCE((SELECT max(COALESCE(i.updated_at, i.created_at)) FROM media_item i
                       WHERE i.folder_id = f.id AND i.deleted_at IS NULL),
                     f.created_at) AS updated
       FROM media_folder f WHERE f.deleted_at IS NULL ORDER BY f.ord, f.name`,
  ).all<{ id: string; name: string; parent_id: string | null; ord: number; n: number; updated: string }>();

  // Every folder is the client's. There is no second kind any more.
  const folders = (rows.results || []).map((r) => ({ ...r, kind: 'custom' as const }));

  // ⚠️ NO `usedBy`. It said which PROJECTS showed a photograph, which is only
  // ever part of the answer — the same picture may be the home page hero or sit
  // on a service page, and this knew about neither. A list of places that is
  // quietly incomplete tells a client they can safely remove a photo that is in
  // fact on their front page (Eric, 2026-10-29: "not very maintainable").
  // projectShows() stays because the SEED uses it.

  // Anything in no folder at all. A library with nowhere to put the loose
  // photographs quietly loses them.
  // Home holds the items that are in no folder.
  const loose = await db.prepare(
    'SELECT count(*) AS n FROM media_item WHERE folder_id IS NULL AND deleted_at IS NULL',
  ).first<{ n: number }>();

  return json({ folders, unfiled: loose?.n || 0 });
};

// ⚠️ AN UNCAUGHT THROW BECOMES CLOUDFLARE'S HTML 500 PAGE, and the client then
// sees whatever `.json()` says about the first character of that HTML. This
// handler had no try/catch at all, so every server-side fault arrived as
// "Unexpected token" and later as a bare 500 — four rounds of diagnosis for an
// error the server already knew (Eric, 2026-10-30). It answers in JSON with
// the reason now. The editor is behind a session, so the reason is safe to
// show the one person who can act on it.
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    return await handlePost(ctx);
  } catch (e) {
    const why = String((e as Error)?.message || e).slice(0, 200);
    console.error('[folders] POST threw:', why);
    return json({ error: why }, 500);
  }
};

const handlePost: PagesFunction<Env> = async ({ request, env }) => {
  const no = await guard(request, env); if (no) return no;
  const db = env.DB;
  const b = (await request.json().catch(() => ({}))) as any;
  const now = new Date().toISOString();
  const who = 'editor';

  if (b.op === 'create') {
    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'a folder needs a name' }, 400);
    // ⚠️ The slug may collide with a folder retired earlier. Reuse that row
    // rather than failing: to the client the name is simply available again.
    let id = slugify(name);
    // ⚠️ `.bind(id)`. This prepared a statement with ?1 and never bound it —
    // "Wrong number of parameter bindings" — the SAME fault as the line below,
    // one above it, found only because the first one was fixed and the error
    // finally reached the screen (2026-10-30).
    const clash = await db.prepare('SELECT id, deleted_at FROM media_folder WHERE id = ?1')
      .bind(id).first<{ id: string; deleted_at: string | null }>();
    // ⚠️ `.bind(...).first()`, NOT `.first([...])`. D1's `first()` takes a
    // COLUMN NAME; handing it an array of values throws, and the `as any`
    // silenced the type error that would have said so. It only fires when the
    // name ALREADY EXISTS, so creating a folder worked until the client tried
    // the same name twice — and then every attempt died as an HTML 500, which
    // reached the drawer as "Unexpected token" (Eric, 2026-10-30; four rounds
    // of diagnosis for one wrong call shape).
    // ⚠️ SAME NAME IN THE SAME PLACE IS THE SAME FOLDER. Dragging "Palettes" in a
    // second time made a SECOND row, so the client saw two tiles both reading
    // "Palettes" — and deleting one looked like the delete had not worked at all
    // (Eric, 2026-11-03: "it doesn't actually delete the folder after it says it
    // will"). It had; there were two.
    //
    // Dropbox merges, Finder offers to, Drive lets the duplicate stand. Merge is
    // right here: a client dragging a job folder again means "more photos from that
    // job", never "a second folder of the same name". The cost is that they cannot
    // deliberately keep two folders of one name side by side, which nobody has ever
    // wanted in a photo library.
    //
    // ⚠️ SCOPED TO THE PARENT, because the slug is GLOBAL. "Before" inside Baker
    // kitchen and "Before" inside Smith bath are different folders, and merging
    // those would pour one job's photographs into another.
    const parentOf = b.parent || null;
    const sameName = await db.prepare(
      `SELECT id FROM media_folder
        WHERE deleted_at IS NULL AND lower(name) = lower(?1)
          AND ((parent_id IS NULL AND ?2 IS NULL) OR parent_id = ?2)`,
    ).bind(name, parentOf).first<{ id: string }>();
    if (sameName) return json({ ok: true, id: sameName.id, name, merged: true });

    if (clash && !clash.deleted_at) {
      let i = 2;
      while (await db.prepare('SELECT 1 FROM media_folder WHERE id = ?1').bind(`${id}-${i}`).first()) i++;
      id = `${id}-${i}`;
    }
    await db.prepare(
      `INSERT INTO media_folder (id, name, parent_id, ord, created_at, created_by, deleted_at)
       VALUES (?1, ?2, ?3, 0, ?4, ?5, NULL)
       ON CONFLICT(id) DO UPDATE SET name = ?2, parent_id = ?3, deleted_at = NULL`,
    ).bind(id, name, b.parent || null, now, who).run();
    return json({ ok: true, id, name });
  }

  if (b.op === 'rename') {
    await db.prepare('UPDATE media_folder SET name = ?2 WHERE id = ?1').bind(b.id, String(b.name || '').trim()).run();
    return json({ ok: true });
  }

  if (b.op === 'retire') {
    // The photographs are untouched. Only the grouping goes.
    await db.prepare('UPDATE media_folder SET deleted_at = ?2 WHERE id = ?1').bind(b.id, now).run();
    return json({ ok: true });
  }

  // ⚠️ MOVING, not filing in two places. An item has exactly one folder, so
  // putting it somewhere is an UPDATE — there is no second row to make and no
  // first row to delete. This is what the blob/item split bought (0020).
  if (b.op === 'move') {
    const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((s: unknown) => typeof s === 'string').slice(0, 500) : [];
    if (!ids.length) return json({ error: 'need at least one photo' }, 400);
    // b.id may be null: that is Home, a real destination rather than an absence.
    const to = b.id ? String(b.id) : null;
    if (to) {
      const f = await db.prepare('SELECT id FROM media_folder WHERE id = ?1 AND deleted_at IS NULL').bind(to).first();
      if (!f) return json({ error: 'no such folder' }, 404);
    }
    await db.batch(ids.map((id) =>
      db.prepare('UPDATE media_item SET folder_id = ?2, updated_at = ?3 WHERE id = ?1')
        .bind(id, to, now)));
    return json({ ok: true, n: ids.length });
  }

  // ⚠️ REPARENTING A FOLDER, which is not the same act as refiling a
  // photograph: one moves a branch of the tree, the other moves a leaf into
  // one. A folder dropped into itself or into its own descendant would make a
  // loop nothing can draw, so the walk up from the destination has to clear
  // the folder being moved (Eric, 2026-10-30).
  if (b.op === 'reparent') {
    const id = String(b.id || '');
    const parent = b.parent ? String(b.parent) : null;
    if (!id) return json({ error: 'which folder?' }, 400);
    if (id === parent) return json({ error: 'a folder cannot go inside itself' }, 400);

    const all = await db.prepare(
      'SELECT id, parent_id FROM media_folder WHERE deleted_at IS NULL',
    ).all<{ id: string; parent_id: string | null }>();
    const up = new Map((all.results || []).map((f) => [f.id, f.parent_id]));
    if (!up.has(id)) return json({ error: 'no such folder' }, 404);
    if (parent && !up.has(parent)) return json({ error: 'no such folder' }, 404);
    for (let at = parent, hops = 0; at && hops < 64; at = up.get(at) || null, hops++) {
      if (at === id) return json({ error: 'a folder cannot go inside itself' }, 400);
    }

    await db.prepare('UPDATE media_folder SET parent_id = ?2 WHERE id = ?1').bind(id, parent).run();
    return json({ ok: true });
  }

  // ⚠️ COPY makes a second ITEM on the same blob: a file in each folder, one
  // object in R2. Nothing is uploaded and nothing is duplicated in storage.
  if (b.op === 'copy') {
    const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((s: unknown) => typeof s === 'string').slice(0, 200) : [];
    if (!ids.length) return json({ error: 'need at least one photo' }, 400);
    const to = b.id ? String(b.id) : null;
    const rows = await db.prepare(
      `SELECT id, hash, name FROM media_item WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`,
    ).bind(...ids).all<{ id: string; hash: string; name: string }>();
    const made = (rows.results || []).map((r) => ({ id: crypto.randomUUID().replace(/-/g, '').slice(0, 16), ...r }));
    await db.batch(made.map((m) =>
      db.prepare(`INSERT INTO media_item (id, hash, name, folder_id, created_at, created_by)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(m.id, m.hash, m.name, to, now, who)));
    return json({ ok: true, n: made.length });
  }

  return json({ error: 'unknown op' }, 400);
};
