// The client's photo library, and the box that takes anything.
//
// GET  → what has been uploaded since the last build, so the picker shows it
//        before a rebuild. The STATIC library (/rp-media.json) still lists
//        everything that shipped with the site; this is only the additions.
// POST → the DELIVERY copy: WebP, made on the client's own device, at the
//        widths the pages actually use. Small, one request, instant.
// POST ?mp=create|part|complete → the MASTER: the untouched original, sent in
//        5MB parts in the background after the client has been told it is
//        done. See docs/MAGIC-BOX.md and the note on `master` in 0016.
//
// ONE BUCKET PER CLIENT, bound as MEDIA (wrangler.toml). There is no tenant id
// in any key and there does not need to be: the binding IS the tenant, so a
// bug in this file cannot address another client's photos.
import { readSession, type EditorEnv } from '../_editor-session';
// ⚠️ THE SEED HAS TO RUN BEFORE THE LIST IS READ. It used to run only inside
// GET /api/folders, which the picker fetches IN PARALLEL with this one: if the
// list was read first, every photograph came back with no folder while the
// folders reported their counts — a project folder showing "Nothing in here
// yet" above a tooltip saying "3 photos" (Eric, 2026-10-29). Running it here
// too makes the order irrelevant: whichever request lands first does the work,
// and this SELECT always runs after it. It costs one indexed lookup thereafter.
import { seedOnce } from './folders';
import { svgRefusal } from '../_svg-gate';

interface MediaEnv extends EditorEnv { MEDIA?: R2Bucket }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const clip = (s: unknown, n: number) => String(s == null ? '' : s).slice(0, n);

// What a browser will actually render, for the DELIVERY copy. The client's
// device has already converted whatever they dropped into WebP by the time it
// gets here, so this list is deliberately narrow. It is not the list of what
// a client may drop: that list is "anything", and it is handled on their
// device (libheif for HEIC, and so on) before this endpoint ever sees it.
const OK_TYPE: Record<string, string> = {
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/avif': 'avif', 'image/gif': 'gif',
};
const MAX_PART = 12 * 1024 * 1024;
const PART = 5 * 1024 * 1024;

// The widths the device sends. 3200 covers a 16-inch MacBook full-bleed at
// 2x; the smaller ones are what actually gets served most of the time. It is
// a superset of the build pipeline's ladder so an uploaded photo behaves like
// one that shipped with the site (scripts/build-image-variants.mjs).
const WIDTHS = [480, 800, 1600, 3200];

// A photo is a FOLDER, not a file: `uploads/<hash>/3200.webp`, and one day
// `uploads/<hash>/3200.avif` beside it. Encoding the codec into a filename
// suffix would have meant renaming every object the first time we adopt a new
// one (2026-09-30).
const isHash = (s: string) => /^[a-f0-9]{32}$/.test(s);

async function hashOf(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// The declared type is a claim; the first bytes are the fact.
function sniff(buf: ArrayBuffer, ext: string) {
  const h = new Uint8Array(buf.slice(0, 12));
  if (ext === 'jpg') return h[0] === 0xff && h[1] === 0xd8;
  if (ext === 'png') return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
  if (ext === 'gif') return h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46;
  if (ext === 'webp') return h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  if (ext === 'avif') return h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70;
  return false;
}

export const onRequestGet: PagesFunction<MediaEnv> = async ({ request, env }) => {
  if (!(await readSession(request, env.RP_SERVICE_KEY))) return json({ error: 'sign in to edit' }, 401);
  try {
    await seedOnce(env.DB, new Date().toISOString()).catch(() => {});
  const r = await env.DB.prepare(
      // Three things the library is NOT allowed to list, and they are three
      // different facts:
      //   rung_of IS NOT NULL  one WIDTH of another photo, never a picture a
      //                        client should be offered (0018). The static half
      //                        filters identically in scripts/_content-source.mjs,
      //                        so the two halves cannot disagree about what a
      //                        photograph is.
      //   deleted_at           removed by a client. The FILE stays: a page
      //                        nobody remembered may still be using it (0019).
      // `folders` rides along so the rail can filter without a round trip.
      // ⚠️ THE LIBRARY IS A LIST OF ITEMS, NOT OF FILES. One photograph in
      // three folders is three rows here and ONE object in R2 — which is what
      // lets a client drop the same picture wherever it belongs without having
      // to remember they already have it (0020). `id` is the item; `hash` is
      // the picture; `src` and `alt` come off the blob because they describe
      // the picture, not the copy.
      // ⚠️ ORDERED BY WHEN IT WAS LAST TOUCHED, not when it was made. The
      // landing calls this "recently updated" and had only a creation date to
      // sort on, so every row carried across by 0020 shared one timestamp and
      // came out in arbitrary order (Eric, 2026-10-30).
      `SELECT i.id, i.name, i.folder_id, COALESCE(i.updated_at, i.created_at) AS updated,
              b.hash, b.src, b.alt, b.srcset, b.master, b.phash, b.width, b.height, b.bytes
         FROM media_item i
         JOIN media_blob b ON b.hash = i.hash
        WHERE i.deleted_at IS NULL
        ORDER BY updated DESC LIMIT 2000`,
    ).all<{ id: string; name: string; folder_id: string | null; updated: string; hash: string;
            src: string; alt: string; srcset: string; master: string; phash: string | null;
            width: number | null; height: number | null; bytes: number | null }>();
    // ⚠️ WHAT THE CLIENT REMOVED, so the STATIC half of the library can be
    // filtered too. /rp-media.json is built at deploy time and knows nothing
    // about a removal, so a photograph that shipped with the site came
    // straight back the moment it was deleted — the API was honouring the
    // deletion and the manifest was overruling it (Eric, 2026-10-30).
    const gone = await env.DB.prepare(
      `SELECT b.src FROM media_blob b
        WHERE EXISTS (SELECT 1 FROM media_item i WHERE i.hash = b.hash AND i.deleted_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM media_item i WHERE i.hash = b.hash AND i.deleted_at IS NULL)
        UNION
       SELECT src FROM media WHERE deleted_at IS NOT NULL`,
    ).all<{ src: string }>().catch(() => ({ results: [] as { src: string }[] }));

    return json({
      removed: (gone.results || []).map((g) => g.src),
      images: (r.results || []).map((m) => ({
        id: m.id, hash: m.hash, updated: m.updated, src: m.src, alt: m.alt || '',
        name: m.name || 'Uploaded', srcset: m.srcset || '',
        master: m.master || 'pending', phash: m.phash || null, uploaded: true,
        width: m.width || null, height: m.height || null, bytes: m.bytes || null,
        // ⚠️ ONE folder. The array is kept so the picker's existing reads do not
        // all have to change at once, but it never holds more than one now:
        // that was the whole bug — the same file in two places.
        folders: m.folder_id ? [m.folder_id] : [],
      })),
    });
  } catch {
    // An empty library is the safe answer: the picker still shows everything
    // that shipped with the site.
    return json({ images: [] });
  }
};

/**
 * ⚠️ PARTS ARRIVE AS PUT, AND PAGES FUNCTIONS DISPATCH BY METHOD. There was no
 * onRequestPut in this file, so every part of every upload was answered 405 by
 * the runtime before a line of our code ran — which is why a dropped folder
 * came back in red with nothing in the logs to explain it (Eric, 2026-10-29).
 * The editor's own master upload posts, so the vault path never showed it.
 */
export const onRequestPut: PagesFunction<MediaEnv> = async (ctx) => onRequestPost(ctx);

// ⚠️ Same reasoning as functions/api/folders.ts: a throw here became an HTML
// 500 and the client was told about a stray character (2026-10-30).
export const onRequestPost: PagesFunction<MediaEnv> = async (ctx) => {
  try {
    return await handleMediaPost(ctx);
  } catch (e) {
    const why = String((e as Error)?.message || e).slice(0, 200);
    console.error('[media] POST threw:', why);
    return json({ error: why }, 500);
  }
};

const handleMediaPost: PagesFunction<MediaEnv> = async ({ request, env }) => {
  const who = await readSession(request, env.RP_SERVICE_KEY);
  if (!who) return json({ error: 'sign in to edit' }, 401);
  if (!env.MEDIA) return json({ error: 'Photo storage is not set up on this site yet.' }, 503);
  const url = new URL(request.url);
  const mp = url.searchParams.get('mp');
  // ⚠️ TWO PROTOCOLS SHARE `mp`, AND THEY ARE NOT THE SAME. master() is the
  // editor's own vault flow: it is handed a photograph's hash up front because
  // the delivery copies already exist, and it stores the untouched original
  // beside them. The magic box knows nothing of any of that — it uploads a file
  // it has just resized, with no hash to give — so every one of its create
  // calls was answered "bad photo" and the whole folder came back in red
  // (Eric, 2026-10-29). The comment in magic-box.js claimed the two addresses
  // "speak the same create/part/complete protocol"; they never did. Four things
  // differed: the hash, `?id=` against `?uploadId=`, `n` against `partNumber`,
  // and a reply with no attachment in it.
  if (mp) {
    const b = request.method === 'POST' ? await request.clone().json().catch(() => ({})) : {};
    // ⚠️ `complete` CARRIES THE KEY IN THE BODY, not the query string — `part`
    // is the one that puts it in the URL. Looking only at the URL meant
    // complete arrived with no key, failed this test, and was handed to the
    // VAULT path, which answered "bad upload" because the key was not one of
    // its own (Eric, 2026-10-30). Look in both places.
    const bodyKey = String((b as { key?: string }).key || '');
    const fromBox = mp === 'create'
      ? !(b as { hash?: string }).hash
      : /^lib\//.test(bodyKey || clip(url.searchParams.get('key'), 160));
    if (fromBox) return libraryUpload(mp, request, env, who);
    return master(mp, request, env, who);
  }
  // Describing, renaming, removing and restoring arrive as JSON, not a form.
  const action = url.searchParams.get('action');
  if (action === 'fromurl') return fromUrl(request, env, who);
  if (action === 'scanpage') return scanPage(request, env, who);
  if (action) return edit(action, request, env, who);

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'bad request' }, 400); }

  // The widths, each one already WebP from the device.
  const sent: { w: number; buf: ArrayBuffer; type: string }[] = [];
  for (const w of WIDTHS) {
    const v = form.get(`w${w}`);
    if (!(v instanceof File) || v.size > MAX_PART) continue;
    const ext = OK_TYPE[v.type];
    if (!ext) continue;
    const buf = await v.arrayBuffer();
    if (!sniff(buf, ext)) continue;
    sent.push({ w, buf, type: v.type });
  }
  if (!sent.length) return json({ error: 'No photo arrived.' }, 422);

  // The biggest one names the photo, so the same picture dropped twice is one
  // folder rather than two.
  sent.sort((a, b) => b.w - a.w);
  const hash = await hashOf(sent[0].buf);
  const dir = `uploads/${hash}`;
  const src = `/media/${dir}/${sent[0].w}.webp`;
  const name = clip(form.get('name') || 'Uploaded', 120);
  const alt = clip(form.get('alt') || '', 500);
  const srcset = sent.map((v) => `/media/${dir}/${v.w}.webp ${v.w}w`).reverse().join(', ');
  // ⚠️ Computed in the BROWSER, off a bitmap it had already decoded to make the
  // rungs. Doing it here would mean decoding the picture a second time for
  // nothing. See dHash in rp-edit.js.
  const phash = clip(form.get('phash') || '', 16) || null;
  const folder = clip(form.get('folder') || '', 64) || null;
  const W = Number(form.get('w')) || null;
  const H = Number(form.get('h')) || null;

  // ⚠️ HAVE WE GOT THESE BYTES ALREADY? The hash IS the identity, so a photo
  // the client uploaded before costs a row, not a transfer, and they never have
  // to remember whether they did (Eric, 2026-10-29).
  const known = await env.DB.prepare('SELECT hash FROM media_blob WHERE hash = ?1')
    .bind(hash).first<{ hash: string }>().catch(() => null);

  try {
    for (const v of sent) {
      await env.MEDIA.put(`${dir}/${v.w}.webp`, v.buf, {
        httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { by: clip(who, 120) },
      });
    }
    const now = new Date().toISOString();
    const itemId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await env.DB.batch([
      // `media` is still written: pages render from a src and sections still
      // point at one. It is no longer the LIBRARY's truth, which is why this
      // is three statements rather than one.
      env.DB.prepare(
        `INSERT INTO media (src, alt, title, srcset, master, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)
         ON CONFLICT(src) DO UPDATE SET title = excluded.title, srcset = excluded.srcset,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).bind(src, alt, name, srcset, now, who),
      // ⚠️ The BLOB carries the alt text, because alt describes the PICTURE.
      // That is what makes the promise the picker already prints — "it stays
      // with the photo, so you only write it once" — true across every copy.
      // An alt already written is never overwritten by a blank one.
      env.DB.prepare(
        `INSERT INTO media_blob (hash, src, srcset, master, alt, width, height, phash, created_at, created_by)
         VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(hash) DO UPDATE SET
           srcset = excluded.srcset,
           alt    = COALESCE(NULLIF(media_blob.alt, ''), excluded.alt),
           phash  = COALESCE(media_blob.phash, excluded.phash),
           width  = COALESCE(media_blob.width, excluded.width),
           height = COALESCE(media_blob.height, excluded.height)`,
      ).bind(hash, src, srcset, alt, W, H, phash, now, who),
      // ⚠️ A NEW ITEM EVERY TIME, even for bytes we already hold. That is the
      // whole point: the client gets a file in the folder they dropped it in,
      // and R2 holds one object however many folders it turns up in.
      env.DB.prepare(
        `INSERT INTO media_item (id, hash, name, folder_id, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(itemId, hash, name, folder, now, who),

          // ⚠️ THE ARRIVAL IS RECORDED SEPARATELY FROM THE PICTURE. `media_blob` is
          // keyed by the hash of the bytes, so the same photograph uploaded twice is
          // deliberately ONE row, and the library therefore cannot answer "when did
          // this arrive, and from where". `upload` is the event: a time, a door, a
          // person. Every door writes one — the Lightning Session and the help desk
          // do too — so a file can never sit in the bucket with nothing knowing it
          // exists (Eric, 2026-11-02).
          //
          // Recorded as already sorted, because this door put it in a folder on
          // purpose: a person chose where it went. The later sorting pass is for the
          // doors that capture without filing.
          env.DB.prepare(
            `INSERT OR IGNORE INTO upload (id, created_at, created_by, came_from, source_ref, r2_key,
                                           original_name, bytes, sha256, stored_at, sorted_at, sorted_to, verdict)
             VALUES (?1, ?2, ?3, 'editor', ?4, ?5, ?6, ?7, ?8, ?2, ?2, ?9, 'filed')`,
            // ⚠️ `sent[0].buf.byteLength`, NOT `bytes`. `bytes` is declared a hundred
            // lines further down in the LARGE-FILE path, so naming it here threw a
            // ReferenceError that took the whole batch with it: an ordinary upload
            // put the object in R2 and wrote NO row, so the photograph vanished from
            // the library and could not be chosen. Added and found the same morning,
            // because Eric could not select a photo he had just uploaded (2026-11-03).
          ).bind(`up_${itemId}`, now, who, 'editor', src, name, sent[0].buf.byteLength, hash, itemId),
    ]);
  } catch (e) {
    console.error('media put', String(e).slice(0, 160));
    return json({ error: 'That did not save. Try again.' }, 503);
  }
  return json({ ok: true, src, alt, name, srcset, hash, phash, uploaded: true, deduped: !!known });
};

/**
 * The magic box's own upload, landing in the client's library.
 *
 * ⚠️ IT SPEAKS THE BOX'S PROTOCOL EXACTLY, because the box is the one that
 * cannot change: create -> {key, uploadId, part}; part -> {partNumber, etag};
 * complete -> {attachment}. Anything else and the chips go red with no
 * explanation, which is what a folder of photographs did on 2026-10-29.
 *
 * ⚠️ The parts land under `lib/` and only move to `uploads/<hash>/` once the
 * whole file is assembled and HASHED, because the hash IS the identity (0020)
 * and we do not know it until we have all the bytes. A photograph the client
 * already owns therefore costs no second object: the copy overwrites itself.
 */
async function libraryUpload(op: string, request: Request, env: MediaEnv, who: string): Promise<Response> {
  const bucket = env.MEDIA!;
  const url = new URL(request.url);

  if (op === 'create') {
    const b = (await request.json().catch(() => ({}))) as { name?: string; type?: string };
    const type = clip(b.type, 80) || 'image/webp';
    if (!/^image\//.test(type)) return json({ error: 'That is not a photo.' }, 415);
    const key = `lib/${crypto.randomUUID().replace(/-/g, '')}`;
    const m = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: type, cacheControl: 'private, max-age=0' },
      customMetadata: { by: clip(who, 120), name: clip(b.name, 200) },
    });
    return json({ ok: true, key, uploadId: m.uploadId, part: PART });
  }

  // ⚠️ `uploadId`, not `id`. The box names it in full and the vault path reads
  // `?id=`; one letter of difference is a part that never uploads.
  // ⚠️ AND IT MOVES: `part` puts key and uploadId in the QUERY STRING, while
  // `complete` posts them in the BODY. Reading only the query string made every
  // completion fail (Eric, 2026-10-30).
  let body: { key?: string; uploadId?: string; parts?: { partNumber?: number; n?: number; etag?: string }[];
              name?: string; type?: string } = {};
  if (op === 'complete') body = (await request.json().catch(() => ({}))) as typeof body;
  const key = clip(body.key || url.searchParams.get('key'), 160);
  const uploadId = clip(body.uploadId || url.searchParams.get('uploadId'), 1024);
  if (!/^lib\/[a-f0-9]{32}$/.test(key) || !/^[A-Za-z0-9_\-=.~]{8,1024}$/.test(uploadId)) {
    return json({ error: 'bad upload' }, 422);
  }

  try {
    if (op === 'part') {
      const n = Number(url.searchParams.get('n'));
      if (!Number.isInteger(n) || n < 1 || n > 10000) return json({ error: 'bad part' }, 422);
      const body = await request.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_PART * 2) return json({ error: 'bad part' }, 413);
      const p = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(n, body);
      // ⚠️ partNumber. The box reads `p.partNumber`; the vault path answers
      // `n`, so every part was recorded as undefined and complete refused them.
      return json({ ok: true, partNumber: n, etag: p.etag });
    }

    if (op === 'complete') {
      const b = body;
      const parts = (b.parts || [])
        .filter((p) => p && p.etag)
        .map((p) => ({ partNumber: Number(p.partNumber ?? p.n), etag: String(p.etag) }));
      if (!parts.length) return json({ error: 'no parts' }, 422);
      await bucket.resumeMultipartUpload(key, uploadId).complete(parts);

      // Assembled: now it can be identified.
      const got = await bucket.get(key);
      if (!got) return json({ error: 'That did not arrive.' }, 503);
      const buf = await got.arrayBuffer();
      const hash = await hashOf(buf);
      const type = got.httpMetadata?.contentType || clip(b.type, 80) || 'image/webp';

      // ⚠️ AN SVG IS A DOCUMENT, so it is read before it is kept. Everything
      // else reaching this point is a WebP the browser re-encoded through a
      // canvas, which cannot carry anything but pixels; an SVG arrives exactly
      // as the client's designer saved it and may contain script, external
      // references or an entity attack. The gate is an ALLOWLIST and refuses
      // anything it does not positively recognise. See functions/_svg-gate.ts
      // for why this refuses rather than cleans (Eric, 2026-10-30).
      if (/^image\/svg\+xml$/i.test(type)) {
        const why = svgRefusal(new TextDecoder().decode(buf));
        if (why) {
          await bucket.delete(key);      // never leave a refused file lying in the bucket
          return json({ error: `We could not add that: ${why}.` }, 422);
        }
      }

      const ext = type === 'image/svg+xml' ? 'svg'
        : type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';
      const dir = `uploads/${hash}`;
      const src = `/media/${dir}/${ext === 'svg' ? '1024' : '3200'}.${ext}`;

      const bytes = buf.byteLength;
      await bucket.put(`${dir}/${ext === 'svg' ? '1024' : '3200'}.${ext}`, buf, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { by: clip(who, 120) },
      });
      await bucket.delete(key);

      const now = new Date().toISOString();
      const name = clip(b.name, 200).replace(/\.[a-z0-9]+$/i, '') || 'Uploaded';
      const itemId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const folder = clip(url.searchParams.get('folder'), 64) || null;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO media (src, alt, title, srcset, master, updated_at, updated_by)
           VALUES (?1, '', ?2, '', 'stored', ?3, ?4)
           ON CONFLICT(src) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        ).bind(src, name, now, who),
        env.DB.prepare(
          `INSERT INTO media_blob (hash, src, srcset, master, alt, bytes, created_at, created_by)
           VALUES (?1, ?2, '', 'stored', '', ?3, ?4, ?5)
           ON CONFLICT(hash) DO UPDATE SET src = excluded.src, bytes = excluded.bytes`,
        ).bind(hash, src, bytes, now, who),
        env.DB.prepare(
          `INSERT INTO media_item (id, hash, name, folder_id, created_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(itemId, hash, name, folder, now, who),
        // ⚠️ THE ARRIVAL. THIS DOOR WROTE NO ROW AND IT IS THE ONLY DOOR THE
        // PICKER USES. The insert existed — a hundred lines up, in the form
        // door — and `npm run check:uploads` asserted media.ts contained one and
        // passed, every time, while the `upload` table sat at ZERO rows across
        // the whole vault. Eight photographs Eric imported from the web on
        // 11-03 were in the library with nothing recording that they had ever
        // arrived. Every byte a client has handed this editor is unlogged
        // (found 2026-11-04).
        //
        // That is the failure mode the inbox rule exists to prevent — "a file
        // in R2 that nothing has a row for is a file nobody can find" — and it
        // is also exactly what Eric calls obfuscation: a gate that proves a
        // string is present in a file rather than that the system does the
        // thing. check-upload-log.mjs now finds every door by its
        // `INSERT INTO media_item` and requires an arrival beside it.
        //
        // `filed`, with sorted_at set, because a person chose the folder on the
        // way in. The sorting pass is for the doors that capture without filing.
        env.DB.prepare(
          `INSERT OR IGNORE INTO upload (id, created_at, created_by, came_from, source_ref, r2_key,
                                         original_name, mime, bytes, sha256,
                                         stored_at, sorted_at, sorted_to, verdict)
           VALUES (?1, ?2, ?3, 'editor', ?4, ?5, ?6, ?7, ?8, ?9, ?2, ?2, ?10, 'filed')`,
        ).bind(`up_${itemId}`, now, who, folder ? `folder ${folder}` : 'photo library',
               src, clip(b.name, 200) || name, type, bytes, hash, itemId),
      ]);

      // ⚠️ `attachment`, which is the only thing the box looks at.
      return json({ ok: true, attachment: { id: itemId, hash, src, srcset: '', alt: '', name, uploaded: true } });
    }

    if (op === 'abort') {
      try { await bucket.resumeMultipartUpload(key, uploadId).abort(); } catch { /* already gone */ }
      return json({ ok: true });
    }
    return json({ error: 'bad op' }, 400);
  } catch (e) {
    console.error('library upload', String(e).slice(0, 160));
    return json({ error: 'That did not save. Try again.' }, 503);
  }
}

// ── the master: the original, in the background, never mentioned ──────────
// Resumable because it has to be. It can be 40MB of a photographer's TIFF on
// a site office's DSL, the client has already been told the photo is on their
// page, and they will close the tab long before this finishes. Parts live in
// R2 for days, the browser keeps the upload id, and the next time they open
// the editor it carries on (docs/MAGIC-BOX.md).
async function master(op: string, request: Request, env: MediaEnv, who: string): Promise<Response> {
  const bucket = env.MEDIA!;
  const url = new URL(request.url);

  if (op === 'create') {
    const b = (await request.json().catch(() => ({}))) as { hash?: string; ext?: string; size?: number };
    const hash = clip(b.hash, 32);
    if (!isHash(hash)) return json({ error: 'bad photo' }, 422);
    // The extension is ours, not theirs: it names the ORIGINAL's format,
    // whatever the client dropped, and it never reaches a filesystem.
    const ext = clip(b.ext, 8).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `uploads/${hash}/master.${ext}`;
    const m = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, max-age=0' },
      customMetadata: { by: clip(who, 120), original: '1' },
    });
    return json({ ok: true, key, uploadId: m.uploadId, part: PART });
  }

  const key = clip(url.searchParams.get('key'), 120);
  // R2 upload ids are long. Clipping this to 200 truncated it into something
  // R2 could not resume, and every part came back 500 (2026-09-30). Validate
  // the SHAPE and leave the length alone.
  const uploadId = clip(url.searchParams.get('id'), 1024);
  if (!/^uploads\/[a-f0-9]{32}\/master\.[a-z0-9]{1,8}$/.test(key)
      || !/^[A-Za-z0-9_\-=.~]{8,1024}$/.test(uploadId)) {
    return json({ error: 'bad upload' }, 422);
  }

  try {
  if (op === 'part') {
    const n = Number(url.searchParams.get('n'));
    if (!Number.isInteger(n) || n < 1 || n > 10000) return json({ error: 'bad part' }, 422);
    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_PART * 2) return json({ error: 'bad part' }, 413);
    const up = bucket.resumeMultipartUpload(key, uploadId);
    const p = await up.uploadPart(n, body);
    return json({ ok: true, n, etag: p.etag });
  }

  if (op === 'complete') {
    const b = (await request.json().catch(() => ({}))) as { parts?: { n: number; etag: string }[] };
    const parts = (b.parts || []).map((p) => ({ partNumber: Number(p.n), etag: String(p.etag) }));
    if (!parts.length) return json({ error: 'no parts' }, 422);
    const up = bucket.resumeMultipartUpload(key, uploadId);
    await up.complete(parts);
    // Only now does this photo count as one we can re-encode later.
    const hash = key.split('/')[1];
    await env.DB.prepare(
      "UPDATE media SET master = 'stored' WHERE src LIKE ?1",
    ).bind(`/media/uploads/${hash}/%`).run();
    return json({ ok: true, key });
  }

  if (op === 'abort') {
    try { await bucket.resumeMultipartUpload(key, uploadId).abort(); } catch { /* already gone */ }
    return json({ ok: true });
  }
  return json({ error: 'bad op' }, 400);
  } catch (e) {
    // The client is never told about any of this, so a bare 500 with an HTML
    // body just makes it silently retry forever. Name it in the log instead.
    console.error('media master ' + op, String(e).slice(0, 200));
    return json({ error: 'master lane failed' }, 503);
  }
}

/**
 * What a client can do to a photograph that is already here.
 *
 *   POST ?action=describe  { src, alt }   the description screen readers and
 *                                        search engines read. The one piece of
 *                                        this library a client is best placed
 *                                        to fill in, and the one we are paid to
 *                                        get right.
 *   POST ?action=rename    { src, name }
 *   POST ?action=remove    { src }        hides it. ⚠️ The file STAYS: a page
 *   POST ?action=restore   { src }        nobody remembered may be using it,
 *                                        and a delete that breaks a live page
 *                                        is not a thing to hand a client
 *                                        without a way back.
 */
export async function edit(action: string, request: Request, env: MediaEnv, who: string): Promise<Response> {
  // ⚠️ THE TYPE HAS TO NAME EVERY FIELD THIS READS. It listed three while the
  // handler read five, so `b.id` — the item being renamed — was invisible to the
  // compiler, and so was anything else that might be misspelt. A body type that
  // omits what the code uses turns the typechecker off for this handler exactly
  // where it would be most useful (2026-11-03).
  const b = (await request.json().catch(() => ({}))) as {
    src?: string; alt?: string; name?: string; id?: string; url?: string;
  };
  const src = String(b.src || '');
  const id = String(b.id || '');

  // ⚠️ ASK FOR WHAT THE ACTION ACTUALLY NEEDS. This demanded a `/media/...` src
  // for EVERY action, including `remove` and `restore` — which are keyed by the
  // ITEM id, because removing one copy must leave the others alone. The details
  // screen happened to send both, so removing one photograph worked; selecting
  // five and sending five ids failed with "which photo?" and no way to tell why
  // (Eric, 2026-11-03: bulk delete, red toast).
  //
  // A field a handler does not use is not a field it may insist on.
  const needsSrc = action === 'describe' || action === 'rename';
  if (needsSrc && !src.startsWith('/media/')) return json({ error: 'which photo?' }, 400);
  if (!needsSrc && !id) return json({ error: 'which photo?' }, 400);
  const now = new Date().toISOString();
  // ⚠️ WHICH TABLE A FIELD BELONGS TO IS THE WHOLE POINT OF 0020. The alt text
  // describes the PICTURE, so it lives on the blob and every copy gets it. The
  // name is what THIS copy is called, so it lives on the item and renaming one
  // copy leaves the other alone. Writing both by `src`, as this did until
  // 2026-10-29, wrote to a table the picker no longer reads — which is why a
  // rename appeared to work and then came back unchanged (Eric).
  if (action === 'describe') {
    const alt = String(b.alt || '').slice(0, 500);
    await env.DB.batch([
      env.DB.prepare('UPDATE media_blob SET alt = ?2 WHERE src = ?1').bind(src, alt),
      // the copy the client was looking at counts as touched
      env.DB.prepare(`UPDATE media_item SET updated_at = ?2
                       WHERE hash = (SELECT hash FROM media_blob WHERE src = ?1)`).bind(src, now),
      // `media` still feeds the rendered page, so it keeps its copy.
      env.DB.prepare('UPDATE media SET alt = ?2, updated_at = ?3, updated_by = ?4 WHERE src = ?1')
        .bind(src, alt, now, who),
    ]);
  } else if (action === 'rename') {
    const name = String(b.name || '').slice(0, 200);
    if (!id) return json({ error: 'which photo?' }, 400);
    const r = await env.DB.prepare('UPDATE media_item SET name = ?2, updated_at = ?3 WHERE id = ?1')
      .bind(id, name, now).run();
    if (!r.meta?.changes) return json({ error: 'no such photo' }, 404);
  } else if (action === 'remove' || action === 'restore') {
    // ⚠️ Removing a COPY, not the picture. The blob and the other copies stay:
    // a page nobody remembered may still be rendering it.
    if (!id) return json({ error: 'which photo?' }, 400);
    await env.DB.prepare('UPDATE media_item SET deleted_at = ?2 WHERE id = ?1')
      .bind(id, action === 'remove' ? now : null).run();
  } else return json({ error: 'unknown action' }, 400);
  return json({ ok: true });
}

/**
 * A photograph that arrives as a web address rather than a file.
 *
 * ⚠️ The URL is fetched BY THE WORKER, so three things are checked before
 * anything is stored: it must be http(s), the response must actually be an
 * image, and it must be under 25 MB. A server that fetches whatever address it
 * is handed is a server that can be pointed at someone's private network.
 */
// ⚠️ ONE PLACE THAT DECIDES WHAT WE MAY FETCH. A server that fetches whatever
// address it is handed is a server that can be pointed at someone's private
// network, and there are now two endpoints doing it — one photograph, and a
// page full of them. Two copies of a security rule is one copy that gets
// forgotten.
function safeUrl(raw: unknown): { u?: URL; error?: string } {
  let u: URL;
  try { u = new URL(String(raw || '')); } catch { return { error: 'That is not a web address.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'That is not a web address.' };
  // Cloudflare will not resolve most of these from a Worker, but saying so here
  // is cheaper than relying on that.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(u.hostname)) {
    return { error: 'That address cannot be reached.' };
  }
  return { u };
}

import { bestOfSrcset, identOf, isSkippable } from './_scan-lib.js';

/**
 * Every photograph on a page, for the client to choose from.
 *
 * ⚠️ THE PLUMBING IS EASY AND THE JUNK IS NOT. A real page is mostly logos,
 * icons, avatars, spacers and tracking pixels — HubSpot's own importer offers
 * 151 images for a page with perhaps twenty photographs on it, and makes no
 * attempt to collapse the duplicates (Eric, 2026-11-03). Most of the work here
 * is deciding what NOT to offer.
 *
 * Three passes at that:
 *   · lazy-loaded images live in `data-src` and friends, not `src`. Read only
 *     `src` and a modern page gives you four icons and nothing else.
 *   · `srcset` carries the same picture at a dozen sizes. We take the LARGEST
 *     candidate and keep one entry.
 *   · the same photograph served at different widths by a CDN is one
 *     photograph. Collapsing those is the thing HubSpot does not do, and it is
 *     the difference between a list somebody can read and one they cannot.
 *
 * What survives is sorted biggest first, because the big ones are the reason
 * anybody is here. Anything genuinely tiny is dropped in the browser, where the
 * real dimensions are known for free.
 */
async function scanPage(request: Request, _env: MediaEnv, _who: string): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { url?: string };
  const guard = safeUrl(b.url);
  if (!guard.u) return json({ error: guard.error }, 400);
  const page = guard.u;

  let r: Response | null = null;
  let why = '';
  try {
    r = await fetch(page.toString(), {
      redirect: 'follow',
      headers: {
        'user-agent': 'RemodelerPilot/1.0 (photo import)',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    why = String((e as Error)?.message || e).slice(0, 120);
  }
  if (!r) return json({ error: `We could not reach that page${why ? ' (' + why + ')' : ''}.` }, 422);
  if (!r.ok) return json({ error: `That page answered ${r.status}, so there was nothing to look through.` }, 422);
  const ctype = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^text\/html|^application\/xhtml/.test(ctype)) {
    return json({ error: `That address is a ${ctype || 'file'}, not a page. Paste a photo's address instead.` }, 422);
  }

  // ⚠️ Absolute, against the page it came from — and the page's own <base> if it
  // declares one, because a relative src on a page with a base is resolved
  // against the base and nothing else.
  let base = page;
  const found: { url: string; w: number; from: string; ident: string }[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null, w: number, from: string) => {
    if (isSkippable(raw)) return;
    const s = String(raw).trim();
    let abs: URL;
    try { abs = new URL(s, base); } catch { return; }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return;
    // ⚠️ THE SAME PHOTOGRAPH AT TEN WIDTHS IS ONE PHOTOGRAPH. A CDN puts the
    // size in the query string, so the PATH is the identity and the query is a
    // rendition of it. Keep the widest one seen.
    const ident = identOf(abs);
    const already = found.findIndex((f) => f.ident === ident);
    if (already > -1) {
      if (w > found[already].w) { found[already].url = abs.toString(); found[already].w = w; }
      return;
    }
    if (seen.has(abs.toString())) return;
    seen.add(abs.toString());
    found.push({ url: abs.toString(), w, from, ident });
  };

  await new HTMLRewriter()
    .on('base', { element(el) { const h = el.getAttribute('href'); if (h) { try { base = new URL(h, page); } catch { /* keep the page */ } } } })
    .on('img', {
      element(el) {
        const set = el.getAttribute('srcset') || el.getAttribute('data-srcset');
        const best = set ? bestOfSrcset(set) : null;
        const attrW = Number(el.getAttribute('width') || 0) || 0;
        // ⚠️ `data-src` AND FRIENDS. A lazy-loaded page keeps the real address
        // out of `src` until it scrolls into view, so reading `src` alone gets a
        // placeholder or a 1px spacer.
        const direct = el.getAttribute('src')
          || el.getAttribute('data-src')
          || el.getAttribute('data-lazy-src')
          || el.getAttribute('data-original');
        if (best && best.w >= attrW) add(best.url, best.w || attrW, 'img');
        else add(direct, attrW, 'img');
        if (best && direct) add(direct, attrW, 'img');
      },
    })
    .on('source', {
      element(el) {
        const set = el.getAttribute('srcset') || el.getAttribute('data-srcset');
        const best = set ? bestOfSrcset(set) : null;
        if (best) add(best.url, best.w, 'source');
      },
    })
    // The one the page itself calls its picture. Usually the best thing on it.
    .on('meta[property="og:image"]', { element(el) { add(el.getAttribute('content'), 2000, 'og'); } })
    .transform(r)
    .arrayBuffer();

  // ⚠️ A CAP, and a sort. Sixty is about where a list somebody is reading stops
  // being a list and starts being a wall; the biggest are what they came for.
  const images = found
    .sort((a, b) => b.w - a.w)
    .slice(0, 60)
    .map((f) => ({ url: f.url, w: f.w || 0 }));

  return json({ ok: true, images, found: found.length, page: page.toString() });
}

async function fromUrl(request: Request, env: MediaEnv, who: string): Promise<Response> {
  if (!env.MEDIA) return json({ error: 'Photo storage is not set up on this site yet.' }, 503);
  const b = (await request.json().catch(() => ({}))) as { url?: string };
  const guard = safeUrl(b.url);
  if (!guard.u) return json({ error: guard.error }, 400);
  const u = guard.u;

    // ⚠️ SAY WHICH THING WENT WRONG. A fetch that THREW and a page that answered
    // 404 produced the same sentence — "That address did not give us a photo" —
    // so a direct link to a real .jpg that opens in any browser gave an error
    // naming nothing, and there was no telling a blocked request from a dead
    // link (Eric, 2026-11-03).
    //
    // ⚠️ A User-Agent and an Accept, because plenty of CDNs refuse a request
    // carrying neither and a Worker sends neither by default. A plain client
    // name, never anybody's address.
    let r: Response | null = null;
    let why = '';
    // ⚠️ ONE REQUEST, AND ONE RETRY FOR A TRANSIENT FAILURE. This briefly asked
    // three different ways — our name, no headers, a browser's headers — built
    // on the theory that the host objected to the SHAPE of our request. It did
    // not. The address we sent had been CUT TO SIXTY CHARACTERS by a hard-coded
    // maxlength on the dialog, so we were asking for a file that does not exist
    // and the 404 was correct (Eric, 2026-11-03). The ladder was complexity
    // compensating for a bug somewhere else, and it is gone now that the bug is.
    //
    // A User-Agent and an Accept, because a Worker sends neither by default and
    // plenty of CDNs refuse a request carrying neither. A plain client name,
    // never anybody's address. The retry is for a host building a size it has
    // not made before — the first request for a `?width=1240` variant is the
    // slow one — and never for a 4xx, which is an answer rather than an accident.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((res) => setTimeout(res, 900));
      try {
        r = await fetch(u.toString(), {
          redirect: 'follow',
          headers: { 'user-agent': 'RemodelerPilot/1.0 (photo import)', accept: 'image/*,*/*;q=0.8' },
          signal: AbortSignal.timeout(20000),
        });
        why = '';
      } catch (e) {
        r = null;
        why = String((e as Error)?.message || e).slice(0, 120);
      }
      if (r && (r.ok || r.status < 500)) break;
    }
    if (!r) {
      console.error('fromurl fetch failed', u.hostname, why);
      return json({ error: `We could not reach that address${why ? ' (' + why + ')' : ''}.` }, 422);
    }
    if (!r.ok) {
      // ⚠️ SAY THAT WE ALREADY TRIED MORE THAN ONCE. "That address answered 400"
      // reads as one unlucky request worth repeating; after three request shapes
      // over two passes, repeating it is the one thing that will not help, and
      // the client needs to know to fetch the file themselves instead.
      console.error('fromurl status', r.status, 'asked for:', u.toString(), 'landed on:', r.url);
      // ⚠️ A 404 IS AN ANSWER ABOUT THE ADDRESS, so the address is the thing
      // worth showing. A link that returns a photograph in the client's own
      // browser came back 404 to us (Eric, 2026-11-03), which can only mean the
      // address we asked for is not the one they pasted — or that this host
      // answers us differently from a browser. Printing what we actually
      // requested tells those apart in one look, instead of another round of
      // guessing. `asked` is the URL after parsing; `landed` is where any
      // redirect took it.
      const asked = u.toString();
      const landed = r.url && r.url !== asked ? r.url : '';
      return json({
        error: `That site answered ${r.status} and would not hand the photo over. `
             + `Save it to your computer and drop it in here instead.`
             + `\n\nWe asked for: ${asked}`
             + (landed ? `\nIt sent us to: ${landed}` : ''),
        asked,
        landed,
      }, 422);
    }
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//.test(type)) {
      return json({ error: `That address gave us ${type || 'something'}, not a photo.` }, 422);
    }
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 25 * 1024 * 1024) return json({ error: 'That photo is too large.' }, 413);

  // ⚠️ WE HAND THE BYTES BACK; WE DO NOT FILE THEM. This used to store the photo
  // itself and write its own library rows — a SECOND way into the library,
  // beside the one every dropped file uses, and it skipped everything that one
  // does. No resizing, no delivery copies: it saved the original at
  // `uploads/<hash>/original.jpg` and recorded THAT as the photograph's address.
  //
  // Which can never be served. `functions/media/[[path]].ts` serves
  // `uploads/<hash>/<width>.<codec>` and refuses a master on purpose — "the
  // untouched original is our archive, not a 40MB file anybody can pull off the
  // site". So the import wrote a row whose address 404s by design: the tile
  // appeared with a dead picture in it, which from the client's side is "it said
  // it was adding the photo, but it never appeared in the drawer" (Eric,
  // 2026-11-03).
  //
  // So this endpoint now does the ONE thing the browser cannot do for itself —
  // fetch across origins — and hands the bytes straight back. The editor turns
  // them into a File and drops it into the same intake as any other photograph:
  // resized in the browser, delivery copies uploaded, one row written by the one
  // piece of code that knows how. A photograph that arrives by address is just a
  // file that arrived by address.
  const name = decodeURIComponent(u.pathname.split('/').pop() || 'Photo').slice(0, 120) || 'Photo';
  return new Response(buf, {
    headers: {
      'content-type': type,
      'content-length': String(buf.byteLength),
      'x-rp-name': encodeURIComponent(name),
      'cache-control': 'no-store',
    },
  });
}

