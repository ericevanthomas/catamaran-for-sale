-- Separate the BYTES from the THING THE CLIENT SEES.
--
-- ⚠️ THE PROBLEM THIS SOLVES. `media` was keyed on src, and `media_in_folder`
-- was (src, folder_id): one row in two folders, which is the same file in two
-- places. A tree stops being a tree when that is allowed — delete it here and
-- it vanishes there, move it here and it moves there — and the client has to
-- remember whether they have uploaded a photograph before (Eric, 2026-10-29).
--
--   media_blob  the picture itself: one row per distinct image, whatever the
--               client does. Holds the master, the rungs, the dimensions, the
--               alt text, and the perceptual hash.
--   media_item  what the client sees in a folder: its own name, ONE folder,
--               its own life. Points at a blob.
--
-- Two items on one blob is two files to the client and one object in R2. A
-- photograph they upload twice costs a row the second time, not 12 MB, and
-- because alt text lives on the BLOB the promise the picker already makes —
-- "it stays with the photo, so you only write it once" — becomes true across
-- every copy.
--
-- ⚠️ PERCEPTUAL HASH, not just sha256. A sha256 catches the same FILE. It does
-- not catch the same photograph re-exported smaller or at another quality,
-- which is what happens when one picture arrives from a phone, then Dropbox,
-- then the photographer. phash is a 64-bit fingerprint of the image as it
-- LOOKS; two near-copies differ in only a few bits. Measured cost at upload:
-- 0.08 ms, against 173 ms already spent decoding and encoding the rungs.

CREATE TABLE IF NOT EXISTS media_blob (
  hash       TEXT PRIMARY KEY,   -- sha256 of the bytes as uploaded
  src        TEXT NOT NULL,      -- the path a page renders: /media/uploads/<hash>/1600.webp
  srcset     TEXT,               -- the rungs
  master     TEXT,               -- the original, kept but never shown
  alt        TEXT,               -- ⚠️ on the BLOB: written once, true everywhere
  width      INTEGER,
  height     INTEGER,
  phash      TEXT,               -- 16 hex chars; 64 bits of what it LOOKS like
  bytes      INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS media_item (
  id         TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,      -- -> media_blob.hash
  name       TEXT,               -- what THIS copy is called
  folder_id  TEXT,               -- ⚠️ exactly one. NULL is Home.
  created_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_item_folder ON media_item (folder_id);
CREATE INDEX IF NOT EXISTS idx_item_hash   ON media_item (hash);
-- ⚠️ Four 16-bit bands over the 64-bit phash. Two images within a few bits of
-- each other must share at least one band exactly, so a near-duplicate lookup
-- is four indexed probes rather than a scan of the library. Not needed at
-- today's sizes; the column shape has to allow it before it is.
CREATE INDEX IF NOT EXISTS idx_blob_phash  ON media_blob (phash);

-- ── carry the existing library across ──────────────────────────────────────
-- Every real photograph becomes a blob. Rungs and removed rows are not
-- photographs and do not. The hash is the directory the src already sits in.
INSERT OR IGNORE INTO media_blob (hash, src, srcset, master, alt, created_at, created_by)
SELECT
  CASE WHEN src LIKE '/media/uploads/%'
       -- ⚠️ 16, not 17: '/media/uploads/' is FIFTEEN characters, so the hash
       -- starts at the sixteenth. 17 silently clipped the first character off
       -- every hash and the dry run caught it.
       THEN substr(src, 16, instr(substr(src, 16), '/') - 1)
       ELSE src END,
  src, srcset, master, alt,
  COALESCE(updated_at, '2026-10-29'), COALESCE(updated_by, 'migration')
FROM media
WHERE rung_of IS NULL AND deleted_at IS NULL;

-- A photograph already in folders becomes ONE ITEM PER FOLDER. This is the
-- heart of it: what used to be one row in three places is now three files.
-- ⚠️ A DETERMINISTIC id, not randomblob. A random one makes OR IGNORE useless:
-- run this twice and every item is duplicated. The carry-across is one item per
-- (photograph, folder), which names itself. Items minted later get random ids,
-- so a client can still keep two copies in one folder if they want to.
INSERT OR IGNORE INTO media_item (id, hash, name, folder_id, created_at, created_by)
SELECT
  'mig-' || b.hash || ':' || f.folder_id,
  b.hash, m.title, f.folder_id,
  COALESCE(f.added_at, '2026-10-29'), COALESCE(f.added_by, 'migration')
FROM media_in_folder f
JOIN media m      ON m.src = f.src AND m.rung_of IS NULL AND m.deleted_at IS NULL
JOIN media_blob b ON b.src = m.src;

-- A photograph in no folder at all gets one item, in Home.
INSERT OR IGNORE INTO media_item (id, hash, name, folder_id, created_at, created_by)
SELECT 'mig-' || b.hash || ':home', b.hash, m.title, NULL,
       COALESCE(m.updated_at, '2026-10-29'), 'migration'
FROM media m
JOIN media_blob b ON b.src = m.src
WHERE m.rung_of IS NULL AND m.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM media_in_folder f WHERE f.src = m.src);

-- ⚠️ `media` and `media_in_folder` ARE LEFT IN PLACE, untouched. A page still
-- renders from a src, section content still points at one, and nothing that
-- reads them breaks today. They stop being the library's source of truth, not
-- the site's. Dropping them is a separate decision taken after this has run in
-- production for a while, and phash is backfilled by the first upload of each
-- picture or by a one-off pass, never guessed here.
