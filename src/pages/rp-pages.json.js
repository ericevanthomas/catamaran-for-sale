// Every destination on this site, for the link drawer.
//
// ⚠️ A `link` FIELD WITHOUT THIS ENDPOINT IS A SPINNER. The editor fetches five
// JSON endpoints — rp-approvals, rp-lists, rp-records, rp-pages and /api/media
// — and a destination picker that 404s sits on "Loading your pages…" for ever
// (Eric, 2026-10-19, pressing the hero button on rp-launch). Same class of gap
// as rp-records.json: a mapping shape shipped without the data it depends on.
//
// Derived from the nav and the footer, which are content, plus the page anchors
// the specs jump bar already names — so a destination offered here is one this
// repository actually builds. That is the whole point of a picker over a text
// field: a typed href can point at a 404 and nothing would catch it until a
// visitor found it.
import site from '../config/site.config.js';

export function GET() {
  const seen = new Set();
  const pages = [];
  const add = (href, label, group) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    pages.push({ href, label, group });
  };

  for (const item of site.nav.items) add(item.href, item.label, 'Pages');
  add(site.nav.ctaHref, site.nav.ctaLabel, 'Pages');
  for (const l of site.footer.resourceLinks) add(l.href, l.label, l.external ? 'Elsewhere' : 'Pages');
  for (const l of site.footer.contactLinks) add(l.href, l.label, 'Pages');

  // The sections of the specifications page, which is the one page on the site
  // with in-page anchors. They come from the jump bar rather than from the
  // equipment sections, because the jump bar is the list somebody chose.
  for (const j of site.pageCopy.specs.jump) add(`/specs/${j.href}`, `Specs — ${j.label}`, 'On the specs page');

  // The documents the site offers. A download is a destination like any other,
  // and these are the three that answers link to.
  add(site.pageCopy.specs.downloadHref, site.pageCopy.specs.downloadLabel, 'Documents');
  add(site.pageCopy.faq.disclosureHref, 'Known issues and disclosure', 'Documents');
  for (const [id, d] of Object.entries(site.pageCopy.faq.downloads || {})) add(d.url, d.label, 'Documents');

  return new Response(JSON.stringify({ pages }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
