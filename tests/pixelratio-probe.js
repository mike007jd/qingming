// T2 pixel-ratio probe: ?ratiotest=1 renders at the live canvas size (no
// captureSize override) with the quality cap engaged and with it lifted, on
// the same views, to expose the cap's effect on engine size, LOD0 instance
// count and the fragment-heavy pass times.
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];

export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification');
 const report={status:'running',started:new Date().toISOString(),devicePixelRatio:devicePixelRatio,views:[]};
 const saved={animate:engine.animate,size:engine.captureSize,fixed:engine.fixedTime,exporting:engine.exporting,quality:engine.quality,cap:engine.maxPixelRatio,profile:engine.profilePasses};
 const show=()=>output.textContent=JSON.stringify(report,null,2);
 const run=()=>engine.render(app.camera(),engine.clockLast);
 button.disabled=true;engine.animate=false;engine.fixedTime=engine.life.time;engine.exporting=true;engine.captureSize=null;engine.profilePasses='sync';engine.setQuality('auto');app.ecologyUI.stopFollow();show();
 try{
  for(const view of [0,2,7]){
   app.setView(view,true);engine.fixedTime=engine.life.time;engine.clockLast=undefined;
   for(const phase of ['capped','uncapped']){
    engine.maxPixelRatio=phase==='capped'?1.25:Infinity;engine.resize();
    report.current={view:view+1,phase};show();
    for(let i=0;i<3;i++){run();await frame();}
    const frames=[],times={};
    for(let i=0;i<8;i++){const t0=performance.now();run();frames.push(performance.now()-t0);await frame();for(const [k,v] of Object.entries(engine.passTimes))(times[k]??=[]).push(v);}
    const passTimes=Object.fromEntries(Object.entries(times).map(([k,v])=>[k,+median(v).toFixed(2)]));
    const stats=run();
    const entry={view:view+1,phase,width:engine.width,height:engine.height,fragmentMs:+(passTimes.main+passTimes.water+passTimes.post).toFixed(2),passTimes,lodInstances:stats.lod?.instances??null,medianMs:+median(frames).toFixed(2)};
    report.views.push(entry);
    try{fetch('/capture/quality/T2-view-'+String(view+1).padStart(2,'0')+'-'+phase+'.png',{method:'POST',body:await (await fetch(engine.canvas.toDataURL('image/png'))).blob()}).catch(()=>{});}catch(e){}
    show();await frame();
   }
  }
  const byView={};for(const v of report.views)(byView[v.view]??={})[v.phase]=v;
  report.ratio=byView[1].capped.width/byView[1].uncapped.width;
  for(const v of report.views)v.fragmentReduction=+(1-(byView[v.view].capped.fragmentMs/byView[v.view].uncapped.fragmentMs)).toFixed(3);
  report.pass=report.views.length===6&&Math.abs(report.ratio-.625)<.01&&report.views.every(v=>v.fragmentReduction!==undefined)&&[1,3,8].every(x=>{const c=byView[x].capped,u=byView[x].uncapped;return c.lodInstances[0]<=u.lodInstances[0]&&c.medianMs<=u.medianMs;});
  report.status=report.pass?'passed':'failed';
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{
  engine.maxPixelRatio=saved.cap??1;engine.profilePasses=saved.profile;engine.setQuality(saved.quality==='cinema'?'cinema':'auto');engine.resize();
  engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.exporting=saved.exporting;engine.captureSize=saved.size;app.setView(0,true);engine.clockLast=performance.now()/1000;engine._renderSignature=null;button.disabled=false;delete report.current;report.finished=new Date().toISOString();show();
  try{const response=await fetch('/capture/quality/T2-pixelratio.json',{method:'POST',body:JSON.stringify(report)});if(response.ok)report.savedPath='quality/T2-pixelratio.json';}catch(e){report.saveError=e.message;}
 }
 return report;
}
