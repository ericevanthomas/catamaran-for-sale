// Serving what the client uploaded, out of the client's own bucket.
//
// Public on purpose: these are photos on a public website. The guard that
// matters is on the way IN (/api/media needs a session). On the way out the
// only rules are that a request can never name a key outside `uploads/`, and
// can never reach a MASTER — the untouched original is our archive, not a
// 40MB file anybody can pull off the site.
interface MediaEnv { MEDIA?: R2Bucket }

// A photo is a folder: `uploads/<hash>/<width>.<codec>`. The name is the
// sha256 of the delivery bytes, so this pattern is exact rather than
// permissive. It has to agree with the one in src/config/editable.js, or a
// photo saves and then will not serve (2026-09-30).
const OK = /^uploads\/[a-f0-9]{32}\/\d{2,4}\.(webp|avif|jpg|png|gif|svg)$/;

export const onRequestGet: PagesFunction<MediaEnv> = async ({ params, env, request }) => {
  if (!env.MEDIA) return new Response('Not found', { status: 404 });
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const key = parts.filter(Boolean).join('/');
  if (!OK.test(key)) return new Response('Not found', { status: 404 });

  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // ⚠️ SVG IS A DOCUMENT, NOT JUST A PICTURE. It can carry <script>, and this
  // is the SAME ORIGIN as the site, so one hostile file navigated to directly
  // would run with the client's session. It was excluded from OK for exactly
  // that reason, and a logo is a poor excuse to simply widen the pattern
  // (2026-10-30). Inside an <img> it can never execute; the risk is a direct
  // visit, which these two headers close:
  //   CSP default-src 'none'  — nothing inside it may load or run
  //   nosniff                 — the browser may not decide it is something else
  if (/\.svg$/.test(key)) {
    headers.set('content-type', 'image/svg+xml');
    headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
  headers.set('x-content-type-options', 'nosniff');
  // The folder is named for the bytes, so this object can never change.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (request.headers.get('if-none-match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { headers });
};
