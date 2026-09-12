"""Refine current, fully weighted people without rebuilding the historical city.
Small rest-mesh tailoring keeps the 31-joint skeleton and activity bindings intact.
"""
import gzip,json,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];source=ROOT/'production/inputs/runtime-1.3';m=json.loads((source/'city.json').read_text());raw=bytearray(gzip.decompress((source/'city.bin.gz').read_bytes()))
v=np.ndarray(m['vertexCount'],dtype=np.dtype({'names':['p','n','tag','color','joints','weights'],'formats':[('<f4',3),('<i2',3),'<i2',('u1',4),('<u2',4),('u1',4)],'offsets':[0,12,18,28,32,40],'itemsize':44}),buffer=raw);ii=np.frombuffer(raw,dtype='<u4',count=m['indexCount'],offset=m['indexByteOffset']);counts={'heads':0,'hands':0,'tailoredVertices':0}
for asset in m['assets']:
 if not asset.get('rig'):continue
 scale=.64 if asset['rig']=='child' else 1.;chin=.855 if scale<1 else 1.47;pivot=chin+.10*scale;wrist=.785-.515*scale if scale<1 else .875
 for di in dict.fromkeys(di for level in asset.get('lodDraws',[asset['draws']]) for di in level):
  draw=m['draws'][di];ids=np.unique(ii[draw['indexOffset']//4:draw['indexOffset']//4+draw['count']]);p=v['p'][ids].astype(float);n=v['n'][ids].astype(float)/32767.;weights=v['weights'][ids];joints=v['joints'][ids];dominant=joints[np.arange(len(ids)),weights.argmax(axis=1)];rigid=weights.max(axis=1)>220
  head=(dominant==5)&rigid;variant=int(asset['name'][-1]);sx=[.91,.95,.93][variant];sz=.89
  p[head,0]*=sx;p[head,1]*=.96;p[head,2]=pivot+(p[head,2]-pivot)*sz;n[head]/=[sx,.96,sz];counts['heads']+=int(head.sum())
  hands=np.isin(dominant,[9,10,14,15,29,30])&rigid;p[hands,2]=wrist+(p[hands,2]-wrist)*1.1;n[hands,2]/=1.1;counts['hands']+=int(hands.sum())
  surface=m['materials'][draw['material']].get('extras',{}).get('surface')
  if surface=='cloth':
   q=p/scale
   def folds(q):
    angle=np.arctan2(q[:,1],q[:,0]);z=q[:,2];hem=np.clip((.98-z)/.35,0,1)*np.clip((z-.10)/.12,0,1);waist=np.exp(-((z-.99)/.20)**2);sleeve=np.clip((np.abs(q[:,0])-.18)/.12,0,1)*np.exp(-((z-1.12)/.26)**2)
    return (.008*np.sin(angle*9+z*5+variant)*hem+.0045*np.sin(z*42+angle*3)*waist+.005*np.sin(z*50+q[:,0]*15)*sleeve)*scale
   h=folds(q);grad=np.column_stack([(folds(q+np.eye(3)[k]*.001)-folds(q-np.eye(3)[k]*.001))/(.002*scale)for k in range(3)])
   p+=n*h[:,None];n-=grad-n*np.sum(grad*n,axis=1)[:,None];counts['tailoredVertices']+=len(ids)
  n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-8);v['p'][ids]=p;v['n'][ids]=np.clip(np.round(n*32767),-32767,32767).astype('<i2')
  if surface=='skin':
   c=v['color'][ids].astype(float);cheek=np.exp(-((np.abs(p[:,0])-.047*scale)/(.023*scale))**2-((p[:,2]-chin-.11*scale)/(.04*scale))**2)*(p[:,1]<-.03*scale);c[:,1]*=1-cheek*.025;c[:,2]*=1-cheek*.045;v['color'][ids]=np.clip(c,0,255).astype('u1')
(ROOT/'public/runtime/city.bin.gz').write_bytes(gzip.compress(raw,compresslevel=6,mtime=0));(ROOT/'production/figure-refinement.json').write_text(json.dumps({'changes':counts,'skeleton':'preserved all 31 joints and existing weights','headScale':[.91,.95,.93],'headHeightScale':.89,'clothFoldsMetres':.008},indent=2));print(counts)
