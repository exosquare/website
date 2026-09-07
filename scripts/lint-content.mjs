import { readdir, readFile } from 'node:fs/promises';
let errors = [];
for (const collection of ['articles', 'projects']) {
  for (const file of await readdir(`src/content/${collection}`, {
    recursive: true,
  })) {
    if (!/\.mdx?$/.test(file)) continue;
    const text = await readFile(`src/content/${collection}/${file}`, 'utf8');
    const content = text
      .split('\n')
      .filter((line) => !line.startsWith('import '))
      .join('\n');
    if (/[—;]/.test(content))
      errors.push(
        `${collection}/${file}: em dash or semicolon in editorial content`,
      );
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('Content punctuation checks passed.');
