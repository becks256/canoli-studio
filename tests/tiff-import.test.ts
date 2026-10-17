import {describe,it,expect} from 'vitest';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodeTiff} from '../src/core/interchange/tiff/decode';
import {inspectTiff} from '../src/core/interchange/tiff/inspect';
import {tiffDecodeOptionsSchema} from '../src/core/interchange/tiff/types';
import {tiffOrientation} from '../src/engine/tiff-import';

const base='tests/fixtures/tiff/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8')) as {cases:{file:string;reference:string;allowPrecisionLoss:boolean}[]};
describe('TIFF import against independent libtiff/Pillow source pixels',()=>{
 for(const fixture of manifest.cases)it(`decodes ${fixture.file} to exact native RGBA bytes`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'canoli-tiff-reader-'));
  try{const bytes=await readFile(base+fixture.file),decoded=await decodeTiff(new Blob([bytes]),{allowPrecisionLoss:fixture.allowPrecisionLoss}),out=join(directory,'decoded.png');await writeFile(out,new Uint8Array(await decoded.png.arrayBuffer()));
   const checked=spawnSync('python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(int);b=np.asarray(Image.open(sys.argv[2]).convert('RGBA')).astype(int);assert a.shape==b.shape;assert np.array_equal(a,b),(sys.argv[1],int(np.abs(a-b).max()))",out,base+fixture.reference],{encoding:'utf8'});expect(checked.status,checked.stderr).toBe(0);expect(decoded.page.canDecode).toBe(true);expect(bytes).toEqual(await readFile(base+fixture.file));
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('inspects all pages and decodes the explicitly selected page',async()=>{
  const blob=new Blob([await readFile(base+'multipage.tif')]),inspection=await inspectTiff(blob);expect(inspection.report.pages).toHaveLength(3);const first=await decodeTiff(blob),second=await decodeTiff(blob,{page:1});expect(new Uint8Array(await first.png.arrayBuffer())).not.toEqual(new Uint8Array(await second.png.arrayBuffer()));await expect(decodeTiff(blob,{page:3})).rejects.toThrow(/page does not exist/);
 });
 it('requires explicit precision consent, rejects invalid options and reports unsupported codecs',async()=>{
  await expect(decodeTiff(new Blob([await readFile(base+'gray16-le.tif')]))).rejects.toThrow(/precision-loss consent/);expect(()=>tiffDecodeOptionsSchema.parse({page:-1})).toThrow();expect(()=>tiffDecodeOptionsSchema.parse({page:0,extra:true})).toThrow();
  const bytes=new Uint8Array(await readFile(base+'rgba-1.tif')),v=new DataView(bytes.buffer),ifd=v.getUint32(4,true),count=v.getUint16(ifd,true);for(let i=0;i<count;i++){const at=ifd+2+i*12;if(v.getUint16(at,true)===259)v.setUint16(at+8,7,true);}const result=await inspectTiff(new Blob([bytes]));expect(result.report.pages[0].canDecode).toBe(false);await expect(decodeTiff(new Blob([bytes]))).rejects.toThrow(/Compression 7/);
 });
 it('rejects cyclic, duplicate, truncated and inexact-address directory data',async()=>{
  const original=new Uint8Array(await readFile(base+'rgba-1.tif'));
  for(const kind of ['cycle','duplicate','extent'] as const){const bytes=original.slice(),v=new DataView(bytes.buffer),ifd=v.getUint32(4,true),count=v.getUint16(ifd,true);if(kind==='cycle')v.setUint32(ifd+2+count*12,ifd,true);else if(kind==='duplicate')v.setUint16(ifd+14,v.getUint16(ifd+2,true),true);else v.setUint32(ifd+6,0xffffffff,true);await expect(inspectTiff(new Blob([bytes])),kind).rejects.toThrow();}
  await expect(inspectTiff(new Blob([original.subarray(0,7)]))).rejects.toThrow();const header=new Uint8Array(16),v=new DataView(header.buffer);header[0]=header[1]=73;v.setUint16(2,43,true);v.setUint16(4,8,true);v.setBigUint64(8,2n**60n,true);await expect(inspectTiff(new Blob([header]))).rejects.toThrow(/exact browser/);
 });
 it('maps every TIFF orientation onto the complete oriented pixel rectangle',()=>{
  for(let orientation=1;orientation<=8;orientation++){const transform=tiffOrientation(orientation,211,173),points=[[0,0],[211,0],[0,173],[211,173]].map(([x,y])=>transform.point({x,y})),xs=points.map(p=>p.x),ys=points.map(p=>p.y);expect(Math.min(...xs)).toBe(0);expect(Math.min(...ys)).toBe(0);expect(Math.max(...xs)).toBe(orientation>=5?173:211);expect(Math.max(...ys)).toBe(orientation>=5?211:173);}
 });
});
