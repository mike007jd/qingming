import * as THREE from 'three';
import {V,multiply,transform,Z_TO_Y,CollisionWorld,CrowdSystem,CityEcology,LifeBinding} from './simulation.js';
import {makeCityMaterials} from './three-materials.js';
import {ThreeRiver} from './three-water.js';
import {QingmingStyle} from './QingmingStyle.js';
import {QingmingPass} from './QingmingPass.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {loadSceneDetails} from './scene-details.js';
import {projectedDiameter,selectLOD} from './lod.js';
import {makeAutoBatches} from './auto-batches.js';
const T=THREE;
const SKY_V=`varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SKY_F=`varying vec3 dir;uniform vec3 sun;uniform float clock;uniform float art;uniform vec3 paper;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}float fbm(vec2 p){return .52*noise(p)+.27*noise(p*2.03)+.135*noise(p*4.09)+.075*noise(p*8.11);}
void main(){vec3 d=normalize(dir);float y=max(d.y,0.);vec3 sky=mix(vec3(.61,.65,.65),vec3(.14,.29,.49),pow(y,.47));float s=max(0.,dot(d,sun));sky+=vec3(1.,.79,.50)*pow(s,14.)*.15+vec3(3.,2.65,2.1)*smoothstep(.99975,.99997,s);vec2 p=d.xz/(.30+y)*2.8+vec2(clock*.001,0.);float cloud=smoothstep(.53,.73,fbm(p))*smoothstep(.02,.25,y)*(1.-smoothstep(.8,.98,y));sky=mix(sky,vec3(.9,.91,.86),cloud*.63);sky=mix(sky,paper*(.96+.035*y),art);gl_FragColor=vec4(sky,1.);
}`;
export class ThreeCityEngine {
 constructor(canvas,data){if(!T?.WebGLRenderer)throw new Error('The bundled Three.js library could not load.');this.canvas=canvas;this.data=data;this.name=`THREE.JS r${T.REVISION} · A Living Scroll`;this.time=0;this.animate=true;this.fixedTime=undefined;this.hidden=new Set();this.lodEnabled=true;this.wind=1;this.ink=1;this.sunHour=15.5;this.exposure=1.02;this.shadowDirty=true;this.showRoutes=false;this._sourceSignature=null;
 this.renderer=new T.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});this.gl=this.renderer.getContext();this.timerExt=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');this.passTimes={};this.profilePasses=false;this._passRing={};this._passQueries=[];this._activePass=null;this._wholeFrame=false;this._frameQuery=null;if(!this.renderer.capabilities.isWebGL2)throw new Error('This scene requires WebGL2 and hardware acceleration.');if(!this.gl.getExtension('EXT_color_buffer_float'))throw new Error('Floating-point water buffers are unavailable. Use a desktop browser with hardware acceleration enabled.');const readableType=this.renderer.capabilities.textureTypeReadable;this.renderer.capabilities.textureTypeReadable=type=>type===T.FloatType||readableType(type);this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.NoToneMapping;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;this.renderer.info.autoReset=false;this.style=new QingmingStyle({preset:"color",lineStrength:.34,paperColor:"#e7d9bc",grain:.12,relief:.24,shadowStrength:.16}); this.scene=new T.Scene();this.scene.matrixWorldAutoUpdate=false;this.scene.fog=new T.FogExp2(new T.Color('#d4c39e'),.00125);this.camera=new T.PerspectiveCamera(49,1,.15,1400);this.reflectionCamera=this.camera.clone();this.sunDirection=new T.Vector3(-.57,.65,.51).normalize();
 this.skyMaterial=new T.ShaderMaterial({uniforms:{sun:{value:this.sunDirection},clock:{value:0},art:this.style.uniforms.qiEnabled,paper:this.style.uniforms.qiPaper},vertexShader:SKY_V,fragmentShader:SKY_F,side:T.BackSide,depthWrite:false});this.sky=new T.Mesh(new T.SphereGeometry(900,24,12),this.skyMaterial);this.sky.name='Procedural_atmosphere';this.sky.frustumCulled=false;this.sky.renderOrder=-10;this.scene.add(this.sky);
 const envScene=new T.Scene();envScene.add(new T.Mesh(new T.SphereGeometry(100,16,8),this.skyMaterial));this.pmrem=new T.PMREMGenerator(this.renderer);this.environment=this.pmrem.fromScene(envScene,.04,.1,200);this.scene.environment=this.environment.texture;
 this.sunLight=new T.DirectionalLight(new T.Color(1,.91,.77),3.25);this.sunLight.castShadow=true;this.sunLight.shadow.bias=-.00008;this.sunLight.shadow.normalBias=.065;this.scene.add(this.sunLight,this.sunLight.target);this.scene.add(new T.HemisphereLight(new T.Color(.61,.76,1.),new T.Color(.45,.34,.22),.67));this.scene.add(new T.AmbientLight(new T.Color(.81,.75,.61),.18));
 this.localLights=Array.from({length:6},()=>{const l=new T.PointLight(0xffd49a,1,8,2);this.scene.add(l);return l;});
 this.sourceAssets=data.manifest.assets.map(a=>{const matrices=a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),b=a.bounds,center=b[0].map((v,i)=>(v+b[1][i])*.5),radius=Math.hypot(...b[0].map((v,i)=>(b[1][i]-v)*.5)),category=/Person/.test(a.name)?'people':/Willow|Broadleaf|reeds|Courtyard_life/.test(a.name)?'trees':/boat|barge|Ferry|skiff/i.test(a.name)?'boats':/^(Horse_saddled|Ox_saddled|Handcart|Covered_goods_cart)$/.test(a.name)?'animals':/hill/.test(a.name)?'hills':'city';return {...a,matrices,baseMatrices:matrices.map(m=>new Float32Array(m)),center,centers:matrices.map(m=>transform(m,center)),radius,category};});
 this.maxPixelRatio=1;this.navigation=new CollisionWorld(data.navigation);this.navigation.registerDoors(this.sourceAssets);this.crowd=new CrowdSystem(this,data.rigs,this.navigation);this.life=new CityEcology(data.ecology,this.navigation);this.life.attachPeople(this.crowd.actors);this.lifeBinding=new LifeBinding(this,this.life);
 makeCityMaterials(this);this.createGeometry();this.river=new ThreeRiver(this);this.life.onBoatStep=(dt,t,b)=>this.river.step(dt,t,b);this.buildRouteLines();
  // r179 depth materials need an active renderer state. This empty render creates
  // that state, then draws only the full shadow map (no discarded city color pass).
  this.shadowPass=new T.Scene();this.shadowPass.onAfterRender=(renderer,_,camera)=>renderer.shadowMap.render([this.sunLight],this.scene,camera);
  this.post=new QingmingPass(this.renderer,this.style,{samples:2,normalThreshold:.28});this.setQuality('auto');this.frustum=new T.Frustum();this.shadowFrustum=new T.Frustum();this._vp=new T.Matrix4();this._mat=new T.Matrix4();this._sphere=new T.Sphere();this._center=new T.Vector3();this.reflectionVP=new T.Matrix4();this.frame=0;this.error=0;this.gpuErrorCheck=true;this.renderSequence='refraction-reuse';this.river.sprayPoints.layers.enable(this.river.overlayLayer);
  // r179 culls lights by camera layers inside projectObject; without this the
  // overlay-layer water pass would lose NUM_DIR_LIGHT_SHADOWS and its shadow mask.
  // All lights (not just the sun) keep the pass's light counts identical to the
  // main pass so the water material does not compile a second program variant.
  this.scene.traverse(o=>{if(o.isLight)o.layers.enable(this.river.overlayLayer);});this.updateInstances();this.lifeBinding.apply();this.crowd.update(0,0,[60,40,60]);
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();window.dispatchEvent(new CustomEvent('scene-error',{detail:'The GPU context was lost. Close other GPU-heavy tabs and reload.'}));});
 }
 createGeometry(){const m=this.data.manifest,n=m.vertexCount;
 // Derived SoA layout: one decompressed buffer holds every attribute block, so
 // geometry becomes typed-array views instead of a per-vertex DataView unpack.
 // Every block is bounds-checked against the manifest; a mismatch is a hard
 // load error - never a silent switch back to the interleaved file.
 if(this.data.soaBuffer){
  const g=m.geometry,types={float32:Float32Array,int16:Int16Array,uint16:Uint16Array,uint8:Uint8Array},sizes={float32:4,int16:2,uint16:2,uint8:1};
  const expected={position:['float32',3,false],normal:['int16',3,true],uv:['float32',2,false],color:['uint8',4,true],joints:['uint16',4,false],weights:['uint8',4,true],region:['float32',1,false]},views={};
  for(const [name,[type,components,normalized]] of Object.entries(expected)){
   const b=g?.blocks?.[name];
   if(!g||g.format!=='soa-v1'||!b||b.type!==type||b.components!==components||b.normalized!==normalized||b.count!==n||b.offset%sizes[type]!==0||b.offset+b.count*components*sizes[type]>g.byteLength)
    throw new Error('City geometry block "'+name+'" does not match the runtime manifest. Rebuild the derived file with: python3 tools/pack_city_soa.py');
   views[name]=new types[type](this.data.soaBuffer,b.offset,b.count*components);
  }
  const idx=g.index;
  if(idx.type!=='uint32'||idx.offset%4!==0||idx.offset+idx.count*4!==g.byteLength||idx.count!==m.indexCount)
   throw new Error('City geometry index block does not match the runtime manifest. Rebuild the derived file with: python3 tools/pack_city_soa.py');
  this.sharedAttributes={position:new T.BufferAttribute(views.position,3),normal:new T.BufferAttribute(views.normal,3,true),uv:new T.BufferAttribute(views.uv,2),color:new T.BufferAttribute(views.color,4,true),qmJoints:new T.BufferAttribute(views.joints,4),qmWeights:new T.BufferAttribute(views.weights,4,true),qmRegion:new T.BufferAttribute(views.region,1)};
  this.sharedIndex=new T.BufferAttribute(new Uint32Array(this.data.soaBuffer,idx.offset,idx.count),1);this.batches=[];
 }else{
  const dv=new DataView(this.data.bin),p=new Float32Array(n*3),normal=new Int16Array(n*3),uv=new Float32Array(n*2),color=new Uint8Array(n*4),joints=new Uint16Array(n*4),weights=new Uint8Array(n*4),region=new Float32Array(n);
  for(let i=0;i<n;i++){const o=i*m.vertexStride;for(let k=0;k<3;k++){p[i*3+k]=dv.getFloat32(o+k*4,true);normal[i*3+k]=dv.getInt16(o+12+k*2,true);}for(let k=0;k<2;k++)uv[i*2+k]=dv.getFloat32(o+20+k*4,true);for(let k=0;k<4;k++){color[i*4+k]=dv.getUint8(o+28+k);joints[i*4+k]=dv.getUint16(o+32+k*2,true);weights[i*4+k]=dv.getUint8(o+40+k);}region[i]=dv.getInt16(o+18,true);}
  this.sharedAttributes={position:new T.BufferAttribute(p,3),normal:new T.BufferAttribute(normal,3,true),uv:new T.BufferAttribute(uv,2),color:new T.BufferAttribute(color,4,true),qmJoints:new T.BufferAttribute(joints,4),qmWeights:new T.BufferAttribute(weights,4,true),qmRegion:new T.BufferAttribute(region,1)};this.sharedIndex=new T.BufferAttribute(new Uint32Array(this.data.bin,m.indexByteOffset,m.indexCount),1);this.batches=[];
 }
 for(const a of this.sourceAssets){if(a.name==='River_water')continue;const original=a.lodDraws?.length?a.lodDraws:[a.draws];a.pixelVisible={main:new Uint8Array(a.matrices.length).fill(1),reflection:new Uint8Array(a.matrices.length).fill(1),shadow:new Uint8Array(a.matrices.length).fill(1)};a.shadowVisible=new Uint8Array(a.matrices.length).fill(1);for(const [tier,levels] of a.autoLodDraws?[['cinema',original],['auto',a.autoLodDraws]]:[[null,original]]){a.lodState={main:new Uint8Array(a.matrices.length),reflection:new Uint8Array(a.matrices.length),shadow:new Uint8Array(a.matrices.length)};for(let lod=0;lod<levels.length;lod++){const cap=Math.max(1,a.instances.length),matrixArray=new Float32Array(cap*16),meta=new T.InstancedBufferAttribute(new Float32Array(cap),1).setUsage(T.DynamicDrawUsage),batch={a,tier,lod,lodCount:levels.length,matrices:matrixArray,meta,meshes:[]};
  const matrixAttr=new T.InstancedBufferAttribute(matrixArray,16).setUsage(T.DynamicDrawUsage);
  for(const di of levels[lod]){const d=m.draws[di],src=m.materials[d.material];if(src.extras?.surface==='water')continue;const g=new T.BufferGeometry();for(const [k,v]of Object.entries(this.sharedAttributes))g.setAttribute(k,v);g.setAttribute('qmMeta',meta);g.setIndex(this.sharedIndex);g.setDrawRange(d.indexOffset/4,d.count);g.boundingSphere=new T.Sphere(new T.Vector3(...a.center),a.radius);const mesh=new T.InstancedMesh(g,this.getCityMaterial(d.material,a),cap);mesh.instanceMatrix=matrixAttr;mesh.frustumCulled=false;mesh.castShadow=a.category!=='hills';mesh.receiveShadow=true;mesh.customDepthMaterial=this.getCityMaterial(d.material,a,true);mesh.name=a.name+' / '+src.name+' / LOD'+lod;mesh.visible=false;batch.meshes.push(mesh);this.scene.add(mesh);}
  this.batches.push(batch);
 }}}
 }
 target(w,h,depth=true){const t=new T.WebGLRenderTarget(w,h,{type:T.HalfFloatType,format:T.RGBAFormat,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:depth,stencilBuffer:false});if(depth){t.depthTexture=new T.DepthTexture(w,h,T.UnsignedIntType);t.depthTexture.minFilter=t.depthTexture.magFilter=T.NearestFilter;}return t;}
 setQuality(mode='auto'){
  if(!['auto','cinema'].includes(mode))throw new RangeError('Unknown quality tier: '+mode);
  if(this.quality===mode){this.resize();return;}
  this.quality=mode;this.style.setPerformanceMode?.(mode==='auto');this.lodEnabled=true;this.lodDetailScale=mode==='cinema'?1.5:1;this.settings={shadow:1024,samples:2,ao:true};this.sunLight.shadow.mapSize.setScalar(this.settings.shadow);this.sunLight.shadow.map?.dispose();this.sunLight.shadow.map=null;this.river?.setGeometryQuality?.(mode);
  for(const a of this.sourceAssets||[])for(const state of Object.values(a.lodState||{}))state.fill(0);
  // Both tiers retain the original filtering and light projection.
  this.resetPassProfile();this.shadowDirty=true;this.gpuErrorCheck=true;this._renderSignature=null;this.resize();
 }
 resize(){
  // Detail and display resolution are independent; Retina must not silently bypass the chosen cap.
  const ratio=Math.min(devicePixelRatio||1,this.maxPixelRatio??1),w=Math.max(2,Math.round(this.captureSize?.[0]??this.canvas.clientWidth*ratio)),h=Math.max(2,Math.round(this.captureSize?.[1]??this.canvas.clientHeight*ratio));
  if(w!==this.width||h!==this.height||this.final?.samples!==this.settings.samples){this.width=w;this.height=h;this.renderer.setPixelRatio(1);this.renderer.setSize(w,h,false);this.final?.dispose();this.final=this.target(w,h);this.final.samples=this.settings.samples;
  // Batch 2 (refraction reuse): the final depth must survive the MSAA resolve so
  // copySnapshot can copy it into the river snapshot. The old false skipped an
  // unused resolve; the resolve cost is now part of the experiment under test.
  this.final.resolveDepthBuffer=true;this.post?.setSize(w,h,1);this.river?.resize(w,h);this.shadowDirty=true;this.gpuErrorCheck=true;}
 }
 async loadDetails(progress){
  this.details=await loadSceneDetails(this,GLTFLoader,progress);
  const entries=[];this.autoCitySources=[];this.batchPass='main';
  for(const a of this.sourceAssets){if(!a.autoLodDraws||a.rig||['boats','animals'].includes(a.category))continue;const groups=new Map();a.nativeVisible={main:new Uint8Array(a.instances.length),reflection:new Uint8Array(a.instances.length),shadow:new Uint8Array(a.instances.length)};
   for(const b of this.batches.filter(b=>b.a===a&&b.tier==='auto')){const slots=new Map();for(const source of b.meshes){this.autoCitySources.push(source);const slot=slots.get(source.material.id)||0;slots.set(source.material.id,slot+1);const key=source.material.id+':'+slot;if(!groups.has(key))groups.set(key,{source,geometries:[],levels:[]});const group=groups.get(key);group.levels[b.lod]=group.geometries.length;group.geometries.push(source.geometry);}}
   for(const group of groups.values()){const tier=i=>a.lodState[this.batchPass][i];entries.push({...group,capacity:a.instances.length,level:i=>group.levels[tier(i)],count:()=>a.instances.length,visible:i=>!!a.nativeVisible[this.batchPass][i]&&group.levels[tier(i)]!==undefined,matrix:(i,m)=>{m.fromArray(a.matrices[i]);m.elements[15]=1;}});}
  }
  this.autoCityBatches=makeAutoBatches(this.scene,entries);
  this.scene.add(this.details);this.details.updateMatrixWorld(true);this.gpuErrorCheck=true;
 }
 updateInstances(){for(const a of this.sourceAssets)for(let i=0;i<a.instances.length;i++)a.matrices[i].set(a.baseMatrices[i]);}
 updateBatches(camera,pass='main'){
 this._vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this._vp);let draws=0,triangles=0,instances=0;const levels=[0,0,0];if(pass==='shadow'){this.sunLight.shadow.updateMatrices(this.sunLight);this.shadowFrustum.copy(this.sunLight.shadow.getFrustum());}
 // All LOD batches of an asset share the same per-instance tests: group the
 // flat batch list by asset so sphere, frustum and level selection each run
 // once per instance instead of once per LOD level.
 const groups=new Map();for(const b of this.batches){if(b.tier&&b.tier!==this.quality){for(const mesh of b.meshes)mesh.visible=false;continue;}let g=groups.get(b.a);if(!g){g={bs:[],counts:[]};groups.set(b.a,g);}g.bs.push(b);g.counts.push(0);}
 this.batchPass=pass;
 for(const [a,{bs,counts}] of groups){
  a.nativeVisible?.[pass].fill(0);
  const selector=bs.find(b=>b.lod===0)??bs[0],multi=selector.lodCount>1,byLod=[];
  if(multi){for(let j=0;j<bs.length;j++)byLod[bs[j].lod]=j;}
  const history=multi?a.lodState[pass]:null;
  if(!a.replaced&&!this.hidden.has(a.category))for(let i=0;i<a.matrices.length;i++){
   const mat=a.matrices[i],cx=mat[0]*a.center[0]+mat[4]*a.center[1]+mat[8]*a.center[2]+mat[12],cy=mat[1]*a.center[0]+mat[5]*a.center[1]+mat[9]*a.center[2]+mat[13],cz=mat[2]*a.center[0]+mat[6]*a.center[1]+mat[10]*a.center[2]+mat[14],rad=a.radius*Math.max(Math.hypot(mat[0],mat[1],mat[2]),Math.hypot(mat[4],mat[5],mat[6]),Math.hypot(mat[8],mat[9],mat[10]));
   this._sphere.center.set(cx,cy,cz);this._sphere.radius=this.quality==='auto'&&a.autoCullRadius?rad*a.autoCullRadius/a.radius:rad;
   if(pass==='shadow'){
    // Shadow visibility is independent of the view; reserve 5 m for articulated parts.
    this._sphere.radius+=5;if(!this.shadowFrustum.intersectsSphere(this._sphere))continue;
   }else if(!this.frustum.intersectsSphere(this._sphere))continue;
   const pixels=projectedDiameter(camera,this.height,cx,cy,cz,rad);
   if(this.quality==='auto'&&a.rig){
    const visible=a.pixelVisible[pass];visible[i]=visible[i]?Number(pixels>=3):Number(pixels>5);if(!visible[i])continue;
    if(pass==='shadow'){const distance=Math.hypot(cx-this.camera.position.x,cy-this.camera.position.y,cz-this.camera.position.z);a.shadowVisible[i]=distance>(a.shadowVisible[i]?44:40)?0:1;if(!a.shadowVisible[i])continue;}
   }
   if(a.nativeVisible)a.nativeVisible[pass][i]=1;
   if(multi){
    const thresholds=this.quality==='auto'&&a.rig?[180,60]:[240,100];
    history[i]=this.lodEnabled?Math.min(selector.lodCount-1,selectLOD(pixels*(this.lodDetailScale??1),thresholds,history[i],pass==='main'?0:this.quality==='auto'||pass==='reflection'?1:0)):0;
    const j=byLod[history[i]];if(j===undefined)continue;
    const b=bs[j];b.matrices.set(mat,counts[j]*16);b.matrices[counts[j]*16+15]=1;b.meta.array[counts[j]]=mat[15];counts[j]++;
   }else for(let j=0;j<bs.length;j++){const b=bs[j];b.matrices.set(mat,counts[j]*16);b.matrices[counts[j]*16+15]=1;b.meta.array[counts[j]]=mat[15];counts[j]++;}
  }
 }
 // Finalize back in flat batch order so reported totals match the ungrouped
 // implementation bit-for-bit.
 for(const b of this.batches){if(b.tier&&b.tier!==this.quality)continue;const {bs,counts}=groups.get(b.a),n=counts[bs.indexOf(b)];
  b.count=n;b.meta.clearUpdateRanges();
  if(n){b.meta.addUpdateRange(0,n);b.meta.needsUpdate=true;}
  // Each material draw shares this batch's matrix buffer. Upload it once.
  const matrix=b.meshes[0]?.instanceMatrix;
  if(matrix){matrix.clearUpdateRanges();if(n){matrix.addUpdateRange(0,n*16);matrix.needsUpdate=true;}}
  for(const mesh of b.meshes){mesh.visible=n>0;mesh.count=n;if(n){draws++;triangles+=mesh.geometry.drawRange.count*n/3;}}instances+=n;levels[b.lod||0]+=n;
 }
 this.autoCityBatches?.update(this.quality==='auto');if(this.quality==='auto')for(const mesh of this.autoCitySources||[])mesh.visible=false;this.details?.userData.updateLOD?.(camera,pass);return{draws,triangles,instances,levels};}
 lighting(camera){const elevation=Math.max(.16,Math.sin((this.sunHour-6)/12*Math.PI)*.85);this.sunDirection.set(-.57,elevation,.51).normalize();const late=this.sunHour>17;this.sunLight.color.setRGB(1,late?.73:.91,late?.47:.77);this.sunLight.intensity=late?2.7:3.25;this.skyMaterial.uniforms.sun.value=this.sunDirection;this.skyMaterial.uniforms.clock.value=this.time;
 const direction=new T.Vector3();camera.getWorldDirection(direction);const center=camera.position.clone().addScaledVector(direction,Math.min(60,Math.max(14,camera.position.y*1.4)));center.y=2;const span=Math.max(23,Math.min(150,camera.position.y*1.9+20));
 this.sunLight.position.copy(center).addScaledVector(this.sunDirection,240);this.sunLight.target.position.copy(center);const sc=this.sunLight.shadow.camera;sc.left=sc.bottom=-span;sc.right=sc.top=span;sc.near=20;sc.far=520;sc.updateProjectionMatrix();
 // Full paint ignores point lighting. PBR retains six slots even when lights are distant,
 // so camera movement changes uniforms instead of compiling new shader layouts.
 const lights=this.navigation.lights.map(l=>({l,d:Math.hypot(l.position[0]-camera.position.x,l.position[2]-camera.position.y,l.position[1]+camera.position.z)})).filter(x=>x.d<15).sort((a,b)=>a.d-b.d).slice(0,this.localLights.length);this.localLights.forEach((l,i)=>{const x=lights[i]?.l;l.visible=!this.style.performancePaint;if(!x){l.intensity=0;return;}l.position.set(x.position[0],x.position[2],-x.position[1]);l.color.fromArray(x.color);l.intensity=9;l.distance=x.radius;});
 }
 buildRouteLines(){this.routeGroup=new T.Group();this.routeGroup.name='Navigation_debug_routes';for(const r of this.data.ecology.routes){let points=r.points.map(p=>new T.Vector3(p[0],(p[2]??2.2)+.07,-p[1]));if(r.closed)points.push(points[0]);const g=new T.BufferGeometry().setFromPoints(points),mat=new T.LineBasicMaterial({color:r.id.includes('water')||r.id.includes('boat')?0x79c2c5:0xad9259});this.routeGroup.add(new T.Line(g,mat));}this.scene.add(this.routeGroup);this.routeGroup.visible=false;}
 // Poll only the small public render inputs while paused; explicit render() still forces a frame.
 renderIfChanged(c,time){
  const active=this.animate||this.recording;
  const signature=active?null:JSON.stringify([c,this.canvas.clientWidth,this.canvas.clientHeight,devicePixelRatio,this.maxPixelRatio,this.captureSize,this.fixedTime,this.style.settings,this.sunHour,this.wind,this.river.strength,this.river.flow,this.river.debug,this.showRoutes,this.quality,[...this.hidden],this.playerPosition]);
  if(!active&&!this.shadowDirty&&signature===this._renderSignature){this.clockLast=time;return null;}
  const stats=this.render(c,time);this._renderSignature=signature;return stats;
 }
 render(c,time){
  this._renderSignature=null;
  this.resize();const dt=this.clockLast===undefined?0:Math.min(.10,Math.max(0,time-this.clockLast));this.clockLast=time;
  this.life.paused=!this.animate;this.life.player=this.playerPosition;this.renderer.info.reset();this.framePassTimes={};this.passCounts={};
  this.life.advance(this.animate&&this.fixedTime===undefined?dt:0);this.time=this.fixedTime??this.life.time;
  this.river.time=this.time;this.river.uniforms.uTime.value=this.time;this.river.uniforms.uWaveScale.value=this.river.strength;this.river.uniforms.uDebug.value=this.river.debug||0;
  this.river.sampleBoats(this.life.boats);this.updateInstances();this.lifeBinding.apply();this.navigation.animateDoors(this.animate?dt:0,this.playerPosition);this.crowd.update(this.time,this.animate?dt:0,c.eye);
  this.camera.position.fromArray(c.eye);this.camera.up.set(0,1,0);this.camera.aspect=this.width/this.height;this.camera.fov=c.fov||49;this.camera.lookAt(new T.Vector3(...c.target));this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);this.lighting(this.camera);
  this.style.update(this.time);this.style.uniforms.qiLightDirection.value.copy(this.sunDirection);
  for(const u of this.materialUniforms){u.qmTime.value=this.time;u.qmWind.value=this.wind;}
  this.details?.userData.update?.(this.time);this.routeGroup.visible=this.showRoutes;
  this.river.uniforms.uSun.value.copy(this.sunDirection);this.river.uniforms.uSunColor.value.copy(this.sunLight.color).multiplyScalar(1.2);
  this.river.mesh.visible=false;this.river.sprayPoints.visible=false;this.scene.updateMatrixWorld(true);
  const sourceSignature=JSON.stringify([c,this.sunHour,this.wind,this.style.settings,this.showRoutes,[...this.hidden]]);
  const refreshSources=this.quality==='cinema'||!this.animate||!!this.captureSize||!!this.recording||!!this.exporting||this.fixedTime!==undefined||this.shadowDirty||sourceSignature!==this._sourceSignature||this.frame%2===0;
  // Even profiling frames time the six render segments together; odd frames
  // time them separately without nested queries. Earlier water work is excluded.
  this._wholeFrame=this.profilePasses===true&&this.timerExt&&this.frame%2===0;
  if(this._wholeFrame){this._frameQuery=this.gl.createQuery();this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT,this._frameQuery);}
  this._beginPass('shadow');
  if(refreshSources){
   this.updateBatches(this.camera,'shadow');this.renderer.shadowMap.needsUpdate=true;
   const autoClear=this.renderer.autoClear;this.renderer.autoClear=false;
   try{this.renderer.render(this.shadowPass,this.camera);}finally{this.renderer.autoClear=autoClear;this.renderer.shadowMap.needsUpdate=false;}
  }
  this._endPass();
  // Batch 2 (refraction reuse, renderSequence 'refraction-reuse'): the scene is
  // drawn once into the MSAA final target; the resolved color+depth are copied
  // into the river snapshot; then a single overlay-layer render pass restores
  // the snapshot color over the target (no depth writes) and draws water+spray,
  // which depth-test against the first pass's still-live multisample depth.
  // The city's water-source color draws drop from two (half-res refraction +
  // main) to one (the main pass itself feeds the snapshot).
  this._beginPass('reflection');
  if(refreshSources)this.river.renderReflection(this.camera,cam=>{this.updateBatches(cam,'reflection');});
  this._endPass();
  const mainStats=this.updateBatches(this.camera,'main');this._beginPass('main');
  this.renderer.setRenderTarget(this.final);this.renderer.setClearColor(this.style.uniforms.qiPaper.value);this.renderer.clear();this.renderer.render(this.scene,this.camera);this._endPass();this._beginPass('water');
  this.river.copySnapshot(this.final);
  this.river.mesh.visible=true;this.river.sprayPoints.visible=!this.hidden.has('boats');
  const savedMask=this.camera.layers.mask,savedAuto=this.renderer.autoClear;this.renderer.autoClear=false;
  try{
   this.camera.layers.set(this.river.overlayLayer);
   // No clear: the multisample color is overwritten by the restore triangle and
   // the multisample depth of the first pass must survive for the water.
   this.renderer.setRenderTarget(this.final);this.renderer.render(this.scene,this.camera);
  }finally{this.camera.layers.mask=savedMask;this.renderer.autoClear=savedAuto;}
  this._endPass();
  this.renderSequence='refraction-reuse';
  const onPass=name=>name?this._beginPass(name):this._endPass();
  this.post.render(this.scene,this.camera,null,{colorTexture:this.final.texture,onPass});
  if(this._wholeFrame){this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);this._passQueries.push({name:'frameAll',q:this._frameQuery,frame:this.frame});this._frameQuery=null;this._wholeFrame=false;}
 const total=this.renderer.info.render;this._pollPassQueries();
 const broken=this.renderer.info.programs.filter(p=>p.diagnostics&&p.diagnostics.runnable===false).map(p=>({name:p.name,log:String(p.diagnostics.program&&p.diagnostics.program.log||'').slice(0,300),vs:String(p.diagnostics.vertexShader&&p.diagnostics.vertexShader.log||'').slice(-300),fs:String(p.diagnostics.fragmentShader&&p.diagnostics.fragmentShader.log||'').slice(-300)}));if(broken.length)throw new Error('A material shader failed to compile: '+JSON.stringify(broken));
 const gpuError=this.checkGPU();
 this.shadowDirty=false;this._sourceSignature=sourceSignature;this.frame++;return {engine:'Three.js',revision:T.REVISION,draws:mainStats.draws,triangles:mainStats.triangles,totalDraws:total.calls,totalTriangles:total.triangles,gpuError,sourceRefresh:refreshSources,framePassTimes:{...this.framePassTimes},passCounts:structuredClone(this.passCounts),passTimes:{...this.passTimes},water:this.river.stats,lod:{enabled:this.lodEnabled,instances:mainStats.levels,details:this.details?.userData.lodStats},memory:{...this.renderer.info.memory}};
 }
 // T0 pass profiling: EXT_disjoint_timer_query_webgl2 queries when available
 // (results read two frames later), otherwise gl.finish()+performance.now() in
 // 'sync' mode. Enabled only while engine.profilePasses is set.
 _pushPass(name,ms){this.framePassTimes??={};this.framePassTimes[name]=ms;const ring=this._passRing[name]??=[];ring.push(ms);if(ring.length>8)ring.shift();const sorted=[...ring].sort((a,b)=>a-b);this.passTimes[name]=sorted[sorted.length>>1];}
 _beginPass(name){if(!this.profilePasses||this._wholeFrame)return;this._passInfoStart={calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};const gpu=this.profilePasses===true&&this.timerExt;if(gpu){const q=this.gl.createQuery();this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT,q);this._activePass={name,q};}else{this.gl.finish();this._activePass={name,t:performance.now()};}}
 _endPass(){if(!this.profilePasses||this._wholeFrame)return;if(!this._activePass)return;const pass=this._activePass;this._activePass=null;(this.passCounts??={})[pass.name]={calls:this.renderer.info.render.calls-this._passInfoStart.calls,triangles:this.renderer.info.render.triangles-this._passInfoStart.triangles};if(pass.q){this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);this._passQueries.push({name:pass.name,q:pass.q,frame:this.frame});}else{this.gl.finish();this._pushPass(pass.name,performance.now()-pass.t);}}
 _pollPassQueries(){if(!this._passQueries.length)return;if(this.gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)){this.resetPassProfile();return;}this._passQueries=this._passQueries.filter(e=>{if(this.frame-e.frame<2)return true;if(this.gl.getQueryParameter(e.q,this.gl.QUERY_RESULT_AVAILABLE)){this._pushPass(e.name,this.gl.getQueryParameter(e.q,this.gl.QUERY_RESULT)/1e6);this.gl.deleteQuery(e.q);return false;}return true;});}
 resetPassProfile(){for(const entry of this._passQueries)this.gl.deleteQuery(entry.q);this._passQueries=[];this._passRing={};this.passTimes={};this.framePassTimes={};this.passCounts={};}
 // gl.getError() is a synchronous pipeline stall: only poll frames flagged by
 // construction, resize/quality changes or fresh GPU resources.
 checkGPU(){if(!this.gpuErrorCheck)return null;this.gpuErrorCheck=false;this.error=this.gl.getError();if(this.error)throw new Error('WebGL error code: '+this.error);return this.error;}

 dispose(){this.autoCityBatches?.dispose();this.details?.userData.autoBatches?.dispose();this.resetPassProfile();this.details?.userData.roofBatches?.dispose();
  // Release the snapshot overlay objects owned by this engine.
  if(this.river?.overlayRestore){this.scene.remove(this.river.overlayRestore);this.river.overlayRestore.geometry.dispose();}
  for(const m of [this.river?.restoreMaterial,this.river?.copyColorMaterial,this.river?.copyDepthMaterial,this.river?.copyHalfColorMaterial,this.river?.copyHalfDepthMaterial])m?.dispose();
  this.river?.waterColor?.dispose();
  this.river.dispose();this.crowd.dispose();this.lifeBinding.dispose();this.post.dispose();this.style.dispose();this.renderer.dispose();}
}
