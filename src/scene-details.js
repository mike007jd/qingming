import * as THREE from 'three';
import {projectedDiameter,selectLOD} from './lod.js';
import {makeAutoBatches} from './auto-batches.js';
export async function loadSceneDetails(engine,Loader,progress){
 progress(.90,'Loading the bridge and city details');
 const loader=new Loader(),result=await loader.loadAsync('./assets/Qingming_Details.glb');
 const root=result.scene;root.name='Reference-directed city details';
 for(const a of engine.sourceAssets)if(/^(Willow|Broadleaf)/.test(a.name)||a.name.startsWith('Hongqiao'))a.replaced=true;
 const vessels=await loader.loadAsync('./assets/Qingming_Vessels.glb'),moving=[];
 for(const b of engine.life.boats){
  const template=vessels.scene.getObjectByName(b.type)||vessels.scene.getObjectByName(b.type+'__details');if(!template)continue;
  const boat=template.clone(true),rig=new THREE.Group();rig.matrixAutoUpdate=false;rig.add(boat);root.add(rig);
  const box=new THREE.Box3().setFromObject(boat),size=box.getSize(new THREE.Vector3());if(!template.name.endsWith('__details'))boat.scale.set(b.length/size.x,Math.min(1,b.height/size.y),b.beam/size.z);
  moving.push({b,rig});
 }
 // Keep the original articulated oars and rudders; replace only the two selected hulls.
 for(const batch of engine.batches)if(['Cargo_barge','Trading_sailboat'].includes(batch.a.name))for(const mesh of batch.meshes){
  const source=mesh.geometry,index=source.index.array,tag=source.attributes.qmRegion.array,kept=[];
  for(let j=source.drawRange.start;j<source.drawRange.start+source.drawRange.count;j+=3)if([301,302].includes(tag[index[j]]))kept.push(index[j],index[j+1],index[j+2]);
  const geometry=new THREE.BufferGeometry();for(const [name,attribute]of Object.entries(source.attributes))geometry.setAttribute(name,attribute);geometry.boundingSphere=source.boundingSphere;geometry.setIndex(kept);geometry.setDrawRange(0,kept.length);mesh.geometry=geometry;
 }
 const breeze={time:{value:0},amount:{value:1}};
 root.traverse(o=>{if(!o.isMesh)return;const tree=/Willow|Broadleaf|bark|leaf/i.test(o.name),sail=o.userData.source_mesh===89;if(!tree&&!sail)return;
   const hook=shader=>{Object.assign(shader.uniforms,{detailTime:breeze.time,detailWind:breeze.amount});shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
uniform float detailTime,detailWind;vec2 detailAnchor;
vec2 breezeAt(float y){float h=max(y,0.)/8.;
#ifdef USE_INSTANCING
 vec2 anchor=instanceMatrix[3].xz;
#elif defined(USE_BATCHING)
 vec2 anchor=detailAnchor;
#else
 vec2 anchor=modelMatrix[3].xz;
#endif
 float phase=detailTime*.8+anchor.x*.1+anchor.y*.12;return vec2(sin(phase)*.18,cos(phase*.83)*.1)*h*h*detailWind;}`)
   .replace('#include <batching_vertex>','#include <batching_vertex>\n#ifdef USE_BATCHING\ndetailAnchor=batchingMatrix[3].xz;\n#endif\n')
   .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nvec2 dn=breezeAt(position.y+.01)-breezeAt(position.y);objectNormal.y-=dot(objectNormal.xz,dn)/.01;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.xz+=breezeAt(position.y);');};
  for(const material of (Array.isArray(o.material)?o.material:[o.material])){material.onBeforeCompile=hook;material.customProgramCacheKey=()=> 'detail-breeze-1';if(tree){material.side=THREE.DoubleSide;material.roughness=.88;}}
  o.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});o.customDepthMaterial.onBeforeCompile=hook;o.customDepthMaterial.customProgramCacheKey=()=> 'detail-breeze-depth-1';
 });
 const styled=engine.style.applyTo(root,{select:(_,m)=>!m.isShaderMaterial,getOptions:(mesh,m)=>({pattern:({tile:'tiles',wood:'wood',fabric:'fabric',stone:'stone'})[m.userData.surface]||(/wood|timber|beam|bark/i.test(m.name)?'wood':'none'),patternInk:.22,outlineWeight:/leaf/i.test(m.name)?.18:.65})});
 root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 const library=await loader.loadAsync('./assets/Qingming_LOD.glb'),geometries=new Map(),lodMeshes=[];
 library.scene.traverse(o=>{if(!o.isMesh)return;const {sourceMesh,level,surfaceError}=o.userData;if(!sourceMesh)return;
  const levels=geometries.get(sourceMesh)||[];o.geometry.computeBoundingSphere();levels[level]={geometry:o.geometry,error:surfaceError};geometries.set(sourceMesh,levels);
 });
 root.traverse(o=>{if(!o.isMesh)return;const source=result.parser.associations.get(o);if(source?.meshes===undefined)return;
  const name=result.parser.json.meshes[source.meshes].name,low=geometries.get(name);if(!low)return;
  o.geometry.computeBoundingSphere();const full=o.geometry,levels=[{geometry:full,error:0},...low.slice(1)];
  const radius=full.boundingSphere.radius;
  // Limit measured surface displacement to 0.6 output pixels, with a 2x
  // measurement margin and conservative minimum errors for material changes.
  const thresholds=levels.slice(1).map((l,i)=>Math.min(i?100:240,1.2*radius/Math.max(l.error*2,i?.06:.025)));
  thresholds[1]=Math.min(thresholds[0],thresholds[1]??thresholds[0]);
  lodMeshes.push({mesh:o,levels,thresholds,history:{main:0,reflection:0,shadow:0},sphere:full.boundingSphere});
 });
 const autoLibrary=await loader.loadAsync('./assets/Qingming_Auto_Details.glb'),autoGeometries=new Map(),autoMaterials=new Map();
 autoLibrary.scene.traverse(o=>{if(!o.isMesh)return;const {sourceMesh,level,tree,leafCard}=o.userData;const levels=autoGeometries.get(sourceMesh)||[];o.geometry.computeBoundingSphere();levels[level]={geometry:o.geometry,error:0,tree,leafCard,map:leafCard?o.material.map:null};autoGeometries.set(sourceMesh,levels);});
 root.traverse(o=>{if(!o.isMesh)return;const association=result.parser.associations.get(o);if(association?.meshes===undefined)return;const name=result.parser.json.meshes[association.meshes].name,autoLevels=autoGeometries.get(name);if(!autoLevels||name.startsWith('Hongqiao'))return;
  let entry=lodMeshes.find(e=>e.mesh===o);if(!entry){o.geometry.computeBoundingSphere();entry={mesh:o,levels:[{geometry:o.geometry,error:0}],thresholds:[240,100],history:{main:0,reflection:0,shadow:0},sphere:o.geometry.boundingSphere};lodMeshes.push(entry);}
  entry.fullLevels=entry.levels;entry.fullThresholds=entry.thresholds;entry.autoLevels=autoLevels;entry.originalMaterial=o.material;entry.originalDepth=o.customDepthMaterial;
  entry.roof=name.startsWith('Overlapping clay tiles');entry.roofAccent=entry.roof&&!name.endsWith(' / tile_mid');
  if(autoLevels[0].leafCard){if(!autoMaterials.has(o.material)){const material=o.material.clone();material.onBeforeCompile=o.material.onBeforeCompile;material.customProgramCacheKey=o.material.customProgramCacheKey;material.map=autoLevels[0].map;material.alphaTest=.12;material.transparent=false;const depth=o.customDepthMaterial.clone();depth.onBeforeCompile=o.customDepthMaterial.onBeforeCompile;depth.customProgramCacheKey=o.customDepthMaterial.customProgramCacheKey;depth.map=material.map;depth.alphaTest=.12;engine.style.materials.add(material);material.addEventListener('dispose',()=>engine.style.materials.delete(material));autoMaterials.set(o.material,{material,depth});}const {material,depth}=autoMaterials.get(o.material);entry.autoMaterial=material;entry.autoDepth=depth;}

 });
 root.updateMatrixWorld(true);
 // Every part of a tree selects from the whole crown's size and shares its bound.
 const treeBounds=new Map();for(const entry of lodMeshes)if(entry.autoLevels?.[0].tree){const parent=entry.mesh.parent;if(!treeBounds.has(parent))treeBounds.set(parent,new THREE.Box3().setFromObject(parent).getBoundingSphere(new THREE.Sphere()));entry.treeSphere=treeBounds.get(parent);}
 const roofBounds=new Map();for(const entry of lodMeshes)if(entry.roof){const parent=entry.mesh.parent;if(!roofBounds.has(parent))roofBounds.set(parent,new THREE.Box3().setFromObject(parent).getBoundingSphere(new THREE.Sphere()));entry.roofSphere=roofBounds.get(parent);}
 const roofBatches=batchRoofTiles(root,lodMeshes);
 roofBatches.layerHidden=()=>engine.hidden.has('trees');
 let activePass='main';const autoEntries=lodMeshes.filter(e=>e.autoLevels).map(entry=>{const source=entry.mesh.clone();source.material=entry.autoMaterial||entry.originalMaterial;source.customDepthMaterial=entry.autoDepth||entry.originalDepth;return {source,geometries:entry.autoLevels.map(l=>l.geometry),capacity:1,level:()=>entry.history[activePass],count:()=>entry.treeSphere&&engine.hidden.has('trees')||entry.roofAccent&&entry.history[activePass]>0?0:1,matrix:(_,m)=>m.copy(entry.mesh.matrixWorld),entry};});
 const autoBatches=makeAutoBatches(root,autoEntries);root.userData.autoBatches=autoBatches;
 const sphere=new THREE.Sphere();
 root.userData.lodMeshes=lodMeshes;root.userData.roofBatches=roofBatches;
 root.userData.updateLOD=(camera,pass)=>{
  const counts=[0,0,0],auto=engine.quality==='auto';
  activePass=pass;roofBatches.auto=auto;roofBatches.enabled=!auto;
  for(const entry of lodMeshes){
   if(!auto&&entry.autoLevels)entry.mesh.visible=true;
   entry.levels=auto&&entry.autoLevels?entry.autoLevels:entry.fullLevels||entry.levels;entry.thresholds=auto&&entry.autoLevels?(entry.treeSphere?[160,48]:entry.roof?[400,120]:[180,60]):entry.fullThresholds||entry.thresholds;entry.mesh.material=auto?(entry.autoMaterial||entry.originalMaterial||entry.mesh.material):(entry.originalMaterial||entry.mesh.material);entry.mesh.customDepthMaterial=auto?(entry.autoDepth||entry.originalDepth):(entry.originalDepth);
   if(auto&&(entry.treeSphere||entry.roofSphere))sphere.copy(entry.treeSphere||entry.roofSphere);else sphere.copy(entry.sphere).applyMatrix4(entry.mesh.matrixWorld);const p=sphere.center;
   let pixels=projectedDiameter(camera,engine.height,p.x,p.y,p.z,sphere.radius);
   // The reflection pass is perturbed, blurred and fresnel-weighted by the
   // water shader, so it selects one tier coarser than the main view.
   const tier=selectLOD(pixels,entry.thresholds,entry.history[pass],pass==='main'?0:auto||pass==='reflection'?1:0);
   const level=engine.lodEnabled?Math.min(entry.levels.length-1,tier):0;
   entry.history[pass]=level;entry.mesh.geometry=entry.levels[level].geometry;counts[level]++;
  }
  roofBatches.update(camera,pass,engine.sunLight.shadow.camera);autoBatches.update(auto);if(auto)for(const {entry} of autoEntries)entry.mesh.visible=false;
  if(pass==='main')root.userData.lodStats=counts;
 };
 const yToZ=new THREE.Matrix4().makeRotationX(Math.PI/2);
 root.userData.update=t=>{breeze.time.value=t;breeze.amount.value=engine.wind;for(const {b,rig}of moving){rig.visible=!engine.hidden.has('boats');rig.matrix.fromArray(b.binding.a.matrices[b.binding.i]);rig.matrix.elements[15]=1;rig.matrix.multiply(yToZ);rig.matrixWorldNeedsUpdate=true;}for(const o of root.children)if(/willow|broadleaf/i.test(o.name))o.visible=!engine.hidden.has('trees');};
 root.updateMatrixWorld(true);
 root.userData.freezeTransforms=freezeDetailTransforms(root,moving.map(v=>v.rig));
 root.userData.styleBinding=styled;
 return root;
}

/** Static detail instances retain individual LOD selection and per-camera culling.
 * The GLTF loader clones one mesh per node reference (2407 draws per pass), so
 * every eligible multi-level prototype is re-packed as per-level InstancedMesh
 * batches sharing the source geometry, material and depth material. The finest
 * level always stays on the original mesh path. */
export function batchRoofTiles(root,entries){
 const groups=new Map(),sphere=new THREE.Sphere(),frustum=new THREE.Frustum(),vp=new THREE.Matrix4();
 for(const entry of entries){
  const m=entry.mesh;
  if(!entry.autoLevels&&entry.levels.length<2||Array.isArray(m.material)||m.material.transparent||m.matrixWorld.determinant()<=0)continue;
  const key=[...(entry.autoLevels||entry.levels).map(l=>l.geometry.id),m.material.id,m.layers.mask,m.castShadow,m.receiveShadow,m.renderOrder].join(':');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);
 }
 const batches=[];
 for(const members of groups.values()){
  if(members.length<2)continue;
  const source=members[0].mesh;
  const meshes=(members[0].autoLevels||members[0].levels).map(({geometry},level)=>{
   const mesh=new THREE.InstancedMesh(geometry,source.material,members.length);
   mesh.name='Batched details / '+source.name+' / LOD'+level;
   mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;mesh.layers.mask=source.layers.mask;mesh.renderOrder=source.renderOrder;
   if(source.customDepthMaterial)mesh.customDepthMaterial=source.customDepthMaterial;
   mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;
   root.add(mesh);return mesh;
  });
  batches.push({members,meshes,trees:members.some(e=>/willow|broadleaf/i.test(e.mesh.name))});
 }
 // The root is the immutable glTF scene container. Store matrices in its space.
 const inverse=root.matrixWorld.clone().invert();
 for(const {members}of batches)for(const entry of members)entry.roofMatrix=new THREE.Matrix4().multiplyMatrices(inverse,entry.mesh.matrixWorld);
 const state={enabled:true,batches,instances:batches.reduce((n,b)=>n+b.members.length,0),layerHidden:null,update(camera,pass,shadowCamera){
  const hideTrees=state.layerHidden?state.layerHidden():false;
  vp.multiplyMatrices((pass==='shadow'?shadowCamera:camera).projectionMatrix,(pass==='shadow'?shadowCamera:camera).matrixWorldInverse);frustum.setFromProjectionMatrix(vp);
  for(const {members,meshes,trees}of batches){
   const hidden=trees&&hideTrees;
   for(const mesh of meshes){mesh.count=0;mesh.visible=false;}
   for(const entry of members){
    const level=entry.history[pass];
    // Preserve the original transform/normal path for the finest tile geometry.
    entry.mesh.visible=(!state.enabled||(!state.auto&&level===0))&&!hidden;
    if(entry.mesh.visible)continue;
    const mesh=meshes[level];if(!mesh)continue;mesh.geometry=entry.levels[level].geometry;mesh.material=entry.mesh.material;mesh.customDepthMaterial=entry.mesh.customDepthMaterial;
    // Match the original mesh's selected-geometry sphere, including shadow views.
    const geometry=entry.levels[level].geometry;if(!geometry.boundingSphere)geometry.computeBoundingSphere();
    sphere.copy(geometry.boundingSphere).applyMatrix4(entry.mesh.matrixWorld);
    if(!frustum.intersectsSphere(sphere))continue;
    mesh.setMatrixAt(mesh.count++,entry.roofMatrix);
   }
   for(const mesh of meshes){
    mesh.visible=mesh.count>0&&!hidden;mesh.instanceMatrix.clearUpdateRanges();
    if(mesh.count){mesh.instanceMatrix.addUpdateRange(0,mesh.count*16);mesh.instanceMatrix.needsUpdate=true;}
   }
  }
 },dispose(){for(const {meshes}of batches)for(const mesh of meshes)mesh.dispose();}};
 return state;
}

// Detail geometry is static; only vessel rigs move on the CPU. Wind stays in the shader.
export function freezeDetailTransforms(root,moving){
 const nodes=[],rigs=new Set(moving);
 const visit=(object,dynamic=false)=>{dynamic=dynamic||rigs.has(object);nodes.push({object,dynamic,local:object.matrixAutoUpdate,world:object.matrixWorldAutoUpdate});for(const child of object.children)visit(child,dynamic);};visit(root);
 const setFrozen=enabled=>{for(const n of nodes){n.object.matrixAutoUpdate=enabled?false:n.local;n.object.matrixWorldAutoUpdate=enabled?n.dynamic:n.world;}};
 setFrozen(true);return setFrozen;
}
