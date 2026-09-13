// Ordinary Sprite playback. All visual material work is already in the atlas.
import {createFluidCycle} from './fluid-cycle.js';

let manifestPromise;
const getManifest = () => manifestPromise ??= fetch('./logistics-baked.json').then(response => {
  if (!response.ok) throw Error('Cannot load spritesheet manifest');
  return response.json();
});
const fract = value => ((value % 1) + 1) % 1;
const phaseFrame = (value, count) => Math.round(fract(value) * count) % count;

async function loadPages(PIXI, manifest, include, signal) {
  const sources = new Map(), textures = new Map(), bitmaps = [];
  const destroy = () => {
    for (const texture of textures.values()) texture.destroy(false);
    textures.clear();
    for (const source of sources.values()) source.destroy();
    sources.clear();
    for (const bitmap of bitmaps) bitmap.close();
    bitmaps.length = 0;
  };
  try {
    for (const [id, page] of Object.entries(manifest.pages)) {
      if (!include(page)) continue;
      const response = await fetch(new URL(page.file, location.href), {signal});
      if (!response.ok) throw Error(response.status + ' ' + page.file);
      // WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmap inputs.
      // Premultiply while decoding and mark the source accordingly.
      const raw = page.premultiply === false;
      const bitmap = await createImageBitmap(await response.blob(), {premultiplyAlpha: raw ? 'none' : 'premultiply', colorSpaceConversion: 'none'});
      bitmaps.push(bitmap);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      sources.set(id, new PIXI.ImageSource({resource: bitmap, alphaMode: raw ? 'no-premultiply-alpha' : 'premultiplied-alpha',
        autoGenerateMipmaps: false, scaleMode: 'linear', addressMode: 'clamp-to-edge'}));
    }
    for (const [key, frame] of Object.entries(manifest.frames)) {
      if (!sources.has(frame.page)) continue;
      textures.set(key, new PIXI.Texture({source: sources.get(frame.page),
        frame: new PIXI.Rectangle(...frame.rect), orig: new PIXI.Rectangle(0, 0, ...frame.sourceSize),
        trim: new PIXI.Rectangle(...frame.spriteSourceSize)}));
    }
    return {textures, sources, textureCount: sources.size, destroy};
  } catch (error) {destroy(); throw error;}
}

export async function loadBakedStatic(PIXI) {
  const manifest = await getManifest();
  return {...await loadPages(PIXI, manifest, page => page.group === 'static'), manifest};
}

export async function loadDynamic(PIXI, collection, signal) {
  const manifest = await getManifest();
  const flowModule = manifest.fluidPlayback ? await import('./baked-flow.js') : null;
  const loaded = await loadPages(PIXI, manifest, page => page.group !== 'static', signal);
  const {textures} = loaded;
  const levels = manifest.body?.thicknessLevels;
  const routes = new Set();
  const frameTexture = (clip, frame) => {
    const sequence = manifest.clips[clip];
    if (!sequence) throw Error('Missing baked clip ' + clip);
    return textures.get(sequence.frames[Math.min(sequence.frames.length - 1, Math.max(0, frame))]);
  };
  const sprite = container => {
    const node = new PIXI.Sprite();
    node.anchor.set(.5);node.scale.set(.5);
    container.addChild(node);
    return node;
  };
  function assign(node, clip, frame) {
    const texture = frameTexture(clip, frame);
    if (node.texture !== texture) node.texture = texture;
  }
  let surfaceTime = 0, previousWaterTime = null;
  return {
    ...loaded, cycle: manifest.cycle, baked: true, flowField: Boolean(flowModule),
    clearScene() { routes.clear(); },
    route(segments, parent, profile) {
      const mesh = flowModule.createFlowRoute(PIXI, manifest, loaded.sources, segments, parent, profile);
      mesh.flowSegmentStarts = segments.map(segment => segment.start + 5);
      mesh.flowAllIndices = mesh.geometry.indexBuffer.data;
      routes.add(mesh);return mesh;
    },
    createFluidCycle: (total, origin, early) => createFluidCycle(manifest.cycle, total, origin, early),
    beginFrame(state, waterTime) {
      if (flowModule) {
        for (const mesh of routes) {
          const u = mesh.shader.resources.flow.uniforms;
          u.uTime = waterTime;u.uThickness = state.thickness;
          u.uBounds.set([state.start, state.end, manifest.cycle.edgeWidth,
            state.hasHead ? Math.min(1, state.progress * state.total * 2, (1-state.progress) * state.total * 2) : 0]);
          const count = state.thickness > 0 ? mesh.flowSegmentStarts.filter(start => !state.hasHead || start < state.end).length : 0;
          mesh.visible = count > 0;
          if (count !== mesh.flowVisibleSegments) {
            mesh.geometry.indexBuffer.data = mesh.flowAllIndices.slice(0, count * 6);
            mesh.geometry.indexBuffer.update();mesh.flowVisibleSegments = count;
          }
        }
        return;
      }
      if (state.hasHead) surfaceTime = state.phaseTime;
      else if (previousWaterTime === null || waterTime < previousWaterTime) surfaceTime = waterTime;
      else surfaceTime += waterTime - previousWaterTime;
      previousWaterTime = waterTime;
    },
    mesh(kind, segment, container, time, filled, layer = 'marks', options = {}) {
      const holder = new PIXI.Container();container.addChild(holder);
      holder.logisticsLayer = layer;
      holder.bakedData = {kind, segment, layer, fluid: options.profile?.itemId || options.profile?.id,
        profile: options.profile, a: sprite(holder)};
      // The profiles use dictionary keys as item IDs; allow callers to pass it.
      holder.bakedData.fluid = options.fluidId || Object.entries(manifest.fluidProfiles).find(([, profile]) => profile.name === options.profile?.name)?.[0];
      if (kind === 'conveyor' || layer === 'marks') holder.bakedData.b = sprite(holder);
      return holder;
    },
    update(node, state, time) {
      if (node.flowRoute) return;
      const {kind, segment, layer, fluid, a, b} = node.bakedData;
      const p = manifest.parametersByResourceId[collection.entries[kind + '.' + segment.shape].id];
      const start = segment.start + 5;
      if (kind === 'conveyor') {
        const prefix = `conveyor/${segment.shape}/`;
        assign(a, prefix + 'highlight', phaseFrame((start - time * p.flowSpeed + p.timeOffset) * p.flowSpace, manifest.clips[prefix + 'highlight'].phaseSamples));
        assign(b, prefix + 'arrow', phaseFrame(start - time * p.arrowSpeed, manifest.clips[prefix + 'arrow'].phaseSamples));
      } else if (layer === 'marks') {
        const q = start * (2 * p.waterDirection - 1) - p.flowOffset;
        a.visible = segment.shape === 'straight';
        if (a.visible) assign(a, 'pipe/straight/pattern', phaseFrame(q * p.staticDensity, 128));
        assign(b, `pipe/${segment.shape}/chevron`, phaseFrame((q + p.flowSpeed * time) * p.flowDensity, 128));
      } else {
        const localHead = state.end - start;
        node.visible = state.thickness > 0 && (!state.hasHead || localHead > 0);
        if (!node.visible) return;
        a.alpha = 1;
        const prefix = `fluid/${fluid}/${segment.shape}/`;
        if (state.hasHead && localHead < manifest.head.cells) {
          assign(a, prefix + 'head', Math.round(localHead * manifest.head.framesPerCell));
        } else {
          let level = 1;
          for (let i = 2; i < levels.length; i++) if (Math.abs(levels[i] - state.thickness) < Math.abs(levels[level] - state.thickness)) level = i;
          a.alpha = Math.min(1, state.thickness / levels[1]);
          assign(a, prefix + 'body/' + level, phaseFrame(surfaceTime - segment.start * manifest.body.cellPhaseDelaySeconds, manifest.body.phaseFrames));
        }
      }
    },
  };
}
