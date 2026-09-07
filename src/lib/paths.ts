export function withBase(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base && (path === base || path.startsWith(`${base}/`))
    ? path
    : `${base}${path}`;
}
