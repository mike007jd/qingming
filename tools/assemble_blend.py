"""Cold-import the portable deliverables into one editable Blender scene."""
import bpy,json,sys
from pathlib import Path
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for name in ['Qingming_Current_City.glb','Qingming_Details.glb']:bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets'/name))
old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/Qingming_Vessels.glb'));imported=set(bpy.data.objects)-old
m=json.loads((ROOT/'public/runtime/city.json').read_text());eco=json.loads((ROOT/'public/runtime/ecology.json').read_text());instances={i['name']:i for a in m['assets']for i in a['instances']}
for boat in eco['boats']:
 template=next((o for o in imported if o.name in [boat['type'],boat['type']+'__details']),None)
 if template is None:raise RuntimeError('Missing vessel '+boat['type'])
 ins=instances[boat['name']];a=ins['matrix'];matrix=Matrix([[a[c*4+r]for c in range(4)]for r in range(4)])
 if not template.name.endswith('__details'):
  points=[child.matrix_local@Vector(v) for child in template.children_recursive if child.type=='MESH' for v in child.bound_box];size=[max(v[i]for v in points)-min(v[i]for v in points)for i in range(3)];matrix=matrix@Matrix.Diagonal((boat['length']/size[0],boat['beam']/size[1],min(1,boat['height']/size[2]),1))
 root=bpy.data.objects.new(boat['name']+' / final outfitting',None);bpy.context.collection.objects.link(root);root.matrix_world=matrix
 for child in template.children_recursive:
  if child.type!='MESH':continue
  copy=child.copy();copy.data=child.data;bpy.context.collection.objects.link(copy);copy.parent=root;copy.matrix_local=child.matrix_local.copy()
for ob in list(imported):bpy.data.objects.remove(ob,do_unlink=True)
# A physical water preview surface; the persistent GPU simulator stays in the runnable source.
vs=[];fs=[]
import math
for x in range(-260,261,2):
 for side in [-1,1]:vs.append((x,3.4*math.sin(x/72)+side*14.17,.28))
for i in range(len(vs)//2-1):fs.append((i*2,i*2+1,i*2+3,i*2+2))
me=bpy.data.meshes.new('River mean surface');me.from_pydata(vs,[],fs);ob=bpy.data.objects.new('River / GPU simulation in src/three-water.js',me);bpy.context.collection.objects.link(ob);water=bpy.data.materials.new('River preview');water.diffuse_color=(.12,.19,.16,1);water.use_nodes=True;p=water.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.12,.19,.16,1);p.inputs['Roughness'].default_value=.12;p.inputs['Transmission Weight'].default_value=.7;p.inputs['IOR'].default_value=1.333;me.materials.append(water)
bpy.ops.file.pack_all();bpy.context.scene['runtime']='index.html / src/app.js';bpy.context.scene['skeleton_library']='public/runtime/rigs.json';bpy.context.scene['description']='Current live transforms, original detailed bind-pose geometry, rebuilt bridge, botanical crowns, working quays and six boat designs.'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'production/Qingming_Full_Scene.blend'))
report={'status':'passed','objects':len(bpy.context.scene.objects),'meshes':len([o for o in bpy.context.scene.objects if o.type=='MESH']),'packedImages':sum(bool(i.packed_file)for i in bpy.data.images),'nativeFile':'production/Qingming_Full_Scene.blend','note':'Bind-pose authoring scene; full skeletal clips and simulation remain editable in runtime JSON and JS.'}
(ROOT/'evidence').mkdir(parents=True,exist_ok=True)
(ROOT/'evidence/blender-import.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report),flush=True)
