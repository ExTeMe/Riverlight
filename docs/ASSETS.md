# 素材与依赖说明

更新：2026-10-10。

当前资产属于集成原型，导出数量不代表精细度与多样性通过验收。升级标准见 [SYSTEMS.md](SYSTEMS.md) 的 S08，先执行 R1 六类代表样板，再按 [BACKLOG.md](BACKLOG.md) 的 ASSET 系列任务精修全库。

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
- 文档中的城市截图：本项目历史版本的实际浏览器渲染结果；最新示范城的验收截图尚待补充。

## 开源依赖

- [Three.js](https://github.com/mrdoob/three.js)：MIT。版本与许可证随依赖安装在 `node_modules/three`。使用其 OrbitControls、Water、Reflector、GTAOPass、EffectComposer 等模块。
- [Vite](https://github.com/vitejs/vite)：MIT，用于开发和生产打包；依赖版本由 `package-lock.json` 锁定。

## 旧资源

`objs/`、`textures/`、`sounds/` 与旧 `build/` 来自原项目。本次未确认其各项许可，也未将其接入新版入口。它们被保留供用户追溯旧项目。

需求方案中列出的 Kenney、Quaternius 是后续扩充候选来源，并非本次已下载使用的素材。今后引入模型、贴图或录音时，应在本文件记录具体文件、来源页面、作者、许可及是否需要署名。
