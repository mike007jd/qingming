/**
 * QingmingStyle — fine-line ink / muted pigment on silk, for THREE.WebGLRenderer.
 * MIT. Original shader implementation. No reference-image pixels are embedded.
 * Tested with Three.js r152. Built-in shader hooks are checked before injection.
 */
import * as THREE from 'three';

export const QINGMING_PRESETS = Object.freeze({
  color: Object.freeze({
    paperColor: '#dac79d', inkColor: '#433824', saturation: 0.72,
    pigmentDensity: 0.76, wash: 0.18, grain: 0.24, relief: 0.16,
    shadowStrength: 0.09, lineStrength: 0.62, lineWidth: 0.72,
    paperStrength: 0.22,
  }),
  silk: Object.freeze({
    paperColor: '#cba569', inkColor: '#49351e', saturation: 0.06,
    pigmentDensity: 0.55, wash: 0.16, grain: 0.30, relief: 0.10,
    shadowStrength: 0.055, lineStrength: 0.73, lineWidth: 0.70,
    paperStrength: 0.34,
  }),
});

const TYPES = { none: 0, tiles: 1, wood: 2, fabric: 3, stone: 4, water: 5 };
const vertexPars = /* glsl */`
varying vec3 vQiRest;
varying vec3 vQiRestNormal;
varying vec2 vQiUV;
`;
const fragmentPars = /* glsl */`
varying vec3 vQiRest;
varying vec3 vQiRestNormal;
varying vec2 vQiUV;
uniform float qiEnabled, qiSaturation, qiDensity, qiWash, qiGrain;
uniform float qiRelief, qiShadow, qiTime, qiSurface, qiPatternInk;
uniform float qiScale, qiUseUV, qiDensityMultiplier, qiHasInkMap;
uniform vec3 qiPaper, qiInk, qiLightDirection;
uniform sampler2D qiInkMap;
uniform mat3 qiInkTransform;
float qiHash(vec3 p) {
  p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float qiNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(qiHash(i), qiHash(i+vec3(1,0,0)), f.x),
    mix(qiHash(i+vec3(0,1,0)), qiHash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(qiHash(i+vec3(0,0,1)), qiHash(i+vec3(1,0,1)), f.x),
    mix(qiHash(i+vec3(0,1,1)), qiHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
// Artistic operations in display-like RGB, converted back to linear before output.
vec3 qiDisplay(vec3 c) {
  c = max(c, vec3(0));
  return mix(12.92*c, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(vec3(0.0031308),c));
}
vec3 qiLinear(vec3 c) {
  c = max(c, vec3(0));
  return mix(c/12.92, pow((c+0.055)/1.055,vec3(2.4)), step(vec3(0.04045),c));
}
// Repeating line integrated approximately over one pixel; fades before undersampling.
float qiRule(float x, float width) {
  float footprint = max(fwidth(x), 0.0001);
  float dist = abs(fract(x+0.5)-0.5);
  float coverage = 1.0-smoothstep(width-footprint*0.6,width+footprint*0.6,dist);
  return coverage * (1.0-smoothstep(0.36,0.85,footprint));
}
float qiPattern(vec2 p, float kind) {
  if (kind < 0.5) return 0.0;
  if (kind < 1.5) {
    // Staggered tile edges with a shallow curved tail, not a wireframe overlay.
    p *= vec2(3.8,3.2);
    float row = floor(p.y);
    float x = p.x + 0.5*mod(row,2.0);
    float warp = 0.022*sin(p.x*1.8+p.y*0.7);
    float joint = qiRule(x+warp,0.018);
    float tail = qiRule(p.y - 0.12*cos(6.2831853*x) + warp,0.025);
    float inner = qiRule(x+0.075,0.009)*0.18;
    return max(tail, joint*0.78)+inner;
  }
  if (kind < 2.5) {
    float wobble = 0.20*sin(p.x*1.5) + 0.12*sin(p.x*3.7+p.y);
    float grain = qiRule(p.y*8.0+wobble,0.025);
    float broken = smoothstep(0.26,0.62,qiNoise(vec3(p.x*1.7,p.y*3.0,2.0)));
    return grain * (0.20+0.38*broken);
  }
  if (kind < 3.5) {
    return qiRule(p.x*13.0+0.07*sin(p.y*8.0),0.027)*0.13
      + qiRule(p.y*11.0,0.023)*0.08;
  }
  if (kind < 4.5) {
    p *= vec2(1.7,2.3);
    float r = floor(p.y);
    return max(qiRule(p.y+0.04*sin(p.x*2.7),0.03),
      qiRule(p.x+0.5*mod(r,2.0)+0.03*sin(p.y*2.0),0.019)*0.66);
  }
  // Water marks: a slow-moving ink line field. qiTime never animates pigment/grain.
  float row = floor(p.y*1.45);
  float wave = p.y*1.45 + 0.10*sin(p.x*1.1+row*2.2-qiTime*0.20)
    + 0.045*sin(p.x*2.6+qiTime*0.12);
  float segment = smoothstep(0.1,0.43,qiNoise(vec3(p.x*0.6,row*2.5,7.0)));
  return qiRule(wave,0.019)*segment*0.53;
}
float qiSurfaceInk() {
  if (qiSurface > 4.5) return qiPattern(vQiRest.xz*qiScale, qiSurface);
  if (qiUseUV > 0.5) return qiPattern(vQiUV*qiScale, qiSurface);
  vec3 weights = pow(abs(normalize(vQiRestNormal)),vec3(5.0));
  weights /= max(dot(weights,vec3(1.0)),0.00001);
  vec3 p = vQiRest*qiScale;
  return qiPattern(p.zy,qiSurface)*weights.x
       + qiPattern(p.xz,qiSurface)*weights.y
       + qiPattern(p.xy,qiSurface)*weights.z;
}
`;

const shade = /* glsl */`
if (qiEnabled > 0.0) {
  vec3 paper = qiDisplay(qiPaper), ink = qiDisplay(qiInk);
  vec3 pigment = clamp(qiDisplay(diffuseColor.rgb),0.0,1.0);
  float gray = dot(pigment,vec3(0.23,0.63,0.14));
  pigment = mix(vec3(gray),pigment,qiSaturation);
  vec3 p = vQiRest*qiScale;
  float broad = qiNoise(p*1.55+vec3(5.1,0.3,2.7));
  float mid = qiNoise(p*7.3+vec3(1.0,7.2,4.0));
  float grainFade = 1.0-smoothstep(0.15,0.8,length(fwidth(p))*18.0);
  float fine = (qiNoise(p*85.0)-0.5)*grainFade;
  float density = clamp(qiDensity*qiDensityMultiplier + qiWash*(broad-0.5),0.0,1.0);
  vec3 painted = mix(paper,paper*(0.08+0.92*pigment),density);
  vec3 lightV = normalize((viewMatrix*vec4(qiLightDirection,0.0)).xyz);
  float wrapped = clamp(dot(normal,lightV)*0.5+0.5,0.0,1.0);
  float relief = qiRelief*(1.0-wrapped);
  float shadow = qiShadow*(1.0-getShadowMask());
  painted *= 1.0-relief-shadow;
  painted *= 1.0+qiWash*(mid-0.5)*0.16+qiGrain*fine*0.065;
  float marks = clamp(qiSurfaceInk()*qiPatternInk,0.0,0.92);
  if (qiHasInkMap > 0.5) {
    vec2 iuv = (qiInkTransform*vec3(vQiUV,1.0)).xy;
    marks = max(marks,1.0-texture2D(qiInkMap,iuv).r);
  }
  // A restrained, object-space broken edge to printed strokes.
  marks *= 0.91+0.09*qiNoise(p*36.0);
  painted = mix(painted,ink,marks);
  outgoingLight = mix(outgoingLight,qiLinear(clamp(painted,0.0,1.0)),qiEnabled);
}
`;

function hook(source, token, replacement, stage) {
  if (!source.includes(token)) {
    throw new Error(`QingmingStyle: Three.js r${THREE.REVISION} ${stage} is missing ${token}. Review shader hooks for this revision.`);
  }
  return source.replace(token,replacement);
}

/** One style instance shares live controls across any number of model materials. */
export class QingmingStyle {
  constructor({ preset = 'color', ...overrides } = {}) {
    if (!QINGMING_PRESETS[preset]) throw new RangeError(`Unknown preset: ${preset}`);
    this.materials = new Set();
    this.settings = { ...QINGMING_PRESETS[preset], enabled: 1, ...overrides };
    this.preset = preset;
    this.uniforms = {
      qiEnabled: {value: 1}, qiSaturation: {value: 0}, qiDensity: {value: 0},
      qiWash: {value: 0}, qiGrain: {value: 0}, qiRelief: {value: 0}, qiShadow: {value: 0},
      qiPaper: {value: new THREE.Color()}, qiInk: {value: new THREE.Color()},
      qiLightDirection: {value: new THREE.Vector3(-0.4,1,0.6).normalize()},
      qiTime: {value: 0},
    };
    this.set(this.settings);
  }

  set(values = {}) {
    const ranges = {
      enabled: [0,1], saturation:[0,1.5], pigmentDensity:[0,1], wash:[0,1],
      grain:[0,1], relief:[0,1], shadowStrength:[0,1], lineStrength:[0,1],
      lineWidth:[0.25,3], paperStrength:[0,1],
    };
    for (const [key,value] of Object.entries(values)) {
      if (ranges[key] && (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1])) {
        throw new RangeError(`${key} must be between ${ranges[key].join(' and ')}`);
      }
    }
    Object.assign(this.settings,values);
    const s = this.settings, u = this.uniforms;
    u.qiEnabled.value = s.enabled;
    u.qiSaturation.value = s.saturation; u.qiDensity.value = s.pigmentDensity;
    u.qiWash.value = s.wash; u.qiGrain.value = s.grain;
    u.qiRelief.value = s.relief; u.qiShadow.value = s.shadowStrength;
    u.qiPaper.value.set(s.paperColor); u.qiInk.value.set(s.inkColor);
    return this;
  }

  setPreset(name) {
    if (!QINGMING_PRESETS[name]) throw new RangeError(`Unknown preset: ${name}`);
    this.preset = name;
    return this.set(QINGMING_PRESETS[name]);
  }

  update(elapsedSeconds) {
    if (Number.isFinite(elapsedSeconds)) this.uniforms.qiTime.value = elapsedSeconds;
  }

  /** Standard material parameters plus art options in the second argument. */
  createMaterial(parameters = {}, art = {}) {
    const material = new THREE.MeshStandardMaterial({ roughness:1, metalness:0, ...parameters });
    return this._decorate(material,art);
  }

  /** Clones source. Original materials and their textures remain owned by the caller. */
  convertMaterial(source, art = {}) {
    if (!source || source.isShaderMaterial || source.isRawShaderMaterial) {
      throw new TypeError('QingmingStyle.convertMaterial expects a built-in mesh material. Exclude custom water/sky shaders with select().');
    }
    if (source.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
      throw new TypeError('Material already has a custom onBeforeCompile hook. Integrate the shader explicitly or exclude it with select().');
    }
    let target;
    if (source.isMeshStandardMaterial) target = source.clone();
    else {
      target = new THREE.MeshStandardMaterial({roughness:1,metalness:0});
      for (const key of ['color','map','alphaMap','alphaTest','alphaToCoverage','side','shadowSide',
        'transparent','opacity','vertexColors','normalMap','normalScale','bumpMap','bumpScale',
        'aoMap','aoMapIntensity','lightMap','lightMapIntensity','displacementMap',
        'displacementScale','displacementBias','depthTest','depthWrite','flatShading',
        'clippingPlanes','clipIntersection','clipShadows','polygonOffset','polygonOffsetFactor','polygonOffsetUnits']) {
        if (source[key] !== undefined) {
          target[key] = source[key]?.isColor || source[key]?.isVector2 ? source[key].clone() : source[key];
        }
      }
      target.name = source.name;
    }
    return this._decorate(target,art);
  }

  _decorate(material, {
    pattern='none', patternScale=1, patternInk=0.55, useUV=false,
    densityMultiplier=1, inkMap=null, outlineWeight=1,
  }={}) {
    if (!(pattern in TYPES)) throw new RangeError(`Unknown surface pattern: ${pattern}`);
    if (!Number.isFinite(patternScale) || patternScale<=0) throw new RangeError('patternScale must be positive');
    if (inkMap) inkMap.updateMatrix();
    const local = {
      qiSurface:{value:TYPES[pattern]}, qiScale:{value:patternScale},
      qiPatternInk:{value:patternInk}, qiUseUV:{value:useUV ? 1 : 0},
      qiDensityMultiplier:{value:densityMultiplier}, qiInkMap:{value:inkMap},
      qiHasInkMap:{value:inkMap ? 1 : 0},
      qiInkTransform:{value:inkMap ? inkMap.matrix.clone() : new THREE.Matrix3()},
    };
    material.name = material.name || `Qingming / ${pattern}`;
    material.userData.qingming = {pattern,outlineWeight};
    // Expose local uniforms for updating UV scale / stroke density without recompilation.
    material.qingmingUniforms = local;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms,this.uniforms,local);
      shader.vertexShader = hook(shader.vertexShader,'#include <common>',
        '#include <common>\n'+vertexPars,'vertex');
      shader.vertexShader = hook(shader.vertexShader,'#include <begin_vertex>',
        '#include <begin_vertex>\nvQiRest = position; vQiRestNormal = normal; vQiUV = uv;','vertex');
      shader.fragmentShader = hook(shader.fragmentShader,'#include <common>',
        '#include <common>\n'+fragmentPars,'fragment');
      shader.fragmentShader = hook(shader.fragmentShader,'#include <shadowmap_pars_fragment>',
        '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>','fragment');
      const output = shader.fragmentShader.includes('#include <opaque_fragment>')
        ? '#include <opaque_fragment>' : '#include <output_fragment>';
      shader.fragmentShader = hook(shader.fragmentShader,output,shade+'\n'+output,'fragment');
    };
    material.customProgramCacheKey = () => 'qingming-model-1.0';
    this.materials.add(material);
    material.addEventListener('dispose',()=>this.materials.delete(material));
    return material;
  }

  /**
   * Converts a subtree, including material arrays, InstancedMesh and SkinnedMesh.
   * select(mesh, material, index) decides per group; getOptions returns art options.
   * Call restore() before disposing resources or removing a temporary style preview.
   */
  applyTo(root, {select=()=>true, getOptions=()=>({})}={}) {
    const swaps=[], owned=new Set(), cache=new Map();
    try {
      root.traverse(mesh=>{
        if (!mesh.isMesh) return;
        const originals=Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const converted=originals.map((m,i)=>{
          if (!select(mesh,m,i)) return m;
          const options=getOptions(mesh,m,i) || {};
          // Map identity matters: two distinct ink textures must not share a cache key.
          const {inkMap,...rest}=options;
          const key=m.uuid+':'+JSON.stringify(rest)+':'+(inkMap?.uuid || '');
          if (!cache.has(key)) {
            const fresh=this.convertMaterial(m,options);
            cache.set(key,fresh); owned.add(fresh);
          }
          return cache.get(key);
        });
        if (converted.some((m,i)=>m!==originals[i])) {
          swaps.push([mesh,mesh.material]);
          mesh.material=Array.isArray(mesh.material) ? converted : converted[0];
        }
      });
    } catch (error) {
      for (const [mesh,original] of swaps) mesh.material=original;
      for (const material of owned) material.dispose();
      throw error;
    }
    let restored=false;
    const restore=()=>{if(!restored){for(const [mesh,old] of swaps) mesh.material=old; restored=true;}};
    return {materials:[...owned],meshes:swaps.map(v=>v[0]),restore,
      dispose(){restore();for(const m of owned)m.dispose();owned.clear();}};
  }

  dispose() {for(const material of [...this.materials]) material.dispose();}
}

export function createQingmingStyle(options) {return new QingmingStyle(options);}
