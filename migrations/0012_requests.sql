-- What the client asks for, pinned to the thing they were looking at.
--
-- The pressure valve in the 2026-07-13 spec: anything that is not "edit what
-- you see" or "add another of these" becomes a request instead of a
-- half-finished self-service feature. A request carries its context — the page,
-- and the section or element it was sent from — so nobody has to ask "where?".
--
-- Status is the client's view of it, and they see it in the same place they
-- sent it: queued → in progress → done.
CREATE TABLE IF NOT EXISTS requests (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  path       TEXT NOT NULL,          -- the page it came from
  anchor     TEXT,                   -- section slot, list name or field address
  anchor_label TEXT,                 -- what the client would call it
  kind       TEXT NOT NULL,          -- 'note' | 'change' | 'exclude'
  body       TEXT NOT NULL,
  who        TEXT,
  status     TEXT NOT NULL DEFAULT 'queued',
  answered   TEXT
);
CREATE INDEX IF NOT EXISTS requests_ts ON requests (ts DESC);
CREATE INDEX IF NOT EXISTS requests_path ON requests (path, ts DESC);
