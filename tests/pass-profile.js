// T0 pass-profile: ?profile=1 measures six render segments
// (shadow / reflection / main / water / outline / post) using the engine's
// pass timers, across views 1/3/8 x two styles x auto/cinema quality. The
// six-segment sum is checked against the whole completed frame time.
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const SECTIONS=['shadow','reflection','main','water','outline','post'];
// Finish brackets measure CPU submission plus GPU completion, not pure GPU time.
// Work outside the six segments includes water simulation and readback as well as CPU work;
// the unprofiled remainder must not be described as a CPU utilization estimate.

export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification');
 const report={status:'running',started:new Date().toISOString(),resolution:[1280,720],mode:'sync-finish wall time (submission + GPU completion)',timerExtension:!!engine.timerExt,combos:[]};
 const saved={roofs:engine.details.userData.roofBatches.enabled,lod:engine.lodEnabled,animate:engine.animate,size:engine.captureSize,fixed:engine.fixedTime,exporting:engine.exporting,preset:engine.style.preset,settings:{...engine.style.settings},profile:engine.profilePasses,quality:engine.quality};
 const r=engine.renderer,gl=engine.gl,syncPixel=new Uint8Array(4);
 const show=()=>output.textContent=JSON.stringify(report,null,2);
 const finish=()=>{r.setRenderTarget(null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,syncPixel);};
 const run=method=>method.call(engine,app.camera(),engine.clockLast);
 button.disabled=true;engine.animate=false;engine.fixedTime=engine.life.time;engine.exporting=true;engine.captureSize=report.resolution;engine.profilePasses='sync';app.ecologyUI.stopFollow();show();
 try{
  for(const quality of ['auto','cinema']){
   engine.setQuality(quality);
   for(const style of ['color','off']){
    engine.style.setPreset('color');engine.style.set(saved.settings);engine.style.set({enabled:style==='off'?0:1});
    for(const view of [0,2,7]){
     app.setView(view,true);report.current={view:view+1,style,quality};show();
     engine.fixedTime=engine.life.time;engine.clockLast=undefined;
     for(let i=0;i<3;i++){run(engine.render);await frame();}
     const sections={},frames=[];
     for(let i=0;i<16;i++){
      finish();const t0=performance.now();run(engine.render);finish();frames.push(performance.now()-t0);
      for(const k of SECTIONS)if(engine.framePassTimes[k]!=null)(sections[k]??=[]).push(engine.framePassTimes[k]);
      await frame();
     }
     const passTimes=Object.fromEntries(SECTIONS.filter(k=>sections[k]).map(k=>[k,+median(sections[k]).toFixed(2)]));
     const sum=SECTIONS.reduce((s,k)=>s+(passTimes[k]||0),0),frameMs=+median(frames).toFixed(2);
     report.combos.push({view:view+1,style,quality,frameMs,passTimes,sumMs:+sum.toFixed(2),unprofiledWallShare:+(1-sum/frameMs).toFixed(3),draws:engine.renderer.info.render.calls,triangles:engine.renderer.info.render.triangles});
     show();await frame();
    }
   }
  }
  const ratios=report.combos.map(c=>1-c.unprofiledWallShare);
  report.sumRatioRange=ratios.length?[Math.min(...ratios).toFixed(3),Math.max(...ratios).toFixed(3)]:null;
  report.tenPercentGateMet=ratios.length===12&&ratios.every(v=>v>=.9&&v<=1.1);
  report.pass=report.combos.length===12&&report.tenPercentGateMet;
  report.status=report.pass?'passed':'failed';
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{
  engine.profilePasses=saved.profile;engine.setQuality(saved.quality==='cinema'?'cinema':'auto');
  engine.details.userData.roofBatches.enabled=saved.roofs;engine.lodEnabled=saved.lod;engine.captureSize=saved.size;engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.exporting=saved.exporting;
  engine.style.setPreset(saved.preset);engine.style.set(saved.settings);engine.clockLast=performance.now()/1000;
  button.disabled=false;delete report.current;report.finished=new Date().toISOString();show();
  try{const response=await fetch('/capture/quality/pass-profile-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',{method:'POST',body:JSON.stringify(report)});if(response.ok)report.saved=(await response.json()).path;}catch(e){report.saveError=e.message;}
 }
 return report;
}
