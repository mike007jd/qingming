import {HalfFloatType,DataUtils} from 'three';
import {QingmingPass as PreviousPass} from './previous-QingmingPass.js';
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const halfValues=Float32Array.from({length:65536},(_,i)=>DataUtils.fromHalfFloat(i)*255);
export function difference(a,b){if(a.length!==b.length)throw new RangeError("Pixel arrays must have matching dimensions");let sum=0,over8=0,max=0;for(let i=0;i<a.length;i++){const d=a.half?Math.abs(halfValues[a[i]]-halfValues[b[i]]):Math.abs(a[i]-b[i]);sum+=d*d;max=Math.max(max,d);if(d>8)over8++;}return {rmse:Math.sqrt(sum/a.length),over8:over8/a.length,max};}

export function shadowDifference(a,b,span){
 if(a.length!==b.length)throw new RangeError("Shadow arrays must have matching dimensions");
 // Match r179 unpackRGBAToDepth; packed RGBA bytes are not color differences.
 const depth=(p,i)=>p[i]/256+p[i+1]/65536+p[i+2]/16777216+p[i+3]/(255*16777216);
 let sum=0,maxMeters=0,over=0;
 for(let i=0;i<a.length;i+=4){const d=Math.abs(depth(a,i)-depth(b,i))*span;sum+=d*d;maxMeters=Math.max(maxMeters,d);if(d>.001)over++;}
 return {rmseMeters:Math.sqrt(sum/(a.length/4)),maxMeters,overMillimeter:over/(a.length/4)};
}

// Visible full-scene A/B: baseline, roof batching/static transforms, then unused-pass removal.
export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification'),full=new URLSearchParams(location.search).has('full');
 const report={status:'running',started:new Date().toISOString(),resolution:full?[3840,2160]:[1280,720],samples:full?1:8,views:[]};
 const saved={animate:engine.animate,size:engine.captureSize,fixed:engine.fixedTime,exporting:engine.exporting,preset:engine.style.preset,settings:{...engine.style.settings},post:engine.post};
 const oldPost=new PreviousPass(engine.renderer,engine.style,{samples:4,normalThreshold:.28}),roofs=engine.details.userData.roofBatches,r=engine.renderer,gl=engine.gl,pixel=new Uint8Array(4);
 const show=()=>output.textContent=JSON.stringify(report,null,2),sync=()=>{r.setRenderTarget(null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);};
 const readTarget=target=>{
  const half=target.texture.type===HalfFloatType,p=half?new Uint16Array(target.width*target.height*4):new Uint8Array(target.width*target.height*4);r.readRenderTargetPixels(target,0,0,target.width,target.height,p);
  p.half=half;return p;
 };
 const readOutput=()=>{const output=new Uint8Array(engine.width*engine.height*4);r.setRenderTarget(null);gl.readPixels(0,0,engine.width,engine.height,gl.RGBA,gl.UNSIGNED_BYTE,output);return output;};
 const snapshot=()=>({output:readOutput(),normal:readTarget(engine.post.normalTarget),reflection:readTarget(engine.river.reflection),refraction:readTarget(engine.river.refraction),shadow:readTarget(engine.sunLight.shadow.map)});
 const draw=phase=>{engine.details.userData.freezeTransforms(phase!=='before');roofs.enabled=phase!=='before';engine.post=phase==='after'?saved.post:oldPost;return engine.render(app.camera(),engine.clockLast);};
 const capture=id=>{document.getElementById(id)?.remove();const img=document.createElement('img');img.id=id;img.alt=id;img.style.width='320px';img.src=engine.canvas.toDataURL();output.parentElement.appendChild(img);};
 button.disabled=true;engine.animate=false;engine.fixedTime=engine.life.time;engine.exporting=true;engine.captureSize=report.resolution;app.ecologyUI.stopFollow();show();
 try{
  const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  report.roofs={instances:roofs.instances,groups:roofs.batches.length};if(roofs.instances<1000)throw Error('Expected roof instances were not batched');
  for(const style of full?['color','silk','off']:['color','off','no-ink'])for(const view of full?[0,1,2,3,4,5,6,7,8,9]:[0,2,7]){
   app.setView(view,true);engine.style.setPreset(style==='silk'?'silk':'color');if(style!=='silk')engine.style.set(saved.settings);engine.style.set({enabled:style==='off'?0:1,lineStrength:style==='no-ink'?0:saved.settings.lineStrength});
   report.current={style,view:view+1};show();const result={view:view+1,style,before:{frames:[]},batch:{frames:[]},after:{frames:[]}};
   for(let i=0;i<2;i++)for(const phase of ['before','batch','after']){draw(phase);await frame();}
   for(let i=0;i<report.samples;i++)for(const phase of i%2?['after','batch','before']:['before','batch','after']){
    sync();const start=performance.now(),stats=draw(phase);sync();result[phase].frames.push(performance.now()-start);Object.assign(result[phase],{draws:stats.totalDraws,triangles:stats.totalTriangles});await frame();
   }
   for(const phase of ['before','batch','after'])result[phase].medianMs=median(result[phase].frames);
   draw('before');const before=snapshot();if(full&&style==='color'&&[0,2,9].includes(view))capture(`opt-view-${view+1}-before`);
   await frame();draw('before');const repeat={output:readOutput()};result.repeat=difference(before.output,repeat.output);
   await frame();draw('batch');const batch=snapshot();result.batching=Object.fromEntries(Object.keys(before).map(k=>[k,k==='shadow'?shadowDifference(before[k],batch[k],engine.sunLight.shadow.camera.far-engine.sunLight.shadow.camera.near):difference(before[k],batch[k])]));
   await frame();draw('after');const after={output:readOutput()};if(full&&style==='color'&&[0,2,9].includes(view))capture(`opt-view-${view+1}-after`);
   result.output=difference(before.output,after.output);result.passOutput=difference(batch.output,after.output);
   // Instancing keeps the exact geometry/materials; float matrix order can move edge coverage.
   // Limit deviations over 8/255 to one channel in a thousand; inspect saved close views too.
   const normalNeeded=engine.style.settings.enabled>0&&engine.style.settings.lineStrength>0;
   result.pass=result.batch.draws<=result.before.draws&&result.batch.triangles===result.before.triangles
    &&(normalNeeded?result.after.draws===result.batch.draws:result.after.draws<result.batch.draws)
    &&Object.entries(result.batching).every(([k,d])=>k==='shadow'?Number.isFinite(d.rmseMeters)&&d.overMillimeter<.0001:Number.isFinite(d.rmse)&&d.over8<.001)
    &&result.output.over8<Math.max(.001,result.repeat.over8*2)
    &&result.passOutput.rmse<=result.repeat.rmse*1.5+.025&&engine.error===0;
   report.views.push(result);show();await frame();
  }
  report.status=report.views.every(v=>v.pass)?'passed':'failed';
  if(!full){
   engine.details.userData.freezeTransforms(true);engine.post=saved.post;roofs.enabled=true;engine.fixedTime=undefined;engine.captureSize=null;engine.animate=false;engine.exporting=false;app.setView(0,true);engine._renderSignature=null;
   const wait=async n=>{for(let i=0;i<n;i++)await frame();};
   await wait(5);const start=engine.frame,steps=engine.river.steps;await wait(30);
   const idle={stationaryFrames:engine.frame-start};
   const sun=document.querySelector('#sun'),oldSun=sun.value;sun.value=String(+oldSun-.1);sun.dispatchEvent(new Event('input',{bubbles:true}));await wait(3);idle.settingFrames=engine.frame-start;
   const afterSettings=engine.frame;app.setView(2,true);await wait(3);idle.cameraFrames=engine.frame-afterSettings;
   engine.captureSize=[960,540];await wait(3);idle.resize=engine.width===960&&engine.height===540;engine.captureSize=null;await wait(3);
   idle.pausedWaterStable=steps===engine.river.steps;
   app.ecologyUI.startFollow('boat',11);const beforeFollow=engine.frame;await wait(8);idle.followFrames=engine.frame-beforeFollow;const followedCamera=JSON.stringify(app.camera());
   const motion=document.querySelector('#motion');motion.checked=true;motion.dispatchEvent(new Event('change',{bubbles:true}));const beforeResume=engine.frame;await wait(8);idle.resumeFrames=engine.frame-beforeResume;idle.resumedWater=engine.river.steps>steps;idle.resumedFollow=JSON.stringify(app.camera())!==followedCamera;app.ecologyUI.stopFollow();
   motion.checked=false;motion.dispatchEvent(new Event('change',{bubbles:true}));await wait(5);const stopped=engine.frame;await wait(15);idle.repausedFrames=engine.frame-stopped;
   sun.value=oldSun;sun.dispatchEvent(new Event('input',{bubbles:true}));
   idle.pass=idle.stationaryFrames===0&&idle.settingFrames===1&&idle.cameraFrames===1&&idle.resize&&idle.pausedWaterStable&&idle.followFrames===1&&idle.resumeFrames>1&&idle.resumedWater&&idle.resumedFollow&&idle.repausedFrames===0;
   report.idle=idle;if(!idle.pass)report.status='failed';
  }
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{
  engine.details.userData.freezeTransforms(true);engine.post=saved.post;roofs.enabled=true;oldPost.dispose();engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.exporting=saved.exporting;engine.captureSize=saved.size;engine.style.setPreset(saved.preset);engine.style.set(saved.settings);app.setView(0,true);engine.clockLast=performance.now()/1000;engine._renderSignature=null;button.disabled=false;delete report.current;report.finished=new Date().toISOString();show();
 }
 return report;
}
