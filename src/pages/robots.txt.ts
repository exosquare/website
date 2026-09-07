import { withBase } from '../lib/paths';
import type { APIContext } from 'astro';
import { previewDrafts } from '../lib/content';
export function GET({ site }: APIContext) {
  return new Response(
    !site || previewDrafts
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nSitemap: ${new URL(withBase('/sitemap-index.xml'), site).href}\n`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
}
