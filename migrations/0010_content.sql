-- Client edits to the site's own content.
--
-- One row per field. `field` is the address the components already emit
-- (`hero.headline`, `services.2.blurb`), so a row here is a direct override of
-- the same path in site.config.js. The build merges these over the config, so
-- the config stays the starting point and this table holds what the client
-- changed — never a second copy of the whole site.
CREATE TABLE IF NOT EXISTS content (
  field      TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Every save, kept. Eric, 2026-07-13: "always, always able to revert." A revert
-- is the inverse edit, written as a new row, so history is only ever appended
-- and an undo is itself undoable.
CREATE TABLE IF NOT EXISTS content_log (
  id     TEXT PRIMARY KEY,
  ts     TEXT NOT NULL,
  field  TEXT NOT NULL,
  before TEXT,
  after  TEXT,
  who    TEXT
);
CREATE INDEX IF NOT EXISTS content_log_ts ON content_log (ts DESC);
