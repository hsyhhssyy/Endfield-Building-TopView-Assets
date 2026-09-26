气体环境范围：13×13 格俯视，共用动画，客户端着色

1. manifest.json 为入口。mesh.json 提供 2D 顶点、UV、三角形索引；palette.json 提供四种源材质的线性 RGB tint。
2. 1 格 = 1 Unity 单位。范围中心为 [0,0]，X 对应 Unity X，Y 对应 Unity Z。矩形边界为 [-6.5,-6.5,6.5,6.5]。直接将顶点放到范围中心，不要再按贴图或原始模型的包围盒归一化。覆盖范围为完整的 169 格，包括四角。
3. 外沿视觉圆角半径 0.75 格，烟带只向内延伸，最多 0.5 格。径向 UV 将亮边放在距外沿约 0.075 格处，流动亮带宽度随帧变化。visualBoundary 仅描述视觉边界，不能用它裁剪角落格子的玩法覆盖。
4. sizes/64 和 sizes/128 是展开贴图的烘焙档位，不是修改后网格的固定每单位像素密度。两档共享同一网格。120 帧、20 fps、6 秒循环，以 (t * fps) % frameCount 读取当前及下一帧。
5. UV 原点为左上，U 使用 fract 循环，V 钳制到 0..1。图集 UV = (rect.xy + uv * rect.zw) / atlasSize。2 像素边距已计入，采用 LINEAR 采样、CLAMP_TO_EDGE，不开启 mipmap。
6. WebP 为原始灰度 RGB + 独立 straight alpha。RGB 采用 sRGB 编码，先解码到线性亮度再乘 palette.tintLinear。插值两帧时，在线性空间分别乘各自 Alpha 后插值，再除合成 Alpha、乘 tint、转回 sRGB、乘 Alpha 输出。WebGL 混合 ONE / ONE_MINUS_SRC_ALPHA。viewer.js 提供示例。
7. 四种气体仅改变颜色，共用网格与动画。默认整体缩放为 1；缩放整个网格也会同比改变圆角和烟带宽度。客户端若需要其它覆盖大小，应重新构建外沿与径向顶点并保持约定宽度。
8. 本次校准复用先前 smoke02 灰度图集，图集文件逐字节不变。重建 13×13 边界与径向 UV，代替原始过宽的烟带网格。严格俯视省略竖向烟墙。无场景深度、地形裁剪；源材质运行时颜色及透明度覆盖未验证。
9. 1×1 格网格和矩形参考线只用于网页预览，不在烘焙素材中。HTTP 打开 index.html，切换四种气体、贴图档位、网格或暂停拖动动画。

来源：v1.5-20260926-gasscope
修订：grid-13x13-20260927
模型：P_fxfac_vaporizer_scope_blue_2501/internal/smoke02
材质：M_fxfac_vaporizer_scope_2508
配置关联：FactoryVaporizerTable 与 FactoryEnvDisplayTable
四种气体：item_gas_inert、item_gas_water、item_gas_acid、item_gas_xiranite
原始缓存请求：337f5849319b5797199fec25fa875ad8c2374e2b0af57690b16f9609b1835c52
