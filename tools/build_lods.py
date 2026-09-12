"""Blender-native, repeatable LODs; keep every original mesh and image intact.
Run with Blender --background --factory-startup --python tools/build_lods.py.
"""
import bpy,json,math,struct,hashlib
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'assets/Qingming_Details.glb'
raw=source.read_bytes();document=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
names={m['name'] for m in document['meshes']}
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'production/Qingming_Master.blend'))
originals=[m for m in bpy.data.meshes if m.name in names and len(m.polygons)>128]
# A compact editable library, with the decimation modifiers left unapplied.
keepers=[]
for mesh in originals:
 if mesh.name.startswith(('Bridge_','Hongqiao')) or mesh.name.startswith('Boat_'):continue
 ob=bpy.data.objects.new('LOD source / '+mesh.name,mesh);bpy.context.collection.objects.link(ob);keepers.append(ob)
for ob in list(bpy.data.objects):
 if ob not in keepers:bpy.data.objects.remove(ob,do_unlink=True)

g={'asset':{'version':'2.0','generator':'Qingming Blender LOD library'},'scene':0,'scenes':[{'nodes':[]}],
   'nodes':[],'meshes':[],'accessors':[],'bufferViews':[],'buffers':[{}]}
data=bytearray();accessor_cache={};report={'sourceSha256':hashlib.sha256(raw).hexdigest(),'meshes':[]}
def acc(array,kind,component=5126):
 array=np.ascontiguousarray(array,dtype='<u4' if component==5125 else '<f4')
 payload=array.tobytes();key=(kind,component,hashlib.sha256(payload).digest())
 if key in accessor_cache:return accessor_cache[key]
 while len(data)%4:data.append(0)
 view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':array.nbytes});data.extend(payload)
 entry={'bufferView':view,'componentType':component,'count':len(array),'type':kind}
 if kind=='VEC3':entry.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
 g['accessors'].append(entry);accessor_cache[key]=len(g['accessors'])-1;return accessor_cache[key]
def surface(mesh):
 mesh.calc_loop_triangles()
 points=[v.co.copy() for v in mesh.vertices];triangles=[tuple(t.vertices) for t in mesh.loop_triangles]
 return points,triangles,BVHTree.FromPolygons(points,triangles,all_triangles=True)
def deviation(points,triangles,bvh):
 # Every vertex and triangle centroid, in both directions; a floor and 2x margin
 # in the viewer cover unsampled interior positions and interpolated shading.
 probes=points+[(points[a]+points[b]+points[c])/3 for a,b,c in triangles]
 return max((bvh.find_nearest(p)[3] for p in probes),default=0.)
def geometry(mesh):
 mesh.calc_loop_triangles();n=len(mesh.loops);vertices=np.empty((len(mesh.vertices),3),dtype='<f4');mesh.vertices.foreach_get('co',vertices.ravel())
 loops=np.empty(n,dtype='<i4');mesh.loops.foreach_get('vertex_index',loops)
 normals=np.empty((n,3),dtype='<f4');mesh.corner_normals.foreach_get('vector',normals.ravel())
 def yup(a):return a[:,[0,2,1]]*np.array([1,1,-1],dtype='<f4')
 arrays=[yup(vertices[loops]),yup(normals)];keys=[('POSITION',3,'VEC3'),('NORMAL',3,'VEC3')]
 if mesh.uv_layers:
  uv=np.empty((n,2),dtype='<f4');mesh.uv_layers.active.data.foreach_get('uv',uv.ravel());uv[:,1]=1-uv[:,1];arrays.append(uv);keys.append(('TEXCOORD_0',2,'VEC2'))
 color=mesh.color_attributes.active_color
 if color:
  colors=np.empty((len(color.data),4),dtype='<f4');color.data.foreach_get('color',colors.ravel());arrays.append(colors[loops] if color.domain=='POINT' else colors);keys.append(('COLOR_0',4,'VEC4'))
 unique,indices=np.unique(np.concatenate(arrays,axis=1),axis=0,return_inverse=True)
 faces=np.array([t.loops for t in mesh.loop_triangles]);attrs={};offset=0
 for name,width,kind in keys:attrs[name]=acc(unique[:,offset:offset+width],kind);offset+=width
 return {'attributes':attrs,'indices':acc(indices[faces].ravel(),'SCALAR',5125)}

for no,original in enumerate(keepers):
 src=original.data;points,triangles,bvh=surface(src);entry={'name':src.name,'triangles':[len(triangles)],'errors':[]}
 if len(triangles)<512:continue
 for level,ratio in [(1,.55),(2,.25)]:
  ob=bpy.data.objects.new(src.name+f' / LOD{level}',src);bpy.context.collection.objects.link(ob)
  if '/ leaf_' in src.name:
   # The authored leaf has four boundary vertices and one fold vertex.
   # Keep every boundary and its normals; replace four faces with two.
   assert len(points)%5==0 and len(triangles)==len(points)//5*4,src.name
   leaf=bpy.data.meshes.new(ob.name);leaf.from_pydata(points,[],[(i,i+1,i+2,i+3) for i in range(0,len(points),5)]);leaf.update()
   for p in leaf.polygons:p.use_smooth=True
   leaf.normals_split_custom_set_from_vertices([v.normal for v in src.vertices]);ob.data=leaf
  else:
   modifier=ob.modifiers.new('Distance detail reduction','DECIMATE')
   modifier.decimate_type='COLLAPSE';modifier.ratio=ratio;modifier.use_collapse_triangulate=True
  evaluated=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
  pp,tt,bb=surface(mesh)
  assert pp and tt and all(math.isfinite(c) for p in pp for c in p),src.name
  error=max(deviation(points,triangles,bb),deviation(pp,tt,bvh))
  primitive=geometry(mesh);extras={'sourceMesh':src.name,'level':level,'surfaceError':error}
  index=len(g['meshes']);g['meshes'].append({'name':ob.name,'primitives':[primitive]});node=len(g['nodes']);g['nodes'].append({'mesh':index,'name':ob.name,'extras':extras});g['scenes'][0]['nodes'].append(node)
  entry['triangles'].append(len(tt));entry['errors'].append(error);evaluated.to_mesh_clear();ob.hide_render=True
 report['meshes'].append(entry)
 if no%20==0:print('LOD',no,'/',len(keepers),src.name,entry['triangles'],flush=True)

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'production/Qingming_LOD.blend'))
g['buffers'][0]['byteLength']=len(data);js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
output=ROOT/'assets/Qingming_LOD.glb';output.write_bytes(struct.pack('<III',0x46546C67,2,28+len(js)+len(data))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(data),0x004E4942)+data)
report['bytes']=output.stat().st_size;report['sha256']=hashlib.sha256(output.read_bytes()).hexdigest()
(ROOT/'production/lod-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
manifest=ROOT/'production/asset-manifest.json';assets=json.loads(manifest.read_text());assets['outputs'][output.name]=report['sha256'];manifest.write_text(json.dumps(assets,ensure_ascii=False,indent=2))
print('LOD_BUILD_COMPLETE',len(report['meshes']),report['bytes'],flush=True)
