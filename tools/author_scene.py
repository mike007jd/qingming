"""Deterministic reference-directed geometry. Blender authoring is Z-up metres.
Sources: 1.3 live transforms; v0.7 final GLB bridge and two complete vessel designs.
New geometry: botanical crowns, trade-specific dressing, awnings, roof trim, masonry.
"""
import bpy,sys,json,struct,math,random,array,hashlib,gzip
from pathlib import Path
from collections import defaultdict
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
import numpy as np
ROOT=Path(sys.argv[sys.argv.index('--')+1]);SOURCE=ROOT.parent
rng=random.Random(260911)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mat={}
def material(name,color,rough=.85):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 m.use_backface_culling=False
 m['surface']='wood' if 'wood' in name or 'bark' in name else 'fabric' if 'linen' in name else 'stone' if 'stone' in name else 'tile' if 'tile' in name else 'none';mat[name]=m;return m
for name,col in [('wood',(.24,.145,.070)),('wood_light',(.38,.25,.12)),('bark',(.15,.12,.065)),('rope',(.43,.34,.19)),('stone',(.33,.32,.255)),('tile',(.115,.14,.115)),('linen',(.70,.60,.40)),('red_linen',(.30,.105,.064)),('blue_linen',(.075,.15,.18)),('green_linen',(.16,.22,.12)),('jade',(.16,.28,.23)),('clay',(.28,.12,.062)),('iron',(.06,.065,.051)),('leaf_dark',(.095,.16,.036)),('leaf_mid',(.20,.27,.063)),('leaf_light',(.33,.37,.10)),('fruit',(.53,.25,.053)),('ivory',(.65,.55,.37))]:material(name,col)

class Mesh:
 def __init__(self,name):self.name=name;self.v=defaultdict(list);self.f=defaultdict(list)
 def add(self,vertices,faces,m):
  n=len(self.v[m]);self.v[m].extend([tuple(v) for v in vertices]);self.f[m].extend([tuple(n+i for i in f) for f in faces])
 def box(self,p,size,m='wood',angle=0):
  x,y,z=p;a,b,c=[q*.5 for q in size];cs,sn=math.cos(angle),math.sin(angle)
  vs=[(x+dx*cs-dy*sn,y+dx*sn+dy*cs,z+dz) for dx,dy,dz in [(-a,-b,-c),(a,-b,-c),(a,b,-c),(-a,b,-c),(-a,-b,c),(a,-b,c),(a,b,c),(-a,b,c)]]
  self.add(vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],m)
 def tube(self,pts,r,m='rope',sides=8):
  pts=[Vector(p) for p in pts];vs=[]
  for i,p in enumerate(pts):
   direction=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized();u=direction.cross(Vector((.07,.03,1)))
   if u.length<.01:u=direction.cross(Vector((0,1,0)))
   u.normalize();v=direction.cross(u).normalized();rr=r[i] if isinstance(r,list) else r
   vs.extend([p+(u*math.cos(k*math.tau/sides)+v*math.sin(k*math.tau/sides))*float(rr) for k in range(sides)])
  faces=[tuple(range(sides-1,-1,-1))]
  for i in range(len(pts)-1):
   for k in range(sides):a=i*sides+k;b=i*sides+(k+1)%sides;faces.append((a,b,b+sides,a+sides))
  faces.append(tuple((len(pts)-1)*sides+k for k in range(sides)));self.add(vs,faces,m)
 def lathe(self,p,profile,m='clay',sides=24):
  x,y,z=p;vs=[(x+r*math.cos(k*math.tau/sides),y+r*math.sin(k*math.tau/sides),z+h) for r,h in profile for k in range(sides)]
  fs=[]
  for j in range(len(profile)-1):
   for k in range(sides):a=j*sides+k;b=j*sides+(k+1)%sides;fs.append((a,b,b+sides,a+sides))
  self.add(vs,fs,m)
 def leaf(self,p,d,width,m):
  p=Vector(p);d=Vector(d);u=d.cross(Vector((.13,.4,1))).normalized()*width;mid=p+d*.47
  self.add([p,mid-u,p+d,mid+u,mid+Vector((0,0,.018))],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],m)
 def finish(self,parent=None):
  objs=[]
  for mn,vs in self.v.items():
   me=bpy.data.meshes.new(self.name+' / '+mn);me.from_pydata(vs,[],self.f[mn]);me.materials.append(mat[mn]);me.update();ob=bpy.data.objects.new(self.name+' / '+mn,me);bpy.context.collection.objects.link(ob);ob.parent=parent
   for poly in me.polygons:poly.use_smooth=mn in ['rope','leaf_dark','leaf_mid','leaf_light','bark','clay','jade']
   objs.append(ob)
  return objs

def empty(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o

def duplicate(prototype,name,matrix):
 parent=empty(name);parent.matrix_world=matrix
 for src in prototype:
  ob=bpy.data.objects.new(name+' / '+src.data.name,src.data);bpy.context.collection.objects.link(ob);ob.parent=parent
 return parent

def matrix(values):return Matrix(np.array(values).reshape(4,4,order='F').tolist())
def transform(p,m):return m@Vector(p)
manifest=json.loads((ROOT/'public/runtime/city.json').read_text())

# Individual overlapping clay tiles fitted to the actual final roof geometry.
# The source roof remains the weathered underlay; all additions share its instance matrix.
for name,color in [('tile_mid',(.115,.133,.128)),('tile_light',(.138,.153,.143)),('tile_dark',(.092,.112,.111))]:material(name,color)
packed=gzip.decompress((ROOT/'public/runtime/city.bin.gz').read_bytes())
positions=np.ndarray((manifest['vertexCount'],3),dtype='<f4',buffer=packed,strides=(44,4))
source_uv=np.ndarray((manifest['vertexCount'],2),dtype='<f4',buffer=packed,offset=20,strides=(44,4))
source_colors=np.ndarray((manifest['vertexCount'],4),dtype='u1',buffer=packed,offset=28,strides=(44,1))
indices=np.frombuffer(packed,dtype='<u4',count=manifest['indexCount'],offset=manifest['indexByteOffset'])
roof_spec=next(m for m in manifest['materials']if m.get('extras',{}).get('surface')=='tile')
for name in ['tile_mid','tile_light','tile_dark']:
 material=mat[name];nodes=material.node_tree.nodes;links=material.node_tree.links;shader=nodes.get('Principled BSDF');shader.inputs['Roughness'].default_value=1
 texture=nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(ROOT/'public/runtime'/manifest['images'][manifest['textures'][roof_spec['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]),check_existing=True)
 color=nodes.new('ShaderNodeVertexColor');color.layer_name='Color';multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;links.new(texture.outputs['Color'],multiply.inputs[1]);links.new(color.outputs['Color'],multiply.inputs[2]);links.new(multiply.outputs['Color'],shader.inputs['Base Color'])
tile_count=0
for a in manifest['assets']:
 if not a['name'].startswith(('House_','Shop_')):continue
 draws=[manifest['draws'][d] for d in a['draws'] if manifest['materials'][manifest['draws'][d]['material']].get('extras',{}).get('surface')=='tile']
 if not draws:continue
 triangles=np.concatenate([indices[d['indexOffset']//4:d['indexOffset']//4+d['count']]for d in draws]).reshape(-1,3)
 used,local=np.unique(triangles,return_inverse=True);roof=positions[used];bvh=BVHTree.FromPolygons(roof.tolist(),local.reshape(-1,3).tolist(),all_triangles=True)
 tile_rng=random.Random(791+sum(map(ord,a['name'])));M=Mesh('Overlapping clay tiles '+a['name']);tile_uvs=defaultdict(list);tile_colors=defaultdict(list);top=float(roof[:,2].max()+1);down=Vector((0,0,-1));roof_min=roof[:,:2].min(axis=0);roof_max=roof[:,:2].max(axis=0)
 for row,y in enumerate(np.arange(roof_min[1]+.20,roof_max[1]-.20,.32)):
  for col,x in enumerate(np.arange(roof_min[0]+.17,roof_max[0]-.17,.31)):
   center,normal,_,_=bvh.ray_cast(Vector((float(x),float(y),top)),down)
   if center is None or normal.z<.38:continue
   vs=[];uvs=[];colors=[];fitted=True
   for side in [-1,1]:
    for q in np.linspace(-.5,.5,5):
     px=float(x+q*.305);py=float(y+side*.168);hit,n,face,_=bvh.ray_cast(Vector((px,py,top)),down)
     if hit is None or n.z<.35:break
     lip=.021 if side*(1 if y>=0 else -1)>0 else .004
     vs.append((px,py,hit.z+lip))
     ids=triangles[face];t=positions[ids].astype(float);v0=t[1]-t[0];v1=t[2]-t[0];v2=np.array(hit)-t[0];d00=v0@v0;d01=v0@v1;d11=v1@v1;d20=v2@v0;d21=v2@v1;den=d00*d11-d01*d01
     if abs(den)<1e-12:fitted=False;break
     b=(d11*d20-d01*d21)/den;c=(d00*d21-d01*d20)/den;weights=np.clip([1-b-c,b,c],0,1);weights/=weights.sum();uv=weights@source_uv[ids];uvs.append((uv[0],1-uv[1]));colors.append((weights@source_colors[ids]/255)*np.array([.74,.74,.74,1]))
    if len(vs)%5:break
   if not fitted or len(vs)!=10 or max(p[2]for p in vs)-min(p[2]for p in vs)>.26:continue
   if any(abs(vs[j+i+1][2]-vs[j+i][2])>.10 for j in [0,5]for i in range(4)):continue
   # Narrow edge faces give the clay a readable thickness, including with ink disabled.
   faces=[(i,i+1,i+6,i+5)for i in range(4)]
   for edge in [(0,1,2,3,4),(5,6,7,8,9)]:
    base=len(vs);vs.extend([(vs[i][0],vs[i][1],vs[i][2]-.014)for i in edge])
    uvs.extend([uvs[i]for i in edge]);colors.extend([colors[i]for i in edge])
    faces.extend([(edge[i],base+i,base+i+1,edge[i+1])for i in range(4)])
   mn=tile_rng.choice(['tile_mid']*8+['tile_light','tile_dark']);M.add(vs,faces,mn);tile_uvs[mn].extend(uvs);tile_colors[mn].extend(colors);tile_count+=1
 prototype=M.finish()
 for ob in prototype:
  me=ob.data;mn=me.materials[0].name;uv=me.uv_layers.new();loopverts=np.empty(len(me.loops),dtype=np.int32);me.loops.foreach_get('vertex_index',loopverts);uv.data.foreach_set('uv',np.array(tile_uvs[mn])[loopverts].ravel());color=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT');color.data.foreach_set('color',np.array(tile_colors[mn]).ravel())
  for poly in ob.data.polygons:poly.use_smooth=True
 for ins in a['instances']:duplicate(prototype,'Roof tile courses / '+ins['name'],matrix(ins['matrix']))
 for ob in prototype:bpy.data.objects.remove(ob,do_unlink=True)
del packed,positions,indices,source_uv,source_colors
print(f'Fitted {tile_count} individual clay tiles to current roof prefabs',flush=True)

# Build four crown shapes; densely layered, distinct leaves with real branch structure.
prototypes=[]
for typ in range(6):
 rr=random.Random(470+typ);M=Mesh('Willow' if typ<3 else 'Broadleaf');willow=typ<3;H=7.3+typ*.23
 M.tube([(0,0,0),(.12,.05,1.6),(.30,-.10,3.3),(.14,-.1,5.4),(.45,.10,H)],[.30,.25,.18,.1,.018],'bark',12)
 for k in range(19):
  a=k*2.39996+rr.uniform(-.2,.2);r=rr.uniform(2.5,4.2);start=Vector((.1,0,H*(.34+.03*k)));tip=Vector((math.cos(a)*r,math.sin(a)*r,H*(.67+.018*k)));mid=start.lerp(tip,.55)+Vector((0,0,.65));M.tube([start,mid,tip],[.10,.055,.01],'bark',8)
  for j in range(22):
   t=(j+.5)/22;b=mid.lerp(tip,t);az=a+rr.uniform(-1.4,1.4);drop=rr.uniform(1.7,3.8) if willow else rr.uniform(-1.4,.3);l=rr.uniform(.3,1.5)
   pts=[b+Vector((math.cos(az)*l*q,math.sin(az)*l*q,.16*math.sin(q*math.pi)-drop*q*q)) for q in np.linspace(0,1,9)];M.tube(pts,[.012*(1-q)+.001 for q in np.linspace(0,1,9)],'bark',5)
   for n in range(26):
    q=(n+.4)/26;p=b+Vector((math.cos(az)*l*q,math.sin(az)*l*q,.16*math.sin(q*math.pi)-drop*q*q))
    for side in [-1,1]:
     aa=az+side*(1.0+rr.random());length=rr.uniform(.17,.28) if willow else rr.uniform(.17,.3)
     M.leaf(p,(math.cos(aa)*length,math.sin(aa)*length,-length*.55 if willow else rr.uniform(-.04,.1)),.035 if willow else .082,['leaf_dark','leaf_mid','leaf_light'][rr.randrange(3)])
 prot=M.finish();prototypes.append(prot)
# Replace existing trees at the same world transforms, keeping trunk collision placement.
for a in manifest['assets']:
 if not a['name'].startswith(('Willow_','Broadleaf_')):continue
 for ins in a['instances']:
  typ=rng.randrange(3)+(0 if a['name'].startswith('Willow') else 3)
  duplicate(prototypes[typ],'Tree / '+ins['name'],matrix(ins['matrix']))
# Waterside crowns alternating with the existing docks; trunks outside traversable path.
for side in [-1,1]:
 for x in [-112,-92,-57,-12,19,45,87,110]:
  y=3.4*math.sin(x/72)+side*21.5
  m=Matrix.Translation((x,y,2.2))@Matrix.Rotation(rng.random()*math.tau,4,'Z')@Matrix.Diagonal((1.,1.,1.05,1.))
  duplicate(prototypes[rng.randrange(3)],'Riverside willow',m)
for prot in prototypes:
 for o in prot:bpy.data.objects.remove(o,do_unlink=True)
print('Botanical crowns built',flush=True)

# Workbench props, each with geometry of its construction.
def basket(M,p,r=.27,h=.45):
 x,y,z=p;M.lathe(p,[(r*.65,0),(r,.12),(r*.95,h),(r*.84,h+.018),(r*.80,.12)],'rope',20)
 for j in range(9):
  zz=h*j/9;rad=r*(.7+.3*math.sin(min(1,zz/.12)*math.pi/2));M.tube([(x+rad*math.cos(t),y+rad*math.sin(t),z+zz) for t in np.linspace(0,math.tau,33)],.008,'wood_light',5)
 for k in range(16):
  a=k*math.tau/16;M.tube([(x+r*.68*math.cos(a),y+r*.68*math.sin(a),z),(x+r*math.cos(a),y+r*math.sin(a),z+.12),(x+r*.95*math.cos(a),y+r*.95*math.sin(a),z+h)],.008,'wood_light',5)
def jar(M,p,r=.25,h=.55):M.lathe(p,[(r*.52,0),(r*.83,.05),(r,h*.42),(r*.8,h*.76),(r*.53,h*.9),(r*.57,h),(r*.43,h),(r*.43,h*.84)],'jade' if rng.random()<.35 else 'clay',24)
def crate(M,p,size=.60):
 x,y,z=p
 for k in range(5):
  for side in [-1,1]:M.box((x,y+side*size*.48,z+size*(k+.5)/5),(size,.035,size*.17),'wood_light')
  M.box((x+size*(k/4-.5),y,z+.018),(.10,size,.035),'wood')
 for a in [-1,1]:
  for b in [-1,1]:M.box((x+a*size*.46,y+b*size*.46,z+size*.5),(.045,.045,size),'wood')
def bundle(M,p):
 x,y,z=p;M.box((x,y,z+.22),(.72,.48,.44),'linen')
 for xx in [-.24,.24]:M.tube([(x+xx,y-.245,z+.03),(x+xx,y-.25,z+.45),(x+xx,y+.25,z+.45),(x+xx,y+.25,z+.03)],.013,'rope',7)
def cloth(M,p,w,d):
 x,y,z=p;vs=[];nx,ny=16,12
 for j in range(ny+1):
  for i in range(nx+1):
   u=i/nx;v=j/ny;vs.append((x+(u-.5)*w,y+v*d,z-.35*v-.12*math.sin(u*math.pi)-.075*math.sin(u*18)*v))
 fs=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(ny) for i in range(nx)]
 M.add(vs,fs,'linen')
def trade(M,x,y,z,kind):
 M.box((x,y,z+.72),(1.5,.72,.065),'wood_light')
 for xx in [-.62,.62]:
  for yy in [-.26,.26]:M.box((x+xx,y+yy,z+.36),(.07,.07,.72),'wood')
 if kind%5==0:
  for i in range(5):jar(M,(x-.53+i*.25,y,z+.76),.085,.16)
 elif kind%5==1:
  for i in range(3):basket(M,(x-.50+i*.49,y,z+.77),.18,.12)
  for i in range(18):
   px=x+rng.uniform(-.65,.65);py=y+rng.uniform(-.22,.22);M.lathe((px,py,z+.90),[(0,0),(.055,.02),(.07,.07),(.035,.115),(0,.12)],'fruit',10)
 elif kind%5==2:
  for i in range(6):M.box((x-.57+i*.23,y,z+.80+i%3*.026),(.22,.63,.09),['blue_linen','red_linen','green_linen'][i%3])
 elif kind%5==3:
  for i in range(4):jar(M,(x-.56+i*.36,y,z+.76),.11,.29)
 else:
  for i in range(4):basket(M,(x-.50+i*.32,y,z+.77),.13,.19)

# Market corner dressing is attached to each existing shop transform; central doorway stays clear.
for ai,a in enumerate(manifest['assets']):
 if not a['name'].startswith('Shop_'):continue
 model=Mesh('Shop joinery and trade '+a['name']);w=(a['bounds'][1][0]-.6)*2;front=a['bounds'][0][1]+1.0
 for x in [-w*.36,w*.36]:
  for level in [2.75,5.65]:
   model.box((x,front+.60,level),(.45,.20,.12),'wood_light');model.box((x,front+.56,level+.12),(.7,.22,.09),'wood');model.box((x,front+.6,level+.22),(.95,.25,.075),'wood_light')
 for x in [-w*.32,w*.32]:
  trade(model,x,front-.12,.15,ai);crate(model,(x,front+.6,.05),.58);jar(model,(x+.37,front+.69,.05),.22,.48)
 # Texture-independent carpentry grooves and worn iron rings on columns.
 for x in [-w*.42,w*.42]:
  for k in range(3):model.lathe((x,front+.8,.18+k*.1),[(.10,0),(.10,.018)],'iron',16)
 for ins in a['instances']:
  if not ins['name'].startswith(('Riverfront','Mainstreet')):continue
  parent=empty('Trade detail / '+ins['name']);parent.matrix_world=matrix(ins['matrix']);model.finish(parent)
print('Trade and joinery built',flush=True)

for a in manifest['assets']:
 if a['name']!='Timber_dock_with_crane':continue
 for ins in a['instances']:
  M=Mesh('Dock cargo / '+ins['name']);m=matrix(ins['matrix'])
  for j in range(6):
   x=(-1 if j%2 else 1)*1.45;y=[-2.55,-.25,.55][j//2]
   if j%3==0:crate(M,(x,y,1.845),.62)
   elif j%3==1:bundle(M,(x,y,1.845))
   else:basket(M,(x,y,1.845),.29,.45)
  for x in [-1.85,1.85]:
   for y in [-3.4,3.4]:
    for k in range(3):M.tube([(x+.14*math.cos(t),y+.14*math.sin(t),2.27+k*.032) for t in np.linspace(0,math.tau,33)],.017,'rope',6)
  par=empty('Dock dressing');par.matrix_world=m;M.finish(par)

# Back streets: individual drainage stones, wall-side planting and household work stations.
M=Mesh('Lanes and riverbank details')
for side in [-1,1]:
 for x in range(-115,116,3):
  y=3.4*math.sin(x/72)+side*18.6
  if abs(x)<8:continue
  for k in range(5):
   xx=x+k*.54;M.box((xx,y,2.24),(.51,.25,.095),'stone',rng.uniform(-.03,.03))
 for x in [-90,-64,-31,29,61,91]:
  y=side*24.4+3.4*math.sin(x/72);jar(M,(x,y,2.2),.35,.7);basket(M,(x+.65,y,2.2),.3,.48)
M.finish()

# Lived-in courtyard gardens, drying cloth and household work, fitted to the existing enclosure.
for a in manifest['assets']:
 if a['name']!='Courtyard_walls_gate_well_and_household_props':continue
 for no,ins in enumerate(a['instances']):
  M=Mesh('Courtyard garden and household / '+ins['name']);par=empty('Courtyard garden / '+ins['name']);par.matrix_world=matrix(ins['matrix'])
  for x in [-6.,-3.6]:M.tube([(x,-6.6,.02),(x,-6.6,2.15)],.042,'wood',10)
  M.tube([(-6.,-6.6,2.04),(-4.8,-6.6,1.98),(-3.6,-6.6,2.04)],.012,'rope',6)
  for k in range(3):
   x=-5.6+k*.75;vs=[]
   for row in range(17):
    v=row/16
    for col in range(13):
     u=col/12;vs.append((x+(u-.5)*.63,-6.6+.035*math.sin(u*25+v*2),1.97-v*(1.05+.17*(k%2))-.025*math.sin(u*math.pi)))
   fs=[(r*13+c,r*13+c+1,(r+1)*13+c+1,(r+1)*13+c)for r in range(16)for c in range(12)]
   M.add(vs,fs,['linen','blue_linen','green_linen'][k]);M.box((x,-6.6,2.005),(.045,.06,.11),'wood_light')
  for j in range(3):
   px=6.45;py=-6.4+j*1.17;jar(M,(px,py,.02),.30,.46)
   for stalk in range(7):
    angle=stalk*2.4;dx=math.cos(angle)*.13;dy=math.sin(angle)*.13;h=1.45+rng.random()*.85
    M.tube([(px+dx,py+dy,.38),(px+dx*1.6,py+dy*1.6,h)],.015,'green_linen',8)
    for tier in range(5):
     z=.65+tier*(h-.7)/5;a1=angle+tier*.9;tip=Vector((px+dx+math.cos(a1)*.38,py+dy+math.sin(a1)*.38,z+.20));M.tube([(px+dx,py+dy,z),tip],.008,'green_linen',5)
     for leaf in range(8):
      aa=a1+(-1 if leaf%2 else 1)*.9;lp=Vector((px+dx,py+dy,z)).lerp(tip,leaf/9);M.leaf(lp,(math.cos(aa)*.24,math.sin(aa)*.24,-.06),.025,['leaf_dark','leaf_mid','leaf_light'][leaf%3])
  M.box((-4.9,-3.8,.49),(1.2,.7,.08),'wood_light')
  for xx in [-.48,.48]:
   for yy in [-.24,.24]:M.box((-4.9+xx,-3.8+yy,.24),(.065,.065,.48),'wood')
  for k in range(3):jar(M,(-5.22+k*.3,-3.8,.54),.08,.13)
  basket(M,(-5.6,-3.8,.03),.24,.33);basket(M,(-4.,-3.8,.03),.28,.22)
  M.finish(par)

# Import preserved v0.7 assets directly from the final GLB accessors.
source=ROOT/'production/inputs/v07-final.glb'
raw=source.read_bytes();n=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+n]);off=20+n;bl=raw[off+8:]
size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16};dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2'}
def accessor(index):
 a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];start=v.get('byteOffset',0)+a.get('byteOffset',0);dt=np.dtype(dtype[a['componentType']]);stride=v.get('byteStride',size[a['type']]*dt.itemsize)
 return np.ndarray((a['count'],size[a['type']]),dt,bl,start,strides=(stride,dt.itemsize)).copy()
source_mats={}
def imported_mat(i):
 if i in source_mats:return source_mats[i]
 d=g['materials'][i];p=d.get('pbrMetallicRoughness',{});m=bpy.data.materials.new('v07 / '+d['name']);m.use_nodes=True;shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=p.get('baseColorFactor',[1,1,1,1]);shader.inputs['Roughness'].default_value=p.get('roughnessFactor',.85)
 tex=p.get('baseColorTexture',{}).get('index')
 if tex is not None:
  im=g['images'][g['textures'][tex]['source']];v=g['bufferViews'][im['bufferView']];imagepath=ROOT/'production'/('v07_tex_'+str(tex)+('.png' if im['mimeType']=='image/png' else '.jpg'));imagepath.write_bytes(bl[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);image=bpy.data.images.load(str(imagepath),check_existing=True);node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
 normal_tex=d.get('normalTexture',{}).get('index')
 if normal_tex is not None:
  im=g['images'][g['textures'][normal_tex]['source']];v=g['bufferViews'][im['bufferView']];imagepath=ROOT/'production'/('v07_normal_'+str(normal_tex)+('.png' if im['mimeType']=='image/png' else '.jpg'));imagepath.write_bytes(bl[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);image=bpy.data.images.load(str(imagepath),check_existing=True);image.colorspace_settings.name='Non-Color';node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=d.get('normalTexture',{}).get('scale',.65);m.node_tree.links.new(node.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal'])
 color=m.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='Color';multiply=m.node_tree.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
 if shader.inputs['Base Color'].is_linked:m.node_tree.links.new(shader.inputs['Base Color'].links[0].from_socket,multiply.inputs[1])
 else:multiply.inputs[1].default_value=shader.inputs['Base Color'].default_value
 m.node_tree.links.new(color.outputs['Color'],multiply.inputs[2]);m.node_tree.links.new(multiply.outputs['Color'],shader.inputs['Base Color'])
 source_mats[i]=m;return m

def import_mesh(k,parent,bridge=False):
 for j,p in enumerate(g['meshes'][k]['primitives']):
  verts=accessor(p['attributes']['POSITION']);inds=accessor(p['indices']).reshape(-1,3)
  if bridge:
   zz=verts[:,2].copy();old_deck=3.7+5.3*(1-(zz/17)**2);new_deck=2.32+5.5*(1-(zz/17)**2)
   if k==41:verts[:,1]+=new_deck-old_deck-.07
   else:verts[:,1]*=2.32/3.7
   verts[:,0]*=3.79/3.2;verts[:,2]*=18.5/17
  points=np.stack([verts[:,0],-verts[:,2],verts[:,1]],axis=1)
  me=bpy.data.meshes.new(g['meshes'][k]['name']);me.from_pydata(points.tolist(),[],inds.tolist());me.materials.append(imported_mat(p['material']));me.update()
  if 'COLOR_0' in p['attributes']:
   colors=accessor(p['attributes']['COLOR_0']);
   if colors.dtype.kind!='f':colors=colors/np.iinfo(colors.dtype).max
   if colors.shape[1]==3:colors=np.column_stack([colors,np.ones(len(colors))])
   ca=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT');ca.data.foreach_set('color',colors.ravel())
  if 'NORMAL' in p['attributes']:
   normals=accessor(p['attributes']['NORMAL'])
   if bridge:
    normals[:,0]/=3.79/3.2
    if k==41:normals[:,2]=(normals[:,2]+.4*zz/289*normals[:,1])/(18.5/17)
    else:normals[:,1]/=2.32/3.7;normals[:,2]/=18.5/17
    normals/=np.linalg.norm(normals,axis=1,keepdims=True)
   normals=np.stack([normals[:,0],-normals[:,2],normals[:,1]],axis=1);me.normals_split_custom_set_from_vertices(normals.tolist())
  if 'TEXCOORD_0' in p['attributes']:
   uv=accessor(p['attributes']['TEXCOORD_0']);layer=me.uv_layers.new();loopverts=np.empty(len(me.loops),dtype=np.int32);me.loops.foreach_get('vertex_index',loopverts);uv=uv[loopverts];uv[:,1]=1-uv[:,1];layer.data.foreach_set('uv',uv.ravel())
  ob=bpy.data.objects.new(g['meshes'][k]['name']+f' / {j}',me);bpy.context.collection.objects.link(ob);ob.parent=parent;ob['source_mesh']=k
bridge=empty('Hongqiao / v07 timber and masonry fitted to walkable deck');import_mesh(41,bridge,True);import_mesh(42,bridge,True)
print('Preserved bridge imported and fitted',flush=True)

# Save native authoring file and portable static additions.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'production/Qingming_Master.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/Qingming_Details.glb'),export_format='GLB',export_extras=True,export_animations=False,export_vertex_color='ACTIVE')
# Vessel library: keep the two recovered designs separate for their shared dynamic transform.
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for name,ids in [('Cargo_barge',[84,85,86]),('Trading_sailboat',[87,88,89])]:
 par=empty(name)
 for k in ids:import_mesh(k,par)
for name in ['Fishing_rowboat','Ferry','Covered_passenger_boat','Courier_skiff']:
 M=Mesh(name+' outfitting');par=empty(name+'__details')
 if name=='Fishing_rowboat':
  basket(M,(-.5,0,.68),.34,.48);basket(M,(.5,.10,.68),.27,.3)
  for row in range(13):
   y=-.55+row*.075;M.tube([(x,y,.84+.035*math.sin(x*8+y*3)) for x in np.linspace(-1.6,-.3,22)],.006,'rope',4)
  for col in range(20):
   x=-1.6+col*.068;M.tube([(x,y,.84+.035*math.sin(x*8+y*3)) for y in np.linspace(-.55,.35,13)],.006,'rope',4)
 elif name=='Ferry':
  for x in [-1.4,1.4]:M.box((x,0,.93),(.32,1.35,.065),'wood_light')
  for x in [-1.8,1.8]:bundle(M,(x,.1,.72))
 elif name=='Covered_passenger_boat':
  for x in [-1.9,1.9]:
   for y in [-.85,.85]:M.lathe((x,y,1.15),[(.06,0),(.11,.06),(.11,.18),(.06,.24)],'ivory',18)
  jar(M,(0,.55,.84),.14,.25)
 else:crate(M,(-.9,0,.55),.44);bundle(M,(.8,0,.55))
 M.finish(par)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'production/Qingming_Vessels.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/Qingming_Vessels.glb'),export_format='GLB',export_extras=True,export_animations=False,export_vertex_color='ACTIVE')
report={'seed':260911,'roofTilesPerLibrary':tile_count,'blender':bpy.app.version_string,'source':str(source),'sourceSha256':hashlib.sha256(raw).hexdigest(),'bridge':'v07 final mesh 41 and 42, camber fitted to 1.3 navigation','trees':'Six authored dense branch/leaf prototypes; original trunk transforms','runtime':'1.3 current runtime with synchronized layout and weighted figure refinements','outputs':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'assets').glob('*.glb')},'visualAcceptance':'Regenerate screenshots and review the scene after asset edits'}
(ROOT/'production/asset-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('ASSET_BUILD_COMPLETE',flush=True)
