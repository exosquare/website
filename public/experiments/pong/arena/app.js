import {
  readRoster,
  authors,
  versions,
  slotId,
  seeds,
  label,
  modelName,
  fromUpload,
} from './roster.js';
import { startSeries, advance, GAMES } from './match.js';
import { newTournament, runTournament, seriesLengths } from './tournament.js';
import { parameterFingerprint } from '../validate.js';
import { feedbackGuide, summarizePlayer } from './feedback.js';
import { drawCourt, drawNetwork, enableNetworkTips } from './draw.js';

const logos = new Map([
  ['Grok', 'grok.jpg'],
  ['Astra', 'openai.svg'],
  ['Fable', 'anthropic.svg'],
  ['Gemini', 'gemini.png'],
]);
const colors = ['#8bddca', '#f0b387'];
const actions = ['Hold —', 'Move up ↑', 'Move down ↓'];
const storageKey = 'exosquare.pong.uploads.v1';
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(text, fn, cls) {
  const el = node('button', text, cls);
  el.type = 'button';
  el.onclick = fn;
  return el;
}
function mark(name) {
  const asset = logos.get(name);
  if (!asset) {
    const avatar = node('span', null, 'model-mark reader-mark');
    avatar.dataset.initial = String(name || '◇')
      .slice(0, 1)
      .toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');
    return avatar;
  }
  const image = node('img', null, 'model-mark');
  image.alt = '';
  image.src = new URL('logos/' + asset, import.meta.url).href;
  return image;
}
function avatar(player) {
  if (player.kind === 'upload') {
    const icon = mark();
    icon.dataset.initial = player.name.slice(0, 1).toUpperCase();
    return icon;
  }
  return mark(player.name);
}
function identity(player, name = label(player)) {
  const wrapper = node('span', null, 'player-identity');
  wrapper.append(avatar(player), node('span', name));
  return wrapper;
}
function descriptor(p) {
  return p.kind === 'missing'
    ? 'Missing file'
    : p.kind === 'upload'
      ? 'Uploaded'
      : 'Authored';
}

async function mount(root) {
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => [...root.querySelectorAll(sel)];
  const base = new URL(root.dataset.base, location.href);
  const prompt = q('.import-area [data-agent-prompt]');
  const packetURL = q('[data-packet]').href;
  prompt.textContent += ` Download the skill ZIP from ${packetURL} if it is not attached.`;
  function bindCopy(button, prompt, status) {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(prompt.textContent);
        status.textContent = 'Copied. Paste the prompt into your agent.';
      } catch {
        prompt.closest('details').open = true;
        prompt.focus();
        const range = document.createRange();
        range.selectNodeContents(prompt);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent =
          'Copy the prompt above and paste it into your agent.';
      }
    };
  }
  bindCopy(q('[data-copy-prompt]'), prompt, q('[data-copy-status]'));
  for (const tools of qa('[data-revision-tools]')) {
    const revision = tools.querySelector('[data-agent-prompt]');
    revision.textContent = `Revise my attached Weight-space Pong player using pong-match-feedback.json. Use the authoring ZIP I attached or download it from ${packetURL}. Follow the feedback revision track in SKILL.md and TASK.md. Check the original file and match its parameter fingerprint to players in the report. Start with that player's summary. Trace a recurring miss back to the first decision you would change, and compare it with a successful return if available. If there are no misses, examine a draw or a contact instead. Cite the opponent, seed, physical side and tick. Use the observations, hidden activations and action scores to explain one targeted adjustment. Keep the original file. Author one complete player-revised.json and run the canonical checker on it. You may make one format correction. Return the first accepted file, its parent fingerprint and a short explanation of the expected effect. I will test it against the same opponents on the same serves.`;
    bindCopy(
      tools.querySelector('button'),
      revision,
      tools.querySelector('[role=status]'),
    );
  }
  const roster = await readRoster(base);
  const byId = new Map(roster.map((p) => [p.id, p]));
  let stored = [];
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey) || '[]');
    for (const row of rows) {
      try {
        const p = fromUpload(row.name, new TextEncoder().encode(row.text));
        byId.set(p.id, p);
        stored.push(row);
      } catch {
        /* Skip a damaged saved upload. */
      }
    }
  } catch {
    /* Storage can be disabled in private browsing. */
  }
  const ready = roster.filter((p) => p.weights);
  const pending = roster.length - ready.length;
  const available = [...byId.values()].filter((p) => p.weights);
  const first = ready.find((p) => p.id === 'grok-original') || available[0];
  const second =
    ready.find((p) => p.id === 'fable-original' && p !== first) ||
    available.find((p) => p !== first);
  const selection = [first, second];
  const readySeeds = versions.flatMap((version) =>
    ready.filter((player) => player.version === version).map((player) => player.id),
  );
  const customSize = [8, 4, 2].find((n) => n <= readySeeds.length) || 0;
  let seat = 0,
    tab = 0,
    match,
    timer,
    profileName = 'Grok',
    profileVersion = 'Original';
  let running = false,
    competition = newTournament(),
    bestOf = 5,
    fastFinish = false,
    releaseFixtureHold,
    custom = new Set(readySeeds.slice(0, customSize)),
    mode = pending ? 'custom' : 'reference';
  const tabs = qa('[role=tab]'),
    panels = qa('[role=tabpanel]');
  const notice = q('[data-notice]');
  notice.textContent =
    ready.length + ' of ' + roster.length + ' player files ready.';
  function stop() {
    clearInterval(timer);
    timer = null;
    q('[data-pause]').textContent = 'Play';
  }
  function open(index, focus = false) {
    if (tabs[index].disabled) return;
    tab = index;
    if (tab !== 2) releaseFixtureHold?.();
    if (tab !== 1) stop();
    tabs.forEach((t, i) => {
      t.setAttribute('aria-selected', String(index === i));
      t.tabIndex = index === i ? 0 : -1;
      panels[i].hidden = index !== i;
    });
    if (focus) tabs[index].focus();
    if (index === 1 && !match) resetMatch(false);
    if (index === 2) renderTournament();
    if (index === 3) renderProfile();
  }
  tabs.forEach((t, i) => {
    t.onclick = () => open(i);
    t.onkeydown = (e) => {
      let next;
      if (e.key === 'ArrowRight') next = (i + 1) % 4;
      if (e.key === 'ArrowLeft') next = (i + 3) % 4;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = 3;
      if (next !== undefined) {
        e.preventDefault();
        open(next, true);
      }
    };
  });
  function choose(p) {
    if (selection[1 - seat]?.id === p.id) selection[1 - seat] = selection[seat];
    selection[seat] = p;
    seat = 1 - seat;
    match = null;
    renderPicker();
    q('[data-seat="' + seat + '"]').focus();
  }
  function renderPicker() {
    qa('[data-seat]').forEach((b, i) => {
      const p = selection[i],
        copy = node('span', null, 'seat-copy');
      if (!p) {
        b.replaceChildren(node('span', 'Choose P' + (i + 1)));
      } else {
        copy.append(
          node('small', 'P' + (i + 1) + ' / ' + descriptor(p)),
          node('strong', modelName(p)),
          node('em', [p.version, p.record?.effort].filter(Boolean).join(' · ')),
        );
        b.replaceChildren(avatar(p), copy);
      }
      b.setAttribute('aria-pressed', String(i === seat));
      b.onclick = () => {
        seat = i;
        renderPicker();
      };
    });
    q('[data-start]').disabled = tabs[1].disabled = !selection.every(
      (p) => p?.weights,
    );
    q('[data-pick-title]').textContent = 'Choose P' + (seat + 1);
    const grid = q('[data-cards]');
    grid.replaceChildren();
    for (const name of authors) {
      const card = node('div', null, 'model-card'),
        heading = node('h3');
      heading.append(
        mark(name),
        node('span', modelName(byId.get(slotId(name, 'Original')))),
      );
      card.append(heading);
      for (const version of versions) {
        const p = byId.get(slotId(name, version)),
          i = selection.findIndex((item) => item?.id === p.id);
        const choice = [version, p.record?.effort].filter(Boolean).join(' · ');
        const b = button(choice, () => choose(p), i < 0 ? '' : 'p' + (i + 1));
        b.setAttribute(
          'aria-label',
          [label(p), p.record?.effort, descriptor(p)]
            .filter(Boolean)
            .join(' · '),
        );
        b.disabled = !p.weights;
        if (b.disabled) b.append(node('small', 'Missing'));
        if (i >= 0) b.append(node('small', 'P' + (i + 1)));
        card.append(b);
      }
      grid.append(card);
    }
    const extra = node('details');
    extra.append(node('summary', 'Other networks…'));
    for (const p of byId.values()) {
      if (p.version) continue;
      const entry = button(null, () => choose(p));
      entry.append(identity(p));
      extra.append(entry);
    }
    q('[data-extra]').replaceChildren(extra);
  }
  qa('[data-brain]').forEach(enableNetworkTips);
  function paint() {
    [q('[data-left-name]'), q('[data-right-name]')].forEach((el, i) => {
      const player = match.players[i];
      const frame = match.frame[match.swapped ? 1 - i : i];
      if (el.dataset.player !== player.id) {
        el.replaceChildren(identity(player));
        el.dataset.player = player.id;
      }
      el.style.color = colors[i];
      drawNetwork(
        q('[data-brain="' + i + '"]'),
        player.weights,
        frame,
        colors[i],
      );
      q('[data-action="' + i + '"]').textContent = actions[frame.action];
    });
    drawCourt(q('[data-court]'), match.world, colors, match.swapped);
    q('[data-score]').textContent = match.scores.join(' – ');
    const leading =
      match.scores[0] === match.scores[1]
        ? null
        : match.players[Number(match.scores[1] > match.scores[0])];
    const state = q('[data-game-state]');
    if (match.done) {
      state.replaceChildren(
        leading ? identity(leading) : 'Draw',
        (leading ? ' wins' : '') + ' · ' + match.draws + ' drawn serves',
      );
    } else {
      const serve = Math.min(
        GAMES,
        match.game + (match.world.terminal ? 0 : 1),
      );
      state.textContent =
        'Serve ' + serve + '/' + GAMES + ' · tick ' + match.world.elapsedTicks;
    }
    q('[data-step]').disabled = match.done;
    q('[data-series-export]').hidden = !match.done;
    q('[data-series-revision]').hidden = !match.done;
    q('[data-pause]').disabled = match.done;
  }
  const pointCall = q('[data-point-call]');
  let pointTimeout;
  function clearPoint() {
    clearTimeout(pointTimeout);
    pointTimeout = null;
    pointCall.textContent = '';
  }
  function tick() {
    if (pointTimeout) clearPoint();
    advance(match);
    const { terminal, elapsedTicks } = match.world;
    if (terminal?.reason === 'timeout') {
      pointCall.textContent = 'Draw · ' + elapsedTicks + ' ticks';
      pointCall.style.removeProperty('color');
    } else if (terminal?.winner) {
      const winner = match.players.findIndex(
        (player) => player.id === match.games.at(-1).winner,
      );
      const player = match.players[winner];
      const opponent = match.players[1 - winner];
      const name =
        modelName(player) === modelName(opponent)
          ? label(player)
          : modelName(player);
      pointCall.replaceChildren('Point ', identity(player, name));
      pointCall.style.color = colors[winner];
    }
    if (terminal) pointTimeout = setTimeout(clearPoint, 2000);
    if (match.done) stop();
    paint();
  }
  function play() {
    stop();
    if (match.done) return;
    timer = setInterval(
      () => {
        if (!pointTimeout) tick();
      },
      100 / Number(q('[data-speed]').value),
    );
    q('[data-pause]').textContent = 'Pause';
  }
  function resetMatch(autoplay) {
    stop();
    clearPoint();
    match = startSeries(...selection);
    paint();
    if (autoplay) play();
  }
  q('[data-start]').onclick = () => {
    open(1, true);
    resetMatch(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  q('[data-restart]').onclick = () => resetMatch(false);
  q('[data-pause]').onclick = () => (timer ? stop() : play());
  q('[data-step]').onclick = () => {
    stop();
    tick();
  };
  q('[data-speed]').onchange = () => {
    if (timer) play();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  window.addEventListener('pagehide', stop);
  q('[data-players]').onclick = () => {
    open(3, true);
    q('[data-file]').focus();
  };

  function renderProfile() {
    const rail = q('[data-authors]');
    rail.replaceChildren();
    for (const name of authors) {
      const b = button(name, () => {
        profileName = name;
        renderProfile();
      });
      b.replaceChildren(identity(byId.get(slotId(name, 'Original')), name));
      b.setAttribute('aria-pressed', String(name === profileName));
      rail.append(b);
    }
    const p = byId.get(slotId(profileName, profileVersion)),
      info = q('[data-profile]'),
      head = node('div', null, 'profile-heading');
    const select = node('select');
    select.setAttribute('aria-label', 'Player version');
    for (const v of versions)
      select.add(new Option(v, v, false, v === profileVersion));
    select.onchange = () => {
      profileVersion = select.value;
      renderProfile();
    };
    const title = node('h2');
    title.append(identity(p, modelName(p)));
    head.append(title, select);
    info.replaceChildren(head);
    if (!p.weights) {
      info.append(node('p', 'Missing player file'));
      return;
    }
    const original = byId.get(slotId(profileName, 'Original')).record;
    const rows = [
      ...(p.record?.effort ? [['Effort setting', p.record.effort]] : []),
      [
        'Original result',
        original?.result || 'Awaiting the original evaluation.',
      ],
      [
        'Match feedback',
        p.record?.feedback ||
          original?.feedback ||
          'Awaiting the original match report.',
      ],
    ];
    if (profileVersion === 'Revised') {
      rows.push(
        [
          'Author’s revision',
          p.record?.revision || 'Awaiting the author’s revision notes.',
        ],
        [
          'Revised result',
          p.record?.result || 'Awaiting the revised evaluation.',
        ],
      );
    }
    for (const [title, value] of rows) {
      const row = node('div', null, 'record');
      row.append(node('h3', title), node('p', value));
      info.append(row);
    }
  }
  q('[data-file]').onchange = async (e) => {
    const input = e.target,
      file = input.files[0];
    if (!file) return;
    const status = q('[data-upload-state]');
    try {
      if (file.size > 16384)
        throw Error('Choose a weights file of 16 KiB or less.');
      const bytes = new Uint8Array(await file.arrayBuffer()),
        p = fromUpload(file.name, bytes);
      if (byId.has(p.id)) {
        status.textContent = 'This network is already in your roster.';
        return;
      }
      byId.set(p.id, p);
      stored.push({ name: p.name, text: new TextDecoder().decode(bytes) });
      let saved = true;
      try {
        localStorage.setItem(storageKey, JSON.stringify(stored));
      } catch {
        saved = false;
      }
      status.replaceChildren(
        identity(p),
        ' is available in Matchup and Custom tournament' +
          (saved ? '.' : ' for this visit.'),
      );
      renderPicker();
      renderTournament();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      input.value = '';
    }
  };
  function entrants() {
    return (mode === 'reference' ? seeds : [...custom]).map((id) =>
      byId.get(id),
    );
  }
  function exportResults(mode, players, matches, tournament = null) {
    const report = {
      formatVersion: tournament ? 3 : 2,
      tournament: mode,
      guide: feedbackGuide,
      players: players.map((p) => ({
        id: p.id,
        name: label(p),
        source: descriptor(p),
        model: p.record?.model ?? null,
        effort: p.record?.effort ?? null,
        fingerprint: parameterFingerprint(p.weights),
        summary: summarizePlayer(p.id, matches),
      })),
      matches,
    };
    const parts = [];
    if (tournament) {
      Object.assign(report, {
        bestOf,
        pointsToWin: 8,
        series: tournament.series,
        standings: tournament.standings,
        champion: tournament.champion,
      });
      parts.push(JSON.stringify(report).slice(0, -1), ',"traces":[');
      tournament.traces.forEach((trace, i) => {
        if (i) parts.push(',');
        parts.push(trace);
      });
      parts.push(']}');
    } else parts.push(JSON.stringify(report));
    const url = URL.createObjectURL(
      new Blob(parts, { type: 'application/json' }),
    );
    const a = node('a');
    a.href = url;
    a.download = 'pong-match-feedback.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  q('[data-export]').onclick = () =>
    exportResults(mode, entrants(), competition.matches, competition);
  q('[data-series-export]').onclick = () => {
    const { players, scores, draws, miss, games } = match;
    exportResults('head-to-head', players, [
      { players: players.map((p) => p.id), scores, draws, miss, games },
    ]);
  };
  function renderTournament() {
    const modeSelect = q('[data-mode]');
    modeSelect.value = mode;
    modeSelect.disabled = running;
    q('[data-best-of]').disabled = running;
    const box = q('[data-custom]');
    box.replaceChildren();
    if (mode === 'custom') {
      for (const p of byId.values()) {
        const tag = node('label'),
          cb = node('input');
        cb.type = 'checkbox';
        cb.checked = custom.has(p.id);
        cb.disabled = running || !p.weights;
        cb.onchange = () => {
          if (cb.checked) custom.add(p.id);
          else custom.delete(p.id);
          competition = newTournament();
          renderTournament();
          [...box.querySelectorAll('input')][
            Array.from(byId.keys()).indexOf(p.id)
          ]?.focus();
        };
        tag.append(cb, identity(p), p.weights ? '' : ' · Missing');
        box.append(tag);
      }
    }
    const entries = entrants(),
      size = entries.length,
      valid = [2, 4, 8].includes(size);
    const full = mode === 'custom' || !pending;
    const run = q('[data-run]');
    run.disabled = !valid || !full || running;
    q('[data-export]').disabled = !competition.champion;
    q('[data-tournament-revision]').hidden = !competition.champion;
    const current = competition.series.at(-1);
    const state = q('[data-tournament-state]');
    q('[data-fixture]').hidden = !current;
    q('[data-fast-finish]').hidden = !running;
    if (competition.champion)
      state.replaceChildren(
        'Champion · ',
        identity(byId.get(competition.champion)),
      );
    else
      state.textContent = running
        ? 'Tournament in progress'
        : !full
          ? 'Reference tournament opens when all eight authored networks are ready.'
          : 'Select 2, 4 or 8 players. Each pair plays before the knockout. First to 8 points wins a match.';
    const group = q('[data-round-robin]');
    group.replaceChildren();
    const qualifiers = competition.series.filter(
      (s) => s.stage === 'Round robin',
    );
    if (qualifiers.length) {
      const details = node('details');
      details.open = group.dataset.open === 'true';
      details.ontoggle = () => {
        if (details.isConnected) group.dataset.open = String(details.open);
      };
      details.append(node('summary', 'Round-robin results'));
      for (const series of qualifiers) {
        const row = node('p', null, 'fixture-result');
        row.append(
          identity(byId.get(series.players[0])),
          node('b', series.scores.join('–')),
          identity(byId.get(series.players[1])),
          node('small', 'Match points' + matchScores(series)),
        );
        details.append(row);
      }
      group.append(details);
    }
    if (competition.standings.length) {
      group.append(node('h3', 'Knockout seeds'));
      const ranks = node('ol');
      for (const row of competition.standings) {
        const rank = node('li');
        rank.append(
          identity(byId.get(row.player)),
          ' · ' + row.seriesWins + ' series won',
        );
        ranks.append(rank);
      }
      group.append(ranks);
    }
    const completed = competition.series.filter(
      (s) => s.stage !== 'Round robin',
    );
    const tree = q('[data-bracket]');
    tree.replaceChildren();
    if (!valid) return;
    let names = competition.bracket.length
        ? competition.bracket
        : Array(size).fill(null),
      offset = 0;
    while (names.length > 1) {
      const count = names.length / 2,
        round = node('section', null, 'round'),
        body = node('div', null, 'round-body');
      round.append(
        node(
          'h3',
          count === 4 ? 'Quarterfinals' : count === 2 ? 'Semifinals' : 'Final',
        ),
        body,
      );
      tree.append(round);
      const next = [];
      let pair;
      for (let i = 0; i < count; i++) {
        if (i % 2 === 0) {
          pair = node('div', null, count === 1 ? '' : 'branch-pair');
          body.append(pair);
        }
        const m = completed[offset + i],
          card = node('div', null, 'bracket-match');
        for (const s of [0, 1]) {
          const id = names[2 * i + s],
            row = node('div', null, m?.winner === id && id ? 'won' : '');
          row.append(
            id
              ? identity(byId.get(id))
              : node('span', offset ? 'Awaiting winner' : 'Awaiting seeding'),
            node('b', m ? String(m.scores[s]) : '–'),
          );
          card.append(row);
        }
        if (m?.matches.length)
          card.append(node('small', 'Match points' + matchScores(m)));
        pair.append(card);
        next.push(m?.winner);
      }
      names = next;
      offset += count;
    }
  }
  const fixtureCourt = q('[data-fixture-court]');
  const fixtureOverlay = q('[data-fixture-overlay]');
  function showTick(match) {
    if (fastFinish || tab !== 2 || document.hidden) return;
    drawCourt(fixtureCourt, match.world, colors, match.swapped);
    if (match.world.elapsedTicks === 1 || fixtureOverlay.hasChildNodes()) {
      fixtureOverlay.replaceChildren();
      q('[data-fixture-call]').textContent = 'Rally ' + (match.game + 1);
    }
    return new Promise((resolve) => setTimeout(resolve, 50));
  }
  async function showScore(series, match, number) {
    if (fastFinish && !match.done) return;
    const fixture = q('[data-fixture]');
    fixture.hidden = false;
    const isGroup = series.stage === 'Round robin';
    const total = entrants().length;
    q('[data-fixture-stage]').textContent = isGroup
      ? 'Round robin · ' +
        competition.series.length +
        ' / ' +
        (total * (total - 1)) / 2
      : series.stage;
    q('[data-fixture-clock]').textContent =
      'Match ' + number + ' · Best of ' + bestOf;
    match.players.forEach((player, side) => {
      const team = q('[data-fixture-team="' + side + '"]');
      if (team.dataset.player !== player.id) {
        team.replaceChildren(identity(player));
        team.dataset.player = player.id;
      }
      const points = q('[data-points="' + side + '"]');
      if (
        Number(points.textContent) < match.scores[side] &&
        !fastFinish &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        points.animate(
          [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
          { duration: 220 },
        );
      }
      points.textContent = match.scores[side];
    });
    const history = q('[data-rally-history]');
    history.replaceChildren();
    for (const [i, game] of match.games.slice(-5).entries()) {
      const player = byId.get(game.winner);
      const item = node('li');
      const rally = Math.max(0, match.games.length - 5) + i + 1;
      item.title =
        'Rally ' +
        rally +
        ' · ' +
        (player ? label(player) + ' scored' : 'Draw');
      item.setAttribute('aria-label', item.title);
      item.append(player ? avatar(player) : '–');
      item.dataset.side = series.players.indexOf(game.winner);
      history.append(item);
    }
    const call = q('[data-fixture-call]');
    const last = match.games.at(-1);
    const scorer = byId.get(last?.winner);
    drawCourt(fixtureCourt, match.world, colors, match.swapped);
    const side = scorer ? series.players.indexOf(scorer.id) : null;
    fixture.dataset.scorer = side ?? '';
    if (scorer) {
      const name =
        modelName(scorer) === modelName(match.players[1 - side])
          ? label(scorer)
          : modelName(scorer);
      fixtureOverlay.replaceChildren('Point ', identity(scorer, name));
      fixtureOverlay.style.color = colors[side];
      if (match.done) {
        call.replaceChildren(
          identity(scorer, name),
          series.winner ? ' wins the series' : ' wins the match',
        );
      } else {
        call.replaceChildren('Point ', identity(scorer, name));
      }
    } else {
      const draw = last ? 'Draw · ' + last.ticks + ' ticks' : '';
      fixtureOverlay.textContent = draw;
      fixtureOverlay.style.removeProperty('color');
      call.textContent = draw || 'Opening serve';
    }
    q('[data-fixture-series]').textContent =
      'Series ' + series.scores.join('–');
    if (!fastFinish && tab === 2 && !document.hidden) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, last ? 2000 : 400);
        releaseFixtureHold = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      releaseFixtureHold = null;
    }
  }
  const fastButton = q('[data-fast-finish]');
  fastButton.onclick = () => {
    fastFinish = true;
    releaseFixtureHold?.();
    fastButton.disabled = true;
    fastButton.textContent = 'Finishing…';
  };
  function matchScores(series) {
    const scores = series.matches.map((i) =>
      competition.matches[i].scores.join('–'),
    );
    return scores.length ? ' · ' + scores.join(', ') : '';
  }
  const lengthControl = q('[data-best-of]');
  for (const length of seriesLengths)
    lengthControl.add(new Option(String(length), String(length)));
  lengthControl.value = String(bestOf);
  lengthControl.onchange = () => {
    bestOf = Number(lengthControl.value);
    competition = newTournament();
    renderTournament();
  };
  q('[data-mode]').onchange = (e) => {
    mode = e.target.value;
    competition = newTournament();
    renderTournament();
  };
  q('[data-run]').onclick = async () => {
    const roundEntries = entrants();
    if (
      running ||
      ![2, 4, 8].includes(roundEntries.length) ||
      roundEntries.some((p) => !p.weights)
    )
      return;
    running = true;
    fastFinish = false;
    fastButton.disabled = false;
    fastButton.textContent = 'Fast finish';
    competition = newTournament();
    renderTournament();
    try {
      await runTournament(
        roundEntries,
        bestOf,
        competition,
        renderTournament,
        showScore,
        showTick,
      );
    } finally {
      running = false;
      renderTournament();
    }
  };
  renderPicker();
  open(0);
}
for (const root of document.querySelectorAll('.pong-arena')) {
  mount(root).catch((error) => {
    root.querySelector('[data-notice]').textContent = error.message;
  });
}
