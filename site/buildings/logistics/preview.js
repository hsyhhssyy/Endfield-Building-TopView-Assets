import * as PIXI from './vendor/pixi.min.js';

const ids = ['family', 'layout', 'animate', 'filled', 'color', 'spacing', 'pause', 'status', 'loading', 'error', 'render-fps', 'source-fps'];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let targetKind = ui.family?.value || 'pipe';
const audit = window.logisticsAudit = {
  ready: false, mode: 'static', frames: 0, dynamicTextures: 0, rafActive: false,
  errors: [], segments: [], waterTime: 0, beltTime: 0, sourceFps: null, family: targetKind,
  supportRotations: {}, fluidCycleTime: 0, fluidCycle: { state: 'static-full', supply: true, occupancy: 1 },
};
const collection = await fetch('./collection.json').then((response) => response.json());
const manifests = new Map();
const resources = new Map();
const textures = new Map();
let app;
let animation = null;
let raf = 0;
let previous = 0;
let waterTime = 0;
let beltTime = 0;
let fluidCycleTime = 0;
let paused = false;
let generation = 0;
let controller = null;
let dynamicNodes = [];
let nodes = [];
let fpsStarted = performance.now();
let fpsFrames = 0;
const PIPE_ROUTE_ORIGIN = 5;
const FALLBACK_FLUID_CYCLE = { fillCellsPerSecond: 8, drainCellsPerSecond: 8, edgeWidth: 0.04 };

function fluidCycleState() {
  const total = nodes.length;
  if (!animation) return { state: ui.filled.checked ? 'static-full' : 'disabled', supply: ui.filled.checked, occupancy: ui.filled.checked ? 1 : 0, start: PIPE_ROUTE_ORIGIN - 1, end: PIPE_ROUTE_ORIGIN + total + 1, total, cycle: 0, progress: ui.filled.checked ? 1 : 0 };
  if (!ui.filled.checked || !total) return { state: 'disabled', supply: false, occupancy: 0, start: PIPE_ROUTE_ORIGIN, end: PIPE_ROUTE_ORIGIN, total, cycle: 0, progress: 0 };
  const config = animation.cycle || FALLBACK_FLUID_CYCLE;
  const fillDuration = total / config.fillCellsPerSecond;
  const drainDuration = total / config.drainCellsPerSecond;
  const duration = fillDuration + drainDuration;
  const phase = ((fluidCycleTime % duration) + duration) % duration;
  const cycle = Math.floor(fluidCycleTime / duration);
  if (phase < fillDuration) {
    const progress = phase / fillDuration;
    return { state: 'filling', supply: true, occupancy: progress, start: PIPE_ROUTE_ORIGIN - config.edgeWidth, end: PIPE_ROUTE_ORIGIN + total * progress, total, cycle, progress, fillDuration, drainDuration };
  }
  const progress = (phase - fillDuration) / drainDuration;
  return { state: 'draining', supply: false, occupancy: 1 - progress, start: PIPE_ROUTE_ORIGIN + total * progress, end: PIPE_ROUTE_ORIGIN + total + config.edgeWidth, total, cycle, progress, fillDuration, drainDuration };
}

function syncFluidUniforms(state = fluidCycleState()) {
  const edge = animation?.cycle?.edgeWidth ?? FALLBACK_FLUID_CYCLE.edgeWidth;
  for (const node of dynamicNodes) {
    if (!node.logisticsLayer?.startsWith('fluid')) continue;
    const uniforms = node.shader.resources.effect.uniforms;
    uniforms.uFilled = state.state === 'disabled' ? 0 : 1;
    uniforms.uFillBounds[0] = state.start;
    uniforms.uFillBounds[1] = state.end;
    uniforms.uFillBounds[2] = edge;
  }
  return state;
}

function showError(error) {
  ui.error.textContent = String(error?.stack || error);
  audit.errors.push(String(error));
}

function status() {
  if (!ui.status) return;
  const mode = animation ? '动态材质' : '静态材质';
  const running = raf ? '播放中' : (paused ? '已暂停' : '未播放');
  const cycle = fluidCycleState();
  const fluid = targetKind !== 'pipe' ? '' : cycle.state === 'filling' ? ` · 供液中 ${Math.round(cycle.progress * 100)}%` : cycle.state === 'draining' ? ` · 停止供应，排空中 ${Math.round(cycle.progress * 100)}%` : cycle.state === 'disabled' ? ' · 空管' : ' · 满管';
  ui.status.textContent = `${mode} · ${targetKind} · ${nodes.length} 个组件 · ${running}${fluid}`;
  audit.mode = animation ? 'dynamic' : 'static';
  audit.family = targetKind;
  audit.rafActive = Boolean(raf);
  audit.waterTime = waterTime;
  audit.beltTime = beltTime;
  audit.fluidCycleTime = fluidCycleTime;
  audit.fluidCycle = { ...cycle };
}

function updateFps(now) {
  fpsFrames += 1;
  const elapsed = now - fpsStarted;
  if (elapsed >= 500) {
    const value = fpsFrames * 1000 / elapsed;
    ui['render-fps'].textContent = `${value.toFixed(1)} FPS`;
    document.documentElement.dataset.renderFps = value.toFixed(1);
    fpsStarted = now;
    fpsFrames = 0;
  }
}

function buildRoute() {
  const cells = [];
  if (ui.layout.value === 'long') {
    for (let x = 0; x < 16; x += 1) cells.push([x, 1]);
  } else {
    for (let x = 0; x < 13; x += 1) cells.push([x, 0]);
    for (let y = 1; y <= 3; y += 1) cells.push([12, y]);
    for (let x = 11; x >= 3; x -= 1) cells.push([x, 3]);
    for (let y = 4; y <= 6; y += 1) cells.push([3, y]);
    for (let x = 4; x < 16; x += 1) cells.push([x, 6]);
  }
  return cells.map(([x, y], index) => {
    const a = cells[Math.max(0, index - 1)];
    const b = cells[Math.min(cells.length - 1, index + 1)];
    const incoming = index ? [x - a[0], y - a[1]] : [b[0] - x, b[1] - y];
    const outgoing = index === cells.length - 1 ? incoming : [b[0] - x, b[1] - y];
    const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
    const shape = cross === 0 ? 'straight' : cross > 0 ? 'left' : 'right';
    return { x, y, index, shape, rotation: Math.atan2(incoming[1], incoming[0]) - Math.PI / 2, start: index, incoming, outgoing };
  });
}

function tex(key) {
  const texture = textures.get(`static/${key}`);
  if (!texture) throw new Error(`Missing static resource ${key}`);
  return texture;
}

function sprite(key, container, tint) {
  const value = new PIXI.Sprite(tex(key));
  value.anchor.set(0.5);
  value.width = value.height = 64;
  if (tint) value.tint = tint;
  container.addChild(value);
  return value;
}

function clear() {
  for (const node of dynamicNodes) {
    node.geometry.destroy();
    node.shader.destroy();
  }
  dynamicNodes = [];
  app.stage.removeChildren().forEach((child) => child.destroy({ children: true }));
}

function drawPipeEndpoints(routeLayer) {
  if (targetKind !== 'pipe' || !nodes.length || !textures.has('static/pipe.endpoint.connector')) {
    audit.endpointConnectors = 0;
    return;
  }
  const endpoints = [
    { segment: nodes[0], direction: nodes[0].incoming, sign: -1 },
    { segment: nodes[nodes.length - 1], direction: nodes[nodes.length - 1].outgoing, sign: 1 },
  ];
  for (const endpoint of endpoints) {
    const outward = [endpoint.direction[0] * endpoint.sign, endpoint.direction[1] * endpoint.sign];
    const holder = new PIXI.Container();
    holder.position.set(
      44 + endpoint.segment.x * 64 + endpoint.direction[0] * 32 * endpoint.sign,
      44 + endpoint.segment.y * 64 + endpoint.direction[1] * 32 * endpoint.sign,
    );
    holder.rotation = Math.atan2(outward[1], outward[0]) - Math.PI / 2;
    routeLayer.addChild(holder);
    sprite('pipe.endpoint.whitening', holder);
    sprite('pipe.endpoint.connector', holder);
  }
  audit.endpointConnectors = endpoints.length;
}

function draw() {
  clear();
  nodes = buildRoute();
  const cycle = fluidCycleState();
  const fillBounds = new Float32Array([cycle.start, cycle.end, animation?.cycle?.edgeWidth ?? FALLBACK_FLUID_CYCLE.edgeWidth, 1]);
  let corners = 0;
  const routeLayer = new PIXI.Container();
  app.stage.addChild(routeLayer);
  for (const segment of nodes) {
    const box = new PIXI.Container();
    const offsetX = 44;
    const offsetY = 44;
    box.position.set(offsetX + segment.x * 64, offsetY + segment.y * 64);
    box.rotation = segment.rotation;
    routeLayer.addChild(box);
    const pipe = targetKind === 'pipe';
    const key = `${pipe ? 'pipe' : 'conveyor'}.${segment.shape}`;
    const supported = pipe && (segment.shape !== 'straight' || segment.index % Number(ui.spacing.value) === 0);
    if (supported && segment.shape !== 'straight') corners += 1;
    if (supported && textures.has(`static/${key}.support-back`)) sprite(`${key}.support-back`, box);
    if (pipe) {
      if (ui.filled.checked) {
        if (animation) {
          dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, true, 'fluid-body', { texture: tex(`${key}.fluid-body`), tint: ui.color.value, fillBounds }));
          dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, true, 'fluid', { fillBounds }));
          dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, true, 'fluid-specular', { texture: tex(`${key}.fluid-specular`), fillBounds }));
        } else {
          sprite(`${key}.fluid-body`, box, ui.color.value);
          sprite(`${key}.fluid-specular`, box);
        }
      }
      if (supported && textures.has(`static/${key}.support-middle`)) sprite(`${key}.support-middle`, box);
      sprite(`${key}.shell`, box);
      if (animation) dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, ui.filled.checked));
      else if (segment.index % 6 === 3) sprite(`${key}.static-marker`, box);
      if (supported && textures.has(`static/${key}.support-front`)) sprite(`${key}.support-front`, box);
    } else {
      sprite(`${key}${animation ? '.base' : '.static'}`, box);
      if (animation) dynamicNodes.push(animation.mesh('conveyor', segment, box, beltTime, false, ui.color.value));
    }
  }
  drawPipeEndpoints(routeLayer);
  audit.segments = nodes.map((segment) => ({ ...segment }));
  audit.cornerSupports = corners;
  syncFluidUniforms(cycle);
  app.render();
  audit.frames += 1;
  if (!animation) ui['render-fps'].textContent = '1.0 FPS（静态）';
  updateFps(performance.now());
  status();
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  previous = 0;
  status();
}

function tick(now) {
  raf = 0;
  if (!animation || paused || !ui.animate.checked) return;
  const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
  previous = now;
  if (targetKind === 'conveyor') beltTime += delta;
  if (targetKind === 'pipe' && ui.filled.checked) {
    waterTime += delta;
    fluidCycleTime += delta;
  }
  const time = targetKind === 'pipe' ? waterTime : beltTime;
  for (const node of dynamicNodes) node.shader.resources.effect.uniforms.uTime = time;
  syncFluidUniforms();
  app.render();
  audit.frames += 1;
  updateFps(now);
  raf = requestAnimationFrame(tick);
  status();
}

function start() {
  stop();
  if (animation && !paused) raf = requestAnimationFrame(tick);
  status();
}

async function setAnimation() {
  const token = ++generation;
  stop();
  controller?.abort();
  controller = null;
  if (animation) {
    clear();
    animation.destroy();
    animation = null;
    audit.dynamicTextures = 0;
  }
  if (!ui.animate.checked) {
    ui.pause.disabled = true;
    ui.loading.textContent = '';
    draw();
    return;
  }
  ui.loading.textContent = '正在加载动态材质…';
  controller = new AbortController();
  try {
    const module = await import('./dynamic.js');
    const result = await module.loadDynamic(PIXI, collection, controller.signal);
    if (token !== generation || !ui.animate.checked) {
      result.destroy();
      return;
    }
    animation = result;
    audit.dynamicTextures = result.textureCount;
    fluidCycleTime = 0;
    paused = false;
    ui.pause.textContent = '暂停';
    ui.pause.disabled = false;
    ui.loading.textContent = '';
    draw();
    start();
  } catch (error) {
    if (error.name !== 'AbortError') showError(error);
    if (token === generation) {
      ui.loading.textContent = '';
      ui.animate.checked = false;
      draw();
    }
  }
}

function setupControls() {
  const syncFamily = () => {
    targetKind = ui.family.value;
    const pipe = targetKind === 'pipe';
    for (const id of ['filled-control', 'color-control', 'spacing-control']) {
      document.getElementById(id)?.toggleAttribute('hidden', !pipe);
    }
    document.documentElement.dataset.logisticsKind = targetKind;
    draw();
  };
  ui.family?.addEventListener('change', syncFamily);
  if (ui.family) {
    targetKind = ui.family.value;
    for (const id of ['filled-control', 'color-control', 'spacing-control']) {
      document.getElementById(id)?.toggleAttribute('hidden', targetKind !== 'pipe');
    }
  }
  ui.layout?.addEventListener('change', () => draw());
  ui.filled?.addEventListener('change', () => draw());
  ui.color?.addEventListener('change', () => draw());
  ui.spacing?.addEventListener('change', () => draw());
  ui.animate?.addEventListener('change', () => void setAnimation());
  ui.pause?.addEventListener('click', () => {
    paused = !paused;
    ui.pause.textContent = paused ? '播放' : '暂停';
    if (paused) stop(); else start();
  });
  if (ui.animate.checked) void setAnimation();
}

async function init() {
  const signature = (item) => JSON.stringify(['sha256', 'width', 'height', 'colorSpace', 'alpha', 'filter', 'wrap'].map((key) => item[key]));
  for (const delivery of collection.deliveries) {
    const url = new URL(delivery.base, location.href);
    const manifest = await fetch(url).then((response) => response.json());
    manifests.set(delivery.id, manifest);
    if (manifest.materialContractVersion !== 2) throw new Error('Expected material contract 2');
    for (const [key, item] of Object.entries(manifest.resources)) {
      if (resources.has(key)) {
        if (signature(resources.get(key)) !== signature(item)) throw new Error(`Conflicting resource ${key}`);
        continue;
      }
      resources.set(key, { ...item, url: new URL(item.file, url).href });
    }
  }
  const pipeManifest = manifests.get(collection.entries['pipe.straight'].id);
  audit.supportRotations = Object.fromEntries(
    ['straight', 'left', 'right'].map((shape) => [shape, pipeManifest.shapes[shape].support.sourceRotationYDegrees]),
  );
  await Promise.all([...resources].map(async ([key, item]) => textures.set(key, await PIXI.Assets.load(item.url))));
  app = new PIXI.Application();
  await app.init({ width: 1088, height: 488, backgroundAlpha: 0, antialias: true, preference: 'webgl', autoStart: false, sharedTicker: false });
  app.stop();
  document.getElementById('stage').appendChild(app.canvas);
  audit.pixiVersion = PIXI.VERSION;
  audit.renderer = 'webgl';
  ui['source-fps'].textContent = 'N/A（程序化材质）';
  ui.loading.textContent = '';
  setupControls();
  draw();
  audit.ready = true;
  document.documentElement.dataset.previewReady = 'true';
  document.documentElement.dataset.logisticsKind = targetKind;
  window.logisticsExample = { draw, setAnimation, app, resources, collection, setFluidCycleTime(value) { fluidCycleTime = Math.max(0, Number(value) || 0); draw(); } };
}

init().catch(showError);
