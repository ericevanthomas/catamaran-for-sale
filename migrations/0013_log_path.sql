-- Where a change was made.
--
-- The log is the whole site, so "Recent changes" lists edits from every page.
-- Without the page, a row about a heading on the guide page looks identical to
-- one about this page's heading, and pressing it shows a version view where
-- nothing appears to move (Eric, 2026-09-28). With it, a row on another page
-- can offer to take you there and land you in that same version.
--
-- Nullable on purpose: rows written before this migration have no page, and a
-- missing page is honest where a guessed one would not be.
ALTER TABLE content_log ADD COLUMN path TEXT;
CREATE INDEX IF NOT EXISTS content_log_path ON content_log (path, ts DESC);
