// Frozen baseline (A side) for this round's performance review: verbatim copies of
// the current engine render / CrowdSystem.update / updateBatches. Per-LOD-batch
// recomputation of spheres and frustum tests, the full bone-palette upload, the
// dedicated refraction draw inside renderSources and the per-frame getError are all
// preserved on purpose. Later batches of this optimization round must not edit this
// file; the live methods they change become the B side compared against it.
import * as T from 'three';
import {projectedDiameter,selectLOD} from '../src/lod.js';

// Harness-only instrumentation hook: tests/perfreview-browser.js installs a timed
// wrapper here during A-side sampling so stageMs.crowd can include the frozen crowd
// update. null keeps the verbatim frozen call below.
export const harness={crowdUpdate:null};

// simulation.js helpers referenced by the frozen CrowdSystem.update (module-private
// there; copied verbatim so later changes cannot alter the A side).
function crowdMixAngle(a,b,t){let d=(b-a+Math.PI*3)%(Math.PI*2)-Math.PI;return a+d*t;}
function CLIP_DURATION(name){return name==='Carry'?1.28:1.15;}

// Verbatim copy of CrowdSystem.update (src/simulation.js), including the
// unconditional full-texture needsUpdate at the end.
export function crowdUpdate(time,dt,eye){
  const nav=this.world,player=this.engine.playerPosition,grid=new Map(),cell=1.5;this.stats.visiblePoseUpdates=0;this.stats.separationContacts=0;
  for(const a of this.actors){const key=Math.floor(a.p[0]/cell)+','+Math.floor(a.p[1]/cell);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(a);}
  for(const a of this.actors){const old=[...a.p];let moved=0;
   if(a.walk&&dt>0){let aim=this.routeAt(a.distance+.65),dx=aim.p[0]-a.p[0],dy=aim.p[1]-a.p[1],len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;let sx=0,sy=0;
    const cx=Math.floor(a.p[0]/cell),cy=Math.floor(a.p[1]/cell);for(let ix=cx-1;ix<=cx+1;ix++)for(let iy=cy-1;iy<=cy+1;iy++)for(const b of grid.get(ix+','+iy)||[]){if(a===b||Math.abs(a.p[2]-b.p[2])>1.1)continue;const xx=a.p[0]-b.p[0],yy=a.p[1]-b.p[1],dd=Math.hypot(xx,yy),range=a.radius+b.radius+.25;if(dd<range&&dd>.001){const strength=(range-dd)/range; sx+=xx/dd*strength*1.8;sy+=yy/dd*strength*1.8;this.stats.separationContacts++;}}
    if(player){const xx=a.p[0]-player[0],yy=a.p[1]-player[1],dd=Math.hypot(xx,yy);if(dd<1.15&&dd>.001&&Math.abs(a.p[2]-player[2])<1.1){sx+=xx/dd*(1.15-dd)*2.4;sy+=yy/dd*(1.15-dd)*2.4;}}
    dx+=sx;dy+=sy;len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
    const options={radius:a.radius,height:1.65*a.scale[2],step:.25,drop:.4};
    // Probe ahead and choose a clear local tangent around carts / market counters.
    const probe=nav.move(a.p,dx*.70,dy*.70,options),advance=Math.hypot(probe.position[0]-a.p[0],probe.position[1]-a.p[1]);
    if(advance<.46){let best=-Infinity,bx=dx,by=dy;for(const angle of [-1.35,-.9,-.5,.5,.9,1.35]){const cs=Math.cos(angle),sn=Math.sin(angle),tx=dx*cs-dy*sn,ty=dx*sn+dy*cs,p=nav.move(a.p,tx*.68,ty*.68,options),travel=Math.hypot(p.position[0]-a.p[0],p.position[1]-a.p[1]),score=travel-.09*Math.abs(angle)+.006*Math.sin(a.id+angle);if(score>best){best=score;bx=tx;by=ty;}}if(best>advance){dx=bx;dy=by;}}
    const result=nav.move(a.p,dx*a.speed*dt,dy*a.speed*dt,options);a.p=result.position;moved=Math.hypot(a.p[0]-old[0],a.p[1]-old[1]);
    // Route progress advances only on movement; skipped movement cannot tunnel through a building.
    a.distance+=moved;if(Math.hypot(aim.p[0]-a.p[0],aim.p[1]-a.p[1])<.2)a.distance+=.12;
    if(moved>.0002){const desired=Math.atan2(a.p[0]-old[0],-(a.p[1]-old[1]));a.heading=crowdMixAngle(a.heading,desired,1-Math.exp(-dt*9));}
    const desired=moved>dt*.05?(a.a.name.includes('porter')?'Carry':'Walk'):'Idle';if(desired!==a.clip){a.oldClip=a.clip;a.clip=desired;a.blend=0;}
    a.walkClock+=moved/(.45/(.6*CLIP_DURATION(a.clip==='Carry'?'Carry':'Walk'))); // speed-matched gait clock
   }
   if(this.engine.fixedTime!==undefined&&a.walk){a.walkClock=time;a.clip=a.a.name.includes('porter')?'Carry':'Walk';}
   a.blend=Math.min(1,a.blend+dt/.30);
   const m=a.a.matrices[a.index];if(a.crew){a.p=[m[12],-m[14],m[13]];const boat=this.engine.life?.boats.find(b=>b.id===a.a.instances[a.index].motion.group);if(boat){let clip=boat.speedNow>.08?'Work':'Idle';if(clip!==a.clip){a.oldClip=a.clip;a.clip=clip;a.blend=0;}}}else {const c=Math.cos(a.heading),s=Math.sin(a.heading);m.set([c*a.scale[0],0,-s*a.scale[0],0,-s*a.scale[1],0,-c*a.scale[1],0,0,a.scale[2],0,0,a.p[0],a.p[2],-a.p[1],a.id+10]);}m[15]=a.id+10;
   const center=a.a.centers[a.index];center[0]=a.p[0];center[1]=a.p[2]+.88*a.scale[2];center[2]=-a.p[1];
   const dist=Math.hypot(eye[0]-a.p[0],eye[1]-a.p[2],eye[2]+a.p[1]);if(time<a.lastPose||time-a.lastPose>(dist>90?.18:dist>40?.07:0)||!Number.isFinite(a.lastPose)||this.engine.fixedTime!==undefined){this.pose(a,time);a.lastPose=time;this.stats.visiblePoseUpdates++;}
  }
  this.texture.needsUpdate=true;
 }

// Verbatim copy of ThreeCityEngine.updateBatches (src/three-engine.js): every LOD
// batch of an asset re-tests all instances; selection happens on the lod===0 batch;
// active-prefix ranges are uploaded; the details updateLOD hook is invoked.
export function updateBatches(camera,pass='main'){
 this._vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this._vp);let draws=0,triangles=0,instances=0;const levels=[0,0,0];if(pass==='shadow'){this.sunLight.shadow.updateMatrices(this.sunLight);this.shadowFrustum.copy(this.sunLight.shadow.getFrustum());}
 for(const b of this.batches){const a=b.a;let n=0;if(!a.replaced&&!this.hidden.has(a.category))for(let i=0;i<a.matrices.length;i++){const mat=a.matrices[i],cx=mat[0]*a.center[0]+mat[4]*a.center[1]+mat[8]*a.center[2]+mat[12],cy=mat[1]*a.center[0]+mat[5]*a.center[1]+mat[9]*a.center[2]+mat[13],cz=mat[2]*a.center[0]+mat[6]*a.center[1]+mat[10]*a.center[2]+mat[14],rad=a.radius*Math.max(Math.hypot(mat[0],mat[1],mat[2]),Math.hypot(mat[4],mat[5],mat[6]),Math.hypot(mat[8],mat[9],mat[10]));
   this._sphere.center.set(cx,cy,cz);this._sphere.radius=rad;if(pass==='shadow'){
    // Shadow visibility is independent of the view; reserve 5 m for articulated parts.
    this._sphere.radius=rad+5;if(!this.shadowFrustum.intersectsSphere(this._sphere))continue;
   }else if(!this.frustum.intersectsSphere(this._sphere))continue;
   if(b.lodCount>1){
    const history=a.lodState[pass];
    if(b.lod===0){
     let pixels=projectedDiameter(camera,this.height,cx,cy,cz,rad);
     if(pass==='shadow')pixels=Math.max(pixels,projectedDiameter(this.sunLight.shadow.camera,this.sunLight.shadow.mapSize.y,cx,cy,cz,rad));
     // People share the generic [240,100] pixel thresholds: their LOD0 density
     // (48-53k tris) is hero-tier and only pays off closer than this. The
     // reflection pass is perturbed and blurred by the water shader, so it
     // selects one tier coarser than the main view.
     const tier=selectLOD(pixels,[240,100],history[i],pass==='reflection'?1:0);
     history[i]=this.lodEnabled?Math.min(b.lodCount-1,tier):0;
    }
    if(b.lod!==history[i])continue;
   }
   b.matrices.set(mat,n*16);b.matrices[n*16+15]=1;b.meta.array[n]=mat[15];n++;
  }
  b.count=n;b.meta.clearUpdateRanges();
  if(n){b.meta.addUpdateRange(0,n);b.meta.needsUpdate=true;}
  // Each material draw shares this batch's matrix buffer. Upload it once.
  const matrix=b.meshes[0]?.instanceMatrix;
  if(matrix){matrix.clearUpdateRanges();if(n){matrix.addUpdateRange(0,n*16);matrix.needsUpdate=true;}}
  for(const mesh of b.meshes){mesh.visible=n>0;mesh.count=n;if(n){draws++;triangles+=mesh.geometry.drawRange.count*n/3;}}instances+=n;levels[b.lod||0]+=n;
 }
 this.details?.userData.updateLOD?.(camera,pass);return{draws,triangles,instances,levels};}

// Verbatim copy of ThreeCityEngine.render (src/three-engine.js). The only change:
// the per-frame crowd update routes through this file's frozen crowdUpdate (or the
// harness wrapper installed around it) instead of the live CrowdSystem.update.
export function render(c,time){
  this._renderSignature=null;
  this.resize();const dt=this.clockLast===undefined?0:Math.min(.10,Math.max(0,time-this.clockLast));this.clockLast=time;
  this.life.paused=!this.animate;this.life.player=this.playerPosition;this.renderer.info.reset();
  this.life.advance(this.animate&&this.fixedTime===undefined?dt:0);this.time=this.fixedTime??this.life.time;
  this.river.time=this.time;this.river.uniforms.uTime.value=this.time;this.river.uniforms.uWaveScale.value=this.river.strength;this.river.uniforms.uArt.value=this.style.settings.enabled;this.river.uniforms.uDebug.value=this.river.debug||0;
  this.river.sampleBoats(this.life.boats);this.updateInstances();this.lifeBinding.apply();this.navigation.animateDoors(this.animate?dt:0,this.playerPosition);(harness.crowdUpdate||crowdUpdate).call(this.crowd,this.time,this.animate?dt:0,c.eye);
  this.camera.position.fromArray(c.eye);this.camera.up.set(0,1,0);this.camera.aspect=this.width/this.height;this.camera.fov=c.fov||49;this.camera.lookAt(new T.Vector3(...c.target));this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);this.lighting(this.camera);
  this.style.update(this.time);this.style.uniforms.qiLightDirection.value.copy(this.sunDirection);
  for(const u of this.materialUniforms){u.qmTime.value=this.time;u.qmWind.value=this.wind;}
  this.details?.userData.update?.(this.time);this.routeGroup.visible=this.showRoutes;
  this.river.uniforms.uSun.value.copy(this.sunDirection);this.river.uniforms.uSunColor.value.copy(this.sunLight.color).multiplyScalar(1.2);
  this.river.mesh.visible=false;this.river.sprayPoints.visible=false;this.scene.updateMatrixWorld(true);
  this.updateBatches(this.camera,'shadow');this.renderer.shadowMap.needsUpdate=true;
  const autoClear=this.renderer.autoClear;this.renderer.autoClear=false;
  try{this.renderer.render(this.shadowPass,this.camera);}finally{this.renderer.autoClear=autoClear;}
  this.renderer.shadowMap.needsUpdate=false;
  // renderSources ends with the main camera: reuse its identical instance buffers.
  let mainStats;this.river.renderSources(this.camera,cam=>{mainStats=this.updateBatches(cam,cam===this.camera?'main':'reflection');});
  this.river.mesh.visible=true;this.river.sprayPoints.visible=!this.hidden.has('boats');
  this.renderer.setRenderTarget(this.final);this.renderer.setClearColor(this.style.uniforms.qiPaper.value);this.renderer.clear();this.renderer.render(this.scene,this.camera);
  this.post.render(this.scene,this.camera,null,{colorTexture:this.final.texture});
  const total=this.renderer.info.render;this.error=this.gl.getError();
  if(this.renderer.info.programs.some(p=>p.diagnostics&&p.diagnostics.runnable===false))throw new Error('A material shader failed to compile. See the browser console.');
  if(this.error)throw new Error('WebGL error code: '+this.error);
  this.frame++;return {engine:'Three.js',revision:T.REVISION,draws:mainStats.draws,triangles:mainStats.triangles,totalDraws:total.calls,totalTriangles:total.triangles,gpuError:this.error,water:this.river.stats,lod:{enabled:this.lodEnabled,instances:mainStats.levels,details:this.details?.userData.lodStats},memory:{...this.renderer.info.memory}};
 }
