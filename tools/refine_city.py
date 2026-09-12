"""Apply bounded residential setbacks and roof heights to the preserved live data.
Doors, collision instances and any indoor activity anchors follow the same transform.
"""
from pathlib import Path
import json,math,random
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'production/inputs/runtime-1.3'
m=json.loads((source/'city.json').read_text());nav=json.loads((source/'navigation.json').read_text());eco=json.loads((source/'ecology.json').read_text());rng=random.Random(260911)
def point(a,p):return [sum(a[k*4+j]*p[k] for k in range(3))+a[12+j] for j in range(3)]
def mul(a,b):return [sum(a[k*4+j]*b[i*4+k] for k in range(4)) for i in range(4) for j in range(4)]
changes={}
for a in m['assets']:
 if not a['name'].startswith('House_'):continue
 for ins in a['instances']:
  if not ins['name'].startswith(('North_plot','South_plot','House_')):continue
  old=ins['matrix'];yaw=rng.uniform(-.052,.052);xy=rng.uniform(.94,1.0);z=rng.uniform(.84,1.16);c=math.cos(yaw)*xy;s=math.sin(yaw)*xy
  delta=[c,s,0,0,-s,c,0,0,0,0,z,0,0,0,0,1];origin=old[12:15];mapped=point(delta,origin)
  delta[12:15]=[origin[0]-mapped[0]+rng.uniform(-.35,.35),origin[1]-mapped[1]+rng.uniform(-.45,.45),origin[2]-mapped[2]]
  changes[ins['name']]={'delta':delta,'yaw':yaw,'xy':xy,'z':z,'old':old[:],'bounds':a['bounds']};ins['matrix']=mul(delta,old)
for a in m['assets']:
 if not a['name'].startswith('Door_'):continue
 for ins in a['instances']:
  change=changes.get(ins['name'].rsplit('_door_',1)[0])
  if not change:continue
  ins['matrix']=mul(change['delta'],ins['matrix']);moti=ins['motion'];moti['hinge']=point(change['delta'],moti['hinge']);moti['baseAngle']+=change['yaw']
for ins in nav['instances']:
 if ins['name']in changes:ins['matrix']=mul(changes[ins['name']]['delta'],ins['matrix'])
def inside(p,ch):
 o=ch['old'];dx=p[0]-o[12];dy=p[1]-o[13];sc=math.hypot(o[0],o[1]);x=(dx*o[0]+dy*o[1])/sc**2;y=(dx*o[4]+dy*o[5])/sc**2;b=ch['bounds'];return b[0][0]+.9<x<b[1][0]-.9 and b[0][1]+.9<y<b[1][1]-.9 and o[14]-.1<p[2]<o[14]+b[1][2]
anchors=0
actor_changes={}
for citizen in eco['citizens']:
 p=citizen.get('anchor')
 if not p:continue
 for ch in changes.values():
  if inside(p,ch):citizen['anchor']=point(ch['delta'],p);actor_changes[citizen['name']]=ch['delta'];anchors+=1;break
for route in eco['routes']:
 for i,p in enumerate(route['points']):
  if len(p)<3:continue
  for ch in changes.values():
   if inside(p,ch):route['points'][i]=point(ch['delta'],p);break
for asset in m['assets']:
 for ins in asset['instances']:
  if ins['name'] in actor_changes:ins['matrix']=mul(actor_changes[ins['name']],ins['matrix'])
# The added trunks and tables participate in the same collision world as the inherited city.
nav['prefabs']['Final_willow']={'boxes':[[0,0,1.5,.60,.60,3.,0,'tree_trunk']]}
for side in [-1,1]:
 for x in [-112,-92,-57,-12,19,45,87,110]:
  nav['instances'].append({'name':f'Final_willow_{side}_{x}','prefab':'Final_willow','matrix':[1,0,0,0,0,1,0,0,0,0,1,0,x,3.4*math.sin(x/72)+side*21.5,2.2,1]})
for asset in m['assets']:
 if not asset['name'].startswith('Shop_'):continue
 spec=nav['prefabs'].get(asset['name']);w=(asset['bounds'][1][0]-.6)*2;front=asset['bounds'][0][1]+1.
 if spec:
  for x in [-w*.32,w*.32]:spec['boxes'].append([x,front-.12,.51,1.5,.72,.79,0,'trade_worktable'])
yard=nav['prefabs'].get('Courtyard_walls_gate_well_and_household_props')
if yard:
 yard['boxes'].append([-4.9,-3.8,.27,1.2,.7,.54,0,'tea_table'])
 for y in [-6.4,-5.23,-4.06]:yard['boxes'].append([6.45,y,.25,.60,.60,.5,0,'potted_bamboo'])
 for x in [-6.,-3.6]:yard['boxes'].append([x,-6.6,1.08,.09,.09,2.16,0,'drying_rail'])
for name,data in [('city.json',m),('navigation.json',nav),('ecology.json',eco)]: (ROOT/'public/runtime'/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
(ROOT/'production/layout-changes.json').write_text(json.dumps({'buildings':changes,'indoorActivityAnchors':anchors},ensure_ascii=False,indent=2))
print(f'Refined {len(changes)} residential transforms; {anchors} indoor activity anchors followed.')
