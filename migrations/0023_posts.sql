-- The client's own published records: blog posts.
--
-- ⚠️ WHY THIS IS IN THE KIT AND NOT IN ONE SITE'S REPO. The composer in
-- public/rp-edit.js has called /api/post since it was written, and that
-- endpoint existed in exactly one repository — electromagneticweb. So on every
-- site built from this kit a client could write a post, press Save, and get a
-- 405: a writing surface with no store behind it (Eric found it by typing one,
-- 2026-11-11). A blog is platform, not per-site work: "content, files and
-- styles are unique to each client, everything else is our platform."
--
-- Ported from electromagneticweb/migrations/0002_posts.sql, which is the proven
-- shape, and the reasoning below is that file's, kept because it is still the
-- reasoning. What changed on the way in is named at the bottom.
--
-- 0010 gave the fixed pages a per-FIELD override table, because there the
-- config is the content and D1 holds only the difference. This is the other
-- shape: here D1 holds the RECORD. A blog post is not a diff against anything,
-- it is a thing with a publication date, a status and a body, and it has to be
-- queryable as one — "the newest ten published posts" is a question the
-- override table cannot answer.
--
-- Every statement is IF NOT EXISTS, and for a sharper reason than tidiness:
-- these run against LIVE databases that the dashboard also reads. A migration
-- here must be incapable of disturbing a table it did not create. `rp-emw`
-- already holds `posts` and `posts_log` from the EMW original, so this file
-- must be a no-op there and is.

-- ── posts ──────────────────────────────────────────────────────────────────
-- One row per entry, keyed by the collection it belongs to.
--
-- ONE TABLE, NOT ONE PER COLLECTION. Each collection differs in its trimmings
-- but agrees on its spine: a thing with a slug, a status, a headline, a date
-- and a body. `collection` carries the difference and the primary key makes a
-- slug unique WITHIN a collection, which is the real rule — /blog/pricing and
-- a portfolio item called "pricing" do not collide, because they are not the
-- same kind of thing.
--
-- The typed columns are exactly what something queries, sorts, filters or
-- emits as structured data. Everything else lives in `extra`; see the note at
-- the bottom.
CREATE TABLE IF NOT EXISTS posts (
  -- 'blog' today, and only 'blog' on a kit site: functions/api/post.ts refuses
  -- anything else, because the composer is a markdown editor and the other
  -- collections EMW carries (portfolio, faq, case-studies) are assembled from
  -- fields rather than written as prose. The column stays because the primary
  -- key is the rule, not the single value it currently holds.
  collection   TEXT NOT NULL,
  -- The URL segment. For a blog post this IS the public path: /blog/<slug>,
  -- which is what the composer's own address field already promises.
  slug         TEXT NOT NULL,

  -- Drafts never reach the build. scripts/pull-posts.mjs selects published rows
  -- only, so an unfinished post cannot leak into dist OR into the committed
  -- artifact in git.
  status       TEXT NOT NULL DEFAULT 'published'
               CHECK (status IN ('draft', 'published')),

  -- schema.org `headline`. The one line that names the entry.
  title        TEXT NOT NULL,
  -- schema.org `description`, and the meta description.
  description  TEXT,

  -- The long form, in its own column, never in `extra`. Markdown for a blog
  -- post.
  body         TEXT NOT NULL DEFAULT '',
  -- Whether `body` is markdown to be rendered, or text to be printed as-is.
  -- This column is what stops the next person guessing, and tells the editor
  -- which control to show.
  body_format  TEXT NOT NULL DEFAULT 'markdown'
               CHECK (body_format IN ('markdown', 'plain')),

  -- schema.org `datePublished`, ISO-8601 UTC. Text because SQLite has no date
  -- type and ISO-8601 sorts lexicographically, so ORDER BY on this column is
  -- chronological without a conversion.
  published_at TEXT,
  -- schema.org `dateModified`. NULL means never revised, and it must STAY null
  -- until the WORDS move: inventing one puts a dateModified on a BlogPosting
  -- that has never been modified. This is NOT the row's bookkeeping timestamp;
  -- that is `touched_at`, deliberately a different column so filing a post
  -- under a new category cannot be mistaken for an editorial revision.
  updated_at   TEXT,

  -- schema.org `author`. A BlogPosting needs a real author, and a second
  -- author is a row rather than a template edit.
  author       TEXT,

  -- schema.org `image`, as a site-root path — which on a kit site means an
  -- /media/... path served by functions/media/[[path]].ts out of this client's
  -- own R2 bucket. The composer's picker writes exactly that.
  image        TEXT,
  image_alt    TEXT,

  -- schema.org `articleSection`. Also the obvious first facet for a blog
  -- filter, which is why it is a column and not a tag in `extra`.
  category     TEXT,

  -- Manual ordering, for collections that have it. NULL for anything ordered
  -- by date, which is every blog post.
  sort_order   INTEGER,

  -- The collection's own shape, as JSON. See the note at the bottom.
  extra        TEXT NOT NULL DEFAULT '{}',

  -- Who last wrote this row: 'editor' once a human has saved it in the
  -- composer, 'markdown' if a migration seeded it from a repo. A re-seed skips
  -- anything that is not 'markdown', so it cannot silently undo an edit.
  origin       TEXT NOT NULL DEFAULT 'editor',

  created_at   TEXT NOT NULL,
  touched_at   TEXT NOT NULL,
  touched_by   TEXT,

  PRIMARY KEY (collection, slug)
);

-- "The published posts, newest first" — the blog index, and every future
-- paginated view.
CREATE INDEX IF NOT EXISTS posts_feed
  ON posts (collection, status, published_at DESC);

-- "The published entries, in the order somebody put them in", for a collection
-- ordered by hand rather than by date.
CREATE INDEX IF NOT EXISTS posts_ordered
  ON posts (collection, status, sort_order);

-- ── posts_log ──────────────────────────────────────────────────────────────
-- Every write, kept, for the same reason content_log exists in 0010: "always,
-- always able to revert." `before` and `after` are whole rows as JSON rather
-- than single fields, because unlike a page override the unit of change here
-- IS the record — you publish a post, you do not publish a column.
CREATE TABLE IF NOT EXISTS posts_log (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  collection TEXT NOT NULL,
  slug       TEXT NOT NULL,
  -- 'create' | 'update' | 'publish' | 'unpublish' | 'delete' | 'migrate'
  action     TEXT NOT NULL,
  before     TEXT,
  after      TEXT,
  who        TEXT
);
CREATE INDEX IF NOT EXISTS posts_log_ts ON posts_log (ts DESC);
CREATE INDEX IF NOT EXISTS posts_log_entry ON posts_log (collection, slug, ts DESC);

-- ── what is in `extra`, and why it is not normalised ───────────────────────
--
-- Nothing, for a blog post on a kit site. The column exists because EMW's
-- other three collections use it (a portfolio item's url, an FAQ's tags, a case
-- study's stats and gallery) and because this table is the SAME table there:
-- dropping the column would fork the schema between two tenants of one fleet,
-- which is the thing this port exists to stop.
--
-- The test applied before anything earns a typed column: does something SELECT,
-- ORDER BY or WHERE on it? What did NOT go in `extra`, though it could have:
-- author, image, category, published_at. Those are schema.org fields, and a
-- BlogPosting that cannot be assembled with a plain SELECT is a BlogPosting
-- nobody will keep correct.
--
-- ── what changed coming from EMW (2026-11-11) ─────────────────────────────
-- · `origin` defaults to 'editor' rather than 'cli'. There is no posts CLI on a
--   kit site; the composer is the only way a row gets here, so the default
--   names the thing that actually writes.
-- · The collection comment names 'blog' alone, because the endpoint enforces
--   it. The other three collections are EMW's markdown history and no client
--   site has them.
-- · 0002 → 0023, the next free number in this repo. The content is otherwise
--   the EMW table column for column, so `rp-emw` needs no change to be read by
--   the kit's own endpoint and loader.
