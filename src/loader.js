export async function loadCity(progress=()=>{}){
  const manifestResponse=await fetch('./public/runtime/city.json');
  if(!manifestResponse.ok)throw new Error('Could not load the scene manifest. Start the local server first.');
  const manifest=await manifestResponse.json();progress(.04,'Reading city instances and materials');
  // Normal browsing downloads only the derived SoA file (shared typed-array
  // views, no per-vertex unpack); the original interleaved file stays available
  // for author tools and the A/B comparison oracle.
  const soa=manifest.geometry&&manifest.geometry.format==='soa-v1';
  const files=soa&&manifest.geometry.parts||[soa?manifest.geometry.file:'city.bin.gz'];
  const chunks=[];let received=0,total=manifest.geometry?.compressedByteLength||0;
  for(const file of files){
    const response=await fetch('./public/runtime/'+file);if(!response.ok)throw new Error('Could not load city geometry: '+file);
    if(!total)total=+response.headers.get('Content-Length')||(soa?102873728:29594434);
    const reader=response.body.getReader();for(;;){const {value,done}=await reader.read();if(done)break;chunks.push(value);received+=value.length;progress(.04+.56*Math.min(1,received/total),'Loading geometry · '+(received/1048576).toFixed(1)+' MB');}
  }
  if(!('DecompressionStream' in globalThis))throw new Error('This browser cannot decompress the assets. Use a recent Chrome, Edge, Safari or Firefox release.');
  const bin=await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(bin.byteLength!==(soa?manifest.geometry.byteLength:manifest.byteLength))throw new Error('Geometry length check failed');
  progress(.67,'Unpacking roofs, timber and market geometry');
  const images=await Promise.all(manifest.images.map(async(url)=>{let r=await fetch('./public/runtime/'+url);if(!r.ok)throw new Error('Could not load texture: '+url);return createImageBitmap(await r.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none',imageOrientation:'none'});}));
  progress(.81,'Uploading textures and instances to the GPU');
  const [navigation,rigs,ecology]=await Promise.all(['navigation.json','rigs.json','ecology.json'].map(async name=>{const r=await fetch('./public/runtime/'+name);if(!r.ok)throw new Error('Missing runtime data: '+name);return r.json();}));
  return soa?{manifest,soaBuffer:bin,images,navigation,rigs,ecology}:{manifest,bin,images,navigation,rigs,ecology};
}

