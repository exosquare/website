import {
  COUNT,
  COMPRESS,
  R,
  SERVES,
  freshWorld,
  stepWorld,
  decide,
  muteOutgoing,
  radiusOf,
  direction,
  randomServe,
  isBiasIndex as isBias,
  makeCheckpoint,
  makeController,
  compareBranches,
} from "./kernel.js";
import { acceptDemonstration } from "./validate.js";

  const FORK_LAYER = "h1";
  const FORK_UNIT = 2;
  const YAW = 1.02;
  const PITCH = -0.58;
  const DISTANCE = 3.05;
  const FOCAL = 2.15;
  const FRAME = 0.78;
  const GLYPH = 0.048;

  const LAYERS = [
    { id: "input", label: "Input", width: 6, columns: 2 },
    { id: "h1", label: "H1", width: 16, columns: 4 },
    { id: "h2", label: "H2", width: 16, columns: 4 },
    { id: "output", label: "Output", width: 3, columns: 1 },
  ];

  const params = new URLSearchParams(location.search);
  const state = {
    fixture: params.get("fixture") === "fork" ? "fork" : "parent",
    layer: params.get("layer") || "h1",
    unit: Number(params.get("unit") ?? FORK_UNIT),
  };

  const demoFile = await fetch(new URL("./data/demonstration.json", import.meta.url));
  const acceptedDemo = acceptDemonstration(await demoFile.text());
  if (!acceptedDemo.ok) {
    const fault = document.getElementById("fault");
    fault.hidden = false;
    fault.textContent = "The demonstration file was not accepted (" + acceptedDemo.report.errors[0].code + "). It is not a contestant artifact.";
    throw new Error("demonstration");
  }
  const parent = acceptedDemo.weights;
  document.getElementById("stage").dataset.role = acceptedDemo.role;
  document.getElementById("stage").dataset.fingerprint = acceptedDemo.fingerprint;
  let active = Float64Array.from(parent);
  const game = {
    world: freshWorld(SERVES.G0),
    serveId: "G0",
    opponent: "reactive",
    running: false,
    timer: 0,
    rng: 0x57474632,
    seed: 0x57474632,
    lastLeft: null,
    lastRight: null,
    comparison: null,
  };
  let view = { yaw: YAW, pitch: PITCH, simple: false, rotating: false, spin: 0 };

  const nodes = [];
  LAYERS.forEach(function (layer, layerIndex) {
    const rowCount = Math.ceil(layer.width / layer.columns);
    for (let j = 0; j < layer.width; j += 1) {
      const row = Math.floor(j / layer.columns);
      const column = j % layer.columns;
      nodes.push({
        id: layer.id + "-" + j,
        layer: layer.id,
        index: j,
        x: 4 * (layerIndex - 1.5),
        y: (row - (rowCount - 1) / 2) * 1.25,
        z: (column - (layer.columns - 1) / 2) * 1.25,
      });
    }
  });

  const edges = [];
  connect("input", "h1", 0, 16);
  connect("h1", "h2", 112, 16);
  connect("h2", "output", 384, 3);

  const biasOf = {};
  LAYERS.forEach(function (layer) {
    if (layer.id === "input") return;
    const offset = layer.id === "h1" ? 96 : layer.id === "h2" ? 368 : 432;
    for (let j = 0; j < layer.width; j += 1) biasOf[layer.id + "-" + j] = offset + j;
  });

  const camera = makeCamera();
  const court = document.getElementById("court");
  const network = document.getElementById("network");
  const fixtureSelect = document.getElementById("fixture");
  const layerSelect = document.getElementById("layer");
  const unitSelect = document.getElementById("unit");
  let painted = [];

  const check = verifyGraph();
  if (!check.ok) {
    const fault = document.getElementById("fault");
    fault.hidden = false;
    fault.textContent = check.message;
  }

  fixtureSelect.value = state.fixture;
  layerSelect.value = state.layer;
  fillUnits();
  bind();
  wireGame();
  if (state.fixture === "fork") applyMute(state.layer === "h2" ? "h2" : FORK_LAYER, state.unit);
  drawAll();
  publishTick();
  document.fonts.ready.then(drawAll);
  window.addEventListener("resize", drawAll);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(drawAll);
    observer.observe(court);
    observer.observe(network);
  }
  document.documentElement.dataset.previewReady = check.ok ? "true" : "false";

  function connect(fromLayer, toLayer, offset, outputWidth) {
    const sources = nodes.filter(function (node) { return node.layer === fromLayer; });
    const targets = nodes.filter(function (node) { return node.layer === toLayer; });
    sources.forEach(function (source) {
      targets.forEach(function (target) {
        edges.push({
          flat: offset + source.index * outputWidth + target.index,
          from: source.id,
          to: target.id,
          source: source,
          target: target,
        });
      });
    });
  }

  function makeCamera() {
    return {
      project: function (point) {
        const yaw = view.yaw;
        const pitch = view.pitch;
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const eye = { x: DISTANCE * cp * sy, y: DISTANCE * sp, z: DISTANCE * cp * cy };
        const dx = point.x - eye.x;
        const dy = point.y - eye.y;
        const dz = point.z - eye.z;
        if (view.simple) return { x: point.x * 0.85, y: point.y * 0.85, z: DISTANCE };
        let fx = -eye.x;
        let fy = -eye.y;
        let fz = -eye.z;
        const fl = Math.hypot(fx, fy, fz);
        fx /= fl;
        fy /= fl;
        fz /= fl;
        let rx = -fz;
        let ry = 0;
        let rz = fx;
        const rl = Math.hypot(rx, ry, rz);
        rx /= rl;
        ry /= rl;
        rz /= rl;
        const ux = ry * fz - rz * fy;
        const uy = rz * fx - rx * fz;
        const uz = rx * fy - ry * fx;
        const x = dx * rx + dy * ry + dz * rz;
        const y = dx * ux + dy * uy + dz * uz;
        const z = dx * fx + dy * fy + dz * fz;
        return { x: (FOCAL * x) / z, y: (FOCAL * y) / z, z: z };
      },
    };
  }

  function currentValue(flat) {
    return active[flat];
  }

  function mutedRange() {
    const start = 112 + 16 * FORK_UNIT;
    return { start: start, end: start + 16 };
  }

  function selectedNode() {
    return nodes.find(function (node) {
      return node.layer === state.layer && node.index === state.unit;
    });
  }

  function outgoingEdges(node) {
    return edges.filter(function (edge) { return edge.from === node.id; });
  }

  function incomingEdges(node) {
    return edges.filter(function (edge) { return edge.to === node.id; });
  }

  function ownerOf(index) {
    if (index < 96) return { layer: "input", unit: Math.floor(index / 16) };
    if (index < 112) return { layer: "h1", unit: index - 96 };
    if (index < 368) return { layer: "h1", unit: Math.floor((index - 112) / 16) };
    if (index < 384) return { layer: "h2", unit: index - 368 };
    if (index < 432) return { layer: "h2", unit: Math.floor((index - 384) / 3) };
    return { layer: "output", unit: index - 432 };
  }

  function verifyGraph() {
    if (nodes.length !== 41) return { ok: false, message: "Preview check failed: node count " + nodes.length };
    if (edges.length !== 400) return { ok: false, message: "Preview check failed: edge count " + edges.length };
    if (Object.keys(biasOf).length !== 35) return { ok: false, message: "Preview check failed: bias count" };
    const north = direction(0);
    if (Math.abs(north.z) > 1e-9 || north.y < 0.99) return { ok: false, message: "Preview check failed: index origin" };
    const range = mutedRange();
    let changed = 0;
    for (let flat = range.start; flat < range.end; flat += 1) if (parent[flat] !== 0) changed += 1;
    if (changed !== 16) return { ok: false, message: "Preview check failed: fork changed " + changed };
    if (Math.abs(radiusOf(-16) - 0.4 * R) > 1e-12) return { ok: false, message: "Preview check failed: radius at -16" };
    if (Math.abs(radiusOf(0) - 0.6 * R) > 1e-12) return { ok: false, message: "Preview check failed: radius at 0" };
    if (Math.abs(radiusOf(16) - 0.8 * R) > 1e-12) return { ok: false, message: "Preview check failed: radius at 16" };
    if (!(radiusOf(1e6) < R && radiusOf(-1e6) > 0.2 * R)) return { ok: false, message: "Preview check failed: radius bounds" };
    return { ok: true };
  }

  function fillUnits() {
    const layer = LAYERS.find(function (item) { return item.id === state.layer; });
    const previous = state.unit;
    unitSelect.replaceChildren();
    for (let index = 0; index < layer.width; index += 1) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = String(index);
      unitSelect.appendChild(option);
    }
    if (previous >= layer.width) state.unit = 0;
    unitSelect.value = String(state.unit);
    document.getElementById("unit-name").textContent = state.layer === "h1" || state.layer === "h2" ? "Hidden unit" : "Unit";
  }

  function bind() {
    fixtureSelect.addEventListener("change", function () {
      if (fixtureSelect.value === "fork") {
        if (state.layer !== "h1" && state.layer !== "h2") {
          state.layer = FORK_LAYER;
          state.unit = FORK_UNIT;
          layerSelect.value = state.layer;
          fillUnits();
        }
        applyMute(state.layer, state.unit);
      } else {
        resetWeights();
      }
    });
    layerSelect.addEventListener("change", function () {
      state.layer = layerSelect.value;
      fillUnits();
      drawAll();
    });
    unitSelect.addEventListener("change", function () {
      state.unit = Number(unitSelect.value);
      drawAll();
    });
    network.addEventListener("click", function (event) {
      const rect = network.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best = null;
      let bestDistance = 22;
      painted.forEach(function (point) {
        const distance = Math.hypot(point.sx - x, point.sy - y);
        if (distance < bestDistance) {
          best = point;
          bestDistance = distance;
        }
      });
      if (!best) return;
      const owner = ownerOf(best.index);
      state.layer = owner.layer;
      state.unit = owner.unit;
      layerSelect.value = state.layer;
      fillUnits();
      drawAll();
    });
  }

  function drawAll() {
    drawCourt();
    drawCloud();
    renderInspector();
    postFrameHeight();
  }

  let postedHeight = 0;
  function postFrameHeight() {
    if (window.parent === window) return;
    if (!document.documentElement.classList.contains("is-embedded")) {
      document.documentElement.classList.add("is-embedded");
      requestAnimationFrame(postFrameHeight);
      return;
    }
    const main = document.querySelector("main");
    const height = Math.ceil(main.getBoundingClientRect().height);
    if (!Number.isFinite(height) || Math.abs(height - postedHeight) < 2) return;
    postedHeight = height;
    let target = "*";
    try {
      if (document.referrer) target = new URL(document.referrer).origin;
    } catch (error) {
      target = "*";
    }
    window.parent.postMessage({ type: "pong-embed-height", height: height }, target);
  }

  function drawCourt() {
    const width = court.clientWidth;
    const height = court.clientHeight;
    if (width < 2 || height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    court.width = Math.round(width * dpr);
    court.height = Math.round(height * dpr);
    const ctx = court.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101315";
    ctx.fillRect(0, 0, width, height);
    const inset = 12;
    let fieldWidth = width - inset * 2;
    let fieldHeight = fieldWidth / 2;
    if (fieldHeight > height - inset * 2) {
      fieldHeight = height - inset * 2;
      fieldWidth = fieldHeight * 2;
    }
    const x0 = Math.round((width - fieldWidth) / 2);
    const y0 = Math.round((height - fieldHeight) / 2);
    ctx.strokeStyle = "rgba(209, 230, 237, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 31; i += 1) {
      const x = x0 + (i / 31) * fieldWidth;
      ctx.moveTo(Math.round(x) + 0.5, y0);
      ctx.lineTo(Math.round(x) + 0.5, y0 + fieldHeight);
    }
    for (let j = 0; j <= 15; j += 1) {
      const y = y0 + (j / 15) * fieldHeight;
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x0 + fieldWidth, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = "#2b3439";
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, fieldWidth - 1, fieldHeight - 1);
    function worldX(x) { return x0 + (x / 31) * fieldWidth; }
    function worldY(y) { return y0 + ((15 - y) / 15) * fieldHeight; }
    ctx.fillStyle = "#eef5f7";
    const paddleWidth = Math.max(4, Math.round(fieldWidth / 56));
    const ball = Math.max(7, Math.round(fieldHeight / 18));
    drawPaddle(game.world.pLeft, 0);
    drawPaddle(game.world.pRight, 31);
    ctx.fillRect(Math.round(worldX(game.world.x) - ball / 2), Math.round(worldY(game.world.y) - ball / 2), ball, ball);

    function drawPaddle(center, x) {
      const top = worldY(center + 1.5);
      const bottom = worldY(center - 1.5);
      ctx.fillRect(Math.round(worldX(x) - paddleWidth / 2), Math.round(top), paddleWidth, Math.round(bottom - top));
    }
  }

  function drawCloud() {
    const width = network.clientWidth;
    const height = network.clientHeight;
    if (width < 2 || height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    network.width = Math.round(width * dpr);
    network.height = Math.round(height * dpr);
    const ctx = network.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101315";
    ctx.fillRect(0, 0, width, height);
    ctx.shadowBlur = 0;

    const origin = camera.project({ x: 0, y: 0, z: 0 });
    let reach = 0.001;
    for (let step = 0; step < 36; step += 1) {
      const turn = (step / 36) * Math.PI * 2;
      const samples = [
        { x: Math.cos(turn) * R, y: Math.sin(turn) * R, z: 0 },
        { x: Math.cos(turn) * R, y: 0, z: Math.sin(turn) * R },
        { x: 0, y: Math.cos(turn) * R, z: Math.sin(turn) * R },
      ];
      samples.forEach(function (sample) {
        const placed = camera.project(sample);
        reach = Math.max(reach, Math.hypot(placed.x - origin.x, placed.y - origin.y));
      });
    }
    const scale = (Math.min(width, height) * FRAME) / reach;
    const selected = new Set(outgoingEdges(selectedNode()).map(function (edge) { return edge.flat; }));
    const points = [];
    for (let index = 0; index < COUNT; index += 1) {
      const value = currentValue(index);
      const ray = direction(index);
      const radius = radiusOf(value);
      const projected = camera.project({
        x: ray.x * radius,
        y: ray.y * radius,
        z: ray.z * radius,
      });
      points.push({
        index: index,
        value: value,
        kind: isBias(index) ? "bias" : "weight",
        selected: selected.has(index),
        z: projected.z,
        sx: width / 2 + (projected.x - origin.x) * scale,
        sy: height / 2 - (projected.y - origin.y) * scale,
        screen: Math.max(selected.has(index) ? 3.4 : 2.2, (selected.has(index) ? 1.05 : 0.78) * GLYPH * (FOCAL / projected.z) * scale),
      });
    }
    points.sort(function (a, b) { return b.z - a.z; });
    points.forEach(function (point) { if (!point.selected) drawGlyph(ctx, point); });
    drawZeroShell(ctx, width, height, scale, origin);
    points.forEach(function (point) { if (point.selected) drawGlyph(ctx, point); });
    painted = points;
    document.getElementById("stage").dataset.yaw = String(view.yaw);
  }

  function drawZeroShell(ctx, width, height, scale, origin) {
    ctx.save();
    ctx.strokeStyle = "rgba(209, 230, 237, 0.28)";
    ctx.lineWidth = 1.25;
    ["equator", "meridian"].forEach(function (which) {
      ctx.beginPath();
      for (let step = 0; step <= 72; step += 1) {
        const turn = (step / 72) * Math.PI * 2;
        const ring = 0.6 * R;
        const sample = which === "equator"
          ? { x: Math.cos(turn) * ring, y: 0, z: Math.sin(turn) * ring }
          : { x: Math.cos(turn) * ring, y: Math.sin(turn) * ring, z: 0 };
        const placed = camera.project(sample);
        const sx = width / 2 + (placed.x - origin.x) * scale;
        const sy = height / 2 - (placed.y - origin.y) * scale;
        if (step === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawGlyph(ctx, point) {
    const color = point.value === 0 ? "#9ba9af" : point.value > 0 ? "#5ec8c8" : "#e8b060";
    const alpha = point.selected ? 1 : 0.55;
    ctx.save();
    ctx.translate(point.sx, point.sy);
    ctx.lineWidth = point.selected ? 2.2 : 1.5;
    ctx.strokeStyle = cssColor(color, alpha);
    ctx.fillStyle = cssColor(color, alpha);
    const size = point.screen;
    ctx.beginPath();
    if (point.kind === "bias") {
      ctx.moveTo(0, -size * 1.35);
      ctx.lineTo(size, 0);
      ctx.lineTo(0, size * 1.35);
      ctx.lineTo(-size, 0);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
    }
    if (point.selected) {
      ctx.beginPath();
      ctx.strokeStyle = "#d1e6ed";
      ctx.lineWidth = 1.25;
      ctx.arc(0, 0, size + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function cssColor(hex, alpha) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  function renderInspector() {
    const node = selectedNode();
    const outgoing = outgoingEdges(node);
    const incoming = incomingEdges(node);
    const biasIndex = biasOf[node.id];
    const forkOn = state.fixture === "fork";
    const range = mutedRange();
    const bundleMuted = forkOn && outgoing.some(function (edge) {
      return edge.flat >= range.start && edge.flat < range.end;
    });

    let relation = forkOn
      ? "Illustrative local fork. Outgoing weights that changed are drawn at 0. Not an official revision and not evaluated."
      : "Parent demonstration. No local fork applied.";
    if (state.mute && state.mute.actualChangedCount === 0 && forkOn) {
      relation = "No change. Those outgoing weights were already zero.";
    }
    if (forkOn && state.scorePair && state.scorePair.before && state.scorePair.before.rawScores && state.scorePair.after && state.scorePair.after.rawScores) {
      relation += " Before q " + state.scorePair.before.comparisonScores.join(", ")
        + " " + actionName(state.scorePair.before.action)
        + ". After q " + state.scorePair.after.comparisonScores.join(", ")
        + " " + actionName(state.scorePair.after.action) + ".";
    }
    document.getElementById("fork-relation").textContent = relation;

    document.getElementById("bias-line").textContent = biasIndex === undefined
      ? "Inputs have no bias."
      : "Bias " + biasName(node) + " flat " + biasIndex + " " + signed(parent[biasIndex]) + ". Unchanged.";

    document.getElementById("incoming-line").textContent = incoming.length
      ? "Incoming unchanged. " + incoming.map(function (edge) {
        return edge.flat + " " + signed(parent[edge.flat]);
      }).join(", ")
      : "No incoming weights.";

    renderOutgoing(outgoing, forkOn);
    renderAllValues(forkOn, outgoing);
    const changed = outgoing.filter(function (edge) { return parent[edge.flat] !== 0; }).length;
    const change = document.getElementById("change-line");
    if (!forkOn) {
      change.textContent = "Mute outgoing weights copies the demonstration parent, then zeros one hidden unit.";
    } else if (!bundleMuted) {
      change.textContent = "This unit was not muted. Parent and local fork match.";
    } else if (changed === outgoing.length) {
      change.textContent = "Changed " + outgoing.length + " of " + outgoing.length + " listed outgoing weights. Incoming weights and biases are unchanged.";
    } else if (changed === 0) {
      change.textContent = "No change. Those outgoing weights were already zero.";
    } else {
      change.textContent = "Changed " + changed + " of " + outgoing.length + " listed outgoing weights. Incoming weights and biases are unchanged.";
    }

    const values = document.getElementById("value-line");
    values.textContent = outgoing.map(function (edge) {
      const from = signed(parent[edge.flat]);
      if (!forkOn) return edge.flat + " " + from;
      return edge.flat + " " + from + " to " + signed(currentValue(edge.flat));
    }).join(". ");

    const note = document.getElementById("bundle-note");
    if (!outgoing.length) {
      note.textContent = "This unit has no outgoing weights.";
    } else if (forkOn && bundleMuted) {
      note.textContent = outgoing.length + " highlighted points are the outgoing weights of " + node.id + ". The fork draws them at zero. The table has the parent values.";
    } else {
      note.textContent = outgoing.length + " highlighted points are the outgoing weights of " + node.id + ". Directions follow their indices.";
    }

    document.getElementById("live").textContent = "Selected " + node.id + ". " + document.getElementById("fork-relation").textContent;
    const stage = document.getElementById("stage");
    stage.dataset.selected = node.id;
    stage.dataset.fixture = state.fixture;
    stage.dataset.nodes = String(nodes.length);
    stage.dataset.edges = String(edges.length);
    stage.dataset.biases = String(Object.keys(biasOf).length);
    stage.dataset.points = String(COUNT);
    stage.dataset.mapping = "fibonacci-index-abs-radius-v1";
    stage.dataset.radiusRule = "R*(0.60+0.40*w/(16+abs(w)))";
    stage.dataset.compress = String(COMPRESS);
  }

  function renderAllValues(forkOn, outgoing) {
    const host = document.getElementById("all-values");
    if (!host) return;
    const selected = {};
    outgoing.forEach(function (edge) { selected[edge.flat] = true; });
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = "All 435 parameters, in index order";
    table.appendChild(caption);
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Index", "Kind", "Value"].concat(forkOn ? ["Local fork"] : []).forEach(function (label) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    for (let index = 0; index < COUNT; index += 1) {
      const row = document.createElement("tr");
      if (selected[index]) row.className = "is-selected";
      addCell(row, String(index), "");
      addCell(row, isBias(index) ? "bias" : "weight", "");
      addCell(row, signed(parent[index]), signClass(parent[index]));
      if (forkOn) addCell(row, signed(currentValue(index)), signClass(currentValue(index)));
      body.appendChild(row);
    }
    table.appendChild(body);
    host.replaceChildren(table);
  }

  function renderOutgoing(outgoing, forkOn) {
    const host = document.getElementById("outgoing");
    host.replaceChildren();
    if (!outgoing.length) {
      const empty = document.createElement("p");
      empty.textContent = "No outgoing weights.";
      host.appendChild(empty);
      return;
    }
    const pair = document.createElement("div");
    pair.className = "pair";
    const size = outgoing.length > 6 ? 4 : outgoing.length;
    for (let index = 0; index < outgoing.length; index += size) {
      const caption = index === 0 ? "Outgoing weights" : "Outgoing weights, continued";
      pair.appendChild(weightTable(outgoing.slice(index, index + size), forkOn, caption));
    }
    host.appendChild(pair);
  }

  function weightTable(rows, forkOn, captionText) {
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = captionText;
    table.appendChild(caption);
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Flat", "To", "Parent"].concat(forkOn ? ["Local fork"] : []).forEach(function (label) {
      const cell = document.createElement("th");
      cell.textContent = label;
      cell.scope = "col";
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    rows.forEach(function (edge) {
      const row = document.createElement("tr");
      addCell(row, String(edge.flat), "");
      addCell(row, edge.to, "");
      addCell(row, signed(parent[edge.flat]), signClass(parent[edge.flat]));
      if (forkOn) addCell(row, signed(currentValue(edge.flat)), signClass(currentValue(edge.flat)));
      body.appendChild(row);
    });
    table.appendChild(body);
    return table;
  }

  function addCell(row, text, className) {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
  }

  function biasName(node) {
    if (node.layer === "h1") return "b1[" + node.index + "]";
    if (node.layer === "h2") return "b2[" + node.index + "]";
    return "b3[" + node.index + "]";
  }

  function signed(value) {
    if (value === 0) return "0";
    const cleaned = Math.abs(value).toFixed(2).replace(/\.?0+$/, "");
    return (value > 0 ? "+" : "-") + cleaned;
  }

  function signClass(value) {
    if (value === 0) return "zero";
    return value > 0 ? "pos" : "neg";
  }

  function cloneWorld(world) {
    return {
      x: world.x,
      y: world.y,
      vx: world.vx,
      vy: world.vy,
      pLeft: world.pLeft,
      pRight: world.pRight,
      elapsedTicks: world.elapsedTicks,
      phase: world.phase,
      terminal: world.terminal ? { reason: world.terminal.reason, winner: world.terminal.winner } : null,
    };
  }

  function actionName(action) {
    if (action === 1) return "Up";
    if (action === 2) return "Down";
    return "Stay";
  }

  function stopGame() {
    game.running = false;
    if (game.timer) clearInterval(game.timer);
    game.timer = 0;
  }

  function startGame() {
    if (game.world.phase === "terminal") return;
    stopGame();
    game.running = true;
    game.timer = setInterval(tick, 1000 / 30);
  }

  function publishTick() {
    const world = game.world;
    let status = "Tick " + world.elapsedTicks + " of 192. ";
    if (world.phase === "terminal" && world.terminal.reason === "timeout") {
      status += "Timeout draw. 0.5 each. This serve only.";
    } else if (world.phase === "terminal") {
      status += (world.terminal.winner === "left" ? "Left point." : "Right point.") + " This serve only.";
    } else if (game.running) {
      status += "Playing.";
    } else {
      status += "Paused.";
    }
    document.getElementById("tick-readout").textContent = status + " x " + world.x + ", y " + world.y + ", vx " + world.vx + ", vy " + world.vy + ".";
    const score = document.getElementById("score-line");
    const left = game.lastLeft;
    const right = game.lastRight;
    const names = ["stay", "up", "down"];
    names.forEach(function (name, index) {
      const cell = document.getElementById("cell-" + name);
      const shown = document.getElementById("show-" + name);
      const chosen = left && left.rawScores && left.action === index;
      if (cell) cell.classList.toggle("is-chosen", Boolean(chosen));
      if (shown) shown.textContent = left && left.rawScores ? displayScore(left.rawScores[index]) : "—";
    });
    const chosen = document.getElementById("chosen-action");
    const rightLine = document.getElementById("right-action");
    const caption = document.getElementById("decision-caption");
    if (!left) {
      if (caption) caption.textContent = "No decision yet. Scores are not probabilities.";
      if (chosen) chosen.textContent = "Chosen action: none yet.";
      if (rightLine) rightLine.textContent = "";
      score.textContent = "No decision yet.";
      return;
    }
    if (caption) {
      caption.textContent = "Decision on the world before tick " + world.elapsedTicks + ". The court is the world after that tick.";
    }
    if (chosen) chosen.textContent = "Chosen action: " + actionName(left.action) + ".";
    if (rightLine) rightLine.textContent = "Right " + right.controller + ": " + actionName(right.action) + ".";
    score.replaceChildren();
    if (left.rawScores) {
      appendToken(score, "Exact raw ");
      left.rawScores.forEach(function (value, index) {
        appendToken(score, exactNumber(value) + (index < 2 ? ", " : ". "));
      });
      appendToken(score, "Exact q ");
      left.comparisonScores.forEach(function (value, index) {
        appendToken(score, String(value) + (index < 2 ? ", " : "."));
      });
    } else {
      score.textContent = "No network scores.";
    }
  }

  function appendToken(node, text) {
    const span = document.createElement("span");
    span.className = "exact-token";
    span.textContent = text;
    node.appendChild(span);
  }

  function displayScore(value) {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 10) / 10;
    const text = Object.is(rounded, -0) ? "0.0" : rounded.toFixed(1);
    return rounded > 0 ? "+" + text : text;
  }

  function exactNumber(value) {
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }

  function tick() {
    if (game.world.phase === "terminal") {
      stopGame();
      publishTick();
      drawCourt();
      return;
    }
    const left = decide("network", active, game.world, "left", game.rng);
    if (left.error) {
      stopGame();
      const fault = document.getElementById("fault");
      fault.hidden = false;
      fault.textContent = "Inference stopped. A score was not finite.";
      return;
    }
    const right = decide(game.opponent, null, game.world, "right", game.rng);
    game.rng = right.rngState || game.rng;
    game.lastLeft = left;
    game.lastRight = right;
    const next = stepWorld(game.world, left.action, right.action);
    if (next.error) {
      stopGame();
      return;
    }
    game.world = next;
    publishTick();
    drawCourt();
  }

  function beginServe(world, serveId) {
    stopGame();
    game.world = world;
    game.serveId = serveId;
    game.lastLeft = null;
    game.lastRight = null;
    game.comparison = { world: cloneWorld(world), rng: game.rng };
    document.getElementById("stage").dataset.seed = String(game.seed);
    drawCourt();
    publishTick();
    startGame();
  }

  function resetWeights() {
    active = Float64Array.from(parent);
    state.fixture = "parent";
    state.mute = null;
    fixtureSelect.value = "parent";
    drawAll();
    publishTick();
  }

  function applyMute(layer, unit) {
    if (layer !== "h1" && layer !== "h2") return;
    if (game.world.phase !== "terminal") {
      game.comparison = { world: cloneWorld(game.world), rng: game.rng };
    }
    const before = decide("network", parent, game.world, "left", game.rng);
    const result = muteOutgoing(parent, layer, unit);
    active = result.weights;
    state.layer = layer;
    state.unit = unit;
    state.fixture = "fork";
    state.mute = result;
    layerSelect.value = layer;
    fillUnits();
    fixtureSelect.value = "fork";
    const after = game.world.phase === "terminal" ? null : decide("network", active, game.world, "left", game.rng);
    state.scorePair = { before: before, after: after };
    const relation = document.getElementById("fork-relation");
    if (result.actualChangedCount === 0) {
      relation.textContent = "No change. Those outgoing weights were already zero.";
    } else {
      relation.textContent = "Changed " + result.actualChangedCount + " of " + result.changes.length
        + " outgoing weights. Incoming weights and biases are unchanged. Not evaluated as a contest result.";
    }
    if (before && before.rawScores && after && after.rawScores) {
      relation.textContent += " Before q " + before.comparisonScores.join(", ")
        + " " + actionName(before.action)
        + ". After q " + after.comparisonScores.join(", ")
        + " " + actionName(after.action) + ".";
    }
    drawAll();
    publishTick();
  }

  function wireGame() {
    document.getElementById("new-serve").addEventListener("click", function () {
      const serveId = document.getElementById("serve").value;
      game.opponent = document.getElementById("opponent").value;
      if (serveId === "local") {
        const buffer = new Uint32Array(1);
        crypto.getRandomValues(buffer);
        const seed = buffer[0] || 1;
        game.seed = seed;
        game.rng = seed;
        beginServe(randomServe(seed), "local");
      } else {
        game.rng = 0x57474632;
        beginServe(freshWorld(SERVES[serveId]), serveId);
      }
    });
    document.getElementById("pause").addEventListener("click", function () {
      if (game.running) stopGame();
      else startGame();
      publishTick();
    });
    document.getElementById("step").addEventListener("click", function () {
      stopGame();
      tick();
    });
    document.getElementById("opponent").addEventListener("change", function () {
      game.opponent = document.getElementById("opponent").value;
    });
    document.getElementById("mute").addEventListener("click", function () {
      applyMute(state.layer, state.unit);
    });
    document.getElementById("reset-weights").addEventListener("click", resetWeights);
    document.getElementById("reset-comparison").addEventListener("click", function () {
      if (!game.captured) return;
      stopGame();
      game.world = cloneWorld(game.captured.world);
      game.opponent = game.captured.right.ref.kind;
      document.getElementById("opponent").value = game.opponent;
      game.rng = game.captured.right.state.rng ? game.captured.right.state.rng.state : game.rng;
      game.lastLeft = null;
      game.lastRight = null;
      drawCourt();
      publishTick();
    });
    document.getElementById("run-comparison").addEventListener("click", function () {
      if (game.world.phase === "terminal") return;
      stopGame();
      publishTick();
      const captured = makeCheckpoint({
        world: game.world,
        left: makeController("network", { id: "demonstration", artifactSha256: acceptedDemo.fingerprint }),
        right: makeController(game.opponent, { id: game.opponent, seed: game.seed || game.rng, state: game.rng }),
        parentParameterFingerprint: acceptedDemo.fingerprint,
        episode: { id: "local", serveId: game.serveId, cohort: null, round: null, seedPairId: null },
      });
      game.captured = captured;
      const layer = state.layer === "h2" ? "h2" : "h1";
      const unit = state.layer === "h1" || state.layer === "h2" ? state.unit : 0;
      const fork = state.fixture === "fork" ? active : muteOutgoing(parent, layer, unit).weights;
      const pair = compareBranches(captured, parent, fork);
      const report = document.getElementById("comparison-report");
      const parentFirst = pair.parent.decisions[0];
      const forkFirst = pair.fork.decisions[0];
      report.textContent = "Parent " + pair.parent.termination + " " + (pair.parent.winner || "draw")
        + " in " + pair.parent.playedTicks + " ticks. Fork " + pair.fork.termination + " "
        + (pair.fork.winner || "draw") + " in " + pair.fork.playedTicks
        + " ticks. First decision raw parent " + parentFirst.left.rawScores.map(exactNumber).join(", ")
        + " q " + parentFirst.left.comparisonScores.join(", ")
        + ". Fork raw " + forkFirst.left.rawScores.map(exactNumber).join(", ")
        + " q " + forkFirst.left.comparisonScores.join(", ")
        + ". Opponent frozen at capture: " + captured.right.ref.kind + ".";
    });
    document.getElementById("reset-view").addEventListener("click", function () {
      view.yaw = YAW;
      view.pitch = PITCH;
      view.simple = false;
      view.rotating = false;
      drawCloud();
    });
    document.getElementById("rotate").addEventListener("click", function () {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        view.yaw += 0.12;
        drawCloud();
        return;
      }
      view.rotating = true;
      spinView();
    });
    document.getElementById("pause-rotation").addEventListener("click", function () {
      view.rotating = false;
    });
    document.getElementById("simple-view").addEventListener("click", function () {
      view.simple = !view.simple;
      view.rotating = false;
      drawCloud();
    });
    wireChrome();
  }

  function wireChrome() {
    const toggle = document.getElementById("options-toggle");
    const panel = document.getElementById("options");
    let opener = null;
    let suppressFocusOpen = false;
    let fromPointer = false;

    function closeHelp(restore) {
      const button = opener;
      document.querySelectorAll(".help").forEach(function (dialog) { dialog.hidden = true; });
      document.querySelectorAll(".info").forEach(function (info) { info.setAttribute("aria-expanded", "false"); });
      opener = null;
      if (restore && button) {
        suppressFocusOpen = true;
        button.focus();
        suppressFocusOpen = false;
      }
    }

    function placeHelp(button, dialog) {
      let node = button.parentElement;
      while (node) {
        if (node.tagName === "DETAILS") node.open = true;
        node = node.parentElement;
      }
      const margin = 8;
      const width = Math.min(420, window.innerWidth - margin * 2);
      dialog.style.width = width + "px";
      dialog.style.maxHeight = (window.innerHeight - margin * 2) + "px";
      dialog.hidden = false;
      button.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const rect = button.getBoundingClientRect();
      const height = dialog.offsetHeight;
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
      if (left < margin) left = margin;
      let top = rect.bottom + margin;
      if (top + height > window.innerHeight - margin) top = rect.top - height - margin;
      if (top < margin) top = margin;
      if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - margin - height);
      const board = document.getElementById("score-board");
      if (board) {
        const boardRect = board.getBoundingClientRect();
        const covers = top < boardRect.bottom && top + height > boardRect.top && left < boardRect.right && left + width > boardRect.left;
        if (covers) {
          const below = boardRect.bottom + margin;
          if (below + height <= window.innerHeight - margin) top = below;
          else top = Math.max(margin, boardRect.top - height - margin);
        }
      }
      dialog.style.left = left + "px";
      dialog.style.top = top + "px";
    }

    function openHelp(button) {
      const dialog = document.getElementById(button.getAttribute("aria-controls"));
      if (!dialog) return;
      if (opener === button && !dialog.hidden) return;
      closeHelp(false);
      opener = button;
      button.setAttribute("aria-expanded", "true");
      placeHelp(button, dialog);
    }

    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") === "true";
      closeHelp(false);
      const stage = document.getElementById("stage");
      if (open) {
        if (panel.contains(document.activeElement)) toggle.focus();
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Show options";
        stage.classList.remove("options-open");
      } else {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        toggle.textContent = "Hide options";
        stage.classList.add("options-open");
        const heading = document.getElementById("edit-heading");
        if (window.innerWidth < 801) heading.scrollIntoView({ block: "start", behavior: "instant" });
        heading.focus({ preventScroll: true });
      }
      drawAll();
    });

    document.querySelectorAll(".info").forEach(function (button) {
      button.addEventListener("click", function () {
        const dialog = document.getElementById(button.getAttribute("aria-controls"));
        if (opener === button && dialog && !dialog.hidden) closeHelp(false);
        else openHelp(button);
      });
    });
    document.querySelectorAll(".help-dismiss").forEach(function (button) {
      button.addEventListener("click", function () { closeHelp(true); });
    });
    document.addEventListener("focusin", function (event) {
      if (suppressFocusOpen) return;
      if (fromPointer) {
        fromPointer = false;
        return;
      }
      const button = event.target.closest && event.target.closest(".info");
      if (button) {
        openHelp(button);
        return;
      }
      if (opener && event.target.closest && event.target.closest(".help")) return;
      if (opener) closeHelp(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !opener) return;
      event.preventDefault();
      closeHelp(true);
    });
    document.addEventListener("pointerdown", function (event) {
      fromPointer = true;
      if (!opener) return;
      const target = event.target;
      if (target.closest && (target.closest(".help") || target.closest(".info"))) return;
      closeHelp(false);
    });
  }

  function spinView() {
    if (!view.rotating) return;
    view.yaw += 0.12 / 30;
    drawCloud();
    requestAnimationFrame(spinView);
  }

