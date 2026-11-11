-- The debounce, and nothing else.
--
-- Everything the pipeline needs to know about this client's EDITS is already
-- recorded: `content` holds the current value of every field, `content_log`
-- holds every save that ever happened, `media` holds the photos. Between them
-- they answer "what does this site say" and "when did it last change", so
-- publisher/ derives its dirty signal straight out of those three tables and
-- invents no bookkeeping to do it (see scripts/_watermark.mjs).
--
-- What has actually been PUBLISHED is not recorded here either, on purpose. The
-- build stamps the watermark it carried into dist/rp-build.json, so the live
-- site states what it is serving and the Worker reads it from the live site on
-- every tick. That is ground truth rather than a report: a build that compiled
-- and then failed to deploy cannot mark the site current, because the thing
-- being asked is "what is on the internet", not "what did a build say it did".
--
-- So one fact is left, and it is the only one with nowhere else to live: WE
-- ALREADY ASKED. Without it the Worker would post the deploy hook on every tick
-- for the whole duration of a build, because the live site does not catch up
-- for a minute or two. One row, which is a position and not a history.
CREATE TABLE IF NOT EXISTS publish_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  triggered_watermark TEXT,   -- the watermark we last asked Pages to build
  triggered_at        TEXT,   -- ISO 8601 UTC, when we asked
  live_watermark      TEXT,   -- what the last tick saw on the live site
  live_seen_at        TEXT,   -- ISO 8601 UTC, when it looked
  last_tick_at        TEXT,   -- the last time the Worker ran at all
  last_note           TEXT    -- what it decided, in words, for /status
);

INSERT OR IGNORE INTO publish_state (id) VALUES (1);
