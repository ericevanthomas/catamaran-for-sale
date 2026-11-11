// The one description of how this site's content and the database's rows line up.
//
// ⚠️ ONE COPY, IMPORTED BY ALL THREE SIDES. scripts/seed-content.mjs writes by
// it, scripts/_assemble.mjs reads by it, and functions/_resolve.ts turns an
// edited address back into a row by it. A mapping that lived in three places
// would let two of them agree on a mistake the third did not share, and the
// symptom of that is a client's change saving into a row nothing renders.
// scripts/check-content-roundtrip.mjs is what proves the three agree: it seeds,
// assembles, and compares the result to src/config/site.seed.json field by field.
//
// Nothing here is tenant-shaped in the PLATFORM sense -- the tables, the column
// names and the id scheme are the same ones the Fourlakes demo uses
// (rp-site-kit/scripts/_content-map.mjs). What is this site's own is WHICH
// sections exist and what they are called, which is exactly the line
// wires/PAGE-COMPOSITION.md draws: sections are per-client, the machinery is not.

// ── where a site-wide fact lives ─────────────────────────────────────────────
//
// One `setting` row per LEAF, not per object: `brand.name`, `nav.items.0.label`,
// `pageCopy.faq.ctaBody`. Per-leaf because that is the unit a client edits and
// the unit a revert has to be able to put back on its own — a whole-object row
// would make "undo that one word" mean "restore six words, five of which I did
// not touch".
//
// ⚠️ An array comes back as an array because its keys are all numbers. That is
// in assemble()'s unflatten, and it is the reason `nav.items.2.label` works at
// all; without it the nav would rebuild as an object with "2" on it and the
// page would render nothing. An EMPTY array therefore cannot be stored, because
// it has no leaves — there are none in this site's settings, and the seeder says
// so out loud if one ever appears.
export const SETTING_ROOTS = ['brand', 'seo', 'contact', 'nav', 'footer', 'copy', 'pageCopy'];

// ── which of a repeated item's keys become real columns ──────────────────────
//
// Anything NOT named here goes to `block.data` as JSON and comes back from it,
// so a key nobody thought about cannot fall out silently. `asset_id` is special:
// it names a row in `asset`, and the item's own description of the photograph
// rides in `body` beside it, because the same photograph honestly needs
// different words in different places (the gallery's alt for
// PXL_20260416_172152808 is not the alt the home page gives it).
export const ITEM_COLUMNS = {
  // the At a Glance table on the home page
  fact: { headline: 'label', body: 'value' },
  // A photograph, plus the words THIS placement wants for it.
  //
  // ⚠️ TWO WAYS TO NAME THE PICTURE, and both are live. `asset_id` is the
  // platform's way and is what an upload through /api/media produces: a row in
  // `asset`, keyed by the content hash of the bytes. The ~160 photographs this
  // site already ships are NOT uploads — they are build outputs under /_img/,
  // keyed by the hash of their source (scripts/optimize-images.mjs) and already
  // content-addressed — so their public path is carried in `data.image`, which
  // is the same fallback the kit's resolver writes for a picture that did not
  // come out of R2. assemble() prefers the asset when there is one, so a client
  // who replaces a photograph with one they uploaded gets the new row and the
  // old path stops being read.
  photo: { asset_id: 'image', body: 'alt' },
  // one of the three full-bleed story rows
  story: { eyebrow: 'eyebrow', headline: 'heading', body: 'body' },
  // a Recent Upgrades card
  point: { headline: 'title', body: 'body' },
  // a Key Equipment tick. A bare string, not an object.
  line: {},
  // a Features page card. Its long-form markdown is a child block (see MD_CHILD).
  feature: { headline: 'title', body: 'description', eyebrow: 'category' },
  // one row of a specifications table
  spec: { headline: 'label', body: 'value' },
  // one section of the equipment inventory, with its own nested list
  equip: { headline: 'heading', body: 'note' },
  // one line of an equipment inventory section. `v` is the exact inner HTML the
  // page already carried, badge spans and entities included, so rendering it
  // back reproduces the list byte for byte.
  equipline: { body: 'v' },
};

// An item kind whose value is a bare string rather than an object.
export const BARE_STRING = new Set(['line']);

// A kind whose long-form markdown lives in a child block of its own, because it
// is a DOCUMENT and `body` is already carrying the card's one-line description.
// Split into paragraphs it would stop being markdown; stored whole it is still
// the thing Astro's own processor renders (src/lib/prose.js).
export const MD_CHILD = { feature: 'body' };

// ── the sections of each page ────────────────────────────────────────────────
//
// One entry per `block` row that is a SECTION. `own` is the site key holding the
// section's own words; `list` is the site key holding its repeated things and
// `item` says what kind they are; `nested` is a list inside each of those (the
// equipment inventory is sixteen sections each with its own list of lines).
//
// The ids are derived, never stored twice: a section is `${page}:${type}`, its
// nth item is `${page}:${type}:${n}`, and that item's mth child is
// `${page}:${type}:${n}:${m}`. All three of seed, assemble and resolve compute
// them the same way from this table, which is what makes an edited address find
// the row it was read from.
// `cols` maps a real column to the key it holds in the section's own object,
// exactly as ITEM_COLUMNS does for a repeated thing. Everything the object has
// that is not named there goes to `block.data`, so a key nobody thought about
// cannot fall out silently. The trio (eyebrow / headline / body) earns real
// columns because nearly every section on the platform has one; what each
// section CALLS them is this site's business, which is why they are named here
// and not renamed in the markup.
export const SECTIONS = [
  // ── the home page ──────────────────────────────────────────────────────────
  { page: 'home', type: 'saleStamp', own: 'saleStamp', cols: { headline: 'title' } },
  { page: 'home', type: 'hero', own: 'hero',
    cols: { eyebrow: 'eyebrow', headline: 'headline', body: 'subheadline', cta_text: 'ctaText', cta_href: 'ctaLink' } },
  { page: 'home', type: 'glance', own: 'glance', cols: {},
    list: 'glance.items', item: 'fact' },
  { page: 'home', type: 'topPhotos', list: 'topPhotos', item: 'photo' },
  { page: 'home', type: 'photosMore', own: 'photosMore', cols: { cta_text: 'label', cta_href: 'href' } },
  { page: 'home', type: 'whyChose', own: 'whyChose',
    cols: { eyebrow: 'eyebrow', headline: 'heading', body: 'body' } },
  { page: 'home', type: 'alternating', list: 'alternatingSections', item: 'story' },
  { page: 'home', type: 'featuresCta', own: 'featuresCta', cols: { cta_text: 'label', cta_href: 'href' } },
  { page: 'home', type: 'upgrades', own: 'upgradesSection',
    cols: { eyebrow: 'eyebrow', headline: 'heading' },
    list: 'upgradesSection.items', item: 'point' },
  { page: 'home', type: 'bottomPhotos', list: 'bottomPhotos', item: 'photo' },
  { page: 'home', type: 'bottomPhotosMore', own: 'bottomPhotosMore', cols: { cta_text: 'label', cta_href: 'href' } },
  { page: 'home', type: 'highlights', own: 'highlights',
    cols: { eyebrow: 'eyebrow', headline: 'heading' },
    list: 'highlights.bullets', item: 'line' },
  { page: 'home', type: 'bottomCta', own: 'bottomCta', cols: { headline: 'headline', body: 'body' } },

  // ── /features ──────────────────────────────────────────────────────────────
  { page: 'features', type: 'cards', list: 'features', item: 'feature' },

  // ── /specs ─────────────────────────────────────────────────────────────────
  { page: 'specs', type: 'table', list: 'specs', item: 'spec' },
  { page: 'specs', type: 'equipment', list: 'equipment', item: 'equip',
    nested: { key: 'items', item: 'equipline' } },

  // ── /gallery ───────────────────────────────────────────────────────────────
  { page: 'gallery', type: 'photos', list: 'gallery', item: 'photo' },

  // ── /faq ───────────────────────────────────────────────────────────────────
  // The section exists as a block so that WHICH questions it shows can be a
  // `block_pick` set hanging off it. The questions themselves are `faq` rows.
  { page: 'faq', type: 'list', pick: 'faq' },

  // ── the three long-form pages ──────────────────────────────────────────────
  // One block each, carrying the markdown that was in src/content/pages/*.md.
  { page: 'about', type: 'prose', md: 'prose.about' },
  { page: 'contact', type: 'prose', md: 'prose.contact' },
  { page: 'transaction', type: 'prose', md: 'prose.transaction' },
];

/** Every column a section or an item may put a value in. */
export const COLUMNS = ['eyebrow', 'headline', 'body', 'cta_text', 'cta_href', 'asset_id'];

// ── the one pool with a table of its own ─────────────────────────────────────
//
// The questions are `faq` rows, because the platform has a `faq` table and a
// question is a record rather than a piece of one page: the same pool answers
// the FAQ page and the FAQPage structured data, and the editor already knows how
// to edit one. Their CATEGORY is a `faq_tag` row, which is how the schema
// already carries a question's tags.
//
// ⚠️ WHICH questions the page shows, and in what order, is `block_pick` on the
// `faq:list` block — a picker over the pool, never a retype
// (rp-site-kit/wires/EDITOR-RULES.md §4.1). It is not the same fact as the pool
// itself: a question can exist and not be on the page.
export const FAQ_BLOCK = 'faq:list';

/** The block id for a section, its nth item, or that item's mth child. */
export const blockId = (page, type, i, j) =>
  `${page}:${type}` + (i === undefined ? '' : `:${i}`) + (j === undefined ? '' : `:${j}`);

/** Flatten an object to one entry per scalar leaf: ['a.b.0.c', value]. */
export function leaves(value, prefix = '', out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out.push([prefix, value]);
  return out;
}

/**
 * The inverse: one entry per leaf back into nested objects and arrays.
 *
 * ⚠️ AN OBJECT WHOSE KEYS ARE ALL NUMBERS BECOMES AN ARRAY. The kit's assembler
 * does not do this and does not need to, because nothing in its settings is a
 * list. Everything on this site's nav, footer and jump bars is, so without it
 * `nav.items.0.label` would rebuild as `{ items: { '0': … } }` and `.map()`
 * would throw at build time rather than render the wrong thing — which is at
 * least the good failure, but it is still a failure.
 */
export function unflatten(pairs) {
  const root = {};
  for (const [path, value] of pairs) {
    const parts = String(path).split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cur[parts[i]] ||= {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  const fix = (node) => {
    if (node === null || typeof node !== 'object') return node;
    const keys = Object.keys(node);
    for (const k of keys) node[k] = fix(node[k]);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return keys.map(Number).sort((a, b) => a - b).map((n) => node[String(n)]);
    }
    return node;
  };
  return fix(root);
}

/** Read a dotted path out of an object. */
export function readPath(obj, path) {
  return String(path).split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}

/** Write a dotted path into an object, creating arrays for numeric segments. */
export function writePath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}
