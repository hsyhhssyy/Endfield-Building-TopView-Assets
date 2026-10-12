# 田块土地素材包 · 64 像素/格

本包包含 1 张可连续平铺的裸土底图和 4 张带透明渐隐的土色斑块。均为无损 WebP，大小 512 × 512 像素，每张对应 8 × 8 格。裸土底图不透明；斑块用来增加局部深浅变化，可跨越底图边界。

来自 v1.5-20260926-gasscope 的 T_terrain_soil_012_D / NRO，按现有正式田块的四方向柔光、Khronos PBR Neutral 和曝光 0.4 烘焙；远场灯光使整张底图照度稳定。素材已含光照，接入时直接按普通颜色显示，不重复施加曝光或光照。

## 接入

顺序为 **土地底图 → 土色斑块 → 田块**。田块仍是独立的 4 × 4 格建筑素材；土地不会把田块烘焙进底图。正常 alpha 混合，不裁掉斑块的透明边距，不加矩形遮罩。既有田块外缘的透明渐隐可与此底图衔接。

```js
const ground = await PixiGround.createGround(PIXI, {
  baseUrl: '/assets/farmland-soil',
  seed: 47031,
  bounds: [0, 0, 36, 20],
  pixelsPerUnit: 64,
});
app.stage.addChild(ground.root);
// 将你的田块 Sprite 放在 ground.layers.buildings。
```

`pixi-ground.js` 为 PixiJS v8 示例；图片可用于其他 2D 引擎。`manifest.json` 记录素材尺寸、世界尺度、锚点和分布参数。`PixiGround.generateLayout(seed, bounds, manifest.layoutSpecs)` 提供确定性布局：坐标 X 向右、Y 向下，平移和缩放不重新随机。分块地图需要保持底图世界坐标相位，并按斑块 id 去重，避免同一斑块重叠绘制。允许 0/90/180/270° 旋转，不建议镜像或任意角度。

## 预览

附带 Pixi 8.20.1 和许可，无 CDN 依赖。在本目录运行 `python -m http.server 8765 --bind 127.0.0.1` 后打开 `http://127.0.0.1:8765/preview.html`。预览支持种子切换、土色层开关、田块开关、平铺边界线、拖动和缩放。

`previews/fields-on-ground.webp` 展示 10 种正式田块与土地搭配；`previews/reference-*.webp` 仅用于预览。田块参考沿用已交付的圆角凹面近似，原文件未修改；form 字段是模型形态名，不代表已证实的游戏生长阶段。土地运行时只需要 assets、manifest 和按需使用的 pixi-ground.js，不需要这些田块参考图。

## 范围

这是一份用游戏土壤贴图制作的可平铺二维背景，未恢复游戏整张地形的混合图或高度网格。土地为平面烘焙，只有法线细节，不包含田块专属接触投影或实时水面、风摆。NRO 的 RG 切线法线解释属于工作假设；未使用未知 B/alpha 通道，原始 D alpha 未被用作透明度。

已检查最终 WebP 无损解码、横纵接缝、透明边缘、四向旋转和照度均匀性；大面积搭配图经过目视检查。浏览器测试验证分层开关、换种子、双尺寸和跨区坐标一致性，测试不代表目标设备性能。
