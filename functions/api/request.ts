// The client asking for something.
//
// GET  ?path=/services/kitchens → what has already been asked about this page,
//      so the answer to "did I already mention this?" is on the page itself.
// POST → files a request and emails it, because a note nobody reads is worse
//      than no note at all.
//
// Deliberately not a contact form: every request arrives already knowing which
// page and which section it came from, which is the whole reason it beats an
// email that says "the bit on the left is wrong".
import { readSessionFull, type EditorEnv } from '../_editor-session';

interface Env extends EditorEnv {
  RESEND_API_KEY?: string;
  RP_NOTIFY?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// 'mapping' is OURS, not the client's (Eric, 2026-09-30).
//
// It is a note about how a section is WIRED — this figure should not be
// editable, that heading is addressed at the wrong thing — written by
// whoever is reviewing the mapping in staff view. It rides this table
// because a mapping note is the same shape as a request: a page, the thing
// it is about, and a sentence. What it must never do is appear in the
// client's own list of what they have asked us for, which is a list of
// promises we have made to them. Excluded at the QUERY, below, rather than
// filtered in the browser: the editor cannot leak what it is never sent.
const KINDS = new Set(['note', 'change', 'exclude', 'mapping']);
const MAPPING = 'mapping';
const clip = (s: unknown, n: number) => String(s == null ? '' : s).slice(0, n);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  const who = sess ? sess.who : null;
  if (!who) return json({ error: 'sign in first' }, 401);
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  // `scope=all` is the requests drawer: everything the client has ever asked
  // for, so they can see it in one place and close off the ones that are done.
  const scope = url.searchParams.get('scope') || '';
  const all = scope === 'all';
  // `scope=mapping` is the staff review surface, and it is the ONLY way to
  // read a mapping note back out. Every other scope excludes them by name in
  // the SQL, so the client's drawer cannot show one however it asks.
  const mapping = scope === MAPPING;
  try {
    const rows = mapping
      ? await env.DB.prepare(
          `SELECT id, ts, path, anchor, anchor_label, kind, body, status, answered
             FROM requests WHERE kind = ?1 AND path = ?2 ORDER BY ts DESC LIMIT 100`,
        ).bind(MAPPING, path).all()
      : all
      ? await env.DB.prepare(
          `SELECT id, ts, path, anchor, anchor_label, kind, body, status, answered
             FROM requests WHERE kind <> ?1 ORDER BY ts DESC LIMIT 200`,
        ).bind(MAPPING).all()
      : await env.DB.prepare(
          `SELECT id, ts, path, anchor, anchor_label, kind, body, status, answered
             FROM requests WHERE path = ?1 AND kind <> ?2 ORDER BY ts DESC LIMIT 20`,
        ).bind(path, MAPPING).all();
    return json({ requests: rows.results || [] });
  } catch (e) {
    console.error('request get', String(e).slice(0, 160));
    return json({ requests: [] });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  const who = sess ? sess.who : null;
  if (!who) return json({ error: 'sign in first' }, 401);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const kind = clip(b.kind, 16);
  const body = clip(b.body, 4000).trim();
  if (!KINDS.has(kind)) return json({ error: 'bad request' }, 400);
  if (!body) return json({ error: 'Tell us what you need and we will pick it up.' }, 422);

  const row = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    path: clip(b.path, 300) || '/',
    anchor: clip(b.anchor, 200) || null,
    anchor_label: clip(b.anchor_label, 200) || null,
    kind, body, who,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO requests (id, ts, path, anchor, anchor_label, kind, body, who)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(row.id, row.ts, row.path, row.anchor, row.anchor_label, row.kind, row.body, row.who).run();
  } catch (e) {
    console.error('request post', String(e).slice(0, 160));
    return json({ error: 'That did not send. Try again.' }, 503);
  }

  // The email is a notification, not the record: the row above is the record,
  // so a mail failure never loses what the client wrote.
  //
  // A mapping note gets no email. It was written by us, in staff view, about
  // our own wiring, and it is already going where it belongs:
  // scripts/pull-mapping-notes.mjs appends it to wires/EDITOR-DECISIONS.md.
  // Mailing Eric a copy of a note Eric just wrote is the digest he keeps
  // telling us not to send.
  if (env.RESEND_API_KEY && kind !== MAPPING) {
    const to = env.RP_NOTIFY || 'eric@electromagneticweb.com';
    const site = env.RP_SITE || 'site';
    const where = row.anchor_label ? `${row.anchor_label} — ${row.path}` : row.path;
    waitUntil(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'Remodeler Pilot <notifications@remodelerpilot.com>',
        to: [to],
        reply_to: to,
        subject: `${site}: ${row.who} asked about ${row.anchor_label || row.path}`,
        text: `${row.who} sent this from ${where}\n\n${row.body}\n\n—\nPage: https://${site === 'fourlakes' ? 'rp-test-site.pages.dev' : site}${row.path}\nRequest ${row.id}`,
      }),
    }).catch((e) => console.error('request mail', String(e).slice(0, 120))));
  }

  // Into the Inbox, as a conversation Eric can answer in the one place he reads
  // (Eric 2026-10-05: "have these route to the inbox"). Until now a client's
  // note lived only in this table and an email: the dashboard's Inbox reads
  // support_threads, which nothing here ever wrote to, so item 3 on the build
  // tracker was half built — the client could leave a note and there was nowhere
  // to see it. A mapping note still stays out: it is ours, about our own wiring.
  //
  // waitUntil, and failures are swallowed on purpose: the row above is the
  // record. A dashboard that is down must never cost a client their words.
  if (kind !== MAPPING && env.RP_SERVICE_KEY && (env.RP_DASH || '').startsWith('http')) {
    const where = row.anchor_label ? `${row.anchor_label} — ${row.path}` : row.path;
    waitUntil(
      fetch(`${env.RP_DASH}/api/support`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rp-service-key': env.RP_SERVICE_KEY },
        body: JSON.stringify({
          site: env.RP_SITE || '',
          new: true,
          name: row.who,
          // Whose conversation this is. support's mine() compares a thread's
          // user_id to the signed-in one, so without this the client cannot see
          // their own message when they open the chat in their dashboard.
          uid: sess && sess.uid ? sess.uid : null,
          // Just what they wrote. Where they wrote it travels in `page` and the
          // Inbox puts it on the meta line under the message; appending it to
          // the text made it look like something the client typed.
          text: row.body,
          page: row.path,
          intent: 'website',
        }),
      })
        .then((r) => { if (!r.ok) console.error('request→inbox', r.status); })
        .catch((e) => console.error('request→inbox', String(e).slice(0, 120))),
    );
  }

  return json({ ok: true, id: row.id, ts: row.ts, status: 'queued' });
};

// The client's own view of a request they sent. They can say it is handled, or
// that they have changed their mind. Neither touches what we have already done
// about it; it is their list, and a list you cannot close items on is a list
// nobody reads twice (Eric, 2026-09-28).
const CLIENT_STATUS = new Set(['done', 'withdrawn', 'queued']);

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const sess = await readSessionFull(request, env.RP_SERVICE_KEY);
  const who = sess ? sess.who : null;
  if (!who) return json({ error: 'sign in first' }, 401);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const id = clip(b.id, 64);
  const status = clip(b.status, 16);
  if (!id || !CLIENT_STATUS.has(status)) return json({ error: 'bad request' }, 400);

  try {
    const r = await env.DB.prepare('UPDATE requests SET status = ?1 WHERE id = ?2')
      .bind(status, id).run();
    if (!r.meta || !r.meta.changes) return json({ error: 'no such request' }, 404);
    return json({ ok: true, id, status });
  } catch (e) {
    console.error('request patch', String(e).slice(0, 160));
    return json({ error: 'That did not save. Try again.' }, 503);
  }
};
