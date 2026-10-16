围栏专题：武陵 + 缘缘庄

共用 2 类设备、4 个固定变体：1×2、1×3、1×5 栏杆，以及 1×1 立柱。64/128 像素/格各一套。
两地的原有 gridX/gridZ、width/depth、yawDegrees 保持不变。武陵 46×46 格、38 件，南/西各 10 格入口；缘缘庄 40×40 格、36 件，南/东/西入口占地为 7/8/3 格。

摆放规则 cell-center-v1：
1. gridX/gridZ 是占地左下角整数格；width/depth 是旋转后的整数占地。
2. 世界中心 X=gridX+width/2，Z=gridZ+depth/2。旋转仅为 0/90/180/270 度，绕这个占地中心进行。
3. 图片 pivotPixels 为画布正中心；沿用原贴图、原归一化模型，不平移图像内容，不改变模型顶点。
4. 不使用 renderCenterGridXZ，不叠加视觉锚点偏移。旧版该字段和半格挂点规则已经删除。
spriteTransform=[a,b,c,d,tx,tz] 仅是上述规则的等价绘图矩阵：X=a*x+c*z+tx，Z=b*x+d*z+tz。tx/tz 必须等于占地中心，不能再次叠加 gridX/gridZ。
局部 x=(pixelX-pivotX)/pixelsPerCell，z=(pixelY-pivotY)/pixelsPerCell；图片 +X 向右、+Z 向下，北朝上时翻转最终 Z。
heightTransform 固定 scale=1、offset=0。高度按 R*256+G 解码并映射 heightMin/heightMax，A>0 有效，最近邻采样。

普通组件在拐角或端点可能留缝，预览如实显示。本交付不是无缝拼接版；如需无缝拼接，应另做适配的美术组件，不能通过设备位移模拟。
栏杆占地不重叠；立柱为独立附属层，可与栏杆共格，不重复计入阻挡。
sourceLocalToWorldMatrix 及缘缘庄 sourceReference 仅保留原场景溯源信息，不能用于运行时设备摆放。

武陵来源 v1.5-20261014-irrigation，缘缘庄来源 v1.6；两地网格、UV、纹理复用依据见 reuse.json。草地仅为 v1.4 示意。
模型单独打包；models/layouts 与运行时布局相同。顶视、斜视均按占地中心摆放，不隐藏接缝。
