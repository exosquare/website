import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';

test.use({ hasTouch: true });
test.beforeEach(({ }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '320, 390, and 1440 are set inside this file.');
});

const routes = [
  { name: 'article', route: 'writing/weight-space-pong/' },
  { name: 'play', route: 'experiments/play/pong/' },
];
const widths = [
  { name: '320', width: 320, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
];
const themes = ['light', 'dark'] as const;
const tracePath = '/tmp/pong-next/embed-trace.jsonl';
mkdirSync('/tmp/pong-next/shots', { recursive: true });

function childRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => {
    const frame = request.frame();
    if (frame && frame.url().includes('/experiments/pong/')) urls.push(request.url());
  });
  return urls;
}

async function painted(frame: FrameLocator, id: string) {
  return frame.locator(id).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] !== 16 || pixels[index + 1] !== 19 || pixels[index + 2] !== 21) count += 1;
    }
    return count;
  });
}

for (const surface of routes) {
  for (const viewport of widths) {
    for (const theme of themes) {
      test(`${surface.name} ${viewport.name} ${theme}`, surface.name === 'article' ? { tag: '@draft' } : {}, async ({ page, baseURL }) => {
        test.setTimeout(60_000);
        const urls = childRequests(page);
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto(new URL(surface.route, baseURL).href);
        expect(response?.status()).toBe(200);
        await page.evaluate((mode) => {
          document.documentElement.dataset.theme = mode;
        }, theme);
        const iframe = page.locator('iframe[title*="Pong"]');
        await iframe.scrollIntoViewIfNeeded();
        const frame = page.frameLocator('iframe[title*="Pong"]');
        await expect(frame.locator('html')).toHaveAttribute('data-preview-ready', 'true');
        const status = await frame.locator('html').evaluate(() => {
          const sheets = [...document.styleSheets];
          return {
            ready: document.documentElement.dataset.previewReady,
            font: getComputedStyle(document.body).fontFamily,
            background: getComputedStyle(document.body).backgroundColor,
            stylesheetLinks: document.querySelectorAll('link[rel="stylesheet"]').length,
            moduleScripts: document.querySelectorAll('script[type="module"]').length,
            inlineStyleRules: sheets.reduce((sum, sheet) => {
              try { return sum + sheet.cssRules.length; } catch { return sum; }
            }, 0),
            sandbox: window.parent !== window,
            fingerprint: document.getElementById('stage')?.dataset.fingerprint || null,
            cloudFit: document.getElementById('stage')?.dataset.cloudFit || null,
          };
        });
        expect(status.ready).toBe('true');
        expect(status.font).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
        const type = await frame.locator('#stage').evaluate(() => ({
          title: getComputedStyle(document.querySelector('h1')!).fontFamily,
          status: getComputedStyle(document.querySelector('.status')!).fontFamily,
        }));
        expect(type.title).toBe(status.font);
        expect(type.status).toBe(status.font);
        expect(status.background).toBe('rgb(16, 19, 21)');
        expect(status.stylesheetLinks).toBe(0);
        expect(status.moduleScripts).toBe(0);
        expect(status.inlineStyleRules).toBeGreaterThan(10);
        expect(status.fingerprint).toBe('9a647f3200303418ae711c35f56483dd126e8d0f871d64384251c1a52945e02f');
        expect(status.cloudFit).toBe('true');
        expect(await iframe.getAttribute('sandbox')).toBe('allow-scripts');
        await expect(frame.locator('#demonstration-status')).toHaveText('Demonstration weights. No official score.');
        await expect(frame.locator('#attempt-status')).toHaveText('Grok authoring attempt rejected. No accepted artifact. 32 scheduled, 0 played.');
        await expect(frame.locator('#attempt-status')).not.toContainText('not run');
        await expect(frame.locator('#schedule-note')).toContainText('Administrative forfeits are not observed losses');
        expect(await frame.locator('#stage').evaluate((node) => ({
          outcome: (node as HTMLElement).dataset.attemptOutcome,
          candidate: (node as HTMLElement).dataset.candidateLoaded,
          scheduled: (node as HTMLElement).dataset.scheduled,
          played: (node as HTMLElement).dataset.played,
          role: (node as HTMLElement).dataset.role,
        }))).toEqual({
          outcome: 'rejected',
          candidate: 'false',
          scheduled: '32',
          played: '0',
          role: 'demonstration',
        });
        const skipBottom = await frame.locator('.skip-link').evaluate((node) => node.getBoundingClientRect().bottom);
        expect(skipBottom).toBeLessThanOrEqual(0);
        expect(await painted(frame, '#court')).toBeGreaterThan(20);
        expect(await painted(frame, '#network')).toBeGreaterThan(20);
        const padding = await frame.locator('#stage').evaluate(() => ({
          play: getComputedStyle(document.querySelector('.play-row')!).paddingLeft,
          court: getComputedStyle(document.querySelector('.pane-title')!).paddingLeft,
          decision: getComputedStyle(document.querySelector('.decision-summary')!).paddingLeft,
        }));
        expect(padding).toEqual({ play: '16px', court: '16px', decision: '16px' });
        if (surface.name === 'article') {
          await expect(page.locator('figcaption')).toContainText('loaded. Open a larger view');
        } else {
          await expect(page.locator('.play-view p')).toContainText('The Grok authoring attempt was rejected and is not loaded.');
          await expect(page.locator('.play-view p')).toContainText('Open the standalone page');
        }
        const controlBorder = await frame.locator('#step').evaluate((node) => getComputedStyle(node).borderTopColor);
        const disabledControl = await frame.locator('button[disabled]').first().evaluate((node) => ({
          border: getComputedStyle(node).borderTopColor,
          cursor: getComputedStyle(node).cursor,
        }));
        expect(controlBorder).toBe('rgb(100, 104, 108)');
        expect(disabledControl.cursor).toBe('not-allowed');
        expect(disabledControl.border).not.toBe(controlBorder);
        await frame.locator('.skip-link').focus();
        await expect.poll(() => frame.locator('.skip-link').evaluate((node) => node.getBoundingClientRect().bottom)).toBeGreaterThan(0);
        await frame.locator('.skip-link').press('Enter');
        await expect(frame.locator('#court-heading')).toBeFocused();
        await expect.poll(async () => iframe.evaluate((node) => (node as HTMLIFrameElement).style.height)).not.toBe('');
        const applied = await iframe.evaluate((node) => Number.parseFloat((node as HTMLIFrameElement).style.height));
        expect(applied).toBeGreaterThanOrEqual(480);
        expect(applied).toBeLessThanOrEqual(20000);

        const beforeMessages = await iframe.evaluate((node) => (node as HTMLIFrameElement).style.height);
        await page.evaluate(() => window.postMessage({ type: 'pong-embed-height', height: 1800 }, '*'));
        await frame.locator('body').evaluate(() => {
          window.parent.postMessage({ type: 'other', height: 1800 }, '*');
          window.parent.postMessage({ type: 'pong-embed-height', height: 20 }, '*');
          window.parent.postMessage({ type: 'pong-embed-height', height: 25000 }, '*');
          window.parent.postMessage({ height: 1800 }, '*');
        });
        await page.waitForTimeout(100);
        expect(await iframe.evaluate((node) => (node as HTMLIFrameElement).style.height)).toBe(beforeMessages);
        const accepted = await frame.locator('#stage').evaluate((node) => Math.ceil(node.getBoundingClientRect().height));
        await frame.locator('body').evaluate((node, height) => {
          window.parent.postMessage({ type: 'pong-embed-height', height }, '*');
          return node.id;
        }, accepted);
        await expect.poll(async () => iframe.evaluate((node) => Number.parseFloat((node as HTMLIFrameElement).style.height))).toBeGreaterThanOrEqual(accepted - 2);
        const rejected = await iframe.evaluate((node) => (node as HTMLIFrameElement).style.height);
        expect(rejected).not.toBe('20px');
        expect(rejected).not.toBe('1800px');
        expect(rejected).not.toBe('25000px');

        const mark = urls.length;
        const tickBefore = await frame.locator('#tick-readout').innerText();
        await frame.locator('#step').click();
        await expect(frame.locator('#tick-readout')).not.toHaveText(tickBefore);
        await expect(frame.locator('#decision-caption')).not.toContainText('before tick');
        await expect(frame.locator('#decision-when')).toContainText('before tick');
        await frame.locator('#options-toggle').click();
        await expect(frame.locator('#layer')).toBeFocused();
        const headingWidth = await frame.locator('#edit-heading').evaluate((node) => node.getBoundingClientRect().width);
        const stageWidth = await frame.locator('#stage').evaluate((node) => node.getBoundingClientRect().width);
        expect(headingWidth).toBeLessThan(stageWidth / 2);
        if (viewport.name === '1440') {
          const layout = await frame.locator('#stage').evaluate(() => {
            const score = document.querySelector('.score-board')!.getBoundingClientRect();
            const edit = document.querySelector('#options')!.getBoundingClientRect();
            const layer = document.querySelector('#layer')!.getBoundingClientRect();
            const court = document.querySelector('#court')!.getBoundingClientRect();
            const network = document.querySelector('#network')!.getBoundingClientRect();
            const overlap = Math.min(score.bottom, edit.bottom) - Math.max(score.top, edit.top);
            return {
              overlap,
              scoreBeforeEdit: score.bottom <= edit.top + 1,
              layerInsideEdit: layer.top >= edit.top - 1 && layer.bottom <= edit.bottom + 1,
              courtHeight: court.height,
              networkHeight: network.height,
            };
          });
          expect(layout.overlap).toBeLessThanOrEqual(1);
          expect(layout.scoreBeforeEdit).toBe(true);
          expect(layout.layerInsideEdit).toBe(true);
          expect(layout.courtHeight).toBeGreaterThanOrEqual(240);
          expect(layout.networkHeight).toBeGreaterThanOrEqual(240);
        }
        await frame.locator('#weight-details summary').click();
        await frame.locator('#info-game').focus();
        await expect(frame.locator('#help-game')).toBeVisible();
        const helpBox = await frame.locator('#help-game').evaluate((node) => ({
          position: getComputedStyle(node).position,
          left: node.style.left,
          top: node.style.top,
        }));
        expect(helpBox).toEqual({ position: 'static', left: '', top: '' });
        await frame.locator('body').press('Escape');
        await expect(frame.locator('#help-game')).toBeHidden();
        await expect(frame.locator('#info-game')).toBeFocused();
        await frame.locator('#info-shape').tap();
        await expect(frame.locator('#help-shape')).toBeVisible();
        await frame.locator('#court').evaluate((node) => {
          node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        });
        await expect(frame.locator('#help-shape')).toBeHidden();
        await frame.locator('details.group summary', { hasText: 'Shape' }).click();
        const yawBefore = Number(await frame.locator('#stage').getAttribute('data-yaw'));
        await frame.locator('#rotate').click();
        const yawStepped = Number(await frame.locator('#stage').getAttribute('data-yaw'));
        await page.waitForTimeout(400);
        const yawLater = Number(await frame.locator('#stage').getAttribute('data-yaw'));
        expect(yawStepped).toBeGreaterThan(yawBefore);
        expect(yawLater).toBeCloseTo(yawStepped, 5);
        await expect.poll(async () => {
          const content = await frame.locator('#stage').evaluate((node) => Math.ceil(node.getBoundingClientRect().height));
          const applied = await iframe.evaluate((node) => Number.parseFloat((node as HTMLIFrameElement).style.height));
          return applied + 4 >= content;
        }).toBe(true);
        expect(urls.slice(mark)).toEqual([]);
        expect(errors).toEqual([]);
        const shot = `/tmp/pong-next/shots/${surface.name}-${theme}-${viewport.name}.png`;
        await iframe.screenshot({ path: shot });
        appendFileSync(tracePath, `${JSON.stringify({ surface: surface.name, viewport: viewport.name, theme, status, errors, postReady: urls.slice(mark) })}\n`);
      });
    }
  }
}

test('open about keeps the validator hash inside 320 and 390', async ({ page, baseURL }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(new URL('experiments/pong/', baseURL).href);
    await expect(page.locator('html')).toHaveAttribute('data-preview-ready', 'true');
    await page.locator('summary', { hasText: 'About this demo' }).click();
    await expect(page.locator('#attempt-note')).toContainText('44bc8b0170ad400c927abfda67270b300e0381bbc2dfd2d4c8be3efcbc19f414');
    const fit = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  }
});

test('standalone options keep a 240px court on the first 1440 view', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(new URL('experiments/pong/', baseURL).href);
  await expect(page.locator('html')).toHaveAttribute('data-preview-ready', 'true');
  await page.locator('#options-toggle').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const geometry = await page.evaluate(() => {
    const box = (sel: string) => {
      const node = document.querySelector(sel)!;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width };
    };
    const court = box('#court');
    const cloud = box('#network');
    const play = box('.play');
    const legend = box('.legend');
    const unit = box('#unit');
    const layer = box('#layer');
    const revision = box('#revision');
    const cohort = box('#cohort');
    return {
      scroll: window.scrollY,
      inner: window.innerHeight,
      court,
      cloud,
      unit,
      layer,
      revision,
      cohort,
      courtOverlapsPlay: Math.min(court.bottom, play.bottom) - Math.max(court.top, play.top),
      cloudOverlapsLegend: Math.min(cloud.bottom, legend.bottom) - Math.max(cloud.top, legend.top),
      buttonHeight: box('.name-row button').height,
    };
  });
  expect(geometry.scroll).toBe(0);
  expect(geometry.court.height).toBeGreaterThanOrEqual(240);
  expect(geometry.cloud.height).toBeGreaterThanOrEqual(240);
  expect(geometry.unit.bottom).toBeLessThanOrEqual(geometry.inner);
  expect(geometry.layer.bottom).toBeLessThanOrEqual(geometry.inner);
  expect(geometry.courtOverlapsPlay).toBeLessThanOrEqual(0);
  expect(geometry.cloudOverlapsLegend).toBeLessThanOrEqual(0);
  expect(geometry.revision.top).toBe(geometry.cohort.top);
  expect(geometry.buttonHeight).toBeGreaterThanOrEqual(44);
});
