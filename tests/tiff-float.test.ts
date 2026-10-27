import{it,expect,afterEach,vi}from'vitest';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{decodeTiff}from'../src/core/interchange/tiff/decode';
import{inspectTiff}from'../src/core/interchange/tiff/inspect';
import{floatTiffRows}from'../src/core/interchange/tiff/float-rows';
import{decodeTiffFile}from'../src/core/interchange/tiff/client';
import{acquireIccOwner}from'../src/core/color/icc-client';
import{openPngRows}from'../server/png-rows';
const directory='tests/fixtures/tiff-float/',manifest=JSON.parse(await readFile(directory+'manifest.json','utf8'))as{cases:{file:string;reference:string;assumption:'linear-srgb'|null;width:number;height:number}[];reject:string[];files:Record<string,{bytes:number;sha256:string}>;generatorSha256:string};
async function blob(name:string){return new Blob([new Uint8Array(await readFile(directory+name))],{type:'image/tiff'});}
async function pixels(png:Blob){const reader=openPngRows(new Uint8Array(await png.arrayBuffer())),parts:Uint8ClampedArray[]=[];for await(const row of reader.strips)parts.push(row.pixels);return Buffer.concat(parts.map(v=>Buffer.from(v)));}
afterEach(()=>vi.unstubAllGlobals());
for(const row of manifest.cases)it('native float TIFF '+row.file+' matches every independent libtiff/CMM pixel',async()=>{
 const source=await blob(row.file),before=await source.arrayBuffer(),result=await decodeTiff(source,{allowPrecisionLoss:true,...(row.assumption?{floatColorSpace:row.assumption}:{})});const actual=await pixels(result.png),expected=await pixels(new Blob([new Uint8Array(await readFile(directory+row.reference))]));expect(actual.length).toBe(expected.length);let maximum=0;for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));expect(maximum).toBe(0);expect(result.page).toMatchObject({bits:32,sampleFormat:3,canDecode:true,requiresPrecisionLoss:true});expect(result.color).toMatchObject({engine:'Little CMS 2.19.1',outputSpace:'srgb8',source:{kind:row.assumption?'assumed':'icc'}});expect(await source.arrayBuffer()).toEqual(before);
});
for(const name of manifest.reject)it('invalid or HDR float samples reject without a proxy: '+name,async()=>{await expect(decodeTiff(await blob(name),{allowPrecisionLoss:true})).rejects.toThrow(/finite|SDR|alpha|tone mapping/);});
it('consent and an explicit unprofiled float interpretation are independent requirements',async()=>{
 const source=await blob('unprofiled-linear.tif');expect((await inspectTiff(source)).report.pages[0]).toMatchObject({requiresColorAssumption:true,requiresPrecisionLoss:true});await expect(decodeTiff(source,{floatColorSpace:'linear-srgb'})).rejects.toThrow('precision-loss consent');await expect(decodeTiff(source,{allowPrecisionLoss:true})).rejects.toThrow('explicit float TIFF');const srgb=await decodeTiff(source,{allowPrecisionLoss:true,floatColorSpace:'srgb'}),linear=await decodeTiff(source,{allowPrecisionLoss:true,floatColorSpace:'linear-srgb'});expect(await pixels(srgb.png)).not.toEqual(await pixels(linear.png));
 const known=await blob('rgba-raw-le.tif'),a=await decodeTiff(known,{allowPrecisionLoss:true,floatColorSpace:'linear-srgb'}),b=await decodeTiff(known,{allowPrecisionLoss:true});expect(await pixels(a.png)).toEqual(await pixels(b.png));expect(a.color?.source.kind).toBe('icc');
});
it('the native source reader retains finite HDR samples before the current proxy tone-map boundary',async()=>{
 const source=await blob('hdr-high.tif'),inspection=await inspectTiff(source);let value=0;for await(const row of floatTiffRows(inspection,inspection.pages[0]))if(row.top===2)value=row.samples[3*4];expect(value).toBe(1.5);await expect(decodeTiff(source,{allowPrecisionLoss:true})).rejects.toThrow('tone mapping');
});
it('callback failures close native transforms and row cursors so a fresh decode succeeds',async()=>{
 const source=await blob('rgba-deflate-predictor3-be.tif');await expect(decodeTiff(source,{allowPrecisionLoss:true},()=>{throw new Error('Callback failed');})).rejects.toThrow('Callback failed');expect((await decodeTiff(source,{allowPrecisionLoss:true})).png.size).toBeGreaterThan(100);
});
it('queued float input allocates no worker and cancellation releases the shared ICC owner queue',async()=>{
 const instances:unknown[]=[];vi.stubGlobal('Worker',class{constructor(){instances.push(this);}});const first=await acquireIccOwner(),second=await acquireIccOwner(),abort=new AbortController();
 try{const pending=decodeTiffFile(await blob('rgba-raw-le.tif'),{allowPrecisionLoss:true},{signal:abort.signal});await new Promise(resolve=>setTimeout(resolve,25));expect(instances).toHaveLength(0);abort.abort();await expect(pending).rejects.toThrow();}finally{first();second();}const recovered=await acquireIccOwner();recovered();
});
it('independent input/reference bytes and generator match recorded provenance',async()=>{
 for(const[name,identity]of Object.entries(manifest.files)){const data=await readFile(directory+name);expect(data.length).toBe(identity.bytes);expect(createHash('sha256').update(data).digest('hex')).toBe(identity.sha256);}expect(createHash('sha256').update(await readFile('scripts/generate-float-tiff-fixtures.py')).digest('hex')).toBe(manifest.generatorSha256);
});
