// A blog post, as the record it is.
//
// GET  ?collection=blog&slug=x  → the whole row, DRAFTS INCLUDED, so the
//      composer edits what D1 holds rather than what the last build shipped.
// GET  ?facets=blog             → the authors and categories already in use,
//      for the two pick-or-type fields.
// PUT  { collection, slug, … }  → the record, validated, written, logged.
//
// ⚠️ 2026-11-11: THIS FILE DID NOT EXIST IN THIS REPO, and the composer in
// public/rp-edit.js has called it since the composer was written. Every save on
// every site built from this kit answered 405, with the editor's corner still
// reading "Saving…" because a failed save had nothing to set it back. Eric
// found it by writing a post. The endpoint existed in exactly one place —
// electromagneticweb/functions/api/post.ts — so this is a PORT of the proven
// one, and what changed on the way in is named at the bottom of this comment.
//
// ── why this is not /api/edit ───────────────────────────────────────────────
// /api/edit writes ONE FIELD of a page's copy into the `content` table, where
// D1 holds the DIFFERENCE between the config and what the client changed. A
// post is the other shape, and migrations/0023_posts.sql says so in its own
// first paragraph: "here D1 holds the RECORD. A blog post is not a diff against
// anything."
//
// So the unit of change here is the record, not the field, and that is also why
// this endpoint HAS a bulk shape where /api/edit deliberately does not. A post
// is published as a whole — you do not publish a column — and `posts_log` keeps
// the before and after as whole rows for exactly that reason. One PUT is one
// log line is one thing to put back.
//
// ── who may write one ──────────────────────────────────────────────────────
// Any signed-in editor may change a post's words, date, author, category and
// status. A post is the client's own writing, not a mapping we have to vet, so
// the approval gate does not stand in front of it (wires/EDITOR-RULES.md §9
// gates what a client is HANDED; it has never gated what they write).
//
// Starting a post is the one thing that is ours, because a new post is a new
// URL — a page search engines index, that other pages link to, and that cannot
// be changed later without a redirect, which is §9's "anything touching a
// record's name, slug or URL → ASK ERIC". Renaming an existing post's slug is
// not offered at all.
//
// ⚠️ AND WHO MAY START ONE IS NOW A CAPABILITY, NOT A ROLE. EMW's copy gated
// creation on `rp` alone, with a flag in its own comments saying that was the
// line to move when clients were to write their own. Whether a tenant HAS a
// blog is a different axis from who is signed in, and it is decided in the
// client registry and carried inside the dashboard's signed voucher
// (_editor-session.ts → `caps`). One place decides, signed, central, and no
// client site is rebuilt to turn a blog on (Eric, 2026-11-11: "this is a toggle
// in our database, not any sort of variation that ships and deploys with the
// client's own content").
//
// ── what changed coming from EMW ───────────────────────────────────────────
// · `env.DB_EMW` → `env.DB`. The binding name is a tenant-shaped detail and it
//   is the reason the publisher Worker ran dead for twelve days after the same
//   kind of wholesale copy (publisher/src/index.ts, 2026-11-11). One binding
//   name in every copy of the kit; the database it points at changes.
// · Creation is gated on the blog CAPABILITY or on RP, not on RP alone.
// · 'no such table' now names migrations/0023_posts.sql, which is this repo's
//   number for the same table.
// · No DELETE handler, because nothing calls one. The composer has no control
//   that removes a post, and neither does EMW's; an endpoint nothing reaches is
//   a door into the records with no reason to exist yet. Unpublishing — which
//   is what "take it down" actually means — is a status change through the PUT
//   above, and it is logged as one.
import { readSessionFull, type EditorEnv } from '../_editor-session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// The only collection the composer can edit, and on a kit site the only one
// that exists. EMW's `posts` table carries three more (portfolio, faq,
// case-studies) which are assembled from fields rather than written as prose,
// so handing them to a markdown composer would be offering an editor for
// something that is not a document.
const COLLECTION = 'blog';

const OK_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const OK_PATH = /^\/[A-Za-z0-9\-._~/%]{0,300}$/;

// Caps. The body's is generous on purpose — the longest post on EMW is 25KB —
// and it is a backstop against a runaway paste, not a style rule.
const MAX = { title: 160, description: 320, author: 120, category: 60, alt: 500, body: 400000 };

const str = (v: unknown) => (v == null ? '' : String(v));
const clean = (v: unknown) => str(v).replace(/\s+/g, ' ').trim();

/** The row the composer sends, checked. Throws with a message meant for a person. */
function vet(b: Record<string, unknown>, existing: Row | null) {
  const title = clean(b.title);
  if (!title) throw new Error('A post needs a title.');
  if (title.length > MAX.title) throw new Error(`The title has to be under ${MAX.title} characters.`);

  const description = clean(b.description);
  if (description.length > MAX.description) throw new Error(`The description has to be under ${MAX.description} characters.`);

  const author = clean(b.author);
  if (author.length > MAX.author) throw new Error('That author name is too long.');

  const category = clean(b.category);
  if (category.length > MAX.category) throw new Error('That category name is too long.');

  const status = str(b.status) || 'published';
  if (status !== 'draft' && status !== 'published') throw new Error('bad status');

  // The date as the client picked it. A date-only value keeps the time of day
  // the record already had, so saving a post without touching its date cannot
  // move it to midnight — which would change the order of the blog index.
  let published_at: string | null = null;
  const raw = str(b.published_at).trim();
  if (raw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const had = existing?.published_at ? new Date(existing.published_at) : null;
      const t = had && !Number.isNaN(had.valueOf())
        ? had.toISOString().slice(10)                 // 'T12:00:00.000Z'
        : 'T12:00:00.000Z';
      const d = new Date(raw + t);
      if (Number.isNaN(d.valueOf())) throw new Error('That date did not make sense.');
      published_at = d.toISOString();
    } else {
      const d = new Date(raw);
      if (Number.isNaN(d.valueOf())) throw new Error('That date did not make sense.');
      published_at = d.toISOString();
    }
  }
  if (status === 'published' && !published_at) throw new Error('A published post needs a date.');

  const image = str(b.image).trim();
  if (image && !OK_PATH.test(image)) throw new Error('That is not a photo on your site.');
  const image_alt = str(b.image_alt).trim().slice(0, MAX.alt);

  // The body is markdown and arrives verbatim. Newlines are normalised because
  // a browser will send \r\n from a textarea, and a post whose line endings
  // change on every save is a post nobody can read a diff of.
  const body = str(b.body).replace(/\r\n?/g, '\n');
  if (body.length > MAX.body) throw new Error('That post is too long to save.');

  return { title, description, author, category, status, published_at, image, image_alt, body };
}

interface Row {
  collection: string; slug: string; status: string; title: string; description: string | null;
  body: string; body_format: string; published_at: string | null; updated_at: string | null;
  author: string | null; image: string | null; image_alt: string | null; category: string | null;
  sort_order: number | null; extra: string; origin: string;
  created_at: string; touched_at: string; touched_by: string | null;
}

const COLS = `collection, slug, status, title, description, body, body_format, published_at,
  updated_at, author, image, image_alt, category, sort_order, extra, origin,
  created_at, touched_at, touched_by`;

/** A name as an id: lowercase, hyphens, nothing else. */
const idOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * A new author or a new category, kept.
 *
 * ⚠️ NO CONFIRMATION, NO WARNING, NO REQUEST FORM. Eric, 2026-11-11: "Let's
 * just let clients pick from the list or add a new one… This is an opportunity
 * for us to take on some of the burden of deduping and spell checking
 * ourselves… automatic cleanup without the client thinking about it or having
 * to fill out a request when they just want to publish their post." The
 * friction is ours. A client types a name, it is accepted, and it is in the
 * list for every post after this one.
 *
 * ⚠️ AND A NEW PERSON IS NOT ON THE TEAM PAGE. `person` rows render /about/team
 * through scripts/_assemble.mjs, which reads published people only — so a
 * byline written in the composer creates a DRAFT person: real, in the list, in
 * the schema.org author, and not a half-filled card with no role, no bio and no
 * photograph on the client's About page until somebody fills those in.
 *
 * Both are best-effort. A post is not refused because its byline could not be
 * filed; the row carries the words either way, which is what the client asked
 * for.
 */
async function keepFacets(db: D1Database, author: string, category: string, now: string) {
  const jobs: D1PreparedStatement[] = [];
  if (author) {
    const known = await db.prepare('SELECT 1 AS n FROM person WHERE name = ?1').bind(author).first<{ n: number }>().catch(() => null);
    if (!known) {
      jobs.push(db.prepare(
        `INSERT OR IGNORE INTO person (id, name, role, bio, asset_id, status, sort, created_at, updated_at)
         VALUES (?1, ?2, NULL, NULL, NULL, 'draft',
                 (SELECT COALESCE(MAX(sort), 0) + 1 FROM person), ?3, ?3)`,
      ).bind(idOf(author) || `author-${Date.now()}`, author, now));
    }
  }
  if (category) {
    jobs.push(db.prepare(
      `INSERT OR IGNORE INTO record_label (kind, record_id, placement, text)
       VALUES ('blog', ?1, 'name', ?2)`,
    ).bind(idOf(category) || `category-${Date.now()}`, category));
  }
  if (jobs.length) await db.batch(jobs);
}

export const onRequestGet: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  if (!sess) return json({ error: 'sign in to edit' }, 401);
  const url = new URL(request.url);

  // Whether this tenant has a blog at all. The composer reads it off /api/edit
  // for the menu row; it is repeated in the answer here so the one surface that
  // asks about posts does not have to hold two sources for the same fact.
  const mayStart = sess.rp === true || sess.caps.includes('blog');

  // The two pick-or-type lists.
  //
  // ⚠️ THEY COME FROM THE TABLES, NOT FROM THE POSTS. Until 2026-11-11 both
  // were "the values already used in the posts table", which is folksonomy
  // rather than schema: the first typo becomes a permanent category, and an
  // author is a string that is nobody. Eric: "Author and category still seem to
  // be freeform text. Aren't these a schema?" They are, and both tables already
  // existed in every client's vault:
  //
  //   author    `person` — a person with a name, a role, a photo and a bio.
  //             That is what makes a byline link somewhere and the schema.org
  //             author real rather than decorative.
  //   category  `record_label` with kind 'blog', the same table already doing
  //             this job for kind 'service' and kind 'project'.
  //
  // Each list is UNIONED with what the posts already hold, so a byline written
  // before this existed does not vanish from the list the day it ships.
  if (url.searchParams.get('facets')) {
    try {
      const [people, labels, au, ca] = await Promise.all([
        env.DB.prepare('SELECT name FROM person ORDER BY sort, name').all<{ name: string }>().catch(() => ({ results: [] })),
        env.DB.prepare(
          `SELECT DISTINCT text FROM record_label WHERE kind = 'blog' AND placement = 'name' ORDER BY text`,
        ).all<{ text: string }>().catch(() => ({ results: [] })),
        env.DB.prepare(
          `SELECT author AS v, COUNT(*) AS n FROM posts WHERE collection = ?1 AND author IS NOT NULL
             AND author <> '' GROUP BY author ORDER BY n DESC, v`,
        ).bind(COLLECTION).all<{ v: string; n: number }>(),
        env.DB.prepare(
          `SELECT category AS v, COUNT(*) AS n FROM posts WHERE collection = ?1 AND category IS NOT NULL
             AND category <> '' GROUP BY category ORDER BY n DESC, v`,
        ).bind(COLLECTION).all<{ v: string; n: number }>(),
      ]);
      // The table's order first, then anything only the posts know about. A
      // Set keeps the first spelling of each, compared exactly: deduping
      // "kitchens" against "Kitchens" is the tidying sweep's job, not this
      // endpoint's, and doing it here would silently change what a client typed.
      const merge = (first: string[], rest: string[]) =>
        [...new Set([...first, ...rest].map((s) => String(s || '').trim()).filter(Boolean))];
      return json({
        authors: merge((people.results || []).map((r) => r.name), (au.results || []).map((r) => r.v)),
        categories: merge((labels.results || []).map((r) => r.text), (ca.results || []).map((r) => r.v)),
        rp: sess.rp === true,
        blog: mayStart,
      });
    } catch (e) {
      console.error('post facets', String(e).slice(0, 160));
      // An empty list still leaves both fields usable: they are free text.
      return json({ authors: [], categories: [], rp: sess.rp === true, blog: mayStart });
    }
  }

  const slug = str(url.searchParams.get('slug'));
  if (!OK_SLUG.test(slug)) return json({ error: 'bad slug' }, 422);
  try {
    const row = await env.DB.prepare(
      `SELECT ${COLS} FROM posts WHERE collection = ?1 AND slug = ?2`,
    ).bind(COLLECTION, slug).first<Row>();
    if (!row) return json({ error: 'no such post' }, 404);
    return json({ post: row, rp: sess.rp === true, blog: mayStart });
  } catch (e) {
    const msg = String(e);
    console.error('post get', msg.slice(0, 160));
    if (/no such table/i.test(msg)) {
      return json({ error: 'Posts are not set up on this site yet.' }, 503);
    }
    return json({ error: 'unavailable' }, 503);
  }
};

export const onRequestPut: PagesFunction<EditorEnv> = async ({ request, env }) => {
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  if (!sess) return json({ error: 'sign in to edit' }, 401);
  const who = sess.who;

  let b: Record<string, unknown>;
  try { b = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }

  const slug = str(b.slug).trim().toLowerCase();
  if (!OK_SLUG.test(slug)) {
    return json({ error: 'A web address can only use lowercase letters, numbers and hyphens.' }, 422);
  }

  const now = new Date().toISOString();
  try {
    const existing = await env.DB.prepare(
      `SELECT ${COLS} FROM posts WHERE collection = ?1 AND slug = ?2`,
    ).bind(COLLECTION, slug).first<Row>();

    // A new post is a new URL, and a URL is ours (§9). Everything about an
    // EXISTING post is the client's to change.
    //
    // The capability is what decides, and it is inside the session HMAC, so a
    // browser cannot grant it to itself. RP passes regardless: somebody at
    // Remodeler Pilot writing the first post on a site whose blog is not yet
    // switched on is how a blog gets switched on.
    if (!existing && sess.rp !== true && !sess.caps.includes('blog')) {
      return json({ error: 'Ask us to start a new post and we will set up its web address.' }, 403);
    }

    // ⚠️ A NEW POST MAY NOT LAND ON AN ADDRESS SOMETHING ALREADY HOLDS. The
    // composer derives a slug from the title now, so two posts called "Kitchen
    // costs in 2026" arrive at the same one — and the write below is an upsert,
    // which would have made the second post overwrite the first with no
    // warning to anybody. `create` is sent only on a post's first save, so an
    // ordinary update is unaffected. The composer avoids this for a DERIVED
    // address by checking first; this is the guarantee for a typed one, and the
    // one that holds whatever the browser does.
    if (existing && b.create === true) {
      return json({
        error: 'Another post already uses that web address. Change it and save again.',
      }, 409);
    }

    let v;
    try { v = vet(b, existing); } catch (e) { return json({ error: (e as Error).message }, 422); }

    // `updated_at` is schema.org dateModified, and 0023 is explicit that it is
    // NOT the row's bookkeeping timestamp — `touched_at` is, "deliberately a
    // different column so filing a post under a new category cannot be mistaken
    // for an editorial revision". So it moves only when the WORDS move, and only
    // on a post that is already published: a draft has not been published once,
    // so it cannot have been revised.
    //
    // Compared on the CLEANED values, which matters for a reason EMW found in
    // the browser: one of its migrated posts has a title ending in a
    // non-breaking space. Saving that post tidies it — correctly, and invisibly
    // — and comparing raw would have called that an editorial revision and put a
    // dateModified on a BlogPosting because of one character nobody can see.
    const wordsChanged = !existing
      || existing.body !== v.body
      || clean(existing.title) !== v.title
      || clean(existing.description) !== v.description;
    const updated_at = existing && existing.status === 'published' && v.status === 'published' && wordsChanged
      ? now
      : (existing ? existing.updated_at : null);

    const after: Row = {
      collection: COLLECTION,
      slug,
      status: v.status,
      title: v.title,
      description: v.description || null,
      body: v.body,
      body_format: 'markdown',
      published_at: v.published_at,
      updated_at,
      author: v.author || null,
      image: v.image || null,
      image_alt: v.image_alt || null,
      category: v.category || null,
      sort_order: existing ? existing.sort_order : null,
      extra: existing ? existing.extra : '{}',
      origin: 'editor',
      created_at: existing ? existing.created_at : now,
      touched_at: now,
      touched_by: who,
    };

    // Nothing changed is not a save. It happens whenever the composer is
    // opened and closed, and logging it would bury the real revisions.
    if (existing && JSON.stringify({ ...existing, touched_at: '', touched_by: '' })
      === JSON.stringify({ ...after, touched_at: '', touched_by: '' })) {
      return json({ ok: true, unchanged: true, post: existing });
    }

    const action = !existing ? 'create'
      : existing.status !== after.status ? (after.status === 'published' ? 'publish' : 'unpublish')
        : 'update';

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO posts (${COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
         ON CONFLICT(collection, slug) DO UPDATE SET
           status = excluded.status, title = excluded.title, description = excluded.description,
           body = excluded.body, body_format = excluded.body_format,
           published_at = excluded.published_at, updated_at = excluded.updated_at,
           author = excluded.author, image = excluded.image, image_alt = excluded.image_alt,
           category = excluded.category, origin = excluded.origin,
           touched_at = excluded.touched_at, touched_by = excluded.touched_by`,
      ).bind(
        after.collection, after.slug, after.status, after.title, after.description,
        after.body, after.body_format, after.published_at, after.updated_at,
        after.author, after.image, after.image_alt, after.category, after.sort_order,
        // ⚠️ NO TRAILING COMMA. scripts/check-sql-bindings.mjs counts top-level
        // commas inside bind(), so one here reads as a twentieth argument
        // against nineteen placeholders and fails the check.
        after.extra, after.origin, after.created_at, after.touched_at, after.touched_by),
      env.DB.prepare(
        `INSERT INTO posts_log (id, ts, collection, slug, action, before, after, who)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(crypto.randomUUID(), now, COLLECTION, slug, action,
        existing ? JSON.stringify(existing) : null, JSON.stringify(after), who),
    ]);

    // After the post is safely written, never instead of it. A byline that
    // could not be filed is a tidying problem; a post that did not save is the
    // client's work gone.
    try { await keepFacets(env.DB, after.author || '', after.category || '', now); }
    catch (e) { console.error('post facets keep', String(e).slice(0, 160)); }

    return json({ ok: true, action, post: after, saved_at: now });
  } catch (e) {
    const msg = String(e);
    console.error('post put', msg.slice(0, 200));
    // The one failure worth naming: the table is not there yet.
    if (/no such table/i.test(msg)) {
      return json({ error: 'Posts are not set up on this site yet.' }, 503);
    }
    return json({ error: 'That did not save. Try again.' }, 503);
  }
};
