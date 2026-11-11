// Rebuild the whole site object from this tenant's own database.
//
// ⚠️ THIS IS THE ONE RECONSTRUCTION, used by the build AND by the round-trip
// check AND by the publish endpoint's snapshot. If the check had its own copy it
// would be testing a lookalike: the two could agree with each other and both
// disagree with what actually ships. So scripts/build-site-data.mjs calls
// assemble() to write src/config/site.data.json, functions/api/publish.ts calls
// the same assemble() to record the site as it was before a publish, and
// scripts/check-content-roundtrip.mjs calls it to prove the rows still say what
// src/config/site.seed.json said.
//
// ⚠️ TAKES THE ROWS, NOT A WAY TO FETCH THEM. The build has wrangler, the
// Worker has an async D1 binding and the CI build has an HTTPS endpoint; handing
// this function the tables lets all three fetch however they must, and makes
// "one query per table, never one per row" structural rather than a rule
// somebody has to remember.
import {
  SECTIONS, ITEM_COLUMNS, BARE_STRING, MD_CHILD, FAQ_BLOCK,
  blockId, unflatten, writePath, readPath,
} from './_content-map.mjs';

// Every table the site is made of, and the order its rows are read in. Exported
// so each caller fetches them its own way and so nothing can read a table the
// others do not.
export const TABLES = {
  setting: 'key',
  asset: 'id',
  block: 'owner_id, sort',
  block_pick: 'block_id, sort',
  faq: 'sort',
  faq_tag: 'faq_id, tag',
};

const parse = (s, fallback) => {
  if (s === null || s === undefined || s === 'null') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

export function assemble(tables) {
  const rows = (t) => tables[t] || [];
  const blocks = rows('block');
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const kidsOf = new Map();
  for (const b of blocks) {
    if (!b.parent_id) continue;
    if (!kidsOf.has(b.parent_id)) kidsOf.set(b.parent_id, []);
    kidsOf.get(b.parent_id).push(b);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => a.sort - b.sort);
  const kids = (id, type) => (kidsOf.get(id) || []).filter((k) => !type || k.type === type);

  const assets = new Map(rows('asset').map((a) => [a.id, a]));
  const pathOf = (id) => (id && assets.has(id) ? assets.get(id).public_path : undefined);

  // ── the site's own facts, unflattened ──────────────────────────────────────
  // ⚠️ `null` is dropped rather than carried. A NULL column means ABSENT, and
  // absent is `undefined`: an optional string that arrives as null is rejected
  // by the schema, and dropping it is also what makes the assembled object equal
  // the snapshot, which simply omitted the key.
  const site = unflatten(
    rows('setting')
      .map((r) => [r.key, parse(r.value_json, null)])
      .filter(([, v]) => v !== null),
  );

  // ── one repeated thing, back from its block row ───────────────────────────
  const itemOf = (row, kind) => {
    if (BARE_STRING.has(kind)) return row.body;
    const map = ITEM_COLUMNS[kind] || {};
    const item = { ...parse(row.data, {}) };
    for (const [col, key] of Object.entries(map)) {
      if (col === 'asset_id') {
        const p = pathOf(row.asset_id);
        if (p !== undefined) item[key] = p;
        continue;
      }
      if (row[col] !== null && row[col] !== undefined) item[key] = row[col];
    }
    const mdKey = MD_CHILD[kind];
    if (mdKey) {
      const md = kids(row.id, 'md')[0];
      item[mdKey] = md ? md.body : '';
    }
    return item;
  };

  // ── each section, back from its block row and its children ────────────────
  for (const sec of SECTIONS) {
    const id = blockId(sec.page, sec.type);
    const row = byId.get(id);
    if (!row) continue;

    // The three long-form pages are a block carrying one markdown document.
    if (sec.md) {
      writePath(site, sec.md, row.body ?? '');
      continue;
    }

    if (sec.own) {
      const own = { ...parse(row.data, {}) };
      for (const [col, key] of Object.entries(sec.cols || {})) {
        if (col === 'asset_id') {
          const p = pathOf(row.asset_id);
          if (p !== undefined) own[key] = p;
          continue;
        }
        if (row[col] !== null && row[col] !== undefined) own[key] = row[col];
      }
      writePath(site, sec.own, own);
    }

    if (sec.list) {
      const items = kids(id, sec.item).map((k) => {
        const item = itemOf(k, sec.item);
        if (sec.nested && item && typeof item === 'object') {
          item[sec.nested.key] = kids(k.id, sec.nested.item).map((g) => itemOf(g, sec.nested.item));
        }
        return item;
      });
      writePath(site, sec.list, items);
    }
  }

  // ── the question pool, and which questions the page shows ─────────────────
  //
  // The POOL is `faq` rows with their categories in `faq_tag`. WHICH of them
  // the page shows, and in what order, is `block_pick` — a different fact, and
  // the one that makes "take that question off the page" possible without
  // deleting the answer (EDITOR-RULES §4.1).
  const tagsOf = rows('faq_tag').reduce((m, t) => ((m[t.faq_id] ||= []).push(t.tag), m), {});
  const pool = new Map(rows('faq').map((f) => [f.id, f]));
  const picks = rows('block_pick').filter((p) => p.block_id === FAQ_BLOCK && p.kind === 'faq');
  const faqOf = (id) => {
    const f = pool.get(id);
    if (!f) return null;
    const tags = tagsOf[id] || [];
    // ⚠️ The FIRST tag is the category the page groups by, and the rest are the
    // question's own tags. One table, two jobs, and the order is the contract:
    // `faq_tag` has no column that says which is which, and inventing one would
    // be the per-client schema layer PAGE-COMPOSITION.md forbids.
    const extra = tags.slice(1).map((t) => t.tag ?? t);
    const out = {
      id,
      question: f.question,
      answer: f.answer,
      ...(tags.length ? { category: tags[0].tag ?? tags[0] } : {}),
      ...(extra.length ? { tags: extra } : {}),
    };
    // ⚠️ THE PDF THAT HANGS OFF AN ANSWER IS A `setting`, NOT A COLUMN, and
    // that is a deliberate divergence from where you would look for it. The
    // platform `faq` table is id/question/answer/sort and has no `extra` JSON
    // to put a one-off in; adding a column would mean altering the same table
    // in eighteen client vaults for three rows on one site, and inventing a
    // per-client column is the thing PAGE-COMPOSITION.md forbids outright. It
    // also reads correctly: the document is an attachment the PAGE offers
    // beside an answer, not part of the answer's text, which is why the FAQ
    // page's own disclosure link is already a piece of page copy.
    const dl = readPath(site, `pageCopy.faq.downloads.${id}`);
    if (dl && dl.url) out.download = dl;
    return out;
  };
  const ordered = picks.sort((a, b) => a.sort - b.sort);
  site.faqs = ordered.map((p) => faqOf(p.record_id)).filter(Boolean);
  // ⚠️ THE PICK LIST, PUBLISHED AS ITS OWN FIELD. The page renders in this
  // order, so the editor's question picker is a control that does something:
  // reordering it or taking a question off it writes `block_pick` and the page
  // changes. The alternative — a picker beside a page that sorts by an `order`
  // number on the question itself — is a control that appears to work and does
  // nothing, which is worse than no control (feedback-no-ask-us-placeholder-controls).
  site.faqIds = ordered.map((p) => p.record_id);

  // ⚠️ A NULL COLUMN MEANS ABSENT, AND ABSENT IS `undefined`, NOT `null`.
  // Dropping them here is what makes the assembled object match a snapshot that
  // simply omitted the key, and it is what keeps an optional field optional.
  const prune = (v) => {
    if (Array.isArray(v)) return v.map(prune);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) if (val !== null && val !== undefined) o[k] = prune(val);
      return o;
    }
    return v;
  };
  return prune(site);
}

export { readPath };
