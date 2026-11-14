import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ timeout: 180_000 });

function track(page: Page) {
  const outside: string[] = [];
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    seen.push(url);
    if (!url.startsWith('http://127.0.0.1:4175/')) outside.push(url);
  });
  return { outside, seen };
}

test('the trailing-slash URL serves the experiment', async ({ page }) => {
  const response = await page.goto('experiments/mirage/');
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname.endsWith('/experiments/mirage/')).toBe(true);
  await expect(page).toHaveTitle('On-device vision');
  await expect(page.locator('#mark')).toHaveAttribute('role', 'img');
  await expect(page.getByRole('button', { name: 'Download model' })).toBeVisible();
});

async function ready(page: Page) {
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await expect(page.locator('#mark')).toHaveAttribute('aria-label', 'Shop receipt, sample');
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Ready');
}

test('a real run stays on this origin and makes no requests while running', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference is enough.');
  const traffic = track(page);
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.fallback();
    return route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('experiments/mirage/');
  await ready(page);
  const before = traffic.seen.length;
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finding objects', { timeout: 30_000 });
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  await expect(page.locator('#rule-line')).toContainText('Page rule');
  await expect(page.locator('#run-count')).toHaveText('0');
  await expect(page.locator('#run-bytes')).toHaveText('0 B');
  expect(traffic.seen.slice(before)).toEqual([]);
  expect(traffic.outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('no request leaves this origin at any point', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Covered with the desktop run.');
  const traffic = track(page);
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.fallback();
    return route.abort();
  });
  await page.goto('experiments/mirage/');
  await ready(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).not.toHaveText('', { timeout: 120_000 });
  expect(traffic.outside).toEqual([]);
});

test('a same-origin probe is counted on the run row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The probe flag is checked once.');
  await page.context().route('**/vision-worker.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      self.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === 'load') {
          postMessage({ type: 'progress', loaded: 10, total: 20, fromCache: false });
          postMessage({ type: 'ready' });
        }
        if (data.type === 'run') {
          setTimeout(() => postMessage({ type: 'result', objects: [], text: [], ms: 400 }), 300);
        }
      };
    `,
  }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('experiments/mirage/?run-probe=1');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toHaveText('Nothing recognisable found.');
  await expect(page.locator('#run-count')).not.toHaveText('0');
  await expect(page.locator('#net-run')).toHaveClass(/warn/);
  await expect(page.locator('#run-requests')).toContainText('run-probe.txt');
  const bytes = await page.locator('#run-bytes').innerText();
  expect(bytes).toMatch(/^\d+ B$/);
  expect(bytes).not.toBe('0 B');
  expect(errors).toEqual([]);
});

test('hovering a row lights only that row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference covers the link.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Desk with a laptop and a cup' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/cup|notebook/i, { timeout: 120_000 });

  const objectId = await page.evaluate(() => {
    const linked = new Set(
      [...document.querySelectorAll('#because [data-id]')].map((node) => (node as HTMLElement).dataset.id),
    );
    const row = [...document.querySelectorAll<HTMLElement>('.object-row')].find(
      (node) => node.dataset.id && !linked.has(node.dataset.id),
    );
    return row?.dataset.id || '';
  });
  expect(objectId).not.toBe('');
  const objectRow = page.locator(`.object-row[data-id="${objectId}"]`);
  await objectRow.hover();
  await expect(objectRow).toHaveClass(/is-hot/);
  await expect(page.locator('.object-row.is-hot')).toHaveCount(1);
  await expect(page.locator(`.box.is-hot[data-id="${objectId}"]`)).toHaveCount(1);
  await expect(page.locator('.because.is-hot')).toHaveCount(0);
  await expect(page.locator('.text-row.is-hot')).toHaveCount(0);
  await objectRow.hover({ position: { x: 12, y: 8 } });
  await expect(objectRow).toHaveClass(/is-hot/);
  await expect(page.locator('.because.is-hot')).toHaveCount(0);
  await expect(page.locator('.text-row.is-hot')).toHaveCount(0);

  const textRow = page.locator('.text-row').first();
  await expect(textRow).toBeVisible();
  const textId = await textRow.getAttribute('data-id');
  await textRow.hover();
  await expect(textRow).toHaveClass(/is-hot/);
  await expect(page.locator('.text-row.is-hot')).toHaveCount(1);
  await expect(page.locator('.object-row.is-hot')).toHaveCount(0);
  await expect(page.locator('.because.is-hot')).toHaveCount(0);
  await expect(page.locator(`.box.is-hot[data-id="${textId}"]`)).toHaveCount(1);
});

test('the stage is still once idle', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Motion idle is checked once.');
  await page.goto('experiments/mirage/');
  await expect(page.locator('#mark')).toHaveAttribute('data-raf', '0');
  const frames = await page.evaluate(() => new Promise((resolve) => {
    let count = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      count += 1;
      return original(callback);
    };
    setTimeout(() => resolve(count), 400);
  }));
  expect(frames).toBe(0);
});
