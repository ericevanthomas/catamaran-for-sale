-- 0001_leads.sql — lead capture system of record for the RP lead pipeline.
-- One row per contact-form submission (spam hits included, flagged spam=1 for
-- cheap forensics). D1 binding: DB → rp-fourlakes.
CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,          -- crypto.randomUUID()
  created_at   TEXT NOT NULL,             -- ISO 8601 UTC
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,                       -- nullable
  message      TEXT NOT NULL,
  source_path  TEXT,                       -- the path the form was submitted from
  referrer     TEXT,                       -- nullable (document.referrer / Referer header)
  -- Attribution hidden fields. Static site: no client JS populates these yet,
  -- so they will be null until a UTM/gclid capture layer is added. Columns
  -- exist now so the schema does not have to migrate later.
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  gclid        TEXT,
  status       TEXT NOT NULL DEFAULT 'new',
  emailed      INTEGER NOT NULL DEFAULT 0, -- 1 once the email adapter succeeds
  crm_synced   INTEGER NOT NULL DEFAULT 0, -- reserved for the future CRM adapter
  spam         INTEGER NOT NULL DEFAULT 0  -- 1 = failed honeypot/time-trap
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_spam ON leads (spam);
