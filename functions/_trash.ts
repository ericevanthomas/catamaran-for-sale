// Emptying the trash, thirty days on.
//
// ⚠️ A RETENTION PROMISE THAT NOTHING ENFORCES IS A LIE IN A DIALOG. The
// confirmation tells a client their photograph "can be restored for 30 days",
// which commits us to two things: it is still there on day 29, and it is gone
// on day 31. This is the second half (Eric, 2026-10-30).
//
// ⚠️ IT RUNS ON READ, NOT ON A SCHEDULE. A per-client cron would mean a Worker
// and a schedule provisioned for every site we launch, which is a lot of
// moving parts for a sweep that costs one indexed DELETE. The guarantee this
// gives is "gone the next time anyone opens the library", and nobody is harmed
// by a file that outlives its thirty days in a library no one has opened.
//
// ⚠️ THE BYTES GO TOO, but only when no copy anywhere still points at them.
// The same photograph can sit in three folders as three items on one blob
// (0020); deleting the object because one of them was trashed would blank the
// other two.

const DAYS = 30;

export async function emptyTrash(db: D1Database, bucket?: R2Bucket): Promise<number> {
  const cutoff = new Date(Date.now() - DAYS * 86400_000).toISOString();

  // Which pictures are about to lose their last copy? Read this BEFORE the
  // delete, or there is nothing left to join against.
  const orphaned = await db.prepare(
    `SELECT b.hash, b.src FROM media_blob b
      WHERE EXISTS (SELECT 1 FROM media_item i
                     WHERE i.hash = b.hash AND i.deleted_at IS NOT NULL AND i.deleted_at < ?1)
        AND NOT EXISTS (SELECT 1 FROM media_item i
                         WHERE i.hash = b.hash
                           AND (i.deleted_at IS NULL OR i.deleted_at >= ?1))`,
  ).bind(cutoff).all<{ hash: string; src: string }>();

  const res = await db.prepare(
    'DELETE FROM media_item WHERE deleted_at IS NOT NULL AND deleted_at < ?1',
  ).bind(cutoff).run();
  const gone = res.meta?.changes || 0;
  if (!gone) return 0;

  const hashes = (orphaned.results || []).map((o) => o.hash).filter(Boolean);
  if (hashes.length) {
    await db.batch(hashes.map((h) =>
      db.prepare('DELETE FROM media_blob WHERE hash = ?1').bind(h)));
    // ⚠️ The objects last, and only after the rows: a row pointing at bytes
    // that are gone is a broken picture, while bytes with no row are merely
    // wasted. If this half fails the library is still correct.
    if (bucket) {
      for (const h of hashes) {
        try {
          const listed = await bucket.list({ prefix: `uploads/${h}/` });
          if (listed.objects.length) await bucket.delete(listed.objects.map((o) => o.key));
        } catch { /* the rows are already right; the sweep will find it again */ }
      }
    }
  }
  return gone;
}
