# Qingming Riverside · A Living Scroll

Development / GMK setup: [DEVELOPMENT.md](DEVELOPMENT.md). Large assets require `git lfs pull`.

A self-contained local Three.js / WebGL2 scene with a riverside city, animated people and traffic, walkable buildings, a persistent water field, and QingmingStyle / QingmingPass scroll materials. Reference-level artwork remains unfinished; see the [visual review](evidence/visual-review.md).

## Run and explore

Double-click `START.command` on macOS or `START.bat` on Windows, or run `npm start` and open [the local scene](http://127.0.0.1:4193/). Requires Node.js 22.15+ and a desktop browser with WebGL2 and floating-point render targets. Three.js r179, loaders, textures and assets are bundled locally.

- **1–9, 0:** ten viewpoints. **H:** hide the interface.
- **Orbit:** drag to rotate, scroll to zoom, right-drag to pan. **Fly:** WASD movement, Q/E vertical movement.
- **Walk:** choose a Walking location in Scene settings and select Start walking here. WASD moves, E operates doors, Shift speeds up, R returns to the starting point.
- **River traffic:** follow boats and convoys. **Animate the city:** pause/resume people, boats, water and wind. Stationary paused views render again when inputs change.
- **Scroll style:** Light Color, Antique Silk and Original Materials, including the water, reflections, foam and spray. Adjust scroll strength, ink outlines and silk texture in Scene settings.

## Quality and capture

| Setting | Auto · Performance | Cinema · Original detail |
| --- | --- | --- |
| NPC geometry | ≤3000 / 1000 / 300 triangles at 180 / 60 px, two shared materials | Original geometry/materials |
| Whole trees | ≤8000 / 2000 / 300 triangles at 160 / 48 px | Original geometry |
| Buildings / ground | Preserved structural members and near roof tiles; closed coarse roofs; original ground in ~32m chunks | Original geometry |
| MSAA / shadow map | 2× / 1024 | 4× / 4096 |
| Water mesh | 1024×64 in ~32m chunks | Original 2048×256 |
| Screen resolution | Pixel ratio capped at 1.25 by default; adjustable | Native pixel ratio |
| Shadow / reflection | One coarser LOD; NPC shadows enter at 40m, leave at 44m; alternate refresh for stationary animated views | Original geometry, every render |
| Hull samples | One asynchronous batch, mapped by boat identity; sync fallback after 0.25 seconds | Immediate synchronous batch |
| Scroll outlines | Independent normal/depth pass using main geometry and visibility | Original pass |

All 584 people, 31 joints, adult/child actions, ecology, collisions and original Blender sources remain. Hongqiao rails, deck and arches retain their original geometry. Textures remain ≤1K; the 2048×256 water field and 1/120-second simulation substeps are unchanged. Pause, fixed-time checks, capture and recording force immediate sampling and full source refresh. Auto intentionally simplifies faces, folds, accessories and distant details. Cinema retains the original detail for inspection and export.

**Capture 4K still** saves a 3840×2160 PNG. **Export all views** saves 20 captures: ten views in styled and original materials. **Record 10-second walkthrough** saves a 1920×1080 WebM. Capture dimensions are independent of the Resolution control; output goes to `evidence/`.

## Files and editing

`src/` contains rendering, water, ecology, interaction and scroll materials. World coordinates use metres and Y-up; legacy ecology coordinates are converted at the boundary. `public/runtime/` contains scene data, SoA geometry, textures, navigation and rigs. `assets/` contains five runtime GLBs; `production/` contains native Blender scenes, manifests and authoring data.

`npm run build:assets` derives Auto geometry, SoA data and manifests from the current authoritative scene; set `BLENDER` to choose an executable. Explicit `-- --rebuild-scene` reconstructs layout and Blender sources from production inputs; preserve current scene edits before using that option. `evidence/` holds references, the existing 4K gallery and verification data; `backup/` holds source snapshots and archived experiments.

## Verification

Run `npm test`, then `npm run test:package` with the server running. Browser checks:

- `?verify=1`: 42 water, collision, interaction and GPU checks across three styles and ten views.
- `?opttest=1&mode=quality`: static cinema/auto comparison across three styles and views 1/3/8, plus a separate live-motion sampling/refresh probe. The compatibility URL `?perf=1` runs the same checks; its incompatible old refraction oracle is archived.
- Add `&full=1` to the quality page for thirty 4K static comparisons. Reports and images use unique timestamps to preserve earlier baselines.
- `?opttest=1`: roof batching, static transforms, outline skipping and paused rendering. `?lodtest=1`: geometry LOD comparison.
- `?profile=1`: six segments of CPU submission plus GPU completion wall time. Unprofiled time also includes GPU water updates/readback and is not CPU utilization.

The Auto/Cinema quality page reports pixel differences and checks GPU/motion behavior by default. Explicit `rmse` / `over8` parameters can still bound a selected comparison. This page does not establish visual or 30 fps acceptance. See [the current specification](PERF_QUALITY_SPEC.md); `npm run test:auto-assets` validates asset budgets and rig data.

See the [1080p implementation and acceptance record](evidence/auto-30fps-20260912.md) for the guardrail repair, measurements and remaining work.
