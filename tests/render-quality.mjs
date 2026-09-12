import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
registerHooks({resolve(specifier,ctx,next){const file={'three':'vendor/three.module.js','three/core':'vendor/three.core.js','qingming/micro':'src/micro.js'}[specifier];return file?{url:new URL(file,root).href,shortCircuit:true}:next(specifier,ctx);}});
const T=await import('three');
const {ThreeRiver}=await import('../src/three-water.js');
const {ThreeCityEngine}=await import('../src/three-engine.js');
for(const quality of ['auto','cinema']){
let target=null,syncReads=0,asyncReads=0,settle,rejectRead,packBinding=null;
const river=Object.assign(Object.create(ThreeRiver.prototype),{engine:{quality,animate:true},uniforms:{uTime:{value:0},uWaveScale:{value:1}},steps:0,queryWidth:10,queryData:new Float32Array(40),queryPixels:new Float32Array(40),queryTexture:{},queryTarget:{},sampleCache:new Map(),boatSamples:new Map(),boatSampleTime:-Infinity,pendingQuery:null});
const fill=(pixels,time)=>{for(let i=0;i<10;i++)pixels.set([time+i*.01,0,0,1],i*4);return pixels;};
river.renderer={getRenderTarget:()=>target,setRenderTarget:t=>target=t,render(){},getClearColor:c=>c,getClearAlpha:()=>1,setClearColor(){},clear(){},getContext:()=>({PIXEL_PACK_BUFFER:1,bindBuffer:(_,v)=>packBinding=v}),readRenderTargetPixels:(_t,_x,_y,_w,_h,p)=>{syncReads++;fill(p,river.uniforms.uTime.value);},readRenderTargetPixelsAsync:(_t,_x,_y,_w,_h,p)=>{asyncReads++;packBinding='native PBO';const time=river.uniforms.uTime.value;return new Promise((resolve,reject)=>{settle=()=>resolve(fill(p,time));rejectRead=reject;});}};
const boats=[{id:4,p:[0,0],heading:0},{id:9,p:[20,0],heading:0}];
river.sampleBoats(boats);assert.equal(syncReads,1);assert.equal(river.sampleCache.size,10);
river.uniforms.uTime.value=.03;boats[0].p[0]+=.1;river.sampleBoats(boats);
assert.equal(asyncReads,1);assert.equal(packBinding,null,'native readback releases its binding before other synchronous readers');
const pending=river.pendingQuery;river.uniforms.uTime.value=.06;boats[0].p[0]+=.1;river.sampleBoats(boats);
for(const b of boats)for(const [x,z]of [[b.p[0],0],[b.p[0]+2,0],[b.p[0]-2,0],[b.p[0],-1],[b.p[0],1]])river.sampleSurface(x,z);
assert.equal(syncReads,1,'moving hulls use the previous batch without per-point stalls');assert.equal(asyncReads,1,'one batch in flight');assert.equal(river.sampleCache.size,10,'only current hull coordinates are retained');
settle();await pending.promise;boats.reverse();river.sampleBoats(boats);
assert(Math.abs(river.sampleSurface(boats[0].p[0],0).height-(.28+.03+.05))<1e-6,'reordered boats retain their own samples');
// Pausing replaces delayed data immediately; an older completion cannot overwrite it.
const delayed=river.pendingQuery,completeOld=settle;river.engine.animate=false;river.uniforms.uTime.value=.1;river.sampleBoats(boats);const immediate=river.sampleSurface(boats[0].p[0],0).height;
completeOld();await delayed.promise;assert.equal(river.sampleSurface(boats[0].p[0],0).height,immediate);
const free=river.sampleSurface(100,2).height;river.uniforms.uTime.value=.2;assert.notEqual(river.sampleSurface(100,2).height,free,'world samples expire when the water changes');
assert.throws(()=>river.sampleSurface(NaN,0),RangeError);assert.throws(()=>river.samplePoints([[Infinity,0]]),RangeError);
river.engine.animate=true;river.sampleBoats(boats);const beforeReset=river.pendingQuery,completeReset=settle;river.reset();completeReset();await beforeReset.promise;assert.equal(river.boatSamples.size,0,'reset discards delayed pre-reset data');
river.sampleBoats(boats);river.sampleBoats(boats);const failed=river.pendingQuery;rejectRead(new Error('readback failed'));await failed.promise;assert.throws(()=>river.sampleBoats(boats),/readback failed/);river.reset();
}
const painted=new T.MeshStandardMaterial(),water=new T.ShaderMaterial();
const engine=Object.assign(Object.create(ThreeCityEngine.prototype),{renderer:{shadowMap:{type:T.PCFSoftShadowMap}},sunLight:new T.DirectionalLight(),style:{materials:new Set([painted])},river:{material:water},_passQueries:[],resize(){}});
engine.setQuality('auto');assert.equal(engine.settings.shadow,1024);assert.equal(engine.settings.samples,2);assert.equal(engine.renderer.shadowMap.type,T.PCFSoftShadowMap);const version=painted.version;engine.shadowDirty=false;engine.setQuality('auto');assert.equal(painted.version,version);assert.equal(engine.shadowDirty,false,'same tier does not invalidate every measured frame');engine.setQuality('cinema');assert.equal(engine.settings.shadow,1024);assert.equal(engine.settings.samples,2);assert.equal(engine.lodEnabled,true,'Cinema uses distance LOD');assert.equal(engine.lodDetailScale,1.5);assert.equal(engine.sunLight.shadow.mapSize.x,1024);assert.equal(engine.renderer.shadowMap.type,T.PCFSoftShadowMap);assert.throws(()=>engine.setQuality('bad'),RangeError);
// Exercise actual resize allocation with a Retina display, explicit Native, and export overrides.
const previousDPR=globalThis.devicePixelRatio;
globalThis.devicePixelRatio=2;
try{
 const resized=Object.assign(Object.create(ThreeCityEngine.prototype),{canvas:{clientWidth:1000,clientHeight:600},maxPixelRatio:1.25,settings:{samples:4},renderer:{setPixelRatio(){},setSize(){}}});
 for(const quality of ['auto','cinema']){
  resized.quality=quality;resized.resize();assert.equal(resized.width,1250);assert.equal(resized.height,750);
  resized.maxPixelRatio=1;resized.resize();assert.equal(resized.width,1000);
  resized.maxPixelRatio=Infinity;resized.resize();assert.equal(resized.width,2000);
  resized.captureSize=[3840,2160];resized.resize();assert.equal(resized.width,3840);assert.equal(resized.height,2160);
  resized.captureSize=null;resized.maxPixelRatio=1.25;resized.resize();assert.equal(resized.width,1250);
 }
 resized.final.dispose();
}finally{if(previousDPR===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previousDPR;}
Object.assign(engine,{sunHour:15.5,time:0,sunDirection:new T.Vector3(),skyMaterial:{uniforms:{sun:{},clock:{}}},navigation:{lights:[]},localLights:[]});
const camera=new T.PerspectiveCamera();camera.position.set(6,3.3,8);camera.lookAt(0,2,0);camera.updateMatrixWorld();
engine.lighting(camera);const originalCenter=engine.sunLight.target.position.clone(),originalSpan=engine.sunLight.shadow.camera.right;
engine.setQuality('auto');engine.lighting(camera);assert(engine.sunLight.target.position.equals(originalCenter));assert.equal(engine.sunLight.shadow.camera.right,originalSpan,'both tiers preserve the original shadow projection');
engine.setQuality('cinema');engine.lighting(camera);assert(engine.sunLight.target.position.equals(originalCenter));assert.equal(engine.sunLight.shadow.camera.right,originalSpan,'cinema keeps the original unsnapped projection');
engine.localLights=Array.from({length:6},()=>new T.PointLight());
engine.quality='auto';engine.style.performancePaint=true;
engine.navigation.lights=[{position:[6,-8,3.3],color:[1,1,1],radius:8}];
engine.lighting(camera);assert.equal(engine.localLights.filter(l=>l.visible).length,0,'full paint has no point-light shader variants');
engine.navigation.lights=[];engine.lighting(camera);assert.equal(engine.localLights.filter(l=>l.visible).length,0);
engine.style.performancePaint=false;engine.lighting(camera);assert.equal(engine.localLights.filter(l=>l.visible).length,6,'PBR keeps a fixed six-light shader layout, including zero-intensity slots');
const {makeCityMaterials}=await import('../src/three-materials.js');
const materialEngine={data:{manifest:{materials:['red','blue'].map((name,i)=>({name,extras:{surface:'cloth'},pbrMetallicRoughness:{baseColorFactor:[1-i,0,i,1]}}))},images:[]},renderer:{capabilities:{getMaxAnisotropy:()=>1}},crowd:{jointCount:31,actors:[],texture:{}},lifeBinding:{texture:{}},style:{decorateMaterial(){}},time:0};
makeCityMaterials(materialEngine);const asset={name:'Person',rig:'adult',category:'people'};
const red=materialEngine.getCityMaterial(0,asset),blue=materialEngine.getCityMaterial(1,asset);
assert.notEqual(red,blue);assert(!red.color.equals(blue.color));assert.equal(red.customProgramCacheKey(),blue.customProgramCacheKey(),'color variants share identical shader code');
const source=mat=>{const s={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};mat.onBeforeCompile(s);return [s.vertexShader,s.fragmentShader];};
assert.deepEqual(source(red),source(blue));assert.notEqual(red.customProgramCacheKey(),materialEngine.getCityMaterial(0,{name:'Static',category:'city'}).customProgramCacheKey(),'different deformation code retains a distinct key');
console.log('Rendering quality contracts passed: moving/late/reset/failed samples, bounded cache, quality isolation, original shadow projection, stable light layout.');
