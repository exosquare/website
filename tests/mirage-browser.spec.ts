import { inflateSync } from 'node:zlib';
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
  await expect(page.locator('#object-rows .empty')).toHaveText('No objects found.');
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
  await expect(page.locator('.tag.shown.is-dim').first()).toHaveCSS('opacity', '0.4');
  await expect(page.locator('.because.is-hot')).toHaveCount(0);
  await expect(page.locator('.text-row.is-hot')).toHaveCount(0);
  await objectRow.hover({ position: { x: 12, y: 8 } });
  await expect(objectRow).toHaveClass(/is-hot/);
  await expect(page.locator('.because.is-hot')).toHaveCount(0);
  await expect(page.locator('.text-row.is-hot')).toHaveCount(0);

  let textRow = page.locator('.text-row').first();
  if (await textRow.count() === 0) {
    await page.getByRole('button', { name: 'Shop receipt' }).click();
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect(page.locator('#verdict')).toContainText(/CHF|Log/, { timeout: 120_000 });
    textRow = page.locator('.text-row').first();
  }
  await expect(textRow).toBeVisible();
  const textId = await textRow.getAttribute('data-id');
  await textRow.hover();
  await expect(textRow).toHaveClass(/is-hot/);
  await expect(page.locator('.text-row.is-hot')).toHaveCount(1);
  await expect(page.locator('.object-row.is-hot')).toHaveCount(0);
  const hotBecause = await page.locator('.because.is-hot').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.ids || (node as HTMLElement).dataset.id || ''));
  expect(hotBecause.every((ids) => ids.split(/[\s,]+/).includes(textId || ''))).toBe(true);
  await expect(page.locator(`.box.is-hot[data-id="${textId}"]`)).toHaveCount(1);
});

test('a new result collapses an expanded list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Expansion reset is checked once.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#text-rows .more')).toBeVisible({ timeout: 120_000 });
  await page.locator('#text-rows .more').click();
  const expanded = await page.locator('#text-rows .text-row').count();
  expect(expanded).toBeGreaterThan(8);
  await page.getByRole('button', { name: 'Desk with a laptop and a cup' }).click();
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.locator('#verdict')).toContainText(/cup|notebook/i, { timeout: 120_000 });
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  await expect(page.locator('#text-rows .text-row')).toHaveCount(8);
  await expect(page.locator('#text-rows .more')).toBeVisible();
});

test('a new object result collapses an expanded list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Expansion reset is checked once.');
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let runs = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const post = this.postMessage.bind(this);
        this.postMessage = (data: unknown) => {
          const message = data as { type?: string };
          if (message?.type === 'load') {
            this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
            return;
          }
          if (message?.type === 'run') {
            runs += 1;
            const count = runs === 1 ? 10 : 9;
            const objects = Array.from({ length: count }, (_, index) => ({
              name: `thing ${index + 1}`,
              score: 0.9 - index * 0.01,
              bbox: [20, 20 + index * 20, 80, 36 + index * 20],
            }));
            this.dispatchEvent(new MessageEvent('message', { data: { type: 'result', objects, text: [], ms: 10 } }));
            return;
          }
          post(data);
        };
      }
    };
  });
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#object-rows .more')).toHaveText('and 2 more', { timeout: 30_000 });
  await page.locator('#object-rows .more').click();
  await expect(page.locator('#object-rows .object-row')).toHaveCount(10);
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.locator('#object-rows .object-row')).toHaveCount(8, { timeout: 30_000 });
  await expect(page.locator('#object-rows .more')).toHaveText('and 1 more');
});

test('Enter on and more focuses the first new row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard expansion is checked once.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  const before = await page.locator('#text-rows .text-row').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.id));
  const more = page.locator('#text-rows .more');
  await more.focus();
  await page.keyboard.press('Enter');
  const after = await page.locator('#text-rows .text-row').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.id));
  const revealed = after.find((id) => id && !before.includes(id));
  expect(revealed).toBeTruthy();
  await expect(page.locator(`#text-rows .text-row[data-id="${revealed}"]`)).toBeFocused();
});

test('Enter on and more focuses the first new object row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard expansion is checked once.');
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const post = this.postMessage.bind(this);
        this.postMessage = (data: unknown) => {
          const message = data as { type?: string };
          if (message?.type === 'load') {
            this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
            return;
          }
          if (message?.type === 'run') {
            const objects = Array.from({ length: 10 }, (_, index) => ({
              name: `thing ${index + 1}`,
              score: 0.9 - index * 0.01,
              bbox: [20, 20 + index * 30, 80, 40 + index * 30],
            }));
            this.dispatchEvent(new MessageEvent('message', { data: { type: 'result', objects, text: [], ms: 10 } }));
            return;
          }
          post(data);
        };
      }
    };
  });
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#object-rows .more')).toHaveText('and 2 more', { timeout: 30_000 });
  const before = await page.locator('#object-rows .object-row').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.id));
  await page.locator('#object-rows .more').focus();
  await page.keyboard.press('Enter');
  const after = await page.locator('#object-rows .object-row').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.id));
  const revealed = after.find((id) => id && !before.includes(id));
  expect(revealed).toBeTruthy();
  await expect(page.locator(`#object-rows .object-row[data-id="${revealed}"]`)).toBeFocused();
});

test('the total line lights the amount and the currency', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference covers the total row.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  const because = page.locator('#because button.because', { hasText: 'Total line' });
  await expect(because).toBeVisible();
  const ids = ((await because.getAttribute('data-ids')) || '').split(/\s+/).filter(Boolean);
  expect(ids).toHaveLength(3);
  await because.hover();
  for (const id of ids) {
    await expect(page.locator(`.text-row[data-id="${id}"]`)).toHaveClass(/is-hot/);
    await expect(page.locator(`svg .box[data-id="${id}"]`)).toHaveClass(/is-hot/);
  }
  await expect(page.locator('.text-row.is-hot')).toHaveCount(3);
  await expect(page.locator('svg .box.is-hot')).toHaveCount(3);
  await because.focus();
  await expect(because).toBeFocused();
  for (const id of ids) {
    await expect(page.locator(`.text-row[data-id="${id}"]`)).toHaveClass(/is-hot/);
    await expect(page.locator(`svg .box[data-id="${id}"]`)).toHaveClass(/is-hot/);
  }
  await expect(page.locator('#text-rows .text-row')).toHaveCount(8);
  const more = page.locator('#text-rows .more');
  await expect(more).toHaveText(/^and \d+ more$/);
  const extra = Number((await more.innerText()).replace(/\D/g, ''));
  expect(extra).toBeGreaterThan(0);
  await more.click();
  await expect(page.locator('#text-rows .text-row')).toHaveCount(8 + extra);
});

test('keyboard focus keeps the highlight while the pointer stays still', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Pointer and keyboard modality is checked once.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  const because = page.locator('#because button.because', { hasText: 'Total line' });
  const owned = ((await because.getAttribute('data-ids')) || '').split(/\s+/).filter(Boolean);
  expect(owned.length).toBeGreaterThan(0);
  const otherId = await page.locator('#text-rows .text-row').evaluateAll((nodes, cited) => {
    const row = nodes.find((node) => !cited.includes((node as HTMLElement).dataset.id || ''));
    return (row as HTMLElement | undefined)?.dataset.id || '';
  }, owned);
  expect(otherId).not.toBe('');
  const other = page.locator(`#text-rows .text-row[data-id="${otherId}"]`);
  await expect(other).toBeVisible();

  async function stillOwned() {
    await expect(because).toBeFocused();
    await expect(page.locator(`.text-row[data-id="${owned[0]}"]`)).toHaveClass(/is-hot/);
    await expect(page.locator(`svg .box[data-id="${owned[0]}"]`)).toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);
  }

  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    const box = await other.boundingBox();
    expect(box).toBeTruthy();
    const point = { x: box!.x + Math.min(12, box!.width / 2), y: box!.y + Math.min(8, box!.height / 2) };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await because.focus();
    await page.mouse.wheel(0, 180);
    await page.evaluate((spot) => {
      const under = document.elementFromPoint(spot.x, spot.y);
      under?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: spot.x, clientY: spot.y, pointerType: 'mouse' }));
      document.querySelector('#stage')?.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        clientX: spot.x,
        clientY: spot.y,
        pointerType: 'mouse',
        relatedTarget: document.body,
      }));
    }, point);
    await stillOwned();
  }

  const box = await other.boundingBox();
  await page.mouse.move(box!.x + 4, box!.y + 4);
  await other.hover();
  await expect(other).toHaveClass(/is-hot/);
  await expect(page.locator(`.text-row[data-id="${owned[0]}"]`)).not.toHaveClass(/is-hot/);
});

test('the first real pointer move takes the highlight', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Pointer and keyboard modality is checked once.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  const citation = page.locator('#because button.because').first();
  const owned = ((await citation.getAttribute('data-ids')) || '').split(/\s+/).filter(Boolean);
  const otherId = await page.locator('#text-rows .text-row').evaluateAll((nodes, cited) => {
    const row = nodes.find((node) => !cited.includes((node as HTMLElement).dataset.id || ''));
    return (row as HTMLElement | undefined)?.dataset.id || '';
  }, owned);
  const other = page.locator(`#text-rows .text-row[data-id="${otherId}"]`);
  const hit = page.locator(`.box-hit[data-id="${otherId}"]`);
  const blank = page.locator('#verdict');

  async function own(node: ReturnType<typeof page.locator>) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await node.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await expect(node).toBeFocused();
    await expect(node).toHaveClass(/is-hot/);
  }

  async function rest(node: ReturnType<typeof page.locator>) {
    await node.scrollIntoViewIfNeeded();
    const box = await node.boundingBox();
    expect(box).toBeTruthy();
    const x = box!.x + Math.min(12, Math.max(2, box!.width / 2));
    const y = box!.y + Math.min(8, Math.max(2, box!.height / 2));
    await page.mouse.move(x, y);
    return { x: Math.min(box!.x + box!.width - 1, x + 1), y };
  }

  async function take(node: ReturnType<typeof page.locator>, from: ReturnType<typeof page.locator>) {
    const next = await rest(node);
    await own(from);
    await expect(node).not.toHaveClass(/is-hot/);
    await page.mouse.move(next.x, next.y);
    await expect(from).toBeFocused();
    await expect(node).toHaveClass(/is-hot/);
    await expect(from).not.toHaveClass(/is-hot/);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await expect(from).toBeFocused();
    await expect(from).toHaveClass(/is-hot/);
    await expect(node).not.toHaveClass(/is-hot/);
  }

  for (const [width, height, reduced] of [[1440, 900, false], [1440, 900, true], [390, 844, false], [390, 844, true]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await take(other, citation);
    await take(hit, citation);
    await take(citation, other);
    const next = await rest(blank);
    await own(citation);
    await page.mouse.move(next.x, next.y);
    await expect(citation).toBeFocused();
    await expect(citation).not.toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
  }
});

test('a cold keyboard session yields on the first pointer move', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Pointer and keyboard modality is checked once.');
  test.setTimeout(300_000);

  async function keyboardRun() {
    await page.goto('experiments/mirage/');
    await page.evaluate(() => {
      const log: Array<Record<string, unknown>> = [];
      document.querySelector('#stage')?.addEventListener('pointermove', (event) => {
        const pointer = event as PointerEvent;
        log.push({
          x: pointer.clientX,
          y: pointer.clientY,
          mx: pointer.movementX,
          my: pointer.movementY,
          id: (pointer.target as HTMLElement | null)?.closest?.('[data-id], [data-ids]')?.getAttribute('data-id') || '',
        });
      }, true);
      (window as unknown as { __moves: typeof log }).__moves = log;
    });
    await page.getByRole('button', { name: 'Shop receipt' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /Download model|Load model/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Run' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });
  }

  function inside(box: { x: number, y: number, width: number, height: number }, x: number, y: number) {
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  }

  for (const [width, height, reduced, target] of [
    [1440, 900, false, 'row'],
    [1440, 900, true, 'empty'],
    [390, 844, false, 'row'],
    [390, 844, true, 'empty'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await keyboardRun();
    const citation = page.locator('#because button.because').first();
    const owned = ((await citation.getAttribute('data-ids')) || '').split(/\s+/).filter(Boolean);
    const otherId = await page.locator('#text-rows .text-row').evaluateAll((nodes, cited) => {
      const row = nodes.find((node) => !cited.includes((node as HTMLElement).dataset.id || ''));
      return (row as HTMLElement | undefined)?.dataset.id || '';
    }, owned);
    const other = page.locator(`#text-rows .text-row[data-id="${otherId}"]`);
    const ownedRow = page.locator(`.text-row[data-id="${owned[0]}"]`);
    await citation.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press('ArrowDown');
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(ownedRow).toHaveClass(/is-hot/);

    const stage = await page.locator('#stage').boundingBox();
    expect(stage).toBeTruthy();
    let outsideX = Math.max(0, stage!.x - 30);
    let outsideY = Math.max(0, stage!.y - 24);
    if (inside(stage!, outsideX, outsideY)) {
      outsideX = Math.min(width - 2, stage!.x + stage!.width + 8);
      outsideY = 2;
    }
    expect(inside(stage!, outsideX, outsideY)).toBe(false);
    await page.mouse.move(outsideX, outsideY, { steps: 1 });
    const before = await page.evaluate(() => (window as unknown as { __moves: unknown[] }).__moves.length);

    const destination = target === 'row' ? other : page.locator('#verdict');
    await destination.scrollIntoViewIfNeeded();
    const spot = await destination.boundingBox();
    expect(spot).toBeTruthy();
    const land = { x: spot!.x + Math.min(16, Math.max(3, spot!.width / 2)), y: spot!.y + Math.min(8, Math.max(3, spot!.height / 2)) };
    await page.mouse.move(land.x, land.y, { steps: 1 });
    const moves = await page.evaluate(() => (window as unknown as { __moves: Array<{ mx: number, my: number, id: string }> }).__moves);
    const path = moves.slice(before);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some((step) => step.mx !== 0 || step.my !== 0)).toBe(true);

    await expect(citation).toBeFocused();
    if (target === 'row') {
      await expect(other).toHaveClass(/is-hot/);
      await expect(citation).not.toHaveClass(/is-hot/);
      await expect(ownedRow).not.toHaveClass(/is-hot/);
    } else {
      await expect(citation).not.toHaveClass(/is-hot/);
      await expect(ownedRow).not.toHaveClass(/is-hot/);
      await expect(other).not.toHaveClass(/is-hot/);
    }

    await page.keyboard.press('ArrowDown');
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(ownedRow).toHaveClass(/is-hot/);

    const still = await other.boundingBox();
    expect(still).toBeTruthy();
    const parked = { x: still!.x + Math.min(12, still!.width / 2), y: still!.y + Math.min(8, still!.height / 2) };
    await page.mouse.move(parked.x, parked.y);
    await page.keyboard.press('ArrowDown');
    await expect(citation).toHaveClass(/is-hot/);
    await page.mouse.wheel(0, 120);
    await page.evaluate((point) => {
      const under = document.elementFromPoint(point.x, point.y);
      under?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: point.x, clientY: point.y, pointerType: 'mouse' }));
      document.querySelector('#stage')?.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        pointerType: 'mouse',
        relatedTarget: document.body,
      }));
    }, parked);
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(ownedRow).toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);

    const again = await other.boundingBox();
    expect(again).toBeTruthy();
    const nudge = {
      x: again!.x + Math.min(18, Math.max(4, again!.width / 3)),
      y: again!.y + Math.min(6, Math.max(2, again!.height / 2)),
    };
    if (nudge.x === parked.x && nudge.y === parked.y) nudge.x += 1;
    await page.mouse.move(nudge.x, nudge.y);
    await expect(other).toHaveClass(/is-hot/);
    await expect(citation).not.toHaveClass(/is-hot/);
    await page.keyboard.press('ArrowDown');
    await expect(citation).toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);
  }
});

test('returning to the same point still counts as travel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Pointer and keyboard modality is checked once.');
  // Actual travel gives the pointer the element under it, whether or not the
  // stage already stored that point. A scroll over or out leaves the focused
  // keyboard owner. The next key returns the highlight to that focus.
  // A null stored point is the cold-arrival test. This one fills same-point
  // reentry, a different point, outside, an empty target, a box, a citation,
  // and the key.
  await page.goto('experiments/mirage/');
  await page.evaluate(() => {
    const log: Array<{ x: number, y: number, mx: number, my: number, id: string }> = [];
    document.querySelector('#stage')?.addEventListener('pointermove', (event) => {
      const pointer = event as PointerEvent;
      log.push({
        x: pointer.clientX,
        y: pointer.clientY,
        mx: pointer.movementX,
        my: pointer.movementY,
        id: (pointer.target as HTMLElement | null)?.closest?.('[data-id], [data-ids]')?.getAttribute('data-id') || '',
      });
    }, true);
    (window as unknown as { __moves: typeof log }).__moves = log;
  });
  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/CHF 54[.,]50/, { timeout: 120_000 });

  const citation = page.locator('#because button.because').first();
  const owned = ((await citation.getAttribute('data-ids')) || '').split(/\s+/).filter(Boolean);
  const otherId = await page.locator('#text-rows .text-row').evaluateAll((nodes, cited) => {
    const row = nodes.find((node) => !cited.includes((node as HTMLElement).dataset.id || ''));
    return (row as HTMLElement | undefined)?.dataset.id || '';
  }, owned);
  const other = page.locator(`#text-rows .text-row[data-id="${otherId}"]`);
  const ownedRow = page.locator(`.text-row[data-id="${owned[0]}"]`);
  const hit = page.locator(`.box-hit[data-id="${otherId}"]`);
  const blank = page.locator('#verdict');

  function contains(box: { x: number, y: number, width: number, height: number }, x: number, y: number) {
    return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  }

  async function lastMove() {
    return page.evaluate(() => {
      const log = (window as unknown as { __moves: Array<{ x: number, y: number, mx: number, my: number, id: string }> }).__moves;
      return log[log.length - 1];
    });
  }

  async function ownCitation() {
    await citation.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press('ArrowDown');
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(ownedRow).toHaveClass(/is-hot/);
  }

  for (const [width, height, reduced] of [[1440, 900, false], [1440, 900, true], [390, 844, false], [390, 844, true]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await other.scrollIntoViewIfNeeded();
    const rowBox = await other.boundingBox();
    expect(rowBox).toBeTruthy();
    const land = {
      x: Math.round(rowBox!.x + Math.min(10, Math.max(2, rowBox!.width / 2))),
      y: Math.round(rowBox!.y + Math.min(6, Math.max(2, rowBox!.height / 2))),
    };
    await page.mouse.move(land.x, land.y, { steps: 1 });
    const stored = await lastMove();
    expect(stored.x).toBe(land.x);
    expect(stored.y).toBe(land.y);
    await expect(other).toHaveClass(/is-hot/);

    const stage = await page.locator('#stage').boundingBox();
    expect(stage).toBeTruthy();
    let outsideX = Math.max(0, Math.round(stage!.x - 24));
    let outsideY = Math.max(0, Math.round(stage!.y - 20));
    if (contains(stage!, outsideX, outsideY)) {
      outsideX = Math.min(width - 2, Math.round(stage!.x + stage!.width + 6));
      outsideY = 2;
    }
    expect(contains(stage!, outsideX, outsideY)).toBe(false);
    await page.mouse.move(outsideX, outsideY, { steps: 1 });
    const afterExit = await lastMove();
    expect(afterExit).toEqual(stored);

    await ownCitation();
    await expect(other).not.toHaveClass(/is-hot/);
    await page.mouse.move(stored.x, stored.y, { steps: 1 });
    const back = await lastMove();
    expect(back.x).toBe(stored.x);
    expect(back.y).toBe(stored.y);
    expect(back.mx !== 0 || back.my !== 0).toBe(true);
    expect(back.id).toBe(otherId);
    await expect(citation).toBeFocused();
    await expect(other).toHaveClass(/is-hot/);
    await expect(citation).not.toHaveClass(/is-hot/);
    await expect(ownedRow).not.toHaveClass(/is-hot/);

    await page.keyboard.press('ArrowDown');
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);
    await page.mouse.wheel(0, 80);
    await page.evaluate((point) => {
      const under = document.elementFromPoint(point.x, point.y);
      under?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: point.x, clientY: point.y, pointerType: 'mouse' }));
      document.querySelector('#stage')?.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        pointerType: 'mouse',
        relatedTarget: document.body,
      }));
    }, stored);
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);

    await hit.scrollIntoViewIfNeeded();
    const hitBox = await hit.boundingBox();
    expect(hitBox).toBeTruthy();
    await page.mouse.move(Math.round(hitBox!.x + hitBox!.width / 2), Math.round(hitBox!.y + hitBox!.height / 2), { steps: 1 });
    await expect(citation).toBeFocused();
    await expect(other).toHaveClass(/is-hot/);
    await expect(hit).toHaveClass(/is-hot/);
    await expect(citation).not.toHaveClass(/is-hot/);

    await blank.scrollIntoViewIfNeeded();
    const empty = await blank.boundingBox();
    expect(empty).toBeTruthy();
    await page.mouse.move(Math.round(empty!.x + 12), Math.round(empty!.y + 8), { steps: 1 });
    await expect(citation).toBeFocused();
    await expect(citation).not.toHaveClass(/is-hot/);
    await expect(other).not.toHaveClass(/is-hot/);
    await expect(ownedRow).not.toHaveClass(/is-hot/);

    const citeBox = await citation.boundingBox();
    expect(citeBox).toBeTruthy();
    await page.mouse.move(Math.round(citeBox!.x + 8), Math.round(citeBox!.y + 6), { steps: 1 });
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
    await expect(ownedRow).toHaveClass(/is-hot/);
    await page.keyboard.press('ArrowDown');
    await expect(citation).toBeFocused();
    await expect(citation).toHaveClass(/is-hot/);
  }
});

test('an unread script does not light an arbitrary row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference covers the menu.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Chinese menu' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toHaveText("Text found, but it isn't Latin script, so it couldn't be read.", { timeout: 120_000 });
  const evidence = page.locator('#because .because');
  await expect(evidence).toHaveText(/^\d+ text regions found; no readable Latin text identified\.$/);
  await expect(evidence).not.toHaveAttribute('data-id', /.+/);
  await expect(page.locator('#because button')).toHaveCount(0);
  await expect(page.locator('.box.is-hot, .text-row.is-hot')).toHaveCount(0);
});

test('a because line links to its text row and box', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference covers the link.');
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Street parking sign' }).click();
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).not.toHaveText('', { timeout: 120_000 });
  const because = page.locator('#because button.because').first();
  await expect(because).toBeVisible();
  const id = await because.getAttribute('data-id');
  expect(id).toBeTruthy();
  const row = page.locator(`.text-row[data-id="${id}"]`);
  const box = page.locator(`svg .box[data-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect(box).toHaveCount(1);
  await expect(page.locator('.text-row', { hasText: /\p{Script=Han}/u })).toHaveCount(0);

  await because.hover();
  await expect(row).toHaveClass(/is-hot/);
  await expect(box).toHaveClass(/is-hot/);
  await expect(box).toHaveCSS('stroke-width', '2px');
  await expect(page.locator('svg .box.is-dim').first()).toHaveCSS('opacity', '0.4');
  await expect(row).toHaveCSS('border-left-width', '2px');

  await because.focus();
  await expect(because).toBeFocused();
  await expect(row).toHaveClass(/is-hot/);
  await expect(box).toHaveClass(/is-hot/);
  await expect(page.locator('svg .box.is-dim').first()).toHaveCSS('opacity', '0.4');
});

test('a second photo stays on the stage with reduced motion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference covers the second photo.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Download model' }).click();
  await page.getByRole('button', { name: 'Desk with a laptop and a cup' }).click();
  await page.getByRole('button', { name: 'Run' }).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).toContainText(/cup|notebook/i, { timeout: 120_000 });
  await page.getByRole('button', { name: 'Street parking sign' }).click();
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.locator('#verdict')).toHaveText("Can't tell.", { timeout: 120_000 });
  const colourful = await page.locator('#mark').evaluate((canvas) => {
    const node = canvas as HTMLCanvasElement;
    const context = node.getContext('2d');
    if (!context || !node.width || !node.height) return 0;
    const cols = 8;
    const rows = 8;
    let count = 0;
    for (let y = 1; y <= rows; y += 1) {
      for (let x = 1; x <= cols; x += 1) {
        const px = Math.floor((node.width * x) / (cols + 1));
        const py = Math.floor((node.height * y) / (rows + 1));
        const [r, g, b, a] = context.getImageData(px, py, 1, 1).data;
        if (a < 16) continue;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 18) count += 1;
      }
    }
    return count;
  });
  expect(colourful).toBeGreaterThan(0);
});

test('an uploaded image stays on this origin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One real inference covers an upload.');
  const traffic = track(page);
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.fallback();
    return route.abort();
  });
  await page.goto('experiments/mirage/');
  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await page.locator('#file').setInputFiles('public/experiments/mirage/samples/receipt.jpg');
  await expect(page.locator('#mark')).toHaveAttribute('aria-label', 'Your image');
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  const before = traffic.seen.length;
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#verdict')).not.toHaveText('', { timeout: 120_000 });
  await expect(page.locator('#run-count')).toHaveText('0');
  await expect(page.locator('#run-bytes')).toHaveText('0 B');
  expect(traffic.seen.slice(before)).toEqual([]);
  expect(traffic.outside).toEqual([]);
});

test('a standalone page uses the page background', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('experiments/mirage/');
    await expect(page.locator('html')).toHaveClass(/standalone/);
    const same = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.background = 'var(--page)';
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const root = getComputedStyle(document.documentElement).backgroundColor;
      const body = getComputedStyle(document.body).backgroundColor;
      return root === expected && body === expected;
    });
    expect(same).toBe(true);
  }
});

test('the frame matches a dark page when the system is light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('exo-theme', 'dark'));
  await page.goto('experiments/play/mirage/');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('html')).not.toHaveClass(/standalone/);
  const spot = await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    if (!iframe) return null;
    const rect = iframe.getBoundingClientRect();
    const main = iframe.contentDocument?.querySelector('main');
    if (!main) return null;
    const mainBox = main.getBoundingClientRect();
    return {
      pageX: 24,
      pageY: Math.round(rect.top + 40),
      underX: Math.round(rect.left + rect.width / 2),
      underY: Math.round(rect.top + mainBox.bottom + 80),
    };
  });
  expect(spot).not.toBeNull();
  const pagePixel = await pixelAt(page, spot!.pageX, spot!.pageY);
  const underPixel = await pixelAt(page, spot!.underX, spot!.underY);
  expect(underPixel).toEqual(pagePixel);
});

function pngPixel(buffer: Buffer) {
  let offset = 8;
  const parts: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') parts.push(data);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(parts));
  return [inflated[1], inflated[2], inflated[3]];
}

async function pixelAt(page: Page, x: number, y: number) {
  await page.evaluate((point) => window.scrollTo(0, Math.max(0, point - 40)), y);
  const top = await page.evaluate(() => window.scrollY);
  const buffer = await page.screenshot({ clip: { x, y: y - top, width: 1, height: 1 } });
  return pngPixel(buffer);
}

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
