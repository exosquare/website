export const feedbackGuide = {
  traceLookup:
    'In tournament format 3, use traces[game.traceId] for every tick of a rally. Identical starts with the same controllers share a trace. Each series lists its match indices in play order.',
  startHere:
    'Find your parameter fingerprint in players and read its summary. Inspect a lost serve’s lastEvent, then its final trace rows. Compare with a successful contact on the same side.',
  coordinates:
    'Absolute court: x = 0 at left, 31 at right; y = 0 at bottom, 15 at top. pLeft and pRight are paddle centre heights. games[].sides maps physical sides to player IDs for the entire serve.',
  timing:
    'One trace row per simulation tick. Both decisions use before. Paddles move, then the ball moves to after. A wall reflection can occur on the same tick as a paddle contact or miss.',
  inputs: [
    'ball distance from own end / 31',
    'ball height / 15',
    'velocity away from own end / 2',
    'vertical velocity / 2',
    'own paddle centre / 15',
    'opponent paddle centre / 15',
  ],
  network:
    'hidden1 and hidden2 are post-ReLU activations in unit index order. rawScores are linear outputs; comparisonScores are floor(rawScore * 1000000 + 0.5). action is the index of the first maximum.',
  actionOrder: ['hold', 'up', 'down'],
  events:
    'event.side identifies the paddle on contact or miss. offset is ball height minus paddle centre after movement: positive means above. missDistance is cells beyond the paddle edge. A timeout can end on a contact or a move.',
  parameters:
    'Use the original weights file matching the fingerprint. Each connection’s contribution is its source activation times its fixed weight. The task packet specifies matrix order and biases.',
};

export function summarizePlayer(id, matches) {
  const summary = {
    servesWon: 0,
    servesLost: 0,
    servesDrawn: 0,
    missesAbove: 0,
    missesBelow: 0,
    totalMissDistance: 0,
  };
  for (const match of matches) {
    if (!match.players.includes(id)) continue;
    for (const game of match.games) {
      if (game.winner === null) summary.servesDrawn++;
      else if (game.winner === id) summary.servesWon++;
      else {
        summary.servesLost++;
        const miss = game.lastEvent;
        if (miss.offset > 0) summary.missesAbove++;
        else summary.missesBelow++;
        summary.totalMissDistance += miss.missDistance;
      }
    }
  }
  return summary;
}
