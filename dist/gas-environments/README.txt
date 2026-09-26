气体环境范围：固定俯视，共用动画，客户端着色

1. manifest.json 是入口；mesh.json 是 2D 顶点、UV、三角形索引；palette.json 是四种气体与原材质线性 RGB 颜色。
2. sizes/64 与 sizes/128 是两档纹理精度。坐标保持原 Unity X,Z 单位，中心为 [0,0]。档位不等于条带沿周长的每单位像素数；条带使用压缩的参数化 UV，实际尺寸见 stripPixels。
3. animation.json 给出 120 帧、20 fps、6 秒循环以及每帧所在图集的像素矩形。以 (t * fps) % frameCount 找当前帧及下一帧，最后一帧插值回第一帧。
4. 网格 UV 原点为左上；U 先 fract 重复，V 限制在 0..1，再映射到帧矩形。坐标公式：(rect.xy + uv * rect.zw) / atlasSize。2 像素边距已烘焙。图集 LINEAR 过滤、CLAMP_TO_EDGE，不启用 mipmap。
5. WebP 是无损灰度 RGB + 独立 straight alpha。RGB 用 sRGB 编码，先转换到线性亮度，再乘 palette.tintLinear。两帧先在线性空间乘各自 Alpha 后插值，再除插值 Alpha、乘颜色、转 sRGB、乘 Alpha 输出。WebGL 混合使用 ONE / ONE_MINUS_SRC_ALPHA。viewer.js 包含完整可运行示例。
6. 四种气体只改变颜色，共用相同网格和图集；可进一步加入整体透明度。下载体积、图集显存与展开条带尺寸见 manifest.statistics。
7. 可对顶点位置整体缩放或变形来匹配范围，保持 UV 和三角形拓扑。放大范围会拉伸周长纹理，不会凭空增加细节。当前轮廓来自原模型，任意拼接形状需客户端重新生成边界网格与 UV。
8. 本素材只支持严格俯视。原竖直矮墙投影面积近零，交付其水平气雾层 smoke02，58 顶点 / 56 三角形。此层无透视 Fresnel，未加入场景深度；建议在地面之后、设备之前绘制。
9. 这是依据源纹理与材质参数重建的视觉近似：四种环境统一使用蓝色环境运动；6 秒循环由原参数连续采样的平滑混合重建。保留原材质颜色，但游戏运行时颜色覆盖、精确范围放置与地形遮挡未验证。
10. 网页在 HTTP 服务器下打开。发布站仅载入 64 档；完整 ZIP 内包含对应档位的素材、此说明与示例页面。

来源：v1.5-20260926-gasscope
模型：P_fxfac_vaporizer_scope_blue_2501/internal/smoke02
材质：M_fxfac_vaporizer_scope_2508
环境映射：FactoryVaporizerTable 与 FactoryEnvDisplayTable
四种气体：item_gas_inert、item_gas_water、item_gas_acid、item_gas_xiranite
源模型缓存请求：337f5849319b5797199fec25fa875ad8c2374e2b0af57690b16f9609b1835c52

