// The editable lists, as data.
//
// Reordering a set of cards or adding one to it means writing the WHOLE array
// back, and the page only carries the rendered words — not the id or anything
// else an item is made of. So the build publishes the arrays themselves,
// already merged with whatever has been saved, and the editor works from
// those.
//
// Only lists named in the allowlist appear here, and it is the same table
// functions/api/edit.ts validates against, so this endpoint cannot widen what
// may be changed.
import site from '../config/site.config.js';
import { EDITABLE, readPath, keyedBy } from '../config/editable.js';

export function GET() {
  const lists = {};
  for (const [path, def] of Object.entries(EDITABLE)) {
    if (def.kind !== 'list') continue;
    // A pattern like `system.cards.*.rows` stands for one list per card, so it
    // is expanded against the content rather than published with a star in it.
    for (const real of expand(path)) {
      const value = readPath(site, real);
      if (!Array.isArray(value)) continue;
      lists[real] = { items: value, of: def.of || 'item', max: def.max || 20, label: def.label, key: keyedBy(real) || null };
    }
  }
  return new Response(JSON.stringify({ lists }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Turn one `*` into the ids actually present. One level is all this page needs
// and all the allowlist expresses.
function expand(path) {
  const at = path.indexOf('*');
  if (at === -1) return [path];
  const head = path.slice(0, at - 1);
  const tail = path.slice(at + 1);
  const parent = readPath(site, head);
  if (!Array.isArray(parent)) return [];
  // ⚠️ THE INDEX, not a guessed `id`, when the collection is not KEYED. This
  // read `keyedBy(head) || 'id'` on rp-launch, where every list is keyed. On
  // this site only the question pool is (src/config/editable.js explains why),
  // and the rest are a section's child rows addressed by position — so falling
  // back to `it.id` would publish `equipment.interior.items` while
  // functions/_resolve.ts is listening for `equipment.0.items`, and reordering
  // an equipment list would save into nothing.
  const key = keyedBy(head);
  return parent.map((it, i) => head + '.' + (key ? (it?.[key] ?? i) : i) + tail);
}
