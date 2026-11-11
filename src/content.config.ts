import { defineCollection, z } from 'astro:content';
import { featuresLoader, proseLoader } from './lib/prose.js';

// ⚠️ TWO COLLECTIONS, AND THEY COME OUT OF THE DATABASE.
//
// This file used to declare five collections over 250 markdown files:
// `features`, `faq`, `gallery`, `specs` and `pages`. Four of those were
// RECORDS -- a spec row, a question, a photograph, a page's title -- and a
// record is a shape we define, so they are rows now: `setting`, `block`,
// `block_pick` and `faq` in rp-catamaran, assembled by
// scripts/_assemble.mjs into src/config/site.data.json. The pages read them
// through src/config/site.config.js.
//
// What is left is the two whose content is genuinely a DOCUMENT: markdown
// somebody wrote, rendered by a markdown processor. That is what the content
// layer is for, and it is why these two stayed -- the body still goes through
// Astro's own processor, so the rendered HTML did not move when the words did
// (see src/lib/prose.js).
//
// Same split the kit arrived at on 2026-11-11: "a service page is a shape we
// define. A blog post is a DOCUMENT."

const features = defineCollection({
  loader: featuresLoader(),
  // The schema here is the one the MODAL templates rely on. It is deliberately
  // loose about everything optional: src/config/schema.js has already validated
  // the same data on the way in, and a second strict gate would stop the build
  // over a field one card has not filled in.
  schema: z.object({
    title: z.string(),
    description: z.string(),
    photos: z.array(z.string()).default([]),
    video: z.string().optional(),
    order: z.number(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    category: z.string().optional(),
    cardSize: z.string().default('medium'),
    tags: z.array(z.string()).optional(),
    quote: z.object({ speaker: z.enum(['eric', 'alex']), text: z.string() }).optional(),
  }),
});

const prose = defineCollection({
  loader: proseLoader(),
  schema: z.object({ page: z.string() }),
});

export const collections = { features, prose };
