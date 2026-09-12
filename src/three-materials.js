import * as THREE from 'three';
const T=THREE;
const LIFE_DEFORM=`
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
void qmArticulated(inout vec3 p,inout vec3 n){
 if(qmMeta<-.5){int entity=int(round(-qmMeta-1.));vec4 motion=texture2D(qmLife,vec2(.25,(float(entity)+.5)/64.)),size=texture2D(qmLife,vec2(.75,(float(entity)+.5)/64.));int tag=int(qmRegion+.5);
  if(QM_ANIMAL==1&&tag>=101&&tag<=104){float leg=float(tag-101),offset=tag==101?0.:tag==102?.5:tag==103?.25:.75;float phase=fract(motion.x/1.18+offset);float swing=smoothstep(.60,1.,phase);float dy=phase<.60?mix(-.25,.25,phase/.60):mix(.25,-.25,swing);float lift=phase<.60?0.:sin((phase-.60)/.40*3.14159265)*.115;float activity=smoothstep(.025,.30,motion.y);dy*=activity;lift*=activity;
   float sy=tag>=103?1.:-1.,sx=(tag==102||tag==104)?1.:-1.;vec3 hip=vec3(sx*.218,sy*.52,1.02),restKnee=vec3(sx*.218,sy*.52+(sy>0.?.09:-.025),.57),ankle=vec3(sx*.218,sy*.52+(sy>0.?.02:-.005),.13);vec3 foot=ankle+vec3(0.,dy,lift);vec2 delta=vec2(foot.y-hip.y,hip.z-foot.z);float dist=clamp(length(delta),.44,.891);float theta=atan(delta.x,delta.y)+(sy>0.?-1.:1.)*acos(clamp((.47*.47+dist*dist-.43*.43)/(2.*.47*dist),-1.,1.));vec3 knee=hip+vec3(0.,sin(theta)*.47,-cos(theta)*.47);
   float baseA=atan(restKnee.y-hip.y,hip.z-restKnee.z),lowA=atan(ankle.y-restKnee.y,restKnee.z-ankle.z),newLow=atan(foot.y-knee.y,knee.z-foot.z);mat3 upper=rx(theta-baseA),lower=rx(newLow-lowA);float blend=smoothstep(.53,.64,p.z);vec3 lowP=knee+lower*(p-restKnee),highP=hip+upper*(p-hip);p=mix(lowP,highP,blend);n=normalize(mix(lower*n,upper*n,blend));
  }
  if(QM_CART==1&&tag==201){vec3 pivot=vec3(p.x,.1,.62);mat3 r=rx(-motion.x/.648);p=pivot+r*(p-pivot);n=r*n;}
  if((QM_CART==1&&tag==202)||(QM_VESSEL==1&&tag==303)){if(size.w<.01)p=vec3(0.);}
  if(QM_CRANE==1&&(tag==401||tag==402)){float lift=sin(motion.x*6.2831853);lift=lift*lift*.78*motion.y;float w=tag==401?1.:clamp((5.44-p.z)/2.04,0.,1.);p.z+=lift*w;}
  if(QM_VESSEL==1&&(tag==301||tag==302)){float activity=smoothstep(.02,.45,motion.y),ph=motion.z*2.4+motion.w;vec3 pivot=tag==302?vec3(0.,-.5,1.15):vec3(-size.x*.72,size.y*.8,.95);float z=sin(ph-.4)*.21*activity,cs=cos(z),sn=sin(z);mat3 rz=mat3(cs,sn,0.,-sn,cs,0.,0.,0.,1.);mat3 r=rx(-sin(ph)*.19*activity*(tag==302?-1.:1.))*rz;p=pivot+r*(p-pivot);n=r*n;}
 }
}
`;
export function makeCityMaterials(engine){
 const {manifest:m,images}=engine.data;const maps=new Map();const getTexture=(i,color=false)=>{if(i===undefined)return null;const key=i+':'+color;if(maps.has(key))return maps.get(key);const im=images[m.textures[i].source],t=new T.Texture(im);t.flipY=false;t.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=Math.min(8,engine.renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;maps.set(key,t);return t;};
 engine.materialCache=new Map();engine.materialUniforms=[];engine.cityTextures=maps;
 engine.getCityMaterial=(index,asset,depth=false)=>{
  const src=m.materials[index],surface=src.extras?.surface||'plain',isPerson=!!asset.rig,isTree=asset.category==='trees',isAnimal=/^(Horse_saddled|Ox_saddled)$/.test(asset.name),isCart=/^(Handcart|Covered_goods_cart)$/.test(asset.name),isVessel=asset.category==='boats',isCrane=asset.name==='Timber_dock_with_crane';const key=[index,isPerson,isTree,isAnimal,isCart,isVessel,isCrane,depth].join(':');if(engine.materialCache.has(key))return engine.materialCache.get(key);
  const p=src.pbrMetallicRoughness;const col=new T.Color().fromArray(p.baseColorFactor),rough=p.roughnessFactor??.85;
  const cloth=surface==='cloth',leaf=surface==='leaf',skin=surface==='skin';
  // Pale lime is softly weathered; it should not overpower the grey roof / warm wood palette.
  if(surface==='plaster')col.multiplyScalar(.84);if(surface==='tile')col.multiplyScalar(.74);if(surface==='wood')col.multiplyScalar(1.13);
  const opts={name:src.name,vertexColors:true,side:src.doubleSided||leaf?T.DoubleSide:T.FrontSide,map:getTexture(p.baseColorTexture?.index,true)};
  let mat=depth?new T.MeshDepthMaterial({...opts,depthPacking:T.RGBADepthPacking}):new T.MeshStandardMaterial({...opts,color:col,roughness:rough,metalness:p.metallicFactor||0,normalMap:getTexture(src.normalTexture?.index),normalScale:new T.Vector2(cloth?.20:.47,cloth?.20:.47),roughnessMap:getTexture(p.metallicRoughnessTexture?.index),emissive:new T.Color().fromArray(src.emissiveFactor||[0,0,0]),envMapIntensity:leaf?.37:skin?.34:.52});
  if(!depth&&skin){mat.roughness=.67;mat.envMapIntensity=.45;}if(!depth&&surface==='plain'&&/hair/.test(src.name)){mat.roughness=.43;mat.envMapIntensity=.62;}
  const defs={QM_SKIN:isPerson?1:0,QM_LEAF:leaf?1:0,QM_TREE:isTree?1:0,QM_CLOTH:cloth?1:0,QM_ANIMAL:isAnimal?1:0,QM_CART:isCart?1:0,QM_VESSEL:isVessel?1:0,QM_CRANE:isCrane?1:0};mat.defines={...mat.defines,...defs};
  mat.onBeforeCompile=shader=>{
   const u={qmTime:{value:engine.time},qmWind:{value:1},qmBones:{value:engine.crowd.texture},qmLife:{value:engine.lifeBinding.texture},qmBoneSize:{value:new T.Vector2(engine.crowd.jointCount*4,engine.crowd.actors.length)}};Object.assign(shader.uniforms,u);engine.materialUniforms.push(u);
   shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute float qmMeta,qmRegion;attribute vec4 qmJoints,qmWeights;uniform sampler2D qmBones,qmLife;uniform vec2 qmBoneSize;uniform float qmTime,qmWind;varying vec3 qmWorld,qmAnchor;varying float qmVariation;
mat4 qb(float joint){float y=(qmMeta-10.+.5)/qmBoneSize.y;float x=(joint*4.+.5)/qmBoneSize.x;float d=1./qmBoneSize.x;return mat4(texture2D(qmBones,vec2(x,y)),texture2D(qmBones,vec2(x+d,y)),texture2D(qmBones,vec2(x+2.*d,y)),texture2D(qmBones,vec2(x+3.*d,y)));}
${LIFE_DEFORM}`);
   shader.vertexShader=shader.vertexShader.replace('void main() {',`void main() {
mat4 qSkin=mat4(1.);
#if QM_SKIN == 1
qSkin=qmWeights.x*qb(qmJoints.x)+qmWeights.y*qb(qmJoints.y)+qmWeights.z*qb(qmJoints.z)+qmWeights.w*qb(qmJoints.w);
#endif
`);
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
#if QM_SKIN == 1
objectNormal=mat3(qSkin)*objectNormal;
#endif
vec3 qDummy=position;qmArticulated(qDummy,objectNormal);`);
   shader.vertexShader=shader.vertexShader.replace('#include <batching_vertex>',`#include <batching_vertex>
#ifdef USE_BATCHING
mat4 qmInstance=batchingMatrix;
#else
mat4 qmInstance=instanceMatrix;
#endif
`);
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
#if QM_SKIN == 1
transformed=(qSkin*vec4(transformed,1.)).xyz;
#endif
vec3 qN=normal;qmArticulated(transformed,qN);
vec3 qA=qmInstance[3].xyz;float qP=qmTime*.57+qA.x*.073+qA.z*.091;
#if QM_TREE == 1
float qFlex=pow(clamp(position.z/9.,0.,1.),2.);transformed.x+=sin(qP)*.11*qFlex*qmWind;transformed.y+=cos(qP*.89)*.073*qFlex*qmWind;
#endif
#if QM_LEAF == 1
transformed.x+=sin(qP*2.7+position.x*3.+position.z*.6)*.028*qmWind;transformed.y+=cos(qP*3.+position.y)*.023*qmWind;
#endif
#if QM_CLOTH == 1 && QM_SKIN == 0
transformed.x+=sin(qP*1.4+position.y*1.5)*.016*qmWind;
#endif
qmWorld=(modelMatrix*qmInstance*vec4(transformed,1.)).xyz;qmAnchor=qA;qmVariation=fract(sin(dot(qA.xz,vec2(12.9898,78.233)))*43758.5453);`);
   if(!depth){
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 qmWorld,qmAnchor;varying float qmVariation;uniform float qmTime;
float qHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float qNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(qHash(i),qHash(i+vec2(1,0)),f.x),mix(qHash(i+vec2(0,1)),qHash(i+vec2(1)),f.x),f.y);}`);
    let finish='';
    if(surface==='plaster')finish+=`float stain=(1.-smoothstep(.20,1.3,qmWorld.y-qmAnchor.y))*(.3+.7*qNoise(qmWorld.xz*5.));diffuseColor.rgb*=1.-stain*.27;diffuseColor.rgb*=.94+.10*qNoise(qmWorld.xz*.73+qmWorld.y*.12);`;
    if(surface==='wood')finish+=`diffuseColor.rgb*=.86+.22*qmVariation;float grain=qNoise(vec2(qmWorld.y*.12,(qmWorld.x+qmWorld.z)*1.3));diffuseColor.rgb*=.93+.12*grain;`;
    if(surface==='tile')finish+=`diffuseColor.rgb*=.93+.14*qmVariation;`;
    if(cloth&&isPerson)finish+=`diffuseColor.rgb*=mix(vec3(.87,.89,.91),vec3(1.13,1.06,.96),qmVariation);`;
    if(surface==='ground'||surface==='stone')finish+=`diffuseColor.rgb*=.83+.28*qNoise(qmWorld.xz*.41);float wet=(1.-smoothstep(.6,1.65,qmWorld.y))*smoothstep(12.,13.7,abs(qmWorld.z+3.4*sin(qmWorld.x/72.)));diffuseColor.rgb*=1.-wet*.37;`;
    if(leaf)finish+=`diffuseColor.rgb*=mix(vec3(.66,.77,.51),vec3(1.03,1.09,.69),qmVariation);`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+finish);
    let bounce='';if(leaf)bounce+='outgoingLight+=diffuseColor.rgb*vec3(.19,.21,.08)*(0.6+0.4*pow(1.-abs(dot(normal,geometryViewDir)),2.));';if(skin)bounce+='outgoingLight+=diffuseColor.rgb*vec3(.035,.017,.008);';if(cloth)bounce+='outgoingLight+=diffuseColor.rgb*.025*pow(1.-abs(dot(normal,geometryViewDir)),3.);';
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',bounce+'\n#include <opaque_fragment>');
   }
  // Material identity keeps colors/textures separate; shader identity depends
  // only on emitted code. Three adds map/lighting/geometry defines to this key.
  };mat.customProgramCacheKey=()=>[surface,isPerson,isTree,isAnimal,isCart,isVessel,isCrane,depth].join(':');
  if(!depth)engine.style.decorateMaterial(mat,{pattern:({tile:'tiles',wood:'wood',cloth:'fabric',stone:'stone'})[surface]||'none',patternScale:surface==='tile'?.85:1,patternInk:surface==='tile'?.24:.32,useUV:surface==='tile',outlineWeight:leaf?.25:isPerson?.65:1});
  engine.materialCache.set(key,mat);return mat;
 };
}
