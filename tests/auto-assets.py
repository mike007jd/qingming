"""Validate the derived asset contract, including preserved Cinema source ranges."""
import gzip,json,struct
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
m=json.loads((ROOT/'public/runtime/city.json').read_text());raw=gzip.decompress((ROOT/'public/runtime/city.bin.gz').read_bytes())
v=np.ndarray(m['vertexCount'],dtype=np.dtype({'names':['p','tag','j','w'],'formats':[('<f4',3),'<i2',('<u2',4),('u1',4)],'offsets':[0,18,32,40],'itemsize':44}),buffer=raw);idx=np.frombuffer(raw,'<u4',offset=m['indexByteOffset'])
assert len(raw)==m['byteLength'] and len(idx)==m['indexCount'];assert idx.max()<len(v);assert np.isfinite(v['p']).all()
people=[a for a in m['assets'] if a.get('rig') and a['instances']];assert sum(len(a['instances']) for a in people)==584
for a in people:
    levels=a['autoLodDraws'];assert len(levels)==3;counts=[]
    for budget,ds in zip([3000,1000,300],levels):
        assert 1<=len(ds)<=2
        count=0
        for di in ds:
            d=m['draws'][di];ids=idx[d['indexOffset']//4:d['indexOffset']//4+d['count']];count+=len(ids)//3;vv=v[np.unique(ids)]
            assert (vv['j']<31).all();assert (vv['w'].sum(axis=1)==255).all();assert d['auto']
            if any(role in a['name'] for role in ['merchant','scholar','woman']):
                faces=ids.reshape(-1,3);pants=np.isin(v['tag'][faces],[3,4]).all(axis=1)
                assert (v['p'][faces[pants],2].mean(axis=1)<.12).all(),'long robes retain shoes, with internal pants removed'
        assert 0<count<=budget;counts.append(count)
    assert counts[0]>counts[1]>counts[2];assert a['autoCullRadius']>0
    assert all(di<m['autoSource']['drawCount'] for di in a['draws'])
for a in m['assets']:
    if a['name'].startswith(('Ground','Streets')):
        ds=a['autoLodDraws'][0];assert sum(m['draws'][i]['count'] for i in ds)==sum(m['draws'][i]['count'] for i in a['draws']),a['name']+' retains its complete surface'
        for di in ds:
            d=m['draws'][di];ii=idx[d['indexOffset']//4:d['indexOffset']//4+d['count']].reshape(-1,3);cells=np.floor(v['p'][ii].mean(axis=1)[:,:2]/32);assert (cells==cells[0]).all()
def glb(file):
    b=file.read_bytes();return json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]])
g=glb(ROOT/'assets/Qingming_Details.glb');auto=glb(ROOT/'assets/Qingming_Auto_Details.glb');counts={}
original_meshes={mesh['name']:mesh for mesh in g['meshes']}
detail_bytes=(ROOT/'assets/Qingming_Auto_Details.glb').read_bytes();detail_binary=detail_bytes[28+struct.unpack_from('<I',detail_bytes,12)[0]:]
def accessor(i):
    a=auto['accessors'][i];b=auto['bufferViews'][a['bufferView']];size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    return np.frombuffer(detail_binary,dtype={5126:'<f4',5125:'<u4'}[a['componentType']],count=a['count']*size,offset=b.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],size)
for n in auto['nodes']:
    assert not n['extras']['sourceMesh'].startswith('Hongqiao'),'bridge must retain original geometry'
    primitive=auto['meshes'][n['mesh']]['primitives'][0];p=auto['accessors'][primitive['attributes']['POSITION']];assert np.isfinite(p['min']+p['max']).all()
    for i in primitive['attributes'].values():assert np.isfinite(accessor(i)).all()
    indices=accessor(primitive['indices']);assert len(indices)%3==0 and indices.max()<p['count']
    name=n['extras']['sourceMesh'];level=n['extras']['level']
    if name.startswith('Overlapping clay tiles'):
        if level==0:assert len(indices)==g['accessors'][original_meshes[name]['primitives'][0]['indices']]['count'],'near roofs retain every tile'
        elif name.endswith(' / tile_mid'):
            faces=indices.reshape(-1,3);edges=np.sort(np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]),axis=1)
            assert (np.unique(edges,axis=0,return_counts=True)[1]==2).all(),'coarse roofs must form a closed envelope'
            points=accessor(primitive['attributes']['POSITION']);volume=abs(np.einsum('ij,ij->i',points[faces[:,0]],np.cross(points[faces[:,1]],points[faces[:,2]])).sum()/6)
            assert volume>.001,'roof envelope retains volume'
    counts.setdefault(n['extras']['sourceMesh'],[0,0,0])[n['extras']['level']]=auto['accessors'][primitive['indices']]['count']//3
checked=0
for root in g['scenes'][0]['nodes']:
    node=g['nodes'][root];names=[g['meshes'][g['nodes'][i]['mesh']]['name'] for i in node.get('children',[]) if 'mesh' in g['nodes'][i]]
    if not names or not all(n.startswith(('Willow /','Broadleaf /')) for n in names):continue
    total=[sum(counts[n][level] for n in names) for level in range(3)]
    assert all(0<n<=budget for n,budget in zip(total,[8000,2000,300])),total
    assert total[0]>total[1]>total[2];checked+=1
assert checked>50
for a in m['assets']:
    if a['name'].startswith(('House','Shop','Wall_section','Courtyard_walls','Temple','City gate','Pagoda','Watchtower')):
        triangles=[sum(m['draws'][i]['count'] for i in ds) for ds in a['autoLodDraws']]
        assert triangles==sorted(triangles,reverse=True),'distant structure must not increase triangle submissions'
print(json.dumps({'status':'passed','npcPrototypes':len(people),'npcInstances':584,'trees':checked,'weights':'four normalized influences / 31 joints','terrain':'complete surfaces / 32m chunks','bridge':'original geometry retained'}))
