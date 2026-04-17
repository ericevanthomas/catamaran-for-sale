// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://www.catamaran-for-sale.com',
	integrations: [mdx(), sitemap()],
	image: {
		domains: ['www.catamaran-for-sale.com'],
	},
});
