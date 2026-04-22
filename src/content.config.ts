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
		draft: z.boolean().default(false),
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
		inGallery: z.boolean().default(true),
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
		// Grouped homepage sections
		hero: z
			.object({
				eyebrow: z.string().optional(),
				headline: z.string().optional(),
				headlineLines: z.array(z.string()).optional(),
				subheadline: z.string().optional(),
				image: z.string().optional(),
				ctaText: z.string().optional(),
				ctaLink: z.string().optional(),
			})
			.optional(),
		glance: z
			.object({
				priceDisplay: z.string().optional(),
				locationDisplay: z.string().optional(),
				items: z
					.array(z.object({ label: z.string(), value: z.string() }))
					.optional(),
				note: z.string().optional(),
				linkText: z.string().optional(),
				linkUrl: z.string().optional(),
			})
			.optional(),
		topPhotos: z
			.array(
				z.object({
					image: z.string(),
					alt: z.string(),
				}),
			)
			.optional(),
		whyChose: z
			.object({
				eyebrow: z.string().optional(),
				heading: z.string().optional(),
				body: z.string().optional(),
			})
			.optional(),
		upgradesSection: z
			.object({
				eyebrow: z.string().optional(),
				heading: z.string().optional(),
				items: z
					.array(z.object({ title: z.string(), body: z.string() }))
					.optional(),
			})
			.optional(),
		alternatingSections: z
			.array(
				z.object({
					eyebrow: z.string(),
					heading: z.string(),
					body: z.string(),
					image: z.string(),
				}),
			)
			.optional(),
		highlights: z
			.object({
				eyebrow: z.string().optional(),
				heading: z.string().optional(),
				bullets: z.array(z.string()).optional(),
			})
			.optional(),
		bottomCta: z
			.object({
				headline: z.string().optional(),
				body: z.string().optional(),
				primaryText: z.string().optional(),
				primaryLink: z.string().optional(),
				secondaryText: z.string().optional(),
				secondaryLink: z.string().optional(),
			})
			.optional(),
	}),
});

export const collections = { features, faq, gallery, specs, pages };
