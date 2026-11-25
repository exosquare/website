import { infer, observe, randomServe, stepDetailed } from '../kernel.js';

// Both opponents play each starting position from each side.
const SEEDS = [19, 73, 109, 211];
export const GAMES = SEEDS.length * 2;

// The tournament schedule cycles through paired starts; seed 17 guarantees a
// point even if both networks return every reachable ball.
const tournamentSeeds = [
  ...SEEDS,
  ...Array.from({ length: 32 }, (_, i) => i + 1),
];

export function startSeries(left, right, matchIndex = null) {
  const match = {
    players: [left, right],
    matchIndex,
    game: 0,
    scores: [0, 0],
    draws: 0,
    miss: [0, 0],
    ticks: 0,
    done: false,
    games: [],
  };
  serve(match);
  return match;
}

function serve(match) {
  const index = Math.floor(match.game / 2);
  const tournament = match.matchIndex !== null;
  match.seed = tournament
    ? tournamentSeeds[(index + match.matchIndex * 4) % tournamentSeeds.length]
    : SEEDS[index];
  match.swapped = Boolean((match.game + (match.matchIndex ?? 0)) % 2);
  match.trace = [];
  match.world = randomServe(match.seed);
  match.frame = decisions(match);
}

function decisions(match) {
  return ['left', 'right'].map((side, index) => {
    const player = match.players[match.swapped ? 1 - index : index];
    const frame = infer(player.weights, observe(match.world, side));
    const [, hidden1, hidden2] = brainLayers(player.weights, frame);
    return { ...frame, hidden1, hidden2 };
  });
}

export function advance(match) {
  if (match.done) return;
  if (match.world.terminal) serve(match);
  const before = match.world;
  match.frame = decisions(match);
  const [left, right] = match.frame;
  const { world, event } = stepDetailed(before, left.action, right.action);
  match.world = world;
  const eventType = event.side
    ? event.missDistance === undefined
      ? 'contact'
      : 'miss'
    : event.type;
  match.trace.push({
    tick: world.elapsedTicks,
    before,
    left,
    right,
    after: world,
    event: { ...event, type: eventType },
    wallReflection: before.y + before.vy < 0 || before.y + before.vy > 15,
  });
  match.ticks++;
  const terminal = match.world.terminal;
  if (!terminal) return;
  let winner = null;
  if (terminal.winner) {
    const side = terminal.winner === 'left' ? 0 : 1;
    winner = match.swapped ? 1 - side : side;
    match.scores[winner]++;
    const missedPaddle = side === 0 ? match.world.pRight : match.world.pLeft;
    match.miss[1 - winner] += Math.max(
      0,
      Math.abs(match.world.y - missedPaddle) - 1,
    );
  } else match.draws++;
  match.games.push({
    seed: match.seed,
    sidesReversed: match.swapped,
    winner: winner === null ? null : match.players[winner].id,
    ticks: match.world.elapsedTicks,
    sides: {
      left: match.players[match.swapped ? 1 : 0].id,
      right: match.players[match.swapped ? 0 : 1].id,
    },
    ending: terminal.reason,
    lastEvent: match.trace.at(-1).event,
    trace: match.trace,
  });
  match.game++;
  match.done =
    match.matchIndex === null ? match.game === GAMES : match.scores.includes(8);
}

// Hidden activations of the frozen 6–16–16–3 kernel. Gameplay uses infer() above.
export function brainLayers(weights, frame) {
  function reluLayer(inputs, matrix, bias) {
    return Array.from({ length: 16 }, (_, unit) => {
      let sum = weights[bias + unit];
      inputs.forEach((input, i) => {
        sum += input * weights[matrix + i * 16 + unit];
      });
      return Math.max(0, sum);
    });
  }
  const first = reluLayer(frame.inputs, 0, 96);
  return [frame.inputs, first, reluLayer(first, 112, 368), frame.rawScores];
}
