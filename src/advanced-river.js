import * as THREE from 'three';
import {encoded as microEncoded,size as microSize} from 'qingming/micro';

// Persistent height + vertical velocity + foam + suspended sediment.
// All forces are emitted at world positions. There is no boat-parented wake plane.
const fullVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const stepFragment=`precision highp float;
varying vec2 vUv;uniform sampler2D stateTex,forceTex,maskTex;uniform vec2 pixel,cell,flow;uniform float dt;
vec4 advected(vec2 uv){vec2 q=uv/pixel-.5,i=floor(q),f=fract(q);vec2 a=(i+.5)*pixel;return mix(mix(texture2D(stateTex,a),texture2D(stateTex,a+vec2(pixel.x,0.)),f.x),mix(texture2D(stateTex,a+vec2(0.,pixel.y)),texture2D(stateTex,a+pixel),f.x),f.y);}
float H(vec2 p,float h){return texture2D(maskTex,p).r>.5?texture2D(stateTex,p).r:h;}
void main(){vec4 mask=texture2D(maskTex,vUv);if(mask.r<.5){gl_FragColor=vec4(0.);return;}
 vec4 s=texture2D(stateTex,vUv),f=texture2D(forceTex,vUv);
 float lap=(H(vUv+vec2(pixel.x,0.),s.r)+H(vUv-vec2(pixel.x,0.),s.r)-2.*s.r)/(cell.x*cell.x)+(H(vUv+vec2(0.,pixel.y),s.r)+H(vUv-vec2(0.,pixel.y),s.r)-2.*s.r)/(cell.y*cell.y);
 vec4 adv=advected(vUv-flow*dt);
 float vel=(adv.g+lap*(9.81*mix(.12,1.8,mask.g))*dt+f.g*dt)*exp(-dt*.09);
 float height=clamp((adv.r+vel*dt+f.r*dt)*exp(-dt*.02),-.18,.18);
 float foam=clamp(adv.b*exp(-dt*.14)+f.b*dt,0.,1.);
 float turb=clamp(adv.a*exp(-dt*.19)+f.a*dt,0.,1.);
 gl_FragColor=vec4(height,clamp(vel,-.9,.9),foam,turb);
}`;
const splatVertex=`attribute vec2 center,radii,direction;attribute vec4 signal;uniform vec4 domain;varying vec2 local;varying vec4 amount;
void main(){local=position.xy;amount=signal;vec2 side=vec2(-direction.y,direction.x);vec2 p=center+direction*position.x*radii.x+side*position.y*radii.y;gl_Position=vec4(((p-domain.xy)/domain.zw)*2.-1.,0.,1.);}`;
const splatFragment=`varying vec2 local;varying vec4 amount;void main(){float r=dot(local,local),bell=exp(-r*3.5)*(1.-smoothstep(.65,1.,r));gl_FragColor=amount*bell;}`;
const sharedSurface=`
uniform float uTime,uWaveScale;uniform vec4 uDomain;uniform sampler2D uField;uniform vec2 uFieldTexel;
uniform int uShipCount;uniform vec4 uShipA[16],uShipB[16];
float bankAt(float x){return 14.25;}
float riverCenter(float x){return -3.4*sin(x/72.);}
vec2 fieldUV(vec2 p){return clamp((p-uDomain.xy)/uDomain.zw,vec2(.001),vec2(.999));}
vec4 field(vec2 p){vec2 q=fieldUV(p)/uFieldTexel-.5,i=floor(q),f=fract(q),a=(i+.5)*uFieldTexel;return mix(mix(texture2D(uField,a),texture2D(uField,a+vec2(uFieldTexel.x,0.)),f.x),mix(texture2D(uField,a+vec2(0.,uFieldTexel.y)),texture2D(uField,a+uFieldTexel),f.x),f.y);}
float nearBank(vec2 p){return smoothstep(.05,2.2,bankAt(p.x)-abs(p.y-riverCenter(p.x)));}
// Wave octaves use non-parallel directions and wavelength-correct velocities.
// Analytic derivatives exactly match the displaced mesh; the field adds local memory.
vec3 waves(vec2 p){
 vec3 h=vec3(0.);float depth=mix(.25,3.5,nearBank(p));
 // Octaves 7-11 of the old 12-layer stack are exactly zero-amplitude
 // (amp is multiplied by 1.-smoothstep(4.,9.,k) and k>=12.5 there); the
 // loop stops before them so vertex, fragment and hull sampling all match.
 for(int i=0;i<7;i++){
  float fi=float(i),theta=fi*2.399963+.24;
  vec2 d=normalize(vec2(cos(theta)*.8+1.,sin(theta)));
  float k=.70*pow(1.51,fi),amp=.042*pow(.67,fi)*uWaveScale;
  amp*=1.-smoothstep(4.,9.,k);
  float omega=sqrt(9.81*k*tanh(k*depth));
  float q=k*dot(d,p)-omega*uTime+fi*fi*1.71;
  h+=vec3(amp*sin(q),amp*k*d*cos(q));
 }
 return h*mix(.28,1.,nearBank(p));
}
// Local bow pressure and diverging shoulder waves. Long-lived wakes live in uField.
vec4 shipWave(vec2 p){vec4 sum=vec4(0.);
 for(int i=0;i<16;i++){if(i>=uShipCount)break;vec4 a=uShipA[i],b=uShipB[i];vec2 dir=a.zw,side=vec2(-dir.y,dir.x),d=p-a.xy;float x=dot(d,dir),y=dot(d,side),speed=smoothstep(.04,.65,b.x);
  float behind=b.y*.41-x,absy=abs(y),width=b.z*.48;
  float along=smoothstep(-.3,.6,behind)*(1.-smoothstep(b.y*.9,b.y+12.,behind));
  float q=absy-width-behind*.24;float sigma=.22+behind*.04;
  float g=exp(-q*q/max(.08,sigma*sigma));float env=along*speed;
  float phase=behind*2.4-uTime*1.9+b.w;
  float h=.056*g*env*cos(phase);float dq=-2.*q/max(.08,sigma*sigma);
  float hx=h*dq*.24+.056*g*env*sin(phase)*2.4;
  float hy=h*dq*sign(y);sum.xyz+=vec3(h,dir*hx+side*hy);
  float bowX=(x-b.y*.42)/.72,bowY=(absy-width*.53)/max(.28,width*.55),bow=exp(-bowX*bowX-bowY*bowY)*speed;
  sum.x+=bow*.075;sum.yz+=dir*(-2.*bowX/.72)*bow*.075+side*(-2.*bowY/max(.28,width*.55))*sign(y)*bow*.075;
  sum.w+=bow*.22+g*env*.10;
 }
 return sum;
}
`;
const waterVertex=`
#include <common>
#include <shadowmap_pars_vertex>
`+sharedSurface+`
varying vec3 vWorld;varying vec4 vReflection,vScreen;varying float vViewDepth;uniform mat4 uReflectMatrix;
void main(){vec3 p=position;vec3 w=waves(p.xz);vec4 ship=shipWave(p.xz);p.y=.28+w.x+field(p.xz).r;
 vec4 worldPosition=vec4(p,1.);vec3 transformedNormal=normalMatrix*normalize(vec3(-w.y,1.,-w.z));
 #include <shadowmap_vertex>
 vWorld=p;vReflection=uReflectMatrix*vec4(p,1.);vec4 mv=modelViewMatrix*vec4(p,1.);vViewDepth=-mv.z;vScreen=projectionMatrix*mv;gl_Position=vScreen;}`;
// The custom water and spray shaders share the scene's live pigment controls.
export const riverPaintGLSL=`
uniform float qiEnabled,qiSaturation,qiDensity;uniform vec3 qiPaper,qiInk;
vec3 riverPaint(vec3 color,float marks,float foam){
 vec3 pigment=pow(clamp(color,0.,1.),vec3(1./2.2));
 float gray=dot(pigment,vec3(.23,.63,.14));
 pigment=mix(vec3(gray),pigment,qiSaturation);
 vec3 painted=mix(qiPaper,qiPaper*pow(.08+.92*pigment,vec3(2.2)),qiDensity);
 painted=mix(painted,qiInk,clamp(marks,0.,.35));
 painted=mix(painted,qiPaper,foam*.65);
 return mix(color,painted,qiEnabled);
}`;
const waterFragment=`precision highp float;
#include <common>
#include <packing>
uniform bool receiveShadow;
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
`+sharedSurface+riverPaintGLSL+`
uniform sampler2D uReflection,uSceneColor,uSceneDepth,uMicro;uniform vec3 uSun,uSunColor,uSky;uniform float uNear,uFar,uReflectionOn,uDetail,uFoam,uDebug;
varying vec3 vWorld;varying vec4 vReflection,vScreen;varying float vViewDepth;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float viewZ(float d){return uNear*uFar/((uFar-uNear)*d-uFar);}
void main(){vec2 p=vWorld.xz;vec3 w=waves(p);vec4 s=field(p),ship=shipWave(p);
 vec2 e=uFieldTexel*uDomain.zw;
 vec2 slope=vec2((field(p+vec2(e.x,0.)).r-field(p-vec2(e.x,0.)).r)/(2.*e.x),(field(p+vec2(0.,e.y)).r-field(p-vec2(0.,e.y)).r)/(2.*e.y));
 // Short capillary ripples are directional and advected, never stationary UV noise.
 vec2 microUV=p*.075+vec2(-uTime*.016,uTime*.008);
 vec2 m1=texture2D(uMicro,microUV).rg*2.-1.;
 vec2 m2=texture2D(uMicro,p*.19+vec2(uTime*.022,-uTime*.009)).gr*2.-1.;
 vec2 m3=texture2D(uMicro,p*.39+vec2(-uTime*.025,-uTime*.015)).rg*2.-1.;
 vec2 micro=(m1*.22+m2*.12+m3*.048)*uDetail;
 vec2 gradient=w.yz+slope+micro;
 vec3 n=normalize(vec3(-gradient.x,1.,-gradient.y));vec3 v=normalize(cameraPosition-vWorld);
 float ndv=max(.001,dot(n,v)),fresnel=.025+.975*pow(1.-ndv,5.);
 vec2 screenUV=vScreen.xy/vScreen.w*.5+.5;
 vec2 offset=n.xz*.011*clamp(1.6/vViewDepth,.2,1.);
 vec2 refrUV=clamp(screenUV+offset,.002,.998);float under=-viewZ(texture2D(uSceneDepth,refrUV).r);
 if(under<vViewDepth+.03){refrUV=screenUV;under=-viewZ(texture2D(uSceneDepth,refrUV).r);}
 float thickness=clamp(under-vViewDepth,.12,8.0);float shallow=1.-smoothstep(.3,3.2,thickness);
 vec3 transmitted=texture2D(uSceneColor,refrUV).rgb;
 vec3 absorption=exp(-vec3(.42,.22,.17)*thickness);
 vec3 scatter=mix(vec3(.078,.125,.104),vec3(.14,.176,.108),shallow*.6);
 scatter=mix(scatter,vec3(.145,.166,.099),s.a*.28);
 vec3 body=transmitted*absorption*.52+scatter*(1.-absorption*.5);
 vec2 ruv=vReflection.xy/vReflection.w*.5+.5;
 // Project normal perturbation into the reflected camera, not just scrolling a texture.
 ruv+=gradient*vec2(.016,.019);ruv=clamp(ruv,.002,.998);
 vec3 reflection=texture2D(uReflection,ruv).rgb;
 reflection=mix(reflection,(texture2D(uReflection,ruv+vec2(.001,0.)).rgb+texture2D(uReflection,ruv-vec2(.001,0.)).rgb)*.5,.28);
 reflection=mix(uSky,reflection,uReflectionOn);
 vec3 col=mix(body,reflection,clamp(fresnel*.88+.08,.08,.96));
 vec3 halfV=normalize(uSun+v);float nh=max(dot(n,halfV),0.);float nl=max(dot(n,uSun),0.);float alpha=.11*.11;float den=nh*nh*(alpha*alpha-1.)+1.;float D=alpha*alpha/(3.14159*den*den+.000001);float F=.0204+.9796*pow(1.-max(dot(v,halfV),0.),5.);float k=.125;float Gv=ndv/(ndv*(1.-k)+k),Gl=nl/(nl*(1.-k)+k);float spec=min(5.,D*F*Gv*Gl/max(4.*ndv,.01));
 float shadow=getShadowMask();col*=mix(.62,1.,shadow);
 col+=uSunColor*spec*shadow;
 float foamNoise=noise(p*9.+vec2(-uTime*.18,uTime*.08))*.58+noise(p*3.4-vec2(uTime*.16,0.))*.42;
 float wakeFoam=smoothstep(.055,.54,s.b)*smoothstep(.32,.73,foamNoise)+ship.w*smoothstep(.26,.7,foamNoise);
 float shoreDist=bankAt(p.x)-abs(p.y-riverCenter(p.x));float shore=smoothstep(.02,.2,shoreDist)*(1.-smoothstep(.35,.9,shoreDist))*smoothstep(.035,.10,w.x)*foamNoise*.13;
 float foam=clamp((wakeFoam+shore)*uFoam,0.,.85);
 col=mix(col,vec3(.57,.64,.56),foam*.69);
 float depthFog=1.-exp(-max(distance(cameraPosition,vWorld)-100.,0.)*.0016);col=mix(col,uSky,depthFog);
 float caustic=pow(max(0.,1.-abs(sin(p.x*2.7+w.x*8.+uTime*.24)*sin(p.y*3.1-w.x*9.-uTime*.31))),16.);col+=vec3(.10,.105,.065)*caustic*shallow*shadow*(1.-s.a);
 // Broken, antialiased ink ripples follow the water; reflection luminance remains readable.
 float row=p.y*1.45+.10*sin(p.x*1.1-uTime*.20)+w.x*.35;
 float footprint=max(fwidth(row),.0001);
 float strokes=(1.-smoothstep(.019-footprint*.6,.019+footprint*.6,abs(fract(row+.5)-.5)))
  *(1.-smoothstep(.36,.85,footprint))*smoothstep(.25,.65,noise(vec2(p.x*.6,floor(p.y*1.45))));
 col=riverPaint(col,strokes*.16,foam);
 if(uDebug>.5)col=vec3(.5+s.r*2.,s.b,s.a);
 gl_FragColor=vec4(col,1.);
}`;

export class AdvancedRiver {
 constructor(renderer,scene,config){
  this.renderer=renderer;this.scene=scene;this.passBoundary=new THREE.Scene();this.config=config;this.time=0;this.lastTime=0;this.acc=0;this.steps=0;this.enabled=renderer.extensions.has('EXT_color_buffer_float');if(!this.enabled)throw Error('高级水体需要 WebGL2 浮点渲染目标。当前 GPU 未提供 EXT_color_buffer_float。');
  this.domain=new THREE.Vector4(config.domain[0],config.domain[1],config.domain[2]-config.domain[0],config.domain[3]-config.domain[1]);
  this.width=2048;this.height=256;this.emitters=0;this.paused=false;this.shipA=Array.from({length:16},()=>new THREE.Vector4());this.shipB=Array.from({length:16},()=>new THREE.Vector4());
  const rt=(w,h)=>new THREE.WebGLRenderTarget(w,h,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});
  this.a=rt(this.width,this.height);this.b=rt(this.width,this.height);this.force=rt(this.width,this.height);
  this.mask=this.makeMask();
  this.quadCamera=new THREE.Camera();this.stepScene=new THREE.Scene();this.forceScene=new THREE.Scene();
  this.stepMat=new THREE.ShaderMaterial({vertexShader:fullVertex,fragmentShader:stepFragment,depthTest:false,depthWrite:false,uniforms:{stateTex:{value:this.a.texture},forceTex:{value:this.force.texture},maskTex:{value:this.mask},pixel:{value:new THREE.Vector2(1/this.width,1/this.height)},cell:{value:new THREE.Vector2(this.domain.z/this.width,this.domain.w/this.height)},flow:{value:new THREE.Vector2(.15/this.domain.z,0)},dt:{value:1/120}}});
  this.stepScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.stepMat));
  const g=new THREE.InstancedBufferGeometry();const base=new THREE.PlaneGeometry(2,2);g.index=base.index;g.setAttribute('position',base.getAttribute('position'));
  for(const [n,k] of [['center',2],['radii',2],['direction',2],['signal',4]])g.setAttribute(n,new THREE.InstancedBufferAttribute(new Float32Array(320*k),k).setUsage(THREE.DynamicDrawUsage));g.instanceCount=0;
  this.forceGeometry=g;this.forceMat=new THREE.ShaderMaterial({vertexShader:splatVertex,fragmentShader:splatFragment,uniforms:{domain:{value:this.domain}},transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false});this.forceMat.blendSrc=THREE.OneFactor;this.forceMat.blendDst=THREE.OneFactor;this.forceMat.blending=THREE.CustomBlending;
  const fm=new THREE.Mesh(g,this.forceMat);fm.frustumCulled=false;this.forceScene.add(fm);
  this.reflection=new THREE.WebGLRenderTarget(768,512,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  this.refraction=new THREE.WebGLRenderTarget(768,512,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});this.refraction.depthTexture=new THREE.DepthTexture(768,512,THREE.UnsignedIntType);
  // Half-resolution water sampling source (batch 2 refinement). The full-resolution
  // refraction snapshot above stays the overlay restore source; this target only
  // feeds the water shader's transmitted-color / scene-depth taps so the water
  // keeps the original half-resolution refraction look.
  this.waterColor=new THREE.WebGLRenderTarget(768,512,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});this.waterColor.depthTexture=new THREE.DepthTexture(768,512,THREE.UnsignedIntType);
  this.reflectCamera=new THREE.PerspectiveCamera();this.reflectMatrix=new THREE.Matrix4();
  let microString=atob(microEncoded),microData=new Uint8Array(microString.length);for(let i=0;i<microData.length;i++)microData[i]=microString.charCodeAt(i);const microTex=new THREE.DataTexture(microData,microSize,microSize);microTex.wrapS=microTex.wrapT=THREE.RepeatWrapping;microTex.minFilter=THREE.LinearMipmapLinearFilter;microTex.magFilter=THREE.LinearFilter;microTex.generateMipmaps=true;microTex.needsUpdate=true;
  this.uniforms={...THREE.UniformsLib.lights,qiEnabled:{value:0},qiSaturation:{value:1},qiDensity:{value:.6},qiPaper:{value:new THREE.Color(1,1,1)},qiInk:{value:new THREE.Color(.1,.07,.04)},uMicro:{value:microTex},uTime:{value:0},uWaveScale:{value:1},uDomain:{value:this.domain},uField:{value:this.a.texture},uFieldTexel:{value:new THREE.Vector2(1/this.width,1/this.height)},uShipCount:{value:0},uShipA:{value:this.shipA},uShipB:{value:this.shipB},uReflectMatrix:{value:this.reflectMatrix},uReflection:{value:this.reflection.texture},uSceneColor:{value:this.waterColor.texture},uSceneDepth:{value:this.waterColor.depthTexture},uSun:{value:new THREE.Vector3(-.55,.7,.3).normalize()},uSunColor:{value:new THREE.Color(1,.91,.70)},uSky:{value:new THREE.Color(.37,.46,.48)},uNear:{value:.12},uFar:{value:1100},uArt:{value:1},uDebug:{value:0},uReflectionOn:{value:1},uDetail:{value:1},uFoam:{value:1}};
  this.material=new THREE.ShaderMaterial({name:'Qingming • coupled Three.js river',vertexShader:waterVertex,fragmentShader:waterFragment,uniforms:this.uniforms,side:THREE.DoubleSide,lights:true});
  // The grid follows the actual two banks. nz=128 keeps the cross-river
  // spacing (~0.22 m) close to the 0.1875 m/texel simulation field; the
  // fragment normals are computed analytically and do not depend on it.
  const nx=2048,nz=128,positions=new Float32Array((nx+1)*(nz+1)*3),indices=new Uint32Array(nx*nz*6);let j=0;
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){let wx=this.domain.x+x/nx*this.domain.z,bank=this.bank(wx)-.08;positions.set([wx,.28,this.center(wx)+(z/nz*2-1)*bank],(z*(nx+1)+x)*3);}
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){let i=z*(nx+1)+x;indices.set([i,i+nx+1,i+1,i+1,i+nx+1,i+nx+2],j);j+=6;}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setIndex(new THREE.BufferAttribute(indices,1));geo.computeBoundingSphere();
  this.mesh=new THREE.Mesh(geo,this.material);this.mesh.name='River: displaced height field, reflection, refraction';this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;this.mesh.renderOrder=3;scene.add(this.mesh);
  // Batch 2 overlay support. The restore triangle re-writes the snapshot color
  // over the MSAA target without touching depth; the water then depth-tests
  // against the still-live multisample depth of the first pass. It lives in the
  // main scene (so a single render() call draws restore+water+spray) but only
  // on the overlay layer, so every layer-0 pass - including the frozen
  // baseline - keeps behaving exactly as before.
  this.overlayLayer=2;
  const fsVertex=`varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
  const fsGeo=new THREE.BufferGeometry();fsGeo.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  this.restoreMaterial=new THREE.ShaderMaterial({name:'Qingming • snapshot restore',vertexShader:fsVertex,fragmentShader:`uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tColor,vUv).rgb,1.);}`,uniforms:{tColor:{value:this.refraction.texture}},depthTest:false,depthWrite:false,toneMapped:false});
  this.overlayRestore=new THREE.Mesh(fsGeo,this.restoreMaterial);this.overlayRestore.frustumCulled=false;this.overlayRestore.renderOrder=-100;this.overlayRestore.matrixAutoUpdate=false;this.overlayRestore.layers.set(this.overlayLayer);scene.add(this.overlayRestore);
  this.mesh.layers.enable(this.overlayLayer);
  // The snapshot copy pass runs in its own scene with a plain orthographic-free
  // camera (the fullscreen vertex shader bypasses the camera matrices).
  this.overlayCamera=new THREE.Camera();
  this.copyColorMaterial=new THREE.ShaderMaterial({name:'Qingming • snapshot copy color',vertexShader:fsVertex,fragmentShader:`uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=texture2D(tColor,vUv);}`,uniforms:{tColor:{value:null}},depthTest:false,depthWrite:false,toneMapped:false});
  this.copyDepthMaterial=new THREE.ShaderMaterial({name:'Qingming • snapshot copy depth',vertexShader:fsVertex,fragmentShader:`uniform sampler2D tDepth;varying vec2 vUv;void main(){gl_FragDepth=texture2D(tDepth,vUv).r;}`,uniforms:{tDepth:{value:null}},depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,colorWrite:false,toneMapped:false});
  // Half-resolution nearest-neighbour copies of the same snapshot for the water's
  // uSceneColor/uSceneDepth taps. Each half-res pixel (px,py) reads the exact
  // source texel (2px,2py) centre, computed from gl_FragCoord - never from vUv,
  // whose (2px+1)/sourceSize position lands on the boundary between texels and
  // would blend the wrong texel neighbourhood (half-texel misalignment).
  const halfUV=`uniform vec2 sourceSize;vec2 halfTexelUV(){return (vec2(ivec2(gl_FragCoord.xy))*2.0+0.5)/sourceSize;}`;
  this.copyHalfColorMaterial=new THREE.ShaderMaterial({name:'Qingming • half-res water color copy',vertexShader:fsVertex,fragmentShader:`uniform sampler2D tColor;`+halfUV+`void main(){gl_FragColor=texture2D(tColor,halfTexelUV());}`,uniforms:{tColor:{value:null},sourceSize:{value:new THREE.Vector2()}},depthTest:false,depthWrite:false,toneMapped:false});
  this.copyHalfDepthMaterial=new THREE.ShaderMaterial({name:'Qingming • half-res water depth copy',vertexShader:fsVertex,fragmentShader:`uniform sampler2D tDepth;`+halfUV+`void main(){gl_FragDepth=texture2D(tDepth,halfTexelUV()).r;}`,uniforms:{tDepth:{value:null},sourceSize:{value:new THREE.Vector2()}},depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,colorWrite:false,toneMapped:false});
  this.copyColorMesh=new THREE.Mesh(fsGeo,this.copyColorMaterial);this.copyColorMesh.frustumCulled=false;this.copyColorMesh.visible=false;
  this.copyDepthMesh=new THREE.Mesh(fsGeo,this.copyDepthMaterial);this.copyDepthMesh.frustumCulled=false;this.copyDepthMesh.visible=false;
  this.copyHalfColorMesh=new THREE.Mesh(fsGeo,this.copyHalfColorMaterial);this.copyHalfColorMesh.frustumCulled=false;this.copyHalfColorMesh.visible=false;
  this.copyHalfDepthMesh=new THREE.Mesh(fsGeo,this.copyHalfDepthMaterial);this.copyHalfDepthMesh.frustumCulled=false;this.copyHalfDepthMesh.visible=false;
  this.copyScene=new THREE.Scene();this.copyScene.add(this.copyColorMesh,this.copyDepthMesh,this.copyHalfColorMesh,this.copyHalfDepthMesh);
  this.material.userData.qingmingNormal=()=>new THREE.ShaderMaterial({vertexShader:waterVertex,fragmentShader:`varying vec3 vWorld;void main(){vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));gl_FragColor=vec4(n*.5+.5,0.);}`,uniforms:this.uniforms,lights:true,side:THREE.DoubleSide});
  this.reset();
 }
 bank(x){return 14.25;}
 center(x){return -3.4*Math.sin(x/72);}
 makeMask(){
  const d=new Uint8Array(this.width*this.height*4);this.piles=this.config.piles||[];
  for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++){
   const wx=this.domain.x+(x+.5)/this.width*this.domain.z,wz=this.domain.y+(y+.5)/this.height*this.domain.w;
   const bankDistance=this.bank(wx)-Math.abs(wz-this.center(wx));let water=bankDistance>0;
   if(water)for(const p of this.piles)if(Math.hypot(wx-p[0],wz-p[1])<p[2]){water=false;break;}
   if(water)for(const b of this.config.abutments||[])if(Math.abs(wx-b[0])<b[2]&&Math.abs(wz-b[1])<b[3]){water=false;break;}
   const i=(y*this.width+x)*4;d[i]=water?255:0;d[i+1]=Math.round(255*THREE.MathUtils.clamp(bankDistance/4,0,1));d[i+3]=255;
  }
  const tex=new THREE.DataTexture(d,this.width,this.height);tex.needsUpdate=true;tex.minFilter=tex.magFilter=THREE.NearestFilter;return tex;
 }
 reset(){this.acc=0;this.steps=0;this.lastTime=0;const r=this.renderer,old=r.getRenderTarget(),clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();r.setClearColor(0,0);for(let t of[this.a,this.b,this.force]){r.setRenderTarget(t);r.clear();}r.setRenderTarget(old);r.setClearColor(clear,alpha);}
 setForces(boats,peopleTime,enabled=true){let count=0;const g=this.forceGeometry;
  const put=(x,z,rx,rz,dx,dz,h,v,f,t)=>{if(count>=320)return;for(let[n,data]of [['center',[x,z]],['radii',[rx,rz]],['direction',[dx,dz]],['signal',[h,v,f,t]]])g.attributes[n].array.set(data,count*g.attributes[n].itemSize);count++;};
  let idx=0;for(let b of boats){const speed=enabled?b.speed:0,[dx,dz]=b.heading,sx=-dz,sz=dx,L=b.length,w=b.width||2,x=b.position[0],z=b.position[2],strength=Math.min(1.5,speed/.65);
   if(!b.moored&&idx<16){this.shipA[idx].set(x,z,dx,dz);this.shipB[idx].set(speed,L,w,idx*.71);idx++;}
   if(speed>.025){
    for(let side of[-1,1]){put(x+dx*L*.43+sx*w*.20*side,z+dz*L*.43+sz*w*.20*side,Math.max(.55,L*.065),w*.43,dx,dz,.30*strength,.50*strength,.14*strength,.09*strength);
     put(x-dx*L*.33+sx*w*.47*side,z-dz*L*.33+sz*w*.47*side,Math.max(.8,L*.16),.36,dx,dz,.14*strength,.26*strength,.16*strength,.08*strength);}
    put(x-dx*L*.46,z-dz*L*.46,Math.max(.8,L*.14),w*.46,dx,dz,-.36*strength,-.40*strength,.34*strength,.24*strength);
   }
   for(const contact of b.oarContacts||[]){const [ox,oy,oz]=contact.position;if(oy<.33)put(ox,oz,.38,.20,dx,dz,-.045,.20*contact.strength,.18*contact.strength,.10);}

  }
  for(const [x,z] of this.piles)put(x+.25,z,.4,.25,1,0,.001,.004,.003,.002);
  for(let attr of Object.values(g.attributes))if(attr.isInstancedBufferAttribute)attr.needsUpdate=true;g.instanceCount=count;this.emitters=count;this.uniforms.uShipCount.value=idx;
 }
 update(t,boats,peopleTime,enabled=true){this.time=t;this.uniforms.uTime.value=t;if(t===this.lastTime&&this.steps>0)return;this.setForces(boats,peopleTime,enabled);let delta=Math.max(0,t-this.lastTime);this.lastTime=t;if(delta>1)delta=.2;this.acc+=delta;
  if(!this.enabled)return;const r=this.renderer,old=r.getRenderTarget(),clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();r.setClearColor(0,0);
  // All substeps in this update use the same forces and contact positions.
  if(this.acc>=1/120){r.setRenderTarget(this.force);r.clear();r.render(this.forceScene,this.quadCamera);}
  while(this.acc>=1/120){this.stepMat.uniforms.stateTex.value=this.a.texture;r.setRenderTarget(this.b);r.render(this.stepScene,this.quadCamera);[this.a,this.b]=[this.b,this.a];this.acc-=1/120;this.steps++;}
  this.uniforms.uField.value=this.a.texture;r.setRenderTarget(old);r.setClearColor(clear,alpha);
 }
 // Reflection and the water sampling source stay half-resolution (the shader
 // perturbs and blurs the reflection; the water's transmitted taps were tuned
 // against the original half-res refraction render). Since optimization batch 2
 // the refraction target is no longer a half-resolution re-render of the scene:
 // it is a full-resolution snapshot copied out of the engine's resolved MSAA
 // output, so it must match the main output size.
 resize(w,h){const rw=Math.max(1,Math.round(w*.5)),rh=Math.max(1,Math.round(h*.5));this.reflection.setSize(rw,rh);this.waterColor.setSize(rw,rh);this.refraction.setSize(Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
 // Reflection-only variant of renderSources (batch 2): the refraction pass is
 // dropped because the main render is copied into the snapshot instead. The
 // pass-boundary render, mirror camera, clipping plane and uniform updates are
 // kept verbatim so the reflection buffer stays bit-identical to renderSources.
 renderReflection(camera,beforePass=()=>{}){const r=this.renderer,old=r.getRenderTarget(),oldPlanes=r.clippingPlanes,wasVisible=this.mesh.visible;this.mesh.visible=false;
  // r179 uploads shadow instances after advancing info.render.frame. A native,
  // draw-free render boundary lets reflection upload its own matrices/attributes.
  const autoClear=r.autoClear;r.autoClear=false;try{r.render(this.passBoundary,camera);}finally{r.autoClear=autoClear;}
  const c=this.reflectCamera;c.copy(camera);c.position.y=.56-camera.position.y;const dir=camera.getWorldDirection(new THREE.Vector3());dir.y=-dir.y;c.up.set(0,-1,0);c.lookAt(c.position.clone().add(dir));c.updateMatrixWorld();
  this.reflectMatrix.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);r.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,1,0),-.27)];beforePass(c);r.setRenderTarget(this.reflection);r.clear();r.render(this.scene,c);
  r.clippingPlanes=oldPlanes;
  this.uniforms.uNear.value=camera.near;this.uniforms.uFar.value=camera.far;this.mesh.visible=wasVisible;r.setRenderTarget(old);}
 // Copy the resolved color and depth of the engine's MSAA final target into the
 // refraction snapshot (batch 2), then downsample the same source into the
 // half-resolution waterColor target (batch 2 refinement) so the water shader's
 // uSceneColor/uSceneDepth taps observe the frame at the old half-res refraction
 // fidelity. The full-res part is two fullscreen triangles: color is written as
 // plain RGBA (HalfFloat -> HalfFloat, depth test and write off); depth is
 // re-emitted through gl_FragDepth with an always-pass depth func and the color
 // mask closed. The half-res pair reuses the same mechanism with exact texel
 // alignment (see copyHalf*Material). Never called with a snapshot as its own
 // source - that would be a same-texture feedback loop, so it is asserted here.
 copySnapshot(source){
  if(!source||!source.isWebGLRenderTarget)throw new Error('copySnapshot requires a WebGLRenderTarget source.');
  if(source===this.refraction)throw new Error('copySnapshot source must differ from the refraction snapshot (feedback loop).');
  if(source===this.waterColor)throw new Error('copySnapshot source must differ from the water sampling source (feedback loop).');
  if(source.width!==this.refraction.width||source.height!==this.refraction.height)throw new Error(`copySnapshot size mismatch: source ${source.width}x${source.height}, snapshot ${this.refraction.width}x${this.refraction.height}.`);
  if(!source.depthTexture)throw new Error('copySnapshot requires a source depthTexture; enable resolveDepthBuffer on the MSAA target.');
  const r=this.renderer,old=r.getRenderTarget(),oldAuto=r.autoClear;r.autoClear=false;
  try{
   this.copyColorMaterial.uniforms.tColor.value=source.texture;
   this.copyColorMesh.visible=true;r.setRenderTarget(this.refraction);r.render(this.copyScene,this.overlayCamera);this.copyColorMesh.visible=false;
   this.copyDepthMaterial.uniforms.tDepth.value=source.depthTexture;
   this.copyDepthMesh.visible=true;r.render(this.copyScene,this.overlayCamera);this.copyDepthMesh.visible=false;
   this.copyHalfColorMaterial.uniforms.tColor.value=source.texture;this.copyHalfColorMaterial.uniforms.sourceSize.value.set(source.width,source.height);
   this.copyHalfColorMesh.visible=true;r.setRenderTarget(this.waterColor);r.render(this.copyScene,this.overlayCamera);this.copyHalfColorMesh.visible=false;
   this.copyHalfDepthMaterial.uniforms.tDepth.value=source.depthTexture;this.copyHalfDepthMaterial.uniforms.sourceSize.value.set(source.width,source.height);
   this.copyHalfDepthMesh.visible=true;r.render(this.copyScene,this.overlayCamera);this.copyHalfDepthMesh.visible=false;
  }finally{r.autoClear=oldAuto;r.setRenderTarget(old);}
 }
 renderSources(camera,beforePass=()=>{}){const r=this.renderer,old=r.getRenderTarget(),oldPlanes=r.clippingPlanes,wasVisible=this.mesh.visible;this.mesh.visible=false;
  // r179 uploads shadow instances after advancing info.render.frame. A native,
  // draw-free render boundary lets reflection upload its own matrices/attributes.
  const autoClear=r.autoClear;r.autoClear=false;try{r.render(this.passBoundary,camera);}finally{r.autoClear=autoClear;}
  const c=this.reflectCamera;c.copy(camera);c.position.y=.56-camera.position.y;const dir=camera.getWorldDirection(new THREE.Vector3());dir.y=-dir.y;c.up.set(0,-1,0);c.lookAt(c.position.clone().add(dir));c.updateMatrixWorld();
  this.reflectMatrix.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);r.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,1,0),-.27)];beforePass(c);r.setRenderTarget(this.reflection);r.clear();r.render(this.scene,c);
  r.clippingPlanes=oldPlanes;beforePass(camera);r.setRenderTarget(this.refraction);r.clear();r.render(this.scene,camera);
  this.uniforms.uNear.value=camera.near;this.uniforms.uFar.value=camera.far;this.mesh.visible=wasVisible;r.setRenderTarget(old);
 }
 setGeometryQuality(mode){
  this.cinemaGeometry??=this.mesh.geometry;
  if(!this.autoGeometry){
   const nx=1024,nz=64,positions=new Float32Array((nx+1)*(nz+1)*3);
   for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const wx=this.domain.x+x/nx*this.domain.z,bank=this.bank(wx)-.08;positions.set([wx,.28,this.center(wx)+(z/nz*2-1)*bank],(z*(nx+1)+x)*3);}
   const position=new THREE.BufferAttribute(positions,3);this.autoGeometry=new THREE.BufferGeometry();this.autoGeometry.setAttribute('position',position);this.autoGeometry.setDrawRange(0,0);this.waterChunks=[];
   const step=Math.max(1,Math.round(32/this.domain.z*nx));
   for(let first=0;first<nx;first+=step){const last=Math.min(nx,first+step),indices=[];
    for(let z=0;z<nz;z++)for(let x=first;x<last;x++){const i=z*(nx+1)+x;indices.push(i,i+nx+1,i+1,i+1,i+nx+1,i+nx+2);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',position);g.setIndex(indices);
    const box=new THREE.Box3();for(let z=0;z<=nz;z++)for(let x=first;x<=last;x++)box.expandByPoint(new THREE.Vector3().fromArray(positions,(z*(nx+1)+x)*3));box.expandByScalar(2);g.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
    const chunk=new THREE.Mesh(g,this.material);chunk.name='River / 32m chunk';chunk.receiveShadow=true;chunk.renderOrder=3;chunk.layers.mask=this.mesh.layers.mask;this.mesh.add(chunk);this.waterChunks.push(chunk);
   }
  }
  this.mesh.geometry=mode==='auto'?this.autoGeometry:this.cinemaGeometry;
  for(const chunk of this.waterChunks)chunk.visible=mode==='auto';
 }
 metrics(){const raw=new Float32Array(this.width*this.height*4);this.renderer.readRenderTargetPixels(this.a,0,0,this.width,this.height,raw);let maxHeight=0,foam=0,active=0,nan=0;for(let i=0;i<raw.length;i+=4){let h=raw[i],f=raw[i+2];if(!Number.isFinite(h+f+raw[i+1]+raw[i+3]))nan++;maxHeight=Math.max(maxHeight,Math.abs(h));foam+=f;if(Math.abs(h)>.002)active++;}return {engine:THREE.REVISION,enabled:this.enabled,steps:this.steps,resolution:[this.width,this.height],vertices:this.mesh.geometry.attributes.position.count,maxHeight,foam,active,nan,emitters:this.emitters};}
}
export const riverSurfaceGLSL=sharedSurface;
export const riverShaders={stepFragment,splatVertex,splatFragment,waterVertex,waterFragment};
