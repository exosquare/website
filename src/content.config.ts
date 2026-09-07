import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
const record = z.object({
  question: z.string().default(''),
  runs: z.string().default(''),
  evidence: z.string().default(''),
  failed: z.string().default(''),
  changed: z.string().default(''),
  open: z.string().default(''),
});
const contributor = z.object({
  name: z.string(),
  did: z.string(),
  url: z.url().optional(),
});
const figure = z.object({
  src: z.string(),
  alt: z.string(),
  caption: z.string().optional(),
});
const nostr = z
  .object({ url: z.url().optional(), lightning: z.string().optional() })
  .optional();
const common = {
  title: z.string(),
  draft: z.boolean().default(true),
  topic: z.string(),
  publishedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  contributors: z.array(contributor).default([]),
  nostr,
};
const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z
    .object({
      ...common,
      summary: z.string(),
      screenshots: z.array(figure).default([]),
      status: z
        .enum(['shipped', 'in-development', 'experiment', 'archived'])
        .optional(),
      statusChecked: z.coerce.date().optional(),
      record,
      links: z.array(z.object({ label: z.string(), url: z.url() })).default([]),
    })
    .refine((d) => !d.status || !!d.statusChecked, {
      message: 'A status requires a checked date.',
      path: ['statusChecked'],
    })
    .refine((d) => d.draft || !!d.publishedAt, {
      message: 'Published content needs its real publication date.',
    }),
});
const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: z
    .object({
      ...common,
      standfirst: z.string(),
      hero: figure.optional(),
      author: z.string().default('ExoSquare'),
      kind: z
        .enum([
          'Article',
          'Experiment note',
          'Essay',
          'Exploration',
          'Field note',
        ])
        .default('Article'),
      record: record.optional(),
    })
    .refine((d) => d.draft || !!d.publishedAt, {
      message: 'Published content needs its real publication date.',
    }),
});
export const collections = { projects, articles };
