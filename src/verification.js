import {english} from './english.js';
import * as THREE from 'three';
import {world} from './simulation.js';
export async function verify(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification');button.disabled=true;
 const report={status:'running',checks:[],started:new Date().toISOString()},saved={animate:engine.animate,time:engine.clockLast,preset:engine.style.preset,settings:{...engine.style.settings}};
 const show=()=>output.textContent=JSON.stringify(report,null,2),check=(name,ok,data)=>{report.checks.push({name,pass:!!ok,...data});show();if(!ok)throw Error(name);},yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 engine.animate=false;app.ecologyUI.stopFollow();show();
 try{
  const r=engine.river;
  const boat=(x,z=0,angle=0)=>({position:[x,.28,z],heading:[Math.cos(angle),Math.sin(angle)],speed:.8,length:8,width:2.2,moored:false,oarContacts:[{position:[x-2,.2,z+1.4],strength:1}]});
  r.reset();for(let i=1;i<=90;i++){r.update(i/30,[boat(-48+i/30)],i/30);if(i%15===0)await yieldFrame();}
  const driven=r.metrics();check('single boat creates persistent wave / foam',driven.active>20&&driven.foam>1&&driven.nan===0,{metrics:driven});
  const sampleBefore=new Float32Array(r.width*r.height*4);engine.renderer.readRenderTargetPixels(r.a,0,0,r.width,r.height,sampleBefore);
  for(let i=91;i<=180;i++){r.update(i/30,[],i/30);if(i%15===0)await yieldFrame();}
  const wake=r.metrics(),sampleAfter=new Float32Array(sampleBefore.length);engine.renderer.readRenderTargetPixels(r.a,0,0,r.width,r.height,sampleAfter);
  let delta=0,localWake=0,localChange=0;for(let i=0;i<sampleAfter.length;i+=4){const change=Math.abs(sampleAfter[i]-sampleBefore[i]);delta+=change;const cell=i/4,x=r.domain.x+(cell%r.width+.5)/r.width*r.domain.z,z=r.domain.y+(Math.floor(cell/r.width)+.5)/r.height*r.domain.w;if(x>-55&&x<-34&&Math.abs(z)<7){localWake=Math.max(localWake,Math.abs(sampleAfter[i]));localChange+=change;}}
  check('wake evolves after the boat leaves',localWake>.002&&localChange>.01&&wake.foam>0&&wake.foam<driven.foam&&wake.nan===0,{metrics:wake,heightChange:delta,wakeRegionMaxHeight:localWake,wakeRegionChange:localChange});
  for(let i=181;i<=420;i++){const t=(i-181)/30;r.update(i/30,[boat(-4+t,.8,Math.sin(t)*.23),boat(4-t,-2,Math.PI),{...boat(-70,-12.5,.1),speed:Math.max(0,.8-t*.15)}],i/30);if(i%15===0)await yieldFrame();}
  check('crossing / turning / berth / oar / bridge field remains finite',r.metrics().nan===0,{metrics:r.metrics()});
  r.sampleBoats(engine.life.boats);await new Promise(res=>requestAnimationFrame(res));await new Promise(res=>requestAnimationFrame(res));r.sampleBoats(engine.life.boats);check('all hull samples have finite height and unit normals',[...r.sampleCache.values()].every(s=>Number.isFinite(s.height)&&Math.abs(s.normal.length()-1)<1e-6),{samples:r.sampleCache.size});
  const free=r.sampleSurface(37.1234,1.2345);let rejected=false;try{r.sampleSurface(NaN,0);}catch{rejected=true;}check('world coordinate sampling also works away from hulls',Number.isFinite(free.height)&&Math.abs(free.normal.length()-1)<1e-6&&rejected,{height:free.height,normal:free.normal.toArray(),invalidCoordinatesRejected:rejected});
  let masked=0,leaked=0;engine.renderer.readRenderTargetPixels(r.a,0,0,r.width,r.height,sampleAfter);for(let i=0;i<sampleAfter.length;i+=4)if(r.mask.image.data[i]===0){masked++;if(Math.abs(sampleAfter[i])>1e-8)leaked++;}check('banks / bridge abutments / piles exclude the persistent field',masked>0&&leaked===0,{masked,leaked});
  const pauseSteps=r.steps,pauseTime=engine.life.time;engine.render(app.camera(),saved.time);engine.render(app.camera(),saved.time+1);check('pause keeps the world and field unchanged',r.steps===pauseSteps&&engine.life.time===pauseTime);
  let p=[0,-21,2.26];for(let i=0;i<540;i++)p=engine.navigation.move(p,0,.08).position;check('walk across Hongqiao',p[1]>20,{end:p});
  const door=engine.navigation.doors.find(d=>d.a.instances[d.index].name.startsWith('Riverfront'));const old=door.current;door.current=0;engine.navigation.updateDoor(door);const c={...door.box};door.current=door.mo.openAngle;engine.navigation.updateDoor(door);check('door geometry and collision move together',Math.hypot(door.box.x-c.x,door.box.y-c.y)>.3);door.current=old;engine.navigation.updateDoor(door);
  for(const poiIndex of [1,3,14]){
   const poi=engine.data.navigation.landmarks[poiIndex];app.walker.spawn(poi.position);const start=[...app.walker.position],camera={eye:world([start[0],start[1],start[2]+1.6]),target:world(poi.target),fov:66};let entered=false;
   for(let i=0;i<210;i++){const room=app.walker.step(camera,new Set(['KeyW']),1/60);entered ||= !!room;}
   const forward=[...app.walker.position];for(let i=0;i<210;i++)app.walker.step(camera,new Set(['KeyS']),1/60);
   check('enter and leave '+english(poi.name),Math.hypot(forward[0]-start[0],forward[1]-start[1])>1&&(poiIndex===14||entered),{entered,forward,returned:app.walker.position});
  }
  r.reset();r.lastTime=engine.life.time;
  for(const style of ['color','silk','off']){if(style==='off')engine.style.set({enabled:0});else{engine.style.setPreset(style);engine.style.set({enabled:1});}for(let i=0;i<10;i++){app.setView(i,true);engine.render(app.camera(),saved.time);check(`view ${i+1} / ${style} compiles and renders`,engine.error===0);await yieldFrame();}}
  report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack||error.message;}
 finally{engine.river.reset();engine.river.lastTime=engine.life.time;engine.clockLast=performance.now()/1000;engine.animate=saved.animate;engine.style.setPreset(saved.preset);engine.style.set(saved.settings);app.setView(0,true);button.disabled=false;report.finished=new Date().toISOString();show();}
 return report;
}
