export function assetUrl(value, baseUrl) {
  if (!value) return null;
  return new URL(String(value).replaceAll('\\', '/'), baseUrl);
}

export function pageImage(page) {
  return page?.image ?? page?.file ?? null;
}

export function frameDuration(frame, fallbackFps = 30) {
  const value = Number(frame?.durationMs);
  return Number.isFinite(value) && value > 0 ? value : 1000 / fallbackFps;
}

export function buildTimeline(frames, fallbackFps = 30) {
  let elapsed = 0;
  const timeline = frames.map((frame, index) => {
    const startMs = elapsed;
    elapsed += frameDuration(frame, fallbackFps);
    return { index, startMs, endMs: elapsed };
  });
  return { timeline, durationMs: elapsed };
}

export function frameIndexAt(timeline, durationMs, elapsedMs, loop = true) {
  if (!timeline.length || durationMs <= 0) return 0;
  let time = Math.max(0, Number(elapsedMs) || 0);
  if (loop) time %= durationMs;
  else time = Math.min(time, Math.max(0, durationMs - 0.0001));

  let low = 0;
  let high = timeline.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (time < timeline[middle].endMs) high = middle;
    else low = middle + 1;
  }
  return timeline[low].index;
}

export const PREVIEW_PADDING_CELLS = 1;

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function axisValue(value, index, key, fallback) {
  if (Array.isArray(value)) return finitePositive(value[index], fallback);
  if (value && typeof value === 'object') return finitePositive(value[key], fallback);
  return finitePositive(value, fallback);
}

export function previewStageMetrics(spatial, paddingCells = PREVIEW_PADDING_CELLS) {
  const cells = Math.max(0, Number(paddingCells) || 0);
  const pixelsPerCellX = axisValue(spatial?.pixelsPerCell, 0, 'x', 128);
  const pixelsPerCellY = axisValue(spatial?.pixelsPerCell, 1, 'y', pixelsPerCellX);
  const canvasWidth = axisValue(spatial?.canvasCells, 0, 'width', 4);
  const canvasHeight = axisValue(spatial?.canvasCells, 1, 'height', 4);
  const frameWidth = axisValue(
    spatial?.framePixels, 0, 'width', canvasWidth * pixelsPerCellX,
  );
  const frameHeight = axisValue(
    spatial?.framePixels, 1, 'height', canvasHeight * pixelsPerCellY,
  );
  const offsetX = cells * pixelsPerCellX;
  const offsetY = cells * pixelsPerCellY;
  return {
    paddingCells: cells,
    offsetX,
    offsetY,
    frameWidth,
    frameHeight,
    width: frameWidth + offsetX * 2,
    height: frameHeight + offsetY * 2,
  };
}

export function grassTileScale(spatial, sourcePixelsPerWorldUnit = 64) {
  const sourceScale = finitePositive(sourcePixelsPerWorldUnit, 64);
  const pixelsPerCellX = axisValue(spatial?.pixelsPerCell, 0, 'x', 128);
  const pixelsPerCellY = axisValue(spatial?.pixelsPerCell, 1, 'y', pixelsPerCellX);
  return { x: pixelsPerCellX / sourceScale, y: pixelsPerCellY / sourceScale };
}

export function selectedVariant(ports, requestedKey = null) {
  const variants = Array.isArray(ports?.variants) ? ports.variants : [];
  const allowed = Array.isArray(ports?.deliveryVariantKeys)
    ? ports.deliveryVariantKeys
    : [];
  const key = requestedKey ?? allowed[0] ?? variants[0]?.rendererTemplateKey;
  return variants.find((item) => item.rendererTemplateKey === key) ?? variants[0] ?? null;
}

function validTransform(item, requireEnabledBinding = false) {
  const transform = item?.resolvedTransform;
  return Array.isArray(transform?.position)
    && transform.position.length >= 3
    && transform.position.every(Number.isFinite)
    && (!requireEnabledBinding || transform.enabledByBinding === true)
    && transform.enabledByBinding !== false
    && transform.disabled !== true;
}

export function activePipePorts(variant) {
  const pipe = variant?.activePorts?.pipe ?? {};
  const result = [];
  for (const role of ['input', 'output']) {
    for (const port of pipe[role] ?? []) {
      if (port?.isPipe === true && validTransform(port, true)) {
        result.push({ ...port, role: port.role ?? role });
      }
    }
  }
  return result;
}

export function ringStatusKeys(ports) {
  return [...new Set((ports?.rings ?? [])
    .filter((item) => item?.includedInPortRings === true && validTransform(item))
    .map((item) => String(item.statusKey)))];
}

export function ringsForStatus(ports, statusKey) {
  const seen = new Set();
  const result = [];
  for (const ring of ports?.rings ?? []) {
    if (ring?.includedInPortRings !== true || !validTransform(ring)) continue;
    if (String(ring.statusKey) !== String(statusKey)) continue;
    const transform = ring.resolvedTransform;
    const key = JSON.stringify([
      ring.resourceId,
      transform.position,
      transform.yawDegrees,
      String(ring.statusKey),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ring);
  }
  return result;
}

export function resourcePath(resource) {
  return resource?.path ?? resource?.manifest ?? null;
}

export function portLabel(port) {
  const role = port.role === 'output' ? '输出' : '输入';
  return `${role} ${port.index}`;
}
