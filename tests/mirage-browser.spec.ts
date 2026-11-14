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

async function ready(page: Page) {
  await page.getByRole('button', { name: 'Shop receipt' }).click();
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
