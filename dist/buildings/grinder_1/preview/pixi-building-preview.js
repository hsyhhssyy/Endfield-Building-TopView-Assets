import * as PIXI from './vendor/pixi.min.js';
import {
  activePipePorts,
  assetUrl,
  buildTimeline,
  frameIndexAt,
  grassTileScale,
  pageImage,
  portLabel,
  previewStageMetrics,
  resourcePath,
  ringsForStatus,
  ringStatusKeys,
  selectedVariant,
} from './preview-data.js';

const ROOT_URL = new URL('../', import.meta.url);
const $ = (selector) => document.querySelector(selector);
const BACKGROUND_LABELS = Object.freeze({
  transparent: '棋盘格',
  white: '白色',
  black: '黑色',
  grass: '草地',
});

async function readJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return { url: new URL(response.url), value: await response.json() };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatBytes(bytes) {
  const value = finiteNumber(bytes);
  return value >= 1048576
    ? `${(value / 1048576).toFixed(2)} MiB`
    : `${Math.round(value / 1024)} KiB`;
}

function pathName(value) {
  return String(value ?? '').split('/').at(-1) || String(value ?? '');
}

class PageStore {
  constructor(limit = 10, onLoad = () => {}) {
    this.limit = limit;
    this.onLoad = onLoad;
    this.entries = new Map();
  }

  async load(url) {
    const key = url.href;
    const existing = this.entries.get(key);
    if (existing) {
      existing.usedAt = performance.now();
      return existing.promise;
    }

    const entry = { key, usedAt: performance.now(), texture: null, promise: null };
    entry.promise = (async () => {
      this.onLoad(`正在读取 ${pathName(url.pathname)}…`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
      const source = new PIXI.ImageSource({
        resource: bitmap,
        alphaMode: 'no-premultiply-alpha',
        autoGenerateMipmaps: false,
        resolution: Number(document.querySelector('meta[name="asset-resolution"]')?.content || 1),
      });
      source.style.scaleMode = 'linear';
      entry.texture = new PIXI.Texture({ source });
      entry.bytes = blob.size;
      return entry;
    })().catch((error) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }

  trim(pinned = new Set()) {
    const ready = [...this.entries.values()]
      .filter((entry) => entry.texture && !pinned.has(entry.key))
      .sort((left, right) => left.usedAt - right.usedAt);
    while (this.entries.size > this.limit && ready.length) {
      const entry = ready.shift();
      this.entries.delete(entry.key);
      entry.texture.destroy(true);
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      if (entry.texture) entry.texture.destroy(true);
    }
    this.entries.clear();
  }
}

class PagedSpriteTrack {
  constructor(sprite, pages, fallbackFps = 30) {
    this.sprite = sprite;
    this.pages = pages;
    this.fallbackFps = fallbackFps;
    this.frames = [];
    this.timeline = [];
    this.durationMs = 0;
    this.sheetUrl = null;
    this.sheet = null;
    this.frameIndex = -1;
    this.pendingIndex = -1;
    this.currentPageKey = null;
    this.frameTexture = null;
    this.generation = 0;
    this.elapsedMs = 0;
    this.startedAt = performance.now();
    this.playing = true;
    this.loop = true;
  }

  async setSheet(sheetDoc, { loop = true, reset = true } = {}) {
    this.generation += 1;
    this.sheetUrl = sheetDoc.url;
    this.sheet = sheetDoc.value;
    this.frames = Array.isArray(this.sheet.frames) ? this.sheet.frames : [];
    const timing = buildTimeline(this.frames, this.fallbackFps);
    this.timeline = timing.timeline;
    this.durationMs = timing.durationMs;
    this.loop = loop;
    this.frameIndex = -1;
    this.pendingIndex = -1;
    if (reset) this.restart();
    if (this.frames.length) await this.setFrame(0);
  }

  pageUrl(frame) {
    const page = this.sheet.pages?.[finiteNumber(frame.page)] ?? this.sheet.pages?.[0];
    const image = pageImage(page);
    if (!image) throw new Error(`spritesheet page missing for frame ${frame.index ?? 0}`);
    return assetUrl(image, this.sheetUrl);
  }

  async setFrame(index) {
    if (!this.frames.length || index === this.frameIndex || index === this.pendingIndex) return;
    this.pendingIndex = index;
    const request = ++this.generation;
    try {
      const frame = this.frames[index];
      const pageUrl = this.pageUrl(frame);
      const page = await this.pages.load(pageUrl);
      if (request !== this.generation) return;

      const rectangle = new PIXI.Rectangle(
        finiteNumber(frame.x),
        finiteNumber(frame.y),
        finiteNumber(frame.width ?? this.sheet.cellWidth),
        finiteNumber(frame.height ?? this.sheet.cellHeight),
      );
      const texture = new PIXI.Texture({ source: page.texture.source, frame: rectangle });
      const old = this.frameTexture;
      this.frameTexture = texture;
      this.sprite.texture = texture;
      this.sprite.visible = true;
      this.frameIndex = index;
      this.currentPageKey = page.key;
      if (old) old.destroy(false);
    } finally {
      if (request === this.generation && this.pendingIndex === index) this.pendingIndex = -1;
    }
  }

  showAt(elapsedMs) {
    const index = frameIndexAt(this.timeline, this.durationMs, elapsedMs, this.loop);
    void this.setFrame(index).catch((error) => console.error(error));
  }

  tick(now) {
    if (this.playing) this.elapsedMs = Math.max(0, now - this.startedAt);
    this.showAt(this.elapsedMs);
  }

  restart() {
    this.elapsedMs = 0;
    this.startedAt = performance.now();
    this.frameIndex = -1;
    this.pendingIndex = -1;
  }

  setPlaying(value) {
    if (this.playing === value) return;
    if (value) this.startedAt = performance.now() - this.elapsedMs;
    else this.elapsedMs = performance.now() - this.startedAt;
    this.playing = value;
  }

  dispose() {
    this.generation += 1;
    if (this.frameTexture) this.frameTexture.destroy(false);
    this.frameTexture = null;
    this.currentPageKey = null;
    this.pendingIndex = -1;
    this.sprite.visible = false;
  }
}

async function pixelImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    width: canvas.width,
    height: canvas.height,
    rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
  };
}

function decodeHeight(image, index, heightMin, heightMax) {
  const offset = index * 4;
  if (image.rgba[offset + 3] === 0) return null;
  const packed = image.rgba[offset] * 256 + image.rgba[offset + 1];
  return heightMin + (packed / 65535) * (heightMax - heightMin);
}

export class StaticHeightMasker {
  constructor(packageDoc, spatialDoc, onWarning) {
    this.packageDoc = packageDoc;
    this.spatial = spatialDoc.value;
    this.onWarning = onWarning;
    this.scene = null;
    this.sceneField = null;
    this.occlusion = null;
    this.epsilon = 0.001;
    this.imageCache = new Map();
    this.maskCache = new Map();
  }

  async init() {
    const relative = this.packageDoc.value.occlusionMetadata;
    if (!relative) return;
    try {
      const occlusion = await readJson(assetUrl(relative, this.packageDoc.url));
      this.occlusion = occlusion;
      const fields = occlusion.value.fields ?? [];
      const pose = occlusion.value.staticPose;
      this.sceneField = fields.find((item) => item.name === pose) ?? fields[0] ?? null;
      const image = this.sceneField?.file ?? this.sceneField?.image;
      if (!image) return;
      this.epsilon = finiteNumber(occlusion.value.epsilon?.value, 0.001);
      this.scene = await this.loadPixels(assetUrl(image, occlusion.url));
    } catch (error) {
      this.onWarning(`高度遮挡数据加载失败：${error.message}`);
    }
  }

  async loadPixels(url) {
    if (!this.imageCache.has(url.href)) this.imageCache.set(url.href, pixelImage(url));
    return this.imageCache.get(url.href);
  }

  async maskFor(effectDoc, transform) {
    if (!this.scene || !this.sceneField) return null;
    const height = effectDoc.value.heightTemplate ?? {};
    const heightFile = height.file ?? effectDoc.value.height;
    if (!heightFile) return null;
    const heightUrl = assetUrl(heightFile, effectDoc.url);
    const position = transform.position.map(Number);
    const yaw = finiteNumber(transform.yawDegrees);
    const key = JSON.stringify([heightUrl.href, position, yaw, this.sceneField.name]);
    if (this.maskCache.has(key)) return this.maskCache.get(key);

    const promise = (async () => {
      const effect = await this.loadPixels(heightUrl);
      const mask = new Uint8ClampedArray(effect.width * effect.height * 4);
      const spatialPivot = this.spatial.pivotPixels;
      const pixelsPerCell = finiteNumber(
        this.spatial.pixelsPerCell?.x ?? effectDoc.value.projection?.pixelsPerCell,
        128,
      );
      const effectPivot = effectDoc.value.projection?.pivotPixels
        ?? effectDoc.value.projection?.worldToPixel?.pivotPixels
        ?? [0, 0];
      const theta = yaw * Math.PI / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const effectMin = finiteNumber(height.heightMin ?? effectDoc.value.projection?.heightMin);
      const effectMax = finiteNumber(height.heightMax ?? effectDoc.value.projection?.heightMax, 1);
      const sceneMin = finiteNumber(this.sceneField.heightMin);
      const sceneMax = finiteNumber(this.sceneField.heightMax, 1);

      for (let py = 0; py < effect.height; py += 1) {
        for (let px = 0; px < effect.width; px += 1) {
          const index = py * effect.width + px;
          const effectY = decodeHeight(effect, index, effectMin, effectMax);
          let keep = effectY !== null;
          if (keep) {
            const resolution = effectDoc.value.textureProfile?.resolution ?? 1;
            const sceneResolution = this.packageDoc.value.textureProfile?.resolution ?? 1;
            const localX = ((px + 0.5) / resolution - finiteNumber(effectPivot[0])) / pixelsPerCell;
            const localZ = ((py + 0.5) / resolution - finiteNumber(effectPivot[1])) / pixelsPerCell;
            const worldX = position[0] + cos * localX + sin * localZ;
            const worldZ = position[2] - sin * localX + cos * localZ;
            const sceneX = Math.floor((finiteNumber(spatialPivot.x) + worldX * pixelsPerCell) * sceneResolution);
            const sceneY = Math.floor((finiteNumber(spatialPivot.y) + worldZ * pixelsPerCell) * sceneResolution);
            if (sceneX >= 0 && sceneY >= 0 && sceneX < this.scene.width && sceneY < this.scene.height) {
              const sceneHeight = decodeHeight(
                this.scene,
                sceneY * this.scene.width + sceneX,
                sceneMin,
                sceneMax,
              );
              if (sceneHeight !== null && effectY + position[1] + this.epsilon < sceneHeight) {
                keep = false;
              }
            }
          }
          const offset = index * 4;
          mask[offset] = 255;
          mask[offset + 1] = 255;
          mask[offset + 2] = 255;
          mask[offset + 3] = keep ? 255 : 0;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = effect.width;
      canvas.height = effect.height;
      canvas.getContext('2d').putImageData(new ImageData(mask, effect.width, effect.height), 0, 0);
      const texture = PIXI.Texture.from(canvas);
      texture.source.resolution = effectDoc.value.textureProfile?.resolution ?? 1;
      return texture;
    })();
    this.maskCache.set(key, promise);
    return promise;
  }
}

class EffectInstance {
  constructor(preview, binding, kind = 'port') {
    this.preview = preview;
    this.binding = binding;
    this.kind = kind;
    this.generation = 0;
    this.sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this.sprite.visible = false;
    this.maskSprite = null;
    this.track = new PagedSpriteTrack(this.sprite, preview.pages, 12);
    this.preview.effectLayer.addChild(this.sprite);
  }

  async useResource(resourceId) {
    const generation = ++this.generation;
    const resource = this.preview.resourceById.get(resourceId);
    const relative = resourcePath(resource);
    if (!relative) {
      this.sprite.visible = false;
      throw new Error(`未找到特效资源：${resourceId}`);
    }
    const effectDoc = await this.preview.effectDocument(resourceId, relative);
    if (generation !== this.generation) return;
    const sheetUrl = assetUrl(effectDoc.value.spritesheet, effectDoc.url);
    const sheetDoc = await this.preview.jsonDocument(sheetUrl);
    if (generation !== this.generation) return;

    const transform = this.binding.resolvedTransform;
    const position = transform.position;
    const pivot = effectDoc.value.projection?.pivotPixels
      ?? effectDoc.value.projection?.worldToPixel?.pivotPixels
      ?? [0, 0];
    const buildingPivot = this.preview.spatial.value.pivotPixels;
    const pixelsPerCell = finiteNumber(this.preview.spatial.value.pixelsPerCell?.x, 128);
    this.sprite.position.set(
      finiteNumber(buildingPivot.x) + finiteNumber(position[0]) * pixelsPerCell,
      finiteNumber(buildingPivot.y) + finiteNumber(position[2]) * pixelsPerCell,
    );
    this.sprite.pivot.set(finiteNumber(pivot[0]), finiteNumber(pivot[1]));
    this.sprite.rotation = -finiteNumber(transform.yawDegrees) * Math.PI / 180;

    await this.track.setSheet(sheetDoc, { loop: effectDoc.value.playback?.mode !== 'once' });
    if (generation !== this.generation) return;
    await this.applyMask(effectDoc, transform, pivot);
  }

  async applyMask(effectDoc, transform, pivot) {
    if (this.maskSprite) {
      this.sprite.mask = null;
      this.maskSprite.removeFromParent();
      this.maskSprite.destroy(false);
      this.maskSprite = null;
    }
    const texture = await this.preview.masker.maskFor(effectDoc, transform);
    if (!texture) return;
    const mask = new PIXI.Sprite(texture);
    mask.position.copyFrom(this.sprite.position);
    mask.pivot.set(finiteNumber(pivot[0]), finiteNumber(pivot[1]));
    mask.rotation = this.sprite.rotation;
    this.preview.effectLayer.addChild(mask);
    this.sprite.mask = mask;
    this.maskSprite = mask;
  }

  async setPortState(state) {
    this.state = state;
    const resourceId = this.binding.resourceBinding?.[state]?.resourceId;
    if (!resourceId) {
      this.sprite.visible = false;
      return;
    }
    await this.useResource(resourceId);
  }

  tick(effectElapsedMs) {
    this.track.showAt(effectElapsedMs);
  }

  dispose() {
    this.generation += 1;
    this.track.dispose();
    this.sprite.mask = null;
    this.sprite.destroy(false);
    if (this.maskSprite) this.maskSprite.destroy(false);
  }
}

class BuildingPreview {
  constructor(rootUrl = ROOT_URL) {
    this.rootUrl = rootUrl;
    this.pages = new PageStore(10, (message) => this.status(message));
    this.documents = new Map();
    this.effects = [];
    this.effectStartedAt = performance.now();
    this.playing = true;
    this.ringsVisible = true;
    this.warning = '';
    this.fpsWindowStartedAt = performance.now();
    this.fpsWindowFrames = 0;
  }

  status(message, error = false) {
    const node = $('#stage-status');
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  warn(message) {
    this.warning = message;
    this.status(message, true);
  }

  async jsonDocument(url) {
    if (!this.documents.has(url.href)) this.documents.set(url.href, readJson(url));
    return this.documents.get(url.href);
  }

  async effectDocument(resourceId, relative) {
    if (this.effectDocs.has(resourceId)) return this.effectDocs.get(resourceId);
    const document = await this.jsonDocument(assetUrl(relative, this.registry.url));
    this.effectDocs.set(resourceId, document);
    return document;
  }

  async init() {
    this.package = await readJson(assetUrl('package.json', this.rootUrl));
    this.sequence = await readJson(assetUrl(
      this.package.value.sequence ?? 'sequence.json',
      this.package.url,
    ));
    this.spatial = await readJson(assetUrl(
      this.package.value.spatialMetadata ?? 'spatial.json',
      this.package.url,
    ));
    try {
      this.sheetSizes = await readJson(assetUrl('sheet-sizes.json', this.package.url));
    } catch {
      this.sheetSizes = null;
    }
    await this.initPixi();
    await this.configureBackground();

    this.masker = new StaticHeightMasker(this.package, this.spatial, (message) => this.warn(message));
    await this.masker.init();
    await this.initResources();
    this.populateMetadata();
    this.bindAnimationControls();
    await this.selectClip(this.defaultClip());
    await this.selectPortsVariant();

    this.app.ticker.add(() => this.tick(performance.now()));
    $('#loading')?.remove();
    document.documentElement.dataset.previewReady = 'true';
    document.documentElement.dataset.pixiVersion = PIXI.VERSION;
    this.status(`PixiJS ${PIXI.VERSION} · WebP 分页图集播放中`);
  }

  async initPixi() {
    const metrics = previewStageMetrics(this.spatial.value);
    this.previewMetrics = metrics;
    this.app = new PIXI.Application();
    await this.app.init({
      width: metrics.width,
      height: metrics.height,
      backgroundAlpha: 0,
      antialias: true,
      preference: 'webgl',
      autoStart: true,
      sharedTicker: false,
      resolution: 1,
    });
    const stage = $('#pixi-stage');
    stage.dataset.background = 'transparent';
    stage.appendChild(this.app.canvas);
    this.backgroundLayer = new PIXI.Container();
    this.app.stage.addChild(this.backgroundLayer);
    this.buildingSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this.buildingSprite.visible = false;
    this.buildingSprite.position.set(metrics.offsetX, metrics.offsetY);
    this.buildingTrack = new PagedSpriteTrack(
      this.buildingSprite,
      this.pages,
      finiteNumber(this.sequence.value.fps, 30),
    );
    this.app.stage.addChild(this.buildingSprite);
    this.effectLayer = new PIXI.Container();
    this.effectLayer.position.set(metrics.offsetX, metrics.offsetY);
    this.app.stage.addChild(this.effectLayer);
    document.documentElement.dataset.previewPaddingCells = String(metrics.paddingCells);
    document.documentElement.dataset.previewWidth = String(metrics.width);
    document.documentElement.dataset.previewHeight = String(metrics.height);
  }

  async configureBackground() {
    const select = $('#background-select');
    let selected = 'transparent';
    try {
      const stored = localStorage.getItem('endfield-building-preview-background');
      if (Object.hasOwn(BACKGROUND_LABELS, stored)) selected = stored;
    } catch {
      // Storage can be disabled in hardened or private browser contexts.
    }
    select.value = selected;
    select.onchange = () => void this.setBackground(select.value);
    await this.setBackground(selected);
  }

  async setBackground(requestedMode) {
    const mode = Object.hasOwn(BACKGROUND_LABELS, requestedMode) ? requestedMode : 'transparent';
    const select = $('#background-select');
    select.value = mode;
    select.disabled = true;
    try {
      if (mode === 'grass' && !this.grassSprite) {
        const config = await readJson(assetUrl('preview/grass-background.json', ROOT_URL));
        const textureUrl = assetUrl(config.value.file ?? 'grass-base.webp', config.url);
        const page = await this.pages.load(textureUrl);
        const metrics = this.previewMetrics;
        const scale = grassTileScale(this.spatial.value, config.value.pixelsPerWorldUnit);
        this.grassTextureKey = page.key;
        this.grassSprite = new PIXI.TilingSprite({
          texture: page.texture,
          width: metrics.width,
          height: metrics.height,
        });
        this.grassSprite.tileScale.set(scale.x, scale.y);
        this.backgroundLayer.addChild(this.grassSprite);
      }
      if (this.grassSprite) this.grassSprite.visible = mode === 'grass';
      $('#pixi-stage').dataset.background = mode;
      document.documentElement.dataset.previewBackground = mode;
      const metrics = this.previewMetrics;
      $('#background-info').textContent = mode === 'grass'
        ? `草地以 ${this.spatial.value.pixelsPerCell?.x ?? 128} px/格连续铺设；预览尺寸 ${metrics.width}×${metrics.height} px。`
        : `透明区域以${mode === 'transparent' ? '浅灰棋盘格' : BACKGROUND_LABELS[mode]}显示；设备四周各外扩 ${metrics.paddingCells} 格。`;
      this.status(`${BACKGROUND_LABELS[mode]}背景已就绪。`);
      try {
        localStorage.setItem('endfield-building-preview-background', mode);
      } catch {
        // The preview remains functional without persisted preferences.
      }
    } catch (error) {
      await this.setBackground('transparent');
      this.warn(`草地背景加载失败，已恢复棋盘格背景：${error.message}`);
    } finally {
      select.disabled = false;
    }
  }

  async initResources() {
    this.ports = null;
    this.registry = null;
    this.resourceById = new Map();
    this.effectDocs = new Map();
    if (!this.package.value.portMetadata || !this.package.value.effectResources) return;
    this.ports = await readJson(assetUrl(this.package.value.portMetadata, this.package.url));
    this.registry = await readJson(assetUrl(this.package.value.effectResources, this.package.url));
    for (const item of this.registry.value.resources ?? []) {
      this.resourceById.set(item.id ?? item.resourceId, item);
    }
  }

  defaultClip() {
    const order = this.sequence.value.order ?? this.package.value.animations ?? [];
    return order.includes('open_idle') ? 'open_idle' : order[0];
  }

  async animationDocuments(clip) {
    const phase = (this.sequence.value.phases ?? []).find((item) => item.clip === clip);
    const animationUrl = assetUrl(
      phase?.animation ?? `animations/${clip}/animation.json`,
      this.sequence.url,
    );
    const animation = await this.jsonDocument(animationUrl);
    const sheetUrl = assetUrl(
      animation.value.spritesheetMetadata ?? phase?.spritesheet ?? 'spritesheet.json',
      animation.url,
    );
    return { animation, sheet: await this.jsonDocument(sheetUrl) };
  }

  bindAnimationControls() {
    const clips = this.sequence.value.order ?? this.package.value.animations ?? [];
    const select = $('#clip-select');
    select.replaceChildren();
    for (const clip of clips) select.add(new Option(clip, clip));
    select.onchange = () => void this.selectClip(select.value);
    $('#play-toggle').onclick = () => {
      this.playing = !this.playing;
      this.buildingTrack.setPlaying(this.playing);
      $('#play-toggle').textContent = this.playing ? '暂停' : '继续';
      $('#play-toggle').setAttribute('aria-pressed', String(this.playing));
    };
    $('#restart').onclick = () => this.buildingTrack.restart();
  }

  async selectClip(clip) {
    if (!clip) throw new Error('交付中没有可播放的动画片段。');
    $('#clip-select').value = clip;
    this.status(`正在加载建筑动画 ${clip}…`);
    const { animation, sheet } = await this.animationDocuments(clip);
    const mode = animation.value.playback?.mode ?? 'loop';
    await this.buildingTrack.setSheet(sheet, { loop: mode === 'loop', reset: true });
    this.buildingTrack.setPlaying(this.playing);
    const sourceFps = finiteNumber(animation.value.fps, finiteNumber(this.sequence.value.fps));
    $('#source-fps').textContent = sourceFps > 0 ? `${sourceFps.toFixed(2).replace(/\.00$/, '')} FPS` : '未标注';
    document.documentElement.dataset.sourceFps = sourceFps > 0 ? String(sourceFps) : '';
    $('#animation-info').textContent = `${sheet.value.frames?.length ?? 0} 帧 · ${mode} · ${formatBytes(
      (sheet.value.pages ?? []).reduce((sum, page) => sum + finiteNumber(page.bytes), 0),
    )}`;
    this.status(`${clip} 已就绪；图集页会按播放进度加载。`);
  }

  variantKeys() {
    const explicit = this.ports?.value.deliveryVariantKeys ?? [];
    return explicit.length
      ? explicit
      : (this.ports?.value.variants ?? []).map((item) => item.rendererTemplateKey);
  }

  async selectPortsVariant(requestedKey = null) {
    this.clearEffects();
    if (!this.ports || !this.registry) return this.hideEffectsPanel();
    const variant = selectedVariant(this.ports.value, requestedKey);
    const ports = activePipePorts(variant);
    if (!ports.length) return this.hideEffectsPanel();
    const statuses = ringStatusKeys(this.ports.value);

    $('#effects-panel').hidden = false;
    const keys = this.variantKeys();
    const variantControl = $('#variant-control');
    if (keys.length > 1) {
      variantControl.hidden = false;
      const select = $('#variant-select');
      select.replaceChildren(...keys.map((key) => new Option(key, key)));
      select.value = variant.rendererTemplateKey;
      select.onchange = () => void this.selectPortsVariant(select.value);
    } else {
      variantControl.hidden = true;
    }

    this.portInstances = [];
    const list = $('#port-list');
    list.replaceChildren();
    for (const port of ports) {
      const bindings = port.resourceBinding ?? {};
      const states = ['off', 'on'];
      const instance = new EffectInstance(this, port, 'port');
      this.effects.push(instance);
      this.portInstances.push(instance);
      const select = document.createElement('select');
      for (const state of states) {
        const suffix = bindings[state]?.resourceId ? '' : '（无特效资源）';
        select.add(new Option(`${state.toUpperCase()}${suffix}`, state));
      }
      select.value = 'off';
      select.setAttribute('aria-label', `${portLabel(port)} 状态`);
      select.addEventListener('change', () => void instance.setPortState(select.value));
      instance.control = select;

      const row = document.createElement('div');
      row.className = 'port-row';
      const label = document.createElement('label');
      label.textContent = portLabel(port);
      const detail = document.createElement('small');
      const unavailable = states.filter((state) => !bindings[state]?.resourceId);
      detail.textContent = `位置 ${port.resolvedTransform.position.map((value) => finiteNumber(value).toFixed(2)).join(', ')}${
        unavailable.length ? ` · ${unavailable.map((state) => state.toUpperCase()).join('/')} 无特效资源` : ''
      }`;
      label.appendChild(detail);
      row.append(label, select);
      list.appendChild(row);
      await instance.setPortState(select.value);
    }

    $('#all-port-actions').hidden = this.portInstances.length === 0;
    $('#all-off').onclick = () => this.setAllPorts('off');
    $('#all-on').onclick = () => this.setAllPorts('on');
    await this.configureRings(statuses);
    document.documentElement.dataset.portCount = String(this.portInstances.length);
    document.documentElement.dataset.ringCount = String(this.ringInstances.length);
  }

  hideEffectsPanel() {
    $('#effects-panel').hidden = true;
    document.documentElement.dataset.portCount = '0';
    document.documentElement.dataset.ringCount = '0';
  }

  setAllPorts(state) {
    for (const instance of this.portInstances ?? []) {
      if ([...instance.control.options].some((option) => option.value === state)) {
        instance.control.value = state;
        void instance.setPortState(state);
      }
    }
  }

  async configureRings(statuses) {
    const control = $('#ring-control');
    if (!statuses.length) {
      control.hidden = true;
      return;
    }
    control.hidden = false;
    const select = $('#ring-status');
    select.replaceChildren(...statuses.map((key) => new Option(key, key)));
    const row = $('#ring-status-row');
    row.hidden = statuses.length < 2;
    select.onchange = () => void this.rebuildRings(select.value);
    const checkbox = $('#ring-visible');
    checkbox.checked = this.ringsVisible;
    checkbox.onchange = () => {
      this.ringsVisible = checkbox.checked;
      for (const instance of this.ringInstances ?? []) instance.sprite.visible = this.ringsVisible;
    };
    await this.rebuildRings(statuses[0]);
  }

  async rebuildRings(statusKey) {
    for (const instance of this.ringInstances ?? []) {
      this.effects = this.effects.filter((item) => item !== instance);
      instance.dispose();
    }
    this.ringInstances = [];
    for (const ring of ringsForStatus(this.ports.value, statusKey)) {
      const instance = new EffectInstance(this, ring, 'ring');
      this.effects.push(instance);
      this.ringInstances.push(instance);
      await instance.useResource(ring.resourceId);
      instance.sprite.visible = this.ringsVisible;
    }
  }

  clearEffects() {
    for (const instance of this.effects) instance.dispose();
    this.effects = [];
    this.portInstances = [];
    this.ringInstances = [];
  }

  populateMetadata() {
    const packageData = this.package.value;
    $('#identity').textContent = `${packageData.displayName ?? packageData.building} · ${packageData.building} · ${packageData.view}`;
    const canvas = this.spatial.value.canvasCells;
    const sizeEntries = this.sheetSizes?.value.pages ?? this.sheetSizes?.value.parts ?? [];
    const sheetBytes = sizeEntries.reduce((sum, page) => sum + finiteNumber(page.bytes), 0);
    $('#sheet-summary').textContent = `${canvas.width}×${canvas.height} 格 · ${this.spatial.value.pixelsPerCell.x} px/格 · ${packageData.webpPageCount ?? sizeEntries.length ?? '?'} 个建筑图集页${sheetBytes ? ` · ${formatBytes(sheetBytes)}` : ''}`;
    const links = [
      ['package.json', 'package.json'],
      ['sequence.json', this.package.value.sequence ?? 'sequence.json'],
      ['spatial.json', this.package.value.spatialMetadata ?? 'spatial.json'],
      ['sheet-sizes.json', 'sheet-sizes.json'],
    ];
    if (packageData.portMetadata) links.push(['ports.json', packageData.portMetadata]);
    if (packageData.effectResources) links.push(['effects', packageData.effectResources]);
    if (packageData.occlusionMetadata) links.push(['高度元数据 JSON', packageData.occlusionMetadata]);
    const occlusion = this.masker.occlusion;
    for (const field of occlusion?.value.fields ?? []) {
      const file = field.file ?? field.image;
      if (file) links.push([`高度图 ${field.name ?? file}`, assetUrl(file, occlusion.url).href]);
    }
    $('#metadata-links').replaceChildren(...links.flatMap(([label, relative], index) => {
      const link = document.createElement('a');
      link.href = assetUrl(relative, this.package.url);
      link.textContent = label;
      return index ? [document.createTextNode(' · '), link] : [link];
    }));
  }

  tick(now) {
    this.fpsWindowFrames += 1;
    const fpsElapsed = now - this.fpsWindowStartedAt;
    if (fpsElapsed >= 500) {
      const renderFps = this.fpsWindowFrames * 1000 / fpsElapsed;
      $('#render-fps').textContent = `${renderFps.toFixed(1)} FPS`;
      document.documentElement.dataset.renderFps = renderFps.toFixed(1);
      this.fpsWindowStartedAt = now;
      this.fpsWindowFrames = 0;
    }
    this.buildingTrack.tick(now);
    const effectElapsed = now - this.effectStartedAt;
    for (const instance of this.effects) instance.tick(effectElapsed);
    const pinned = new Set([
      this.buildingTrack.currentPageKey,
      this.grassTextureKey,
      ...this.effects.map((item) => item.track.currentPageKey),
    ].filter(Boolean));
    this.pages.trim(pinned);
  }

  dispose() {
    this.lightMeshExperiment?.dispose();
    this.clearEffects();
    this.buildingTrack?.dispose();
    if (this.app) this.app.destroy(true, { children: true, texture: false, textureSource: false });
    this.pages.dispose();
    this.documents.clear();
  }
}

export async function mountBuildingPreview(rootUrl = ROOT_URL) {
  const preview = new BuildingPreview(rootUrl);
  await preview.init();
  return preview;
}

function resetPreviewDom() {
  const loading = document.createElement('p');
  loading.id = 'loading';
  loading.textContent = '正在读取当前模式的图集元数据…';
  $('#pixi-stage').replaceChildren(loading);
  $('#clip-select').replaceChildren();
  $('#port-list').replaceChildren();
  $('#effects-panel').hidden = true;
  $('#identity').textContent = '';
  $('#sheet-summary').textContent = '';
  $('#metadata-links').replaceChildren();
  $('#source-fps').textContent = '-- FPS';
  $('#render-fps').textContent = '-- FPS';
  document.documentElement.dataset.previewReady = 'false';
}

function manifestVariant(manifest, requested) {
  const variants = Array.isArray(manifest?.variants) ? manifest.variants : [];
  return variants.find((item) => item.key === requested || item.view === requested)
    ?? variants.find((item) => item.key === manifest.defaultVariant)
    ?? variants[0]
    ?? null;
}

function setPageIdentity(manifest, variant, rootUrl = ROOT_URL) {
  const displayName = manifest.displayName ?? manifest.building;
  const label = variant.label ?? variant.view;
  const title = `${displayName} · 建筑预览`;
  document.title = title;
  $('#page-title').textContent = title;
  $('#page-task-id').textContent = manifest.taskId ?? 'legacy-unknown';
  for (const [name, value] of [
    ['building-display-name', displayName],
    ['building-variant', label],
    ['building-task-id', manifest.taskId ?? 'legacy-unknown'],
    ['building-id', manifest.building],
    ['building-view', variant.view],
  ]) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    if (meta) meta.content = value;
  }
  const archive = $('#delivery-archive');
  if (variant.archive) {
    archive.hidden = false;
    archive.href = assetUrl(variant.archive, rootUrl);
    archive.download = pathName(variant.archive);
    archive.textContent = `下载当前模式 spritesheet 素材包 ZIP${
      variant.archiveBytes ? ` · ${formatBytes(variant.archiveBytes)}` : ''
    }`;
  } else {
    archive.hidden = true;
    archive.removeAttribute('href');
  }
}

export async function mountBuildingPreviewPage(rootUrl = ROOT_URL) {
  const manifestDoc = await readJson(assetUrl('variants.json', rootUrl));
  const manifest = manifestDoc.value;
  const select = $('#delivery-variant-select');
  const variants = Array.isArray(manifest.variants) ? manifest.variants : [];
  if (!variants.length) throw new Error('variants.json 没有正式运行模式');
  select.replaceChildren(...variants.map((item) => new Option(item.label ?? item.view, item.key)));
  $('#delivery-variant-navigation').hidden = variants.length < 2;

  let activePreview = null;
  let generation = 0;
  const activate = async (requested) => {
    const variant = manifestVariant(manifest, requested);
    if (!variant?.root) throw new Error(`找不到运行模式：${requested}`);
    const request = ++generation;
    select.disabled = true;
    select.value = variant.key;
    if (activePreview) {
      activePreview.dispose();
      activePreview = null;
    }
    resetPreviewDom();
    setPageIdentity(manifest, variant, rootUrl);
    const preview = new BuildingPreview(assetUrl(variant.root, rootUrl));
    try {
      await preview.init();
      const lightMesh = manifest.experiments?.lightMesh;
      if (lightMesh?.manifest && (!lightMesh.variant || lightMesh.variant === variant.key)) {
        const { mountLightMeshExperiment } = await import('./factory-light-mesh-preview.js');
        preview.lightMeshExperiment = await mountLightMeshExperiment(preview, assetUrl(lightMesh.manifest, rootUrl));
      }
      if (request !== generation) {
        preview.dispose();
        return;
      }
      activePreview = preview;
      const location = new URL(window.location.href);
      location.searchParams.set('variant', variant.key);
      history.replaceState(null, '', location);
    } catch (error) {
      preview.dispose();
      throw error;
    } finally {
      if (request === generation) select.disabled = false;
    }
  };
  select.onchange = () => void activate(select.value).catch(showPreviewError);
  const requested = new URL(window.location.href).searchParams.get('variant');
  await activate(requested);
  return { manifest, get activePreview() { return activePreview; }, activate };
}

function showPreviewError(error) {
  const status = $('#stage-status');
  if (status) {
    status.textContent = `预览加载失败：${error.message}`;
    status.classList.add('error');
  }
  const loading = $('#loading');
  if (loading) loading.textContent = '无法启动 PixiJS 预览。';
  console.error(error);
}

if (typeof document !== 'undefined' && document.querySelector('#stage-status')) {
  mountBuildingPreviewPage().catch(showPreviewError);
}
