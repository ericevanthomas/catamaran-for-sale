-- Folders for the photo library, and the soft delete that makes "remove" safe.
--
-- ── the shape, and why it is this shape ───────────────────────────────────
-- PROJECT folders are NOT stored here. A project already owns its pictures
-- through its own `cover` and `gallery` fields, so a `media_folder` row per
-- project would be a second copy of that fact, free to drift from the first.
-- They are derived when the library is read. The spine costs nothing to keep.
--
-- CUSTOM folders ("Kitchens", "Before shots") have nowhere else to live, so
-- they live here, and membership is many-to-many on purpose: one photograph
-- belongs in a project AND in Kitchens without being stored twice.
--
-- ⚠️ THERE IS ONLY EVER ONE COPY OF A PICTURE. Uploads are content-addressed
-- (SHA-256 of the bytes, functions/api/media.ts hashOf), so the same photo
-- dropped into a project today and into Kitchens tomorrow resolves to the same
-- `uploads/<hash>/` folder and the same `media` row. Two rows land in
-- media_in_folder; nothing is duplicated in R2 or in the library.

CREATE TABLE IF NOT EXISTS media_folder (
  id         TEXT PRIMARY KEY,         -- slug, minted from the name
  name       TEXT NOT NULL,
  parent_id  TEXT,                     -- a tree; NULL is top level
  ord        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT                      -- folders are retired, never dropped
);

CREATE TABLE IF NOT EXISTS media_in_folder (
  src       TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  added_at  TEXT NOT NULL,
  added_by  TEXT,
  PRIMARY KEY (src, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_mif_folder ON media_in_folder (folder_id);

-- Removing a picture hides it; it does not take the file away. A photo can be
-- referenced by a page that nobody remembered, and "delete" that breaks a live
-- page is not a thing to offer a client without a way back.
ALTER TABLE media ADD COLUMN deleted_at TEXT;
