import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'astro';
import { chromium } from '@playwright/test';

const out = '/workspace/proof/mirage';
await mkdir(out, { recursive: true });
const server = await preview({ server: { host: '127.0.0.1', port: 4188 } });
const browser = await chromium.launch();
const base = 'http://127.0.0.1:4188/experiments/mirage/';

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log('shot', name, await page.locator('#status').innerText());
}

async function blankFiles() {
  const { default: fs } = await import('node:fs/promises');
  // created by python before this script
}

async function downloadUntilReady(page, label) {
  await page.getByRole('button', { name: /Download model|Load model|Retry download/ }).click();
  const frames = [];
  for (let i = 0; i < 40; i += 1) {
    const status = await page.locator('#status').innerText();
    if (/Downloading|Loading/.test(status) && status !== 'Ready') {
      frames.push({ status, png: await page.screenshot({ fullPage: true }) });
    }
    if (status === 'Ready' || status === "Couldn't load") break;
    await page.waitForTimeout(40);
  }
  if (frames.length) {
    const mid = frames[Math.floor(frames.length / 2)];
    await writeFile(`${out}/${label}.png`, mid.png);
    console.log('shot', label, mid.status, 'of', frames.map((frame) => frame.status).join(', '));
  }
  await page.locator('#status').getByText(/Ready|Couldn't load/).waitFor({ timeout: 60000 }).catch(() => {});
}

async function pass(width, height, reduced) {
  const tag = `${reduced ? 'reduce' : 'motion'}-${width}`;
  const context = await browser.newContext({
    viewport: { width, height: height === 390 ? 844 : 900 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('#mark').waitFor();
  await shot(page, `${tag}-idle`);
  if (width === 1440 && !reduced) {
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      stage: document.querySelector('.stage').getBoundingClientRect().height,
      top: document.querySelector('.stage-top').offsetHeight,
    }));
    console.log('METRICS desktop', metrics);
  }
  if (width === 390 && !reduced) {
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      stage: document.querySelector('.stage').getBoundingClientRect().height,
      top: document.querySelector('.stage-top').offsetHeight,
    }));
    console.log('METRICS mobile idle', metrics);
  }

  await downloadUntilReady(page, `${tag}-downloading`);
  await shot(page, `${tag}-ready-no-image`);

  await page.reload();
  await expectLoad(page);
  await shot(page, `${tag}-cache-available`);
  const loadClick = page.getByRole('button', { name: 'Load model' }).click();
  const cacheFrames = [];
  for (let i = 0; i < 30; i += 1) {
    const status = await page.locator('#status').innerText().catch(() => '');
    if (/Loading/.test(status)) cacheFrames.push(await page.screenshot({ fullPage: true }));
    if (status === 'Ready') break;
    await page.waitForTimeout(30);
  }
  await loadClick;
  if (cacheFrames[0]) {
    await writeFile(`${out}/${tag}-cache-load.png`, cacheFrames[0]);
    console.log('shot', `${tag}-cache-load`);
  } else await shot(page, `${tag}-cache-load`);

  await page.getByRole('button', { name: 'Shop receipt' }).click();
  await page.waitForTimeout(reduced ? 50 : 500);
  await shot(page, `${tag}-sample-chosen`);
  await page.getByRole('button', { name: 'Run' }).click();
  await page.locator('#status').getByText('Finding objects').waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(reduced ? 40 : 900);
  await shot(page, `${tag}-running-objects`);
  const scan = await page.locator('#mark').getAttribute('data-scan');
  const raf = await page.locator('#mark').getAttribute('data-raf');
  console.log(tag, 'scan', scan, 'raf', raf, 'status', await page.locator('#status').innerText());
  await page.locator('#status').getByText('Reading text').waitFor({ timeout: 20000 }).catch(() => {});
  await shot(page, `${tag}-running-text`);
  await page.locator('#verdict').waitFor({ state: 'visible', timeout: 60000 });
  await shot(page, `${tag}-result-receipt`);
  if (width === 390 && !reduced) {
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      stage: document.querySelector('.stage').getBoundingClientRect().height,
    }));
    console.log('METRICS mobile results', metrics);
  }

  for (const [name, sample] of [['parking', 'Street parking sign'], ['desk', 'Desk with a laptop and a cup'], ['menu', 'Chinese menu']]) {
    const previous = await page.locator('#verdict').innerText();
    await page.getByRole('button', { name: sample }).click();
    await page.waitForTimeout(reduced ? 40 : 400);
    await page.getByRole('button', { name: 'Run again' }).click();
    await page.waitForFunction((text) => {
      const node = document.querySelector('#verdict');
      return node && node.textContent && node.textContent !== text;
    }, previous, { timeout: 60000 });
    await page.waitForTimeout(reduced ? 40 : 500);
    await shot(page, `${tag}-result-${name}`);
    console.log(tag, name, await page.locator('#verdict').innerText());
  }

  const beforeBlank = await page.locator('#verdict').innerText();
  await page.setInputFiles('#file', '/tmp/mirage-blank.png');
  await page.getByRole('button', { name: 'Run again' }).click();
  await page.waitForFunction((text) => {
    const node = document.querySelector('#verdict');
    return node && node.textContent && node.textContent !== text;
  }, beforeBlank, { timeout: 60000 });
  await shot(page, `${tag}-nothing`);
  console.log(tag, 'nothing', await page.locator('#verdict').innerText());

  await page.setInputFiles('#file', '/tmp/mirage-note.txt');
  await page.locator('#vision-error').waitFor({ timeout: 5000 });
  await shot(page, `${tag}-non-image`);

  await page.setInputFiles('#file', '/tmp/mirage-huge.png');
  await page.locator('#scale-note').waitFor({ timeout: 10000 });
  await shot(page, `${tag}-huge`);
  await context.close();
}

async function expectLoad(page) {
  await page.getByRole('button', { name: 'Load model' }).waitFor({ timeout: 10000 });
}

async function failures() {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const reduced of [false, true]) {
      const tag = `${reduced ? 'reduce' : 'motion'}-${width}`;
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      });
      await context.route('**/*.cact', (route) => route.fulfill({ status: 503, body: 'no' }));
      const page = await context.newPage();
      await page.goto(base);
      await page.getByRole('button', { name: 'Download model' }).click();
      await page.locator('#status').getByText("Couldn't load").waitFor({ timeout: 20000 });
      await page.screenshot({ path: `${out}/${tag}-load-failed.png`, fullPage: true });
      console.log('shot', `${tag}-load-failed`);
      await context.close();
    }
  }
}

async function probe() {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(base + '?run-probe=1');
    await page.getByRole('button', { name: 'Shop receipt' }).click();
    await page.getByRole('button', { name: 'Download model' }).click();
    await page.getByRole('button', { name: 'Run' }).waitFor();
    await page.getByRole('button', { name: 'Run' }).click();
    await page.locator('#verdict').waitFor({ timeout: 60000 });
    await page.locator('#net-run.warn, #net-run').waitFor();
    await page.screenshot({ path: `${out}/motion-${width}-run-probe.png`, fullPage: true });
    console.log('shot probe', width, await page.locator('#net-run').innerText());
    await context.close();
  }
}

await writeFile('/tmp/mirage-note.txt', 'not an image');
const { spawnSync } = await import('node:child_process');
spawnSync('python3', ['-c', `
from PIL import Image
Image.new('RGB', (640, 480), (180, 180, 176)).save('/tmp/mirage-blank.png')
Image.new('RGB', (2400, 1800), (186, 92, 64)).save('/tmp/mirage-huge.png')
`], { stdio: 'inherit' });

await failures();
for (const reduced of [false, true]) {
  await pass(1440, 900, reduced);
  await pass(390, 844, reduced);
}
await probe();
await browser.close();
await server.stop();
console.log('done');
