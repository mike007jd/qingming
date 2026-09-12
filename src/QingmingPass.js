/** Optional depth/normal ink contours + silk support. Three.js WebGLRenderer only. */
import * as THREE from 'three';

const outputChunk = THREE.ShaderChunk.colorspace_fragment
  ? '#include <colorspace_fragment>' : '#include <encodings_fragment>';
const vertex = /* glsl */`
varying vec2 vUv;
void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }
`;
const fragment = /* glsl */`
#include <common>
#include <packing>
uniform sampler2D tColor,tNormal,tDepth;
uniform vec2 resolution;
uniform vec3 paperColor,inkColor;
uniform float cameraNear,cameraFar,perspectiveCamera;
uniform float lineWidth,lineStrength,paperStrength,enabled;
uniform float depthThreshold,normalThreshold,pixelRatio;
varying vec2 vUv;
float h2(vec2 p){ p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y); }
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float depthAt(vec2 uv){float z=texture2D(tDepth,uv).x;
 return -mix(orthographicDepthToViewZ(z,cameraNear,cameraFar),
   perspectiveDepthToViewZ(z,cameraNear,cameraFar),perspectiveCamera);}
vec3 nAt(vec2 uv){return normalize(texture2D(tNormal,uv).xyz*2.0-1.0+vec3(0.00001));}
void main(){
 vec3 c=texture2D(tColor,vUv).rgb;
 vec2 paperPx=gl_FragCoord.xy/max(pixelRatio,1.0);
 if(enabled>0.0 && lineStrength>0.0){
 vec2 px=vec2(max(0.50,lineWidth*pixelRatio))/resolution;
 float z=depthAt(vUv), zl=depthAt(vUv-vec2(px.x,0)), zr=depthAt(vUv+vec2(px.x,0));
 float zu=depthAt(vUv+vec2(0,px.y)),zd=depthAt(vUv-vec2(0,px.y));
 // Second differences avoid outlining every inclined face as a depth gradient.
 float depthEdge=max(abs(zl+zr-2.0*z),abs(zu+zd-2.0*z))/max(z,0.1);
 vec3 n=nAt(vUv);
 float normalEdge=max(max(1.0-dot(n,nAt(vUv+vec2(px.x,0))),1.0-dot(n,nAt(vUv-vec2(px.x,0)))),
   max(1.0-dot(n,nAt(vUv+vec2(0,px.y))),1.0-dot(n,nAt(vUv-vec2(0,px.y)))));
 float centerWeight=texture2D(tNormal,vUv).a;
 float neighborWeight=max(max(texture2D(tNormal,vUv+vec2(px.x,0)).a,texture2D(tNormal,vUv-vec2(px.x,0)).a),
   max(texture2D(tNormal,vUv+vec2(0,px.y)).a,texture2D(tNormal,vUv-vec2(0,px.y)).a));
 float valid=max(centerWeight,neighborWeight);
 float eDepth=smoothstep(depthThreshold,depthThreshold*4.5,depthEdge);
 float eNormal=smoothstep(normalThreshold,normalThreshold+0.38,normalEdge)*0.64;
 float edge=max(eDepth,eNormal)*valid;
 float dry=0.94+0.06*noise2(paperPx*0.31);
 c=mix(c,inkColor,clamp(edge*lineStrength*dry*enabled,0.0,0.92));
 }
 // Quiet, stationary silk fibres: this is support texture, not the model's paint.
 float weave=(sin(paperPx.x*2.33)*sin(paperPx.y*2.57))*0.009;
 float fibre=(noise2(vec2(paperPx.x*0.22,paperPx.y*1.5))-0.5)*0.026;
 float broad=(noise2(paperPx*0.007)-0.5)*0.027;
 float grain=(h2(floor(paperPx))-0.5)*0.025;
 c*=1.0+(weave+fibre+broad+grain)*paperStrength*enabled;
 gl_FragColor=vec4(max(c,vec3(0)),1.0);
 ${outputChunk}
}
`;

export class QingmingPass {
  constructor(renderer,style,{samples=4,depthThreshold=0.0025,normalThreshold=0.14}={}) {
    if (!renderer?.isWebGLRenderer) throw new TypeError('QingmingPass requires THREE.WebGLRenderer');
    this.renderer=renderer; this.style=style;
    this.normalCache=new Map();
    this._disposed=false;
    const floating=renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    this.colorTarget=new THREE.WebGLRenderTarget(1,1,{
      type:floating ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
      depthBuffer:true,stencilBuffer:false,
    });
    this.colorTarget.samples=renderer.capabilities.isWebGL2 ? Math.min(samples,renderer.capabilities.maxSamples || 4) : 0;
    this.normalTarget=new THREE.WebGLRenderTarget(1,1,{
      minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
      depthBuffer:true,stencilBuffer:false,
    });
    this.normalTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.normalTarget.depthTexture.minFilter=THREE.NearestFilter;
    this.normalTarget.depthTexture.magFilter=THREE.NearestFilter;
    this.uniforms={
      tColor:{value:this.colorTarget.texture}, tNormal:{value:this.normalTarget.texture},
      tDepth:{value:this.normalTarget.depthTexture}, resolution:{value:new THREE.Vector2(1,1)},
      paperColor:style.uniforms.qiPaper, inkColor:style.uniforms.qiInk,
      cameraNear:{value:0.1},cameraFar:{value:1000},perspectiveCamera:{value:0},
      lineWidth:{value:0.7},lineStrength:{value:0.6},paperStrength:{value:0.2},enabled:{value:1},
      depthThreshold:{value:depthThreshold},normalThreshold:{value:normalThreshold},pixelRatio:{value:1},
    };
    this.material=new THREE.ShaderMaterial({
      vertexShader:vertex,fragmentShader:fragment,uniforms:this.uniforms,
      depthTest:false,depthWrite:false,toneMapped:false,
    });
    this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    this.fullscreen=new THREE.Scene();
    const triangle=new THREE.Mesh(this.geometry,this.material);
    triangle.frustumCulled=false;this.fullscreen.add(triangle);
    this.camera=new THREE.Camera();
    this._size=new THREE.Vector2();
    this._viewport=new THREE.Vector4(); this._scissor=new THREE.Vector4();
    this.setSize(renderer.domElement.clientWidth || 1,renderer.domElement.clientHeight || 1);
  }

  setSize(width,height,pixelRatio=this.renderer.getPixelRatio()) {
    const w=Math.max(1,Math.round(width*pixelRatio)),h=Math.max(1,Math.round(height*pixelRatio));
    this.colorTarget.setSize(w,h);this.normalTarget.setSize(w,h);
    this.uniforms.resolution.value.set(w,h);this.uniforms.pixelRatio.value=pixelRatio;
  }

  _normalMaterial(source) {
    const version=source.version;
    const weight=source.userData?.qingming?.outlineWeight ?? 1;
    const old=this.normalCache.get(source);
    if(old && old.version===version && old.weight===weight) return old.material;
    if(old) old.material.dispose();
    let material;
    if (!source.isMeshStandardMaterial && !source.isMeshPhongMaterial && !source.isMeshLambertMaterial && !source.isMeshBasicMaterial) {
      if(source.userData.qingmingNormal) material=source.userData.qingmingNormal();
      else material=new THREE.MeshBasicMaterial({visible:false});
    } else {
      // A built-in material retains alpha-tested texture holes, skinning, morphs,
      // displacement, instancing, sidedness and local clipping. No overrideMaterial.
      material=source.isMeshStandardMaterial ? source.clone() : new THREE.MeshStandardMaterial();
      for(const key of ['map','alphaMap','alphaTest','opacity','side','vertexColors','flatShading',
        'displacementMap','displacementScale','displacementBias','clippingPlanes','clipIntersection','clipShadows','visible']) {
        if(source[key]!==undefined) material[key]=source[key];
      }
      material.defines={...material.defines,...source.defines};
      material.normalMap=null;material.bumpMap=null; // geometric edges, not texture noise
      material.transparent=false; material.depthWrite=true;material.toneMapped=false;
      // Translucent surfaces stay in the color pass; they don't receive false opaque edges.
      if(source.transparent && source.alphaTest===0) material.visible=false;
      const alpha=THREE.MathUtils.clamp(weight,0,1).toFixed(5);
      // The outline only consumes the geometric normal and the alpha-tested
      // cutout path, so replace the whole PBR fragment with a minimal template
      // BEFORE the source hooks run. All hook points (common, map_fragment,
      // shadowmap_pars_fragment, opaque_fragment) are kept so decorations still
      // inject and compile; lighting, shadow sampling and env lookup are never
      // compiled in instead of relying on driver dead-code elimination.
      material.onBeforeCompile=(shader,renderer)=>{
        shader.fragmentShader=`
uniform vec3 diffuse;
uniform float opacity;
// receiveShadow is normally declared by lights_pars_begin, which this
// minimal outline template does not include; the renderer still sets it
// per object. packing provides the unpack helpers used by shadowmap_pars.
uniform bool receiveShadow;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <color_pars_fragment>
#include <map_pars_fragment>
#include <alphatest_pars_fragment>
#include <normal_pars_fragment>
#include <clipping_planes_pars_fragment>
#include <shadowmap_pars_fragment>
varying vec3 vViewPosition;
void main() {
 #include <clipping_planes_fragment>
 vec4 diffuseColor = vec4( diffuse, opacity );
 #include <map_fragment>
 #include <color_fragment>
 #include <alphatest_fragment>
 #include <normal_fragment_begin>
 vec3 geometryViewDir = normalize( vViewPosition );
 vec3 outgoingLight = vec3( 0.0 );
 #include <opaque_fragment>
}`;
        source.onBeforeCompile.call(source,shader,renderer);
        shader.fragmentShader=shader.fragmentShader.replace(/}\s*$/,
          `gl_FragColor = vec4(normalize(normal)*0.5+0.5, ${alpha});\n}`);
      };
      material.customProgramCacheKey=()=>`qingming-normal-1.2-${alpha}:${source.customProgramCacheKey()}`;
    }
    this.normalCache.set(source,{material,version,weight});
    return material;
  }

  /** Call in place of renderer.render(). Updates target size when the canvas changes. */
  render(scene,camera,outputTarget=null,{colorTexture=null,onPass=null}={}) {
    if(this._disposed) throw new Error('QingmingPass has been disposed');
    const r=this.renderer,u=this.uniforms,s=this.style.settings;
    r.getDrawingBufferSize(this._size);
    if(!u.resolution.value.equals(this._size)) {
      this.colorTarget.setSize(this._size.x,this._size.y);
      this.normalTarget.setSize(this._size.x,this._size.y);
      u.resolution.value.copy(this._size);
    }
    u.pixelRatio.value=r.getPixelRatio();u.cameraNear.value=camera.near;u.cameraFar.value=camera.far;
    u.perspectiveCamera.value=camera.isPerspectiveCamera ? 1 : 0;
    u.lineWidth.value=s.lineWidth;u.lineStrength.value=s.lineStrength;
    u.paperStrength.value=s.paperStrength;u.enabled.value=s.enabled;
    const saved={
      target:r.getRenderTarget(), clear:r.getClearColor(new THREE.Color()), alpha:r.getClearAlpha(),
      auto:r.autoClear,tone:r.toneMapping,background:scene.background,
      shadowAuto:r.shadowMap.autoUpdate,shadowNeeds:r.shadowMap.needsUpdate,
      override:scene.overrideMaterial,scissorTest:r.getScissorTest(),
    };
    r.getViewport(this._viewport);r.getScissor(this._scissor);
    const swapped=[],hidden=[];
    try {
      r.autoClear=true;r.toneMapping=THREE.NoToneMapping;r.setScissorTest(false);
      scene.background=null;scene.overrideMaterial=null;
      r.setClearColor(this.style.uniforms.qiPaper.value,1);
      if(!colorTexture){r.setRenderTarget(this.colorTarget);r.clear();r.render(scene,camera);}
      u.tColor.value=colorTexture||this.colorTarget.texture;
      r.shadowMap.autoUpdate=false;r.shadowMap.needsUpdate=false;
      if(s.enabled>0 && s.lineStrength>0){
      onPass&&onPass('outline');
      scene.traverseVisible(object=>{
        if(object.isMesh) {
          swapped.push([object,object.material]);
          object.material=Array.isArray(object.material)
            ? object.material.map(m=>this._normalMaterial(m)) : this._normalMaterial(object.material);
        } else if(object.isLine || object.isPoints || object.isSprite) {
          hidden.push(object);object.visible=false;
        }
      });
      r.setRenderTarget(this.normalTarget);r.setClearColor(0x8080ff,0);r.clear();r.render(scene,camera);
      for(const [object,material] of swapped) object.material=material;
      swapped.length=0;for(const object of hidden)object.visible=true;hidden.length=0;
      onPass&&onPass(null);
      }
      onPass&&onPass('post');
      r.setRenderTarget(outputTarget);r.render(this.fullscreen,this.camera);
      onPass&&onPass(null);
    } finally {
      for(const [object,material] of swapped)object.material=material;
      for(const object of hidden)object.visible=true;
      scene.background=saved.background;scene.overrideMaterial=saved.override;
      r.autoClear=saved.auto;r.toneMapping=saved.tone;
      r.shadowMap.autoUpdate=saved.shadowAuto;r.shadowMap.needsUpdate=saved.shadowNeeds;
      r.setClearColor(saved.clear,saved.alpha);r.setRenderTarget(saved.target);
      r.setViewport(this._viewport);r.setScissor(this._scissor);r.setScissorTest(saved.scissorTest);
    }
  }

  /** Release cached normal variants after permanently unloading a large model. */
  clearCache(){for(const {material} of this.normalCache.values())material.dispose();this.normalCache.clear();}
  dispose(){
    if(this._disposed)return;
    this._disposed=true;this.clearCache();this.colorTarget.dispose();
    this.normalTarget.depthTexture.dispose();this.normalTarget.dispose();this.material.dispose();this.geometry.dispose();
  }
}
