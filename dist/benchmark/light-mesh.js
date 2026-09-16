/* Optional authored-UV light mesh experiment for the existing building page. */
import * as PIXI from './vendor/pixi.min.js';

export const vertex = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in float aHeight;
in vec3 aBarycentric;
out vec2 vUV;
out vec2 vSceneUV;
out float vHeight;
out vec3 vBarycentric;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uSceneSize;
void main() {
  vUV = aUV;
  vSceneUV = aPosition / uSceneSize;
  vHeight = aHeight;
  vBarycentric = aBarycentric;
  vec3 p = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.);
  gl_Position = vec4(p.xy, 0., 1.);
}`;

export const fragment = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vSceneUV;
in float vHeight;
in vec3 vBarycentric;
out vec4 finalColor;
uniform sampler2D uLightAtlas;
uniform sampler2D uSceneHeight;
uniform vec4 uAtlasRect;
uniform vec2 uHeightRange;
uniform float uOcclusion;
uniform float uHeightOffset;
uniform float uEpsilon;
uniform float uWire;
void main() {
  if (uOcclusion > .5 && all(greaterThanEqual(vSceneUV, vec2(0.))) && all(lessThan(vSceneUV, vec2(1.)))) {
    vec4 heightSample = texture(uSceneHeight, vSceneUV);
    float h = (floor(heightSample.r * 255. + .5) * 256. + floor(heightSample.g * 255. + .5)) / 65535.;
    h = mix(uHeightRange.x, uHeightRange.y, h);
    if (heightSample.a > .5 && vHeight + uHeightOffset + uEpsilon < h) discard;
  }
  vec4 color = texture(uLightAtlas, uAtlasRect.xy + vUV * uAtlasRect.zw);
  if (uWire > .5) {
    vec3 edge = smoothstep(vec3(0.), fwidth(vBarycentric) * 1.1, vBarycentric);
    float line = 1. - min(min(edge.x, edge.y), edge.z);
    color.rgb = mix(color.rgb, vec3(.1, 1., 1.), line);
    color.a = max(color.a * .6, line * .9);
  }
  if (color.a < .001) discard;
  finalColor = vec4(color.rgb * color.a, color.a);
}`;

async function readJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`灯带资源加载失败：${response.status} ${url}`);
  return response.json();
}

async function texture(url, scaleMode) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`灯带贴图加载失败：${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const source = new PIXI.ImageSource({ resource: bitmap, alphaMode: 'no-premultiply-alpha', autoGenerateMipmaps: false });
  source.style.scaleMode = scaleMode;
  return new PIXI.Texture({ source });
}

export async function mountLightMeshExperiment(preview, manifestUrl) {
  const manifest = await readJson(manifestUrl);
  const geometryUrl = new URL(manifest.geometry, manifestUrl);
  const atlasUrl = new URL(manifest.atlas, manifestUrl);
  const heightMetadataUrl = new URL(manifest.heightMetadata, manifestUrl);
  const [data, heightMetadata] = await Promise.all([readJson(geometryUrl), readJson(heightMetadataUrl)]);
  const field = heightMetadata.fields.find((item) => item.name === heightMetadata.staticPose) ?? heightMetadata.fields[0];
  const [atlas, height] = await Promise.all([texture(atlasUrl, 'linear'), texture(new URL(field.file, heightMetadataUrl), 'nearest')]);
  const spatial = preview.spatial.value;
  const pivot = spatial.pivotPixels;
  const scale = spatial.pixelsPerCell;
  const positions = [], uvs = [], heights = [];
  for (let i = 0; i < data.positions.length; i++) {
    const p = data.positions[i];
    positions.push(pivot.x + p[0] * scale.x, pivot.y + p[2] * scale.y);
    uvs.push(...data.uvs[i]);
    heights.push(p[1]);
  }
  const geometry = new PIXI.Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array(positions), format: 'float32x2' },
      aUV: { buffer: new Float32Array(uvs), format: 'float32x2' },
      aHeight: { buffer: new Float32Array(heights), format: 'float32' },
      aBarycentric: { buffer: new Float32Array(data.positions.length * 3), format: 'float32x3' },
    },
    indexBuffer: data.positions.length <= 65535 ? new Uint16Array(data.indices) : new Uint32Array(data.indices),
  });
  let wireGeometry = null;
  function geometryForWireframe() {
    if (wireGeometry) return wireGeometry;
    const expandedPositions = [], expandedUVs = [], expandedHeights = [], barycentric = [];
    for (let i = 0; i < data.indices.length; i++) {
      const index = data.indices[i];
      expandedPositions.push(positions[index * 2], positions[index * 2 + 1]);
      expandedUVs.push(uvs[index * 2], uvs[index * 2 + 1]);
      expandedHeights.push(heights[index]);
      barycentric.push(...[0, 1, 2].map((corner) => Number(corner === i % 3)));
    }
    wireGeometry = new PIXI.Geometry({ attributes: {
      aPosition: { buffer: new Float32Array(expandedPositions), format: 'float32x2' },
      aUV: { buffer: new Float32Array(expandedUVs), format: 'float32x2' },
      aHeight: { buffer: new Float32Array(expandedHeights), format: 'float32' },
      aBarycentric: { buffer: new Float32Array(barycentric), format: 'float32x3' },
    }, indexBuffer: data.indices.length <= 65535
      ? Uint16Array.from(data.indices, (_, i) => i) : Uint32Array.from(data.indices, (_, i) => i) });
    return wireGeometry;
  }
  const shader = PIXI.Shader.from({ gl: { vertex, fragment }, resources: {
    uLightAtlas: atlas.source,
    uSceneHeight: height.source,
    lightOptions: {
      uSceneSize: { value: new Float32Array([spatial.framePixels.width, spatial.framePixels.height]), type: 'vec2<f32>' },
      uHeightRange: { value: new Float32Array([field.heightMin, field.heightMax]), type: 'vec2<f32>' },
      uAtlasRect: { value: new Float32Array(manifest.states[0].uvRect), type: 'vec4<f32>' },
      uOcclusion: { value: 1, type: 'f32' },
      uHeightOffset: { value: 0, type: 'f32' },
      uEpsilon: { value: manifest.epsilon, type: 'f32' },
      uWire: { value: 0, type: 'f32' },
    },
  } });
  const mesh = new PIXI.Mesh({ geometry, shader });
  mesh.position.set(preview.previewMetrics.offsetX, preview.previewMetrics.offsetY);
  preview.app.stage.addChildAt(mesh, preview.app.stage.getChildIndex(preview.buildingSprite) + 1);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'light-mesh-panel';
  panel.innerHTML = `
    <h2>底座灯带 · 细条图集</h2>
    <div class="button-row"><label><input type="checkbox" id="light-mesh-occlusion" checked> 高度遮挡</label>
      <label><input type="checkbox" id="light-mesh-wire"> 网格线</label></div>
    <div class="button-row"><label><input type="checkbox" id="light-mesh-isolate"> 仅看灯带</label></div>
    <div class="control-row"><label for="light-mesh-height">测试高度偏移</label>
      <input id="light-mesh-height" type="range" min="-0.2" max="3" step="0.01" value="0" style="min-width:0;width:110px">
      <output id="light-mesh-height-value">0.00</output></div>
    <p class="subtle" id="light-mesh-info"></p>
    <p class="subtle">灯带颜色由页面 StatusCode 自动决定；无状态配置时使用清单默认色。关闭高度遮挡可检查完整灯环。</p>
    <details><summary>查看细条图集与预计算 UV</summary>
      <img id="light-mesh-atlas" alt="从上到下为黄、红、绿、蓝、白五条灯带" style="width:100%;margin:10px 0;background:repeating-conic-gradient(#46515b 0% 25%,#303c46 0% 50%) 0/12px 12px">
      <p class="subtle">从上到下：黄、红、绿、蓝、白。每条展开完整灯环；加载时直接读取预计算的顶点与 UV。</p>
      <p class="metadata"><a id="light-mesh-data-link">顶点与 UV</a> · <a id="light-mesh-manifest-link">颜色图集配置</a></p>
    </details>`;
  document.querySelector('#animation-panel').before(panel);
  panel.querySelector('#light-mesh-atlas').src = atlasUrl.href;
  panel.querySelector('#light-mesh-data-link').href = geometryUrl.href;
  panel.querySelector('#light-mesh-manifest-link').href = manifestUrl.href;
  const uniforms = shader.resources.lightOptions.uniforms;
  let selectedStateId = manifest.defaultState;
  const audit = { ready: true, taskId: manifest.taskId, state: selectedStateId, statusCode: null, occlusion: true,
    wire: false, isolate: false, heightOffset: 0, atlasSources: 1, atlasSize: manifest.atlasSize,
    sourceVertices: data.positions.length, triangles: data.indices.length / 3,
    geometry: data.parameterization?.kind ?? 'authored nonrectangular light mesh',
    gpuVertices: data.positions.length, gpuColorBytes: manifest.atlasSize[0] * manifest.atlasSize[1] * 4,
    runtimeUVAnalysis: false, sourceHeight: heights[0], staticPose: field.name };
  function update() {
    const id = selectedStateId;
    const state = manifest.states.find((item) => item.id === id);
    mesh.visible = Boolean(state);
    if (state) uniforms.uAtlasRect = new Float32Array(state.uvRect);
    uniforms.uOcclusion = Number(panel.querySelector('#light-mesh-occlusion').checked);
    uniforms.uWire = Number(panel.querySelector('#light-mesh-wire').checked);
    const selectedGeometry = uniforms.uWire ? geometryForWireframe() : geometry;
    if (mesh.geometry !== selectedGeometry) mesh.geometry = selectedGeometry;
    uniforms.uHeightOffset = Number(panel.querySelector('#light-mesh-height').value);
    const isolated = panel.querySelector('#light-mesh-isolate').checked;
    preview.buildingSprite.alpha = isolated ? 0 : 1;
    preview.effectLayer.alpha = isolated ? 0 : 1;
    panel.querySelector('#light-mesh-height-value').textContent = uniforms.uHeightOffset.toFixed(2);
    Object.assign(audit, { state: id, occlusion: Boolean(uniforms.uOcclusion), wire: Boolean(uniforms.uWire),
      isolate: isolated, heightOffset: uniforms.uHeightOffset,
      gpuVertices: uniforms.uWire ? data.indices.length : data.positions.length });
    panel.querySelector('#light-mesh-info').textContent = `${data.positions.length} 顶点 · ${data.indices.length / 3} 三角形 · 1 张 ${manifest.atlasSize.join('×')} 图集 · ${manifest.states.length} 色 · 颜色纹理约 ${(audit.gpuColorBytes / 1024).toFixed(1)} KiB 显存`;
    document.documentElement.dataset.lightMeshState = id;
    preview.app.render();
  }
  panel.addEventListener('input', update);
  panel.addEventListener('change', update);
  const unsubscribe = preview.onStatusCodeChange?.((status) => {
    const mapping = manifest.stateByStatus ?? {};
    selectedStateId = Object.hasOwn(mapping, status.code) ? mapping[status.code] : manifest.defaultState;
    audit.statusCode = status.code;
    update();
  });
  const experiment = { audit, mesh, geometry, shader, atlas, height, update, preview,
    dispose() {
      unsubscribe?.();
      panel.remove();
      mesh.removeFromParent();
      mesh.destroy(); geometry.destroy(); wireGeometry?.destroy(); shader.destroy();
      atlas.destroy(true); height.destroy(true);
      if (window.factoryLightMeshExperiment === experiment) delete window.factoryLightMeshExperiment;
    },
  };
  window.factoryLightMeshExperiment = experiment;
  update();
  return experiment;
}
