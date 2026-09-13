import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
registerHooks({resolve(specifier,ctx,next){if(specifier==='qingming/micro')return {url:new URL('src/micro.js',root).href,shortCircuit:true};if(specifier==='three/core')return {url:new URL('vendor/three.core.js',root).href,shortCircuit:true};if(specifier==='three')return {url:new URL('vendor/three.module.js',root).href,shortCircuit:true};return next(specifier);}});
const {CollisionWorld,CrowdSystem,CityEcology,multiply,Z_TO_Y}=await import('../src/simulation.js');
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const [manifest,nav,rigs,eco]=await Promise.all(['city','navigation','rigs','ecology'].map(x=>json(`public/runtime/${x}.json`)));
// Same asset staging as three-engine.js / contracts.mjs; each crowd gets its own
// writable matrix copies so the two parity systems cannot share mutated state.
const buildAssets=()=>manifest.assets.map(a=>({...a,baseMatrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),matrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),centers:a.instances.map(()=>[0,0,0])}));
const world=new CollisionWorld(nav);
const eye=[-5,3.8,-26]; // app view "Street Life": world([-5,26,3.8]) = [x,z,-y]
const rowBytes=rigs.jointsPerRig*16*4;

// One crowd assembled exactly like the engine does it (crowd -> life -> attach).
const engine={sourceAssets:buildAssets(),playerPosition:null,fixedTime:undefined,renderer:{properties:{get:()=>({})}},gl:null,life:null};
const crowd=new CrowdSystem(engine,rigs,world);
const life=new CityEcology(eco,world);life.attachPeople(crowd.actors);engine.life=life;
assert.equal(crowd.actors.length,584);
assert.equal(crowd.jointCount,rigs.jointsPerRig);
assert.equal(crowd.palettes.byteLength,584*rowBytes);

// First update (fixedTime re-poses every actor): one full-palette upload.
engine.fixedTime=.5;
crowd.update(.5,1/30,eye);
assert.equal(crowd.stats.visiblePoseUpdates,crowd.actors.length);
assert.equal(crowd.uploadStats.calls,1);
assert.equal(crowd.uploadStats.fullUploads,1);
assert.equal(crowd.uploadStats.bytes,crowd.palettes.byteLength);
assert.equal(crowd.uploadStats.strategy,'full');
assert.ok(crowd.dirty.every(v=>v===0));
assert.equal(crowd.dirtyRowStats.all,1);

// A repeated identical frame (paused, dt=0, same time) poses nothing and must
// not upload at all - the old code resent the full 1.1 MiB texture here.
engine.fixedTime=undefined;
crowd.update(.5,0,eye);
assert.equal(crowd.uploadStats.strategy,'skip');
assert.equal(crowd.uploadStats.skippedUpdates,1);
assert.equal(crowd.uploadStats.calls,1);
assert.equal(crowd.dirtyRowStats['0'],1);

// One advancing step: the distance throttle re-poses only part of the crowd,
// the upload stays a single full resend, and every dirty bit clears with it.
const t1=.5+1/30,bytes0=crowd.uploadStats.bytes,full0=crowd.uploadStats.fullUploads;
crowd.update(t1,1/30,eye);
const posed=crowd.actors.filter(a=>a.lastPose===t1).length;
assert.ok(posed>0&&posed<crowd.actors.length,'distance throttling keeps most rows clean');
assert.equal(crowd.stats.visiblePoseUpdates,posed);
assert.equal(crowd.uploadStats.fullUploads,full0+1);
assert.equal(crowd.uploadStats.bytes,bytes0+crowd.palettes.byteLength);
assert.ok(crowd.dirty.every(v=>v===0));

// Direct poses between updates accumulate: one update clears every held bit.
const held=crowd.actors.filter(a=>a.lastPose!==t1).slice(0,5);
for(const a of held)crowd.pose(a,t1+.001);
assert.deepEqual(crowd.dirty.reduce((out,v,r)=>{if(v)out.push(r);return out;},[]),held.map(a=>a.id));
const full1=crowd.uploadStats.fullUploads,bytes1=crowd.uploadStats.bytes;
crowd.update(t1,0,eye);
assert.equal(crowd.uploadStats.fullUploads,full1+1);
assert.equal(crowd.uploadStats.bytes,bytes1+crowd.palettes.byteLength);
assert.ok(crowd.dirty.every(v=>v===0));

// A backward time jump re-poses every row and lands in the 'all' bucket.
const all0=crowd.dirtyRowStats.all;
crowd.update(t1-1,1/30,eye);
assert.equal(crowd.stats.visiblePoseUpdates,crowd.actors.length);
assert.equal(crowd.dirtyRowStats.all,all0+1);
assert.equal(crowd.uploadStats.strategy,'full');
assert.ok(crowd.dirty.every(v=>v===0));
// Nothing overdue right after the reversal: a clean frame skips the upload.
const skip0=crowd.uploadStats.skippedUpdates;
crowd.update(t1-1,0,eye);
assert.equal(crowd.uploadStats.skippedUpdates,skip0+1);

// Parity and the real dirty-row distribution: two independently built crowds
// driven through the same step sequences must stay bit-identical, and the
// per-step visiblePoseUpdates series is the exact dirty-row distribution the
// upload-policy decision was measured against (street cameras burst to 150-300
// rows; overview cameras idle near zero).
const engineA={sourceAssets:buildAssets(),playerPosition:null,fixedTime:undefined,renderer:{properties:{get:()=>({})}},gl:null,life:null};
const engineB={sourceAssets:buildAssets(),playerPosition:null,fixedTime:undefined,renderer:{properties:{get:()=>({})}},gl:null,life:null};
const crowdA=new CrowdSystem(engineA,rigs,world),crowdB=new CrowdSystem(engineB,rigs,world);
const lifeA=new CityEcology(eco,world),lifeB=new CityEcology(eco,world);
lifeA.attachPeople(crowdA.actors);lifeB.attachPeople(crowdB.actors);
engineA.life=lifeA;engineB.life=lifeB;
const series=[];
const runSeries=(label,viewEye,steps)=>{
 const hist0={...crowdB.dirtyRowStats},stats0={...crowdB.uploadStats},per=[];let t=0;
 for(let i=0;i<steps;i++){t+=1/30;lifeA.step(1/30);lifeB.step(1/30);crowdA.update(t,1/30,viewEye);crowdB.update(t,1/30,viewEye);per.push(crowdB.stats.visiblePoseUpdates);}
 assert.deepEqual(crowdB.palettes,crowdA.palettes,label+': both crowds share one deterministic CPU pose stream');
 const buckets={};let counted=0;for(const k in crowdB.dirtyRowStats){buckets[k]=crowdB.dirtyRowStats[k]-hist0[k];counted+=buckets[k];}
 assert.equal(counted,steps); // every update() call buckets its dirty-row count exactly once
 const sorted=[...per].sort((a,b)=>a-b);
 series.push({view:label,eye:viewEye,steps,buckets,dirtyRowsPerStep:{min:sorted[0],median:sorted[steps>>1],mean:+(per.reduce((s,v)=>s+v,0)/steps).toFixed(1),p95:sorted[Math.ceil(steps*.95)-1],max:sorted[steps-1]},
  upload:{calls:crowdB.uploadStats.calls-stats0.calls,fullUploads:crowdB.uploadStats.fullUploads-stats0.fullUploads,skippedUpdates:crowdB.uploadStats.skippedUpdates-stats0.skippedUpdates,bytes:crowdB.uploadStats.bytes-stats0.bytes}});
};
runSeries('Street Life (world([-5,26,3.8]))',eye,240);
runSeries('Overview (world([45,-55,43]))',[45,43,55],240);
// Record the real dynamic-scene dirty-row distribution for this batch's report.
console.log(JSON.stringify({actors:crowdB.actors.length,paletteBytes:crowdB.palettes.byteLength,rowBytes,series},null,2));
console.log(JSON.stringify({actors:584,parity:'identical',status:'passed'},null,2));
// Every authored clip/keyframe and halfway interpolation uses finite rigid joints.
let poses=0;for(const rig of Object.values(rigs.rigs)){
 const a=crowd.actors.find(a=>a.rig===rig);assert(a);Object.assign(a,{walk:false,lifeMoving:false,phase:0,blend:1});
 for(const [name,clip] of Object.entries(rig.clips))for(let f=0;f<2*(clip.frames-1);f++){
  a.clip=name;crowd.pose(a,clip.duration*f/(2*(clip.frames-1)));assert(a.worldMatrices.every(Number.isFinite));
  for(let j=0;j<31;j++){const m=a.worldMatrices.subarray(j*16,j*16+16);for(let c=0;c<3;c++)assert(Math.abs(Math.hypot(...m.subarray(c*4,c*4+3))-1)<1e-5,'joint basis remains rigid');}poses++;
 }
}
for(const a of crowd.actors.filter(a=>a.crew))assert(life.boats.some(b=>b.id===a.a.instances[a.index].motion.group),'every crew member retains an existing boat binding');
console.log(JSON.stringify({authoredAndInterpolatedPoses:poses,crewBindings:'valid'}));
