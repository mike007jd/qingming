"""Budgeted Auto geometry derived from the current city; original ranges stay intact.
Run with Blender --background --factory-startup --python tools/build_auto_lods.py.
"""
import bpy, gzip, json, sys
from pathlib import Path
import numpy as np
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from pack_city_soa import INTERLEAVED, atomic_write


def simplify(p,t,budget,preserve_components=False):
    if len(t)<=budget:return p,t
    # Weld geometric seams before collapse; shading/UV/weights are projected later.
    _,first,remap=np.unique(np.round(p,5),axis=0,return_index=True,return_inverse=True)
    p=p[first];t=remap[t];t=t[(t[:,0]!=t[:,1])&(t[:,1]!=t[:,2])&(t[:,0]!=t[:,2])]
    # Small disconnected ornaments consume at least four faces each. Retain the
    # largest surfaces at this tier instead of spending the body budget on eyes.
    parent=np.arange(len(p))
    def find(x):
        while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
        return x
    for tri in t:
        a=find(tri[0])
        for x in tri[1:]:parent[find(x)]=a
    labels=np.array([find(i) for i in range(len(p))]);groups=labels[t[:,0]]
    area=np.linalg.norm(np.cross(p[t[:,1]]-p[t[:,0]],p[t[:,2]]-p[t[:,0]]),axis=1)
    ids=np.unique(groups);scores=np.bincount(groups,weights=area,minlength=len(p))
    if preserve_components:
        # Architectural members keep their volume and silhouette at every tier.
        # The requested budget is soft when reaching it would destroy a member.
        positions=[];faces=[];offset=0;ratio=budget/len(t)
        for group in ids:
            original=t[groups==group];used,local=np.unique(original,return_inverse=True)
            points=p[used];original=local.reshape(-1,3)
            pp,tt=simplify(points,original,max(12,int(len(original)*ratio)))
            extent=np.ptp(points,axis=0)
            if np.any(np.ptp(pp,axis=0)<extent*.95-1e-4):pp,tt=points,original
            positions.append(pp);faces.append(tt+offset);offset+=len(pp)
        return np.concatenate(positions),np.concatenate(faces)
    keep=ids[np.argsort(scores[ids])[::-1]][:max(1,budget//12)]
    t=t[np.isin(groups,keep)]
    if len(t)<=budget:
        used,local=np.unique(t,return_inverse=True);return p[used],local.reshape(-1,3)
    mesh=bpy.data.meshes.new('Auto collapse');mesh.from_pydata(p.tolist(),[],t.tolist());mesh.update()
    ob=bpy.data.objects.new('Auto collapse',mesh);bpy.context.collection.objects.link(ob)
    mod=ob.modifiers.new('Triangle budget','DECIMATE');mod.use_collapse_triangulate=True
    ratio=min(1,budget/max(1,len(t)))*.97
    for attempt in range(12):
        mod.ratio=ratio;bpy.context.view_layer.update();ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());out=ev.to_mesh();out.calc_loop_triangles()
        pp=np.array([v.co[:] for v in out.vertices],dtype='<f4');tt=np.array([tri.vertices[:] for tri in out.loop_triangles],dtype='<u4').reshape(-1,3);ev.to_mesh_clear()
        if len(tt)<=budget:break
        ratio*=max(.05,.9*budget/len(tt))
    bpy.data.objects.remove(ob,do_unlink=True);bpy.data.meshes.remove(mesh)
    if len(tt)>budget:
        # Non-manifold woven ornaments can pin Blender collapse. Spatial weld
        # removes subpixel strands while retaining the enclosing surface.
        step=max(np.ptp(pp,axis=0).max(),.001)/200
        original_p,original_t=pp,tt
        for _ in range(60):
            _,first,remap=np.unique(np.round(original_p/step),axis=0,return_index=True,return_inverse=True)
            pp=original_p[first];tt=remap[original_t];tt=tt[(tt[:,0]!=tt[:,1])&(tt[:,1]!=tt[:,2])&(tt[:,0]!=tt[:,2])]
            _,unique=np.unique(np.sort(tt,axis=1),axis=0,return_index=True);tt=tt[unique]
            if len(tt)<=budget:break
            step*=1.2
        if len(tt)>budget:raise ValueError(f'Collapse cannot meet {budget}: {len(tt)}')
    used,local=np.unique(tt,return_inverse=True);return pp[used],local.reshape(-1,3)


def barycentric(point,tri):
    a,b,c=tri;v=b-a;w=c-a;q=point-a;vv=v@v;vw=v@w;ww=w@w;den=vv*ww-vw*vw
    if abs(den)<1e-15:return np.array([1.,0,0])
    y=(ww*(q@v)-vw*(q@w))/den;z=(vv*(q@w)-vw*(q@v))/den
    weights=np.maximum(0,[1-y-z,y,z]);return weights/weights.sum()


def project(source,faces,points,skin):
    bvh=BVHTree.FromPolygons(source['p'].tolist(),faces.tolist(),all_triangles=True)
    out=np.zeros(len(points),dtype=INTERLEAVED);out['p']=points
    for i,p in enumerate(points):
        hit,_,face,_=bvh.find_nearest(Vector(p));ids=faces[face];v=source[ids];w=barycentric(np.array(hit),v['p'])
        out['uv'][i]=w@v['uv'];out['color'][i]=np.rint(w@v['color']);out['tag'][i]=v['tag'][np.argmax(w)]
        normal=w@v['n'];out['n'][i]=np.rint(normal/(np.linalg.norm(normal) or 1)*32767)
        if skin:
            weights=np.bincount(v['joints'].ravel(),weights=(v['weights']*w[:,None]).ravel(),minlength=31)
            joints=np.argsort(weights)[-4:][::-1];weights=weights[joints];weights=weights/(weights.sum() or 1)*255
            quant=np.floor(weights).astype(int);quant[np.argsort(weights-quant)[::-1][:255-quant.sum()]]+=1
            out['joints'][i]=joints;out['weights'][i]=quant
        else:out['joints'][i]=v['joints'][np.argmax(w)];out['weights'][i]=v['weights'][np.argmax(w)]
    return out


def pose_radius(source,rig,center):
    radii=[]
    for j,joint in enumerate(rig['joints']):
        mask=((source['joints']==j)&(source['weights']>0)).any(axis=1)
        radii.append(float(np.linalg.norm(source['p'][mask]-joint['p'],axis=1).max()) if mask.any() else 0.)
    radius=0.;joints=rig['joints']
    for clip in rig['clips'].values():
        rotations=np.array(clip['rotations']).reshape(-1,len(joints),4);translations=np.array(clip['translations']).reshape(-1,len(joints),3)
        for f in range(len(rotations)):
            matrices=[]
            for j,joint in enumerate(joints):
                q=rotations[f,j];local=Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4();parent=joint['parent'];rest=np.array(joint['p'])-(joints[parent]['p'] if parent>=0 else np.zeros(3));local.translation=Vector(rest+translations[f,j]);world=matrices[parent]@local if parent>=0 else local;matrices.append(world)
                radius=max(radius,float(np.linalg.norm(np.array(world.translation)-center))+radii[j])
    return radius+.15

def main():
    m=json.loads((ROOT/'public/runtime/city.json').read_text());raw=gzip.decompress((ROOT/'public/runtime/city.bin.gz').read_bytes())
    base=m.get('autoSource',{'vertexCount':m['vertexCount'],'indexCount':m['indexCount'],'drawCount':len(m['draws']),'materialCount':len(m['materials'])})
    vertices=np.ndarray(m['vertexCount'],dtype=INTERLEAVED,buffer=raw)[:base['vertexCount']]
    indices=np.frombuffer(raw,dtype='<u4',offset=m['indexByteOffset'],count=base['indexCount'])
    m['draws']=m['draws'][:base['drawCount']];m['materials']=m['materials'][:base['materialCount']]
    base.setdefault('imageCount',len(m['images']));base.setdefault('textureCount',len(m['textures']));m['images']=m['images'][:base['imageCount']];m['textures']=m['textures'][:base['textureCount']]
    rigs=json.loads((ROOT/'public/runtime/rigs.json').read_text())['rigs']
    chunks=[vertices.copy()];index_chunks=[indices.copy()];nv=len(vertices);ni=len(indices)
    # Existing <=1K cloth atlas is shared by both NPC batches; source albedo is
    # sampled into vertex color, so material identity survives consolidation.
    texture_index=next(mat['pbrMetallicRoughness']['baseColorTexture']['index'] for mat in m['materials'] if mat.get('extras',{}).get('surface')=='cloth')
    npc_materials=[]
    for surface in ['cloth','skin']:
        npc_materials.append(len(m['materials']));m['materials'].append({'name':'Auto NPC / '+surface,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'roughnessFactor':.85,'metallicFactor':0},'doubleSided':True,'extras':{'surface':surface,'auto':True}})
    # One shared atlas reserves a 512x1024 tile for cloth and one for skin/accessories.
    image=bpy.data.images.load(str(ROOT/'public/runtime'/m['images'][m['textures'][texture_index]['source']]),check_existing=True)
    im=np.array(image.pixels[:],dtype=np.float32).reshape(image.size[1],image.size[0],4)
    atlas=np.ones((1024,1024,4),dtype=np.float32);tile=im[(np.arange(1024)*len(im)//1024)[:,None],(np.arange(512)*im.shape[1]//512)[None,:],:3];atlas[:,:512,:3]=.94+.06*np.clip(tile/(tile.mean(axis=(0,1))+1e-8),0,1)
    atlas_image=bpy.data.images.new('Auto NPC shared atlas',width=1024,height=1024,alpha=True);atlas_image.pixels.foreach_set(atlas.ravel());atlas_image.filepath_raw=str(ROOT/'public/runtime/auto_npc_atlas.png');atlas_image.file_format='PNG';atlas_image.save()
    atlas_index=len(m['textures']);m['textures'].append({'source':len(m['images'])});m['images'].append('auto_npc_atlas.png')
    for mi in npc_materials:m['materials'][mi]['pbrMetallicRoughness']['baseColorTexture']={'index':atlas_index}
    textures={}
    def albedo(mat,uv):
        factor=np.array(mat['pbrMetallicRoughness']['baseColorFactor'])
        ti=mat['pbrMetallicRoughness'].get('baseColorTexture',{}).get('index')
        if ti is None:return np.tile(factor,(len(uv),1))
        if ti not in textures:
            img=bpy.data.images.load(str(ROOT/'public/runtime'/m['images'][m['textures'][ti]['source']]),check_existing=True)
            textures[ti]=np.array(img.pixels[:]).reshape(img.size[1],img.size[0],4)
        img=textures[ti];xy=uv%1;rgb=img[((1-xy[:,1])*len(img)).astype(int)%len(img),(xy[:,0]*img.shape[1]).astype(int)%img.shape[1]]
        return rgb*factor
    report={'generator':'tools/build_auto_lods.py','source':base,'assets':[]}
    def append_draw(ai,material,v,t,lod):
        nonlocal nv,ni
        d=len(m['draws']);m['draws'].append({'asset':ai,'material':material,'indexOffset':ni*4,'count':t.size,'vertices':len(v),'lod':lod,'parts':['auto_surface'],'auto':True})
        chunks.append(v);index_chunks.append(t.ravel().astype('<u4')+nv);nv+=len(v);ni+=t.size;return d
    for ai,a in sorted(enumerate(m['assets']),key=lambda pair:not bool(pair[1].get('rig'))):
        if not a['instances'] or a['name'].startswith(('Willow','Broadleaf','Hongqiao','River')):continue
        skin=bool(a.get('rig'));dynamic=any(i.get('motion') for i in a['instances']) and not a['name'].startswith('Door_')
        if dynamic and not skin:continue # Articulated tags and oar contacts retain the original geometry.
        source=[]
        for di in a['draws']:
            d=m['draws'][di];ii=indices[d['indexOffset']//4:d['indexOffset']//4+d['count']].reshape(-1,3)
            used,local=np.unique(ii,return_inverse=True);v=vertices[used];t=local.reshape(-1,3)
            if skin:
                # Covered pants and thin overlapping bands remain in Cinema.
                # Removing these internal surfaces also prevents authored leg/robe intersections.
                scale=.64 if a['rig']=='child' else 1.;parts=d['parts'];tags=v['tag'][t]
                legs=np.isin(tags,[3,4]).all(axis=1)
                long_robe=any(role in a['name'] for role in ['merchant','scholar','woman'])
                hem=.155 if long_robe else .36 if a['rig']=='child' else .615
                hidden=legs&(v['p'][t,2].mean(axis=1)>hem+.02*scale)
                if long_robe and set(parts)&{'leg_R','leg_L'}:hidden|=legs
                if any(part.endswith('_puttees') for part in parts):hidden|=legs
                if 'woven_sash' in parts:
                    rigid=((v['joints']==1)|(v['weights']==0)).all(axis=1)
                    z=v['p'][t,2].mean(axis=1);waist=rigs[a['rig']]['joints'][2]['p'][2]
                    hidden|=(tags==0).all(axis=1)&rigid[t].all(axis=1)&(np.abs(z-waist)<.1*scale)
                t=t[~hidden]
                if not len(t):continue
            area=np.linalg.norm(np.cross(v['p'][t[:,1]]-v['p'][t[:,0]],v['p'][t[:,2]]-v['p'][t[:,0]]),axis=1).sum()
            if skin:
                material=m['materials'][d['material']]
                if 'hair' in material['name'].lower():area*=3
                elif material.get('extras',{}).get('surface')=='skin':area*=1.4
            source.append((d['material'],v,t,area))
        if skin:a['autoCullRadius']=pose_radius(np.concatenate([v for _,v,_,_ in source]),rigs[a['rig']],np.mean(a['bounds'],axis=0))
        total=sum(len(t) for _,_,t,_ in source)
        architecture=a['name'].startswith(('House','Shop','Wall_section','Courtyard_walls','Temple','City gate','Pagoda','Watchtower'))
        near_budget=6000 if a['name'].startswith(('House','Shop','Wall_section','Courtyard')) else 12000
        budgets=[3000,1000,300] if skin else [min(total,near_budget),min(total,2400),min(total,480)]
        if a['name'].startswith(('Ground','Streets')):
            draws=[]
            for material,v,t,_ in source:
                keys=np.floor(v['p'][t].mean(axis=1)[:,:2]/32).astype(int)
                for key in np.unique(keys,axis=0):
                    faces=t[(keys==key).all(axis=1)];used,local=np.unique(faces,return_inverse=True);draws.append(append_draw(ai,material,v[used],local.reshape(-1,3),0))
            a['autoLodDraws']=[draws];report['assets'].append({'name':a['name'],'original':total,'triangles':[total],'batches':[len(draws)],'spatialChunkMetres':32});print(a['name'],'32m chunks',len(draws),flush=True);continue
        a['autoLodDraws']=[];counts=[]
        for lod,budget in enumerate(budgets):
            grouped={};remaining=budget;total_area=sum(s[3] for s in source)
            for material,v,t,area in sorted(source,key=lambda s:-s[3]):
                allowance=min(remaining,max(0,int(budget*area/max(1e-12,total_area))))
                if architecture:allowance=max(12,int(budget*area/max(1e-12,total_area)))
                if allowance<8:continue
                pp,tt=simplify(v['p'],t,allowance,preserve_components=architecture);out=project(v,t,pp,skin)
                if not len(tt):continue
                if skin:
                    mat=m['materials'][material]
                    if 'hair' in mat['name'].lower():out['p']+=out['n'].astype(float)/32767*(.012 if lod==0 else .02)
                    surface=mat.get('extras',{}).get('surface');group=npc_materials[0 if surface=='cloth' else 1]
                    out['color']=np.rint(np.clip(out['color']/255*albedo(mat,out['uv']),0,1)*255)
                    out['uv']=(out['uv']%1)*[.49,.99]+[.005 if group==npc_materials[0] else .505,.005]
                else:group=material
                vv,ii=grouped.setdefault(group,([],[]));offset=sum(len(x) for x in vv);vv.append(out);ii.append(tt+offset);remaining-=len(tt)
            if architecture and counts and sum(t.size//3 for _,ts in grouped.values() for t in ts)>=counts[-1]:
                a['autoLodDraws'].append(a['autoLodDraws'][-1]);counts.append(counts[-1]);continue
            draws=[]
            for mat,(vs,ts) in grouped.items():draws.append(append_draw(ai,mat,np.concatenate(vs),np.concatenate(ts),lod))
            a['autoLodDraws'].append(draws);counts.append(sum(m['draws'][i]['count']//3 for i in draws))
        if not skin and len(set(counts))==1:a['autoLodDraws']=a['autoLodDraws'][:1]
        original=sum(m['draws'][di]['count']//3 for di in a['draws'])
        report['assets'].append({'name':a['name'],'original':original,'removedInternalTriangles':original-total,'triangles':counts,'batches':[len(ds) for ds in a['autoLodDraws']]})
        print(a['name'],total,'->',counts,flush=True)
    m['autoSource']=base;m['vertexCount']=nv;m['indexCount']=ni;m['indexByteOffset']=nv*44;m['byteLength']=nv*44+ni*4
    raw=np.concatenate(chunks).tobytes()+np.concatenate(index_chunks).astype('<u4').tobytes()
    atomic_write(ROOT/'public/runtime/city.bin.gz',gzip.compress(raw,compresslevel=6,mtime=0));atomic_write(ROOT/'public/runtime/city.json',json.dumps(m,ensure_ascii=False,separators=(',',':')).encode())
    atomic_write(ROOT/'production/auto-lod-manifest.json',json.dumps(report,ensure_ascii=False,indent=2).encode())
    print('AUTO_CITY_COMPLETE',nv,ni,flush=True)

if __name__=='__main__':main()
