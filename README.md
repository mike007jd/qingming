# 清明上河 · Qingming Riverside

Development / GMK setup: [DEVELOPMENT.md](DEVELOPMENT.md). Large assets require `git lfs pull`.

独立本地 Three.js / WebGL2 工程，包含全城场景、人物与舟车生态、可行走建筑、持续水场，以及 QingmingStyle / QingmingPass 画卷材质。界面为英文。原始参考级美术仍有差距，见 [视觉记录](evidence/visual-review.md)。

## 启动与操作

双击 macOS 的 `START.command` 或 Windows 的 `START.bat`；也可运行 `npm start`，打开 [本地场景](http://127.0.0.1:4193/)。使用 Node.js 22.15+ 和支持 WebGL2 / 浮点渲染目标的桌面浏览器。Three.js r179、加载器、纹理和场景资源均在工程内。

- 数字键 1–9、0 切换十个镜头；H 隐藏界面。
- Orbit：拖拽旋转、滚轮缩放、右键拖拽平移。Fly：WASD 移动、Q/E 升降。
- Walk：在 Scene settings 选择 Walking location，再点击 Start walking here。WASD 移动，E 开关门，Shift 加速，R 返回出生点。
- River traffic 面板可追踪舟车。Animate the city 控制人物、舟车、水和风的暂停/继续；暂停静止时按需重绘。
- Scroll style 提供 Light Color、Antique Silk 与 Original Materials；场景设置中可调整画卷、墨线与纸纹强度。

## 画质与导出

| 项目 | Auto · Performance | Cinema · Rich detail |
| --- | --- | --- |
| 人物 | 每人 3000 / 1000 / 300 三角，180 / 60 px 分档，两个共享材质 | 原始材质，近景高模／远景原始 LOD |
| 树木 | 整株 8000 / 2000 / 300 三角，160 / 48 px 分档 | 近景高模／远景原始 LOD |
| 建筑与地面 | 逐构件保形减面，近景完整瓦面／中远景连续屋面；原路面/地形按约 32m 分块，按材质原生批量绘制 | 原始几何及可用的 LOD |
| 抗锯齿 / 阴影图 | 2×MSAA / 1024 | 2×MSAA / 1024 |
| 水面网格 | 1024×64，按约 32m 分块 | 原始 2048×256 |
| 屏幕分辨率 | 像素比默认上限 1.25，可手动选择 | 原生像素比 |
| 阴影与倒影 | 比主画面粗一档；NPC 阴影 40m，44m 移出；固定镜头动画隔帧刷新 | 原始 LOD，每次刷新 |
| 船体取样 | 单批异步，按身份复用；样本超过 0.25 秒同步刷新 | 即时批量同步 |
| 画卷描边 | 独立法线/深度通道，复用主画面网格与可见集合 | 原始通道 |

584 人、31 关节、成人/儿童动作、舟车生态、碰撞及全部原始 Blender 高模保留。虹桥护栏、桥面与桥拱保留完整几何。材质纹理仍 ≤1K；水场 2048×256、1/120 秒物理子步不变。暂停、固定时间、导出与录像强制即时取样和完整通道刷新。Auto 允许脸部、衣褶、配件和中远景细节减少；不再要求与高模像素一致。Cinema 近景使用原始高模，远景使用原始资产的 LOD；按 1.5 倍投影尺寸选择层级，保留更久的高细节和 20% 回切滞后。

Capture 4K still 导出当前视角 3840×2160 PNG；Export all views 输出十个镜头的画卷/原材质共 20 张图；Record 10-second walkthrough 输出 1920×1080 WebM。导出分辨率独立于 Resolution 设置，文件保存到 `evidence/`。

## 工程与素材

- `src/`：渲染、水体、生态、交互与画卷材质；坐标为米制 Y-up，旧生态数据在接入处转换。
- `public/runtime/`：场景描述、SoA 几何、纹理、导航、绑定与生态数据。
- `assets/`：五个运行时 GLB；`production/`：原生 Blender 场景、资产清单和制作数据。
- `tools/`：Blender 制作与导出脚本。`npm run build:assets` 从当前权威场景生成 Auto 几何、SoA 和清单，`BLENDER` 可指定 Blender。仅显式传入 `-- --rebuild-scene` 才从制作输入重建布局与 Blender；使用该选项前保存当前场景修改。
- `evidence/`：参考图、既有 4K 图库和验收数据；`backup/`：源码快照与实验归档。

## 验证与记录

运行 `npm test`；服务启动后运行 `npm run test:package`。浏览器入口：

- `?verify=1`：42 项水场、碰撞、交互与三画风/十视角 GPU 检查。
- `?opttest=1&mode=quality`：三画风 × 镜头 1/3/8 静态 A/B，以及独立的实际运动取样/刷新检查。`?perf=1` 兼容入口也运行此检查；旧折射序列 oracle 已归档。
- 上述质量页加 `&full=1`：三画风 × 十镜头的 4K 静态比较。每次报告与图片使用独立时间戳，避免覆盖基线。
- `?opttest=1`：瓦片批处理、静态矩阵、描边跳过与暂停检查；`?lodtest=1`：几何 LOD 对照。
- `?profile=1`：六段提交/完成墙钟计时。未计入的时间包含水体 GPU 更新与回读，不能解释为 CPU 占用率。

Auto/Cinema 质量页默认只报告像素差异并检查 GPU/运动行为；显式 `rmse` / `over8` 参数仍可用于指定对照。它不代表 30 fps 或视觉验收通过。当前目标及验收方法见 [性能规格](PERF_QUALITY_SPEC.md)，运行 `npm run test:auto-assets` 检查资产预算和绑定。

本轮实现、护栏修复、验收数据与未完成项见 [1080p 性能改造记录](evidence/auto-30fps-20260912.md)。
