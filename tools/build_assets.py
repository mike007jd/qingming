#!/usr/bin/env python3
"""Derive Auto assets from the current authoritative scene without resetting it."""
import os,subprocess,sys,shutil,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
blender=os.environ.get('BLENDER') or shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'
scripts=['build_auto_lods.py','build_auto_details.py']
if '--rebuild-scene' in sys.argv:
 # Explicit authoring rebuild restores the stored production inputs/layout.
 subprocess.run([sys.executable,str(root/'tools/refine_city.py')],check=True)
 scripts=['refine_figures.py','author_scene.py','build_lods.py',*scripts,'export_runtime.py','assemble_blend.py']
for name in scripts:
 subprocess.run([blender,'--background','--factory-startup','--python-exit-code','1','--python',str(root/'tools'/name),'--',str(root)],check=True)
manifest=root/'production/asset-manifest.json';report=json.loads(manifest.read_text());report['outputs']={p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in (root/'assets').glob('*.glb')};manifest.write_text(json.dumps(report,ensure_ascii=False,indent=2))
# Derive the SoA city chunks after the asset manifest so every build ships them together.
subprocess.run([sys.executable,str(root/'tools/pack_city_soa.py')],check=True)
