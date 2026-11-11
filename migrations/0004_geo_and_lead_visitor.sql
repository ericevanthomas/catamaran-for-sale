-- 0004_geo_and_lead_visitor.sql — approximate geography on visits, and the
-- link that lets a lead be traced back to the visitor who left it.
--
-- SHARED DATABASE. rp-fourlakes is the same D1 this kit writes leads to and the
-- rp-dashboard project reads from, so this file is a verbatim copy of
-- rp-dashboard/migrations/0004. It has ALREADY BEEN APPLIED there — do not run
-- it again against rp-fourlakes. It lives here so this repo's schema history is
-- readable on its own; `leads.visitor_id` is the column functions/api/lead.ts
-- writes, and the visits columns belong to the dashboard's collector.
--
-- Additive only: four new nullable columns, nothing existing is touched.
-- Applied to every rp-{slug} D1 so the schema stays identical across tenants.
--
-- WHY GEO ON THE SERVER. Cloudflare already knows roughly where a request came
-- from (request.cf), so the collector can record it without the page doing any
-- work: no IP lookup, no third-party script, no extra bytes in t.js. It is
-- city-level and approximate by construction — good enough for "a visitor from
-- Madison", never precise enough to be a location.
--
-- WHY visitor_id ON leads. The Live View has to be able to say "this person
-- has already become a customer" without knowing who they are. The form posts
-- back the same anonymous localStorage id the tracker minted, so the join is
-- id-to-id; no name, email or phone is involved in the match.

ALTER TABLE visits ADD COLUMN country TEXT;   -- ISO-3166-1 alpha-2, e.g. 'US'
ALTER TABLE visits ADD COLUMN region  TEXT;   -- state / province name, e.g. 'Wisconsin'
ALTER TABLE visits ADD COLUMN city    TEXT;   -- nearest city Cloudflare reports

ALTER TABLE leads ADD COLUMN visitor_id TEXT; -- matches visits.visitor_id; null on older rows

CREATE INDEX IF NOT EXISTS idx_leads_visitor_id ON leads (visitor_id);
