import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
registerHooks({resolve(specifier,ctx,next){if(specifier==='qingming/micro')return {url:new URL('src/micro.js',root).href,shortCircuit:true};if(specifier==='three/core')return {url:new URL('vendor/three.core.js',root).href,shortCircuit:true};if(specifier==='three')return {url:new URL('vendor/three.module.js',root).href,shortCircuit:true};return next(specifier,ctx);}});
const T=await import('three');
const {CollisionWorld,CityEcology,lifeBoatHull,lifeOBBOverlap,multiply,Z_TO_Y}=await import('../src/simulation.js');
const {QingmingStyle}=await import('../src/QingmingStyle.js');
const {QingmingPass}=await import('../src/QingmingPass.js');
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const [manifest,nav,eco]=await Promise.all(['city','navigation','ecology'].map(x=>json(`public/runtime/${x}.json`)));
const sourceAssets=manifest.assets.map(a=>({...a,baseMatrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),matrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),centers:a.instances.map(()=>[0,0,0])}));
const world=new CollisionWorld(nav);world.registerDoors(sourceAssets);
let p=[0,-21,2.26];for(let i=0;i<540;i++)p=world.move(p,0,.08).position;
assert(p[1]>20,'walker must cross the complete bridge');
const rail=world.move([3.4,0,world.bridgeHeight(0)],2,0);assert(rail.position[0]<3.65,'bridge railing must block the walker');
for(const ni of nav.instances.filter(x=>/^House_|^North_plot/.test(x.name))){const a=manifest.assets.find(a=>a.instances.some(i=>i.name===ni.name));if(a)assert.deepEqual(a.instances.find(i=>i.name===ni.name).matrix,ni.matrix,`${ni.name}: visual/collision transforms`);}
for(const d of world.doors){assert.equal(d.mo.size.length,3);assert(d.scale.every(Number.isFinite));const expected=d.mo.size[0]*d.scale[0];assert(Math.abs(d.box.hx*2-expected)<1e-7);}
const shop=world.doors.find(d=>d.a.instances[d.index].name.startsWith('Riverfront'));
const old=shop.current;shop.current=0;world.updateDoor(shop);const closed={...shop.box};shop.current=shop.mo.openAngle;world.updateDoor(shop);assert(Math.hypot(closed.x-shop.box.x,closed.y-shop.box.y)>.3,'opening door must move its collision');shop.current=old;world.updateDoor(shop);
// Grid candidates must agree with the original scan across complete door swings,
// cell boundaries and a larger actor that uses the conservative fallback.
const originalContacts=world.contacts;
for(let phase=0;phase<=4;phase++){
 for(const door of world.doors){door.current=door.mo.openAngle*phase/4;world.updateDoor(door);}
 for(let i=0;i<world.doors.length;i+=7){const d=world.doors[i];for(const radius of [.23,.42,.48,.8])for(const offset of [-.43,0,.43]){
  const x=d.box.x+offset,y=d.box.y-offset,z=d.box.lo;
  const indexed=originalContacts.call(world,x,y,z,radius).filter(c=>c.b.tag==='interactive_door');
  const scanned=world.doors.flatMap(door=>{const p=world.penetration(door.box,x,y,z,radius);return p?[{b:door.box,p}]:[];});
  assert.deepEqual(indexed,scanned,'door grid preserves full-scan collision results');
 }}
}
for(const door of world.doors){door.current=door.mo.defaultOpen?door.mo.openAngle:0;world.updateDoor(door);}
const life=new CityEcology(eco,world),initial=life.totalStock();for(let i=0;i<1800;i++){life.step(1/30);if(i%30===0)for(let a=0;a<life.boats.length;a++)for(let b=a+1;b<life.boats.length;b++)assert(!lifeOBBOverlap(lifeBoatHull(life.boats[a]),lifeBoatHull(life.boats[b]),-.05),'boat overlap');}
assert(life.stats.boatDistance>100,'boats must progress');assert.equal(life.totalStock(),initial,'trade conserves cargo');
life.paused=true;const time=life.time;life.advance(1);assert.equal(life.time,time,'pause freezes simulation');
// Regression: a composed custom deformation must survive both style conversion and normal pass cloning.
const original=new T.MeshStandardMaterial();original.defines.QM_SKIN=1;original.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x += 0.125;');};original.customProgramCacheKey=()=> 'known-deformation';
const style=new QingmingStyle(),painted=style.convertMaterial(original),pass=Object.create(QingmingPass.prototype);pass.normalCache=new Map();const normal=pass._normalMaterial(painted);
assert.equal(normal.defines.QM_SKIN,1);assert.equal(painted.defines.QM_SKIN,1);
function shader(m){const s={vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader,uniforms:{}};m.onBeforeCompile(s);return s;}
const colorShader=shader(painted),normalShader=shader(normal);assert.equal(colorShader.vertexShader,normalShader.vertexShader,'color and outline use identical deformation');assert.match(normalShader.fragmentShader,/gl_FragColor = vec4\(normalize\(normal\)/);assert.equal(colorShader.vertexShader.split('transformed.x += 0.125;').length,2);
assert.ok(!painted.customProgramCacheKey().includes('-mrt'),'cache key returns to the shared program');
assert.throws(()=>style.set({enabled:NaN}),RangeError);assert.throws(()=>style.setPreset('missing'),RangeError);
style.setPerformanceMode(true);style.set({enabled:1});assert(!shader(painted).fragmentShader.includes('#include <lights_fragment_begin>'),'full Auto paint omits overwritten PBR lighting');
style.set({enabled:.5});assert(shader(painted).fragmentShader.includes('#include <lights_fragment_begin>'),'blended paint retains PBR lighting');
style.set({enabled:1});style.setPerformanceMode(false);assert(shader(painted).fragmentShader.includes('#include <lights_fragment_begin>'),'Cinema retains PBR lighting');
// A caster outside the view still contributes to the light's shadow map.
const {ThreeCityEngine}=await import('../src/three-engine.js');
const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(40,0,0);camera.lookAt(50,0,0);camera.updateMatrixWorld();
const sun=new T.DirectionalLight();sun.position.set(0,10,0);sun.target.position.set(0,0,0);sun.updateMatrixWorld();sun.target.updateMatrixWorld();
sun.shadow.camera.left=sun.shadow.camera.bottom=-2;sun.shadow.camera.right=sun.shadow.camera.top=2;sun.shadow.camera.near=.1;sun.shadow.camera.far=30;sun.shadow.camera.updateProjectionMatrix();
const matrices=[0,50].map(x=>new Float32Array(new T.Matrix4().makeTranslation(x,0,0).elements));
const batch={a:{center:[0,0,0],radius:.2,category:'city',matrices},matrices:new Float32Array(32),meta:new T.InstancedBufferAttribute(new Float32Array(2),1),meshes:[{geometry:{drawRange:{count:3}},instanceMatrix:new T.InstancedBufferAttribute(new Float32Array(32),16)}]};
const culler=Object.assign(Object.create(ThreeCityEngine.prototype),{batches:[batch],hidden:new Set(),sunLight:sun,frustum:new T.Frustum(),shadowFrustum:new T.Frustum(),_vp:new T.Matrix4(),_sphere:new T.Sphere()});
assert.equal(culler.updateBatches(camera,'shadow').instances,1);assert.equal(batch.matrices[12],0,'offscreen caster retained');
assert.equal(culler.updateBatches(camera,'main').instances,1);assert.equal(batch.matrices[12],50,'main visibility remains independent');
assert.deepEqual(batch.meta.updateRanges,[{start:0,count:1}],'upload only the active metadata prefix using the r179 API');
assert.deepEqual(batch.meshes[0].instanceMatrix.updateRanges,[{start:0,count:16}],'upload only active instance matrices');
const {projectedDiameter,selectLOD}=await import('../src/lod.js');
assert.equal(selectLOD(300,[240,100]),0);
assert.equal(selectLOD(180,[240,100]),1);
assert.equal(selectLOD(80,[240,100]),2);
assert.equal(selectLOD(260,[240,100],1),1,'hysteresis retains the current level');
assert.equal(selectLOD(289,[240,100],1),0,'approaching restores full geometry');
// A fixed reflected view must not drift from LOD1 to LOD2 on its second frame.
let reflectedLevel=0;
for(const [pixels,expected]of [[260,1],[260,1],[239,2],[260,2],[289,1],[260,1],[80,2]]){
 reflectedLevel=selectLOD(pixels,[240,100],reflectedLevel,1);
 assert.equal(reflectedLevel,expected,'reflection offset preserves stable tiers and return hysteresis');
}
const lodCamera=new T.PerspectiveCamera(49,1,.15,1000);lodCamera.updateMatrixWorld();
const pixels=projectedDiameter(lodCamera,720,0,0,-80,1);
assert(Math.abs(projectedDiameter(lodCamera,2160,0,0,-80,1)-pixels*3)<1e-10,'4K uses physical output pixels');
lodCamera.zoom=2;lodCamera.updateProjectionMatrix();assert.equal(projectedDiameter(lodCamera,720,0,0,-80,1),pixels*2,'optical zoom restores detail');
assert(projectedDiameter(lodCamera,720,0,0,0,1)>1000,'camera inside bounds keeps full detail');
const lodAsset={center:[0,0,0],radius:1,category:'people',matrices:[5,20,120].map(z=>new Float32Array(new T.Matrix4().makeTranslation(0,0,-z).elements)),lodState:{main:new Uint8Array(3),reflection:new Uint8Array(3),shadow:new Uint8Array(3)}};
culler.batches=[0,1,2].map(lod=>({a:lodAsset,lod,lodCount:3,matrices:new Float32Array(48),meta:new T.InstancedBufferAttribute(new Float32Array(3),1),meshes:[{geometry:{drawRange:{count:300/(lod+1)}},instanceMatrix:new T.InstancedBufferAttribute(new Float32Array(48),16)}]}));
culler.height=720;culler.lodEnabled=true;lodCamera.zoom=1;lodCamera.updateProjectionMatrix();
assert.deepEqual(culler.updateBatches(lodCamera).levels,[1,0,2],'every instance selects exactly one LOD under the unified [240,100] pixel thresholds');
lodCamera.position.z=-115;lodCamera.updateMatrixWorld();culler.updateBatches(lodCamera,'reflection');
assert.equal(lodAsset.lodState.reflection[2],1,'reflection keeps an independent level, one tier coarser than the main view');
assert.equal(lodAsset.lodState.main[2],2,'reflection does not overwrite main hysteresis');
lodCamera.position.z=-113;lodCamera.updateMatrixWorld(); // ~264 px for the far instance.
for(let frame=0;frame<3;frame++){
 culler.updateBatches(lodCamera,'reflection');
 assert.equal(lodAsset.lodState.reflection[2],1,'repeated reflected frames retain their selected tier');
}
culler.lodEnabled=false;lodCamera.position.z=0;lodCamera.updateMatrixWorld();assert.deepEqual(culler.updateBatches(lodCamera).levels,[3,0,0],'full-detail comparison disables all lower levels');
// Roof batches use original geometry/materials and cull each selected instance independently.
const {batchRoofTiles}=await import('../src/scene-details.js');
const roofRoot=new T.Group(),roofMaterial=new T.MeshStandardMaterial(),roofLevels=[0,1,2].map(()=>({geometry:new T.BoxGeometry(1,1,1)}));
const roofs=[0,2,50,-1].map((x,i)=>{
 const mesh=new T.Mesh(roofLevels[0].geometry,roofMaterial);mesh.name=T.PropertyBinding.sanitizeNodeName('Roof tile courses / test');mesh.position.set(x,0,-10);if(i===3)mesh.scale.x=-1;roofRoot.add(mesh);
 return {mesh,levels:roofLevels,history:{main:i%3,reflection:0,shadow:0}};
});roofRoot.updateMatrixWorld(true);
const roofsBatch=batchRoofTiles(roofRoot,roofs),roofCamera=new T.PerspectiveCamera(60,1,.1,100);roofCamera.updateMatrixWorld();
assert.equal(roofsBatch.instances,3,'negative-scale meshes stay on the original path');
roofsBatch.update(roofCamera,'main',roofCamera);
assert.deepEqual(roofsBatch.batches[0].meshes.map(m=>m.count),[0,1,0]);
assert(roofs[0].mesh.visible,'the finest roof geometry retains original transform precision');
assert(roofsBatch.batches[0].meshes.every((m,i)=>m.geometry===roofLevels[i].geometry&&m.material===roofMaterial),'geometry and paint are reused');
const roofMatrix=new T.Matrix4();roofsBatch.batches[0].meshes[1].getMatrixAt(0,roofMatrix);
assert.deepEqual(roofMatrix.elements,roofs[1].mesh.matrixWorld.elements,'same world transform');
roofs[2].history.reflection=1;roofs[2].history.shadow=1;roofCamera.position.x=50;roofCamera.updateMatrixWorld();roofsBatch.update(roofCamera,'reflection',roofCamera);
assert.deepEqual(roofsBatch.batches[0].meshes.map(m=>m.count),[0,1,0],'reflection uses its own visibility and level');
roofsBatch.update(new T.PerspectiveCamera(),'shadow',roofCamera);assert.equal(roofsBatch.batches[0].meshes[1].count,1,'shadow uses the light camera');
assert.equal(roofs[1].history.main,1);
roofsBatch.enabled=false;roofsBatch.update(roofCamera,'main',roofCamera);assert(roofs.every(e=>e.mesh.visible)&&roofsBatch.batches[0].meshes.every(m=>!m.visible),'original draw path remains a comparison oracle');

// Static world transforms stay fixed while children of moving vessel rigs still update.
const {freezeDetailTransforms}=await import('../src/scene-details.js');
const transformRoot=new T.Group(),staticMesh=new T.Mesh(),vesselRig=new T.Group(),vesselChild=new T.Mesh();
transformRoot.add(staticMesh,vesselRig);vesselRig.add(vesselChild);vesselRig.matrixAutoUpdate=false;transformRoot.updateMatrixWorld(true);
const unfreeze=freezeDetailTransforms(transformRoot,[vesselRig]);vesselRig.matrix.makeTranslation(7,0,0);vesselRig.matrixWorldNeedsUpdate=true;transformRoot.updateMatrixWorld(true);
assert.equal(vesselChild.matrixWorld.elements[12],7);assert.equal(staticMesh.matrixWorld.elements[12],0);assert.equal(staticMesh.matrixWorldAutoUpdate,false);
unfreeze(false);assert.equal(staticMesh.matrixAutoUpdate,true);assert.equal(vesselRig.matrixAutoUpdate,false);

// Paused frames are reused, but camera/settings/size changes and resume render immediately.
globalThis.devicePixelRatio=1;
let rendered=0;
const idleEngine=Object.assign(Object.create(ThreeCityEngine.prototype),{animate:false,canvas:{clientWidth:1280,clientHeight:720},style:{settings:{enabled:1}},river:{strength:1,flow:.26,debug:0},hidden:new Set(),render(){rendered++;this.shadowDirty=false;return {frame:rendered};}});
const idleCamera={eye:[0,0,10],target:[0,0,0],fov:49};
assert(idleEngine.renderIfChanged(idleCamera,1));assert.equal(idleEngine.renderIfChanged(idleCamera,2),null);assert.equal(idleEngine.clockLast,2,'idle time cannot become a catch-up simulation step');
for(const change of [()=>idleCamera.eye[0]++,()=>idleEngine.style.settings.enabled=0,()=>idleEngine.river.strength=1.2,()=>idleEngine.hidden.add('trees'),()=>idleEngine.canvas.clientWidth=1920,()=>idleEngine.captureSize=[3840,2160]]){
 change();assert(idleEngine.renderIfChanged(idleCamera,3));assert.equal(idleEngine.renderIfChanged(idleCamera,4),null);
}
idleEngine.shadowDirty=true;assert(idleEngine.renderIfChanged(idleCamera,4.5),'explicit invalidation redraws an otherwise unchanged paused scene');assert.equal(idleEngine.renderIfChanged(idleCamera,4.6),null);
idleEngine.animate=true;assert(idleEngine.renderIfChanged(idleCamera,5));assert(idleEngine.renderIfChanged(idleCamera,6));

idleEngine.animate=false;idleEngine.recording=true;assert(idleEngine.renderIfChanged(idleCamera,7));assert(idleEngine.renderIfChanged(idleCamera,8),'paused video capture still receives frames');

// Off and zero-outline styles skip the city pass, while output and silk support still render.
const passDraws=[],passRenderer={isWebGLRenderer:true,capabilities:{isWebGL2:false},domElement:{clientWidth:16,clientHeight:16},shadowMap:{},getPixelRatio:()=>1,getDrawingBufferSize:v=>v.set(16,16),getRenderTarget:()=>null,getClearColor:v=>v.set(0),getClearAlpha:()=>1,getScissorTest:()=>false,getViewport:v=>v.set(0,0,16,16),getScissor:v=>v.set(0,0,16,16),setRenderTarget(){},setClearColor(){},setScissorTest(){},setViewport(){},setScissor(){},clear(){},render:scene=>passDraws.push(scene)};
const outlinePass=new QingmingPass(passRenderer,style),outlineScene=new T.Scene(),outlineMesh=new T.Mesh(new T.BoxGeometry(),painted);outlineScene.add(outlineMesh);
for(const [enabled,lineStrength,expected]of [[0,.5,1],[1,0,1],[1,.5,2]]){
 style.set({enabled,lineStrength});passDraws.length=0;outlinePass.render(outlineScene,roofCamera,null,{colorTexture:new T.Texture()});
 assert.equal(passDraws.length,expected);assert.equal(passDraws.at(-1),outlinePass.fullscreen);assert.equal(outlineMesh.material,painted,'temporary normal materials are restored');
}
outlinePass.dispose();

// Interleaved LOD batches must route exactly like per-asset contiguous ones.
const tierAsset=()=>({center:[0,0,0],radius:1,category:'people',matrices:[5,20,120].map(z=>new Float32Array(new T.Matrix4().makeTranslation(0,0,-z).elements)),lodState:{main:new Uint8Array(3),reflection:new Uint8Array(3),shadow:new Uint8Array(3)}});
const tierBatch=(a,lod)=>({a,lod,lodCount:3,matrices:new Float32Array(48),meta:new T.InstancedBufferAttribute(new Float32Array(3),1),meshes:[{geometry:{drawRange:{count:300/(lod+1)}},instanceMatrix:new T.InstancedBufferAttribute(new Float32Array(48),16)}]});
const fakeCuller=batches=>Object.assign(Object.create(ThreeCityEngine.prototype),{batches,hidden:new Set(),sunLight:sun,frustum:new T.Frustum(),shadowFrustum:new T.Frustum(),_vp:new T.Matrix4(),_sphere:new T.Sphere(),height:720,lodEnabled:true});
const mixCamera=new T.PerspectiveCamera(49,1,.15,1000);mixCamera.updateMatrixWorld();
const spreadA=tierAsset(),spreadB=tierAsset(),blockA=tierAsset(),blockB=tierAsset();
const spread=fakeCuller([tierBatch(spreadA,0),tierBatch(spreadB,0),tierBatch(spreadA,1),tierBatch(spreadB,2),tierBatch(spreadA,2),tierBatch(spreadB,1)]);
const blocked=fakeCuller([tierBatch(blockA,0),tierBatch(blockA,1),tierBatch(blockA,2),tierBatch(blockB,0),tierBatch(blockB,1),tierBatch(blockB,2)]);
const spreadStats=spread.updateBatches(mixCamera),blockStats=blocked.updateBatches(mixCamera);
assert.deepEqual(spreadStats.levels,[2,0,4],'interleaved batches still assign every instance to exactly one tier');
assert.deepEqual(spreadStats.levels,blockStats.levels,'batch layout cannot change level totals');
for(const [asset,pair] of [[spreadA,blockA],[spreadB,blockB]])for(let lod=0;lod<3;lod++){
 const inter=spread.batches.find(b=>b.a===asset&&b.lod===lod),cont=blocked.batches.find(b=>b.a===pair&&b.lod===lod);
 assert.deepEqual(inter.matrices,cont.matrices,`lod${lod} instance matrices are layout-independent`);
 assert.deepEqual(inter.meta.array,cont.meta.array,`lod${lod} metadata is layout-independent`);
}
spread.hidden.add('people');
assert.equal(spread.updateBatches(mixCamera).instances,0,'a hidden category empties every one of its batches');
for(const b of spread.batches){
 assert.equal(b.count,0);assert.equal(b.meshes[0].visible,false);
 assert.deepEqual(b.meta.updateRanges,[]);assert.deepEqual(b.meshes[0].instanceMatrix.updateRanges,[]);
}
// Single-LOD assets: a missing lodCount and an explicit 1 take the same path.
const soloAsset={center:[0,0,0],radius:1,category:'city',matrices:[7,8].map(z=>new Float32Array(new T.Matrix4().makeTranslation(0,0,-z).elements))};
const soloBatch=lodCount=>({a:soloAsset,lod:0,lodCount,matrices:new Float32Array(32),meta:new T.InstancedBufferAttribute(new Float32Array(2),1),meshes:[{geometry:{drawRange:{count:9}},instanceMatrix:new T.InstancedBufferAttribute(new Float32Array(32),16)}]});
const soloImplicit=fakeCuller([soloBatch()]),soloExplicit=fakeCuller([soloBatch(1)]);
assert.deepEqual(soloImplicit.updateBatches(mixCamera).levels,[2,0,0],'an asset without lodCount keeps every visible instance on its only batch');
assert.deepEqual(soloExplicit.updateBatches(mixCamera).levels,[2,0,0],'an explicit lodCount of 1 behaves identically');
assert.deepEqual(soloImplicit.batches[0].matrices,soloExplicit.batches[0].matrices);
assert.equal(soloImplicit.batches[0].matrices[30],-8,'instances stay written in ascending compact order');
// GPU error polling is gated: unchecked frames report null, flagged frames poll once.
let errorPolls=0;const pollEngine=Object.assign(Object.create(ThreeCityEngine.prototype),{gl:{getError(){errorPolls++;return 0;}},error:0,gpuErrorCheck:false});
assert.equal(pollEngine.checkGPU(),null,'an unchecked frame must not imply a passed GPU check');
assert.equal(errorPolls,0);
pollEngine.gpuErrorCheck=true;assert.equal(pollEngine.checkGPU(),0);assert.equal(errorPolls,1);assert.equal(pollEngine.gpuErrorCheck,false,'the flag clears after one check');
pollEngine.gpuErrorCheck=true;pollEngine.gl={getError(){errorPolls++;return 0x505;}};
assert.throws(()=>pollEngine.checkGPU(),/WebGL error code/);

console.log(JSON.stringify({three:T.REVISION,bridgeCrossing:p,doors:world.doors.length,residentialTransforms:'aligned',boatDistance:life.stats.boatDistance,cargo:initial,materialDeformation:'identical',status:'passed'},null,2));

const {difference,shadowDifference}=await import("./optimization-browser.js");
assert.equal(difference(new Uint8Array([1,2,3,4]),new Uint8Array([1,2,3,4])).rmse,0);
for(const compare of [difference,shadowDifference])assert.throws(()=>compare(new Uint8Array(4),new Uint8Array(8),1),RangeError);
// Auto subpixel hysteresis keeps an actor hidden until its image grows past 5px.
Object.assign(lodAsset,{rig:'adult',pixelVisible:{main:new Uint8Array(3).fill(1)},shadowVisible:new Uint8Array(3).fill(1)});
culler.quality='auto';lodCamera.position.set(0,0,0);lodCamera.updateMatrixWorld();
for(const [diameter,expected] of [[2.9,0],[4.9,0],[5.1,1],[3.1,1]]){
 culler.height=diameter/projectedDiameter(lodCamera,1,0,0,-5,1);culler.updateBatches(lodCamera);assert.equal(lodAsset.pixelVisible.main[0],expected);
}
