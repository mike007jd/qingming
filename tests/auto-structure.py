"""Run with Blender --background --factory-startup --python tests/auto-structure.py."""
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_auto_lods import simplify
p=np.array([[x,y,z] for x in [-1,1] for y in [-1,1] for z in [-1,1]],dtype=float)
t=np.array([[0,1,3],[0,3,2],[4,6,7],[4,7,5],[0,4,5],[0,5,1],[2,3,7],[2,7,6],[0,2,6],[0,6,4],[1,5,7],[1,7,3]])
p=np.concatenate([p+[i*5,0,0] for i in range(3)]);t=np.concatenate([t+i*8 for i in range(3)])
old,_=simplify(p,t,12);assert np.ptp(old,axis=0)[0]<np.ptp(p,axis=0)[0],'fixture reproduces loss of independent structural members'
new,faces=simplify(p,t,12,preserve_components=True)
assert len(faces)==36 and np.allclose(new.min(0),p.min(0)) and np.allclose(new.max(0),p.max(0))
for x in [0,5,10]:
 part=new[np.abs(new[:,0]-x)<=1];assert len(part)==8 and np.allclose(np.ptp(part,axis=0),[2,2,2])
print('PASS: all three structural members retain volume even when budget is below their minimum topology')
