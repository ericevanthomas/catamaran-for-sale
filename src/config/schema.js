// What the templates may rely on.
//
// Parsing is what catches a field that was added to the content and forgotten in
// a template, or renamed in one place and not the other: without it the page
// renders nothing where the words were and it reads as a styling bug. `parse`
// throws instead, at build time, naming the path.
//
// ⚠️ IT IS NOT A DESCRIPTION OF THE DATABASE. The database's shape is
// scripts/_content-map.mjs; this is the contract between the assembled object
// and the markup. Objects are `passthrough()` on purpose: a key a client's own
// edit adds is content, not an error, and the round-trip check is what proves
// nothing was lost. What this file is strict about is the handful of things a
// template would crash on — a list that is not a list, a heading that is gone.
//
// `astro/zod` rather than a `zod` dependency of our own: it is the same copy
// `astro:content` validates frontmatter with, so there is no second version to
// keep in step.
import { z } from 'astro/zod';

const str = z.string();
const opt = z.string().optional();
const linkish = z.object({ label: str, href: str }).passthrough();

/** A section with its own words. Every key is optional; the shape is not. */
const section = (extra = {}) => z.object({
  eyebrow: opt, headline: opt, heading: opt, body: opt, ...extra,
}).passthrough();

const photo = z.object({ id: opt, image: str, alt: str }).passthrough();

export const siteSchema = z.object({
  brand: z.object({
    name: str, model: str, year: str, builder: str,
    footerLogo: str, footerTaglineLines: z.array(str).min(1),
  }).passthrough(),

  seo: z.object({ siteUrl: str, title: str, description: str }).passthrough(),

  contact: z.object({ phone: str }).passthrough(),

  nav: z.object({
    items: z.array(z.object({ id: str, label: str, href: str }).passthrough()).min(1),
    ctaLabel: str, ctaHref: str,
  }).passthrough(),

  footer: z.object({
    contactHeading: str,
    contactLinks: z.array(linkish.extend({ id: str })),
    resourcesHeading: str,
    resourceLinks: z.array(linkish.extend({ id: str })),
    disclaimer: str, copyrightName: str, copyrightSuffix: str,
  }).passthrough(),

  // ── the home page ──────────────────────────────────────────────────────────
  saleStamp: z.object({ href: str, ariaLabel: str, title: str, linkWords: z.array(str) }).passthrough(),
  hero: section({
    headlineLines: z.array(str).min(1),
    ctaText: str, ctaLink: str, photo: str, photoAlt: str,
  }),
  glance: z.object({
    priceDisplay: str, locationDisplay: str,
    items: z.array(z.object({ id: str, label: str, value: str }).passthrough()),
    note: opt, linkText: opt, linkUrl: opt,
  }).passthrough(),
  topPhotos: z.array(photo),
  photosMore: linkish,
  whyChose: section({ photo: str, photoAlt: str }),
  alternatingSections: z.array(z.object({
    id: str, eyebrow: str, heading: str, body: str, image: str,
  }).passthrough()),
  featuresCta: linkish,
  upgradesSection: z.object({
    eyebrow: str.optional(), heading: str,
    items: z.array(z.object({ id: str, title: str, body: str }).passthrough()),
  }).passthrough(),
  bottomPhotos: z.array(photo),
  bottomPhotosMore: linkish,
  highlights: z.object({ eyebrow: opt, heading: str, bullets: z.array(str).min(1) }).passthrough(),
  bottomCta: z.object({
    headline: str, body: str,
    primaryText: str, primaryLink: str, secondaryText: str, secondaryLink: str,
  }).passthrough(),

  // ── the pools ──────────────────────────────────────────────────────────────
  features: z.array(z.object({
    id: str, title: str, description: str,
    photos: z.array(str).default([]),
    video: opt, order: z.number(), featured: z.boolean().default(false),
    draft: z.boolean().default(false), category: opt, cardSize: opt,
    tags: z.array(str).optional(),
    quote: z.object({ speaker: z.enum(['eric', 'alex']), text: str }).optional(),
    body: z.string().default(''),
  }).passthrough()).min(1),

  specs: z.array(z.object({
    id: str, label: str, value: str, group: str, order: z.number(),
  }).passthrough()).min(1),

  faqs: z.array(z.object({
    id: str, question: str, answer: str, category: opt,
    tags: z.array(str).optional(),
    download: z.object({ url: str, label: str }).optional(),
  }).passthrough()).min(1),
  // WHICH questions the FAQ page shows, in its order: the `block_pick` set on
  // `faq:list`, resolved by assemble(). `faqs` above is that list already
  // resolved; this is the ids, which is what the editor's picker writes.
  faqIds: z.array(str).min(1),

  gallery: z.array(z.object({
    id: str, image: str, alt: str, caption: opt, category: opt,
    order: z.number(), inGallery: z.boolean().default(true),
  }).passthrough()).min(1),

  // ── the specs page's equipment inventory ───────────────────────────────────
  // `v` is PLAIN WORDS. It was inner HTML for about an hour, until the
  // before/after diff showed that the badge spans inside it rendered unstyled
  // (see the long note in src/pages/specs.astro). `badge` is the flag that
  // markup carried.
  equipment: z.array(z.object({
    id: str, heading: str, note: opt,
    items: z.array(z.object({ t: z.enum(['li', 'h3']), v: str, badge: opt }).passthrough()),
  }).passthrough()).min(1),

  // ── per-page copy ──────────────────────────────────────────────────────────
  pageCopy: z.object({
    home: z.object({ title: str, description: str }).passthrough(),
    features: z.object({
      title: str, description: str, eyebrow: str, h1: str, sub: str, cardMore: str,
      videoLabel: str, detailsLabel: str, relatedLabel: str,
      categoryOrder: z.array(str).min(1), otherLabel: str,
    }).passthrough(),
    specs: z.object({
      title: str, description: str, eyebrow: str, h1: str, sub: str,
      downloadLabel: str, downloadHref: str,
      jump: z.array(z.object({ id: str, href: str, label: str }).passthrough()).min(1),
      groupOrder: z.array(str).min(1),
      layout: z.object({ heading: str, image: str, alt: str, caption: str }).passthrough(),
      ctaBody: str, ctaLabel: str, ctaHref: str,
    }).passthrough(),
    gallery: z.object({
      title: str, description: str, eyebrow: str, h1: str, sub: str, allLabel: str,
    }).passthrough(),
    faq: z.object({
      title: str, description: str, eyebrow: str, h1: str, sub: str,
      categoryOrder: z.array(str).min(1),
      disclosureCategory: str, disclosureLabel: str, disclosureHref: str, pillLabel: str,
      ctaHeading: str, ctaBody: str, ctaLabel: str, ctaHref: str,
      // ⚠️ Both arguments. `z.record(value)` with one argument defaults its key
      // schema to something that rejects a dash, so every question id here —
      // `storm-damage`, `rigging-condition` — came back "Invalid key in record"
      // and failed the build. Keys are question ids, so they are plain strings.
      downloads: z.record(z.string(), z.object({ url: str, label: str }).passthrough()).default({}),
    }).passthrough(),
    about: z.object({
      title: str, description: str, eyebrow: str, h1: str, photo: str, photoAlt: str,
      positionEyebrow: str, positionHeading: str, positionNote: str, positionEmbed: str,
      ctaHeading: str, ctaBody: str, ctaLabel: str, ctaHref: str,
    }).passthrough(),
    contact: z.object({
      title: str, description: str, eyebrow: str, h1: str, sub: str,
      sideHeading: str, sideBody: str,
    }).passthrough(),
    transaction: z.object({
      title: str, description: str, eyebrow: str, h1: str,
      statusLabel: str, statusTitle: str, statusBody: str, statusSoft: str,
      ctaHeading: str, ctaBody: str, ctaLabel: str, ctaHref: str,
    }).passthrough(),
    notFound: z.object({
      title: str, description: str, h1: str, body: str, ctaLabel: str, ctaHref: str,
    }).passthrough(),
  }).passthrough(),

  // ── the three long-form pages, still markdown ──────────────────────────────
  prose: z.object({ about: str, contact: str, transaction: str }).passthrough(),
}).passthrough();

/** Validate, or throw with the path that is wrong. */
export function validateSite(data) {
  const r = siteSchema.safeParse(data);
  if (r.success) return r.data;
  const lines = r.error.issues.slice(0, 20).map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(
    `src/config/site.data.json does not match src/config/schema.js:\n${lines.join('\n')}\n`
    + (r.error.issues.length > 20 ? `  … and ${r.error.issues.length - 20} more\n` : '')
    + '\nThis is content read out of this site\'s own database. Either a template\n'
    + 'expects something the database no longer has, or scripts/_assemble.mjs and\n'
    + 'scripts/_content-map.mjs have fallen out of step. `npm run check:content`\n'
    + 'compares the database against src/config/site.seed.json and will say which.\n',
  );
}

export default siteSchema;
