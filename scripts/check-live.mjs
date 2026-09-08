import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const site = new URL(process.env.DEPLOYED_URL);
assert.equal(site.protocol, 'https:', 'Expected an HTTPS deployment URL');
async function check() {
  for (const route of ['', 'writing/', 'work/']) {
    const url = new URL(route, site);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `Page unavailable: ${url.pathname}`);
    const html = await response.text();
    assert.match(html, /<main\b/, `Missing page content: ${url.pathname}`);
    // Check local stylesheet delivery, without contacting external destinations.
    for (const [, href] of html.matchAll(
      /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g,
    )) {
      const asset = new URL(href, url);
      if (asset.origin !== site.origin) continue;
      const result = await fetch(asset, { signal: AbortSignal.timeout(10000) });
      assert.equal(
        result.status,
        200,
        `Stylesheet unavailable: ${asset.pathname}`,
      );
    }
  }
}
// CDN propagation is separate from deterministic pre-merge/local tests.
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    await check();
    console.log(`Live delivery verified at ${site.href}`);
    break;
  } catch (error) {
    if (attempt === 6) throw error;
    console.log(`Delivery check ${attempt} not ready; retrying.`);
    await setTimeout(5000);
  }
}
