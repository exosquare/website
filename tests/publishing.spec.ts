import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? pages(file)
      : file.endsWith('.html')
        ? [file]
        : [];
  });
}
const routes = pages('dist')
  .map((file) => path.relative('dist', file).split(path.sep).join('/'))
  .filter((file) => file !== '404.html')
  .map((file) => file.replace(/index\.html$/, ''))
  .sort();
const prefix = (process.env.BASE_PATH || '').replace(/\/$/, '');
const site = process.env.SITE_URL || 'https://exosquare.com';

test.beforeEach(async ({ context, baseURL }) => {
  // Third-party availability is outside the local publishing check.
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
});

for (const route of routes) {
  test(`published page: /${route}`, async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(new URL(route, baseURL).href);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new URL(`${prefix}/${route}`, site).href,
    );
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const localImages = page.locator('img');
    await expect
      .poll(() =>
        localImages.evaluateAll((images) =>
          images.every((node) => {
            const image = node as HTMLImageElement;
            const url = new URL(image.currentSrc || image.src, location.href);
            if (url.protocol !== 'data:' && url.origin !== location.origin)
              return true;
            // Lazy images outside the viewport need not have been requested yet.
            if (
              image.loading === 'lazy' &&
              image.getBoundingClientRect().top >= innerHeight
            )
              return true;
            return image.complete && image.naturalWidth > 0;
          }),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
}

test('shared navigation, theme persistence and local fonts', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.goto(baseURL!);
  const loaded = await page.evaluate(async () => {
    const fonts = await Promise.all([
      document.fonts.load('300 16px HN'),
      document.fonts.load('700 16px HN'),
      document.fonts.load('400 16px "Space Mono"'),
    ]);
    return fonts.every(
      (faces) =>
        faces.length > 0 && faces.every((face) => face.status === 'loaded'),
    );
  });
  expect(loaded).toBe(true);
  const menu = page.locator('.menu-toggle');
  if (testInfo.project.name === 'mobile') {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await menu.click();
  }
  await page
    .getByRole('navigation', { name: 'Primary' })
    .locator('a[href$="/writing/"]')
    .click();
  await expect(page).toHaveURL(new URL('writing/', baseURL).href);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
