import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

test('choose players, inspect a tick, upload a network and finish its knockout bracket', async ({
  page,
  baseURL,
}) => {
  await page.goto(new URL('experiments/play/pong/', baseURL).href);
  const arena = page.locator('.pong-arena');
  await expect(arena.locator('[data-seat="0"]')).toContainText('Grok');
  await expect(
    arena.getByRole('button', { name: /Astra 6.2 Revised/ }),
  ).toBeEnabled();
  await arena
    .locator('[data-cards]')
    .getByRole('button', { name: /Astra 6.2 Original/ })
    .click();
  await expect(arena.locator('[data-seat="0"]')).toContainText('Astra');
  await arena.getByRole('button', { name: 'Start match' }).click();
  await arena.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(arena.locator('[data-game-state]')).toContainText('tick 1');
  await expect(arena.locator('[data-left-name]')).toContainText(
    'Astra 6.2 Original',
  );
  const brains = arena.locator('.brain-diagram');
  await expect(brains.first().getByRole('button')).toHaveCount(9);
  await expect(brains.last().getByRole('button')).toHaveCount(9);
  await brains
    .first()
    .getByRole('button', { name: 'Input 3 · Horizontal velocity' })
    .hover();
  await expect(brains.first().getByRole('tooltip')).toContainText('moves away');
  const output = brains
    .last()
    .getByRole('button', { name: 'Output 3 · Move down' });
  await output.focus();
  await expect(brains.last().getByRole('tooltip')).toContainText(
    'down one cell',
  );
  await output.press('Escape');
  await expect(brains.last().getByRole('tooltip')).toHaveCount(0);
  await arena.getByRole('tab', { name: 'Players' }).click();
  await arena.getByText('Read prompt', { exact: true }).click();
  await expect(arena.locator('.import-area [data-agent-prompt]')).toContainText(
    'Make me an original player',
  );
  const file = arena.locator('input[type=file]');
  await file.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(arena.locator('[data-upload-state]')).toContainText(
    'Invalid network',
  );
  const bytes = readFileSync(
    'public/experiments/pong/data/grok-assisted-row-canonical.json',
  );
  await file.setInputFiles({
    name: 'Reader.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(arena.locator('[data-upload-state]')).toContainText(
    'Reader is available',
  );
  await page.reload();
  await arena.getByRole('tab', { name: 'Tournament' }).click();
  await arena.locator('[data-mode]').selectOption('custom');
  const options = arena.locator('[data-custom]');
  await expect(
    options.getByLabel('Gemini Neon Revised', { exact: true }),
  ).toBeEnabled();
  for (const revised of await options
    .getByRole('checkbox', { name: /Revised/ })
    .all()) {
    await revised.uncheck();
  }
  await options.getByLabel('Grok 4.7 Original', { exact: true }).check();
  await options.getByLabel('Fable 5.2 Original', { exact: true }).check();
  await options.getByLabel('Astra 6.2 Original', { exact: true }).check();
  await expect(options.getByLabel('Reader', { exact: true })).toBeEnabled();
  await options.getByLabel('Gemini Neon Original', { exact: true }).check();
  const bestOf = arena.getByLabel('Best of');
  await expect(bestOf).toHaveValue('5');
  await bestOf.selectOption('3');
  await arena.getByRole('button', { name: 'Run tournament' }).click();
  const fixture = arena.locator('[data-fixture]');
  await expect(fixture.locator('[data-fixture-stage]')).toHaveText(
    'Round robin · 1 / 6',
  );
  await expect(fixture.locator('.fixture-team img')).toHaveCount(2);
  const court = fixture.locator('[data-fixture-court]');
  const frame = () =>
    court.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await expect(court).toBeVisible();
  const opening = await frame();
  await expect.poll(frame).not.toBe(opening);
  const layout = await fixture.locator('.fixture-layout').evaluate((el) => {
    const [court, scores] = Array.from(el.children, (child) =>
      child.getBoundingClientRect(),
    );
    return {
      stacked: scores.top >= court.bottom,
      ratio: court.width / scores.width,
    };
  });
  expect(layout.stacked).toBe(page.viewportSize()!.width < 720);
  expect(layout.ratio).toBeCloseTo(1, 1);
  await expect(fixture.locator('[data-fixture-call]')).toContainText('Point');
  await expect(fixture.locator('[data-fixture-overlay]')).toHaveText(
    await fixture.locator('[data-fixture-call]').innerText(),
  );
  await expect(fixture.locator('[data-fixture-series]')).toHaveText(
    'Series 0–0',
  );
  await fixture.getByRole('button', { name: 'Fast finish' }).click();
  await expect(arena.locator('[data-tournament-state]')).toContainText(
    'Champion',
    { timeout: 15000 },
  );
  await expect(arena.locator('.bracket-match')).toHaveCount(3);
  await expect(fixture.locator('[data-fixture-stage]')).toHaveText('Final');
  await expect(arena.locator('[data-tournament-state] img')).toHaveCount(1);
  await expect(
    arena.locator('[data-bracket] .player-identity img'),
  ).toHaveCount(6);
  const download = page.waitForEvent('download');
  await arena.getByRole('button', { name: 'Download match feedback' }).click();
  const report = JSON.parse(
    readFileSync((await (await download).path())!, 'utf8'),
  );
  expect(report.formatVersion).toBe(3);
  expect(report.bestOf).toBe(3);
  expect(report.pointsToWin).toBe(8);
  const pairs = new Set();
  let count = 0;
  for (const series of report.series) {
    if (series.stage === 'Round robin')
      pairs.add([...series.players].sort().join('/'));
    expect(series.scores).toContain(2);
    expect(series.matches.length).toBe(series.scores[0] + series.scores[1]);
    for (const i of series.matches) {
      expect(i).toBe(count++);
      expect(report.matches[i].players).toEqual(series.players);
    }
  }
  expect(pairs.size).toBe(6);
  expect(report.series.length).toBe(9);
  expect(report.matches.length).toBe(count);
  expect(report.champion).toBe(report.series.at(-1).winner);
  for (const match of report.matches) {
    expect(Math.max(...match.scores)).toBe(8);
    expect(match.winner).toBe(match.games.at(-1).winner);
    for (const game of match.games) {
      const trace = report.traces[game.traceId];
      expect(trace.length).toBe(game.ticks);
      expect(Object.values(game.sides).sort()).toEqual(
        [...match.players].sort(),
      );
      assert.equal(trace[0].before.elapsedTicks, 0);
      for (const [i, row] of trace.entries()) {
        assert.equal(row.tick, i + 1);
        if (i > 0) assert.deepEqual(row.before, trace[i - 1].after);
        for (const side of ['left', 'right']) {
          const decision = row[side];
          assert.equal(decision.inputs.length, 6);
          assert.equal(decision.hidden1.length, 16);
          assert.equal(decision.hidden2.length, 16);
          assert.deepEqual(
            decision.comparisonScores,
            decision.rawScores.map(
              (score: number) => Math.floor(score * 1e6 + 0.5) || 0,
            ),
          );
          assert.equal(
            decision.action,
            decision.comparisonScores.indexOf(
              Math.max(...decision.comparisonScores),
            ),
          );
        }
      }
      assert.equal(trace.at(-1).after.terminal.reason, game.ending);
      assert.deepEqual(trace.at(-1).event, game.lastEvent);
    }
  }
  for (const player of report.players) {
    const {
      servesWon,
      servesLost,
      servesDrawn,
      missesAbove,
      missesBelow,
      totalMissDistance,
    } = player.summary;
    let games = 0;
    let distance = 0;
    for (const match of report.matches) {
      const seat = match.players.indexOf(player.id);
      if (seat < 0) continue;
      games += match.games.length;
      distance += match.miss[seat];
    }
    expect(servesWon + servesLost + servesDrawn).toBe(games);
    expect(missesAbove + missesBelow).toBe(servesLost);
    expect(totalMissDistance).toBe(distance);
  }
  const revision = arena.locator('[data-tournament-revision]');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          document.body.dataset.copied = value;
        },
      },
    }),
  );
  await revision.getByRole('button', { name: 'Copy revision prompt' }).click();
  const copied = await page.locator('body').getAttribute('data-copied');
  expect(copied).toContain('player-revised.json');
  expect(copied).toContain('pong-match-feedback.json');
  expect(copied).toContain('pong-authoring.zip');
  expect(
    report.players.some(
      (p: { name: string; effort: string }) =>
        p.name === 'Gemini Neon Original' && p.effort === 'Not set',
    ),
  ).toBeTruthy();
  await arena.locator('[data-mode]').selectOption('reference');
  await expect(arena.locator('[data-export]')).toBeDisabled();
  await expect(arena.locator('[data-run]')).toBeEnabled();
  await expect(arena.locator('.bracket-match')).toHaveCount(7);
});

test('a point holds the court for two seconds and both players keep their sides', async ({
  page,
  baseURL,
}) => {
  const file = 'stationary-test-player.json';
  await page.route('**/arena/roster.json', (route) =>
    route.fulfill({
      json: { 'grok-original': { file }, 'fable-original': { file } },
    }),
  );
  await page.route('**/' + file, (route) =>
    route.fulfill({
      json: { version: 'pong-feedback-v1', weights: Array(435).fill(0) },
    }),
  );
  await page.goto(new URL('experiments/play/pong/', baseURL).href);
  const arena = page.locator('.pong-arena');
  await arena.getByRole('button', { name: 'Start match' }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await arena.locator('[data-speed]').selectOption('4');
  await arena.getByRole('button', { name: 'Play', exact: true }).click();

  await page.clock.runFor(37 * 25);
  const call = arena.locator('[data-point-call]');
  await expect(call).toHaveText('Point Grok');
  await expect(arena.locator('[data-score]')).toHaveText('1 – 0');
  const court = arena.locator('[data-court]');
  const frozen = await court.evaluate((el) =>
    (el as HTMLCanvasElement).toDataURL(),
  );
  await page.clock.runFor(1999);
  await expect(call).toHaveText('Point Grok');
  expect(
    await court.evaluate((el) => (el as HTMLCanvasElement).toDataURL()),
  ).toBe(frozen);

  await page.clock.runFor(26);
  await expect(call).toBeEmpty();
  await expect(arena.locator('[data-game-state]')).toContainText('Serve 2/8');
  await expect(arena.locator('[data-left-name]')).toHaveText('Grok Original');
  await expect(arena.locator('[data-right-name]')).toHaveText('Fable Original');
  await expect(arena.locator('[data-score]')).toHaveText('1 – 0');
  await page.clock.runFor(36 * 25);
  await expect(call).toHaveText('Point Fable');
  await expect(arena.locator('[data-score]')).toHaveText('1 – 1');
  await arena.getByRole('button', { name: 'Pause', exact: true }).click();
  await arena.locator('[data-step]').evaluate((el) => {
    const step = el as HTMLButtonElement;
    for (let tick = 0; tick < 8 * 192 && !step.disabled; tick++) step.click();
  });
  const revision = arena.locator('[data-series-revision]');
  await expect(
    revision.getByRole('button', { name: 'Copy revision prompt' }),
  ).toBeVisible();
  await revision.getByText('Read revision prompt').click();
  await expect(revision.locator('[data-agent-prompt]')).toContainText(
    'player-revised.json',
  );
  const downloaded = page.waitForEvent('download');
  await arena.locator('[data-series-export]').click();
  const report = JSON.parse(
    readFileSync((await (await downloaded).path())!, 'utf8'),
  );
  expect(report.tournament).toBe('head-to-head');
  expect(report.matches).toHaveLength(1);
  expect(report.matches[0].games).toHaveLength(8);
  for (const game of report.matches[0].games) {
    expect(game.trace.length).toBe(game.ticks);
  }
});

test('a drawn rally holds its score and announces the timeout before the next serve', async ({
  page,
  baseURL,
}) => {
  await page.goto(new URL('experiments/play/pong/', baseURL).href);
  const arena = page.locator('.pong-arena');
  await arena.getByRole('button', { name: 'Start match' }).click();
  await arena
    .getByText('Match rules', { exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    arena
      .getByText(/If the ball is still in play after 192 ticks/)
      .filter({ visible: true }),
  ).toBeVisible();
  // The default Grok–Fable series draws its seventh rally.
  await arena.locator('[data-step]').evaluate((el) => {
    const step = el as HTMLButtonElement;
    const state = step
      .closest('.arena-page')!
      .querySelector('[data-game-state]')!;
    for (
      let i = 0;
      i < 7 * 192 && state.textContent !== 'Serve 7/8 · tick 191';
      i++
    )
      step.click();
  });
  const state = arena.locator('[data-game-state]');
  await expect(state).toHaveText('Serve 7/8 · tick 191');
  const score = await arena.locator('[data-score]').innerText();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await arena.locator('[data-speed]').selectOption('4');
  await arena.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(25);
  const call = arena.locator('[data-point-call]');
  await expect(call).toHaveText('Draw · 192 ticks');
  await page.clock.runFor(1999);
  await expect(call).toHaveText('Draw · 192 ticks');
  await expect(state).toHaveText('Serve 7/8 · tick 192');
  await expect(arena.locator('[data-score]')).toHaveText(score);
  await page.clock.runFor(26);
  await expect(call).toBeEmpty();
  await expect(state).toContainText('Serve 8/8');
  await expect(arena.locator('[data-score]')).toHaveText(score);
});
