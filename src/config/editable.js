// What may be edited on this site, and nothing else.
//
// This is the allowlist, not a description of the page. A field absent from
// here cannot be edited, cannot be saved, and gets no handle in the editor —
// functions/api/edit.ts checks this same table, so a crafted request is refused
// by the same rule the UI follows.
//
// Graded against wires/EDITOR-RULES.md in ~/Sites/rp-site-kit. What is LOCKED
// here, and why, is written down in mappings/ beside the markup it belongs to.
// Locked is the default and needs no entry: an unmapped element still hovers,
// still opens a Custom edit drawer, and is never dead.
//
// ⚠️ WHAT IS LOCKED ON A BOAT LISTING, AND WHY IT IS NOT A STYLE CHOICE.
// Three kinds of thing have no entry below:
//
//   1. Destinations. Every `href` on this site points at a route this
//      repository builds (`/specs/`, `#dc-electrical`). A typo in one is a link
//      to a 404 that nothing would catch until a visitor found it, so labels
//      are editable and their destinations are not.
//   2. The structured data under `seo.product`. It is the machine-readable copy
//      of the specifications, read by crawlers rather than people, and it has
//      to agree with the specs table. Two editable copies of one fact is how
//      they come to disagree.
//   3. The six home-page photographs that are `import`s in index.astro. Their
//      ALT TEXT is editable; the file is not, because they go through Astro's
//      own image service and swapping one is a build. The mapping says so in
//      the drawer rather than leaving a dead element.
//
// `kind`  text  —one line, no returns
//         rich  —a paragraph; returns become paragraphs
//         link  —{ text, href }: words plus a destination
//         image —{ src, alt }: one of this site's own pictures
//         list  —a whole array: what reordering and adding a card write
//         ids   —a set of record ids in an order: a picker over a pool
// `max`   characters, or for a list the number of items.
//
// A `*` matches one segment, so `specs.*.value` covers every row and keeps
// working when one is added.

export const EDITABLE = {
  // ── the bar at the top ────────────────────────────────────────────────────
  // The LABELS are copy. `nav.items` itself is absent, so adding or removing a
  // link is a build: each href is a route, and a nav entry pointing nowhere is
  // worse than a nav entry nobody wanted.
  'nav.items.*.label':              { kind: 'text', max: 20,   label: 'Link' },
  'nav.ctaLabel':                   { kind: 'text', max: 20,   label: 'Button' },

  // ── the bar at the bottom ─────────────────────────────────────────────────
  'brand.footerLogo':               { kind: 'text', max: 24,   label: 'Name' },
  'brand.footerTaglineLines.*':     { kind: 'text', max: 40,   label: 'Line' },
  'footer.contactHeading':          { kind: 'text', max: 24,   label: 'Heading' },
  'footer.contactLinks.*.label':    { kind: 'text', max: 40,   label: 'Link' },
  'footer.resourcesHeading':        { kind: 'text', max: 24,   label: 'Heading' },
  'footer.resourceLinks.*.label':   { kind: 'text', max: 40,   label: 'Link' },
  // ⚠️ The one paragraph on this site with legal weight: the owners' statement
  // about the accuracy of the specifications. Editable precisely BECAUSE of
  // that — it is theirs to word, and they should not have to ask us to change
  // it. We do not write it for them (feedback-never-write-legal-policies-for-clients).
  'footer.disclaimer':              { kind: 'rich', max: 1200, label: 'Disclaimer' },
  'footer.copyrightName':           { kind: 'text', max: 40,   label: 'Name' },
  'footer.copyrightSuffix':         { kind: 'text', max: 60,   label: 'Line' },
  'contact.phone':                  { kind: 'text', max: 24,   label: 'Phone' },

  // ── the contact form's words ──────────────────────────────────────────────
  // RULES §3: the words around a form stay editable, the wiring does not. The
  // field `name` attributes, the action and the honeypot have no entry.
  'copy.form.nameLabel':            { kind: 'text', max: 24,   label: 'Label' },
  'copy.form.emailLabel':           { kind: 'text', max: 24,   label: 'Label' },
  'copy.form.phoneLabel':           { kind: 'text', max: 24,   label: 'Label' },
  'copy.form.phoneOptional':        { kind: 'text', max: 16,   label: 'Note' },
  'copy.form.messageLabel':         { kind: 'text', max: 24,   label: 'Label' },
  'copy.form.submitLabel':          { kind: 'text', max: 24,   label: 'Button' },

  // ── the home page ─────────────────────────────────────────────────────────
  // The stamp over the hero. Short caps: it is a circular seal and a longer
  // word does not fit inside the rope.
  'saleStamp.title':                { kind: 'text', max: 10,   label: 'Stamp' },
  'saleStamp.linkWords.*':          { kind: 'text', max: 10,   label: 'Word' },
  'saleStamp.ariaLabel':            { kind: 'text', max: 90,   label: 'Spoken label' },

  'hero.eyebrow':                   { kind: 'text', max: 48,   label: 'Eyebrow' },
  // `hero.headlineLines` is what the page RENDERS — three lines with a break
  // between them, because the type is set to break there. `hero.headline` is
  // the one-line version the structured data and the share cards use. Both are
  // editable and both are addressed where they are rendered, so neither is a
  // field that saves and then appears to do nothing (RULES §6.1).
  'hero.headline':                  { kind: 'text', max: 70,   label: 'Headline' },
  'hero.headlineLines.*':           { kind: 'text', max: 24,   label: 'Line' },
  'hero.subheadline':               { kind: 'rich', max: 400,  label: 'Opening line' },
  'hero.ctaText':                   { kind: 'text', max: 28,   label: 'Button' },
  'hero.photoAlt':                  { kind: 'text', max: 220,  label: 'Photo description' },

  'glance.priceDisplay':            { kind: 'text', max: 40,   label: 'Price line' },
  'glance.locationDisplay':         { kind: 'text', max: 200,  label: 'Status line' },
  'glance.items':                   { kind: 'list', of: 'fact', max: 16, label: 'The table' },
  'glance.items.*.label':           { kind: 'text', max: 60,   label: 'Label' },
  'glance.items.*.value':           { kind: 'text', max: 140,  label: 'Value' },
  // 1,600, not 400. This is the recent-upgrades paragraph and it already runs
  // to 540 characters; a limit that refuses the words already on the page is a
  // limit that loses somebody's work the first time they touch it (the lesson
  // from rp-launch's `faqs.*.a`, 2026-10-19).
  'glance.note':                    { kind: 'rich', max: 1600, label: 'Note' },
  'glance.linkText':                { kind: 'text', max: 40,   label: 'Link' },

  'topPhotos':                      { kind: 'list', of: 'photo', max: 6, label: 'The three photographs' },
  'topPhotos.*.image':              { kind: 'image', label: 'Photograph' },
  'topPhotos.*.alt':                { kind: 'text', max: 220,  label: 'Photo description' },
  'photosMore.label':               { kind: 'text', max: 32,   label: 'Link' },

  'whyChose.eyebrow':               { kind: 'text', max: 48,   label: 'Eyebrow' },
  'whyChose.heading':               { kind: 'text', max: 90,   label: 'Heading' },
  'whyChose.body':                  { kind: 'rich', max: 2000, label: 'Paragraph' },
  'whyChose.photoAlt':              { kind: 'text', max: 220,  label: 'Photo description' },

  'alternatingSections':            { kind: 'list', of: 'story', max: 8, label: 'The story rows' },
  'alternatingSections.*.eyebrow':  { kind: 'text', max: 24,   label: 'Eyebrow' },
  'alternatingSections.*.heading':  { kind: 'text', max: 90,   label: 'Heading' },
  'alternatingSections.*.body':     { kind: 'rich', max: 2400, label: 'Paragraph' },
  'alternatingSections.*.image':    { kind: 'image', label: 'Photograph' },
  'featuresCta.label':              { kind: 'text', max: 32,   label: 'Button' },

  'upgradesSection.eyebrow':        { kind: 'text', max: 48,   label: 'Eyebrow' },
  'upgradesSection.heading':        { kind: 'text', max: 60,   label: 'Heading' },
  'upgradesSection.items':          { kind: 'list', of: 'point', max: 12, label: 'The upgrades' },
  'upgradesSection.items.*.title':  { kind: 'text', max: 90,   label: 'Upgrade' },
  'upgradesSection.items.*.body':   { kind: 'rich', max: 700,  label: 'What it is' },

  // The four photographs at the foot of the home page are Astro `import`s, so
  // the FILE is a build and only the words are editable. See the note at the
  // top of this file and the `data-rp-fixed` entries in mappings/index.json.
  'bottomPhotos.*.alt':             { kind: 'text', max: 220,  label: 'Photo description' },
  'bottomPhotosMore.label':         { kind: 'text', max: 32,   label: 'Link' },

  'highlights.eyebrow':             { kind: 'text', max: 32,   label: 'Eyebrow' },
  'highlights.heading':             { kind: 'text', max: 40,   label: 'Heading' },
  'highlights.bullets':             { kind: 'list', of: 'line', max: 30, label: 'The list' },
  'highlights.bullets.*':           { kind: 'text', max: 160,  label: 'Line' },

  'bottomCta.headline':             { kind: 'text', max: 90,   label: 'Headline' },
  'bottomCta.body':                 { kind: 'rich', max: 700,  label: 'Paragraph' },
  'bottomCta.primaryText':          { kind: 'text', max: 28,   label: 'Button' },
  'bottomCta.secondaryText':        { kind: 'text', max: 40,   label: 'Button' },

  // ── the specifications ────────────────────────────────────────────────────
  // ⚠️ THESE ARE THE FACTS A BUYER RELIES ON. They are editable because the
  // owner is the person who knows them and the only person who can correct one;
  // they are generous on length because a value here is often a sentence
  // ("Hand-laid fiberglass — solid below the waterline, cored above…").
  'specs':                          { kind: 'list', of: 'spec', max: 60, label: 'The table' },
  'specs.*.label':                  { kind: 'text', max: 40,   label: 'Label' },
  'specs.*.value':                  { kind: 'text', max: 400,  label: 'Value' },

  'equipment.*.heading':            { kind: 'text', max: 60,   label: 'Heading' },
  'equipment.*.note':               { kind: 'rich', max: 800,  label: 'Note' },
  'equipment.*.items':              { kind: 'list', of: 'equipline', max: 60, label: 'The list' },
  'equipment.*.items.*.v':          { kind: 'text', max: 400,  label: 'Line' },
  // The "New" flag beside a line. A `text` field rather than a toggle, because
  // two values are already in the stylesheet (`--new`, `--upgraded`) and a word
  // is a thing the owner can change without us.
  'equipment.*.items.*.badge':      { kind: 'text', max: 12,   label: 'Badge' },
  // `equipment` itself is absent: a section has an `id` that its jump link and
  // the page anchors point at, so adding or removing one is a build.

  // ── the photographs ──────────────────────────────────────────────────────
  'gallery':                        { kind: 'list', of: 'photo', max: 400, label: 'The gallery' },
  'gallery.*.image':                { kind: 'image', label: 'Photograph' },
  'gallery.*.alt':                  { kind: 'text', max: 220,  label: 'Photo description' },
  'gallery.*.caption':              { kind: 'rich', max: 600,  label: 'Caption' },
  // The category a photograph is filed under, which is what the filter bar on
  // /gallery is built from. A choice rather than a fixed set, because a client
  // naming a new one is naming a real one.
  'gallery.*.category':             { kind: 'choice', max: 40, label: 'Category',
                                      of: ['Exterior', 'Interior', 'Sailing', 'Aerials', 'Systems', 'Lifestyle'] },

  // ── the feature cards ────────────────────────────────────────────────────
  // `features` itself is absent: a card carries a category that decides which
  // section of the page it lands in and a list of photographs, so adding one is
  // a build. Its words are all editable, and the long form is the one place on
  // this site where a client writes a document.
  'features.*.title':               { kind: 'text', max: 90,   label: 'Title' },
  'features.*.description':         { kind: 'rich', max: 500,  label: 'Card text' },
  'features.*.body':                { kind: 'rich', max: 12000, label: 'Details' },
  'features.*.quote.text':          { kind: 'rich', max: 700,  label: 'Quote' },

  // ── the questions ─────────────────────────────────────────────────────────
  // WHICH questions the page shows, and in what order: a picker over the pool,
  // never a retype (RULES §4.1). It writes `block_pick` on `faq:list`.
  'faqIds':                         { kind: 'ids', of: 'faqs', max: 60, label: 'Questions' },
  // The pool itself. The `record` block is what gives the owner a way to ASK
  // for a question that does not exist yet, in the words of this record type
  // rather than a generic line (RULES §4, the press-mention lesson).
  'faqs':                           { kind: 'list', of: 'question', max: 60, label: 'Questions',
                                      record: { noun: 'question', plural: 'your questions', name: 'question',
                                                ask: 'a question added',
                                                askLabel: 'Ask for a new question',
                                                askLine: 'Tell us a question buyers keep asking. We write the answer and it appears here.' } },
  'faqs.*.question':                { kind: 'text', max: 180,  label: 'Question' },
  // 3,000. The longest answer on this site is already 1,090 characters, and a
  // survey question deserves a full answer rather than a truncated one.
  'faqs.*.answer':                  { kind: 'rich', max: 3000, label: 'Answer' },
  'faqs.*.category':                { kind: 'choice', max: 60, label: 'Group',
                                      of: ['About the Boat', 'Condition & History', 'Systems & Equipment',
                                           'The Sale', 'Viewing & Location', 'Ownership & Documentation'] },

  // ── the long-form pages ───────────────────────────────────────────────────
  // Markdown, rendered by Astro's own processor. These are the three places on
  // the site where the owner writes prose rather than filling in a field.
  'prose.about':                    { kind: 'rich', max: 8000,  label: 'About us' },
  'prose.contact':                  { kind: 'rich', max: 2000,  label: 'Opening line' },
  'prose.transaction':              { kind: 'rich', max: 16000, label: 'How the sale works' },

  // ── per-page copy ─────────────────────────────────────────────────────────
  // The title and the description are what a search result and a shared link
  // say, so they are content with the limits search results actually impose.
  'pageCopy.*.title':               { kind: 'text', max: 95,   label: 'Page title' },
  'pageCopy.*.description':         { kind: 'text', max: 320,  label: 'Search description' },
  'pageCopy.*.eyebrow':             { kind: 'text', max: 48,   label: 'Eyebrow' },
  'pageCopy.*.h1':                  { kind: 'text', max: 60,   label: 'Heading' },
  'pageCopy.*.sub':                 { kind: 'text', max: 200,  label: 'Opening line' },
  'pageCopy.*.ctaHeading':          { kind: 'text', max: 60,   label: 'Heading' },
  'pageCopy.*.ctaBody':             { kind: 'rich', max: 400,  label: 'Paragraph' },
  'pageCopy.*.ctaLabel':            { kind: 'text', max: 32,   label: 'Button' },

  'pageCopy.features.cardMore':     { kind: 'text', max: 24,   label: 'Card link' },
  'pageCopy.features.videoLabel':   { kind: 'text', max: 20,   label: 'Label' },
  'pageCopy.features.detailsLabel': { kind: 'text', max: 20,   label: 'Label' },
  'pageCopy.features.relatedLabel': { kind: 'text', max: 20,   label: 'Label' },
  'pageCopy.features.otherLabel':   { kind: 'text', max: 24,   label: 'Label' },

  'pageCopy.specs.downloadLabel':   { kind: 'text', max: 28,   label: 'Button' },
  'pageCopy.specs.jump.*.label':    { kind: 'text', max: 24,   label: 'Link' },
  'pageCopy.specs.layout.heading':  { kind: 'text', max: 60,   label: 'Heading' },
  'pageCopy.specs.layout.alt':      { kind: 'text', max: 320,  label: 'Diagram description' },
  'pageCopy.specs.layout.caption':  { kind: 'rich', max: 500,  label: 'Caption' },

  'pageCopy.gallery.allLabel':      { kind: 'text', max: 16,   label: 'Filter' },

  'pageCopy.faq.disclosureLabel':   { kind: 'text', max: 60,   label: 'Download link' },
  'pageCopy.faq.pillLabel':         { kind: 'text', max: 8,    label: 'Badge' },

  'pageCopy.about.positionEyebrow': { kind: 'text', max: 48,   label: 'Eyebrow' },
  'pageCopy.about.positionHeading': { kind: 'text', max: 60,   label: 'Heading' },
  'pageCopy.about.positionNote':    { kind: 'text', max: 160,  label: 'Note' },
  'pageCopy.about.photoAlt':        { kind: 'text', max: 220,  label: 'Photo description' },

  'pageCopy.contact.sideHeading':   { kind: 'text', max: 40,   label: 'Heading' },
  'pageCopy.contact.sideBody':      { kind: 'rich', max: 400,  label: 'Paragraph' },

  'pageCopy.transaction.statusLabel': { kind: 'text', max: 32,  label: 'Label' },
  'pageCopy.transaction.statusTitle': { kind: 'text', max: 32,  label: 'Status' },
  'pageCopy.transaction.statusBody':  { kind: 'rich', max: 600, label: 'Paragraph' },
  'pageCopy.transaction.statusSoft':  { kind: 'rich', max: 400, label: 'Paragraph' },

  'pageCopy.notFound.body':         { kind: 'text', max: 160,  label: 'Line' },

  // Deliberately absent, and each for a reason written in mappings/:
  //   seo.*                 the structured data and the canonical host
  //   nav.items.*.href      every destination on the site
  //   pageCopy.*.categoryOrder / groupOrder   they name the categories the
  //                         content is filed under; renaming one here would
  //                         empty a section rather than rename it
  //   pageCopy.specs.jump.*.href              page anchors
  //   pageCopy.about.positionEmbed            a third-party tracking URL
  //   equipment / features                    adding one is a build
};

// Which collections are addressed BY ID, and what identifies one.
//
// ⚠️ ONE ENTRY, AND THE REST OF THE SITE IS POSITIONAL. That is not an
// oversight and it is worth being precise about, because EDITOR-RULES §4.3
// says positional addressing is live data corruption: `specs.0.value` means
// "whatever is first now", so a client correcting a figure and then dragging
// the row would move their correction onto a different specification. On a page
// of engine hours and tank capacities that is not cosmetic.
//
// What makes it safe here is the same thing that makes it safe on the Fourlakes
// demo, which is laid out the same way. A collection is keyed when its members
// are RECORDS with ids of their own, in a table of their own — here that is the
// question pool, which is `faq` rows referenced by `block_pick`. Everything
// else is a section's own list, stored as that section's child `block` rows,
// and those have no identity apart from their position: they never had one, and
// inventing 214 ids for the equipment lines during the migration would have
// meant inventing 214 identifiers nobody chose.
//
// The protection for those is structural rather than nominal:
//
//   · a reorder or an add writes the WHOLE array (`kind: 'list'`), and that
//     array already carries the client's own words, because the page renders
//     from what is published;
//   · staleUnder() below then drops every per-position draft underneath it, so
//     an edit made before the reorder cannot be re-applied on top of it at a
//     position that now holds something else.
//
// That is the belt to the slug-keyed braces (Eric, 2026-09-29), and on this
// site it is the belt alone. If any of these lists ever grows real ids, it
// belongs in this table on the same day.
export const KEYED = {
  faqs: 'id',
};const PATTERNS = Object.keys(EDITABLE)
  .filter((k) => k.includes('*'))
  // `*` stands for one segment: an array index under `services`, a slot name
  // under `copy`. Either way it is one level, never a path.
  .map((k) => ({ key: k, re: new RegExp('^' + k.split('.').map((p) => (p === '*' ? '[^.]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\.') + '$') }));

/** The rule for a path, whether it is named exactly or matched by a pattern. */
export function fieldDef(path) {
  if (EDITABLE[path]) return EDITABLE[path];
  for (const p of PATTERNS) if (p.re.test(path)) return EDITABLE[p.key];
  return null;
}


const KEYED_PATTERNS = Object.keys(KEYED)
  .filter((k) => k.includes('*'))
  .map((k) => ({ key: k, re: new RegExp('^' + k.split('.').map((p) => (p === '*' ? '[^.]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\.') + '$') }));

/** What identifies a member of this collection, or undefined. */
export function keyedBy(collection) {
  if (KEYED[collection]) return KEYED[collection];
  for (const p of KEYED_PATTERNS) if (p.re.test(collection)) return KEYED[p.key];
  return undefined;
}

// Turn a key segment into an array index, when the collection is keyed and the
// segment is not already a number. Returns null when nothing matches, so a
// stale address reads as undefined rather than landing on a neighbor.
function indexIn(list, collection, seg) {
  if (!Array.isArray(list)) return seg;
  if (/^\d+$/.test(seg)) return seg;
  const key = keyedBy(collection);
  if (!key) return seg;
  const at = list.findIndex((it) => it && String(it[key]) === seg);
  return at === -1 ? null : String(at);
}

// Read a dotted path out of the config. `services.kitchens.blurb` resolves the
// slug; `services.2.blurb` still works, so older saved edits keep reading.
export function readPath(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  let trail = [];
  for (const raw of parts) {
    if (cur == null) return undefined;
    let k = raw;
    if (Array.isArray(cur)) {
      k = indexIn(cur, trail.join('.'), raw);
      if (k == null) return undefined;
    }
    trail.push(raw);
    cur = cur[k];
  }
  return cur;
}

// Write a dotted path into a plain object, creating what it passes through. An
// index into a missing array makes an array, not an object with "0" on it.
export function writePath(obj, path, value) {
  const parts = String(path).split('.');
  const last = parts.pop();
  let cur = obj;
  const trail = [];
  for (let i = 0; i < parts.length; i += 1) {
    let k = parts[i];
    if (Array.isArray(cur)) {
      k = indexIn(cur, trail.join('.'), k);
      // A record this site no longer has. Writing would either create a key on
      // an array or land on whoever is standing in that spot, so it does
      // neither.
      if (k == null) return obj;
    }
    trail.push(parts[i]);
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(parts[i + 1] ?? last) ? [] : {};
    cur = cur[k];
  }
  let lastKey = last;
  if (Array.isArray(cur)) {
    lastKey = indexIn(cur, trail.join('.'), last);
    if (lastKey == null) return obj;
  }
  cur[lastKey] = value;
  return obj;
}

/**
 * Saved edits that a whole-array write has just made meaningless.
 *
 * Reordering a list writes the entire array back, and that array already
 * carries the client's own edits baked in, because the page renders from the
 * merged config. Any per-position edit inside it is now both redundant and
 * wrong: it will be re-applied on top, at a position that now holds something
 * else. This is the belt to the slug-keyed braces (Eric, 2026-09-29).
 */
export function staleUnder(path, fields) {
  const prefix = String(path) + '.';
  return Object.keys(fields || {}).filter(
    (k) => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length).split('.')[0]),
  );
}

/**
 * Lay a set of saved edits over a config.
 *
 * Order matters and is not the order they were saved in: a whole-array edit
 * (adding a card, reordering) must land BEFORE the single-field edits inside
 * that array, or it overwrites them. Shortest path first does exactly that.
 */
export function applyEdits(config, fields) {
  for (const path of Object.keys(fields || {}).sort((a, b) => a.split('.').length - b.split('.').length)) {
    writePath(config, path, fields[path]);
  }
  return config;
}

// One place decides whether a saved value is allowed, so the browser and the
// worker can never disagree about it. Returns the value to store, or throws.
export function validateField(path, value) {
  const def = fieldDef(path);
  if (!def) throw new Error('not editable');

  if (def.kind === 'image') {
    if (!value || typeof value !== 'object') throw new Error('bad image');
    const src = String(value.src || '');
    const alt = String(value.alt || '');
    // Only our own images. An off-site src would let a saved edit hotlink
    // anything, and alt text is read aloud, so it is content like any other.
    //
    // Two shapes are ours. `/images/...` shipped with the build. `/media/...`
    // was uploaded through /api/media into THIS client's own R2 bucket, and
    // its name is the sha256 of the bytes, so the pattern is exact rather
    // than permissive: nothing but a real upload can match it. The same
    // expression guards the serve route in functions/media/[[path]].ts, and
    // the two have to agree — a photo that saves but will not serve is worse
    // than one that refuses to save (2026-09-30).
    const OWN = /^\/images\/[A-Za-z0-9._/-]+$/;
    const UPLOADED = /^\/media\/uploads\/[a-f0-9]{32}\/\d{2,4}\.(webp|avif|jpg|png|gif)$/;
    if (!OWN.test(src) && !UPLOADED.test(src)) throw new Error('bad image path');
    if (alt.length > 220) throw new Error('alt too long');
    return { src, alt };
  }

  // A choice is a string like any other; the set it came from is a kindness in
  // the interface, not a restriction, because a client naming a new
  // neighborhood is naming a real one.
  if (def.kind === 'choice') {
    const clean = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('empty');
    if (clean.length > (def.max || 60)) throw new Error('too long');
    return clean;
  }

  // A record reference: an id, not words. The page resolves it against the
  // records the site holds, so an id nobody has simply renders nothing rather
  // than putting an unattributed quote on a client's home page.
  if (def.kind === 'record') {
    const id = String(value == null ? '' : value).trim();
    if (!id) throw new Error('empty');
    if (id.length > (def.max || 80)) throw new Error('too long');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('not a record');
    return id;
  }

  if (def.kind === 'count') {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) throw new Error('not a number');
    if (n < (def.min || 1) || n > (def.max || 12)) throw new Error(`between ${def.min || 1} and ${def.max || 12}`);
    return n;
  }

  if (def.kind === 'link') {
    if (!value || typeof value !== 'object') throw new Error('bad link');
    const text = String(value.text || '').replace(/\s+/g, ' ').trim();
    const href = String(value.href || '').trim();
    if (!text) throw new Error('empty');
    if (text.length > (def.max || 40)) throw new Error('too long');
    // A path on this site, or a full http(s) address. Nothing else: a saved
    // `javascript:` or `data:` destination would be a script this site runs on
    // the client's own visitors.
    const ok = /^\/[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/.test(href)
      || /^https?:\/\/[^\s<>"']+$/i.test(href)
      || /^(mailto|tel):[^\s<>"']+$/i.test(href);
    if (!ok) throw new Error('that does not look like a web address');
    if (href.length > 400) throw new Error('that address is too long');
    return { text, href };
  }

  if (def.kind === 'ids') {
    if (!Array.isArray(value)) throw new Error('bad list');
    const out = [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
    if (out.length > 200) throw new Error('too many');
    if (out.some((v) => !/^[a-z0-9-]{1,80}$/i.test(v))) throw new Error('bad id');
    return out;
  }

  if (def.kind === 'list') {
    if (!Array.isArray(value)) throw new Error('bad list');
    if (def.max && value.length > def.max) throw new Error(`no more than ${def.max}`);
    // A list edit moves and adds ITEMS; it never invents fields. Each item is
    // re-validated through the rules for its own paths on the way back in.
    const out = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      if (item == null || typeof item !== 'object' || Array.isArray(item)) throw new Error('bad item');
      const clean = {};
      for (const [k, v] of Object.entries(item)) {
        const childDef = fieldDef(`${path}.${i}.${k}`);
        if (!childDef) { clean[k] = v; continue; }          // structural, carried through untouched
        try { clean[k] = validateField(`${path}.${i}.${k}`, v); } catch { clean[k] = v; }
      }
      out.push(clean);
    }
    return out;
  }

  const s = String(value == null ? '' : value);
  const clean = def.kind === 'text' ? s.replace(/\s+/g, ' ').trim() : s.replace(/\r\n?/g, '\n').trim();
  if (!clean) throw new Error('empty');
  // The LIMIT, not just the word. "Too long" in a toast tells somebody who has
  // just lost a paragraph nothing they can act on: not how long is too long,
  // and not how far over they are (Eric, 2026-10-19).
  if (clean.length > def.max) {
    throw new Error(`that is ${clean.length} characters and the limit here is ${def.max}`);
  }
  return clean;
}


/** A blank item for "add another of these", in the shape the template expects. */
//
// A new card lands with the right FIELDS rather than a copy of its neighbour
// (EDITOR-RULES §4.4): duplicating the row above is how a specification ends up
// repeated twice with one of them wrong. The id is filled in by the editor; a
// blank one would collide.
export function blankItem(kind) {
  const P = {
    fact: { id: '', label: 'Something else', value: '' },
    photo: { id: '', image: '', alt: 'What this photograph shows' },
    story: { id: '', eyebrow: 'Eyebrow', heading: 'A heading for this row', body: 'What this part of the boat is like.', image: '' },
    point: { id: '', title: 'Another upgrade', body: 'What it is, when it was done, and who did it.' },
    line: '',
    spec: { id: '', label: 'Measurement', value: '' },
    equipline: { t: 'li', v: 'Another item' },
    question: { id: '', question: 'A question buyers ask', answer: 'Your answer, in the words you would use on the phone.' },
  };
  const blank = P[kind];
  return blank === undefined ? { id: '', title: 'New item', body: '' } : JSON.parse(JSON.stringify(blank));
}
