import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.SITE_URL || 'https://exosquare.com',
  base: process.env.BASE_PATH || '/',
  integrations: [
    mdx(),
    ...(process.env.PREVIEW_DRAFTS === 'true' ? [] : [sitemap()]),
  ],
  devToolbar: { enabled: false },
});
