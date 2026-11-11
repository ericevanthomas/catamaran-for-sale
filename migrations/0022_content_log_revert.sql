-- Which rows in the change log are REVERTS rather than edits.
--
-- ⚠️ A REVERT WAS INDISTINGUISHABLE FROM AN EDIT, and that made "Revert this
-- section" unable to go back more than one step. Stepping back writes the old
-- value, which the server logged as a new change; the next step back then
-- found THAT row as "the change that produced what you are looking at" and
-- undid it — returning the client to exactly what they had just reverted away
-- from. Pressed repeatedly it oscillates between the last two values forever
-- and can never reach the original (Eric, 2026-10-30, with seven rows of his
-- own library proving it).
--
-- The log keeps every row, because an audit trail that hides corrections is
-- not an audit trail. The STEP BACK simply skips its own footprints.

ALTER TABLE content_log ADD COLUMN revert INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_log_field_ts ON content_log (field, ts DESC);
