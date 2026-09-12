import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadCity} from '../src/loader.js';
const bytes=Buffer.from('Qingming geometry'),gzip=gzipSync(bytes),originalFetch=globalThis.fetch;
let parts=['first.part','second.part'];
const manifest=()=>({geometry:{format:'soa-v1',file:'city.soa.bin.gz',parts,byteLength:bytes.length,compressedByteLength:gzip.length},images:[]});
try{
 globalThis.fetch=async url=>{
  const name=url.split('/').pop();
  if(name==='city.json')return Response.json(manifest());
  if(name==='city.soa.bin.gz')return new Response(gzip);
  if(name==='first.part')return new Response(gzip.subarray(0,7));
  if(name==='second.part')return new Response(gzip.subarray(7));
  if(name==='missing.part')return new Response('',{status:404});
  return Response.json({});
 };
 assert.deepEqual(Buffer.from((await loadCity()).soaBuffer),bytes,'parts reassemble the original gzip');
 parts=undefined;assert.deepEqual(Buffer.from((await loadCity()).soaBuffer),bytes,'local single-file loading remains supported');
 parts=['first.part','missing.part'];await assert.rejects(loadCity(),/Could not load city geometry: missing.part/);
 console.log('Web geometry: split, local single-file and missing-part checks passed.');
}finally{globalThis.fetch=originalFetch;}
