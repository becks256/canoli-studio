import{it,expect}from'vitest';
import{readFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
import{inspectTiff}from'../src/core/interchange/tiff/inspect';
import{floatTiffRows}from'../src/core/interchange/tiff/float-rows';
import{supportsFloatTiff}from'../src/core/interchange/tiff/types';
import{iccTarget}from'../src/core/color/profile-source';
import{describeFloatSource,prepareFloatTiles}from'../src/core/float-source/prepare';
import{decodeTile}from'../src/core/float-source/codec';
import{tileGeometry,validateFloatPreparation}from'../src/core/float-source/types';
import{FloatRasterSource}from'../src/core/float-source/source';
const directory='tests/fixtures/uint16-float/';
const manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'))as{generatorSha256:string;cases:{file:string;width:number;height:number;samples:number;reference:string;floatSha256:string;sourceProfileSha256:string;assumption:'linear-srgb'|null}[];files:Record<string,{bytes:number;sha256:string}>};
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function original(file:string){return new Blob([new Uint8Array(await readFile(directory+file))],{type:'image/tiff'});}
for(const row of manifest.cases.filter(row=>row.width<10000))it('original uint16 rows and native source cache preserve every independent normalized sample: '+row.file,async()=>{
 const blob=await original(row.file),tiff={page:0,allowPrecisionLoss:false,...(row.assumption?{floatColorSpace:row.assumption}:{})};
 const source=await FloatRasterSource.openTiff(blob,tiff);expect(source.original).toBe(blob);source.dispose();
 const described=await describeFloatSource({original:blob,target:iccTarget('linear-srgb').source,width:row.width,height:row.height,tiff,expectedSource:row.assumption?{kind:'assumed',id:row.assumption,sha256:row.sourceProfileSha256}:{kind:'icc',sha256:row.sourceProfileSha256},intent:'relative-colorimetric',blackPointCompensation:false}),actual=new Float32Array(row.samples);
 expect(supportsFloatTiff(described.page.report)).toBe(true);
 for await(const part of prepareFloatTiles(described))if(part.kind==='prepared')validateFloatPreparation(described.descriptor,part.prepared);else{const g=tileGeometry(described.descriptor,part.tile.meta.index),pixels=await decodeTile(part.tile,part.tile.meta);for(let y=0;y<g.height;y++)actual.set(pixels.subarray(y*g.width*4,(y+1)*g.width*4),((g.y+y)*row.width+g.x)*4);}
 const expected=gunzipSync(await readFile(directory+row.reference));expect(Buffer.compare(Buffer.from(actual.buffer),expected)).toBe(0);expect(hash(new Uint8Array(actual.buffer))).toBe(row.floatSha256);
});
it('all 65536 original unsigned color levels survive row normalization before ICC conversion',async()=>{
 const inspection=await inspectTiff(await original('u16-all-levels.tif')),values:number[]=[];
 for await(const row of floatTiffRows(inspection,inspection.pages[0]))for(let x=0;x<256;x++)values.push(row.samples[x*4]);
 expect(values.length).toBe(65536);expect(new Set(values).size).toBe(65536);for(let i=0;i<65536;i++)expect(values[i]).toBe(Math.fround(i/65535));
});
it('unprofiled uint16 precision admission requires an explicit source interpretation and rejects byte sources',async()=>{
 const blob=await original('u16-gray-black.tif');await expect(FloatRasterSource.openTiff(blob)).rejects.toThrow('interpretation');const source=await FloatRasterSource.openTiff(blob,{floatColorSpace:'srgb'});expect(source.sourceColor.kind).toBe('assumed');source.dispose();
 const byte=new Blob([new Uint8Array(await readFile('tests/fixtures/tiff/rgba-8.tif'))]);await expect(FloatRasterSource.openTiff(byte)).rejects.toThrow('16-bit or float32');
});
it('uint16 source ICC declarations reject known PQ and HLG before native preparation',async()=>{
 const input=new Uint8Array(await readFile(directory+'u16-raw.tif')),view=new DataView(input.buffer),little=true,ifd=view.getUint32(4,little);let entry=-1;for(let i=0;i<view.getUint16(ifd,little);i++)if(view.getUint16(ifd+2+i*12,little)===34675)entry=ifd+2+i*12;expect(entry).toBeGreaterThan(0);
 for(const name of['pq','hlg']){const hdr=await inspectTiff(new Blob([new Uint8Array(await readFile('tests/fixtures/tiff-float/hdr-icc-'+name+'.tif'))])),icc=hdr.pages[0].icc!,bytes=new Uint8Array(input.length+icc.length);bytes.set(input);bytes.set(icc,input.length);const patched=new DataView(bytes.buffer);patched.setUint32(entry+4,icc.length,little);patched.setUint32(entry+8,input.length,little);const blob=new Blob([bytes],{type:'image/tiff'});expect((await inspectTiff(blob)).report.pages[0]).toMatchObject({canDecode:false});await expect(FloatRasterSource.openTiff(blob)).rejects.toThrow('supported original');}
});
it('independent uint16 originals and reference identities bind their exact generator and artifacts',async()=>{
 expect(hash(await readFile('scripts/generate-uint16-float-fixtures.py'))).toBe(manifest.generatorSha256);for(const[name,identity]of Object.entries(manifest.files)){const bytes=await readFile(directory+name);expect(bytes.length).toBe(identity.bytes);expect(hash(bytes)).toBe(identity.sha256);}
});
