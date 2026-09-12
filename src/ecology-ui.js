import {english} from './english.js';
/** Live route inspection: the map reads the same paths/positions that drive geometry. */
export class EcologyUI {
 constructor(engine,hooks){this.engine=engine;this.hooks=hooks;this.follow=null;this.last=0;this.canvas=document.querySelector('#traffic-map');this.ctx=this.canvas.getContext('2d');const by=id=>document.getElementById(id);
  for(const b of engine.life.boats){const op=document.createElement('option');op.value=b.id;op.textContent=`${String(b.id+1).padStart(2,'0')} · ${english(b.type)}`;by('follow-vessel').appendChild(op);}by('follow-vessel').value='11';
  by('follow-boat').onclick=()=>this.startFollow('boat',+by('follow-vessel').value);by('follow-cart').onclick=()=>this.startFollow('cart',1);by('stop-follow').onclick=()=>this.stopFollow();by('map-button').onclick=()=>by('ecosystem-panel').classList.toggle('open');by('map-close').onclick=()=>by('ecosystem-panel').classList.remove('open');by('world-rate').onchange=e=>engine.life.rate=+e.target.value;by('water-strength').oninput=e=>{engine.river.strength=+e.target.value;by('water-strength-value').textContent=(+e.target.value).toFixed(1);};by('water-flow').oninput=e=>{engine.river.flow=+e.target.value;by('water-flow-value').textContent=(+e.target.value).toFixed(2)+' m/s';};by('wake-debug').onchange=e=>engine.river.debug=e.target.checked?1:0;by('routes-3d').onchange=e=>engine.showRoutes=e.target.checked;this.renderMap();
 }
 startFollow(type,id){this.follow={type,id};this.hooks.onFollow();document.getElementById('follow-status').textContent=type==='boat'?'Following a boat · Drag to take control':'Following a convoy · Drag to take control';this.updateCamera(1,true);}
 stopFollow(){this.follow=null;document.getElementById('follow-status').textContent='Routes and activity update live.';}
 updateCamera(dt,snap=false){if(!this.follow)return;const f=this.follow,obj=f.type==='boat'?this.engine.life.boats.find(b=>b.id===f.id):this.engine.life.convoys.find(c=>c.id===f.id);if(!obj)return;let forward=f.type==='boat'?[Math.cos(obj.heading),Math.sin(obj.heading)]:[Math.sin(obj.heading),-Math.cos(obj.heading)],p=obj.p;
  const isBoat=f.type==='boat',dist=isBoat?Math.max(8.5,obj.length*1.18):8.5;
  // Keep the follower inside the river/road corridor. A fixed "right side"
  // camera used to pass straight through dock cranes and shop awnings.
  let side=isBoat?5.0:2.4;
  if(isBoat){const candidates=[-side,side].map(s=>{const x=p[0]-forward[0]*dist+forward[1]*s,y=p[1]-forward[1]*dist-forward[0]*s;return {s,d:Math.abs(y-3.4*Math.sin(x/72.))};});side=candidates.sort((a,b)=>a.d-b.d)[0].s;}
  const eye=[p[0]-forward[0]*dist+forward[1]*side,p[1]-forward[1]*dist-forward[0]*side,p[2]+(isBoat?4.3:4.5)];
  if(isBoat){const centre=3.4*Math.sin(eye[0]/72.);eye[1]=Math.max(centre-9.0,Math.min(centre+9.0,eye[1]));}else if(eye[1]>-42&&eye[1]<96){eye[0]=Math.max(-3.4,Math.min(3.4,eye[0]));}
  const target=[p[0]+forward[0]*1.0,p[1]+forward[1]*1.0,p[2]+.8];this.hooks.followCamera(eye,target,snap?1:1-Math.exp(-dt*2.7),54);
 }
 update(dt){this.updateCamera(dt);const now=performance.now();if(now-this.last<350)return;this.last=now;const l=this.engine.life,active=l.boats.filter(b=>b.speedNow>.04).length,carts=l.convoys.filter(c=>c.speedNow>.03).length,moving=l.people.filter(p=>p.speedNow>.05).length,sec=Math.floor(l.time),min=Math.floor(sec/60);document.getElementById('life-clock').textContent=`${String(min).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;document.getElementById('life-summary').textContent=`${active}/12 boats under way · ${carts}/9 convoys moving · ${moving} people walking`;
  document.getElementById('life-ledger').textContent=`Unloaded: ${l.stats.transferred} · Warehoused: ${l.docks.reduce((s,d)=>s+d.delivered,0)} · Delivered: ${l.stats.delivered}`;document.getElementById('dock-status').innerHTML=l.docks.map(d=>`<div><span>${english(d.name)}</span><span>${d.occupant!==null?'Loading':d.reserved!==null?'Reserved':'Available'} · Cargo: ${d.inventory}</span></div>`).join('');document.getElementById('traffic-events').innerHTML=l.events.slice(0,4).map(e=>`<div><time>${Math.floor(e.time/60)}:${String(Math.floor(e.time%60)).padStart(2,'0')}</time> ${english(e.text)}</div>`).join('')||'<div>Berthing, warehouse deliveries and market arrivals appear here.</div>';
  if(this.follow?.type==='boat'){const b=l.boats.find(b=>b.id===this.follow.id);document.getElementById('follow-status').textContent=`Boat ${b.id+1} · ${english(b.state)} · ${b.speedNow.toFixed(2)} m/s`;}if(document.getElementById('ecosystem-panel').classList.contains('open'))this.renderMap();
 }
 renderMap(){const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,l=this.engine.life;const xy=p=>[(p[0]+148)/296*w,h-(p[1]+70)/194*h];ctx.fillStyle='#e9e1cc';ctx.fillRect(0,0,w,h);ctx.fillStyle='#a9c3bb';ctx.beginPath();for(let x=-150;x<=150;x+=2){let p=xy([x,3.4*Math.sin(x/72)+14.5]);if(x===-150)ctx.moveTo(...p);else ctx.lineTo(...p);}for(let x=150;x>=-150;x-=2)ctx.lineTo(...xy([x,3.4*Math.sin(x/72)-14.5]));ctx.closePath();ctx.fill();
  ctx.fillStyle='#b1a58a';for(const r of this.engine.navigation.rooms){if(r.y<-70||r.y>125)continue;const p=xy([r.x,r.y]);ctx.fillRect(p[0]-r.hx/296*w,p[1]-r.hy/194*h,r.hx*2/296*w,r.hy*2/194*h);}
  const drawn=new Set();for(const route of l.config.routes){const key=route.kind==='boat'?(route.id==='vessel-0'?'boat-main':route.id==='vessel-1'?'boat-east':null):route.id;if(!key||drawn.has(key))continue;drawn.add(key);ctx.strokeStyle=route.kind==='boat'?'#2b7d85':route.kind==='caravan'?'#a46533':route.kind==='porter'?'#aa774d':'#707b60';ctx.lineWidth=route.kind==='boat'?1.4:.8;ctx.beginPath();route.points.forEach((p,i)=>i?ctx.lineTo(...xy(p)):ctx.moveTo(...xy(p)));if(route.closed)ctx.closePath();ctx.stroke();}
  for(const d of l.docks){const p=xy(d.depot);ctx.fillStyle=d.occupant===null?'#765d40':'#c77638';ctx.fillRect(p[0]-3,p[1]-3,6,6);}
  ctx.fillStyle='#6b7653';for(const p of l.people){const q=xy(p.actor.p);ctx.fillRect(q[0]-.75,q[1]-.75,1.5,1.5);}
  for(const b of l.boats){const p=xy(b.p);ctx.save();ctx.translate(...p);ctx.rotate(-b.heading);ctx.fillStyle=this.follow?.type==='boat'&&this.follow.id===b.id?'#bc4b2d':'#1f6670';ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(-3,-2);ctx.lineTo(-2,2);ctx.closePath();ctx.fill();ctx.restore();}
  for(const v of l.convoys){const p=xy(v.p);ctx.fillStyle='#9f5730';ctx.fillRect(p[0]-2,p[1]-2,4,4);}ctx.fillStyle='#544b39';ctx.font='12px sans-serif';ctx.fillText('N ↑',w-45,17);ctx.fillText('Hongqiao',w/2+5,h-(0+70)/194*h-7);
 }
}

