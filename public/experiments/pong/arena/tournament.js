import { startSeries, advance } from './match.js';

export const seriesLengths = [1, 3, 5, 7, 9];

export function newTournament() {
  return {
    series: [],
    matches: [],
    standings: [],
    bracket: [],
    traces: [],
    champion: null,
  };
}

export async function runTournament(
  players,
  bestOf,
  result,
  onUpdate = () => {},
  onScore = () => {},
  onTick,
) {
  if (![2, 4, 8].includes(players.length) || !seriesLengths.includes(bestOf)) {
    throw new Error('Choose 2, 4 or 8 players and a supported series length.');
  }
  const byId = new Map(players.map((p) => [p.id, p]));
  const traceIds = new Map();
  const standings = new Map(
    players.map((p, seed) => [
      p.id,
      {
        player: p.id,
        seed,
        seriesWins: 0,
        matchDifference: 0,
        pointDifference: 0,
      },
    ]),
  );

  async function playPair(left, right, stage) {
    const ids = [left, right];
    const series = {
      stage,
      players: ids,
      scores: [0, 0],
      winner: null,
      matches: [],
    };
    const seriesIndex = result.series.length;
    result.series.push(series);
    const target = (bestOf + 1) / 2;
    for (let index = 0; !series.scores.includes(target); index++) {
      onUpdate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const match = startSeries(byId.get(left), byId.get(right), index);
      await onScore(series, match, index + 1);
      while (!match.done) {
        advance(match);
        if (!match.world.terminal) {
          const delay = onTick?.(match);
          if (delay) await delay;
          continue;
        }
        const game = match.games.at(-1);
        const key = JSON.stringify([
          game.sides.left,
          game.sides.right,
          game.seed,
        ]);
        if (!traceIds.has(key)) {
          traceIds.set(key, result.traces.length);
          result.traces.push(new Blob([JSON.stringify(game.trace)]));
        }
        game.traceId = traceIds.get(key);
        delete game.trace;
        if (!match.done) await onScore(series, match, index + 1);
      }
      const winner = match.scores.indexOf(8);
      series.scores[winner]++;
      series.matches.push(result.matches.length);
      result.matches.push({
        seriesIndex,
        number: index + 1,
        players: ids,
        winner: ids[winner],
        scores: match.scores,
        draws: match.draws,
        miss: match.miss,
        games: match.games,
      });
      if (series.scores[winner] === target) series.winner = ids[winner];
      await onScore(series, match, index + 1);
      if (stage === 'Round robin') {
        for (const side of [0, 1]) {
          const row = standings.get(ids[side]);
          row.matchDifference += side === winner ? 1 : -1;
          row.pointDifference += match.scores[side] - match.scores[1 - side];
        }
      }
    }
    if (stage === 'Round robin') standings.get(series.winner).seriesWins++;
    return series.winner;
  }

  for (let i = 0; i < players.length; i++) {
    for (const opponent of players.slice(i + 1)) {
      await playPair(players[i].id, opponent.id, 'Round robin');
    }
  }
  result.standings = [...standings.values()].sort(
    (a, b) =>
      b.seriesWins - a.seriesWins ||
      b.matchDifference - a.matchDifference ||
      b.pointDifference - a.pointDifference ||
      a.seed - b.seed,
  );
  const positions =
    players.length === 8
      ? [0, 7, 3, 4, 1, 6, 2, 5]
      : players.length === 4
        ? [0, 3, 1, 2]
        : [0, 1];
  result.bracket = positions.map((i) => result.standings[i].player);
  let round = result.bracket;
  while (round.length > 1) {
    const next = [];
    const stage =
      round.length === 8
        ? 'Quarterfinal'
        : round.length === 4
          ? 'Semifinal'
          : 'Final';
    for (let i = 0; i < round.length; i += 2) {
      next.push(await playPair(round[i], round[i + 1], stage));
    }
    round = next;
  }
  result.champion = round[0];
}
