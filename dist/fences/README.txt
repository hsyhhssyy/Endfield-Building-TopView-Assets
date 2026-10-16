围栏专题：武陵 + 缘缘庄

两个布局共用2类设备：rail（栏杆）和post（立柱）。rail2/rail3/rail5是同一栏杆设备的长度变体，post是独立附属层；全专题只保存4套顶视/高度贴图，两个像素密度各一份。
核对两地长栏、短栏、立柱：源顶点距离为0，三角面与UV在1e-5精度匹配，两张D/NRO贴图文件哈希完全相同。复用依据见reuse.json。
共用贴图沿用武陵已发布的版本。两地单独渲染的细微色差不作为新设备类型。

manifest.json列出两个layouts与64/128资源入口。每个placement用deviceId与sprite引用共用定义。
spriteTransform=[a,b,c,d,tx,tz]，将共用精灵局部米制坐标(x,z)变换为布局坐标：X=a*x+c*z+tx，Z=b*x+d*z+tz。
精灵x=(pixelX-pivotX)/pixelsPerCell，z=(pixelY-pivotY)/pixelsPerCell。顶视图片+X向右、+Z向下；北朝上显示时对最终Z翻转，不改布局坐标。
heightTransform把解码高度变成布局相对地面的高度：H=scale*h+offset。高度图RG16按R*256+G解码并映射heightMin/heightMax，A>0有效，最近邻采样。
武陵：保留既有46×46整数格布局、38件与两处10格入口，栏杆占地不重叠，立柱可与栏杆共享附属格。
缘缘庄：保留原场景25件连续位置、旋转和非均匀缩放及三处开口；没有虚构整数占地。长栏复用rail5，短栏复用rail3，矩阵已补偿长度归一化。
原始sourceLocalToWorldMatrix仍为Unity列主序。不可在已应用spriteTransform后再次应用原矩阵。

来源分别为武陵v1.5-20261014-irrigation、缘缘庄v1.6；共用草地仅为背景示意，来自v1.4，不是两地地面导出。
三维源模型与归一化OBJ只保存一套；两地模型布局分别放在models/layouts。下载包按64/128分开，模型单独打包。
