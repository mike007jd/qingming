import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=await mkdtemp(path.join(tmpdir(),'qingming-capture-'));
let server;
try {
 await cp(new URL('../server.mjs',import.meta.url),path.join(root,'server.mjs'));
 server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']});
 const [message]=await once(server.stdout,'data');
 const base=String(message).trim().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9eQAAAAASUVORK5CYII=','base64');
 for(const [file,data] of [['view-00-color-4k.png',png],['quality/check.json',Buffer.from('{}')]]){
  const response=await fetch(base+'/capture/'+file,{method:'POST',headers:{Origin:base},body:data});
  assert.equal(response.status,200,'capture creates its output directory');
  assert.deepEqual(await readFile(path.join(root,'evidence',file)),data);
 }
 assert.equal((await fetch(base+'/capture/walkthrough.webm',{method:'POST',headers:{Origin:base},body:'invalid'})).status,400);
 console.log('Capture: fresh output directories, nested reports and invalid media passed.');
} finally {
 if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
 await rm(root,{recursive:true,force:true});
}
