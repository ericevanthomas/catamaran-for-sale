// One definition of "has anything changed", shared by the Worker and the build.
//
// The publisher Worker (publisher/src/index.ts) imports this file, and so do
// scripts/pull-content.mjs and scripts/check-fresh.mjs. That is deliberate and
// it is the whole point: a dirty signal computed two slightly different ways is
// worse than none, because the guard would then either refuse every build or
// wave every build through, and both look like the pipeline working.
//
// ── derived, not bookkept ──────────────────────────────────────────────────
// Nothing here is written for the pipeline's benefit. The three facts come out
// of tables the editor already maintains:
//
//   content.updated_at     the current value of a field, and when it was set
//   content_log.ts         every save that ever happened, append-only
//   media.updated_at       the photo library
//
// content_log is in there for a reason that is easy to miss. A REVERT deletes
// the row from `content` (functions/api/edit.ts), so MAX(content.updated_at)
// can go BACKWARD in time — an edit then an undo would leave the site looking
// older than the build that shipped the edit, and the build would be declared
// current while publishing the wrong thing. content_log only ever grows, so the
// row COUNT is a monotonic clock that no legitimate operation can turn back.
//
//   posts.touched_at       the blog records
//   posts_log.ts           every post write that ever happened, append-only
//
// posts_log is the same clock for records that content_log is for fields:
// functions/api/post.ts logs create, update, publish and unpublish.
//
// The counts are in the key alongside the timestamp because a timestamp alone
// cannot see a deletion that happens to not be the newest row.
//
// ── posts are in the watermark, drafts included (2026-11-11) ──────────────
// Blog posts are written in the composer, so a post save has to reach the live
// site the same way a headline edit does. Until this file counted them it did
// NOT: a client could write and publish a post, the watermark would not move,
// the publisher Worker would see an idle site, and check-fresh.mjs would call a
// build carrying none of it current. The post was in D1 and nothing would ever
// put it on the internet.
//
// `posts` is counted whole rather than filtered to status = 'published', even
// though scripts/pull-posts.mjs publishes only the published rows. Filtering
// would not buy what it looks like it buys: `posts_log` records a draft save
// too, and a log filtered by the CURRENT status of the row it describes is no
// longer a clock — it would shrink when a post was unpublished. So a drafting
// session does trigger builds, each of which ships nothing visible and then
// settles. That is a handful of extra builds in exchange for the one guarantee
// worth having: anything the editor can write moves the watermark.
//
// ⚠️ THE KEY'S SHAPE CHANGED when these two were added, so every artifact and
// every `publish_state.live_watermark` stamped before 2026-11-11 reads as
// stale. That is correct rather than unfortunate — none of them carried posts —
// and one pull and one build settle it permanently.
export const ZERO = { max_ts: null, content_n: 0, media_n: 0, log_n: 0, posts_n: 0, posts_log_n: 0 };

/**
 * The watermark as one comparable string.
 *
 * Opaque on purpose: nobody should parse it. It is only ever compared for
 * equality against the one a build reported carrying, and `publish_state`
 * stores it as text for exactly that reason.
 */
export const wmKey = (w) =>
  `${w?.max_ts || '-'}|c${w?.content_n ?? 0}|m${w?.media_n ?? 0}|l${w?.log_n ?? 0}`
  + `|p${w?.posts_n ?? 0}|pl${w?.posts_log_n ?? 0}`;

/**
 * The three reads, as SQL, one per table.
 *
 * Kept separate rather than folded into one UNION so that a site whose
 * `content` table does not exist yet — a perfectly good state on day one, and
 * the case scripts/pull-content.mjs has always tolerated — still reports a
 * watermark for the tables it does have, instead of the whole query failing and
 * the site reading as "zero edits" when it has twelve photos.
 */
export const SQL = {
  tables: "SELECT name FROM sqlite_master WHERE type = 'table'",
  content: 'SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM content',
  media: 'SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM media',
  log: 'SELECT COUNT(*) AS n, MAX(ts) AS t FROM content_log',
  // `touched_at`, not `updated_at`. migrations/0023_posts.sql keeps them apart
  // on purpose: `updated_at` is schema.org dateModified and is NULL until the
  // words of a published post change, while `touched_at` is the row's own
  // bookkeeping and is NOT NULL. Reading dateModified here would report "no
  // posts have ever changed" on a site whose every post had just been saved.
  posts: 'SELECT COUNT(*) AS n, MAX(touched_at) AS t FROM posts',
  posts_log: 'SELECT COUNT(*) AS n, MAX(ts) AS t FROM posts_log',
};

/**
 * Fold the three per-table answers into one watermark.
 *
 * Takes `{ content, media, log }`, each `{ n, t } | null` (null = that table is
 * not there). ISO 8601 strings compare lexicographically in timestamp order, so
 * the max is a plain string max and needs no Date parsing — which also means a
 * malformed timestamp cannot silently become NaN and win.
 */
export function fold({ content, media, log, posts, posts_log } = {}) {
  const stamps = [content?.t, media?.t, log?.t, posts?.t, posts_log?.t]
    .filter((t) => typeof t === 'string' && t && t !== 'null');
  return {
    max_ts: stamps.length ? stamps.reduce((a, b) => (b > a ? b : a)) : null,
    content_n: content?.n ?? 0,
    media_n: media?.n ?? 0,
    log_n: log?.n ?? 0,
    posts_n: posts?.n ?? 0,
    posts_log_n: posts_log?.n ?? 0,
  };
}
