# Pong task packet

Use the enclosed SKILL.md to author one player. Return one UTF-8 JSON file with exactly two keys, "version" set to "pong-feedback-v1" and "weights" containing all 435 literal numbers. The upload limit is 16,384 bytes. Use finite decimal numbers from -16 through 16, at most six fractional digits, with no exponents. A missing or rejected artifact is unplayed.

## Network and court

The court runs from x = 0 to 31 and y = 0 to 15. Up increases y. Paddle centres range from 1 to 14. Each paddle covers its centre and one cell to either side vertically. Both controllers observe the pre-tick state. Each moves at most one cell before the ball moves. The ball reflects excess vertical travel across heights 0 and 15 first. When its proposed x reaches or crosses an end, compare its reflected height with the new paddle centre. A miss ends the rally. A hit reflects excess horizontal travel and reverses horizontal velocity. A hit one cell above or below centre gives vertical velocity +2 or -2 respectively. A central hit retains the vertical direction at speed 1. A live rally reaching tick 192 is drawn.

Observe from the player's own end. Inputs, in order, are distance of the ball from that end divided by 31, ball height divided by 15, horizontal velocity away from that end divided by 2, vertical velocity divided by 2, own paddle centre divided by 15 and opposing paddle centre divided by 15. The runtime reflects x and horizontal velocity for the right controller.

Use a 6 → 16 → 16 → 3 dense network. Apply ReLU after each hidden layer and a linear output layer. Store W1 (96), b1 (16), W2 (256), b2 (16), W3 (48), b3 (3) in this order. In each matrix, lay out all outgoing weights of one input consecutively. For each output, initialise the sum to the bias, then accumulate products in input order with JavaScript binary64 arithmetic. Compare floor(raw score × 1,000,000 + 0.5). Output order is hold, up, down. The earliest tied maximum wins.

## Check a submission

Requires Node.js 24 or later. From the unzipped directory run `node check-authoring.mjs --canonical player.json`. Exit 0 accepts the file. Before returning diagnostics to an author, select only the previously agreed fields in `forAuthor`. SHA256SUMS identifies the distributed bytes. The checker supports separate six-list and matrix-row adaptation tracks when explicitly declared. Use its `--help` for the invocations.

## Play and feedback

Head-to-head exhibitions use the four starts below, each played from both sides. After eight rallies, more points wins and equal points give a draw.

Tournaments accept 2, 4 or 8 entrants. Every pair plays one round-robin series. Rank all players by series wins, then match wins minus losses, then points scored minus conceded, then original entry order. All players enter the seeded knockout. With eight entrants the opening pairings by rank are 1–8, 4–5, 2–7 and 3–6; with four they are 1–4 and 2–3.

Every tournament match ends as soon as one player scores eight points. A drawn rally awards zero points. Series are best of 1, 3, 5, 7 or 9 matches. The default is five, so three match wins clinch a series at either stage. For reproducible starts, the seed list is 19, 73, 109, 211 followed by integers 1 through 32, cycling as needed. Play each start from both sides unless the match ends first. In each series, match number m (counting from 1) starts at zero-based seed index 4 × (m − 1) modulo 36. The first player opens on the left in odd matches and on the right in even matches.

For an official run the operator freezes the prompt, budgets, model identity evidence, implementation hashes and actual entrants before play. A missing player file leaves its slot unavailable for play. A custom tournament with four originals can provide feedback before the revisions exist. Download match feedback after the final and give each author their own measured results and original file under the revision track. Keep original and revised artifacts separately.

## Ordered starting positions

Each row runs twice. In the second game, exchange the players and keep the same initial court state.

| Seed | x | y | vx | vy | Left centre | Right centre |
|---:|---:|---:|---:|---:|---:|---:|
| 19 | 19 | 0 | 2 | 2 | 3 | 12 |
| 73 | 10 | 5 | -2 | -2 | 10 | 3 |
| 109 | 26 | 7 | -2 | -2 | 2 | 11 |
| 211 | 3 | 4 | 2 | -2 | 9 | 11 |

## Revise a player from match feedback

The arena exports one JSON report for a completed series or both stages of a tournament. To identify your player, run the packaged checker on its original file and look up `operator.parameterFingerprintSha256` in `players[].fingerprint`. Use that player's ID throughout the report. Two entries can share weights, so also check the entry name if a fingerprint appears twice.

In a tournament download (format version 3), each series identifies its stage and lists its indices into the matches array. Each rally identifies its tick log by index in the top-level traces array: use `traces[game.traceId]`. Repeated deterministic starts share one copy. Head-to-head reports (format version 2) store the tick log in `game.trace`.

Start with the player's summary of wins, losses, draws and misses above or below the paddle. Match scores and total miss distances follow the order of the two IDs in `matches[].players`. Each game has its seed, physical side assignments, winner (null for a draw), ending and last event. Use `games[].sides` to find your controller on each serve.

Each trace row contains the board before and after one tick. The left and right records show what each controller observed, both hidden layers after ReLU, the three raw and quantized action scores and the chosen action index. To inspect one connection, multiply its source activation by the corresponding weight in the original file. Include its bias and the remaining inputs when reconstructing a unit's sum.

Read a missed point backward from its final event to the first decision that put the paddle out of reach. Compare it with a return or a drawn serve. Cite the opponent, seed, side and tick in your revision notes. Return a separate revised player and record the parent's parameter fingerprint. Judge the change by playing both versions against the same opponents and serves.
