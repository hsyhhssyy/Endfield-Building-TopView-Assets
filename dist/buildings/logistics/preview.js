import * as PIXI from './vendor/pixi.min.js';
let playback = new URLSearchParams(location.search).get('renderer') === 'baked' ? 'baked' : 'draw';

const ids = ['family', 'layout', 'animate', 'fluid', 'no-wait', 'spacing', 'pause', 'restart', 'zoom', 'status', 'loading', 'error', 'render-fps', 'source-fps'];
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
const staticSets = new Map();
let app;
let animation = null;
let raf = 0;
let previous = 0;
let waterTime = 0;
let beltTime = 0;
let fluidCycleTime = 0;
let flowCycle = null;
let paused = false;
let generation = 0;
let controller = null;
let dynamicNodes = [];
let nodes = [];
let fpsStarted = performance.now();
let fpsFrames = 0;
const PIPE_ROUTE_ORIGIN = 5;
const FALLBACK_FLUID_CYCLE = { fillCellsPerSecond: 2, drainDuration: 2, edgeWidth: 0.012 };

function fluidCycleState() {
  const total = nodes.length;
  if (!animation) return { state: (ui.fluid.value !== 'none') ? 'static-full' : 'disabled', supply: (ui.fluid.value !== 'none'), occupancy: (ui.fluid.value !== 'none') ? 1 : 0, thickness: (ui.fluid.value !== 'none') ? 1 : 0, hasHead: false, start: PIPE_ROUTE_ORIGIN - 1, end: PIPE_ROUTE_ORIGIN + total + 1, total, cycle: 0, progress: (ui.fluid.value !== 'none') ? 1 : 0 };
  if (!(ui.fluid.value !== 'none') || !total) return { state: 'disabled', supply: false, occupancy: 0, thickness: 0, hasHead: false, start: PIPE_ROUTE_ORIGIN, end: PIPE_ROUTE_ORIGIN, total, cycle: 0, progress: 0 };
  if (!flowCycle || flowCycle.total !== total) {
    flowCycle = animation.createFluidCycle(total, PIPE_ROUTE_ORIGIN, ui['no-wait'].checked);
    flowCycle.seek(fluidCycleTime);
  }
  return flowCycle.snapshot();
}

function fluidProfile() { return manifests.get(collection.entries['pipe.straight'].id).fluidProfiles[ui.fluid.value]; }
function boundaryShape(state) { return state.hasHead ? Math.min(1, state.progress * state.total * 2, (1 - state.progress) * state.total * 2) : 0; }

function syncFluidUniforms(state = fluidCycleState()) {
  if (animation?.baked) {
    animation.beginFrame(state, waterTime);
    for (const node of dynamicNodes) animation.update(node, state, targetKind === 'pipe' ? waterTime : beltTime);
    return state;
  }
  const edge = animation?.cycle?.edgeWidth ?? FALLBACK_FLUID_CYCLE.edgeWidth;
  for (const node of dynamicNodes) {
    if (!node.logisticsLayer?.startsWith('fluid')) continue;
    const uniforms = node.shader.resources.effect.uniforms;
    uniforms.uFilled = state.thickness;
    uniforms.uFillBounds[0] = state.start;
    uniforms.uFillBounds[1] = state.end;
    uniforms.uFillBounds[2] = edge;
    uniforms.uFillBounds[3] = boundaryShape(state);
  }
  return state;
}

function showError(error) {
  ui.error.textContent = String(error?.stack || error);
  audit.errors.push(String(error));
}

function status() {
  if (!ui.status) return;
  const mode = animation ? (playback === 'baked' ? '烘焙播放' : '实时绘制') : '静态材质';
  const running = raf ? '播放中' : (paused ? '已暂停' : '未播放');
  const cycle = fluidCycleState();
  const fluidLabels = {
    filling: `水头推进 ${Math.round(cycle.progress * 100)}%`,
    draining: `停止供应，整管变细 ${Math.round(cycle.thickness * 100)}%`,
    recovering: `恢复供应，整管变粗 ${Math.round(cycle.thickness * 100)}%`,
    holding: '持续供应 · 满管', empty: '已排空，即将重新供水', disabled: '空管', 'static-full': '满管',
  };
  const fluid = targetKind !== 'pipe' ? '' : ` · ${fluidLabels[cycle.state]}`;
  const family = targetKind === 'pipe' ? `管道 · ${fluidProfile()?.name || '无'}` : '传送带';
  ui.status.textContent = `${mode} · ${family} · ${nodes.length} 个组件 · ${running}${fluid}`;
  audit.mode = animation ? 'dynamic' : 'static';
  audit.playback = playback;
  audit.family = targetKind;
  audit.fluidId = ui.fluid.value;
  audit.fluidPhase = fluidProfile()?.phase || 'none';
  audit.rafActive = Boolean(raf);
  audit.waterTime = waterTime;
  audit.beltTime = beltTime;
  audit.fluidCycleTime = fluidCycleTime;
  audit.fluidCycle = { ...cycle };
  ui.restart.disabled = !animation;
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

function pipeLogoPlacements(segments) {
  const selected = new Set();
  const spacing = 9; // round(1 / the recovered staticDensity .11)
  const supportSpacing = Math.max(1, Number(ui.spacing.value) || 6);
  for (let start = 0; start < segments.length;) {
    if (segments[start].shape !== 'straight') { start += 1; continue; }
    let end = start + 1;
    while (end < segments.length && segments[end].shape === 'straight'
      && segments[end].rotation === segments[start].rotation) end += 1;
    const run = segments.slice(start, end);
    // A complete label is atomic. Short runs between two bends get no label;
    // this prevents the source phase strip from leaving a clipped tail.
    if (run.length >= 3) {
      const count = Math.max(1, Math.round(run.length / spacing));
      const used = new Set();
      for (let slot = 0; slot < count; slot += 1) {
        const ideal = Math.min(run.length - 2, Math.max(1, Math.floor((slot + .5) * run.length / count)));
        const candidates = [ideal];
        for (let delta = 1; delta < run.length; delta += 1) candidates.push(ideal - delta, ideal + delta);
        const local = candidates.find(value => value >= 1 && value < run.length - 1
          && !used.has(value) && run[value].index % supportSpacing !== 0);
        if (local !== undefined) { used.add(local); selected.add(run[local].index); }
      }
    }
    start = end;
  }
  return selected;
}

function tex(key) {
  const texture = textures.get(`static/${key}`);
  if (!texture) throw new Error(`Missing static resource ${key}`);
  return texture;
}

function sprite(key, container, tint, layer) {
  const value = new PIXI.Sprite(tex(key));
  value.anchor.set(0.5);
  value.width = value.height = 64;
  value.logisticsLayer = layer || key.split('.').slice(2).join('.') || key;
  if (tint) value.tint = tint;
  container.addChild(value);
  return value;
}

function dynamicPipeMarks(segment, container) {
  dynamicNodes.push(animation.mesh('pipe', segment, container, waterTime, false, 'chevron'));
}

function staticPipeChevron(key, container) {
  if (!textures.has(`static/${key}.static-chevron`)) { sprite(`${key}.static-marker`, container); return; }
  sprite(`${key}.static-chevron`, container);
}

function staticPipeLogo(container) {
  for (const layer of ['logo-glow', 'logo-core']) {
    const key = `pipe.straight.static-${layer}`;
    if (textures.has(`static/${key}`)) sprite(key, container, undefined, layer);
  }
}

function clear() {
  for (const node of dynamicNodes) {
    if (node.bakedData) continue;
    node.geometry.destroy();
    node.shader.destroy();
  }
  dynamicNodes = [];
  animation?.clearScene?.();
  app.stage.removeChildren().forEach((child) => child.destroy({ children: true }));
}

function drawBakedFlowRoute(routeLayer, logoSegments) {
  const back = new PIXI.Container(), fluid = new PIXI.Container(), front = new PIXI.Container();
  routeLayer.addChild(back, fluid, front);
  let corners = 0;
  for (const segment of nodes) {
    const holder = layer => {
      const box = new PIXI.Container();box.position.set(44+segment.x*64,44+segment.y*64);box.rotation=segment.rotation;
      layer.addChild(box);return box;
    };
    const behind = holder(back), above = holder(front), key = `pipe.${segment.shape}`;
    const supported = segment.shape !== 'straight' || segment.index % Number(ui.spacing.value) === 0;
    if (supported && segment.shape !== 'straight') corners++;
    if (supported && textures.has(`static/${key}.support-back`)) sprite(`${key}.support-back`, behind);
    if (supported && textures.has(`static/${key}.support-middle`)) sprite(`${key}.support-middle`, above);
    sprite(`${key}.shell`, above);
    dynamicPipeMarks(segment, above);
    if (logoSegments.has(segment.index)) staticPipeLogo(above);
    if (supported && textures.has(`static/${key}.support-front`)) sprite(`${key}.support-front`, above);
  }
  if (ui.fluid.value !== 'none') dynamicNodes.push(animation.route(nodes,fluid,fluidProfile()));
  return corners;
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
  const fillBounds = new Float32Array([cycle.start, cycle.end, animation?.cycle?.edgeWidth ?? FALLBACK_FLUID_CYCLE.edgeWidth, boundaryShape(cycle)]);
  const logoSegments = targetKind === 'pipe' ? pipeLogoPlacements(nodes) : new Set();
  let corners = 0;
  const routeLayer = new PIXI.Container();
  app.stage.addChild(routeLayer);
  if (animation?.flowField && targetKind === 'pipe') corners = drawBakedFlowRoute(routeLayer, logoSegments);
  else for (const segment of nodes) {
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
      if ((ui.fluid.value !== 'none')) {
        if (animation) {
          dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, true, 'fluid-body', { texture: tex(`${key}.fluid-body`), profile: fluidProfile(), fillBounds }));
          if (!animation.baked) {
          dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, true, 'fluid', { profile: fluidProfile(), fillBounds }));
          dynamicNodes.push(animation.mesh('pipe', segment, box, waterTime, true, 'fluid-specular', { texture: tex(`${key}.fluid-specular`), profile: fluidProfile(), fillBounds }));
          }
        } else {
          if (fluidProfile().phase === 'gas') sprite(`${key}.gas-body`, box);
          else { sprite(`${key}.fluid-body`, box, fluidProfile().colors.body.hex); sprite(`${key}.fluid-specular`, box); }
        }
      }
      if (supported && textures.has(`static/${key}.support-middle`)) sprite(`${key}.support-middle`, box);
      sprite(`${key}.shell`, box);
      if (animation) dynamicPipeMarks(segment, box);
      else if (segment.index % 6 === 3) staticPipeChevron(key, box);
      if (logoSegments.has(segment.index)) staticPipeLogo(box);
      if (supported && textures.has(`static/${key}.support-front`)) sprite(`${key}.support-front`, box);
    } else {
      sprite(`${key}${animation ? '.base' : '.static'}`, box);
      if (animation) dynamicNodes.push(animation.mesh('conveyor', segment, box, beltTime, false));
    }
  }
  drawPipeEndpoints(routeLayer);
  audit.segments = nodes.map((segment) => ({ ...segment }));
  audit.logoPlacements = [...logoSegments];
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
  if (targetKind === 'pipe' && (ui.fluid.value !== 'none')) {
    fluidCycleState();
    const state = flowCycle.advance(delta);
    if (state.thickness > 0) waterTime += delta;
    fluidCycleTime += delta;
  }
  const time = targetKind === 'pipe' ? waterTime : beltTime;
  if (!animation.baked) for (const node of dynamicNodes) node.shader.resources.effect.uniforms.uTime = time;
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

function syncPlaybackUI() {
  const baked = playback === 'baked';
  document.documentElement.dataset.logisticsPlayback = playback;
  for (const tab of document.querySelectorAll('[data-playback]')) {
    const selected = tab.dataset.playback === playback;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const element of document.querySelectorAll('[data-playback-only]')) element.hidden = element.dataset.playbackOnly !== playback;
  document.getElementById('preview-panel').setAttribute('aria-labelledby', `tab-${playback}`);
  document.getElementById('preview-heading').textContent = baked ? '管道与传送带(烘焙)' : '管道与传送带(绘制)';
  document.getElementById('mode-description').textContent = baked
    ? '使用已烘焙的素材播放，保留流体粗细起伏、水头和排空效果。'
    : '实时计算流体与传送带动画，查看完整参考效果。';
  document.getElementById('animate-label').textContent = baked ? '播放烘焙动画' : '启用动画';
  ui['source-fps'].textContent = baked ? '流体：连续空间采样 · 图样：相位图集' : 'N/A（程序化材质）';
}

function syncURL(push = false) {
  const url = new URL(location.href);
  url.searchParams.set('renderer', playback);
  for (const id of ['fluid', 'layout', 'zoom', 'family', 'spacing']) url.searchParams.set(id, ui[id].value);
  for (const [key, id] of [['animate', 'animate'], ['noWait', 'no-wait']]) {
    if (ui[id].checked) url.searchParams.set(key, '1'); else url.searchParams.delete(key);
  }
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}

function loadStatic(mode) {
  if (!staticSets.has(mode)) {
    const pending = mode === 'baked'
      ? import('./baked.js').then(module => module.loadBakedStatic(PIXI))
      : Promise.all([...resources].map(async ([key, item]) => {
          const texture = await PIXI.Assets.load(item.url);
          texture.source.resolution = collection.textureProfile?.resolution ?? 1;
          return [key, texture];
        }))
        .then(entries => ({ textures: new Map(entries) }));
    staticSets.set(mode, pending.catch(error => { staticSets.delete(mode); throw error; }));
  }
  return staticSets.get(mode);
}

async function setPlayback(mode, push = true) {
  if (mode === playback || (mode === 'baked' && !collection.bakedManifest)) return;
  playback = mode;
  if (push) syncURL(true);
  await setAnimation({ preserve: true });
}

async function setAnimation({ preserve = false } = {}) {
  const token = ++generation;
  const mode = playback;
  stop();
  controller?.abort();
  const request = controller = new AbortController();
  clear();
  if (animation) {
    animation.destroy();
    animation = null;
    audit.dynamicTextures = 0;
  }
  if (!preserve) {
    flowCycle = null;
    fluidCycleTime = 0;
    paused = false;
  }
  app.render();
  syncPlaybackUI();
  audit.loading = true;
  document.getElementById('preview-controls').disabled = true;
  document.getElementById('preview-panel').setAttribute('aria-busy', 'true');
  ui.loading.textContent = mode === 'baked' ? '正在加载烘焙素材…' : '正在加载绘制素材…';
  try {
    const loaded = await loadStatic(mode);
    if (token !== generation) return;
    textures.clear();
    for (const [key, texture] of loaded.textures) textures.set(key, texture);
    if (ui.animate.checked) {
      const module = await import(mode === 'baked' ? './baked.js' : './dynamic.js');
      if (token !== generation) return;
      const result = await module.loadDynamic(PIXI, collection, request.signal);
      if (token !== generation) { result.destroy(); return; }
      animation = result;
      audit.dynamicTextures = result.textureCount;
    }
    ui.pause.textContent = paused ? '播放' : '暂停';
    ui.pause.disabled = !animation;
    draw();
    start();
  } catch (error) {
    if (token === generation) {
      if (error.name !== 'AbortError') showError(error);
      ui.animate.checked = false;
      ui.pause.disabled = true;
      if (textures.size) draw();
    }
  } finally {
    if (token === generation) {
      audit.loading = false;
      ui.loading.textContent = '';
      document.getElementById('preview-controls').disabled = false;
      document.getElementById('preview-panel').setAttribute('aria-busy', 'false');
      status();
    }
  }
}

function setupControls() {
  const syncFamily = () => {
    targetKind = ui.family.value;
    const pipe = targetKind === 'pipe';
    for (const id of ['fluid-control', 'fluid-note', 'no-wait-control', 'spacing-control']) {
      document.getElementById(id)?.toggleAttribute('hidden', !pipe);
    }
    document.documentElement.dataset.logisticsKind = targetKind;
    draw();
  };
  ui.family?.addEventListener('change', syncFamily);
  if (ui.family) {
    targetKind = ui.family.value;
    for (const id of ['fluid-control', 'fluid-note', 'no-wait-control', 'spacing-control']) {
      document.getElementById(id)?.toggleAttribute('hidden', targetKind !== 'pipe');
    }
  }
  ui.layout?.addEventListener('change', () => { fluidCycleTime = 0; flowCycle = null; draw(); });
  ui.fluid?.addEventListener('change', () => draw());
  ui['no-wait'].addEventListener('change', () => {
    flowCycle?.setEarlyRefill(ui['no-wait'].checked);
    draw();
  });
  ui.spacing?.addEventListener('change', () => draw());
  const zoom = () => { app.canvas.style.width = `${Number(ui.zoom.value) * 100}%`; };
  ui.zoom.addEventListener('change', zoom);
  zoom();
  ui.animate?.addEventListener('change', () => void setAnimation());
  ui.pause?.addEventListener('click', () => {
    paused = !paused;
    ui.pause.textContent = paused ? '播放' : '暂停';
    if (paused) stop(); else start();
  });
  ui.restart.addEventListener('click', () => {
    waterTime = 0;
    beltTime = 0;
    fluidCycleTime = 0;
    flowCycle = null;
    paused = false;
    ui.pause.textContent = '暂停';
    draw();
    start();
  });
  const tabs = [...document.querySelectorAll('[data-playback]')];
  document.getElementById('tab-baked').hidden = !collection.bakedManifest;
  for (const tab of tabs) {
    tab.addEventListener('click', () => void setPlayback(tab.dataset.playback));
    tab.addEventListener('keydown', event => {
      const available = tabs.filter(item => !item.hidden);
      const index = available.indexOf(tab);
      const next = { ArrowRight: (index + 1) % available.length, ArrowLeft: (index + available.length - 1) % available.length, Home: 0, End: available.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();available[next].focus();available[next].click();
    });
  }
  document.getElementById('preview-controls').addEventListener('change', () => syncURL());
  window.addEventListener('popstate', () => void setPlayback(new URLSearchParams(location.search).get('renderer') === 'baked' ? 'baked' : 'draw', false));
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
  if (!collection.bakedManifest) playback = 'draw';
  app = new PIXI.Application();
  await app.init({ width: 1088, height: 488, backgroundAlpha: 0, antialias: true, preference: 'webgl', autoStart: false, sharedTicker: false });
  app.stop();
  document.getElementById('stage').appendChild(app.canvas);
  audit.pixiVersion = PIXI.VERSION;
  audit.renderer = 'webgl';
  ui.loading.textContent = '';
  // Review links can start directly on an effect; the normal entry stays
  // static and does not load any dynamic assets until explicitly enabled.
  const query = new URLSearchParams(location.search);
  for (const id of ['fluid', 'layout', 'zoom', 'family', 'spacing']) {
    if ([...ui[id].options].some(option => option.value === query.get(id))) ui[id].value = query.get(id);
  }
  ui.animate.checked = query.get('animate') === '1';
  ui['no-wait'].checked = query.get('noWait') === '1';
  setupControls();
  await setAnimation({ preserve: true });
  audit.ready = true;
  document.documentElement.dataset.previewReady = 'true';
  document.documentElement.dataset.logisticsKind = targetKind;
  window.logisticsExample = { draw, setAnimation, setPlayback, app, resources, collection, setFluidCycleTime(value) { fluidCycleTime = Math.max(0, Number(value) || 0); flowCycle?.seek(fluidCycleTime); draw(); }, setWaterTime(value) { waterTime = Math.max(0, Number(value) || 0); draw(); } };
}

init().catch(showError);
