import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),base=`http://127.0.0.1:${process.env.PORT||4193}`;
const read=p=>readFile(new URL(p,root));
const manifest=JSON.parse(await read('production/asset-manifest.json'));
const city=JSON.parse(await read('public/runtime/city.json'));
for(const image of city.images)assert((await stat(new URL('public/runtime/'+image,root))).size>0);
for(const [name,hash] of Object.entries(manifest.outputs)){
 const data=await read('assets/'+name);assert.equal(createHash('sha256').update(data).digest('hex'),hash,name+' integrity');
 assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(8),data.length);
 const gltf=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
 assert(gltf.meshes.length&&gltf.nodes.length);assert((gltf.images||[]).every(i=>i.bufferView!==undefined),'textures must be embedded');
 for(const node of gltf.nodes)if(node.extras?.source_mesh!==undefined)for(const p of gltf.meshes[node.mesh].primitives)assert(p.attributes.COLOR_0!==undefined,'recovered vertex colors must survive export');
 const response=await fetch(base+'/assets/'+name,{method:'HEAD'});assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),data.length);
}
for(const name of ['Qingming_Master','Qingming_Vessels','Qingming_Full_Scene','Qingming_LOD']){const data=await read('production/'+name+'.blend');assert(data.length>1024&&(data.toString('ascii',0,7)==='BLENDER'||data.readUInt32LE(0)===0xfd2fb528),'native Blender or Zstandard-compressed Blender file');}
// LODs must retain UV/color channels and valid finite geometry from the same source.
const glb=data=>JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
const detailBytes=await read('assets/Qingming_Details.glb'),details=glb(detailBytes),lodBytes=await read('assets/Qingming_LOD.glb'),lod=glb(lodBytes);
const lodReport=JSON.parse(await read('production/lod-manifest.json'));
assert.equal(lodReport.sourceSha256,createHash('sha256').update(detailBytes).digest('hex'));
const sourceMeshes=new Map(details.meshes.map(m=>[m.name,m]));
for(const node of lod.nodes){
 const source=sourceMeshes.get(node.extras.sourceMesh),primitive=lod.meshes[node.mesh].primitives[0];assert(source,'LOD source exists');
 assert(Number.isFinite(node.extras.surfaceError)&&node.extras.surfaceError>=0,'measured surface error');
 for(const key of ['NORMAL','TEXCOORD_0','COLOR_0'])if(source.primitives[0].attributes[key]!==undefined)assert(primitive.attributes[key]!==undefined,'preserve '+key);
 const positions=lod.accessors[primitive.attributes.POSITION];assert([...positions.min,...positions.max].every(Number.isFinite));
 assert(lod.accessors[primitive.indices].count<=source.primitives.reduce((n,p)=>n+details.accessors[p.indices].count,0),'LOD reduces triangles');
}
assert.match(await (await fetch(base)).text(),/Qingming Riverside/);
assert.equal((await fetch(base+'/capture/walkthrough.webm',{method:'POST',body:'bad'})).status,403);
assert.equal((await fetch(base+'/capture/walkthrough.webm',{method:'POST',headers:{Origin:base},body:'bad'})).status,400);
assert.equal((await fetch(base+'/..%2F..%2FREADME.md')).status,403);
assert.equal((await fetch(base+'/missing-resource.glb')).status,404);
// The derived SoA city chunks must exist, match their manifest hashes and keep every block boundary-safe.
const soa=city.geometry,soaManifest=JSON.parse(await read('production/soa-manifest.json'));
assert(soa,'city.json carries a geometry descriptor');assert.equal(soa.format,'soa-v1','geometry format is soa-v1');assert.equal(soa.file,'city.soa.bin.gz');
assert.equal(createHash('sha256').update(await read('public/runtime/city.soa.bin.gz')).digest('hex'),soaManifest.derivedGzSha256,'city.soa.bin.gz sha256 matches soa-manifest.derivedGzSha256');
assert.equal(createHash('sha256').update(await read('public/runtime/city.bin.gz')).digest('hex'),soaManifest.sourceGzSha256,'legacy city.bin.gz sha256 matches soa-manifest.sourceGzSha256');
const ELEM={float32:4,uint32:4,int16:2,uint16:2,uint8:1},ORDER=['position','normal','uv','color','joints','weights','region'];
assert.deepEqual(Object.keys(soa.blocks),ORDER,'blocks are described in the on-disk SoA order');
let cursor=0;
for(const name of ORDER){
 const b=soa.blocks[name],elem=ELEM[b.type];
 assert.equal(b.offset%elem,0,name+' offset aligned to its element size');
 assert(b.offset>=cursor,name+' starts at or after the end of the previous block');
 assert.equal(b.count,city.vertexCount,name+' count covers every vertex');
 assert.equal(b.offset+b.count*b.components*elem<=soa.byteLength,true,name+' stays inside the derived buffer');
 cursor=b.offset+b.count*b.components*elem;
}
assert.equal(soa.index.type,'uint32');assert.equal(soa.index.offset%4,0,'index offset 4-byte aligned');
assert(soa.index.offset>=cursor,'index block starts after the last vertex block');
assert.equal(soa.index.count,city.indexCount,'index count covers every index');
assert.equal(soa.index.offset+soa.index.count*4,soa.byteLength,'index block ends exactly at geometry.byteLength');
assert.equal(soaManifest.derivedLength,soa.byteLength,'manifest derivedLength matches geometry.byteLength');
assert.deepEqual(soaManifest.blocks,soa.blocks,'manifest blocks mirror the city.json geometry blocks');
console.log(JSON.stringify({status:'passed',assetHashes:Object.keys(manifest.outputs).length,localTextures:city.images.length,embeddedVertexColors:true,blenderSources:4,soaGeometry:'soa-v1 verified against manifest',launcher:'START.command',http:'local resources, origin, invalid capture, traversal and missing file checked'},null,2));
