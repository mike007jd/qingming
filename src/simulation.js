import * as THREE from 'three';
// math.js
// Column-major matrices; WebGL and glTF conventions. All positions are in metres.
const V={add:(a,b)=>a.map((x,i)=>x+b[i]),sub:(a,b)=>a.map((x,i)=>x-b[i]),scale:(a,s)=>a.map(x=>x*s),dot:(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm:a=>{let n=Math.hypot(...a)||1;return a.map(x=>x/n)}};
function identity(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);}
function multiply(a,b){let r=new Float32Array(16);for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)r[c*4+row]+=a[k*4+row]*b[c*4+k];return r;}
function perspective(fovy,aspect,near,far){let m=new Float32Array(16),f=1/Math.tan(fovy/2);m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;m[14]=2*far*near/(near-far);return m;}
function ortho(l,r,b,t,n,f){let m=identity();m[0]=2/(r-l);m[5]=2/(t-b);m[10]=-2/(f-n);m[12]=-(r+l)/(r-l);m[13]=-(t+b)/(t-b);m[14]=-(f+n)/(f-n);return m;}
function lookAt(eye,target,up=[0,1,0]){let z=V.norm(V.sub(eye,target)),x=V.norm(V.cross(up,z)),y=V.cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-V.dot(x,eye),-V.dot(y,eye),-V.dot(z,eye),1]);}
function invert(a){let m=new Float32Array(16);const b00=a[0]*a[5]-a[1]*a[4],b01=a[0]*a[6]-a[2]*a[4],b02=a[0]*a[7]-a[3]*a[4],b03=a[1]*a[6]-a[2]*a[5],b04=a[1]*a[7]-a[3]*a[5],b05=a[2]*a[7]-a[3]*a[6],b06=a[8]*a[13]-a[9]*a[12],b07=a[8]*a[14]-a[10]*a[12],b08=a[8]*a[15]-a[11]*a[12],b09=a[9]*a[14]-a[10]*a[13],b10=a[9]*a[15]-a[11]*a[13],b11=a[10]*a[15]-a[11]*a[14];let d=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;d=1/(d||1);m[0]=(a[5]*b11-a[6]*b10+a[7]*b09)*d;m[1]=(a[2]*b10-a[1]*b11-a[3]*b09)*d;m[2]=(a[13]*b05-a[14]*b04+a[15]*b03)*d;m[3]=(a[10]*b04-a[9]*b05-a[11]*b03)*d;m[4]=(a[6]*b08-a[4]*b11-a[7]*b07)*d;m[5]=(a[0]*b11-a[2]*b08+a[3]*b07)*d;m[6]=(a[14]*b02-a[12]*b05-a[15]*b01)*d;m[7]=(a[8]*b05-a[10]*b02+a[11]*b01)*d;m[8]=(a[4]*b10-a[5]*b08+a[7]*b06)*d;m[9]=(a[1]*b08-a[0]*b10-a[3]*b06)*d;m[10]=(a[12]*b04-a[13]*b02+a[15]*b00)*d;m[11]=(a[9]*b02-a[8]*b04-a[11]*b00)*d;m[12]=(a[5]*b07-a[4]*b09-a[6]*b06)*d;m[13]=(a[0]*b09-a[1]*b07+a[2]*b06)*d;m[14]=(a[13]*b01-a[12]*b03-a[14]*b00)*d;m[15]=(a[8]*b03-a[9]*b01+a[10]*b00)*d;return m;}
function transform(m,v){let x=v[0],y=v[1],z=v[2],w=m[3]*x+m[7]*y+m[11]*z+m[15];return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w];}
const Z_TO_Y=new Float32Array([1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1]);
const world=p=>[p[0],p[2],-p[1]];
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);


// traffic-core.js
/** Deterministic, renderer-independent paths and navigation. Z-up model metres.
 * No frame-index randomness, no position resets at path ends, no teleport recovery.
 */
const LIFE_STEP = 1 / 30;
const lifeClamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lifeAngle = (a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*lifeClamp(t,0,1);
const lifeRiver = x=>3.4*Math.sin(x/72);
function lifeHash(s){let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function lifeSmooth(a,b,t){t=lifeClamp((t-a)/(b-a),0,1);return t*t*(3-2*t);}
class ArcPath {
 constructor(points,closed=false){if(points.length<2)throw new Error('Route needs two distinct points.');this.points=points;this.closed=closed;this.length=0;this.edges=[];for(let i=0;i<points.length-(closed?0:1);i++){const a=points[i],b=points[(i+1)%points.length],n=Math.hypot(b[0]-a[0],b[1]-a[1]);if(n<1e-6)continue;this.edges.push({a,b,n,s:this.length});this.length+=n;}if(!this.length)throw new Error('Zero-length path.');}
 at(s){s=this.closed?((s%this.length)+this.length)%this.length:lifeClamp(s,0,this.length);let lo=0,hi=this.edges.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(this.edges[mid].s<=s)lo=mid;else hi=mid-1;}const e=this.edges[lo],t=lifeClamp((s-e.s)/e.n,0,1);return {p:[e.a[0]+(e.b[0]-e.a[0])*t,e.a[1]+(e.b[1]-e.a[1])*t,(e.a[2]||0)+((e.b[2]||0)-(e.a[2]||0))*t],dir:[(e.b[0]-e.a[0])/e.n,(e.b[1]-e.a[1])/e.n],segment:lo};}
 projectNear(p,s,window=3){let best={d:Infinity,s};const cycle=this.closed?Math.floor(s/this.length):0;for(const e of this.edges)for(let k=this.closed?cycle-1:0;k<=(this.closed?cycle+1:0);k++){const start=e.s+k*this.length;if(start>s+window||start+e.n<s-window)continue;const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],low=lifeClamp((s-window-start)/e.n,0,1),high=lifeClamp((s+window-start)/e.n,0,1),t=lifeClamp(((p[0]-e.a[0])*dx+(p[1]-e.a[1])*dy)/(e.n*e.n),low,high),d=Math.hypot(p[0]-e.a[0]-dx*t,p[1]-e.a[1]-dy*t);if(d<best.d)best={d,s:start+t*e.n};}return best;}
 nearest(p){let best={d:Infinity,s:0};for(const e of this.edges){const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],t=lifeClamp(((p[0]-e.a[0])*dx+(p[1]-e.a[1])*dy)/(e.n*e.n),0,1),d=Math.hypot(p[0]-e.a[0]-dx*t,p[1]-e.a[1]-dy*t);if(d<best.d)best={d,s:e.s+t*e.n};}return best;}
}
/** Oriented rectangle SAT; pad is a requested clearance, not part of the mesh. */
function lifeOBBOverlap(a,b,pad=0){if(Math.hypot(a.x-b.x,a.y-b.y)>Math.hypot(a.hx,a.hy)+Math.hypot(b.hx,b.hy)+pad)return false;const ax=[Math.cos(a.angle),Math.sin(a.angle)],ay=[-ax[1],ax[0]],bx=[Math.cos(b.angle),Math.sin(b.angle)],by=[-bx[1],bx[0]],dx=b.x-a.x,dy=b.y-a.y;for(const v of [ax,ay,bx,by]){const ra=a.hx*Math.abs(ax[0]*v[0]+ax[1]*v[1])+a.hy*Math.abs(ay[0]*v[0]+ay[1]*v[1]),rb=b.hx*Math.abs(bx[0]*v[0]+bx[1]*v[1])+b.hy*Math.abs(by[0]*v[0]+by[1]*v[1]);if(Math.abs(dx*v[0]+dy*v[1])>=ra+rb+pad)return false;}return true;}
function lifeBoatHull(b,p=b.p,angle=b.heading,pad=.06){return {x:p[0],y:p[1],hx:b.length*.5+pad,hy:b.beam*.5+pad,angle};}
function lifeBoatNavigable(b,p,heading){const c=Math.cos(heading),s=Math.sin(heading);for(const x of [-b.length/2,0,b.length/2])for(const y of [-b.beam/2,b.beam/2]){const xx=p[0]+x*c-y*s,yy=p[1]+x*s+y*c;if(Math.abs(yy-lifeRiver(xx))>13.45)return false; // riverbank margin
 if(Math.abs(xx)<4.15){const underside=1.12+5.68*(1-(yy/16.25)**2)-.17;if(b.height+.28>underside-.30)return false;}}
 for(const d of [-70,-39,39,76])for(const side of [-1,1]){const dock={x:d,y:lifeRiver(d)+side*11.65,hx:2.23,hy:3.60,angle:0};if(lifeOBBOverlap(lifeBoatHull(b,p,heading),dock,.08))return false;}return true;}
class LifeHeap {constructor(){this.items=[];}push(id,f){const a=this.items;let i=a.length;a.push({id,f});while(i){const j=(i-1)>>1;if(a[j].f<=f)break;a[i]=a[j];i=j;}a[i]={id,f};}pop(){const a=this.items,top=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=v.f)break;a[i]=a[j];i=j;}a[i]=v;}return top;}}
/** Conservative raster A*. Every retained edge is rechecked against the actual
 * CollisionWorld during authoring, and live motion uses that same narrow phase. */
class LandPlanner {
 constructor(world,{bounds=[-146,146,-95,118],cell=.65}={}){this.world=world;this.bounds=bounds;this.cell=cell;this.nx=Math.ceil((bounds[1]-bounds[0])/cell)+1;this.ny=Math.ceil((bounds[3]-bounds[2])/cell)+1;this.ok=new Uint8Array(this.nx*this.ny);this.z=new Float32Array(this.ok.length);for(let y=0;y<this.ny;y++)for(let x=0;x<this.nx;x++){const xx=bounds[0]+x*cell,yy=bounds[2]+y*cell,bridge=Math.abs(xx)<3.65&&Math.abs(yy)<18.6,f=world.sampleFloor(xx,yy,bridge?12:2.92,.04),i=y*this.nx+x;if(f&&world.canOccupy(xx,yy,f.z,.34,1.76)){this.ok[i]=1;this.z[i]=f.z;}}}
 point(i){return [this.bounds[0]+(i%this.nx)*this.cell,this.bounds[2]+Math.floor(i/this.nx)*this.cell,this.z[i]];}
 nearest(p){let x=Math.round((p[0]-this.bounds[0])/this.cell),y=Math.round((p[1]-this.bounds[2])/this.cell);for(let r=0;r<22;r++){let best=-1,dd=Infinity;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(r&&Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;const xx=x+dx,yy=y+dy,i=yy*this.nx+xx;if(xx<0||yy<0||xx>=this.nx||yy>=this.ny||!this.ok[i])continue;const pt=this.point(i),d=Math.hypot(pt[0]-p[0],pt[1]-p[1]);if(d<dd){best=i;dd=d;}}if(best>=0)return best;}return -1;}
 clear(a,b,r=.28){const n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/.20);let prev=a;for(let j=1;j<=n;j++){let t=j/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,f=this.world.sampleFloor(x,y,prev[2]+.25,.08);if(!f||f.z<prev[2]-.3||!this.world.canOccupy(x,y,f.z,r,1.76))return false;prev=[x,y,f.z];}return true;}
 path(start,end){const a=this.nearest(start),b=this.nearest(end);if(a<0||b<0||a===b)return null;const n=this.ok.length,g=new Float32Array(n);g.fill(Infinity);g[a]=0;const parent=new Int32Array(n);parent.fill(-1);const closed=new Uint8Array(n),open=new LifeHeap(),bp=this.point(b);open.push(a,0);let limit=0,found=false;while(open.items.length&&limit++<n){const u=open.pop().id;if(closed[u])continue;if(u===b){found=true;break;}closed[u]=1;const ux=u%this.nx,uy=Math.floor(u/this.nx);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const x=ux+dx,y=uy+dy,v=y*this.nx+x;if(x<0||y<0||x>=this.nx||y>=this.ny||!this.ok[v]||closed[v])continue;if(dx&&dy&&(!this.ok[uy*this.nx+x]||!this.ok[y*this.nx+ux]))continue;if(Math.abs(this.z[v]-this.z[u])>this.cell*1.25)continue;const cost=g[u]+Math.hypot(dx,dy)*this.cell+(Math.abs(this.point(v)[0])<2.55&&this.point(v)[1]>-43&&this.point(v)[1]<97?.75:0);if(cost<g[v]){g[v]=cost;parent[v]=u;const p=this.point(v);open.push(v,cost+Math.hypot(bp[0]-p[0],bp[1]-p[1]));}}}
 if(!found)return null;let ids=[];for(let v=b;v!==-1;v=parent[v])ids.push(v);ids.reverse();let pts=ids.map(i=>this.point(i)),out=[pts[0]];for(let i=0;i<pts.length-1;){let j=Math.min(pts.length-1,i+32);for(;j>i+1;j--)if(this.clear(pts[i],pts[j]))break;if(!this.clear(pts[i],pts[j]))return null;out.push(pts[j]);i=j;}return out;}
}


// navigation.js
/** Authored architectural capsule collision. Model-space XY ground plane, Z-up metres.
 * Broad phase is a spatial hash; narrow phase is circle vs OBB + vertical overlap.
 * Movement is swept in <= 0.08m substeps, with sliding, head clearance and step checks.
 */
const NAV_EPS = 0.008;
const navClamp = (x,a,b)=>Math.max(a,Math.min(b,x));
function navPoint(m,p){return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];}
class CollisionWorld {
 constructor(data){
  this.data=data;this.cell=4;this.boxes=[];this.floors=[];this.boxGrid=new Map();this.floorGrid=new Map();this.doorGrid=new Map();this.doors=[];this.rooms=[];this.lights=[];this.metrics={queries:0,contacts:0};
  for(const ins of data.instances){const spec=data.prefabs[ins.prefab];if(!spec)continue;const m=ins.matrix,sc=[Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10])],angle=Math.atan2(m[1],m[0]);
   for(const v of spec.boxes||[]){const c=navPoint(m,v.slice(0,3));this.addBox({x:c[0],y:c[1],lo:c[2]-v[5]*sc[2]/2,hi:c[2]+v[5]*sc[2]/2,hx:v[3]*sc[0]/2,hy:v[4]*sc[1]/2,angle:angle+v[6],tag:v[7],owner:ins.name});}
   for(const f of spec.floors||[]){const c=navPoint(m,f.c);this.addFloor({x:c[0],y:c[1],z:c[2],hx:f.size[0]*sc[0]/2,hy:f.size[1]*sc[1]/2,angle,slope:f.slope||[0,0],owner:ins.name,stair:!!f.stair});}
   if(spec.bridge){for(let y=-18.5;y<18.5;y+=.8)for(const s of [-1,1])this.addBox({x:s*3.79,y:y+.4,lo:this.bridgeHeight(y+.4)-.12,hi:this.bridgeHeight(y+.4)+1.30,hx:.095,hy:.42,angle:0,tag:'bridge_rail',owner:ins.name});}
   if(spec.kind){this.rooms.push({name:spec.kind,owner:ins.name,x:m[12],y:m[13],lo:m[14]+.32*sc[2],hi:m[14]+(spec.stories*3.0+.5)*sc[2],hx:spec.width*sc[0]/2,hy:spec.depth*sc[1]/2,angle,stories:spec.stories,matrix:m});}
   for(const l of spec.lights||[]){const p=navPoint(m,l);this.lights.push({position:p,color:l.slice(3,6),radius:l[6]*Math.max(...sc),owner:ins.name});}
  }
 }
 bridgeHeight(y){return 2.32+5.50*Math.max(0,1-(y/18.5)**2);}
 bounds(o,pad=.42){const c=Math.abs(Math.cos(o.angle)),s=Math.abs(Math.sin(o.angle));return [o.x-c*o.hx-s*o.hy-pad,o.x+c*o.hx+s*o.hy+pad,o.y-s*o.hx-c*o.hy-pad,o.y+s*o.hx+c*o.hy+pad];}
 insert(grid,o,i){let [a,b,c,d]=this.bounds(o);for(let x=Math.floor(a/this.cell);x<=Math.floor(b/this.cell);x++)for(let y=Math.floor(c/this.cell);y<=Math.floor(d/this.cell);y++){let k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}}
 addBox(b){b.cs=Math.cos(b.angle);b.sn=Math.sin(b.angle);this.insert(this.boxGrid,b,this.boxes.length);this.boxes.push(b);}
 addFloor(f){f.cs=Math.cos(f.angle);f.sn=Math.sin(f.angle);this.insert(this.floorGrid,f,this.floors.length);this.floors.push(f);}
 local(o,x,y){const dx=x-o.x,dy=y-o.y;return [dx*o.cs+dy*o.sn,-dx*o.sn+dy*o.cs];}
 nearby(grid,x,y){return grid.get(Math.floor(x/this.cell)+','+Math.floor(y/this.cell))||[];}
 sampleFloor(x,y,maxZ=Infinity,supportRadius=.21){
  const [xmin,xmax,ymin,ymax]=this.data.bounds;if(x<xmin||x>xmax||y<ymin||y>ymax)return null;
  const river=Math.abs(y-3.4*Math.sin(x/72));let floor=river>14.25?2.26:-Infinity;let tag='ground';
  if(Math.abs(x)<3.68&&Math.abs(y)<=18.6){const h=this.bridgeHeight(y)+.012;if(h<=maxZ+.01){floor=h;tag='bridge';}}
  for(const i of this.nearby(this.floorGrid,x,y)){const f=this.floors[i],p=this.local(f,x,y);if(Math.hypot(Math.max(0,Math.abs(p[0])-f.hx),Math.max(0,Math.abs(p[1])-f.hy))<=supportRadius+.003){const z=f.z+p[0]*f.slope[0]+p[1]*f.slope[1];if(z<=maxZ+.014&&z>floor){floor=z;tag=f.stair?'stairs':f.owner;}}}
  return Number.isFinite(floor)&&floor<=maxZ+.014?{z:floor,tag}:null;
 }
 penetration(b,x,y,z,r=.23,height=1.72){
  if(z+height<=b.lo+.025||z>=b.hi-.018)return null;
  const p=this.local(b,x,y),cx=navClamp(p[0],-b.hx,b.hx),cy=navClamp(p[1],-b.hy,b.hy);let dx=p[0]-cx,dy=p[1]-cy,d=Math.hypot(dx,dy);
  if(d>=r-NAV_EPS)return null;
  if(d<1e-8){const px=b.hx+r-Math.abs(p[0]),py=b.hy+r-Math.abs(p[1]);if(px<py){dx=(p[0]>=0?1:-1)*(px+NAV_EPS);dy=0;}else{dy=(p[1]>=0?1:-1)*(py+NAV_EPS);dx=0;}}
  else {const s=(r-d+NAV_EPS)/d;dx*=s;dy*=s;}
  return [dx*b.cs-dy*b.sn,dx*b.sn+dy*b.cs];
 }
 contacts(x,y,z,r=.23,h=1.72){const ids=this.nearby(this.boxGrid,x,y);let out=[];for(const i of ids){const b=this.boxes[i],p=this.penetration(b,x,y,z,r,h);if(p)out.push({b,p});}const doors=r<=.6?this.nearby(this.doorGrid,x,y).map(i=>this.doors[i]):this.doors;for(const door of doors){const b=door.box;if(Math.abs(x-b.x)<b.hx+b.hy+r&&Math.abs(y-b.y)<b.hx+b.hy+r){const p=this.penetration(b,x,y,z,r,h);if(p)out.push({b,p});}}return out;}
 canOccupy(x,y,z,r=.23,h=1.72){return this.contacts(x,y,z,r,h).length===0;}
 move(p,dx,dy,{radius=.23,height=1.72,step=.25,drop=.65}={}){
  let x=p[0],y=p[1],z=p[2],blocked=false,count=0;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.08));dx/=steps;dy/=steps;
  for(let k=0;k<steps;k++){
   let tx=x+dx,ty=y+dy,floor=this.sampleFloor(tx,ty,z+step);if(!floor||floor.z<z-drop){blocked=true;continue;}
   let tz=floor.z;
   for(let iter=0;iter<4;iter++){const cs=this.contacts(tx,ty,tz,radius,height);if(!cs.length)break;blocked=true;for(const {p:push} of cs){tx+=push[0];ty+=push[1];count++;}}
   floor=this.sampleFloor(tx,ty,z+step);
   if(!floor||floor.z<z-drop||!this.canOccupy(tx,ty,floor.z,radius,height)){blocked=true;continue;}
   if(Math.hypot(tx-x,ty-y)>.40&&Math.hypot(dx,dy)<.10){blocked=true;continue;}
   x=tx;y=ty;z=floor.z;
  }
  this.metrics.queries+=steps;this.metrics.contacts+=count;return {position:[x,y,z],blocked,contacts:count};
 }
 nearestClear(p,r=.23,height=1.72){
  for(let ring=0;ring<14;ring++){const n=ring?16:1;for(let j=0;j<n;j++){const x=p[0]+ring*.22*Math.cos(j/n*Math.PI*2),y=p[1]+ring*.22*Math.sin(j/n*Math.PI*2),f=this.sampleFloor(x,y,p[2]+.26);if(f&&Math.abs(f.z-p[2])<.65&&this.canOccupy(x,y,f.z,r,height))return [x,y,f.z];}}
  return null;
 }
 roomAt(x,y,z){return this.rooms.find(r=>{const c=Math.cos(r.angle),s=Math.sin(r.angle),dx=x-r.x,dy=y-r.y;return Math.abs(dx*c+dy*s)<r.hx&&Math.abs(-dx*s+dy*c)<r.hy&&z>r.lo-.12&&z<r.hi;})||null;}
 registerDoors(sourceAssets){for(const a of sourceAssets)for(let i=0;i<a.instances.length;i++){const mo=a.instances[i].motion;if(mo?.kind!=='door')continue;const m=a.baseMatrices[i],sx=Math.hypot(m[0],m[1],m[2]),sy=Math.hypot(m[4],m[5],m[6]),sz=Math.hypot(m[8],m[9],m[10]);const door={a,index:i,mo,current:mo.defaultOpen?mo.openAngle:0,target:mo.defaultOpen?mo.openAngle:0,scale:[sx,sy,sz],box:{}};const reach=Math.hypot(mo.size[0]*sx,mo.size[1]*sy/2);this.insert(this.doorGrid,{x:mo.hinge[0],y:mo.hinge[1],hx:reach+.18,hy:reach+.18,angle:0},this.doors.length);this.doors.push(door);this.updateDoor(door);}}
 updateDoor(d){const angle=d.mo.baseAngle+d.current,cs=Math.cos(angle),sn=Math.sin(angle),h=d.mo.hinge,w=d.mo.size[0]*d.scale[0],depth=d.mo.size[1]*d.scale[1],hh=d.mo.size[2]*d.scale[2];d.box={x:h[0]+cs*w/2,y:h[1]+sn*w/2,lo:h[2],hi:h[2]+hh,hx:w/2,hy:depth/2,angle,cs,sn,tag:'interactive_door'};const m=d.a.matrices[d.index];m.set([cs*d.scale[0],0,-sn*d.scale[0],0,-sn*d.scale[1],0,-cs*d.scale[1],0,0,d.scale[2],0,0,h[0],h[2],-h[1],1]);d.a.centers[d.index]=[d.box.x,(d.box.lo+d.box.hi)*.5,-d.box.y];}
 animateDoors(dt,player=null){for(const d of this.doors){const before=d.current;d.current+=(d.target-d.current)*(1-Math.exp(-dt*7));this.updateDoor(d);if(player&&this.penetration(d.box,...player,.25,1.72)){d.current=before;d.target=before;this.updateDoor(d);}}}
 nearestDoor(p,maxDistance=2.2){let best=null,dist=maxDistance;for(const d of this.doors){const dd=Math.hypot(p[0]-d.box.x,p[1]-d.box.y);if(dd<dist&&p[2]+1.2>d.box.lo&&p[2]<d.box.hi){best=d;dist=dd;}}return best;}
 toggleDoor(p){const d=this.nearestDoor(p);if(!d)return null;d.target=d.target>.5?0:d.mo.openAngle;return d.target>.5?'推开'+d.mo.label:'合上'+d.mo.label;}
}
class Walker {
 constructor(world){this.world=world;this.position=[0,-21,2.26];this.spawnPoint=[...this.position];this.speed=2.45;this.smoothedZ=this.position[2]+1.6;this.distance=0;this.blocked=false;}
 spawn(position){const p=this.world.nearestClear(position)||this.world.nearestClear([0,-21,2.26]);if(!p)throw new Error('No safe walking spawn found.');this.position=p;this.spawnPoint=[...p];this.smoothedZ=p[2]+1.6;return p;}
 reset(){return this.spawn(this.spawnPoint);}
 step(camera,keys,dt){const old=[...this.position],view=camera.target.map((x,i)=>x-camera.eye[i]);let fx=view[0],fy=-view[2],n=Math.hypot(fx,fy)||1;fx/=n;fy/=n;let dx=0,dy=0;
  if(keys.has('KeyW')||keys.has('ArrowUp')){dx+=fx;dy+=fy;}if(keys.has('KeyS')||keys.has('ArrowDown')){dx-=fx;dy-=fy;}if(keys.has('KeyD')){dx+=fy;dy-=fx;}if(keys.has('KeyA')){dx-=fy;dy+=fx;}
  n=Math.hypot(dx,dy);if(n){const s=this.speed*(keys.has('ShiftLeft')?1.65:1)*Math.min(dt,.08)/n;const result=this.world.move(this.position,dx*s,dy*s);this.position=result.position;this.blocked=result.blocked;
   // People are soft dynamic blockers for walking, independent of authored building solids.
   for(const a of this.world.crowdActors||[]){if(a.crew||Math.abs(a.p[2]-this.position[2])>.8)continue;const xx=this.position[0]-a.p[0],yy=this.position[1]-a.p[1],d=Math.hypot(xx,yy),r=.23+a.radius;if(d<r&&d>.001){const push=(r-d)/d;this.position=this.world.move(this.position,xx*push,yy*push).position;this.blocked=true;}}
   for(const b of this.world.lifeActors||[]){if(Math.abs(b.z-this.position[2])>1.1)continue;const box={...b,lo:b.z,hi:b.z+1.85,cs:Math.cos(b.angle),sn:Math.sin(b.angle)};const push=this.world.penetration(box,...this.position,.25,1.72);if(push){const corrected=this.world.move(this.position,push[0],push[1]);this.position=corrected.position;this.blocked=true;}}
   this.distance+=Math.hypot(this.position[0]-old[0],this.position[1]-old[1]);}
  this.smoothedZ+=(this.position[2]+1.6-this.smoothedZ)*(1-Math.exp(-dt*16));camera.eye=[this.position[0],this.smoothedZ,-this.position[1]];camera.target=camera.eye.map((v,i)=>v+view[i]);camera.fov=66;
  return this.world.roomAt(...this.position);
 }
}


// crowd.js
/** GPU-instanced, four-weight crowd skinning. Bone palettes are evaluated from the
 * same sampled joint clips exported in Song_Characters_Rigged.glb.
 * Navigation and local separation are interactive; far poses update at a lower rate.
 */
const crowdClamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function crowdMixAngle(a,b,t){let d=(b-a+Math.PI*3)%(Math.PI*2)-Math.PI;return a+d*t;}
function crowdTRS(out,q,t){const x=q[0],y=q[1],z=q[2],w=q[3],xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;out.set([1-2*(yy+zz),2*(xy+wz),2*(xz-wy),0,2*(xy-wz),1-2*(xx+zz),2*(yz+wx),0,2*(xz+wy),2*(yz-wx),1-2*(xx+yy),0,t[0],t[1],t[2],1]);}
function crowdMul(out,off,a,ao,b){for(let c=0;c<4;c++)for(let r=0;r<4;r++){let x=0;for(let k=0;k<4;k++)x+=a[ao+k*4+r]*b[c*4+k];out[off+c*4+r]=x;}}
class CrowdSystem {
 constructor(engine,library,nav){
  this.engine=engine;this.world=nav;this.library=library;this.actors=[];this.jointCount=library.jointsPerRig;this.stats={skinned:0,walking:0,visiblePoseUpdates:0,separationContacts:0};
  for(const rig of Object.values(library.rigs)){rig.rest=rig.joints.map((j)=>j.p.map((x,k)=>x-(j.parent>=0?rig.joints[j.parent].p[k]:0)));for(const c of Object.values(rig.clips)){c.rotations=new Float32Array(c.rotations);c.translations=new Float32Array(c.translations);}}
  this.route=nav.data.routes[0].points;this.segments=[];this.routeLength=0;for(let i=0;i<this.route.length;i++){const a=this.route[i],b=this.route[(i+1)%this.route.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);this.segments.push({a,b,len,start:this.routeLength});this.routeLength+=len;}
  let wi=0;
  for(const a of engine.sourceAssets){if(!a.rig)continue;for(let index=0;index<a.instances.length;index++){
   const id=this.actors.length,m=a.baseMatrices[index],mo=a.instances[index].motion,sc=[Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10])],rig=library.rigs[a.rig],crew=mo?.kind==='boat',seated=mo?.kind==='seated';let p=[m[12],-m[14],m[13]];
   let walk=mo?.kind==='walk'&&!crew&&!a.name.includes('child');const radius=a.name.includes('porter')?.48:.22;
   if(!crew&&!seated){const clear=nav.nearestClear(p,radius,1.64*sc[2]);if(clear)p=clear;}
   const clip=seated?'Sit':crew?'Work':(a.name.includes('vendor')?'Talk':a.name.includes('farmer')&&id%3===0?'Work':'Idle');
   const actor={id,a,index,rig,scale:sc,p,baseP:[...p],phase:(id*.61803398875)%1,walk,crew,seated,radius,heading:Math.atan2(-m[2],m[0]),distance:0,speed:.58+(id%7)*.027,clip,oldClip:clip,blend:1,walkClock:0,worldMatrices:new Float32Array(this.jointCount*16),lastPose:-Infinity};
   if(walk){actor.startDistance=(wi++*7.39)%this.routeLength;actor.distance=actor.startDistance;const rp=this.routeAt(actor.distance);const f=nav.sampleFloor(...rp.p,12);if(f)actor.p=[...rp.p,f.z];actor.heading=Math.atan2(rp.dir[0],-rp.dir[1]);actor.clip=actor.oldClip=a.name.includes('porter')?'Carry':'Walk';}
   this.actors.push(actor);
  }}
  this.palettes=new Float32Array(Math.max(1,this.actors.length)*this.jointCount*16);
  this.texture=new THREE.DataTexture(this.palettes,this.jointCount*4,Math.max(1,this.actors.length),THREE.RGBAFormat,THREE.FloatType);
  this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;this.texture.needsUpdate=true;
  this.dirty=new Uint8Array(this.actors.length);
  this.uploadStats={calls:0,bytes:0,fullUploads:0,partialUploads:0,skippedUpdates:0,strategy:'init'};
  this.dirtyRowStats={'0':0,'1-4':0,'5-8':0,'9-16':0,'17-31':0,'32+':0,'all':0};

  this.local=new Float32Array(16);this.q=new Float32Array(4);this.t=new Float32Array(3);this.stats.skinned=this.actors.length;this.stats.walking=wi;nav.crowdActors=this.actors;
 }
 routeAt(distance){distance=((distance%this.routeLength)+this.routeLength)%this.routeLength;const s=this.segments.find(s=>distance<s.start+s.len)||this.segments[0],t=(distance-s.start)/s.len;return {p:[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t],dir:[(s.b[0]-s.a[0])/s.len,(s.b[1]-s.a[1])/s.len]};}
 sample(rig,name,time,phase,j,q,t){const c=rig.clips[name];const f=(((time/c.duration+phase)%1)+1)%1*(c.frames-1),lo=Math.floor(f),hi=lo+1,u=f-lo,qa=(lo*this.jointCount+j)*4,qb=(hi*this.jointCount+j)*4,ta=(lo*this.jointCount+j)*3,tb=(hi*this.jointCount+j)*3;let dot=0;for(let k=0;k<4;k++)dot+=c.rotations[qa+k]*c.rotations[qb+k];let norm=0;for(let k=0;k<4;k++){q[k]=c.rotations[qa+k]*(1-u)+c.rotations[qb+k]*u*(dot<0?-1:1);norm+=q[k]*q[k];}norm=1/Math.sqrt(norm||1);for(let k=0;k<4;k++)q[k]*=norm;for(let k=0;k<3;k++)t[k]=c.translations[ta+k]*(1-u)+c.translations[tb+k]*u;}
 pose(a,time){const rig=a.rig,global=a.worldMatrices,q=this.q,tr=this.t,tmpq=new Float32Array(4),tmpt=new Float32Array(3),clock=a.walk||a.lifeMoving?a.walkClock:time;
  for(let j=0;j<this.jointCount;j++){this.sample(rig,a.clip,clock,a.phase,j,q,tr);if(a.blend<1){this.sample(rig,a.oldClip,a.oldClip==='Walk'||a.oldClip==='Carry'?a.walkClock:time,a.phase,j,tmpq,tmpt);let dot=0;for(let k=0;k<4;k++)dot+=q[k]*tmpq[k];let len=0;for(let k=0;k<4;k++){q[k]=tmpq[k]*(1-a.blend)*(dot<0?-1:1)+q[k]*a.blend;len+=q[k]*q[k];}for(let k=0;k<4;k++)q[k]/=Math.sqrt(len||1);for(let k=0;k<3;k++)tr[k]=tmpt[k]*(1-a.blend)+tr[k]*a.blend;}
   for(let k=0;k<3;k++)tr[k]+=rig.rest[j][k];crowdTRS(this.local,q,tr);const off=j*16,parent=rig.joints[j].parent;if(parent<0)global.set(this.local,off);else crowdMul(global,off,global,parent*16,this.local);
   const dest=(a.id*this.jointCount+j)*16,p=rig.joints[j].p;for(let k=0;k<16;k++)this.palettes[dest+k]=global[off+k];for(let r=0;r<3;r++)this.palettes[dest+12+r]=global[off+12+r]-global[off+r]*p[0]-global[off+4+r]*p[1]-global[off+8+r]*p[2];
  }
  this.dirty[a.id]=1;
 }
 update(time,dt,eye){
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
  // Bone-palette upload policy: skip frames where no pose ran, else flag one
  // full upload. pose() is the only palette writer and re-marks its row, and a
  // pending full upload resends everything, so clearing dirty once an upload is
  // issued stays correct even though needsUpdate renders later. fixedTime
  // recording/scrubbing re-poses every actor, so it always lands on 'full' -
  // the same GPU traffic as before this optimization.
  // A per-row texSubImage2D patch (limits 4/8/16) was measured and dropped:
  // street cameras dirty 150-300 rows (never within the limits) and overview
  // cameras save ~2/3 of the bytes but <0.5 ms/frame - below run-to-run noise.
  // evidence/perfreview-batch1-720p.json records the dirty-row distribution.
  const rows=[];for(let r=0;r<this.dirty.length;r++)if(this.dirty[r])rows.push(r);
  const n=rows.length;this.dirtyRowStats[n===0?'0':n>=this.actors.length?'all':n>=32?'32+':n>=17?'17-31':n>=9?'9-16':n>=5?'5-8':'1-4']++;
  if(n===0){this.uploadStats.strategy='skip';this.uploadStats.skippedUpdates++;}
  else{this.texture.needsUpdate=true;this.dirty.fill(0);this.uploadStats.calls++;this.uploadStats.fullUploads++;this.uploadStats.bytes+=this.palettes.byteLength;this.uploadStats.strategy='full';}
 }
 dispose(){this.texture.dispose();}
}
function CLIP_DURATION(name){return name==='Carry'?1.28:1.15;}


// ecology.js

/** Bian river / city traffic controller. All positions are model-space XY/Z.
 * Authoring paths, motion, water forcing, attached crews, land collision and
 * stock transfers have one clock and one authoritative state.
 */
class CityEcology {
 constructor(config,world){
  this.config=config;this.world=world;this.routes=new Map(config.routes.map(r=>[r.id,new ArcPath(r.points,r.closed)]));this.time=0;this.accumulator=0;this.rate=1;this.paused=false;this.events=[];this.boats=[];this.convoys=[];this.people=[];this.citizenPlans=new Map(config.citizens.map(c=>[c.name,c]));this.stats={steps:0,boatDistance:0,landDistance:0,boatNearMisses:0,boatOverlaps:0,groundBlocks:0,berthVisits:0,transferred:0,delivered:0,consumed:0,personReplans:0};this.docks=config.docks.map(d=>({...d,occupant:null,reserved:null,inventory:d.inventory,warehouse:16,delivered:0,queue:[]}));this.shopStock=0;this.consumed=0;this.onBoatStep=null;this.player=null;
  for(const spec of config.boats){const path=this.routes.get(spec.route),b={...spec,path,s:spec.initialFraction*path.length,speedNow:0,state:'航行',remaining:0,cycles:0,turn:0,cargo:spec.cargo,blockedTime:0,lastDockS:-Infinity,desired:spec.speed,wakeDistance:0};let good=false;for(let k=0;k<150;k++){const q=path.at(b.s);b.p=q.p;b.heading=Math.atan2(q.dir[1],q.dir[0]);if(lifeBoatNavigable(b,b.p,b.heading)&&!this.boats.some(c=>lifeOBBOverlap(lifeBoatHull(b),lifeBoatHull(c),5))){good=true;break;}b.s=(b.s+4)%path.length;}if(!good)throw new Error('Cannot safely stage boat '+spec.name);this.boats.push(b);}
  for(const spec of config.convoys){const path=this.routes.get(spec.route),v={...spec,path,s:spec.fraction*path.length,speedNow:0,state:'运送',remaining:0,distance:0,cargo:0,nextService:0,blockedTime:0,nextPickup:0,nextDelivery:0,serviceKind:null};v.pickupS=path.nearest(config.docks[v.station].warehouse).s+v.hitch;v.deliveryS=path.nearest(v.delivery).s+v.hitch;this.updateConvoyPose(v);this.convoys.push(v);}
  this.initialStock=this.totalStock();this.initialBoatState=this.boats.map(b=>({s:b.s,p:[...b.p]}));this.trafficBlockers=[];this.refreshBlockers();world.lifeActors=this.trafficBlockers;
 }
 log(kind,text){this.events.unshift({time:+this.time.toFixed(2),kind,text});if(this.events.length>32)this.events.pop();}
 totalStock(){return this.boats.reduce((s,b)=>s+b.cargo,0)+this.docks.reduce((s,d)=>s+d.inventory+d.warehouse,0)+this.convoys.reduce((s,c)=>s+c.cargo,0)+this.people.reduce((s,p)=>s+(p.cargo||0),0)+this.shopStock+this.consumed;}
 attachPeople(actors){this.people=[];let byRoute=new Map();for(const actor of actors){const plan=this.citizenPlans.get(actor.a.instances[actor.index].name);if(!plan)continue;actor.lifePlan=plan;actor.walk=false;actor.clip=actor.oldClip=plan.clip||'Idle';if(['traveller','porter'].includes(plan.mode)){const route=this.routes.get(plan.route);if(!route)continue;const person={actor,plan,path:route,s:(plan.fraction||0)*route.length,direction:1,speed:plan.speed||.84,speedNow:0,state:plan.mode==='porter'?'取货':'往来',wait:0,cargo:0,blockedTime:0,distance:0,loops:0};
    // Initial placements are explicitly staged with capsule clearance. This is the
    // only staging relocation; live agents never reset to a path endpoint.
    let peers=byRoute.get(plan.route)||[];for(let i=0;i<160;i++){const q=route.at(person.s);const f=this.world.sampleFloor(q.p[0],q.p[1],Math.abs(q.p[0])<3.7&&Math.abs(q.p[1])<20?12:q.p[2]+1,.06);if(f)q.p[2]=f.z;if(!peers.some(p=>Math.hypot(q.p[0]-p.actor.p[0],q.p[1]-p.actor.p[1])<1.05)&&this.world.canOccupy(...q.p,actor.radius,1.7*actor.scale[2])){actor.p=[...q.p];actor.baseP=[...q.p];break;}person.s=(person.s+1.05)%route.length;}
    const q=route.at(person.s);actor.heading=Math.atan2(q.dir[0],-q.dir[1]);actor.life=person;peers.push(person);byRoute.set(plan.route,peers);this.people.push(person);}
   else if(!actor.crew&&!actor.seated){actor.clip=actor.oldClip=plan.clip;}
  }// Anchored residents keep their doorway/social activity, but their initial
  // anchor is moved to a walkable pavement if it lies inside the caravan lane.
  const caravan=this.routes.get('caravan-main');
  for(const a of actors){if(a.crew||a.seated||a.life)continue;const near=caravan.nearest(a.p);if(near.d<1.80&&a.p[2]<8.5){const base=[...a.p];let done=false;for(let r=.4;r<5&&!done;r+=.3)for(let i=0;i<24;i++){const t=i*Math.PI/12,x=base[0]+Math.cos(t)*r,y=base[1]+Math.sin(t)*r;if(caravan.nearest([x,y]).d<1.86)continue;const f=this.world.sampleFloor(x,y,Math.abs(x)<3.7&&Math.abs(y)<20?12:base[2]+.5,.08);if(f&&this.world.canOccupy(x,y,f.z,a.radius,1.70*a.scale[2])){a.p=[x,y,f.z];a.baseP=[...a.p];done=true;break;}}}}
  this.stats.mobilePeople=this.people.length;this.stats.anchoredPeople=actors.length-this.people.length;this.crowdActors=actors;this.initialStock=this.totalStock();}
 advance(delta){if(!Number.isFinite(delta)||delta<0)throw new Error('Non-finite ecology delta');if(this.paused)return 0;this.accumulator+=Math.min(delta,.25)*this.rate;let steps=0;while(this.accumulator>=LIFE_STEP&&steps<24){this.step(LIFE_STEP);this.accumulator-=LIFE_STEP;steps++;}return steps;}
 step(dt=LIFE_STEP){this.time+=dt;this.stats.steps++;this.stepBoats(dt);this.stepConvoys(dt);this.refreshBlockers();this.stepPeople(dt);if(this.stats.steps%300===0&&this.shopStock>0){this.shopStock--;this.consumed++;this.stats.consumed++;}if(this.onBoatStep)this.onBoatStep(dt,this.time,this.boats);}
 stepBoats(dt){
  const future=(b,s)=>{let q=b.path.at(s);return {...q,heading:Math.atan2(q.dir[1],q.dir[0])};};
  for(const b of this.boats){const dock=this.docks.find(d=>d.id===b.dock);if(b.remaining>0){b.remaining=Math.max(0,b.remaining-dt);b.speedNow=0;b.state='靠泊装卸';if(b.remaining===0){let amount=Math.min(b.cargo,8);if(amount){b.cargo-=amount;dock.inventory+=amount;this.stats.transferred+=amount;this.log('unload',dock.name+'卸下 '+amount+' 份货物');}else {let n=Math.min(dock.inventory,4);dock.inventory-=n;b.cargo+=n;this.log('load',dock.name+'回程装货 '+n+' 份');}dock.occupant=null;dock.reserved=null;b.lastDockS=b.s;b.state='离泊';this.stats.berthVisits++;}continue;}
   let target=b.speed,forward=[Math.cos(b.heading),Math.sin(b.heading)],turnLook=future(b,b.s+3);const turn=Math.abs(Math.atan2(Math.sin(turnLook.heading-b.heading),Math.cos(turnLook.heading-b.heading)));target*=lifeClamp(1-turn*.9,.28,1);b.turn=turn;
   let nextStop=Infinity;if(dock){const ds=((b.stopDistance-b.s)%b.path.length+b.path.length)%b.path.length;const since=b.s-b.lastDockS;if(ds<22&&(since>15||!Number.isFinite(since))){nextStop=ds;if(dock.occupant===null&&(dock.reserved===null||dock.reserved===b.id))dock.reserved=b.id;const allowed=dock.reserved===b.id;target=Math.min(target,Math.sqrt(2*.28*Math.max(0,ds-(allowed?.05:14))));if(allowed&&ds<.14&&b.speedNow<.28){b.s+=ds;let q=future(b,b.s);b.p=q.p;b.heading=q.heading;b.speedNow=0;b.remaining=b.dwell;dock.occupant=b.id;b.state='靠泊装卸';this.log('berth',dock.name+' · '+b.type+'靠泊');continue;}}}
   // Collision envelopes include the full oriented hull, not only a centre point.
   // Behind a slower ship, reduce speed according to available stopping distance.
   for(const c of this.boats){if(c===b)continue;const rel=[c.p[0]-b.p[0],c.p[1]-b.p[1]],along=rel[0]*forward[0]+rel[1]*forward[1],side=Math.abs(-rel[0]*forward[1]+rel[1]*forward[0]);if(along>0&&along<25&&side<(b.beam+c.beam)*.5+.55){const gap=along-(b.length+c.length)*.5-1.05;target=Math.min(target,Math.sqrt(Math.max(0,2*.30*gap)));}
    // A predicted joining/turning conflict: first arrival yields according to gap,
    // then stable boat id. Distinct directions are safe when their OBBs don't touch.
    for(const t of [1.2,2.4,4.0]){const q=future(b,b.s+Math.max(target,b.speedNow)*t),r=future(c,c.s+c.speedNow*t);if(lifeOBBOverlap(lifeBoatHull(b,q.p,q.heading),lifeBoatHull(c,r.p,r.heading),.48)){if(c.remaining>0||c.id<b.id||along>0)target=Math.min(target,Math.max(0,(Math.hypot(...rel)-(b.length+c.length)*.48-1.1)/(t+1.0)));}}
   }
   b.speedNow+=lifeClamp(target-b.speedNow,-.46*dt,.16*dt);b.speedNow=Math.max(0,b.speedNow);let ds=b.speedNow*dt,q=future(b,b.s+ds);const overlap=this.boats.some(c=>c!==b&&lifeOBBOverlap(lifeBoatHull(b,q.p,q.heading),lifeBoatHull(c),.20));
   if(!lifeBoatNavigable(b,q.p,q.heading)||overlap){b.speedNow=0;b.blockedTime+=dt;b.state='候航避让';if(overlap)this.stats.boatNearMisses++;}else {b.s+=ds;b.p=q.p;b.heading=q.heading;b.wakeDistance+=ds;this.stats.boatDistance+=ds;b.blockedTime=ds>.002?0:b.blockedTime+dt;b.state=ds<.001?'候航避让':nextStop<18?'减速靠泊':'航行';}
   b.cycles=Math.floor(b.s/b.path.length);
  }
 }
 updateConvoyPose(v,s=v.s){const q=v.path.at(s),tail=v.path.at(s-v.hitch);v.p=[...q.p];v.heading=Math.atan2(q.dir[0],-q.dir[1]);v.cartP=[...tail.p];const dx=q.p[0]-tail.p[0],dy=q.p[1]-tail.p[1],n=Math.hypot(dx,dy)||1;v.cartHeading=Math.atan2(dx,-dy);v.pitch=Math.atan2(q.p[2]-v.path.at(s-.7).p[2],.7);v.cartPitch=Math.atan2(q.p[2]-tail.p[2],n);}
 convoyBoxes(v){return [{x:v.p[0],y:v.p[1],angle:v.heading,hx:.43,hy:1.30,z:v.p[2],kind:'animal',entity:v},{x:v.cartP[0],y:v.cartP[1],angle:v.cartHeading,hx:1.04,hy:1.19,z:v.cartP[2],kind:'cart',entity:v}];}
 convoyClear(v){for(const b of this.convoyBoxes(v)){for(const x of [-b.hx,0,b.hx])for(const y of [-b.hy,0,b.hy]){const c=Math.cos(b.angle),s=Math.sin(b.angle),xx=b.x+x*c-y*s,yy=b.y+x*s+y*c,f=this.world.sampleFloor(xx,yy,b.z+2.1,.10);if(!f||Math.abs(f.z-b.z)>2.05||!this.world.canOccupy(xx,yy,f.z,.09,1.78))return false;}}return true;}
 stepConvoys(dt){for(const v of this.convoys){if(v.remaining>0){v.remaining=Math.max(0,v.remaining-dt);v.speedNow=0;v.state='装卸停靠';if(v.remaining===0){const d=this.docks[v.station];if(v.serviceKind==='pickup'){const n=Math.min(8,d.warehouse);d.warehouse-=n;v.cargo+=n;this.log('cartload','车队'+(v.id+1)+'在仓棚装货 '+n+' 份');}else if(v.serviceKind==='delivery'){this.shopStock+=v.cargo;this.stats.delivered+=v.cargo;this.log('delivery','车队'+(v.id+1)+'在市街卸货 '+v.cargo+' 份');v.cargo=0;}v.serviceKind=null;}continue;}
   let target=v.speed;const q=v.path.at(v.s+2),bend=Math.abs(Math.atan2(Math.sin(Math.atan2(q.dir[0],-q.dir[1])-v.heading),Math.cos(Math.atan2(q.dir[0],-q.dir[1])-v.heading)));target*=lifeClamp(1-bend*.85,.42,1);
   for(const c of this.convoys){if(c===v)continue;const ahead=(c.s-v.s+v.path.length)%v.path.length;if(ahead<12)target=Math.min(target,Math.max(0,(ahead-8.5)*.27));}
   let humanAhead=false;const f=[Math.sin(v.heading),-Math.cos(v.heading)];for(const a of this.crowdActors||[]){if(a.crew||Math.abs(a.p[2]-v.p[2])>1)continue;let dx=a.p[0]-v.p[0],dy=a.p[1]-v.p[1],ahead=dx*f[0]+dy*f[1],side=Math.abs(dx*f[1]-dy*f[0]);if(ahead>-.4&&ahead<2.5&&side<.465+a.radius){humanAhead=true;target=Math.min(target,Math.max(0,(ahead-1.9)*.45));}}
   if(this.player){const dx=this.player[0]-v.p[0],dy=this.player[1]-v.p[1],ahead=dx*f[0]+dy*f[1],side=Math.abs(dx*f[1]-dy*f[0]);if(ahead>-.4&&ahead<3&&side<1.1)target=0;}
   v.speedNow+=lifeClamp(target-v.speedNow,-.9*dt,.3*dt);const old=v.s,ds=v.speedNow*dt;this.updateConvoyPose(v,old+ds);let other=this.convoys.some(c=>c!==v&&this.convoyBoxes(v).some(a=>this.convoyBoxes(c).some(b=>Math.abs(a.z-b.z)<.9&&lifeOBBOverlap(a,b,.18))));if(!this.convoyClear(v)||other){this.updateConvoyPose(v,old);v.speedNow=0;v.blockedTime+=dt;v.state='等候通行';this.stats.groundBlocks++;}else{v.s+=ds;v.distance+=ds;this.stats.landDistance+=ds;v.blockedTime=ds>.001?0:v.blockedTime+dt;v.state=humanAhead?'礼让行人':'运送';}
   // A transfer requires the actual cart axle at its matching street-side
   // station. Cargo is carried continuously by a porter from that dock.
   const cycle=Math.floor(v.s/v.path.length),phase=((v.s%v.path.length)+v.path.length)%v.path.length;
   const pickup=((v.pickupS%v.path.length)+v.path.length)%v.path.length,drop=((v.deliveryS%v.path.length)+v.path.length)%v.path.length;
   const site=this.config.docks[v.station].warehouse;
   if(v.cargo===0&&v.nextPickup<=cycle&&Math.abs(phase-pickup)<.30&&Math.hypot(v.cartP[0]-site[0],v.cartP[1]-site[1])<4.3){v.serviceKind='pickup';v.remaining=6;v.speedNow=0;v.nextPickup=cycle+1;}
   else if(v.cargo>0&&v.nextDelivery<=cycle&&Math.abs(phase-drop)<.30&&Math.hypot(v.cartP[0]-v.delivery[0],v.cartP[1]-v.delivery[1])<4.3){v.serviceKind='delivery';v.remaining=6;v.speedNow=0;v.nextDelivery=cycle+1;}
  }}
 refreshBlockers(){this.trafficBlockers.length=0;for(const v of this.convoys)for(const b of this.convoyBoxes(v))this.trafficBlockers.push(b);if(this.world)this.world.lifeActors=this.trafficBlockers;}
 stepPeople(dt){if(!this.people.length)return;const cell=1.5,grid=new Map();for(const a of this.crowdActors){if(a.crew)continue;const key=Math.floor(a.p[0]/cell)+','+Math.floor(a.p[1]/cell);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(a);}
  for(const p of this.people){const a=p.actor,old=[...a.p];let clip='Idle';if(p.wait>0){p.wait=Math.max(0,p.wait-dt);if(p.wait===0){if(p.plan.mode==='porter'){const d=this.docks.find(d=>d.id===p.plan.dock);if(p.direction<0&&p.cargo){d.warehouse+=p.cargo;d.delivered+=p.cargo;p.cargo=0;this.log('porter',d.name+'搬运抵达仓棚');}else if(p.direction>0&&!p.cargo){let n=Math.min(d.inventory,2);d.inventory-=n;p.cargo=n;}}}a.clip=p.plan.mode==='porter'?'Work':'Talk';p.speedNow=0;continue;}
   const aim=p.path.at(p.s+p.direction*.75),dx=aim.p[0]-a.p[0],dy=aim.p[1]-a.p[1],len=Math.hypot(dx,dy)||1;let vx=dx/len,vy=dy/len,sx=0,sy=0,factor=1;
   const cx=Math.floor(a.p[0]/cell),cy=Math.floor(a.p[1]/cell);for(let ix=cx-1;ix<=cx+1;ix++)for(let iy=cy-1;iy<=cy+1;iy++)for(const b of grid.get(ix+','+iy)||[]){if(a===b||Math.abs(a.p[2]-b.p[2])>1)continue;const xx=a.p[0]-b.p[0],yy=a.p[1]-b.p[1],dd=Math.hypot(xx,yy),range=a.radius+b.radius+.35;if(dd<range&&dd>.001){sx+=xx/dd*(range-dd)*2.2;sy+=yy/dd*(range-dd)*2.2;}}
   const onCrossing=false,holdCrossing=false;
   for(const b of this.trafficBlockers){if((onCrossing&&!holdCrossing)||Math.abs(b.z-a.p[2])>1.1)continue;const cs=Math.cos(b.angle),sn=Math.sin(b.angle),xx=a.p[0]-b.x,yy=a.p[1]-b.y,lx=xx*cs+yy*sn,ly=-xx*sn+yy*cs,range=b.hx+a.radius+.65;if(Math.abs(ly)<b.hy+1.4&&Math.abs(lx)<range){const side=((a.p[0]>=0?1:-1)*cs)>=0?1:-1,force=(range-Math.abs(lx))*4.1;sx+=cs*side*force;sy+=sn*side*force;factor=Math.min(factor,.70);}}
   if(this.player&&Math.abs(this.player[2]-a.p[2])<1){const xx=a.p[0]-this.player[0],yy=a.p[1]-this.player[1],d=Math.hypot(xx,yy);if(d<1.15&&d>.001){sx+=xx/d*(1.15-d)*2.1;sy+=yy/d*(1.15-d)*2.1;}}
   if(holdCrossing)factor=0;vx+=sx;vy+=sy;let n=Math.hypot(vx,vy)||1;vx/=n;vy/=n;const options={radius:a.radius,height:1.67*a.scale[2],step:.25,drop:.42};let result=this.world.move(a.p,vx*p.speed*factor*dt,vy*p.speed*factor*dt,options);
   // Dynamic animal/cart solids are checked after authored-wall sliding.
   let bad=!this.personDynamicClear(a,result.position,old);
   if(!bad){a.p=result.position;}let dist=Math.hypot(a.p[0]-old[0],a.p[1]-old[1]);p.speedNow=dist/dt;p.distance+=dist;const toward=(a.p[0]-old[0])*dx/len+(a.p[1]-old[1])*dy/len;
   // Arc progress is projection-based, not distance-based: sidestepping must not
   // silently move the waypoint cursor through a wall or around a whole corner.
   const projected=p.path.projectNear(a.p,p.s,3);p.s+=lifeClamp(projected.s-p.s,-Math.max(.055,dist*1.5),Math.max(.055,dist*1.5));
   if(dist<dt*.04&&!holdCrossing){p.blockedTime+=dt;if(p.blockedTime>2.5){const optionsAngles=[.65,-.65,1.1,-1.1];for(const ang of optionsAngles){const cs=Math.cos(ang),sn=Math.sin(ang),tx=vx*cs-vy*sn,ty=vx*sn+vy*cs,q=this.world.move(a.p,tx*dt*.5,ty*dt*.5,options);if(Math.hypot(q.position[0]-a.p[0],q.position[1]-a.p[1])>.001&&this.personDynamicClear(a,q.position,a.p)){a.p=q.position;break;}}}if(p.blockedTime>12){p.direction*=-1;p.blockedTime=0;this.stats.personReplans++;}}else p.blockedTime=0;
   if(dist>.0002){a.heading=lifeAngle(a.heading,Math.atan2(a.p[0]-old[0],-(a.p[1]-old[1])),1-Math.exp(-dt*8));clip=p.plan.mode==='porter'&&p.cargo?'Carry':'Walk';a.walkClock+=dist*2.0;}
   if(p.path.closed){if(p.s>p.path.length){p.s-=p.path.length;p.loops++;p.wait=p.plan.pause||4;}}else if((p.s>=p.path.length-.18&&Math.hypot(a.p[0]-p.path.at(p.path.length).p[0],a.p[1]-p.path.at(p.path.length).p[1])<.42)||(p.s<=.15&&Math.hypot(a.p[0]-p.path.at(0).p[0],a.p[1]-p.path.at(0).p[1])<.42)){p.s=lifeClamp(p.s,.10,p.path.length-.15);p.direction=p.s>.5?-1:1;p.wait=p.plan.pause||5;}
   if(clip!==a.clip){a.oldClip=a.clip;a.clip=clip;a.blend=0;}a.lifeMoving=clip==='Walk'||clip==='Carry';p.state=p.wait>0?'停留':p.plan.mode==='porter'?(p.cargo?'搬货':'返回货埠'):'步行';
  }
 }
 personDynamicClear(a,pos,old){return !this.trafficBlockers.some(b=>{if(Math.abs(b.z-pos[2])>=1)return false;const cs=Math.cos(b.angle),sn=Math.sin(b.angle);const depth=p=>{const x=p[0]-b.x,y=p[1]-b.y,lx=x*cs+y*sn,ly=-x*sn+y*cs;return a.radius+.035-Math.hypot(Math.max(0,Math.abs(lx)-b.hx),Math.max(0,Math.abs(ly)-b.hy));};const d=depth(pos);return d>0&&d>=depth(old)-1e-5;});}
 snapshot(){return {time:+this.time.toFixed(3),stats:{...this.stats},boats:this.boats.map(b=>({id:b.id,p:[...b.p],heading:b.heading,speed:b.speedNow,state:b.state,dock:b.dock,cargo:b.cargo,s:b.s})),convoys:this.convoys.map(v=>({id:v.id,p:[...v.p],cart:[...v.cartP],s:v.s,speed:v.speedNow,state:v.state,cargo:v.cargo})),people:this.people.map(p=>({name:p.plan.name,p:[...p.actor.p],route:p.plan.route,state:p.state,cargo:p.cargo})),stock:{total:this.totalStock(),initial:this.initialStock,shop:this.shopStock,consumed:this.consumed},docks:this.docks.map(d=>({id:d.id,name:d.name,inventory:d.inventory,warehouse:d.warehouse,occupant:d.occupant})),events:[...this.events]};}
}
/** Apply one shared Z-up transform to a vessel and every crew/passenger member. */
function lifeModelMatrix(p,heading,scale=[1,1,1],pitch=0,roll=0){const c=Math.cos(heading),s=Math.sin(heading),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll); // local X is forward for vessels
 const x=[c*cp,s*cp,sp],y=[-s*cr-c*sp*sr,c*cr-s*sp*sr,cp*sr],z=[s*sr-c*sp*cr,-c*sr-s*sp*cr,cp*cr];return new Float32Array([x[0]*scale[0],x[2]*scale[0],-x[1]*scale[0],0,y[0]*scale[1],y[2]*scale[1],-y[1]*scale[1],0,z[0]*scale[2],z[2]*scale[2],-z[1]*scale[2],0,p[0],p[2],-p[1],1]);}


// life-binding.js


/** One transform authority for hull, passengers and all parts; explicit instanced
 * animation parameters for sculling oars, articulated quadrupeds and rolling wheels. */
class LifeBinding {
 constructor(engine,life){this.engine=engine;this.life=life;this.byName=new Map();for(const a of engine.sourceAssets)for(let i=0;i<a.instances.length;i++)this.byName.set(a.instances[i].name,{a,i,base:a.baseMatrices[i]});this.members=new Map();for(const b of life.boats){const hull=this.byName.get(b.name);if(!hull)throw new Error('Missing vessel mesh '+b.name);b.binding=hull;const inv=invert(hull.base),members=[];for(const a of engine.sourceAssets)for(let i=0;i<a.instances.length;i++){const mo=a.instances[i].motion;if(mo?.kind==='boat'&&mo.group===b.id)members.push({a,i,offset:multiply(inv,a.baseMatrices[i]),hull:a.instances[i].name===b.name});}this.members.set(b.id,members);}
 this.cranes=life.docks.map(d=>{const entry=[...this.byName.values()].find(b=>b.a.name==='Timber_dock_with_crane'&&Math.abs(b.base[12]-d.x)<.1&&Math.sign(-b.base[14])===d.side);return {dock:d,binding:entry};});
 this.data=new Float32Array(64*8);this.texture=new THREE.DataTexture(this.data,2,64,THREE.RGBAFormat,THREE.FloatType);this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;this.texture.needsUpdate=true;
 }

 wave(x,y,t){return this.engine.river?.sampleHeight(x,y,t)||0;}
 put(binding,m,id){binding.a.matrices[binding.i].set(m);binding.a.matrices[binding.i][15]=id===null?1:-id-1;const c=transform(m,binding.a.center);binding.a.centers[binding.i].set?.(c);if(!binding.a.centers[binding.i].set)binding.a.centers[binding.i]=c;}
 apply(){const t=this.life.time;
  for(const [index,b]of this.life.boats.entries()){const cs=Math.cos(b.heading),sn=Math.sin(b.heading),x=b.p[0],y=b.p[1],h=this.wave(x,y,t),pitch=(this.wave(x+cs*2,y+sn*2,t)-this.wave(x-cs*2,y-sn*2,t))/4,roll=(this.wave(x-sn,y+cs,t)-this.wave(x+sn,y-cs,t))*.5;const mat=lifeModelMatrix([x,y,.28+h],b.heading,[1,1,1],pitch,roll);for(const member of this.members.get(b.id)){const m=multiply(mat,member.offset);this.put({a:member.a,i:member.i},m,member.hull?index:null);}this.data.set([b.wakeDistance,b.speedNow,t,b.phase,b.length*.5,b.beam*.5,b.remaining,b.cargo],index*8);}
  for(const v of this.life.convoys){const animal=this.byName.get(v.animal),cart=this.byName.get(v.cart);const sc=[Math.hypot(...animal.base.slice(0,3)),Math.hypot(...animal.base.slice(4,7)),Math.hypot(...animal.base.slice(8,11))];this.put(animal,lifeModelMatrix(v.p,v.heading,sc,0,-v.pitch),16+v.id);this.put(cart,lifeModelMatrix(v.cartP,v.cartHeading,[1,1,1],0,-v.cartPitch),32+v.id);this.data.set([v.distance,v.speedNow,t,v.id*.73,0,0,0,0],(16+v.id)*8);this.data.set([v.distance,v.speedNow,t,v.id*.73,0,0,0,v.cargo],(32+v.id)*8);}
  for(let i=0;i<this.cranes.length;i++){const c=this.cranes[i];if(!c.binding)continue;this.put(c.binding,c.binding.base,48+i);const boat=this.life.boats.find(b=>b.id===c.dock.occupant);this.data.set([boat?1-boat.remaining/boat.dwell:0,boat?1:0,t,0,0,0,0,0],(48+i)*8);}
  this.texture.needsUpdate=true;
 }
 dispose(){this.texture.dispose();}
}


export { V,multiply,identity,invert,transform,Z_TO_Y,world,mix,CollisionWorld,Walker,CrowdSystem,CityEcology,LifeBinding,ArcPath,lifeOBBOverlap,lifeBoatHull };
