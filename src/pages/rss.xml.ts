import { withBase } from '../lib/paths';
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
export async function GET(context: APIContext) {
  if (!context.site)
    return new Response(
      'RSS is available once a canonical site URL is configured.\n',
      { headers: { 'Content-Type': 'text/plain' } },
    );
  const articles = await getCollection('articles', ({ data }) => !data.draft);
  return rss({
    title: 'ExoSquare writing',
    description:
      'Writing from an independent idea and experimental technology studio.',
    site: context.site,
    items: articles.map(({ id, data }) => ({
      title: data.title,
      description: data.standfirst,
      pubDate: data.publishedAt!,
      link: withBase(`/writing/${id}/`),
    })),
  });
}
