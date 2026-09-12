import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {english} from '../src/english.js';
const han=/\p{Script=Han}/u;
for(const file of ['navigation','ecology']){
 const data=JSON.parse(await readFile(new URL(`../public/runtime/${file}.json`,import.meta.url)));
 const visit=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,entry]of Object.entries(value)){
   if(['name','label'].includes(key)&&typeof entry==='string')assert(!han.test(english(entry)),entry);
   visit(entry);
  }
 };
 visit(data);
}
assert.equal(english('北岸西货埠卸下 8 份货物'),'Northwest Quay unloaded 8 units of cargo');
assert.equal(english('香铺营业厅'),'Incense Shop · Main room');
assert.equal(english('推开入户门'),'Opened front door');
assert.equal(english('靠泊装卸'),'Loading / unloading');
assert.equal(english('Cargo_barge'),'Cargo Barge');
assert.equal(english('vessel-11'),'vessel-11','stable IDs are preserved');
console.log('English locations, room/door labels, routes, vessel states and events passed.');
