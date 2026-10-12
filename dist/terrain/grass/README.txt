# Pixi 草地预烘焙测试包

本包是分层 2D WebP 素材，不需要运行时模型、法线图、3D 光照或自定义 Shader。

## 内容与用法

| 图层 | 默认素材 | 用途 |
| --- | --- | --- |
| 草底 | `assets/grass-base.webp`，1 × 1024²，不透明 | `TilingSprite` 连续平铺 |
| 大草斑 | `assets/grass-patch-01..04.webp`，4 × 1024²，半透明 | 不规则深浅/颜色变化 |
| 碎石 | `assets/gravel-01..08.webp`，8 × 512²，透明 | 近地表碎石和裸土细节 |

顺序：草底 → 大草斑 → 碎石 → 建筑。普通 alpha 混合，不额外染色、不再次应用 AgX 或曝光。草斑的渐隐已写进图片。锚点、世界尺度和允许旋转详见 `manifest.json`；不要裁掉装饰的透明边距。

默认 64 图片像素/世界单位。1024² 图对应 16 单位，512² 图对应 8 单位。工具若使用 32 像素/单位，底图 tileScale 和装饰基础 scale 都乘 0.5。这里的单位来自渲染坐标，不额外断言等于游戏中的米。

## 打开预览

在此目录启动：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8765/preview.html>；完成后在服务器终端按 Ctrl+C。Pixi 8.20.1 及其许可已附带，不依赖 CDN。HTML 需要 HTTP，不支持直接双击；`previews/*.webp` 可以直接打开。


## 接入已有 PixiJS v8 应用

加载本包的 `pixi-ground.js`，将 Pixi 命名空间和已初始化的应用用于下面的调用：

```js
const ground = await PixiGround.createGround(PIXI, {
  baseUrl: '/assets/ground',
  bounds: [0, 0, 64, 48],
  seed: 47031,
  pixelsPerUnit: 64,
});
app.stage.addChild(ground.root);
// 你的建筑放入 ground.layers.buildings，或绘制在整个地面容器之后。
```

素材不依赖 Pixi 主版本；示例代码按 v8 API 编写。npm 项目可使用自己的 Pixi，无需重复加载附带的 vendor。

`layout-example.json` 是固定布局；`PixiGround.generateLayout(seed, bounds)` 可生成相同布局。地图坐标 X 向右、Y 向下。平移缩放不要重新随机。大地图分块时按实际图像包围盒考虑跨区重叠，并按稳定 id 去重；不要逐格裁切装饰，也不要让每块底纹从本地 UV 零点重新开始。示例只为整张地图做一次边界裁切，不是完整无限地图引擎。

## 光照与限制

默认参考建筑的四方向对称柔光、AgX Medium High Contrast 和曝光 0.8，并使用统一照度的远场适配；实际参数以交付 `manifest.json` 的 `terrainLighting` 为准。地面为非金属、高粗糙度，不能照搬建筑金属 MRO。

当前碎石是平面纹理法线烘焙，不是真几何石块；无长投影，也不包含建筑专属的底座接触阴影。素材只批准俯视 0/90/180/270° 旋转，不建议任意角度或镜像。使用旧的单方向光照建筑时，不能保证搭配一致。

纹理来源版本和建筑风格版本分别记录于 `manifest.json`。接受的初版使用 v1.4 草地/碎石纹理与 v1.5 建筑风格；这不代表恢复了游戏地形 shader、原始混合图或地图。地形 NRO 的 RG=切线 XY、正 Z 重建、绿通道翻转仍是工作假设；未知的 D alpha、NRO B/alpha 未被当成可靠材质数据。交付 WebP alpha 是实际烘焙透明度。

## 测试建议

先关掉装饰，检查大面积草底是否出现方框、条纹或醒目的周期特征；再分别开启大草斑和碎石，检查是否像贴纸、是否自然跨越辅助格线。最后放入批准的四方向建筑，在目标设备和实际缩放倍率下检查效果。

全部使用无损 WebP。任务内的 `validation.json` 检查最终解码图片，`browser-validation.json` 记录实际运行的浏览器测试；这些诊断不进入交付包。数值通过不等于人眼完全看不出重复。软件 WebGL smoke test 也不是设备性能基准。

示例开启线性 mipmap 以减少缩小时的细纹闪烁。默认 13 张 RGBA8 地面纹理约 28 MiB，含完整 mipmap 约 37.3 MiB，不含 CPU 解码缓存、建筑和预览。WebP 文件较小不意味着显存同比变小；正式运行时只加载所需 assets，不加载全部静态预览。

源纹理属于游戏素材，分发或商用授权由项目方确认。Pixi MIT 许可见 `vendor/PIXI-LICENSE.txt`。

本专题只展示地面素材；田块在素材库首页建筑列表中。预览不加载建筑参考图。
