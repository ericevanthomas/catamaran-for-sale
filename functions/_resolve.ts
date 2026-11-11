// An address the editor saves → the row and column it belongs in.
//
// ⚠️ THE INVERSE OF scripts/_assemble.mjs, AND IT HAS TO STAY THAT WAY. The
// assembler turns rows into the site object the pages render; this turns one
// edited address back into the rows it came from. If they disagree, a client's
// change goes to the wrong place or nowhere, so scripts/check-resolve.mjs walks
// every editable address and proves each one lands where the assembler read it.
//
// It returns null for an address it does not understand, and functions/api/
// publish.ts then REFUSES the whole publish and says which address. The
// alternative — dropping it quietly — is the shipped-and-vanished failure the
// whole publish step exists to end.
//
// Both halves are driven by scripts/_content-map.mjs, which is why this file is
// short: it does not know this site's sections, it reads them.
import {
  SECTIONS, ITEM_COLUMNS, BARE_STRING, MD_CHILD, SETTING_ROOTS, FAQ_BLOCK, blockId,
} from '../scripts/_content-map.mjs';

export type Write = { sql: string; args: unknown[] };

const now = () => new Date().toISOString();
const J = (v: unknown) => JSON.stringify(v ?? null);

// A photograph uploaded through /api/media: its address is the content hash of
// its bytes, which is also the id of its `asset` row.
const assetOf = (img: any): string | null => {
  const src = typeof img === 'string' ? img : img?.src;
  const m = /^\/media\/uploads\/([a-f0-9]{32})\//.exec(src || '');
  return m ? m[1] : null;
};

const setting = (key: string, value: unknown, who: string): Write[] => [{
  sql: `INSERT INTO setting (key, value_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  args: [key, J(value), now(), who],
}];

const blockCol = (id: string, column: string, value: unknown): Write[] => [{
  sql: `UPDATE block SET ${column} = ?2, updated_at = ?3 WHERE id = ?1`,
  args: [id, value ?? null, now()],
}];

// A key that lives in `block.data` rather than in a column of its own.
const blockData = (id: string, key: string, value: unknown): Write[] => [{
  sql: `UPDATE block SET data = json_set(COALESCE(data, '{}'), '$.' || ?2, json(?3)), updated_at = ?4 WHERE id = ?1`,
  args: [id, key, J(value), now()],
}];

/**
 * A photograph in a slot.
 *
 * ⚠️ BOTH HOMES, because this site has pictures from two pipelines. An upload
 * through /api/media is an `asset` row and goes in the column; one of the ~160
 * the site already ships has a public path under /_img/ and goes in
 * `data.image`, which is what assemble() falls back to. Writing both and
 * letting the assembler prefer the asset is what makes "replace this photograph
 * with one I just uploaded" work without a migration.
 */
const image = (id: string, value: any): Write[] => {
  const asset = assetOf(value);
  const src = typeof value === 'string' ? value : value?.src;
  const out: Write[] = [{
    sql: `UPDATE block SET asset_id = ?2, updated_at = ?3 WHERE id = ?1`,
    args: [id, asset, now()],
  }];
  if (src) out.push(...blockData(id, 'image', src));
  return out;
};

/**
 * Which questions the FAQ page shows, in order.
 *
 * Replaced wholesale because that IS the value: a set of ids in an order, and a
 * partial update of it has no meaning.
 */
const picks = (ids: unknown): Write[] => {
  const list = Array.isArray(ids) ? ids : [];
  const out: Write[] = [{ sql: `DELETE FROM block_pick WHERE block_id = ?1 AND kind = 'faq'`, args: [FAQ_BLOCK] }];
  list.forEach((id, i) => out.push({
    sql: `INSERT OR REPLACE INTO block_pick (block_id, kind, record_id, sort) VALUES (?1, 'faq', ?2, ?3)`,
    args: [FAQ_BLOCK, String(id), i],
  }));
  return out;
};

/**
 * One repeated thing, as the row it is stored in.
 *
 * Shared by the whole-array write and the "add one" path, so an item added by
 * the editor lands in exactly the shape the migration put its neighbours in.
 */
const itemRow = (id: string, page: string, parent: string, kind: string, sort: number, item: any): Write[] => {
  if (BARE_STRING.has(kind)) {
    return [{
      sql: `INSERT OR REPLACE INTO block (id, owner_type, owner_id, parent_id, type, sort, body, created_at, updated_at)
            VALUES (?1, 'page', ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      args: [id, page, parent, kind, sort, item == null ? '' : String(item), now()],
    }];
  }
  const map: Record<string, string> = (ITEM_COLUMNS as any)[kind] || {};
  const rest: Record<string, unknown> = { ...(item || {}) };
  const col: Record<string, unknown> = {};
  let md: unknown;
  const mdKey = (MD_CHILD as any)[kind];
  if (mdKey && rest[mdKey] !== undefined) { md = rest[mdKey]; delete rest[mdKey]; }
  for (const [c, key] of Object.entries(map)) {
    if (rest[key] === undefined) continue;
    // ⚠️ `asset_id` is a foreign key into `asset`, never a path. A path belongs
    // in `data` — see the note in scripts/seed-content.mjs, where putting one in
    // the column failed the foreign key outright.
    if (c === 'asset_id') { col.asset_id = assetOf(rest[key]); continue; }
    col[c] = rest[key];
    delete rest[key];
  }
  const out: Write[] = [{
    sql: `INSERT OR REPLACE INTO block (id, owner_type, owner_id, parent_id, type, sort,
                                        eyebrow, headline, body, asset_id, cta_text, cta_href, data,
                                        created_at, updated_at)
          VALUES (?1, 'page', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
    args: [id, page, parent, kind, sort,
           col.eyebrow ?? null, col.headline ?? null, col.body ?? null, col.asset_id ?? null,
           col.cta_text ?? null, col.cta_href ?? null,
           Object.keys(rest).length ? JSON.stringify(rest) : null, now()],
  }];
  if (mdKey) {
    out.push({
      sql: `INSERT OR REPLACE INTO block (id, owner_type, owner_id, parent_id, type, sort, body, created_at, updated_at)
            VALUES (?1, 'page', ?2, ?3, 'md', 0, ?4, ?5, ?5)`,
      args: [`${id}:md`, page, id, md == null ? '' : String(md), now()],
    });
  }
  return out;
};

/** A whole list, after a reorder, an add, or a card taken off. */
const setList = (sec: any, list: unknown): Write[] => {
  const items = Array.isArray(list) ? list : [];
  const parent = blockId(sec.page, sec.type);
  // ⚠️ The children go first, then whatever is left over from a longer list is
  // deleted — rather than DELETE-then-INSERT, which would drop the nested rows
  // of every surviving item along the way (`block.parent_id` cascades).
  const out: Write[] = [];
  items.forEach((item, i) => out.push(...itemRow(blockId(sec.page, sec.type, i), sec.page, parent, sec.item, i, item)));
  out.push({
    sql: `DELETE FROM block WHERE parent_id = ?1 AND type = ?2 AND sort >= ?3`,
    args: [parent, sec.item, items.length],
  });
  return out;
};

export function resolve(field: string, value: unknown, who = 'editor'): Write[] | null {
  const seg = field.split('.');
  const root = seg[0];

  // ── the site's own facts: one row per leaf ────────────────────────────────
  // The key IS the address, because scripts/_content-map.mjs flattens the same
  // way in both directions (`leaves` / `unflatten`).
  if (SETTING_ROOTS.includes(root)) return setting(field, value, who);

  // ── which questions the FAQ page shows ───────────────────────────────────
  if (field === 'faqIds') return picks(value);

  // ── the question pool ────────────────────────────────────────────────────
  if (root === 'faqs' && seg.length === 3) {
    const map: Record<string, string> = { question: 'question', answer: 'answer' };
    if (map[seg[2]]) {
      return [{ sql: `UPDATE faq SET ${map[seg[2]]} = ?2, updated_at = ?3 WHERE id = ?1`, args: [seg[1], value ?? null, now()] }];
    }
    // A question's group is its FIRST `faq_tag` row, which is the contract
    // scripts/_assemble.mjs reads it back by. Replaced rather than inserted:
    // a question has one group.
    if (seg[2] === 'category') {
      return [
        { sql: `DELETE FROM faq_tag WHERE faq_id = ?1`, args: [seg[1]] },
        { sql: `INSERT OR REPLACE INTO faq_tag (faq_id, tag) VALUES (?1, ?2)`, args: [seg[1], String(value ?? '')] },
      ];
    }
    return null;
  }
  // The whole pool, after an add or a question taken out of it. The pool's own
  // order is `faq.sort`; where each one sits on the page is `block_pick`, so a
  // reorder HERE does not move anything on the page, which is correct.
  if (field === 'faqs' && Array.isArray(value)) {
    const out: Write[] = [];
    (value as any[]).forEach((f, i) => {
      const id = String(f?.id || '');
      if (!id) return;
      out.push({
        sql: `INSERT INTO faq (id, question, answer, sort, created_at, updated_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?5)
              ON CONFLICT(id) DO UPDATE SET question = excluded.question, answer = excluded.answer,
                                            sort = excluded.sort, updated_at = excluded.updated_at`,
        args: [id, String(f.question ?? ''), String(f.answer ?? ''), i, now()],
      });
      if (f.category) {
        out.push({ sql: `DELETE FROM faq_tag WHERE faq_id = ?1`, args: [id] });
        out.push({ sql: `INSERT OR REPLACE INTO faq_tag (faq_id, tag) VALUES (?1, ?2)`, args: [id, String(f.category)] });
      }
    });
    return out;
  }

  // ── a page's sections ────────────────────────────────────────────────────
  for (const sec of SECTIONS as any[]) {
    const id = blockId(sec.page, sec.type);

    // One of the three long-form pages: the whole markdown document.
    if (sec.md && field === sec.md) return blockCol(id, 'body', value);

    // The section's own words.
    if (sec.own && (field === sec.own || field.startsWith(sec.own + '.'))) {
      // Its list is stored in the child rows, so it is handled below, not here.
      if (!(sec.list && (field === sec.list || field.startsWith(sec.list + '.')))) {
        if (field === sec.own) return null;              // a whole section is not one value
        const rest = field.slice(sec.own.length + 1);
        const column = Object.keys(sec.cols || {}).find((c) => (sec.cols as any)[c] === rest);
        if (column === 'asset_id') return image(id, value);
        if (column) return blockCol(id, column, value);
        return blockData(id, rest, value);
      }
    }

    if (!sec.list) continue;
    if (field === sec.list) return Array.isArray(value) ? setList(sec, value) : null;
    if (!field.startsWith(sec.list + '.')) continue;

    const after = field.slice(sec.list.length + 1).split('.');
    const i = Number(after[0]);
    if (!Number.isInteger(i) || i < 0) return null;
    const kidId = blockId(sec.page, sec.type, i);
    const rest = after.slice(1).join('.');

    // A bare-string item, such as one of the Key Equipment ticks.
    if (!rest) return blockCol(kidId, 'body', value);

    // The nested list inside one item: an equipment section's lines.
    if (sec.nested) {
      if (rest === sec.nested.key) {
        if (!Array.isArray(value)) return null;
        const out: Write[] = [];
        (value as any[]).forEach((g, k) => out.push(
          ...itemRow(blockId(sec.page, sec.type, i, k), sec.page, kidId, sec.nested.item, k, g),
        ));
        out.push({
          sql: `DELETE FROM block WHERE parent_id = ?1 AND type = ?2 AND sort >= ?3`,
          args: [kidId, sec.nested.item, (value as any[]).length],
        });
        return out;
      }
      const nest = new RegExp(`^${sec.nested.key}\\.(\\d+)(?:\\.(.+))?$`).exec(rest);
      if (nest) {
        const gid = blockId(sec.page, sec.type, i, Number(nest[1]));
        const key = nest[2];
        if (!key) return blockCol(gid, 'body', value);
        const map: Record<string, string> = (ITEM_COLUMNS as any)[sec.nested.item] || {};
        const col = Object.keys(map).find((c) => map[c] === key);
        if (col === 'asset_id') return image(gid, value);
        if (col) return blockCol(gid, col, value);
        return blockData(gid, key, value);
      }
    }

    // The item's long-form markdown, which is a child block of its own.
    const mdKey = (MD_CHILD as any)[sec.item];
    if (mdKey && rest === mdKey) return blockCol(`${kidId}:md`, 'body', value);

    // One field of one item.
    const map: Record<string, string> = (ITEM_COLUMNS as any)[sec.item] || {};
    const col = Object.keys(map).find((c) => map[c] === rest);
    if (col === 'asset_id') return image(kidId, value);
    if (col) return blockCol(kidId, col, value);
    return blockData(kidId, rest, value);
  }

  return null;
}
