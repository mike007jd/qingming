"""Export authoritative packed geometry and current transforms, never rebuild an older city.
Custom skin weights and part tags remain in the GLB alongside editable bind-pose meshes.
The original 31-joint animation library remains public/runtime/rigs.json.
"""
from pathlib import Path
import json,gzip,struct,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];m=json.loads((ROOT/'public/runtime/city.json').read_text());raw=gzip.decompress((ROOT/'public/runtime/city.bin.gz').read_bytes())
vertices=np.ndarray(m['vertexCount'],dtype=np.dtype({'names':['p','n','tag','uv','color','joints','weights'],'formats':[('<f4',3),('<i2',3),'<i2',('<f4',2),('u1',4),('<u2',4),('u1',4)],'offsets':[0,12,18,20,28,32,40],'itemsize':44}),buffer=raw)
indices=np.frombuffer(raw,dtype='<u4',count=m['indexCount'],offset=m['indexByteOffset'])
g={'asset':{'version':'2.0','generator':'Qingming Final authoritative runtime export'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Qingming current city | Z-up source','rotation':m['rootRotation'],'children':[]}],'meshes':[],'bufferViews':[],'accessors':[],'materials':m['materials'],'textures':m['textures'],'samplers':[{'wrapS':10497,'wrapT':10497,'magFilter':9729,'minFilter':9987}],'images':[],'buffers':[{}]};data=bytearray()
def block(payload):
 while len(data)%4:data.append(0)
 i=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':len(payload)});data.extend(payload);return i
def acc(a,component,kind,normalized=False):
 a=np.ascontiguousarray(a);d={'bufferView':block(a.tobytes()),'componentType':component,'count':len(a),'type':kind}
 if kind=='VEC3':d.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
 if normalized:d['normalized']=True
 i=len(g['accessors']);g['accessors'].append(d);return i
for name in m['images']:g['images'].append({'bufferView':block((ROOT/'public/runtime'/name).read_bytes()),'mimeType':'image/png'})
for asset in m['assets']:
 if not asset['instances'] or asset['name']=='River_water' or asset['name'].startswith(('Willow','Broadleaf','Hongqiao')):continue
 prim=[]
 for di in asset['draws']:
  d=m['draws'][di];ii=indices[d['indexOffset']//4:d['indexOffset']//4+d['count']]
  if asset['name'] in ['Cargo_barge','Trading_sailboat']:ii=ii.reshape(-1,3)[np.isin(vertices['tag'][ii.reshape(-1,3)[:,0]],[301,302])].ravel()
  if len(ii)==0:continue
  used,local=np.unique(ii,return_inverse=True);v=vertices[used]
  attrs={'POSITION':acc(v['p'],5126,'VEC3'),'NORMAL':acc((v['n'].astype('<f4')/32767),5126,'VEC3'),'TEXCOORD_0':acc(v['uv'],5126,'VEC2'),'COLOR_0':acc(v['color'],5121,'VEC4',True),'_QM_JOINTS':acc(v['joints'],5123,'VEC4'),'_QM_WEIGHTS':acc(v['weights'],5121,'VEC4',True),'_QM_REGION':acc(v['tag'].astype('<f4'),5126,'SCALAR')}
  prim.append({'attributes':attrs,'indices':acc(local.astype('<u4'),5125,'SCALAR'),'material':d['material'],'extras':{'parts':d['parts']}})
 mi=len(g['meshes']);g['meshes'].append({'name':asset['name'],'primitives':prim,'extras':{'rig':asset.get('rig')}})
 for ins in asset['instances']:
  ni=len(g['nodes']);g['nodes'][0]['children'].append(ni);g['nodes'].append({'name':ins['name'],'mesh':mi,'matrix':ins['matrix'],'extras':{'motion':ins.get('motion'), 'rig':asset.get('rig')}})
while len(data)%4:data.append(0)
g['buffers'][0]['byteLength']=len(data);js=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
out=struct.pack('<III',0x46546C67,2,28+len(js)+len(data))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(data),0x004E4942)+data
(ROOT/'assets/Qingming_Current_City.glb').write_bytes(out);print(f'Exported {len(g["meshes"])} full-detail prefabs and {len(g["nodes"])-1} instances; {len(out)//1048576} MB')
