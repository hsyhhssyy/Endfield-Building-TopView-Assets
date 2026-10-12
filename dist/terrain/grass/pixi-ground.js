/* PixiJS v8 reference implementation. Prebaked WebP only; no 3D or custom shader. */
(function (global) {
  'use strict';

  function hash32(seed, x, y, salt) {
    let n = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
      ^ Math.imul(salt, 1274126177)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return (n ^ (n >>> 16)) >>> 0;
  }

  function generateLayout(seed, bounds, specs = null) {
    const [x0, y0, x1, y1] = bounds;
    const result = [];
    specs = specs ?? [
      { kind: 'grass-patch', cell: 9, count: 4, salt: 73, scale: [0.65, 1.25], worldSize: 16, layer: 'patches' },
      { kind: 'gravel', cell: 3.2, count: 8, salt: 271, scale: [0.22, 0.58], worldSize: 8, layer: 'gravel' },
    ];
    for (const {kind, cell, count, salt, scale: [scale0, scale1], worldSize, layer} of specs) {
      for (let cy = Math.floor(y0 / cell) - 1; cy < Math.ceil(y1 / cell) + 1; cy++) {
        for (let cx = Math.floor(x0 / cell) - 1; cx < Math.ceil(x1 / cell) + 1; cx++) {
          const h = s => hash32(seed, cx, cy, salt + s) / 4294967296;
          if (kind === 'gravel' && h(7) < 0.12) continue;
          const x = (cx + h(1)) * cell;
          const y = (cy + h(2)) * cell;
          const scale = scale0 + (scale1 - scale0) * h(3);
          const span = worldSize * scale;
          if (x + span / 2 < x0 || x - span / 2 > x1
            || y + span / 2 < y0 || y - span / 2 > y1) continue;
          result.push({
            id: `${kind}:${cx}:${cy}`,
            asset: `${kind}-${String(1 + Math.floor(h(4) * count)).padStart(2, '0')}`,
            layer,
            x, y, scale, rotationDegrees: Math.floor(h(5) * 4) * 90,
          });
        }
      }
    }
    return result;
  }

  async function createGround(PIXI, {
    baseUrl = '.', seed = 47031, bounds = null, pixelsPerUnit = null,
  } = {}) {
    const response = await fetch(`${baseUrl}/manifest.json`);
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const manifest = await response.json();
    bounds = bounds ?? manifest.previewBounds ?? [0, 0, 64, 48];
    pixelsPerUnit = pixelsPerUnit ?? manifest.pixelsPerWorldUnit;
    if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0
      || bounds.length !== 4 || !bounds.every(Number.isFinite)
      || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
      throw new Error('Invalid ground dimensions');
    }
    const textures = {};
    await Promise.all(manifest.assets.map(async asset => {
      textures[asset.id] = await PIXI.Assets.load({
        src: `${baseUrl}/${asset.file}`,
        data: { autoGenerateMipmaps: true, scaleMode: 'linear', mipmapFilter: 'linear' },
      });
    }));
    const [x0, y0, x1, y1] = bounds;
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const layers = {
      base: new PIXI.Container(), patches: new PIXI.Container(),
      gravel: new PIXI.Container(), buildings: new PIXI.Container(),
    };
    root.addChild(layers.base, layers.patches, layers.gravel, layers.buildings);
    const width = (x1 - x0) * pixelsPerUnit;
    const height = (y1 - y0) * pixelsPerUnit;
    const base = new PIXI.TilingSprite({ texture: textures[manifest.baseAsset ?? 'grass-base'], width, height });
    base.tileScale.set(pixelsPerUnit / manifest.pixelsPerWorldUnit);
    // Keep source phase in WORLD coordinates, including nonzero/negative origins.
    base.tilePosition.set(-x0 * pixelsPerUnit, -y0 * pixelsPerUnit);
    layers.base.addChild(base);
    const placements = generateLayout(seed, bounds, manifest.layoutSpecs);
    for (const item of placements) {
      const sprite = new PIXI.Sprite(textures[item.asset]);
      sprite.label = item.id;
      sprite.anchor.set(0.5);
      sprite.position.set((item.x - x0) * pixelsPerUnit, (item.y - y0) * pixelsPerUnit);
      sprite.scale.set(item.scale * pixelsPerUnit / manifest.pixelsPerWorldUnit);
      sprite.rotation = item.rotationDegrees * Math.PI / 180;
      layers[item.layer].addChild(sprite);
    }
    // ONE map-extent clip; never one mask per generation cell or base tile.
    const clip = new PIXI.Graphics().rect(0, 0, width, height).fill(0xffffff);
    root.addChild(clip);
    root.mask = clip;
    return { root, layers, placements, manifest, width, height, seed, bounds, pixelsPerUnit };
  }

  global.PixiGround = { hash32, generateLayout, createGround };
})(globalThis);
