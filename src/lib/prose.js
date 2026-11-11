// The two things on this site whose content is a DOCUMENT, as content-layer
// collections fed from the database.
//
// ── why loaders and not a page reading the JSON ────────────────────────────
// Because the bodies are MARKDOWN, and the only markdown processor this site
// should have is Astro's own. A loader is handed `renderMarkdown` by the content
// layer, which is `createMarkdownProcessor` over this project's own markdown
// config — the same processor an .md page goes through. Reading the JSON in a
// page and rendering the body by hand would mean a second markdown
// implementation, and the HTML would differ from what the site served
// yesterday: different heading ids, different smart quotes, a different idea of
// what a tight list is. The whole promise of this migration is that the words
// moved and the page did not change.
//
// It is also the seam Astro already provides. `getCollection` and `render` work
// as they always did; the collection just happens to be filled from rows
// instead of a directory. Same pattern as the kit's blog
// (rp-site-kit/src/lib/posts.js), for the same reason.
//
// ⚠️ /transaction DELIBERATELY DOES NOT USE THIS. That page splits its markdown
// on `## ` headings into a numbered timeline and renders each piece with
// `marked`, which is what it already did — it has never gone through Astro's
// processor. Putting it through one now would change its HTML. It reads
// `site.prose.transaction` directly.
//
// Nothing here touches the network: site.data.json is a plain import, written by
// scripts/pull-content.mjs before astro build.
import site from '../config/site.config.js';

/** Every feature, in the order the content gives them. */
export function featureRows() {
  return site.features || [];
}

/**
 * The content-layer loader for the feature cards.
 *
 * `render()` on one of these entries gives the same component tree the old
 * src/content/features/*.md files gave, because it is the same processor over
 * the same markdown — only the markdown now comes out of `block` rows.
 */
export function featuresLoader() {
  return {
    name: 'rp-features',
    async load({ store, parseData, renderMarkdown, generateDigest, logger }) {
      store.clear();
      const rows = featureRows();
      for (const row of rows) {
        const { body, ...rest } = row;
        const data = await parseData({ id: row.id, data: rest });
        const entry = { id: row.id, data, digest: generateDigest(row) };
        if (body) {
          entry.body = body;
          entry.rendered = await renderMarkdown(body);
        }
        store.set(entry);
      }
      logger.info(`${rows.length} feature(s) from site.data.json`);
    },
  };
}

/**
 * The long-form pages whose body Astro renders: /about and /contact.
 *
 * One entry per page, id = the page name, body = the markdown that used to be
 * src/content/pages/<id>.md below its frontmatter. The frontmatter itself is
 * `pageCopy.<id>` now, because a title and a description are facts about the
 * page rather than part of its prose, and the editor can reach them there.
 */
export function proseLoader() {
  return {
    name: 'rp-prose',
    async load({ store, parseData, renderMarkdown, generateDigest, logger }) {
      store.clear();
      const bodies = site.prose || {};
      for (const id of ['about', 'contact']) {
        const body = bodies[id] || '';
        const data = await parseData({ id, data: { page: id } });
        store.set({ id, data, body, rendered: await renderMarkdown(body), digest: generateDigest(body) });
      }
      logger.info(`2 prose page(s) from site.data.json`);
    },
  };
}
