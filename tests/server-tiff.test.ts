import {it,expect} from 'vitest';
import {readFile,mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {ServerTiffService} from '../server/tiff';
import {AssetStore} from '../src/core/assets';
import {Document,RasterLayer} from '../src/dom';
import {importServerTiff} from '../server/tiff-document';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const corpus=await Promise.all(['uint16-float','float-source'].map(async folder=>({folder,data:JSON.parse(await readFile(`tests/fixtures/${folder}/manifest.json`,'utf8'))})));
async function scope(work:(service:ServerTiffService,root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'canoli-tiff-test-')),service=new ServerTiffService(root);try{await work(service,root);}finally{await service.dispose();expect(await readdir(root)).toEqual([]);await rm(root,{recursive:true});}}
for(const {folder,data} of corpus)for(const row of data.cases.filter((row:{width:number})=>row.width<10000))it(`real Node TIFF source retains every native ${folder}/${row.file} reference sample`,async()=>{
  await scope(async service=>{
    const bytes=new Uint8Array(await readFile(`tests/fixtures/${folder==='float-source'?'tiff-float':folder}/${row.file}`)),original=new Blob([bytes],{type:'image/tiff'}),source=await service.prepare(original,{editingPrecision:'float32',...(row.assumption?{floatColorSpace:row.assumption}:{})});
    const pixels=await source.readWindow({x:0,y:0,width:row.width,height:row.height}),expected=gunzipSync(await readFile(`tests/fixtures/${folder}/${row.reference}`));
    expect(sha(new Uint8Array(pixels.buffer))).toBe(row.floatSha256);expect(Buffer.from(pixels.buffer)).toEqual(expected);expect(source.manifest.descriptor.sourceSha256).toBe(sha(bytes));expect(source.original).toBe(original);expect(source.preview.type).toBe('image/png');expect(Object.isFrozen(source.manifest.descriptor)).toBe(true);
    const bounds={x:-2,y:-3,width:row.width+4,height:row.height+6},pending=source.readWindow(bounds);bounds.x=100000;bounds.width=1;const padded=await pending,reference=new Float32Array(new Uint8Array(expected).buffer),words=new Uint32Array(padded.buffer),referenceWords=new Uint32Array(reference.buffer);
    for(let y=0;y<row.height+6;y++)for(let x=0;x<row.width+4;x++)for(let c=0;c<4;c++)expect(words[(y*(row.width+4)+x)*4+c]).toBe(x>=2&&x<row.width+2&&y>=3&&y<row.height+3?referenceWords[((y-3)*row.width+x-2)*4+c]:0);
  });
},30000);

it('cancelled native staging and corrupt cached reads retain originals, clean files and rebuild on retry',async()=>{
  await scope(async(service,root)=>{
    const original=new Blob([new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'))],{type:'image/tiff'}),abort=new AbortController();let stopped=false;
    await expect(service.prepare(original,{editingPrecision:'float32'},{signal:abort.signal,onProgress:value=>{if(value.phase==='converting'){stopped=true;abort.abort();}}})).rejects.toThrow();expect(stopped).toBe(true);expect(await readdir(root)).toEqual([]);
    const source=await service.prepare(original,{editingPrecision:'float32'}),bounds={x:0,y:0,width:131,height:79},before=await source.readWindow(bounds),directory=source.directory,file=join(directory,'0.tile'),bytes=new Uint8Array(await readFile(file));bytes[bytes.length-1]^=1;await writeFile(file,bytes);
    await expect(source.readWindow(bounds)).rejects.toThrow(/corrupt|invalid/i);const after=await source.readWindow(bounds);expect(new Uint32Array(after.buffer)).toEqual(new Uint32Array(before.buffer));expect(source.directory).not.toBe(directory);expect((await readdir(root)).length).toBe(1);expect(source.original).toBe(original);
    const readAbort=new AbortController();let started=false;await expect(source.readWindow(bounds,{signal:readAbort.signal,onProgress:value=>{if(value.phase==='reading'&&value.fraction!>0){started=true;readAbort.abort();}}})).rejects.toThrow();expect(started).toBe(true);expect(new Uint32Array((await source.readWindow(bounds)).buffer)).toEqual(new Uint32Array(before.buffer));
  });
},30000);

it('native import has no fabricated bitmap and shares one precision/layer Undo with atomic rejection',async()=>{
  await scope(async service=>{
    const assets=new AssetStore(),document=new Document({width:300,height:200});document.assetStore=assets;
    try{
      const original=new Blob([new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'))],{type:'image/tiff'}),before=document.toJSON(),result=await importServerTiff(document,assets,service,original,'Native original',{editingPrecision:'float32'},{},()=>{},()=>{}),asset=assets.get(result.assetId),after=document.toJSON();
      expect(after).toMatchObject({precision:'float32',width:300,height:200,children:[{kind:'raster',width:131,height:79}]});expect(()=>asset.bitmap).toThrow(/no browser bitmap/);expect(asset.blob).toBe(original);expect(service.forAsset(asset).original).toBe(original);expect(document.getSnapshot().past).toHaveLength(1);
      document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
      const count=assets.values().length;await expect(importServerTiff(document,assets,service,original,'Rejected',{editingPrecision:'float32'},{},()=>{},()=>{throw new Error('Stale host');})).rejects.toThrow('Stale host');expect(document.toJSON()).toEqual(after);expect(assets.values()).toHaveLength(count);
    }finally{assets.dispose();}
  });
},30000);

for(const fixture of ['nan.tif','infinite.tif','alpha-invalid.tif','hdr-icc-pq.tif'])it(`native TIFF rejects ${fixture} without accepted sources or derivative files`,async()=>{
  await scope(async(service,root)=>{
    const original=new Blob([new Uint8Array(await readFile(`tests/fixtures/tiff-float/${fixture}`))],{type:'image/tiff'});
    await expect(service.prepare(original,{editingPrecision:'float32'})).rejects.toThrow();expect(await readdir(root)).toEqual([]);
  });
},30000);

it('service disposal cancels real native staging and a queued source without leaking private files',async()=>{
  await scope(async(service,root)=>{
    const original=new Blob([new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'))],{type:'image/tiff'});let closing:Promise<void>|undefined;
    const active=service.prepare(original,{editingPrecision:'float32'},{onProgress:value=>{if(value.phase==='converting')closing??=service.dispose();}});
    const queued=service.prepare(original,{editingPrecision:'float32'});
    const results=await Promise.allSettled([active,queued]);await closing;
    expect(closing).toBeDefined();expect(results.map(result=>result.status)).toEqual(['rejected','rejected']);expect(await readdir(root)).toEqual([]);
  });
},30000);

it('cancelling a queued source read leaves the accepted source read and its pixels intact',async()=>{
  await scope(async service=>{
    const original=new Blob([new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'))],{type:'image/tiff'}),first=await service.prepare(original,{editingPrecision:'float32'}),second=await service.prepare(original,{editingPrecision:'float32'}),bounds={x:0,y:0,width:131,height:79},abort=new AbortController();
    const accepted=first.readWindow(bounds),cancelled=second.readWindow(bounds,{signal:abort.signal});abort.abort();
    const results=await Promise.allSettled([accepted,cancelled]);expect(results[0].status).toBe('fulfilled');expect(results[1].status).toBe('rejected');
    const restored=await second.readWindow(bounds);expect(results[0].status==='fulfilled'&&new Uint32Array(results[0].value.buffer)).toEqual(new Uint32Array(restored.buffer));
  });
},30000);

it('a cancelled first source read retries with unchanged original/cache identity and exact samples',async()=>{
  await scope(async service=>{
    const original=new Blob([new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'))],{type:'image/tiff'}),source=await service.prepare(original,{editingPrecision:'float32'}),directory=source.directory,bounds={x:0,y:0,width:131,height:79},abort=new AbortController();let reading=false;
    await expect(source.readWindow(bounds,{signal:abort.signal,onProgress:value=>{if(value.phase==='reading'&&value.fraction!>0){reading=true;abort.abort();}}})).rejects.toThrow();expect(reading).toBe(true);
    const actual=await source.readWindow(bounds),expected=gunzipSync(await readFile('tests/fixtures/uint16-float/u16-raw-linear.f32le.gz'));expect(Buffer.from(actual.buffer)).toEqual(expected);expect(source.directory).toBe(directory);expect(source.original).toBe(original);
  });
},30000);

it('unsupported byte TIFFs and incompatible existing PNG artwork reject without native staging or edits',async()=>{
  await scope(async(service,root)=>{
    await expect(service.prepare(new Blob([new Uint8Array(await readFile('tests/fixtures/tiff/rgba-1.tif'))],{type:'image/tiff'}),{editingPrecision:'float32'})).rejects.toThrow();expect(await readdir(root)).toEqual([]);
    const assets=new AssetStore(),document=new Document({width:300,height:200});document.assetStore=assets;
    try{
      const png=new Uint8Array(await readFile('tests/fixtures/tiff/rgba-1.png')),view=new DataView(png.buffer),asset=assets.installEncoded({id:'byte-original',name:'Byte original',width:view.getUint32(16),height:view.getUint32(20),blob:new Blob([png],{type:'image/png'})});document.layers.add(new RasterLayer({assetId:asset.id,width:asset.width,height:asset.height}));
      const before=document.toJSON(),past=document.getSnapshot().past.length;let progressed=false;
      await expect(importServerTiff(document,assets,service,new Blob([new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'))],{type:'image/tiff'}),'Rejected',{editingPrecision:'float32'},{onProgress:()=>{progressed=true;}},()=>{},()=>{})).rejects.toThrow();
      expect(progressed).toBe(false);expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().past).toHaveLength(past);expect(assets.values()).toHaveLength(1);expect(await readdir(root)).toEqual([]);
    }finally{assets.dispose();}
  });
},30000);
