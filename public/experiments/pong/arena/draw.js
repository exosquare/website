function nodePosition(column, index, count) {
  const spacing = [44, 16, 16, 72][column];
  return { x: 14 + column * 94, y: 142 + (index - (count - 1) / 2) * spacing };
}

const inputs = [
  [
    'Ball distance',
    'Horizontal distance from this player’s end, divided by 31.',
  ],
  ['Ball height', 'Height above the bottom of the court, divided by 15.'],
  [
    'Horizontal velocity',
    'Positive when the ball moves away from this player, negative when it approaches. Divided by 2.',
  ],
  [
    'Vertical velocity',
    'Positive for upward travel and negative for downward travel. Divided by 2.',
  ],
  ['Own paddle height', 'Height of this paddle’s centre, divided by 15.'],
  [
    'Opponent paddle height',
    'Height of the opposing paddle’s centre, divided by 15.',
  ],
];
const outputs = [
  ['Hold', 'Action score for keeping the paddle still.'],
  ['Move up', 'Action score for moving the paddle up one cell.'],
  ['Move down', 'Action score for moving the paddle down one cell.'],
];

export function enableNetworkTips(canvas) {
  const diagram = canvas.parentElement;
  function hideTips() {
    for (const tip of diagram.querySelectorAll('.node-tip')) tip.hidden = true;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTips();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!diagram.contains(e.target)) hideTips();
  });
  for (const [column, signals] of [
    [0, inputs],
    [3, outputs],
  ]) {
    signals.forEach(([name, description], i) => {
      const trigger = document.createElement('button');
      const title =
        (column === 0 ? 'Input ' : 'Output ') + (i + 1) + ' · ' + name;
      trigger.type = 'button';
      trigger.className = 'node-target';
      trigger.setAttribute('aria-label', title);
      const { x, y } = nodePosition(column, i, signals.length);
      trigger.style.left = (100 * x) / canvas.width + '%';
      trigger.style.top = (100 * y) / canvas.height + '%';
      const tip = document.createElement('span');
      tip.className = 'node-tip';
      tip.id = 'brain-' + canvas.dataset.brain + '-' + column + '-' + i;
      tip.setAttribute('role', 'tooltip');
      const heading = document.createElement('strong');
      heading.textContent = title;
      tip.append(heading, description);
      trigger.setAttribute('aria-describedby', tip.id);
      tip.hidden = true;
      const show = () => {
        hideTips();
        tip.hidden = false;
      };
      trigger.onfocus = trigger.onclick = trigger.onpointerenter = show;
      trigger.onblur = () => {
        tip.hidden = true;
      };
      trigger.onpointerleave = () => {
        if (document.activeElement !== trigger) tip.hidden = true;
      };
      diagram.append(trigger, tip);
    });
  }
}

export function drawNetwork(canvas, weights, frame, color) {
  const c = canvas.getContext('2d');
  const layers = [frame.inputs, frame.hidden1, frame.hidden2, frame.rawScores];
  const positions = layers.map((values, column) =>
    values.map((_, index) => nodePosition(column, index, values.length)),
  );
  c.clearRect(0, 0, canvas.width, canvas.height);
  const offsets = [0, 112, 384];
  positions.slice(0, 3).forEach((layer, column) => {
    const next = positions[column + 1];
    layer.forEach((node, i) =>
      next.forEach((target, j) => {
        if (!weights[offsets[column] + i * next.length + j]) return;
        c.strokeStyle = '#586469';
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(node.x, node.y);
        c.lineTo(target.x, target.y);
        c.stroke();
      }),
    );
  });
  layers.forEach((values, column) => {
    const scale = Math.max(0.001, ...values.map(Math.abs));
    values.forEach((value, i) => {
      const { x, y } = positions[column][i];
      const strength = Math.abs(value) / scale;
      c.globalAlpha = 0.65;
      c.fillStyle = '#626a6d';
      c.beginPath();
      c.arc(x, y, 4.3, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = strength;
      c.fillStyle = color;
      c.fill();
      c.globalAlpha = 1;
      if (column === 3 && i === frame.action) {
        c.strokeStyle = color;
        c.beginPath();
        c.arc(x, y, 7, 0, Math.PI * 2);
        c.stroke();
      }
    });
  });
}

export function drawCourt(canvas, world, colors, swapped) {
  const c = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height;
  const y = (value) => h - 12 - (value * (h - 24)) / 15;
  c.fillStyle = '#101416';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#575e60';
  for (let i = 0; i < h; i += 18) c.fillRect(w / 2 - 1, i, 2, 8);
  const paddles = swapped
    ? [world.pRight, world.pLeft]
    : [world.pLeft, world.pRight];
  paddles.forEach((p, i) => {
    c.fillStyle = colors[i];
    c.fillRect(i ? w - 15 : 5, y(p) - (h * 1.5) / 16, 10, (h * 3) / 16);
  });
  c.fillStyle = '#fff';
  const x = swapped ? 31 - world.x : world.x;
  c.fillRect(7 + (x * (w - 25)) / 31, y(world.y) - 5, 10, 10);
}
