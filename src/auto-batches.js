import * as T from 'three';

// Keep each object's geometry/bounds. Native multi-draw groups material state,
// while culling and LOD selection remain independent for every object.
export function compactGeometry(source){
 const indices=source.index.array.subarray(source.drawRange.start,source.drawRange.start+Math.min(source.drawRange.count,source.index.count)),remap=new Map(),used=[],local=new Uint32Array(indices.length);
 for(let i=0;i<indices.length;i++){const id=indices[i];if(!remap.has(id)){remap.set(id,used.length);used.push(id);}local[i]=remap.get(id);}
 const geometry=new T.BufferGeometry();
 for(const [name,attribute] of Object.entries(source.attributes)){
  if(attribute.isInstancedBufferAttribute)continue;
  const array=new attribute.array.constructor(used.length*attribute.itemSize);
  for(let i=0;i<used.length;i++)for(let k=0;k<attribute.itemSize;k++)array[i*attribute.itemSize+k]=attribute.array[used[i]*attribute.itemSize+k];
  geometry.setAttribute(name,new T.BufferAttribute(array,attribute.itemSize,attribute.normalized));
 }
 geometry.setIndex(new T.BufferAttribute(local,1));geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.5;return geometry;
}

export function makeAutoBatches(root,entries){
 const groups=new Map(),matrix=new T.Matrix4();
 for(const entry of entries){const source=entry.source,key=[source.material.id,source.castShadow,source.receiveShadow,source.layers.mask].join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
 const batches=[];
 for(const members of groups.values()){
  const geometries=new Map();let vertices=0,indices=0;
  for(const entry of members)for(const source of entry.geometries){if(geometries.has(source))continue;const g=compactGeometry(source);geometries.set(source,{geometry:g});vertices+=g.attributes.position.count;indices+=g.index.count;}
  const source=members[0].source,mesh=new T.BatchedMesh(members.reduce((n,e)=>n+e.capacity,0),vertices,indices,source.material);
  mesh.name='Auto material batch / '+source.material.name;mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;mesh.customDepthMaterial=source.customDepthMaterial;mesh.layers.mask=source.layers.mask;mesh.frustumCulled=false;mesh.sortObjects=false;mesh.perObjectFrustumCulled=true;
  for(const g of geometries.values()){g.id=mesh.addGeometry(g.geometry);g.geometry.dispose();}
  for(const entry of members){entry.mesh=mesh;entry.geometryIds=entry.geometries.map(g=>geometries.get(g).id);entry.ids=Array.from({length:entry.capacity},()=>mesh.addInstance(entry.geometryIds[0]));entry.lastMatrices=new Float32Array(entry.capacity*16).fill(NaN);entry.lastLevels=new Int32Array(entry.capacity).fill(-1);}
  root.add(mesh);batches.push(mesh);
 }
 return {entries,batches,update(enabled){
  for(const mesh of batches)mesh.visible=enabled;if(!enabled)return;
  for(const entry of entries){const count=entry.count();for(let i=0;i<entry.ids.length;i++){const id=entry.ids[i],visible=i<count&&(!entry.visible||entry.visible(i));entry.mesh.setVisibleAt(id,visible);if(visible){const level=entry.level(i);if(entry.lastLevels[i]!==level){entry.mesh.setGeometryIdAt(id,entry.geometryIds[level]);entry.lastLevels[i]=level;}entry.matrix(i,matrix);let changed=false;for(let k=0;k<16;k++)if(entry.lastMatrices[i*16+k]!==Math.fround(matrix.elements[k])){changed=true;break;}if(changed){entry.lastMatrices.set(matrix.elements,i*16);entry.mesh.setMatrixAt(id,matrix);}}}entry.source.visible=false;}
 },dispose(){for(const mesh of batches){root.remove(mesh);mesh.dispose();}}};
}
