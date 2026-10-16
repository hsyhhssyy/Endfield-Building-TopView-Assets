围栏专题：武陵 + 缘缘庄

共用 2 类设备：rail 栏杆（1×2、1×3、1×5 三种固定长度）与 post 立柱（1×1 附属件）。共 4 套贴图/高度图，各有 64 和 128 像素/格。
两地源网格、UV 和纹理的复用证据见 reuse.json。整格重建不会新增设备类型，也不使用实例缩放。

manifest.json 给出两份布局及资源入口。武陵维持 46×46、38 件、两处 10 格入口的既有方案。
缘缘庄改为 40×40 整数占地、36 件（31 栏杆 + 5 立柱），中心线范围为 39×39；保留南 7 格、东 8 格、西 3 格开口。
缘缘庄运行时只读取 placements：gridX/gridZ 是占地左下角的整数格，width/depth 是整数占地，yawDegrees 仅为 0/90/180/270。
使用 sizes/*/assets.json 中固定 gridPlacement 锚点：栏杆的视觉中心相对占地中心沿本地 +X 固定半格，随旋转一同转动，以使四角端点衔接；立柱使用占地中心。该枢轴属于共用组件，不是实例自由位移。
spriteTransform 是上述整数格及固定枢轴推导出的绘图矩阵；可直接使用，不能再次叠加 gridX/gridZ。无需识别或应用任何原场景缩放。
spriteTransform=[a,b,c,d,tx,tz]：X=a*x+c*z+tx，Z=b*x+d*z+tz。局部 x=(pixelX-pivotX)/pixelsPerCell，z=(pixelY-pivotY)/pixelsPerCell；图片 +X 向右、+Z 向下，北朝上时翻转最终 Z。
heightTransform 恒为 scale=1、offset=0；RG16 高度按 R*256+G 解码并映射 heightMin/heightMax，A>0 有效，最近邻采样。
栏杆占地不重叠；立柱放在附属层，可与栏杆格重叠。禁止重叠的引擎应将立柱作为格内附件。
缘缘庄 sourceReference 完整保留原 25 件及原始矩阵，仅供来源核对，不能用来摆放整格布局。sourceEntityIds 是分拆、合并前的来源映射，并非新的实例 ID。

武陵来源 v1.5-20261014-irrigation，缘缘庄来源 v1.6；草地背景仅为 v1.4 示意。三维模型单独打包；models/layouts 的缘缘庄布局同样是整格版，内含原始来源记录。斜视预览按当前整格布局生成。
