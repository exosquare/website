import { withBase } from '../lib/paths';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
export async function GET({ site }: APIContext) {
  if (!site)
    return new Response(
      'Sitemap is available once a canonical site URL is configured.\n',
    );
  const articles = await getCollection('articles', ({ data }) => !data.draft);
  const projects = await getCollection('projects', ({ data }) => !data.draft);
  const paths = [
    '/',
    '/work/',
    '/writing/',
    '/studio/',
    '/contact/',
    '/privacy/',
    '/terms/',
    ...articles.map((x) => `/writing/${x.id}/`),
    ...projects.map((x) => `/work/${x.id}/`),
  ];
  return new Response(
    paths.map((path) => new URL(withBase(path), site).href).join('\n') + '\n',
    { headers: { 'Content-Type': 'text/plain' } },
  );
}
