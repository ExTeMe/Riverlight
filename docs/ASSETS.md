# 素材与依赖说明

更新：2026-10-13。

当前资产属于集成原型，导出数量不代表精细度与多样性通过验收。升级标准见 [SYSTEMS.md](SYSTEMS.md) 的 S08，先执行 R1 六类代表样板，再按 GitHub 中 ASSET 系列任务精修全库。

## 本次重做使用的内容

- 正式目录中的 34 类建筑及场所资产已通过 Blender MCP 原创建模，包含 8 类住宅、9 类商业、5 类公共建筑、5 类公园/场所、7 类街景装饰。每类有近景、远景两个 GLB，共 68 个文件，位于 `public/models/`。
- 可编辑源文件：`assets/blender/riverlight-city-library.blend`（住宅、商业、公共、景观等库）、`assets/blender/riverlight-shopping-gallery.blend`（商场）。既有 Blender 场景保留，建模使用独立场景。
- 建模/导出脚本：`scripts/blender/build_city_assets.py`、`scripts/blender/build_mall.py`。`assets/catalog-reference.json` 记录建模时原始尺度，运行时可按目录占地适配；修改时需保持原始尺度依据一致。
- 建模脚本不硬编码开发者本机路径：优先使用本地 `RIVERLIGHT_PROJECT_ROOT` 变量，其次从脚本、当前工作目录或已保存 BLEND 的位置向上查找项目。无法识别时明确报错；环境变量的实际值不提交仓库。
- 动画资产包括商场旋转门、游乐园摩天轮及座舱、旋转木马、喷泉动态部件。实际浏览器动画与远景策略仍需按 GitHub 中关联任务完成最终验收。
- 本轮修正美术馆、诊所的外墙材质语义并重新导出近远景 GLB；可编辑城市库源文件同步保存。该修复不等同于新一轮造型精修完成。
- `src/asset-loader.js` 加载 GLB，`src/models.js` 转换共享材质、合批静态几何并保留动态部件；`src/architecture.js` 是加载失败时的备用模型，不是正式 Blender 资产的替代交付。
- 道路、桥梁与连接几何由 `src/roads.js` 在运行时生成；河岸地形与部分沿岸家具由 `src/world.js`、`src/models.js` 生成。车辆、船只、人物目前仍是运行时原创几何，后续可扩展 Blender 资产。
- 天空、水面法线、天气粒子、积水遮罩：代码或 Canvas 生成，无第三方图片下载。
- 背景音景与风雨声：`src/audio.js` 通过 Web Audio 合成，无第三方音乐录音。
- 界面图标：`src/icons.js` 内的简单 SVG 路径；标识及 favicon 为本项目制作。
- 字体：使用设备自带系统字体，未分发字体文件。

## R1 街区样板

[河光小街画风参考](ART_DIRECTION.md) 记录材质色板、比例与 T06 固定镜头对照，供六类样板统一调校。

住宅与面包房样板源为 `assets/blender/riverlight-street-samples.blend`，制作脚本为 `scripts/blender/build_street_samples.py`。公共建筑图书馆样板源为 `assets/blender/riverlight-library-sample.blend`，制作脚本为 `scripts/blender/build_library_sample.py`；仅写入本次创建的场景，不覆盖用户已打开的场景或旧城市资产库。

图书馆保持 `library` ID 和既有占地适配，包含高低阅览楼、书架展示开间、木格栅、内凹入口、雨棚、座椅和花池。源尺度边界 11.6 × 11.6 米、高 6.26 米；运行时适配 12 × 10 米地块。近景 25,576 三角面、远景 1,860 三角面，运行时合为 19 个材质批次；无外部纹理依赖。Entrance/Shelter 锚点保留在 GLB 中，当前步行系统尚未消费这些锚点，不能据此宣称避雨已实现。

三项样板在 T06 已有布局中直接替换加载；布局和存档格式不变。尚需六类代表齐全后的统一材质、三时段、近中远景和用户视觉验收。当前材质仍经过运行时语义转换，不能把源文件的材质表现视为最终游戏表现。

## 素材获取与制作约定

- 材质不能过于卡通化；木、石、墙面、沥青、玻璃和金属须保留可辨认的质感，细节尺度与整体微缩画面协调，通过样板确认。
- 声音素材现阶段由用户搜索和提供。需要特定音效时，说明场景、触发方式、时长、是否循环、变体和空间表现，再向用户询问；接入时记录具体来源与许可。
- 声音风格按场景和氛围选择，不统一限定为自然柔和。音频制作软件与 MCP 方案留待后续决定；当前合成音景仍是原型。

## 开源依赖

- [Three.js](https://github.com/mrdoob/three.js)：MIT。版本与许可证随依赖安装在 `node_modules/three`。使用其 OrbitControls、Water、Reflector、GTAOPass、EffectComposer 等模块。
- [Vite](https://github.com/vitejs/vite)：MIT，用于开发和生产打包；依赖版本由 `package-lock.json` 锁定。

## 旧资源

`objs/`、`textures/`、`sounds/` 与旧 `build/` 来自原项目。本次未确认其各项许可，也未将其接入新版入口。它们被保留供用户追溯旧项目。

需求方案中列出的 Kenney、Quaternius 是后续扩充候选来源，并非本次已下载使用的素材。今后引入模型、贴图或录音时，应在本文件记录具体文件、来源页面、作者、许可及是否需要署名。
