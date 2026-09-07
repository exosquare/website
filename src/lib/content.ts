import { getCollection } from 'astro:content';
export const previewDrafts = import.meta.env.PREVIEW_DRAFTS === 'true';
export async function projects() {
  return (
    await getCollection('projects', ({ data }) => previewDrafts || !data.draft)
  ).sort(sortEntries);
}
export async function articles() {
  return (
    await getCollection('articles', ({ data }) => previewDrafts || !data.draft)
  ).sort(sortEntries);
}
function sortEntries(
  a: { data: { publishedAt?: Date } },
  b: { data: { publishedAt?: Date } },
) {
  return (
    (b.data.publishedAt?.getTime() ?? 0) - (a.data.publishedAt?.getTime() ?? 0)
  );
}
export function readingTime(body = '') {
  return Math.max(
    1,
    Math.ceil(body.replace(/<[^>]+>/g, '').split(/\s+/).length / 220),
  );
}
export const formatDate = (date: Date) => date.toISOString().slice(0, 10);
