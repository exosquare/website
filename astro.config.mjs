import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const siteRoot = fileURLToPath(new URL('.', import.meta.url));

/** Serve public/dir/index.html at /dir/ during astro dev, as the static build does. */
function publicDirectoryIndex() {
  const publicDir = path.join(siteRoot, 'public');
  return {
    name: 'public-directory-index',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        let url;
        try {
          url = new URL(req.url, 'http://localhost');
        } catch {
          return next();
        }
        const pathname = decodeURIComponent(url.pathname);
        if (path.posix.extname(pathname)) return next();
        const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
        const rooted = base && (pathname === base || pathname.startsWith(`${base}/`))
          ? pathname.slice(base.length) || '/'
          : pathname;
        const directory = rooted.endsWith('/') ? rooted : `${rooted}/`;
        const indexPath = path.resolve(publicDir, `.${directory}index.html`);
        const relative = path.relative(publicDir, indexPath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(indexPath)) return next();
        if (!pathname.endsWith('/')) {
          res.statusCode = 308;
          res.setHeader('Location', `${pathname}/${url.search}`);
          res.end();
          return;
        }
        req.url = `${pathname}index.html${url.search}`;
        next();
      });
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL || 'https://exosquare.com',
  base: process.env.BASE_PATH || '/',
  integrations: [
    mdx(),
    ...(process.env.PREVIEW_DRAFTS === 'true' ? [] : [sitemap()]),
  ],
  vite: { plugins: [publicDirectoryIndex()] },
  devToolbar: { enabled: false },
});
