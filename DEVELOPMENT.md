# Development handoff

The repository root is the former `Qingming_Final` directory. Other scene versions, local rollback archives and exploratory captures are excluded from Git. Runtime geometry, textures, production inputs, Blender originals and bundled Three.js are included. Large GLB, Blender and compressed geometry files use Git LFS.

## Setup

Requires Node.js >=22.15, Git LFS and a browser with WebGL2. There are no npm runtime dependencies.

```sh
git lfs install
git lfs pull
npm test
npm start
```

With the server running, execute `npm run test:package` in a second terminal.

The preview listens on `127.0.0.1:4193`. For GMK development, forward that port from your Mac:

```sh
ssh -L 4193:127.0.0.1:4193 gmk
```

Run `npm start` in `/mnt/data/H5Games/qingming` on GMK, then visit `http://127.0.0.1:4193/` on the Mac. Nothing is exposed publicly.

## Asset generation

Blender and Python with NumPy are required to regenerate assets. Set `BLENDER` if Blender is not on PATH. `npm run build:assets` derives performance assets from the stored authoritative scene. The explicit `-- --rebuild-scene` path reconstructs the authoring scene and should be used only for that purpose. Commit runtime geometry, SoA and their manifests together after validation.

```sh
npm run test:auto-assets
blender --background --factory-startup --python-exit-code 1 --python tests/auto-structure.py
```

## Current status

Water styling, structural repairs and the 42 GPU checks passed on the Mac. Stable 30 fps and triangle budgets have **not** passed. Structural preservation currently keeps too much interior detail: main maximum 5.80M triangles; complete refresh maximum 24.77M. Next work: separate structural members from small decoration, bake middle/far detail, then measure native 1080p real-loop FPS/P95. Keep Hongqiao rails and architectural silhouettes intact.

See `PERF_QUALITY_SPEC.md` and `evidence/landmarks-switch-20260912.md`. Historical reports may link to captures excluded from Git; the current repair evidence is retained in `evidence/repairs-20260912`.
