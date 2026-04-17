import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const features = defineCollection({
	loader: glob({ base: './src/content/features', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		photos: z.array(z.string()).default([]),
		video: z.string().optional(),
		order: z.number(),
		featured: z.boolean().default(false),
		category: z
			.enum([
				'Sailing Performance',
				'Living Spaces',
				'Systems & Equipment',
				'Safety',
				'Electrical',
				'Plumbing',
				'Navigation',
				'Rigging & Sails',
				'Dinghy & Tender',
				'Recent Upgrades',
			])
			.optional(),
		cardSize: z.enum(['large', 'medium', 'small']).default('medium'),
		tags: z.array(z.string()).optional(),
		quote: z
			.object({
				speaker: z.enum(['eric', 'alex']),
				text: z.string(),
			})
			.optional(),
	}),
});

const faq = defineCollection({
	loader: glob({ base: './src/content/faq', pattern: '**/*.md' }),
	schema: z.object({
		question: z.string(),
		answer: z.string(),
		order: z.number(),
		category: z.enum([
			'About the Boat',
			'Condition & History',
			'The Sale',
			'Viewing & Location',
			'Systems & Equipment',
			'Ownership & Documentation',
		]).default('About the Boat'),
		tags: z.array(z.string()).optional(),
	}),
});

const gallery = defineCollection({
	loader: glob({ base: './src/content/gallery', pattern: '**/*.md' }),
	schema: z.object({
		image: z.string(),
		caption: z.string().optional(),
		category: z
			.enum(['Exterior', 'Interior', 'Sailing', 'Aerials', 'Systems', 'Lifestyle'])
			.optional(),
		order: z.number(),
		alt: z.string(),
	}),
});

const specs = defineCollection({
	loader: glob({ base: './src/content/specs', pattern: '**/*.md' }),
	schema: z.object({
		label: z.string(),
		value: z.string(),
		group: z.enum([
			'Dimensions',
			'Performance',
			'Engines & Propulsion',
			'Tankage',
			'Accommodations',
			'Construction',
		]),
		order: z.number(),
	}),
});

const pages = defineCollection({
	loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		heroHeadline: z.string().optional(),
		heroSubheadline: z.string().optional(),
		heroImage: z.string().optional(),
		priceDisplay: z.string().optional(),
		locationDisplay: z.string().optional(),
		highlightsBullets: z.array(z.string()).optional(),
		photoStripImages: z.array(z.string()).optional(),
		photoStripCTA: z.string().optional(),
		photoStripCTALink: z.string().optional(),
		// Editable homepage copy blocks
		heroEyebrow: z.string().optional(),
		heroHeadlineLines: z.array(z.string()).optional(),
		heroCtaText: z.string().optional(),
		heroCtaLink: z.string().optional(),
		whyChoseEyebrow: z.string().optional(),
		whyChoseHeading: z.string().optional(),
		whyChoseBody: z.string().optional(),
		upgradesEyebrow: z.string().optional(),
		upgradesHeading: z.string().optional(),
		upgrades: z
			.array(
				z.object({
					title: z.string(),
					body: z.string(),
				}),
			)
			.optional(),
		highlightsEyebrow: z.string().optional(),
		highlightsHeading: z.string().optional(),
		ctaHeadline: z.string().optional(),
		ctaBody: z.string().optional(),
		ctaPrimaryText: z.string().optional(),
		ctaPrimaryLink: z.string().optional(),
		ctaSecondaryText: z.string().optional(),
		ctaSecondaryLink: z.string().optional(),
	}),
});

export const collections = { features, faq, gallery, specs, pages };
