import http from 'node:http';
import {createReadStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {stat,realpath,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('./',import.meta.url));
const port=Number(process.env.PORT||4193);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webm':'video/webm','.glb':'model/gltf-binary','.gz':'application/gzip','.md':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  const capture=/^\/capture\/(view-\d{2}-(?:color|silk|off)-4k\.png|walkthrough\.webm|perfreview-(?:report\.json|before-4k\.png|after-4k\.png)|msaatest-report\.json|quality\/[A-Za-z0-9._-]+\.(?:json|png))$/.exec(new URL(req.url,'http://localhost').pathname);
  if(req.method==='POST'&&capture){
   if(req.headers.origin!==`http://127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>48*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const data=Buffer.concat(chunks),name=capture[1];
   if(name.endsWith('.json')){
    // Perf-review reports must be well-formed UTF-8 JSON before they are kept.
    try{JSON.parse(data.toString('utf8'));}catch{res.writeHead(400);res.end('Invalid capture');return;}
   }else if(data.length<8||(name.endsWith('.png')?!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data.readUInt32BE(0)!==0x1a45dfa3)){res.writeHead(400);res.end('Invalid capture');return;}
   if(capture[1].startsWith('quality/'))await mkdir(path.join(root,'evidence','quality'),{recursive:true});
   await writeFile(path.join(root,'evidence',capture[1]),data);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({path:'evidence/'+capture[1],bytes}));return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name.endsWith('/'))name+='index.html';
  let target=path.resolve(root,'.'+name);
  if(!target.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}
  target=await realpath(target);
  if(!target.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}
  const s=await stat(target);if(!s.isFile())throw new Error('Not a file');
  // Revalidation keeps every reload from re-transferring the ~280 MB payload:
  // unchanged files answer 304, and the large runtime JSONs stream gzipped.
  const etag=`"${s.size.toString(16)}-${BigInt(Math.trunc(s.mtimeMs)).toString(16)}"`;
  if(req.headers['if-none-match']===etag){res.writeHead(304,{'ETag':etag,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end();return;}
  const base={'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','ETag':etag,'X-Content-Type-Options':'nosniff'};
  const gz=/gzip/.test(String(req.headers['accept-encoding']||''))&&path.extname(target)==='.json';
  if(req.method==='HEAD'){res.writeHead(200,{...base,'Content-Length':s.size});res.end();return;}
  if(gz){res.writeHead(200,{...base,'Content-Encoding':'gzip','Vary':'Accept-Encoding'});createReadStream(target).on('error',()=>res.destroy()).pipe(createGzip()).pipe(res);}
  else{res.writeHead(200,{...base,'Content-Length':s.size});createReadStream(target).on('error',()=>res.destroy()).pipe(res);}
 }catch(e){res.writeHead(e.code==='ENOENT'?404:400);res.end('File not found or invalid path');}
}).listen(port,'127.0.0.1',()=>{
 console.log(`Three.js: http://127.0.0.1:${port}/`);

}).on('error',e=>{console.error('Server failed:',e.message);process.exitCode=1;});
