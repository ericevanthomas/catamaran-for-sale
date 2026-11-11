-- The photo library: one row per file, not per place it is used.
--
-- A description describes the photograph, so it belongs to the photograph. It
-- lived on the placement instead (site.config.js wrote `{ src, alt }` at every
-- callsite), which meant swapping a hero photo left the previous photo's
-- description sitting under the new one — telling a screen reader about a
-- kitchen while showing a house at dusk. Caught by Eric, 2026-09-25.
--
-- With this table the swap carries the new photo's own words, and the client is
-- asked to write a description only when the file genuinely has none.
CREATE TABLE IF NOT EXISTS media (
  src        TEXT PRIMARY KEY,   -- /images/hero.webp
  alt        TEXT,               -- what the photograph shows
  title      TEXT,               -- what the picker calls it
  updated_at TEXT,
  updated_by TEXT
);
