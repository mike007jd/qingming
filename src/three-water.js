import * as THREE from 'three';
import {AdvancedRiver,riverSurfaceGLSL,riverPaintGLSL} from './advanced-river.js';

/** The simulator accepts Y-up metres; only the inherited ecology boundary is Z-up. */
export class ThreeRiver extends AdvancedRiver {
 constructor(engine){
  const piles=[];
  for(const a of engine.sourceAssets)if(a.name==='Timber_dock_with_crane')for(const m of a.baseMatrices){
   for(const x of [-1.85,1.85])for(const z of [-3.4,0,3.4]){
    const v=new THREE.Vector3(x,z,0).applyMatrix4(new THREE.Matrix4().fromArray(m));piles.push([v.x,v.z,.16]);
   }
  }
  super(engine.renderer,engine.scene,{domain:[-260,-24,260,24],piles,abutments:[[0,-16.7,4.1,2.7],[0,16.7,4.1,2.7]]});
  Object.assign(this.uniforms,engine.style.uniforms);
  this.engine=engine;this.strength=1;this.flow=.26;this.boats=[];this.oarTips=new Map();this.contacts=[];
  this.queryWidth=Math.max(1,engine.life.boats.length*5);this.queryData=new Float32Array(this.queryWidth*4);
  this.queryTexture=new THREE.DataTexture(this.queryData,this.queryWidth,1,THREE.RGBAFormat,THREE.FloatType);this.queryTexture.needsUpdate=true;
  this.queryTarget=new THREE.WebGLRenderTarget(this.queryWidth,1,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.queryPixels=new Float32Array(this.queryWidth*4);this.sampleCache=new Map();this.queryScene=new THREE.Scene();
  this.boatSamples=new Map();this.pendingQuery=null;this.boatSampleTime=-Infinity;this.queryError=null;
  this.queryMaterial=new THREE.ShaderMaterial({uniforms:{...this.uniforms,query:{value:this.queryTexture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D query;${riverSurfaceGLSL}\nvoid main(){vec2 p=texture2D(query,vUv).xy;vec2 e=uFieldTexel*uDomain.zw;float h=waves(p).x+field(p).r;float dx=(waves(p+vec2(e.x,0.)).x+field(p+vec2(e.x,0.)).r-waves(p-vec2(e.x,0.)).x-field(p-vec2(e.x,0.)).r)/(2.*e.x);float dz=(waves(p+vec2(0.,e.y)).x+field(p+vec2(0.,e.y)).r-waves(p-vec2(0.,e.y)).x-field(p-vec2(0.,e.y)).r)/(2.*e.y);gl_FragColor=vec4(h,dx,dz,1.);}`,depthTest:false,depthWrite:false});
  this.queryScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.queryMaterial));
  this.spray=[];this.sprayPositions=new Float32Array(2048*3);this.sprayAlpha=new Float32Array(2048);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.sprayPositions,3));geo.setAttribute('life',new THREE.BufferAttribute(this.sprayAlpha,1));geo.setDrawRange(0,0);
  this.sprayPoints=new THREE.Points(geo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{...engine.style.uniforms,scale:{value:700}},vertexShader:'attribute float life;uniform float scale;varying float a;void main(){a=life;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(scale*.022/max(.1,-p.z),1.,6.);gl_Position=projectionMatrix*p;}',fragmentShader:riverPaintGLSL+'varying float a;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;gl_FragColor=vec4(riverPaint(vec3(.72,.77,.69),0.,.6),a*(1.-smoothstep(.15,.5,r))*.6);}'}) );this.sprayPoints.frustumCulled=false;engine.scene.add(this.sprayPoints);
  const pos=engine.sharedAttributes.position,tag=engine.sharedAttributes.qmRegion,idx=engine.sharedIndex;
  for(const b of engine.life.boats){let best=null;for(const d of b.binding.a.draws){const draw=engine.data.manifest.draws[d];for(let j=draw.indexOffset/4;j<draw.indexOffset/4+draw.count;j++){const k=idx.array[j];if(tag.array[k]!==301)continue;const q=[pos.getX(k),pos.getY(k),pos.getZ(k)];if(!best||q[2]<best[2])best=q;}}if(best)this.oarTips.set(b.id,best);}
 }
 syncBoats(boats,visible=true){
  this.boats=boats.map(b=>({index:b.id,position:[b.p[0],.28,-b.p[1]],heading:[Math.cos(b.heading),-Math.sin(b.heading)],speed:visible?b.speedNow:0,length:b.length,width:b.beam,moored:b.speedNow<.025,kind:b.type,oarContacts:[]}));
  this.contacts=[];
  for(let i=0;i<boats.length;i++){
   const b=boats[i],tip=this.oarTips.get(b.id);if(!tip||!visible||b.speedNow<.025)continue;
   const phase=this.time*2.4+b.phase,activity=THREE.MathUtils.smoothstep(b.speedNow,.02,.45),az=Math.sin(phase-.4)*.21*activity,ax=-Math.sin(phase)*.19*activity;
   const pivot=new THREE.Vector3(-b.length*.36,b.beam*.4,.95),q=new THREE.Vector3(...tip).sub(pivot).applyAxisAngle(new THREE.Vector3(0,0,1),az).applyAxisAngle(new THREE.Vector3(1,0,0),ax).add(pivot);
   const hull=new THREE.Matrix4().fromArray(b.binding.a.matrices[b.binding.i]);hull.elements[15]=1;const tipWorld=q.applyMatrix4(hull);tipWorld.x+=b.p[0]-hull.elements[12];tipWorld.z+=-b.p[1]-hull.elements[14];const contact={position:tipWorld.toArray(),strength:activity};
   this.boats[i].oarContacts.push(contact);if(contact.position[1]<.36)this.contacts.push(contact);
  }
 }
 step(dt,t,boats){this.uniforms.uDebug.value=this.debug||0;this.uniforms.uWaveScale.value=this.strength;this.stepMat.uniforms.flow.value.set(this.flow/this.domain.z,0);this.time=t;this.syncBoats(boats,!this.engine.hidden.has('boats'));super.update(t,this.boats,t,true);this.stepSpray(dt);}
 sampleKey(x,z){return `${x.toFixed(4)},${z.toFixed(4)}`;}
 reset(){super.reset();this.sampleCache?.clear();this.boatSamples?.clear();this.pendingQuery=null;this.boatSampleTime=-Infinity;this.queryError=null;}
 sampleBoats(boats){
  if(this.queryError)throw this.queryError;
  const points=[],ids=boats.map(b=>b.id),time=this.uniforms.uTime.value;
  for(const b of boats){const c=Math.cos(b.heading),s=Math.sin(b.heading),x=b.p[0],z=-b.p[1];points.push([x,z],[x+c*2,z-s*2],[x-c*2,z+s*2],[x-s,z-c],[x+s,z+c]);}
  const store=samples=>{this.boatSamples=new Map(ids.map((id,i)=>[id,samples.slice(i*5,i*5+5)]));this.boatSampleTime=time;};
  const e=this.engine,async=e.animate&&!e.exporting&&!e.captureSize&&!e.recording&&e.fixedTime===undefined;
  // Both live detail tiers use delayed readback; captures and recording keep exact samples.
  // Keep at most one delayed batch, addressed by boat identity rather than old coordinates.
  // ponytail: samples may lag by up to 0.25 simulation seconds; refresh synchronously beyond that.
  if(!async||ids.some(id=>!this.boatSamples.has(id))||Math.abs(time-this.boatSampleTime)>.25){
   this.pendingQuery=null;store(this.samplePoints(points));
  }else if(!this.pendingQuery){
   const pending={};this.pendingQuery=pending;
   pending.promise=this.samplePoints(points,{async:true}).then(samples=>{
    if(this.pendingQuery===pending){store(samples);this.pendingQuery=null;}
   },error=>{if(this.pendingQuery===pending){this.pendingQuery=null;this.queryError=error;}});
  }
  this.sampleCache.clear();this.sampleRevision=this.cacheRevision();
  boats.forEach((b,i)=>this.boatSamples.get(b.id).forEach((sample,j)=>this.sampleCache.set(this.sampleKey(...points[i*5+j]),sample)));
 }
 cacheRevision(){return `${this.uniforms.uTime.value}:${this.steps}:${this.uniforms.uWaveScale.value}`;}
 samplePoints(points,{async=false}={}){
  if(points.length>this.queryWidth||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new RangeError('Water sampling requires finite world X/Z coordinates');
  const decode=pixels=>points.map((_,i)=>{const [h,dx,dz]=pixels.subarray(i*4,i*4+3);if(![h,dx,dz].every(Number.isFinite))throw new Error('Water sampling returned a non-finite value');return {height:.28+h,normal:new THREE.Vector3(-dx,1,-dz).normalize()};});
  points.forEach((p,i)=>this.queryData.set([p[0],p[1],0,0],i*4));
  const r=this.renderer,old=r.getRenderTarget();this.queryTexture.needsUpdate=true;
  try{
   r.setRenderTarget(this.queryTarget);r.render(this.queryScene,this.quadCamera);
   if(async){
    const result=r.readRenderTargetPixelsAsync(this.queryTarget,0,0,this.queryWidth,1,new Float32Array(this.queryPixels.length));
    // r179 leaves PIXEL_PACK_BUFFER bound until its promise settles; synchronous readers need it unbound.
    const gl=r.getContext();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    return result.then(decode);
   }
   r.readRenderTargetPixels(this.queryTarget,0,0,this.queryWidth,1,this.queryPixels);return decode(this.queryPixels);
  }finally{r.setRenderTarget(old);}
 }
 sampleSurface(x,z){
  const revision=this.cacheRevision();if(this.sampleRevision!==revision){this.sampleCache.clear();this.sampleRevision=revision;}
  const key=this.sampleKey(x,z);if(!this.sampleCache.has(key))this.sampleCache.set(key,this.samplePoints([[x,z]])[0]);return this.sampleCache.get(key);
 }
 sampleHeight(x,y){return (this.sampleSurface(x,-y)?.height??.28)-.28;}
 stepSpray(dt){
  for(const c of this.contacts)for(let k=0;k<3;k++){const a=this.time*91+k*2.399;this.spray.push({p:c.position.slice(),v:[Math.cos(a)*.35,.6+k*.12,Math.sin(a)*.35],age:0,life:.45});}
  for(const b of this.boats)if(b.speed>.25){const [dx,dz]=b.heading;for(const side of [-1,1])this.spray.push({p:[b.position[0]+dx*b.length*.43-dz*b.width*.35*side,.34,b.position[2]+dz*b.length*.43+dx*b.width*.35*side],v:[dx*.22-dz*side*.22,.3+b.speed*.12,dz*.22+dx*side*.22],age:0,life:.4});}
  this.spray=this.spray.filter(p=>{p.age+=dt;p.v[1]-=9.81*dt;for(let i=0;i<3;i++)p.p[i]+=p.v[i]*dt;return p.age<p.life&&p.p[1]>.25;}).slice(-2048);
  for(let i=0;i<this.spray.length;i++){this.sprayPositions.set(this.spray[i].p,i*3);this.sprayAlpha[i]=Math.sin(Math.PI*this.spray[i].age/this.spray[i].life);}
  this.sprayPoints.geometry.attributes.position.needsUpdate=true;this.sprayPoints.geometry.attributes.life.needsUpdate=true;this.sprayPoints.geometry.setDrawRange(0,this.spray.length);
 }
 renderSources(camera,beforePass){const visible=this.sprayPoints.visible;this.sprayPoints.visible=false;super.renderSources(camera,beforePass);this.sprayPoints.visible=visible;}
 get stats(){return {gridVertices:this.mesh.geometry.attributes.position.count,field:[this.width,this.height],simulationSteps:this.steps,emitters:this.emitters,spray:this.spray.length,method:'v07 persistent field + finite-depth waves + shared GPU hull samples'};}
 dispose(){this.pendingQuery=null;this.boatSamples.clear();this.sampleCache.clear();for(const t of [this.a,this.b,this.force,this.reflection,this.refraction,this.queryTarget])t.dispose();for(const t of [this.mask,this.queryTexture,this.uniforms.uMicro.value])t.dispose();for(const m of [this.material,this.stepMat,this.forceMat,this.queryMaterial,this.sprayPoints.material])m.dispose();this.cinemaGeometry?.dispose();this.autoGeometry?.dispose();for(const c of this.waterChunks||[])c.geometry.dispose();if(!this.cinemaGeometry)this.mesh.geometry.dispose();this.sprayPoints.geometry.dispose();}
}
