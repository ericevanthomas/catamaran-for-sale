-- When a photograph was last touched, so "recently updated" can mean it.
--
-- ⚠️ `created_at` IS NOT `updated_at`. The landing's two sections both claim to
-- show what changed recently, and both had only a creation date to sort on —
-- so a photograph renamed this morning ranked below one uploaded last month,
-- and every row carried across by 0020 shared a single timestamp and came out
-- in arbitrary order (Eric, 2026-10-30).
--
-- Set it whenever the CLIENT changes something about the copy: its name, its
-- folder, or the words describing the picture. Not on a read, and not on our
-- own housekeeping.

ALTER TABLE media_item ADD COLUMN updated_at TEXT;
UPDATE media_item SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_updated ON media_item (updated_at);
