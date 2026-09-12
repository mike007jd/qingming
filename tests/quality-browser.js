// Static cinema/auto image comparison, followed by a separate live-motion probe.
// Auto intentionally changes geometry; pixel differences are informational unless explicitly bounded.
import {HalfFloatType} from 'three';
import {difference,shadowDifference} from './optimization-browser.js';
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const passes=['shadow','reflection','main','water','outline','post'];
export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification'),opts=new URLSearchParams(location.search),full=opts.has('full');
 const enforcePixels=opts.has('rmse')||opts.has('over8');
 const rmseLimit=Number(opts.get('rmse')??.6),over8Limit=Number(opts.get('over8')??.002);
 if(!Number.isFinite(rmseLimit)||rmseLimit<0||!Number.isFinite(over8Limit)||over8Limit<0)throw new RangeError('Quality thresholds must be finite and non-negative');
 const runName='quality-'+new Date().toISOString().replace(/[:.]/g,'-');
 const report={status:'running',started:new Date().toISOString(),resolution:full?[3840,2160]:[1280,720],samples:8,validationScope:"GPU/motion smoke; visual review and 1080p FPS acceptance are separate",thresholds:enforcePixels?{rmse:rmseLimit,over8:over8Limit}:null,views:[],motion:[],consoleIssues:[]};
 const saved={animate:engine.animate,size:engine.captureSize,fixed:engine.fixedTime,exporting:engine.exporting,preset:engine.style.preset,settings:{...engine.style.settings},quality:engine.quality,profile:engine.profilePasses,single:window.__singleFrame};
 const r=engine.renderer,gl=engine.gl,origError=console.error,origWarn=console.warn;
 console.error=(...a)=>{report.consoleIssues.push('error: '+a.map(String).join(' ').slice(0,200));origError(...a);};
 console.warn=(...a)=>{report.consoleIssues.push('warn: '+a.map(String).join(' ').slice(0,200));origWarn(...a);};
 const showError=e=>report.consoleIssues.push('pageerror: '+String(e.message||e.reason));
 window.addEventListener('error',showError);window.addEventListener('unhandledrejection',showError);
 const show=()=>output.textContent=JSON.stringify(report,null,2);
 const readTarget=target=>{const half=target.texture.type===HalfFloatType,p=half?new Uint16Array(target.width*target.height*4):new Uint8Array(target.width*target.height*4);r.readRenderTargetPixels(target,0,0,target.width,target.height,p);p.half=half;p.width=target.width;p.height=target.height;return p;};
 const readOutput=()=>{const out=new Uint8Array(engine.width*engine.height*4);r.setRenderTarget(null);gl.readPixels(0,0,engine.width,engine.height,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
 const snapshot=()=>({output:readOutput(),normal:readTarget(engine.post.normalTarget),reflection:readTarget(engine.river.reflection),refraction:readTarget(engine.river.refraction),shadow:readTarget(engine.sunLight.shadow.map)});
 const draw=()=>engine.render(app.camera(),engine.clockLast);
 const savePng=async name=>{const data=engine.canvas.toDataURL('image/png'),blob=await (await fetch(data)).blob();const response=await fetch('/capture/quality/'+name,{method:'POST',body:blob});if(!response.ok)throw Error('Capture failed: '+response.status);(report.saved??=[]).push('quality/'+name);};
 const hash=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),b=>b.toString(16).padStart(2,'0')).join('');
 button.disabled=true;window.__singleFrame=true;engine.animate=false;engine.fixedTime=engine.life.time;engine.exporting=true;engine.captureSize=report.resolution;engine.profilePasses=false;engine.river.reset();app.ecologyUI.stopFollow();show();
 try{
  await frame(); // Drain the app's last scheduled frame before temporarily enabling real motion.
  const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  for(const style of ['color','silk','off'])for(const view of full?[0,1,2,3,4,5,6,7,8,9]:[0,2,7]){
   app.setView(view,true);engine.style.setPreset(style==='silk'?'silk':'color');if(style!=='silk')engine.style.set(saved.settings);engine.style.set({enabled:style==='off'?0:1});report.current={style,view:view+1};show();
   const result={view:view+1,style,A:{frames:[]},B:{frames:[]}};
   for(const side of ['A','B']){
    engine.setQuality(side==='A'?'cinema':'auto');
    for(let i=0;i<3;i++){draw();await frame();}
    for(let i=0;i<report.samples;i++){
     gl.finish();const start=performance.now(),stats=draw();gl.finish();result[side].frames.push(performance.now()-start);
     Object.assign(result[side],{draws:stats.totalDraws,triangles:stats.totalTriangles,mainTriangles:stats.triangles,lodInstances:stats.lod.instances});await frame();
    }
    result[side].medianMs=median(result[side].frames);
    engine.resetPassProfile();engine.profilePasses='sync';const times=Object.fromEntries(passes.map(k=>[k,[]]));
    for(let i=0;i<report.samples;i++){const stats=draw();for(const name of passes)times[name].push(stats.framePassTimes[name]??0);result[side].passCounts=stats.passCounts;await frame();}
    result[side].passTimes=Object.fromEntries(passes.map(k=>[k,median(times[k])]));engine.profilePasses=false;
   }
   engine.setQuality('cinema');draw();const before=snapshot();
   if(style==='color'&&[0,2,7].includes(view))await savePng(`${runName}-view-${view+1}-cinema.png`);
   await frame();draw();result.repeat=difference(before.output,readOutput());
   engine.setQuality('auto');draw();const after=snapshot();
   if(style==='color'&&[0,2,7].includes(view))await savePng(`${runName}-view-${view+1}-auto.png`);
   result.cinemaSHA256=await hash(before.output);result.output=difference(before.output,after.output);
   result.buffers=Object.fromEntries(['normal','reflection','refraction','shadow'].map(k=>[k,before[k].length!==after[k].length?{comparable:false,reason:'different target resolutions',cinema:[before[k].width,before[k].height],auto:[after[k].width,after[k].height]}:k==='shadow'?shadowDifference(before[k],after[k],engine.sunLight.shadow.camera.far-engine.sunLight.shadow.camera.near):difference(before[k],after[k])]));
   result.pass=(!enforcePixels||(result.output.rmse<=rmseLimit&&result.output.over8<=over8Limit))&&gl.getError()===0&&report.consoleIssues.length===0;
   report.views.push(result);show();await frame();
  }
  if(!full){
   engine.captureSize=null;engine.fixedTime=undefined;engine.animate=true;engine.exporting=false;engine.setQuality('auto');engine.style.setPreset('color');engine.style.set(saved.settings);engine.style.set({enabled:1});
   for(const view of [0,2,7]){
    app.setView(view,true);engine.river.reset();engine.river.lastTime=engine.life.time;
    const originalRead=r.readRenderTargetPixels,originalAsync=r.readRenderTargetPixelsAsync;let syncReads=0,asyncReads=0;
    r.readRenderTargetPixels=function(...args){if(args[0]===engine.river.queryTarget)syncReads++;return originalRead.apply(this,args);};
    r.readRenderTargetPixelsAsync=function(...args){if(args[0]===engine.river.queryTarget)asyncReads++;return originalAsync.apply(this,args);};
    const probe={view:view+1,resolution:null,frames:[],sourceRefreshes:0,syncHullReads:0,asyncHullReads:0,cachePeak:0};
    try{
     for(let i=0;i<2;i++){engine.render(app.camera(),engine.clockLast+1/30);await frame();}syncReads=asyncReads=0;
     for(let i=0;i<16;i++){const start=performance.now(),stats=engine.render(app.camera(),engine.clockLast+1/30);gl.finish();probe.frames.push(performance.now()-start);probe.sourceRefreshes+=Number(stats.sourceRefresh);probe.cachePeak=Math.max(probe.cachePeak,engine.river.sampleCache.size);await frame();}
     Object.assign(probe,{resolution:[engine.width,engine.height],medianMs:median(probe.frames),syncHullReads:syncReads,asyncHullReads:asyncReads});
     probe.pass=probe.sourceRefreshes===8&&syncReads<=2&&asyncReads>0&&probe.cachePeak<=engine.life.boats.length*5&&gl.getError()===0;
     report.motion.push(probe);show();
    }finally{r.readRenderTargetPixels=originalRead;r.readRenderTargetPixelsAsync=originalAsync;}
   }
  }
  report.status=report.views.every(v=>v.pass)&&report.motion.every(v=>v.pass)&&!report.consoleIssues.length?'passed':'failed';
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{
  console.error=origError;console.warn=origWarn;window.removeEventListener('error',showError);window.removeEventListener('unhandledrejection',showError);
  engine.captureSize=saved.size;engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.exporting=saved.exporting;engine.profilePasses=saved.profile;engine.setQuality(saved.quality);engine.style.setPreset(saved.preset);engine.style.set(saved.settings);engine.river.reset();engine.river.lastTime=engine.life.time;app.setView(0,true);engine.clockLast=performance.now()/1000;engine._renderSignature=null;
  button.disabled=false;delete report.current;report.finished=new Date().toISOString();report.savedPath='quality/'+runName+'.json';show();
  try{const response=await fetch('/capture/'+report.savedPath,{method:'POST',body:JSON.stringify(report)});if(!response.ok)throw Error('Report save failed: '+response.status);}catch(e){report.saveError=e.message;show();}
  window.__singleFrame=saved.single;if(!saved.single)requestAnimationFrame(window.__stepFrame);
 }
 return report;
}
