// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://www.catamaran-for-sale.com',
	integrations: [mdx(), sitemap()],
	build: {
		// 9KB of CSS isn't worth a render-blocking request. Inline all styles.
		inlineStylesheets: 'always',
	},
	image: {
		domains: ['www.catamaran-for-sale.com'],
		service: {
			entrypoint: 'astro/assets/services/sharp',
			config: {
				limitInputPixels: false,
			},
		},
	},
});
