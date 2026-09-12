// Minimal-scene prevalidation for optimization batch 2 (refraction reuse):
// does a second render() into an already-resolved 4x MSAA target still see the
// first pass's multisample depth, and does a fullscreen color-only restore
// triangle reconstruct the first pass exactly? Route: ?msaatest=1
// The scene is self-contained (red box near/above water, blue box below water,
// one semi-transparent water plane sampling the snapshot); it borrows only the
// engine's renderer/gl. Results are POSTed to /capture/msaatest-report.json.
import * as THREE from 'three';

const FS_VERTEX=`varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;

/** Batches2 gate support: any Mesh with a blended/transparent material that the
 *  water could sort against. Points/Lines/Sprites, the river surface, the spray
 *  points and the snapshot-restore triangle itself are excluded. An empty list
 *  is expected today; a non-empty list is surfaced for a manual ordering review. */
export function checkNoBlendedTransparent(engine){
 const overlayMask=engine.river?.overlayLayer!==undefined?1<<engine.river.overlayLayer:null;
 const skip=new Set([engine.river?.mesh,engine.river?.sprayPoints].filter(Boolean));
 const out=[];
 const visit=o=>{
  if(!o.isMesh||skip.has(o))return;
  if(o.isPoints||o.isLine||o.isSprite)return;
  if(overlayMask!==null&&o.layers&&o.layers.mask===overlayMask)return; // the restore triangle
  const mats=Array.isArray(o.material)?o.material:[o.material];
  for(const m of mats){
   if(!m)continue;
   const blended=(m.transparent===true)||(m.blending!==undefined&&m.blending!==THREE.NormalBlending);
   if(blended){out.push({object:o.name||o.type,material:m.name||m.type,transparent:!!m.transparent,blending:m.blending});break;}
  }
 };
 engine.scene.traverse(visit);
 return out;
}

export async function benchmark(engine,app){
 const output=document.querySelector('#verification-result'),button=document.querySelector('#run-verification');
 const show=()=>output.textContent=JSON.stringify(report,null,2);
 const report={status:'running',started:new Date().toISOString(),mode:'msaatest',scene:{},assertions:{},warnings:[]};
 const save=async(name,body)=>{try{const response=await fetch('/capture/'+name,{method:'POST',body});if(!response.ok)throw Error('HTTP '+response.status);(report.evidence??={})[name]=(await response.json()).path;}catch(e){report.warnings.push('evidence '+name+' not saved: '+e.message);}};
 button.disabled=true;const saved={animate:engine.animate,fixed:engine.fixedTime};engine.animate=false;engine.fixedTime=engine.life.time;show();
 const r=engine.renderer,gl=engine.gl,S=512,OVERLAY=2;
 const savedState={target:r.getRenderTarget(),clear:r.getClearColor(new THREE.Color()),alpha:r.getClearAlpha(),auto:r.autoClear};
 let msaa=null,snap=null,probeTarget=null;
 try{
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  report.gl={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),msaaRTTExtension:!!gl.getExtension('WEBGL_multisampled_render_to_texture'),maxSamples:gl.getParameter(gl.MAX_SAMPLES)};
  report.scene={size:S,samples:4,colorType:'HalfFloat',depthType:'UnsignedInt (DEPTH_COMPONENT24)',resolveDepthBuffer:true};
  // Targets: MSAA final (as the engine's this.final) + snapshot (as river.refraction).
  const makeTarget=(samples)=>{
   const t=new THREE.WebGLRenderTarget(S,S,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,stencilBuffer:false});
   t.depthTexture=new THREE.DepthTexture(S,S,THREE.UnsignedIntType);t.depthTexture.minFilter=t.depthTexture.magFilter=THREE.NearestFilter;
   t.samples=samples;t.resolveDepthBuffer=true;return t;
  };
  msaa=makeTarget(4);snap=makeTarget(0);
  // Minimal scene.
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(50,1,.5,100);camera.position.set(0,2.6,6.4);camera.lookAt(0,-.6,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const red=new THREE.Mesh(new THREE.BoxGeometry(1.3,1.3,1.3),new THREE.MeshBasicMaterial({color:new THREE.Color(1,0,0)}));red.position.set(-1.7,.7,1.2);scene.add(red);
  const blue=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.6),new THREE.MeshBasicMaterial({color:new THREE.Color(0,0,1)}));blue.position.set(1.8,-1.05,-2.4);scene.add(blue);
  const bg=new THREE.Color(.25,.22,.30);
  // Water: samples the snapshot color+depth, fixed texel-aligned refraction
  // offset, 50% tint mix at alpha .8 - simple enough to predict in JS.
  const waterUniforms={tColor:{value:snap.texture},tDepth:{value:snap.depthTexture},uNear:{value:camera.near},uFar:{value:camera.far}};
  const waterMat=new THREE.ShaderMaterial({
   vertexShader:`varying vec4 vScreen;varying float vViewDepth;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vViewDepth=-mv.z;vScreen=projectionMatrix*mv;gl_Position=vScreen;}`,
   fragmentShader:`uniform sampler2D tColor,tDepth;uniform float uNear,uFar;varying vec4 vScreen;varying float vViewDepth;
float viewZ(float d){return uNear*uFar/((uFar-uNear)*d-uFar);}
void main(){
 vec2 uv=vScreen.xy/vScreen.w*.5+.5;
 float under=-viewZ(texture2D(tDepth,uv).r);
 vec2 refrUV=under>vViewDepth?clamp(uv+vec2(3.,-2.)/vec2(512.),vec2(.0),vec2(1.)):uv;
 vec3 col=mix(texture2D(tColor,refrUV).rgb,vec3(.10,.50,.45),.5);
 gl_FragColor=vec4(col,.8);
}`,uniforms:waterUniforms,transparent:true,depthWrite:false,depthTest:true,toneMapped:false});
  const water=new THREE.Mesh(new THREE.PlaneGeometry(16,16),waterMat);water.rotation.x=-Math.PI/2;water.layers.enable(OVERLAY);scene.add(water);
  // Restore triangle (overlay layer only, color-only fast path). The fallback
  // variant additionally re-emits gl_FragDepth from the snapshot depth.
  const fsGeo=new THREE.BufferGeometry();fsGeo.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  let restoreMat=new THREE.ShaderMaterial({vertexShader:FS_VERTEX,fragmentShader:`uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tColor,vUv).rgb,1.);}`,uniforms:{tColor:{value:snap.texture}},depthTest:false,depthWrite:false,toneMapped:false});
  const overlay=new THREE.Mesh(fsGeo,restoreMat);overlay.frustumCulled=false;overlay.renderOrder=-100;overlay.matrixAutoUpdate=false;overlay.layers.set(OVERLAY);scene.add(overlay);
  // Copy pass: color then gl_FragDepth, in its own scene (mirrors river.copySnapshot).
  const copyScene=new THREE.Scene(),copyCam=new THREE.Camera();
  const copyColorMat=new THREE.ShaderMaterial({vertexShader:FS_VERTEX,fragmentShader:`uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=texture2D(tColor,vUv);}`,uniforms:{tColor:{value:null}},depthTest:false,depthWrite:false,toneMapped:false});
  const copyDepthMat=new THREE.ShaderMaterial({vertexShader:FS_VERTEX,fragmentShader:`uniform sampler2D tDepth;varying vec2 vUv;void main(){gl_FragDepth=texture2D(tDepth,vUv).r;}`,uniforms:{tDepth:{value:null}},depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,colorWrite:false,toneMapped:false});
  const copyColor=new THREE.Mesh(fsGeo,copyColorMat),copyDepth=new THREE.Mesh(fsGeo,copyDepthMat);
  for(const m of [copyColor,copyDepth]){m.frustumCulled=false;m.visible=false;copyScene.add(m);}
  // Depth probe: reads a depth texture back as float via a color render.
  probeTarget=new THREE.WebGLRenderTarget(S,S,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});
  const probeMat=new THREE.ShaderMaterial({vertexShader:FS_VERTEX,fragmentShader:`uniform sampler2D tDepth;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tDepth,vUv).r,0.,0.,1.);}`,uniforms:{tDepth:{value:null}},depthTest:false,depthWrite:false,toneMapped:false});
  const probeScene=new THREE.Scene(),probeCam=new THREE.Camera();const probeMesh=new THREE.Mesh(fsGeo,probeMat);probeMesh.frustumCulled=false;probeScene.add(probeMesh);
  // Readback helpers. The MSAA target must be read through three's
  // readRenderTargetPixels: it binds the resolved texture framebuffer, while a
  // raw gl.readPixels would hit the multisample framebuffer and fail.
  const halfToByte=u16=>{const s=(u16&0x8000)?-1:1,e=(u16>>10)&0x1f,f=u16&0x3ff;let v;if(e===0)v=s*f*Math.pow(2,-24);else if(e===31)v=f?NaN:s*Infinity;else v=s*(1+f/1024)*Math.pow(2,e-15);return Math.max(0,Math.min(255,Math.round(v*255)));};
  const readColor=t=>{const n=S*S*4;if(t.texture.type===THREE.UnsignedByteType){const p=new Uint8Array(n);r.readRenderTargetPixels(t,0,0,S,S,p);return p;}const h=new Uint16Array(n);r.readRenderTargetPixels(t,0,0,S,S,h);const p=new Uint8Array(n);for(let i=0;i<n;i++)p[i]=halfToByte(h[i]);return p;};
  const readDepthFloat=tex=>{probeMat.uniforms.tDepth.value=tex;r.setRenderTarget(probeTarget);const auto=r.autoClear;r.autoClear=false;try{r.render(probeScene,probeCam);}finally{r.autoClear=auto;}const f=new Float32Array(S*S*4);r.readRenderTargetPixels(probeTarget,0,0,S,S,f);return f;};
  const pixelOf=(world,cam)=>{const v=world.clone().project(cam);return {x:Math.round((v.x*.5+.5)*S),y:Math.round((v.y*.5+.5)*S)};};
  const patch=(buf,px,py,rad=2)=>{let s=[0,0,0];let n=0;for(let y=py-rad;y<=py+rad;y++)for(let x=px-rad;x<=px+rad;x++){if(x<0||y<0||x>=S||y>=S)continue;const i=(y*S+x)*4;s[0]+=buf[i];s[1]+=buf[i+1];s[2]+=buf[i+2];n++;}return s.map(v=>v/n);};
  const at=(buf,px,py)=>{px=Math.min(S-1,Math.max(0,px));py=Math.min(S-1,Math.max(0,py));const i=(py*S+px)*4;return [buf[i],buf[i+1],buf[i+2]];};
  const copySnapshot=(source)=>{
   if(source===snap)throw Error('feedback loop');
   const oldAuto=r.autoClear;r.autoClear=false;
   try{
    copyColorMat.uniforms.tColor.value=source.texture;copyColor.visible=true;r.setRenderTarget(snap);r.render(copyScene,copyCam);copyColor.visible=false;
    copyDepthMat.uniforms.tDepth.value=source.depthTexture;copyDepth.visible=true;r.render(copyScene,copyCam);copyDepth.visible=false;
   }finally{r.autoClear=oldAuto;}
  };
  // One full B-sequence frame. If readAfterMain is provided it captures the
  // first-pass output (color+depth) between the main render and the overlay.
  const runFrame=capture=>{
   water.visible=false;
   r.setRenderTarget(msaa);r.setClearColor(bg,1);r.clear();r.render(scene,camera);
   const out={};
   if(capture){out.first=readColor(msaa);out.firstDepth=readDepthFloat(msaa.depthTexture);}
   copySnapshot(msaa);
   if(capture){out.snap=readColor(snap);out.snapDepth=readDepthFloat(snap.depthTexture);}
   water.visible=true;
   const mask=camera.layers.mask,auto=r.autoClear;r.autoClear=false;
   try{camera.layers.set(OVERLAY);r.setRenderTarget(msaa);r.render(scene,camera);}finally{camera.layers.mask=mask;r.autoClear=auto;}
   if(capture){out.final=readColor(msaa);}
   return out;
  };
  // --- Frame 1 with full capture ---
  const f1=runFrame(true);
  if(gl.getError())throw Error('GL error during frame 1');
  // Water's top screen row: project the far edge of the plane; rows above it are background-only.
  let top=0;for(let x=-8;x<=8;x+=2){const p=pixelOf(new THREE.Vector3(x,0,-8),camera);top=Math.max(top,p.y);}
  const bgStart=Math.min(S-1,top+8);
  // a. Background restore + snapshot copy fidelity. bgMax compares the overlay
  // output against the first pass in the water-free background rows; copyMax
  // verifies the snapshot copy over the ENTIRE image (it is a pure copy).
  let bgMax=0,copyMax=0;
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const i=(y*S+x)*4;for(let c=0;c<3;c++){copyMax=Math.max(copyMax,Math.abs(f1.snap[i+c]-f1.first[i+c]));if(y>=bgStart)bgMax=Math.max(bgMax,Math.abs(f1.final[i+c]-f1.first[i+c]));}}
  let depthCopyMax=0;for(let i=0;i<S*S*4;i+=4)depthCopyMax=Math.max(depthCopyMax,Math.abs(f1.snapDepth[i]-f1.firstDepth[i]));
  report.assertions.a_background_restore={pass:bgMax<=1&&copyMax<=1&&depthCopyMax<1e-6,finalVsFirstMaxDiff:bgMax,snapshotVsFirstMaxDiff:copyMax,depthCopyMaxDiff:depthCopyMax,backgroundRows:S-bgStart};
  // b. Depth ordering: the blue box below the water is seen through it with the
  // predicted blend. The box center and its water-plane ray hit share a pixel,
  // so projecting the box center targets exactly the covering water fragment.
  const bluePx=pixelOf(blue.position.clone(),camera);
  const refr=at(f1.snap,bluePx.x+3,bluePx.y-2),dst=at(f1.snap,bluePx.x,bluePx.y),got=patch(f1.final,bluePx.x,bluePx.y);
  const expected=[0,1,2].map(c=>.8*(.5*refr[c]+.5*[25.5,127.5,114.75][c])+.2*dst[c]);
  const blendErr=Math.max(...got.map((v,c)=>Math.abs(v-expected[c])));
  const blueThrough=got[2]>got[0]+30; // blue dominant through the teal tint
  report.assertions.b_depth_occlusion={pass:blendErr<=2.5&&blueThrough,waterPixel:got.map(v=>+v.toFixed(2)),expected:expected.map(v=>+v.toFixed(2)),maxError:+blendErr.toFixed(2),blueDominant:blueThrough};
  // c. MSAA depth survival: the red box in front of the water rejects the water.
  const redPx=pixelOf(new THREE.Vector3(-1.7,.7,1.2),camera);
  const redBefore=patch(f1.first,redPx.x,redPx.y),redAfter=patch(f1.final,redPx.x,redPx.y);
  let redErr=Math.max(...redAfter.map((v,c)=>Math.abs(v-redBefore[c])));
  let depthSurvived=redErr<=1;
  let fallbackUsed=false,fallbackRecovered=null;
  // Assertion d compares frame 5 against a reference from the SAME material
  // configuration, so a fallback switch must refresh the reference too.
  let referenceFinal=f1.final;
  if(!depthSurvived){
   // Documented fallback: write gl_FragDepth from the snapshot in the restore
   // draw itself (depthFunc Always so the write always happens).
   fallbackUsed=true;
   restoreMat.dispose();
   restoreMat=new THREE.ShaderMaterial({vertexShader:FS_VERTEX,fragmentShader:`uniform sampler2D tColor,tDepth;varying vec2 vUv;void main(){gl_FragDepth=texture2D(tDepth,vUv).r;gl_FragColor=vec4(texture2D(tColor,vUv).rgb,1.);}`,uniforms:{tColor:{value:snap.texture},tDepth:{value:snap.depthTexture}},depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,toneMapped:false});
   overlay.material=restoreMat;
   const f2=runFrame(true);
   referenceFinal=f2.final;
   const redAfter2=patch(f2.final,redPx.x,redPx.y);
   const redErr2=Math.max(...redAfter2.map((v,c)=>Math.abs(v-redBefore[c])));
   fallbackRecovered=redErr2<=1;depthSurvived=fallbackRecovered;
   redErr=redErr2;
  }
  report.assertions.c_msaa_depth_survival={pass:depthSurvived,redPixelFirst:redBefore.map(v=>+v.toFixed(1)),redPixelFinal:redAfter.map(v=>+v.toFixed(1)),maxError:+redErr.toFixed(2),fallbackUsed,fallbackRecovered,note:fallbackUsed?'r179/driver dropped multisample depth across the resolve; the gl_FragDepth restore-write fallback recovered it. The engine restore material must be switched to this variant before shipping.':'multisample depth survived the resolve; the fast color-only restore path is valid on this GPU.'};
  // d. No feedback loop: four more identical frames must not drift.
  for(let i=0;i<4;i++)runFrame(false);
  const f5=readColor(msaa);
  let changed=0,waterChanged=0;
  for(let i=0;i<referenceFinal.length;i+=4)for(let c=0;c<3;c++){if(f5[i+c]!==referenceFinal[i+c])changed++;}
  for(let y=0;y<bgStart;y++)for(let x=0;x<S;x++){const i=(y*S+x)*4;for(let c=0;c<3;c++){if(f5[i+c]!==referenceFinal[i+c])waterChanged++;}}
  report.assertions.d_no_feedback_loop={pass:changed===0,changedChannels:changed,waterRegionChangedChannels:waterChanged,frames:5,reference:fallbackUsed?'fallback material frame 1':'fast-path frame 1'};
  // e. Blended-transparent inventory on the live engine scene.
  const blended=checkNoBlendedTransparent(engine);
  report.assertions.e_blended_transparent={pass:blended.length===0,count:blended.length,items:blended,note:'Non-empty lists need a manual water-ordering review; empty is the expected current state.'};
  report.status=Object.values(report.assertions).every(a=>a.pass)?'passed':'failed';
  report.finished=new Date().toISOString();
  await save('msaatest-report.json',JSON.stringify(report));
 }catch(error){report.status='failed';report.error=error.stack||error.message;report.finished=new Date().toISOString();}
 finally{
  try{
   for(const t of [msaa,snap,probeTarget])t?.dispose();
   r.setRenderTarget(savedState.target);r.setClearColor(savedState.clear,savedState.alpha);r.autoClear=savedState.auto;
  }catch(e){report.warnings.push('cleanup: '+e.message);}
  engine.animate=saved.animate;engine.fixedTime=saved.fixed;engine.clockLast=performance.now()/1000;
  button.disabled=false;delete report.current;show();
 }
 return report;
}
