-- Approval is data, not code.
--
-- Until now a section's approval lived in `mappings/*.json`, in git, baked
-- into the build. That made approving a DEPLOY: Eric looks at a section,
-- says go, and nothing happens until somebody pushes. The whole point of the
-- Lightning Session is that he says go and it is so (Eric, 2026-09-30:
-- "at some point, I would just need somewhere to quickly glance at it and
-- say go").
--
-- So the two halves are split along the line they were always on:
--
--   the MAPPING is code    — generated from the markup, reviewed in a diff,
--                            the same for every client running this kit.
--   the APPROVAL is data   — per client, in that client's own D1, because
--                            approving Fourlakes' at-a-glance band says
--                            nothing about anybody else's.
--
-- Keyed by the section's SHAPE, which is a hash of its ordered element
-- shapes as the build publishes them in /rp-approvals.json. A structural
-- change changes the hash, the row stops matching, and the approval lapses
-- by itself — which is RULES §10 enforced by data rather than by whoever
-- remembers to re-run a script.
--
-- One row per section per page: approving twice is the same fact, not two
-- facts, and the latest approval is the only one worth keeping. The history
-- of who approved what is the row itself; if we ever want the trail, it goes
-- in its own table rather than turning this one into a log.
CREATE TABLE IF NOT EXISTS section_approvals (
  page        TEXT NOT NULL,          -- '/about', '/services/kitchens', '/'
  section     TEXT NOT NULL,          -- data-rp-section, or '(undeclared)'
  shape       TEXT NOT NULL,          -- hash of the section's ordered element shapes
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (page, section)
);

-- Elements we have taken back.
--
-- The other half of the same session. Eric can look at a section and find
-- something editable that should not be — a figure, a claim, a name — and
-- locking it has to be immediate and safe, because locking is always safe:
-- the field is still there, still in the schema, still in the allowlist. It
-- simply stops being offered (RULES §1, §9 "a new locked element → auto").
--
-- The reverse is NOT a toggle and deliberately has no table. Making a locked
-- element editable means CREATING the field: an address, an entry in
-- editable.js, a declaration in schema.js, and a round-trip that proves the
-- page reads it back. None of that can be conjured by deleting a row, so a
-- locked element's only offer is "Change this", which becomes a mapping note
-- and then a commit.
--
-- It lives beside approvals rather than in its own migration because it is
-- the same fact from the other side: what this client's site currently hands
-- out. Read together, written by the same endpoint, they are one answer.
CREATE TABLE IF NOT EXISTS element_locks (
  page      TEXT NOT NULL,            -- the page it was locked on
  el        TEXT NOT NULL,            -- the field address, e.g. about.headline
  locked_by TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  PRIMARY KEY (page, el)
);
CREATE INDEX IF NOT EXISTS element_locks_page ON element_locks (page);
