import {HalfFloatType,LinearFilter,UnsignedIntType,WebGLRenderTarget,DepthTexture} from 'three';
import {render as baselineRender,updateBatches as baselineBatches,crowdUpdate as baselineCrowdUpdate,harness} from './perfreview-baseline.js';

function difference(a,b){
 let changed=0,max=0,squared=0;
 for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d);squared+=d*d;}
 return {changed,max,rmse:Math.sqrt(squared/a.length)};
}
// Batch 2 visual gate: byte-domain RMSE plus the share of channels drifting
// beyond 8/255 (impulse errors such as shifted MSAA edges or refraction taps).
function regionStats(a,b,x0,y0,x1,y1,width){
 let squared=0,hot=0,n=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*width+x)*4;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);if(d>8)hot++;squared+=d*d;n++;}}
 return {rmse:Math.sqrt(squared/Math.max(1,n)),hotRatio:hot/Math.max(1,n),channels:n,hot};
}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const p95=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.max(0,Math.ceil(s.length*.95)-1)];};
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const BUFFERS=['normal','shadow','reflection','refraction'];

/** A/B baseline for this optimization round: ?perfreview=1; add &full=1 for
 *  three styles × ten views at 4K plus before/after evidence captures.
 *  Side A = frozen tests/perfreview-baseline.js; side B = live engine methods.
 *  LOD stays on its default automatic thresholds for both sides; every compared
 *  frame starts from an identical copy of the per-pass LOD hysteresis history. */
export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification');
 const full=new URLSearchParams(location.search).has('full'),PAIRS=20;
 // Batch 2 gate: the live engine renders through the refraction-reuse sequence
 // (main pass copied into a full-resolution snapshot + overlay water). When the
 // flag is absent everything below behaves exactly like the previous batch.
 const batch2=engine.renderSequence==='refraction-reuse';
 // Batch 2 compares only the buffers both sides still produce at the same
 // resolution; refraction is recorded by size instead.
 const compareBuffers=batch2?BUFFERS.filter(k=>k!=='refraction'):BUFFERS;
 const report={status:'running',started:new Date().toISOString(),resolution:full?[3840,2160]:[1280,720],pairs:PAIRS,
  sideA:'frozen tests/perfreview-baseline.js (render/updateBatches/crowdUpdate as of batch 0)',sideB:'live engine methods',
  correctness:{status:'not executed'},visual:{status:'not executed'},performance:{status:'not executed'},raw:{status:'not executed'},crowdDynamic:{status:'not executed'},crowdUpload:{status:'not executed'},warnings:[]};
 if(batch2){
  report.mode='refraction-reuse';
  report.sideA+=' with a harness-substituted half-resolution refraction target (reproduces the original two-pass city draw)';
  report.sideB='live engine methods (single city draw, snapshot copy, overlay water)';
 }
 const saved={roofs:engine.details.userData.roofBatches.enabled,lod:engine.lodEnabled,animate:engine.animate,size:engine.captureSize,fixed:engine.fixedTime,exporting:engine.exporting,preset:engine.style.preset,settings:{...engine.style.settings}};
 const crowd=engine.crowd,natives={render:engine.render,updateBatches:engine.updateBatches,crowdUpdate:crowd.update};
 // Optional sweep entry: &crowdlimit=N pins crowd.partialRowLimit (0 disables partial uploads).
 const crowdlimitParam=new URLSearchParams(location.search).get('crowdlimit');
 if(crowd.partialRowLimit!==undefined&&crowdlimitParam!==null&&Number.isFinite(+crowdlimitParam))crowd.partialRowLimit=Math.max(0,Math.floor(+crowdlimitParam));
 report.crowdLimit=crowd.partialRowLimit??null;
 const r=engine.renderer,gl=engine.gl,syncPixel=new Uint8Array(4);
 const show=()=>output.textContent=JSON.stringify(report,null,2);
 // readPixels, unlike command submission, waits for completed GPU work.
 const finish=()=>{r.setRenderTarget(null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,syncPixel);};
 const read=target=>{const p=target.texture.type===HalfFloatType?new Uint16Array(target.width*target.height*4):new Uint8Array(target.width*target.height*4);r.readRenderTargetPixels(target,0,0,target.width,target.height,p);return p;};
 const snapshot=()=>{
  const pixels=new Uint8Array(engine.width*engine.height*4);r.setRenderTarget(null);gl.readPixels(0,0,engine.width,engine.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const data={pixels,normal:read(engine.post.normalTarget),shadow:read(engine.sunLight.shadow.map),reflection:read(engine.river.reflection),refraction:batch2?null:read(engine.river.refraction)};
  // Batch 2: the two refraction buffers live at different resolutions by
  // design (A: half-res render target, B: full-res snapshot copy), so only the
  // sizes are recorded - the pixels are not compared.
  if(batch2)data.refractionSize=[engine.river.refraction.width,engine.river.refraction.height];
  if(gl.getError())throw Error('Buffer read failed');return data;
 };
 const run=method=>method.call(engine,app.camera(),engine.clockLast);
 // Both sides must face identical hysteresis: snapshot/restore the per-pass LOD
 // history (source assets + detail meshes) around every warmup, sampled and
 // compared frame, and restore the original state when the round is over.
 const snapshotLOD=()=>({assets:engine.sourceAssets.map(a=>({main:new Uint8Array(a.lodState.main),reflection:new Uint8Array(a.lodState.reflection),shadow:new Uint8Array(a.lodState.shadow)})),details:(engine.details?.userData.lodMeshes||[]).map(e=>({main:e.history.main,reflection:e.history.reflection,shadow:e.history.shadow}))});
 const restoreLOD=s=>{engine.sourceAssets.forEach((a,i)=>{const h=s.assets[i];a.lodState.main.set(h.main);a.lodState.reflection.set(h.reflection);a.lodState.shadow.set(h.shadow);});(engine.details?.userData.lodMeshes||[]).forEach((e,i)=>{const h=s.details[i];e.history.main=h.main;e.history.reflection=h.reflection;e.history.shadow=h.shadow;});};
 const stage={A:{batches:0,crowd:0},B:{batches:0,crowd:0}};
 const upload={A:{calls:0,bytes:0},B:{calls:0,bytes:0}};
 // Batch 2: side A must keep rendering the ORIGINAL implementation - a real
 // half-resolution refraction draw of the whole scene. The engine's refraction
 // target is now the full-resolution snapshot, so every A-side render is wrapped
 // with a harness-built half-resolution substitute (color + UnsignedInt depth,
 // capture size / 2) and the water uniforms are pointed at it; both are restored
 // immediately afterwards. baseline render() calls river.renderSources, so the
 // substitution is picked up automatically.
 let altRefraction=null;
 const swapHalfRes=()=>{
  if(!batch2)return()=>{};
  if(!altRefraction){
   const w=Math.max(1,report.resolution[0]>>1),h=Math.max(1,report.resolution[1]>>1);
   altRefraction=new WebGLRenderTarget(w,h,{type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter});
   altRefraction.depthTexture=new DepthTexture(w,h,UnsignedIntType);
  }
  const river=engine.river,orig={target:river.refraction,color:river.uniforms.uSceneColor.value,depth:river.uniforms.uSceneDepth.value};
  river.refraction=altRefraction;altRefraction.__origTarget=orig.target;river.uniforms.uSceneColor.value=altRefraction.texture;river.uniforms.uSceneDepth.value=altRefraction.depthTexture;
  return()=>{river.refraction=orig.target;river.uniforms.uSceneColor.value=orig.color;river.uniforms.uSceneDepth.value=orig.depth;};
 };
 const renderSide={
  A:function(c,time){if(!batch2)return baselineRender.call(this,c,time);const restore=swapHalfRes();try{return baselineRender.call(this,c,time);}finally{restore();}},
  B:function(c,time){return natives.render.call(this,c,time);}
 };
 const timed=(fn,side,key)=>function(...args){const t0=performance.now();try{return fn.apply(this,args);}finally{stage[side][key]+=performance.now()-t0;}};
 function installSide(side,sampling){
  if(side==='A'){
   engine.render=renderSide.A;
   engine.updateBatches=sampling?timed(baselineBatches,'A','batches'):(...args)=>baselineBatches.apply(engine,args);
   harness.crowdUpdate=sampling?function(time,dt,eye){const t0=performance.now();try{return baselineCrowdUpdate.call(this,time,dt,eye);}finally{stage.A.crowd+=performance.now()-t0;upload.A.calls++;upload.A.bytes+=crowd.palettes.byteLength;}}:null;
   crowd.update=natives.crowdUpdate;
  }else{
   engine.render=renderSide.B;
   engine.updateBatches=sampling?timed(natives.updateBatches,'B','batches'):natives.updateBatches;
   harness.crowdUpdate=null;
   crowd.update=sampling?function(time,dt,eye){const before=crowd.uploadStats?{calls:crowd.uploadStats.calls,bytes:crowd.uploadStats.bytes}:null;const t0=performance.now();try{return natives.crowdUpdate.call(this,time,dt,eye);}finally{stage.B.crowd+=performance.now()-t0;if(before&&Number.isFinite(crowd.uploadStats.calls)){upload.B.calls+=crowd.uploadStats.calls-before.calls;upload.B.bytes+=crowd.uploadStats.bytes-before.bytes;}}}:natives.crowdUpdate;
  }
 }
 const save=async(name,body)=>{try{const response=await fetch('/capture/'+name,{method:'POST',body});if(!response.ok)throw Error('HTTP '+response.status);(report.evidence??={})[name]=(await response.json()).path;}catch(e){report.warnings.push('evidence '+name+' not saved: '+e.message);}};
 const saveCanvasPng=async name=>{try{const blob=await (await fetch(engine.canvas.toDataURL('image/png'))).blob();await save(name,blob);}catch(e){report.warnings.push('evidence '+name+' not saved: '+e.message);}};
 button.disabled=true;engine.animate=false;engine.fixedTime=engine.life.time;engine.exporting=true;engine.captureSize=report.resolution;engine.resize();app.ecologyUI.stopFollow();show();
 const originalLOD=snapshotLOD();
 try{
  const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  report.correctness={};report.visual={};report.performance={};report.raw={views:[]};
  for(const style of full?['color','silk','off']:['color']){
   engine.style.setPreset(style==='silk'?'silk':'color');if(style!=='silk')engine.style.set(saved.settings);engine.style.set({enabled:style==='off'?0:1});
   for(const view of full?[0,1,2,3,4,5,6,7,8,9]:[0,2,7]){
    app.setView(view,true);const entry=snapshotLOD();report.current={view:view+1,style,phase:'sampling'};show();
    const key='view'+String(view+1).padStart(2,'0')+'-'+style;
    const result={view:view+1,style,A:{frames:[]},B:{frames:[]}};
    for(let i=0;i<2;i++)for(const side of ['A','B']){restoreLOD(entry);installSide(side,false);run(renderSide[side]);await frame();}
    stage.A.batches=stage.A.crowd=stage.B.batches=stage.B.crowd=0;
    // Alternate order to reduce warmup / temperature / background-load bias.
    for(let i=0;i<PAIRS;i++)for(const side of i%2?['B','A']:['A','B']){
     restoreLOD(entry);installSide(side,true);finish();const start=performance.now(),stats=run(renderSide[side]);finish();
     result[side].frames.push(performance.now()-start);
     Object.assign(result[side],{draws:stats.totalDraws,triangles:stats.totalTriangles,mainTriangles:stats.triangles});await frame();
    }
    for(const side of ['A','B']){result[side].medianMs=median(result[side].frames);result[side].p95Ms=p95(result[side].frames);result[side].stageMs={batches:stage[side].batches,crowd:stage[side].crowd};}
    report.current={view:view+1,style,phase:'visual comparison'};show();
    restoreLOD(entry);installSide('A',false);run(renderSide.A);const before=snapshot();
    if(full&&view===2&&style==='color')await saveCanvasPng('perfreview-before-4k.png');
    restoreLOD(entry);run(renderSide.A);const control=snapshot();
    result.referenceRepeat=difference(before.pixels,control.pixels);
    result.referenceBuffersStable=compareBuffers.every(k=>difference(before[k],control[k]).changed===0);
    restoreLOD(entry);installSide('B',false);run(renderSide.B);const after=snapshot();
    if(full&&view===2&&style==='color')await saveCanvasPng('perfreview-after-4k.png');
    result.buffers=Object.fromEntries(compareBuffers.map(k=>[k,difference(before[k],after[k]).changed]));
    result.output=difference(before.pixels,after.pixels);
    if(batch2){
     // Correctness: normal/shadow/reflection must still match value-for-value.
     // Refraction is expected to differ (A: half-res render, B: full-res
     // snapshot copy); both sizes are recorded instead of compared.
     report.correctness[key]={pass:Object.values(result.buffers).every(n=>n===0),buffers:{...result.buffers},refraction:{compared:false,sizeA:[altRefraction.width,altRefraction.height],sizeB:after.refractionSize}};
     // Visual: full-image RMSE <= 1/255 with at most 0.1% of channels beyond
     // 8/255; view 3 (River) additionally gates two fixed water rectangles at
     // RMSE <= 2/255 and <= 0.5% beyond 8/255: the central horizontal band and
     // the area under the bridge.
     const w=engine.width,h=engine.height;
     const fs=regionStats(before.pixels,after.pixels,0,0,w,h,w);
     const isRiverView=view===2;
     const band=isRiverView?regionStats(before.pixels,after.pixels,0,Math.floor(h*.25),w,Math.floor(h*.75),w):null;
     const bridge=isRiverView?regionStats(before.pixels,after.pixels,Math.floor(w*.4),Math.floor(h*.35),Math.floor(w*.6),Math.floor(h*.65),w):null;
     const pass=fs.rmse<=1&&fs.hotRatio<=.001&&(!isRiverView||(band.rmse<=2&&band.hotRatio<=.005&&bridge.rmse<=2&&bridge.hotRatio<=.005));
     report.visual[key]={pass,mode:'refraction-reuse',full:{rmse:fs.rmse,hotRatio:fs.hotRatio,hotChannels:fs.hot},waterBand:band?{rmse:band.rmse,hotRatio:band.hotRatio,hotChannels:band.hot}:null,underBridge:bridge?{rmse:bridge.rmse,hotRatio:bridge.hotRatio,hotChannels:bridge.hot}:null,changed:result.output.changed,repeatRmse:result.referenceRepeat.rmse,repeatChanged:result.referenceRepeat.changed,repeatBuffersStable:result.referenceBuffersStable};
    }else{
     // Correctness: the four source buffers must match value-for-value. Visual:
     // MSAA output error is bounded by the baseline's own repeat variance.
     report.correctness[key]={pass:Object.values(result.buffers).every(n=>n===0),buffers:{...result.buffers}};
     report.visual[key]={pass:result.output.rmse<=result.referenceRepeat.rmse*1.5+.025&&result.output.changed<=result.referenceRepeat.changed*2+32,rmse:result.output.rmse,changed:result.output.changed,repeatRmse:result.referenceRepeat.rmse,repeatChanged:result.referenceRepeat.changed,repeatBuffersStable:result.referenceBuffersStable};
    }
    report.performance[key]={A:{medianMs:result.A.medianMs,p95Ms:result.A.p95Ms,frames:[...result.A.frames],stageMs:{...result.A.stageMs}},B:{medianMs:result.B.medianMs,p95Ms:result.B.p95Ms,frames:[...result.B.frames],stageMs:{...result.B.stageMs}},draws:{A:result.A.draws,B:result.B.draws},triangles:{A:result.A.triangles,B:result.B.triangles},mainTriangles:{A:result.A.mainTriangles,B:result.B.mainTriangles}};
    report.raw.views.push(result);show();await frame();
   }
  }
  // Upload accounting: A uploads the whole palette per call; B reports through the
  // crowd.uploadStats counters when a later batch implements them.
  report.crowdUpload={paletteBytes:crowd.palettes.byteLength,A:{calls:upload.A.calls,bytes:upload.A.bytes,strategy:'full-texture'},B:crowd.uploadStats?{calls:upload.B.calls,bytes:upload.B.bytes,strategy:crowd.uploadStats.strategy??null}:null};
  if(!crowd.uploadStats)report.crowdUpload.note='B crowd.uploadStats not implemented yet';
  // Dynamic skeleton time series: the render loop stays paused and fixedTime is
  // cleared so the distance throttle produces the real dirty-row distribution -
  // a forced scrub time would re-pose every actor on every step. Both sides run
  // the same 240 advancing 1/30 s steps from one shared frozen start state. No
  // camera change, no rendering - only CPU pose work and GPU uploads.
  report.current={phase:'crowd dynamic time series'};show();
  const freezeCrowd=()=>({assets:engine.sourceAssets.map(a=>({matrices:a.matrices.map(m=>new Float32Array(m)),centers:a.centers.map(c=>[...c])})),actors:crowd.actors.map(a=>({p:[...a.p],heading:a.heading,blend:a.blend,clip:a.clip,oldClip:a.oldClip,walkClock:a.walkClock,distance:a.distance,lastPose:a.lastPose,lifeMoving:a.lifeMoving})),palettes:new Float32Array(crowd.palettes),stats:{...crowd.stats}});
  const unfreezeCrowd=s=>{engine.sourceAssets.forEach((a,i)=>{const b=s.assets[i];a.matrices.forEach((m,j)=>m.set(b.matrices[j]));a.centers.forEach((c,j)=>{const e=b.centers[j];c[0]=e[0];c[1]=e[1];c[2]=e[2];});});crowd.actors.forEach((a,i)=>{const b=s.actors[i];a.p=[...b.p];a.heading=b.heading;a.blend=b.blend;a.clip=b.clip;a.oldClip=b.oldClip;a.walkClock=b.walkClock;a.distance=b.distance;a.lastPose=b.lastPose;a.lifeMoving=b.lifeMoving;});crowd.palettes.set(s.palettes);Object.assign(crowd.stats,s.stats);};
  const frozenCrowd=freezeCrowd(),eye=app.camera().eye,steps=240,dt=1/30,t0=engine.fixedTime??engine.life.time;let t=t0;
  const dyn={steps,dt,seconds:steps*dt,paletteBytes:crowd.palettes.byteLength,A:{calls:0,byteTotal:0},B:{calls:0,uploadCalls:0,bytes:0,fullUploads:0,partialUploads:0,skippedUpdates:0,dirtyRows:null}};
  installSide('B',false);
  engine.fixedTime=undefined; // free-running dt, not a forced scrub time
  for(let i=0;i<steps;i++){t+=dt;baselineCrowdUpdate.call(crowd,t,dt,eye);dyn.A.calls++;}
  dyn.A.byteTotal=dyn.A.calls*crowd.palettes.byteLength;
  unfreezeCrowd(frozenCrowd);t=t0;crowd.dirty.fill(0); // identical start; A shares pose(), which flagged rows
  const histBefore=crowd.dirtyRowStats?{...crowd.dirtyRowStats}:null,statsBefore=crowd.uploadStats?{...crowd.uploadStats}:null;
  for(let i=0;i<steps;i++){t+=dt;crowd.update(t,dt,eye);dyn.B.calls++;}
  if(crowd.dirtyRowStats){
   const histogram={};let counted=0;for(const k in crowd.dirtyRowStats){const d=crowd.dirtyRowStats[k]-(histBefore[k]||0);histogram[k]=d;counted+=d;}
   dyn.B.dirtyRows={callsCounted:counted,rows:crowd.actors.length,histogram};
   if(statsBefore){dyn.B.uploadCalls=crowd.uploadStats.calls-statsBefore.calls;dyn.B.bytes=crowd.uploadStats.bytes-statsBefore.bytes;dyn.B.fullUploads=crowd.uploadStats.fullUploads-statsBefore.fullUploads;dyn.B.partialUploads=crowd.uploadStats.partialUploads-statsBefore.partialUploads;dyn.B.skippedUpdates=crowd.uploadStats.skippedUpdates-statsBefore.skippedUpdates;}
  }else dyn.note='crowd.dirtyRowStats not implemented yet';
  unfreezeCrowd(frozenCrowd);crowd.dirty.fill(1); // restored rows are unknown on the GPU after B's direct patches
  engine.fixedTime=engine.life.time;
  report.crowdDynamic=dyn;show();
  report.status=report.raw.views.length>0&&Object.values(report.correctness).every(c=>c.pass)&&Object.values(report.visual).every(v=>v.pass)?'passed':'failed';
  report.finished=new Date().toISOString();
  await save('perfreview-report.json',JSON.stringify(report));
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{
  harness.crowdUpdate=null;engine.render=natives.render;engine.updateBatches=natives.updateBatches;crowd.update=natives.crowdUpdate;
  // Batch 2 substitution resources (no-op when not in refraction-reuse mode):
  // restore the engine's own target and uniforms FIRST, then dispose. The water
  // uniforms' home is the half-resolution waterColor source since the batch 2
  // refinement (swapHalfRes captures and restores it per render); this net only
  // fires on abnormal exits, but it must also land on waterColor - pointing it
  // at the full-resolution refraction snapshot would silently change the water.
  if(altRefraction){
   if(engine.river.refraction===altRefraction)engine.river.refraction=altRefraction.__origTarget;
   if(engine.river.uniforms.uSceneColor.value===altRefraction.texture||engine.river.uniforms.uSceneDepth.value===altRefraction.depthTexture){
    const home=engine.river.waterColor||engine.river.refraction;
    engine.river.uniforms.uSceneColor.value=home.texture;engine.river.uniforms.uSceneDepth.value=home.depthTexture;
   }
   altRefraction.dispose();altRefraction=null;
  }
  restoreLOD(originalLOD);
  engine.details.userData.roofBatches.enabled=saved.roofs;engine.lodEnabled=saved.lod;engine.captureSize=saved.size;engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.exporting=saved.exporting;
  engine.style.setPreset(saved.preset);engine.style.set(saved.settings);engine.clockLast=performance.now()/1000;
  button.disabled=false;delete report.current;if(!report.finished)report.finished=new Date().toISOString();show();
  // A failed run still carries its stack: persist it for offline diagnosis.
  if(!report.evidence||!report.evidence['perfreview-report.json']){try{await save('perfreview-report.json',JSON.stringify(report));}catch(_){}}
 }
 return report;
}
