import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('dist');
const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
async function walk(dir) {
  const files = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      files.map((f) =>
        f.isDirectory() ? walk(path.join(dir, f.name)) : path.join(dir, f.name),
      ),
    )
  ).flat();
}
const files = (await walk(root)).filter(
  (f) => f.endsWith('.html'),
);
let links = 0;
for (const file of files) {
  const html = await readFile(file, 'utf8');
  assert.match(html, /<html[^>]+lang="en"/, file + ': language');
  assert.match(html, /name="viewport"/, file + ': viewport');
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, file + ': one h1');
  assert.match(html, /<main\b/, file + ': main landmark');
  for (const match of html.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
    let href = match[1].replaceAll('&amp;', '&');
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    href = href.split(/[?#]/)[0];
    if (basePath && href.startsWith(basePath + '/')) href = href.slice(basePath.length);
    const base = href.startsWith('/') ? root : path.dirname(file);
    const target = path.resolve(
      base,
      '.' + (href.startsWith('/') ? href : '/' + href),
    );
    let found = false;
    for (const candidate of [
      target,
      path.join(target, 'index.html'),
      target + '.html',
    ]) {
      try {
        if ((await stat(candidate)).isFile()) found = true;
      } catch {}
    }
    assert.ok(found, `${file}: broken local link ${href}`);
    links++;
  }
  if (file.includes('/work/') && !file.endsWith('/work/index.html')) {
    for (const row of [
      'Question',
      'What runs',
      'Evidence',
      'What failed',
      'What changed',
      'Still open',
    ])
      assert.ok(html.includes(row), file + ': missing ' + row);
  }
  assert.ok(
    !/mailto:[^"\s]*(?:example\.|placeholder)/i.test(html),
    file + ': placeholder contact',
  );
}
console.log(
  `Verified ${files.length} HTML pages, ${links} local links, landmarks, titles and project record rows.`,
);
