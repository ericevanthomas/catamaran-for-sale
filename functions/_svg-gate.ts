// Is this SVG safe to keep and serve from our own origin?
//
// ⚠️ IT VALIDATES AND REFUSES. It does NOT clean. Cleaning means parsing
// hostile XML and re-emitting it, and the only parser a Worker has is
// HTMLRewriter — an HTML parser, which lowercases attribute names. That alone
// turns `viewBox` into `viewbox` and `gradientTransform` into
// `gradienttransform`, which a standalone SVG document does not accept. You
// would be mangling every good file in order to half-trust your own cleaner on
// the bad ones (Eric asked about sanitising, 2026-10-30).
//
// ⚠️ IT IS AN ALLOWLIST AND IT FAILS CLOSED. Anything this does not positively
// recognise — an unknown element, an unknown attribute, a construct it cannot
// parse confidently — is a refusal. A denylist is a list of the attacks you
// thought of; this is a list of the things a drawing is made of.
//
// ⚠️ IT IS THE SECOND LAYER, NOT THE ONLY ONE. functions/media/[[path]].ts
// serves every SVG with `default-src 'none'; sandbox` and `nosniff`, so even a
// file that got past this cannot run. Neither layer is trusted alone.

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'tref',
  'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask', 'marker', 'filter', 'style',
  'fegaussianblur', 'feoffset', 'feblend', 'femerge', 'femergenode',
  'feflood', 'fecomposite', 'fecolormatrix', 'fedropshadow',
]);

// Attributes a drawing needs. `on*` is absent on purpose and so is anything
// that can fetch.
const ATTRS = new Set([
  'id', 'class', 'style', 'transform', 'd', 'points', 'x', 'y', 'x1', 'y1',
  'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewbox',
  'preserveaspectratio', 'fill', 'fill-rule', 'fill-opacity', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'opacity',
  'color', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'gradienttransform', 'spreadmethod', 'patternunits', 'patterncontentunits',
  'patterntransform', 'clip-path', 'clip-rule', 'mask', 'filter',
  'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight',
  'refx', 'refy', 'orient', 'markerunits', 'maskunits', 'clippathunits',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'letter-spacing', 'word-spacing', 'dx', 'dy',
  'xmlns', 'xmlns:xlink', 'version', 'role', 'aria-label', 'aria-labelledby',
  'aria-hidden', 'vector-effect', 'shape-rendering', 'paint-order',
  'stddeviation', 'in', 'in2', 'result', 'mode', 'type', 'values', 'operator',
  'flood-color', 'flood-opacity', 'overflow', 'display', 'visibility',
  'href', 'xlink:href',          // checked below: fragments only
]);

export function svgRefusal(text: string): string | null {
  if (text.length > 2 * 1024 * 1024) return 'that drawing is too complicated to check';

  // A document type or entity declaration is how XML attacks start, and no
  // drawing needs one.
  if (/<!doctype|<!entity|<!\[cdata\[/i.test(text)) return 'that file contains a document declaration we do not allow';
  if (/<\?xml-stylesheet/i.test(text)) return 'that file links to an external stylesheet';

  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<svg[\s>]/i.test(withoutComments)) return 'that does not look like an SVG';

  // ⚠️ Walk every tag. A construct this cannot read is a refusal, never a pass.
  const TAG = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = TAG.exec(withoutComments))) {
    seen++;
    const el = m[1].toLowerCase().replace(/^svg:/, '');
    if (!ELEMENTS.has(el)) return `that file contains <${m[1]}>, which we do not allow in a drawing`;

    const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;
    let a: RegExpExecArray | null;
    while ((a = ATTR.exec(m[2] || ''))) {
      const name = a[1].toLowerCase();
      const value = a[2].replace(/^['"]|['"]$/g, '');
      if (name.startsWith('on')) return 'that file carries an event handler';
      if (!ATTRS.has(name)) return `that file uses ${a[1]}, which we do not allow in a drawing`;
      // Anything that could point outward must point INSIDE the file.
      if (name === 'href' || name === 'xlink:href') {
        if (!/^#[A-Za-z0-9_.:-]+$/.test(value.trim())) return 'that file links to something outside itself';
      }
      // ⚠️ ANY attribute can carry url(), not just `style`. `fill`, `stroke`,
      // `filter`, `mask` and `clip-path` all take a paint server or a
      // reference, and `fill="url(https://evil.test/x)"` would otherwise have
      // walked straight through this gate — a hole my own first round of tests
      // did not cover (2026-10-30). A url() must point INSIDE the file.
      if (/url\s*\(/i.test(value)) {
        const refs = value.match(/url\s*\(\s*['"]?([^'")]*)/gi) || [];
        for (const ref of refs) {
          const target = ref.replace(/^url\s*\(\s*['"]?/i, '').trim();
          if (!/^#[A-Za-z0-9_.:-]+$/.test(target)) return 'that file loads something from outside itself';
        }
      }
      if (/expression\s*\(|@import/i.test(value)) {
        return 'that file loads something from a style rule';
      }
    }
  }
  if (!seen) return 'we could not read that drawing';

  // A <style> block is allowed as an element, but not one that fetches.
  const styles = withoutComments.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (const s of styles) {
    if (/url\s*\(|@import|expression\s*\(|javascript:/i.test(s)) return 'that file loads something from a style rule';
  }
  // Belt and braces: the word, anywhere, after entities are decoded.
  const decoded = withoutComments.replace(/&#x?[0-9a-f]+;?/gi, '');
  if (/javascript\s*:|data\s*:\s*text\/html/i.test(decoded)) return 'that file contains a script link';

  return null;
}
