const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];

// App-owned visible harness: ?lodtest=1, optionally &full=1 for 4K / three styles.
export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification');
 const full=new URLSearchParams(location.search).has('full');
 const report={status:'running',resolution:full?[3840,2160]:[1280,720],samples:full?2:8,views:[]};
 const saved={lod:engine.lodEnabled,animate:engine.animate,size:engine.captureSize,fixed:engine.fixedTime,exporting:engine.exporting,preset:engine.style.preset,settings:{...engine.style.settings}};
 const gl=engine.gl,r=engine.renderer,pixel=new Uint8Array(4),show=()=>output.textContent=JSON.stringify(report,null,2);
 const sync=()=>{r.setRenderTarget(null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);};
 const read=()=>{const p=new Uint8Array(engine.width*engine.height*4);r.setRenderTarget(null);gl.readPixels(0,0,engine.width,engine.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 const draw=lod=>{engine.lodEnabled=lod;return engine.render(app.camera(),engine.clockLast);};
 const capture=id=>{document.getElementById(id)?.remove();const img=document.createElement('img');img.id=id;img.alt=id;img.style.width='320px';img.src=engine.canvas.toDataURL();output.parentElement.appendChild(img);};
 button.disabled=true;engine.animate=false;engine.fixedTime=engine.life.time;engine.exporting=true;engine.captureSize=report.resolution;app.ecologyUI.stopFollow();
 try{
  const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  report.library={sourceLevels:engine.batches.filter(b=>b.lod>0).length,detailInstances:engine.details.userData.lodMeshes.length};
  if(!report.library.sourceLevels||!report.library.detailInstances)throw Error('LOD library was not attached');
  for(const style of full?['color','silk','off']:['color']){
   engine.style.setPreset(style==='silk'?'silk':'color');if(style!=='silk')engine.style.set(saved.settings);engine.style.set({enabled:style==='off'?0:1});
   for(const view of full?[0,1,2,3,4,5,6,7,8,9]:[0,2,7]){
    app.setView(view,true);report.current={view:view+1,style};show();
    const result={view:view+1,style,full:{frames:[]},lod:{frames:[]}};
    for(let warm=0;warm<2;warm++)for(const lod of [false,true]){draw(lod);await frame();}
    for(let i=0;i<report.samples;i++)for(const lod of i%2?[true,false]:[false,true]){
     sync();const start=performance.now(),stats=draw(lod);sync();
     const entry=lod?result.lod:result.full;entry.frames.push(performance.now()-start);
     Object.assign(entry,{triangles:stats.totalTriangles,draws:stats.totalDraws,levels:stats.lod.instances,details:stats.lod.details});await frame();
    }
    draw(false);const before=read();if(full&&style==='color'&&[0,2,7].includes(view))capture(`lod-view-${view+1}-full`);
    const near=engine.batches.filter(b=>b.lod===0).map(b=>({b,matrices:b.matrices.slice(0,b.count*16),count:b.count}));
    draw(true);const after=read();if(full&&style==='color'&&[0,2,7].includes(view))capture(`lod-view-${view+1}-auto`);
    let squared=0,changed=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);squared+=d*d;if(d>8)changed++;}
    result.image={rmse:Math.sqrt(squared/before.length),channelsChangedOver8:changed/before.length};
    result.full.medianMs=median(result.full.frames);result.lod.medianMs=median(result.lod.frames);
    // Same color and normal passes use the exact selected geometry and material hooks.
    const details=engine.details.userData.lodMeshes;
    result.pass=engine.error===0&&result.full.levels[1]===0&&result.full.levels[2]===0&&result.full.details[1]===0&&result.full.details[2]===0
     &&result.lod.levels.reduce((a,b)=>a+b,0)===near.reduce((n,b)=>n+b.count,0)
     &&details.every(e=>e.mesh.geometry===e.levels[e.history.main].geometry)
     &&result.lod.triangles<=result.full.triangles;
    if(!result.pass)throw Error('LOD visibility / geometry contract failed at '+(view+1));
    report.views.push(result);show();await frame();
   }
  }
  report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{
  engine.lodEnabled=saved.lod;engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.exporting=saved.exporting;engine.captureSize=saved.size;
  engine.style.setPreset(saved.preset);engine.style.set(saved.settings);app.setView(0,true);engine.clockLast=performance.now()/1000;button.disabled=false;delete report.current;show();
 }
 return report;
}
