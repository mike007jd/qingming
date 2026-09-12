"""Three Auto detail tiers; original GLBs/Blender sources remain the Cinema path."""
import bpy, bmesh, json, struct, hashlib, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_auto_lods import simplify,project,INTERLEAVED,atomic_write
raw=(ROOT/'assets/Qingming_Details.glb').read_bytes();length=struct.unpack_from('<I',raw,12)[0];src=json.loads(raw[20:20+length]);blob=raw[28+length:]
def read(i):
    a=src['accessors'][i];v=src['bufferViews'][a['bufferView']];dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    ar=np.frombuffer(blob,dtype=dt,count=a['count']*n,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],n)
    if a.get('normalized'):ar=ar/np.iinfo(dt).max
    return ar

g={'asset':{'version':'2.0','generator':'Qingming Auto detail budgets'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'accessors':[],'bufferViews':[],'buffers':[{}]};data=bytearray()
def block(payload):
    data.extend(b'\0'*((-len(data))%4));i=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':len(payload)});data.extend(payload);return i

def acc(ar,kind):
    ar=np.ascontiguousarray(ar,dtype='<u4' if kind=='SCALAR' else '<f4');d={'bufferView':block(ar.tobytes()),'componentType':5125 if kind=='SCALAR' else 5126,'count':len(ar),'type':kind}
    if kind=='VEC3':d.update(min=ar.min(0).tolist(),max=ar.max(0).tolist())
    i=len(g['accessors']);g['accessors'].append(d);return i

# Bake the authored leaves' projected silhouette into one reusable cluster card.
leaf_mesh=next(m for m in src['meshes'] if '/ leaf_mid' in m['name']);prim=leaf_mesh['primitives'][0];lp=read(prim['attributes']['POSITION']);lt=read(prim['indices']).reshape(-1,3)
size=512;mask=np.zeros((size,size,4),dtype=np.float32);mask[:,:,:3]=1
axes=np.argsort(np.ptp(lp,axis=0))[-2:];xy=lp[:,axes];xy=(xy-xy.min(0))/(np.ptp(xy,axis=0)+1e-9)*(size-8)+4
for tri in xy[lt]:
    lo=np.maximum(0,np.floor(tri.min(0)).astype(int));hi=np.minimum(size-1,np.ceil(tri.max(0)).astype(int))
    x,y=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1));a,b,c=tri;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(den)<1e-8:continue
    u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
    mask[lo[1]:hi[1]+1,lo[0]:hi[0]+1,3]=np.maximum(mask[lo[1]:hi[1]+1,lo[0]:hi[0]+1,3],((u>=0)&(v>=0)&(u+v<=1)).astype(float))
# Preserve canopy coverage when the original thin leaves are minified into a card.
alpha=mask[:,:,3].copy()
for y in [-1,0,1]:
    for x in [-1,0,1]:mask[:,:,3]=np.maximum(mask[:,:,3],np.roll(np.roll(alpha,x,axis=1),y,axis=0))
img=bpy.data.images.new('Authored leaf silhouette atlas',width=size,height=size,alpha=True);img.pixels.foreach_set(mask.ravel());img.filepath_raw='/tmp/qingming-leaf-atlas.png';img.file_format='PNG';img.save()
g['images']=[{'bufferView':block(Path(img.filepath_raw).read_bytes()),'mimeType':'image/png'}];g['textures']=[{'source':0}];g['materials']=[{'name':'Auto baked leaf clusters','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'roughnessFactor':.9,'metallicFactor':0},'alphaMode':'MASK','alphaCutoff':.12,'doubleSided':True}]

def cards(p,budget):
    max_cells=max(1,budget//4);step=max(np.ptp(p,axis=0))/max_cells**(1/3)*.5
    for _ in range(50):
        keys,inverse=np.unique(np.floor((p-p.min(0))/step),axis=0,return_inverse=True)
        if len(keys)<=max_cells:break
        step*=1.12
    out=[];normals=[];uv=[];tris=[]
    for i in range(len(keys)):
        points=p[inverse==i];lo=points.min(0);hi=points.max(0);c=(lo+hi)/2;extent=np.maximum((hi-lo)*.58,.06)
        for axis in [0,2]:
            right=np.array([extent[0],0,0]) if axis==0 else np.array([0,0,extent[2]]);up=np.array([0,extent[1],0]);start=len(out)
            out.extend([c-right-up,c+right-up,c+right+up,c-right+up]);normal=[0,0,1] if axis==0 else [1,0,0];normals.extend([normal]*4);uv.extend([[0,0],[1,0],[1,1],[0,1]]);tris.extend([[start,start+1,start+2],[start,start+2,start+3]])
    return np.array(out),np.array(normals),np.array(uv),np.array(tris)
report={'sourceSha256':hashlib.sha256(raw).hexdigest(),'meshes':[],'treeBudgets':[8000,2000,300]}
def roof_envelope(name):
    prefix=name.rsplit(' / ',1)[0]+' / '
    points=np.concatenate([read(m['primitives'][0]['attributes']['POSITION']) for m in src['meshes'] if m['name'].startswith(prefix)])
    bm=bmesh.new()
    for point in np.unique(points,axis=0):bm.verts.new(point)
    bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
    mesh=bpy.data.meshes.new('Continuous roof envelope');bm.to_mesh(mesh);bm.free();mesh.calc_loop_triangles()
    p=np.array([v.co[:] for v in mesh.vertices]);t=np.array([f.vertices[:] for f in mesh.loop_triangles]);bpy.data.meshes.remove(mesh)
    used,local=np.unique(t,return_inverse=True);return p[used],local.reshape(-1,3)
for no,mesh in enumerate(src['meshes']):
    if mesh['name'].startswith('Hongqiao'):continue # Preserve the complete bridge rails, deck and load-bearing arch.
    prim=mesh['primitives'][0];attrs=prim['attributes'];p=read(attrs['POSITION']);t=read(prim['indices']).reshape(-1,3)
    v=np.zeros(len(p),dtype=INTERLEAVED);v['p']=p;v['n']=np.rint(read(attrs['NORMAL'])*32767);v['weights'][:,0]=255;v['color']=255
    if 'TEXCOORD_0' in attrs:v['uv']=read(attrs['TEXCOORD_0'])
    if 'COLOR_0' in attrs:
        co=read(attrs['COLOR_0']);v['color'][:,:co.shape[1]]=np.rint(co*255)
    leaf='/ leaf_' in mesh['name'];tree=mesh['name'].startswith(('Willow /','Broadleaf /'));roof='Overlapping clay tiles' in mesh['name']
    budgets=[2464,600,80] if leaf and tree else [600,200,60] if tree else [180,36,12] if roof else [min(len(t),3000),min(len(t),600),min(len(t),120)]
    entry={'name':mesh['name'],'original':len(t),'triangles':[]}
    envelope=roof_envelope(mesh['name']) if roof and mesh['name'].endswith(' / tile_mid') else None
    for level,budget in enumerate(budgets):
        if leaf and tree:
            pp,nn,uv,tt=cards(p,budget);co=np.ones((len(pp),4))
        elif roof and level==0:
            pp=p;tt=t;nn=read(attrs['NORMAL']);uv=v['uv'];co=v['color']/255
        else:
            pp,tt=simplify(*envelope,600 if level==1 else 180) if envelope else simplify(p,t,budget)
            projected=project(v,t,pp,False);nn=projected['n']/32767;uv=projected['uv'];co=projected['color']/255
        if not len(tt):raise ValueError(mesh['name'])
        primitive={'attributes':{'POSITION':acc(pp,'VEC3'),'NORMAL':acc(nn,'VEC3'),'TEXCOORD_0':acc(uv,'VEC2'),'COLOR_0':acc(co,'VEC4')},'indices':acc(tt.ravel(),'SCALAR')}
        if leaf and tree:primitive['material']=0
        mi=len(g['meshes']);g['meshes'].append({'name':mesh['name']+f' / Auto{level}','primitives':[primitive]});ni=len(g['nodes']);g['nodes'].append({'name':mesh['name']+f' / Auto{level}','mesh':mi,'extras':{'sourceMesh':mesh['name'],'level':level,'auto':True,'tree':tree,'leafCard':leaf and tree}});g['scenes'][0]['nodes'].append(ni);entry['triangles'].append(len(tt))
    report['meshes'].append(entry)
    if no%20==0:print(no,'/',len(src['meshes']),entry,flush=True)
data.extend(b'\0'*((-len(data))%4));g['buffers'][0]['byteLength']=len(data);js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
output=ROOT/'assets/Qingming_Auto_Details.glb';atomic_write(output,struct.pack('<III',0x46546C67,2,28+len(js)+len(data))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(data),0x004E4942)+data)
report['sha256']=hashlib.sha256(output.read_bytes()).hexdigest();atomic_write(ROOT/'production/auto-detail-manifest.json',json.dumps(report,ensure_ascii=False,indent=2).encode())
manifest=ROOT/'production/asset-manifest.json';m=json.loads(manifest.read_text());m['outputs'][output.name]=report['sha256'];atomic_write(manifest,json.dumps(m,ensure_ascii=False,indent=2).encode());print('AUTO_DETAILS_COMPLETE',output.stat().st_size,flush=True)
