// The fiddly parts of reading a page for photographs, kept where both the
// Worker and an ordinary test can reach them.
//
// ⚠️ HTMLRewriter LIVES ONLY IN THE WORKERS RUNTIME, so the walking of the
// document has to stay in the function. Everything that is actually easy to get
// wrong — which candidate in a srcset, what counts as the same photograph, what
// is not an image at all — lives here instead, where it can be tested without a
// browser or an edge runtime.

/** The width a srcset candidate declares, as in "photo-1600.jpg 1600w". */
export function widthOf(candidate) {
  const m = /(\d+)w\s*$/.exec(String(candidate || '').trim());
  return m ? Number(m[1]) : 0;
}

/**
 * The biggest candidate in a srcset.
 *
 * ⚠️ THE FIRST ENTRY IS USUALLY THE SMALLEST. A srcset is written for a browser
 * choosing a size for a viewport; taking entry one gives a client the 320px
 * version of their own photograph.
 */
export function bestOfSrcset(set) {
  let best = null;
  for (const part of String(set || '').split(',')) {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) continue;
    const w = widthOf(part);
    if (!best || w > best.w) best = { url: bits[0], w };
  }
  return best;
}

/**
 * What makes two addresses the same photograph.
 *
 * ⚠️ A CDN PUTS THE SIZE IN THE QUERY STRING, so the path is the identity and
 * the query is a rendition of it: `trophy.jpg?width=1240` and
 * `trophy.jpg?width=300` are one picture at two sizes, and offering both is how
 * an importer ends up listing 151 images for a page with twenty photographs on
 * it (HubSpot's does exactly that — Eric, 2026-11-03, "ours would be better").
 */
export function identOf(abs) {
  return abs.origin + abs.pathname.toLowerCase();
}

/** Addresses that are never a photograph worth offering. */
export function isSkippable(raw) {
  const s = String(raw || '').trim();
  if (!s) return true;
  if (/^data:/i.test(s) || /^blob:/i.test(s)) return true;
  // A spacer, a tracking pixel, or a sprite sheet nobody wants a crop of.
  if (/(^|\/)(spacer|pixel|blank|transparent|1x1)\.(gif|png)(\?|$)/i.test(s)) return true;
  if (/\.svg(\?|$)/i.test(s)) return true;   // logos and icons, essentially always
  return false;
}
