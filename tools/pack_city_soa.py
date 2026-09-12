#!/usr/bin/env python3
"""Derive chunked SoA city geometry (public/runtime/city.soa.bin.gz) from the interleaved runtime blob.

Reads the layout from public/runtime/city.json, vector-repacks every vertex
attribute into its own aligned block, self-verifies by round-trip sampling
against the interleaved source, then atomically publishes:
  - public/runtime/city.soa.bin.gz   (gzip level 6, deterministic mtime)
  - public/runtime/city.json         (adds a top-level `geometry` descriptor)
  - production/soa-manifest.json     (source/derived hashes + block table)
The source city.bin.gz / city.json fields are never modified. Runs standalone
(no Blender required); tools/build_assets.py invokes it at the end of a build.
"""
import gzip,hashlib,json,os,sys
from datetime import datetime,timezone
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
CITY_JSON=ROOT/'public/runtime/city.json';CITY_GZ=ROOT/'public/runtime/city.bin.gz'
DERIVED_GZ=ROOT/'public/runtime/city.soa.bin.gz';SOA_MANIFEST=ROOT/'production/soa-manifest.json'
TYPE_SIZE={'float32':4,'uint32':4,'int16':2,'uint16':2,'uint8':1}
# name -> (json type, numpy dtype, components, normalized, interleaved field). Order is the on-disk block order.
BLOCK_SPECS=[('position','float32','<f4',3,False,'p'),('normal','int16','<i2',3,True,'n'),
 ('uv','float32','<f4',2,False,'uv'),('color','uint8','u1',4,True,'color'),
 ('joints','uint16','<u2',4,False,'joints'),('weights','uint8','u1',4,True,'weights'),
 ('region','float32','<f4',1,False,'tag')]
INTERLEAVED=np.dtype({'names':['p','n','tag','uv','color','joints','weights'],
 'formats':[('<f4',3),('<i2',3),'<i2',('<f4',2),('u1',4),('<u2',4),('u1',4)],
 'offsets':[0,12,18,20,28,32,40],'itemsize':44})

def sha(b):return hashlib.sha256(b).hexdigest()
def atomic_write(path,data):
	tmp=path.parent/(path.name+'.tmp');tmp.write_bytes(data);os.replace(tmp,path)

def fail(msg):print(f'pack_city_soa: FAIL {msg}',file=sys.stderr);sys.exit(1)

def build_blocks(raw,m):
	"""Pack the interleaved source into one SoA buffer; returns (derived, blocks, index_desc)."""
	n=m['vertexCount'];verts=np.ndarray(n,dtype=INTERLEAVED,buffer=raw)
	layout=[];off=0
	for name,jt,dt,comps,norm,field in BLOCK_SPECS:
		es=TYPE_SIZE[jt];off=(off+es-1)//es*es;size=n*comps*es
		layout.append({'name':name,'type':jt,'dtype':np.dtype(dt),'components':comps,'normalized':norm,'field':field,'offset':off,'size':size});off+=size
	ioff=(off+3)//4*4;isize=m['indexCount']*4
	derived=np.zeros(ioff+isize,dtype=np.uint8)
	for b in layout:
		view=derived[b['offset']:b['offset']+b['size']].view(b['dtype'])
		dst=view if b['components']==1 else view.reshape(n,b['components'])
		src=verts[b['field']]
		if b['name']=='region':src=src.astype('<f4')  # runtime keeps qmRegion as Float32
		dst[:]=src  # strided vectorized copy, no per-vertex Python loop
	derived[ioff:ioff+isize].view('<u4')[:]=np.frombuffer(raw,dtype='<u4',count=m['indexCount'],offset=m['indexByteOffset'])
	blocks={b['name']:{'type':b['type'],'components':b['components'],'normalized':b['normalized'],'offset':b['offset'],'count':n} for b in layout}
	index={'type':'uint32','offset':ioff,'count':m['indexCount']}
	return derived,verts,blocks,index,layout

def self_verify(derived,verts,blocks,index,layout,m):
	"""Round-trip every attribute on 4096 random vertices, the index on 1M head + 1M random entries, and all block boundaries."""
	n=m['vertexCount'];rng=np.random.default_rng(20260911);sample=rng.choice(n,size=4096,replace=False)
	for b in layout:
		view=derived[b['offset']:b['offset']+b['size']].view(b['dtype'])
		got=(view if b['components']==1 else view.reshape(n,b['components']))[sample]
		want=verts[b['field']][sample]
		if b['name']=='region':want=want.astype('<f4')
		if not np.array_equal(got,want):fail(f"block {b['name']} round-trip mismatch on sampled vertices")
	idx=derived[index['offset']:index['offset']+index['count']*4].view('<u4')
	src=np.frombuffer(verts.base,dtype='<u4',count=m['indexCount'],offset=m['indexByteOffset'])
	if not np.array_equal(idx[:min(1_000_000,len(idx))],src[:min(1_000_000,len(src))]):fail('index block mismatch on first 1,000,000 entries')
	rnd=rng.integers(0,m['indexCount'],size=1_000_000)
	if not np.array_equal(idx[rnd],src[rnd]):fail('index block mismatch on 1,000,000 random entries')
	cursor=0  # boundary description: alignment, ordering, zero padding, exact end.
	for b in layout:
		if b['offset']%TYPE_SIZE[b['type']]:fail(f"block {b['name']} offset {b['offset']} not aligned to {TYPE_SIZE[b['type']]}")
		if b['offset']<cursor:fail(f"block {b['name']} overlaps the previous block")
		if derived[cursor:b['offset']].any():fail(f"padding before {b['name']} is not zero")
		if b['offset']+b['size']>index['offset']:fail(f"block {b['name']} exceeds the vertex region")
		if blocks[b['name']]['count']!=n:fail(f"block {b['name']} count != vertexCount")
		cursor=b['offset']+b['size']
	if index['offset']%4:fail('index offset not 4-byte aligned')
	if index['offset']<cursor:fail('index block overlaps the last vertex block')
	if index['offset']+index['count']*4!=len(derived):fail('index block does not end exactly at derived byteLength')
	return len(sample),min(1_000_000,m['indexCount']),len(rnd)

def main():
	m=json.loads(CITY_JSON.read_text())
	if m['vertexStride']*m['vertexCount']!=m['indexByteOffset'] or m['indexByteOffset']+m['indexCount']*4!=m['byteLength']:
		fail('city.json layout is inconsistent with vertexStride/vertexCount/indexByteOffset/byteLength')
	if m['vertexStride']!=INTERLEAVED.itemsize:fail(f"unsupported vertexStride {m['vertexStride']}")
	gz=CITY_GZ.read_bytes();source_gz=sha(gz);raw=gzip.decompress(gz);del gz
	if len(raw)!=m['byteLength']:fail(f"decompressed length {len(raw)} != city.json byteLength {m['byteLength']}")
	source_bytes=sha(raw)
	derived,verts,blocks,index,layout=build_blocks(raw,m)
	ns,ni,nr=self_verify(derived,verts,blocks,index,layout,m)
	derived_bytes=sha(memoryview(derived));total=len(derived)
	tmp=DERIVED_GZ.parent/(DERIVED_GZ.name+'.tmp')
	with open(tmp,'wb') as f:
		with gzip.GzipFile(filename='',mode='wb',fileobj=f,compresslevel=6,mtime=0) as out:out.write(memoryview(derived))
	tmp_bytes=tmp.read_bytes();back=gzip.decompress(tmp_bytes)
	if len(back)!=total or sha(back)!=derived_bytes:
		tmp.unlink(missing_ok=True);fail('temporary gzip did not round-trip to the derived buffer')
	del back
	derived_gz=sha(tmp_bytes);del tmp_bytes;os.replace(tmp,DERIVED_GZ)
	geometry={'format':'soa-v1','file':'city.soa.bin.gz','byteLength':total,'blocks':blocks,'index':index}
	original=CITY_JSON.read_bytes()  # memory backup; rolled back if the atomic replace fails
	try:atomic_write(CITY_JSON,json.dumps({**m,'geometry':geometry},ensure_ascii=False,separators=(',',':')).encode())
	except Exception:
		atomic_write(CITY_JSON,original);DERIVED_GZ.unlink(missing_ok=True);raise
	manifest={'sourceGzSha256':source_gz,'sourceBytesSha256':source_bytes,'derivedGzSha256':derived_gz,
	 'derivedBytesSha256':derived_bytes,'derivedLength':total,'generated':datetime.now(timezone.utc).isoformat(),
	 'generator':'tools/pack_city_soa.py','blocks':blocks}
	atomic_write(SOA_MANIFEST,json.dumps(manifest,ensure_ascii=False,indent=2).encode())
	if sha(CITY_GZ.read_bytes())!=source_gz:fail('source city.bin.gz changed during packing')
	print(f'SoA city packed: {DERIVED_GZ.name} = {DERIVED_GZ.stat().st_size:,} B gzip, {total:,} B decompressed')
	for b in layout:print(f"  {b['name']:>8} offset {b['offset']:>12,}  {b['type']:>7} x{b['components']}  {b['size']:>12,} B{' normalized' if b['normalized'] else ''}")
	print(f"     index offset {index['offset']:>12,}  uint32     {index['count']*4:>12,} B  count {index['count']:,}")
	print(f'self-check: {ns} sampled vertices round-tripped all 7 attributes; index verified on {ni:,} head + {nr:,} random entries; boundaries aligned')
	print(f'source city.bin.gz sha256 {source_gz} (unchanged)')

if __name__=='__main__':main()
