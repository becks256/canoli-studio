import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import type {AddressInfo} from 'node:net';
import {createHash} from 'node:crypto';
import {createApiServer} from '../server/app';
import {openPngRows} from '../server/png-rows';
import {readProject} from '../src/core/project';
import {RasterLayer} from '../src/dom';
import {join} from 'node:path';
async function evidence(name:string,bytes:Uint8Array|string){const directory=process.env.CANOLI_RAW_EVIDENCE_DIR;if(directory){await mkdir(directory,{recursive:true});await writeFile(join(directory,name),bytes);}}

const server=createApiServer({authToken:'raw-test'});let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const auth={authorization:'Bearer raw-test'};
const json=(method:string,value:unknown)=>({method,headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});
async function document(){const response=await fetch(base+'/documents',json('POST',{name:'RAW session',width:64,height:48}));expect(response.status).toBe(201);return(await response.json()).document.id as string;}
async function raw(id:string,bytes:Uint8Array,options:unknown={allowPrecisionLoss:true},revision=0,mode='raw-import'){
  return fetch(`${base}/documents/${id}/${mode}?expectedRevision=${revision}&name=Original.dng`,{method:'POST',headers:{...auth,'content-type':'image/x-adobe-dng','x-raw-options':JSON.stringify(options)},body:new Blob([new Uint8Array(bytes)])});
}
async function pixels(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),hash=createHash('sha256');let samples=0;for await(const strip of image.strips){hash.update(strip.pixels);samples+=strip.pixels.length;}return{width:image.width,height:image.height,samples,sha256:hash.digest('hex')};}
async function sourceBytes(name='bayer-rggb.dng'){return new Uint8Array(await readFile('tests/fixtures/raw/'+name));}

it('separate REST RAW sessions retain native pixels/originals and share master commands, history and project checksums',async()=>{
  const id=await document(),original=await sourceBytes(),inspected=await raw(id,original,{},0,'raw-inspect');expect(inspected.status).toBe(200);expect((await inspected.json()).report).toMatchObject({canDevelop:true,displayWidth:64,displayHeight:48});
  const imported=await raw(id,original);expect(imported.status,await imported.clone().text()).toBe(201);const first=await imported.json(),master=first.document.components[0],oldId=master.source.assetId;
  expect(first).toMatchObject({revision:1,canUndo:true,document:{width:64,height:48,children:[{kind:'smart-object'}]}});
  const originalResponse=await fetch(`${base}/documents/${id}/assets/${oldId}?original=true`,{headers:auth});expect(originalResponse.status).toBe(200);expect(new Uint8Array(await originalResponse.arrayBuffer())).toEqual(original);
  const source=await(await fetch(`${base}/documents/${id}/assets/${oldId}`,{headers:auth})).json();expect(source.asset.raw).toMatchObject({settings:{allowPrecisionLoss:true,development:{exposure:0}},original:{name:'Original.dng'}});expect(source.asset.raw).not.toHaveProperty('originalBlob');
  const developed=await fetch(`${base}/documents/${id}/raw-develop`,json('POST',{expectedRevision:1,layerId:first.layerId,options:{allowPrecisionLoss:true,development:{exposure:1.25,highlightPreservation:0.5}}}));expect(developed.status,await developed.clone().text()).toBe(200);const second=await developed.json(),newId=second.document.components[0].source.assetId;expect(second.revision).toBe(2);expect(newId).not.toBe(oldId);
  const image=await(await fetch(`${base}/documents/${id}/assets/${newId}?raw=true`,{headers:auth})).blob(),expected=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/exposure-up.png'))],{type:'image/png'});expect(await pixels(image)).toEqual(await pixels(expected));
  const nativeProject=await(await fetch(`${base}/documents/${id}/project?history=true`,{headers:auth})).blob();await evidence('headless-raw-history.luma',new Uint8Array(await nativeProject.arrayBuffer()));const project=await readProject(nativeProject);expect(project.entries).toHaveLength(2);expect(project.history?.past.at(-1)?.label).toBe('Develop RAW');for(const entry of project.entries)expect(new Uint8Array(await entry.raw!.originalBlob.arrayBuffer())).toEqual(original);
  const undone=await(await fetch(`${base}/documents/${id}/undo`,json('POST',{expectedRevision:2}))).json();expect(undone.document.components[0].source.assetId).toBe(oldId);expect(undone.revision).toBe(3);
  const redone=await(await fetch(`${base}/documents/${id}/redo`,json('POST',{expectedRevision:3}))).json();expect(redone.document).toEqual(second.document);expect(redone.revision).toBe(4);
  expect(await pixels(await(await fetch(`${base}/documents/${id}/assets/${newId}?raw=true`,{headers:auth})).blob())).toEqual(await pixels(image));
},30000);

it('REST consent, malformed input, unavailable WB, revision and dependent locks never publish partial RAW changes',async()=>{
  const id=await document(),bytes=await sourceBytes();expect((await raw(id,bytes,{})).status).toBe(400);expect((await raw(id,new Uint8Array([1,2,3]))).status).toBe(400);expect((await raw(id,await sourceBytes('no-camera-wb.dng'))).status).toBe(400);expect((await raw(id,bytes,{allowPrecisionLoss:true},9)).status).toBe(409);
  const empty=await(await fetch(`${base}/documents/${id}`,{headers:auth})).json();expect(empty).toMatchObject({revision:0,canUndo:false,document:{children:[]}});expect((await(await fetch(`${base}/documents/${id}/assets`,{headers:auth})).json()).assets).toHaveLength(0);
  const first=await(await raw(id,bytes)).json();const locked=await fetch(`${base}/documents/${id}/commands`,json('POST',{expectedRevision:1,commands:[{type:'layer.update',id:first.layerId,patch:{locked:true}}]}));expect(locked.status).toBe(200);
  const failed=await fetch(`${base}/documents/${id}/raw-develop`,json('POST',{expectedRevision:2,layerId:first.layerId,options:{allowPrecisionLoss:true,development:{exposure:1}}}));expect(failed.status).toBe(400);expect((await failed.json()).error).toMatch(/locked/);
  expect((await(await fetch(`${base}/documents/${id}`,{headers:auth})).json()).revision).toBe(2);expect((await(await fetch(`${base}/documents/${id}/assets`,{headers:auth})).json()).assets).toHaveLength(1);
},30000);

it('REST revision conflicts protect human edits during asynchronous native RAW requests',async()=>{
  const id=await document(),pending=raw(id,await sourceBytes()),changed=await fetch(`${base}/documents/${id}/commands`,json('POST',{expectedRevision:0,commands:[{type:'document.rename',name:'Human edit'}]}));expect(changed.status).toBe(200);const result=await pending;expect(result.status).toBe(409);
  const current=await(await fetch(`${base}/documents/${id}`,{headers:auth})).json();expect(current).toMatchObject({revision:1,document:{name:'Human edit',children:[]}});expect((await(await fetch(`${base}/documents/${id}/assets`,{headers:auth})).json()).assets).toHaveLength(0);
},20000);

it('actual 50 MP REST import has no arbitrary source-size cap and retains every original/working sample',async()=>{
  const id=await document(),bytes=new Uint8Array(gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));expect(bytes.byteLength).toBeGreaterThan(100_000_000);
  const response=await raw(id,bytes);expect(response.status,await response.clone().text()).toBe(201);const result=await response.json();expect(result.report).toMatchObject({displayWidth:10000,displayHeight:5000});const assetId=result.document.components[0].source.assetId;
  const original=await(await fetch(`${base}/documents/${id}/assets/${assetId}?original=true`,{headers:auth})).arrayBuffer();expect(createHash('sha256').update(new Uint8Array(original)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
  const image=await(await fetch(`${base}/documents/${id}/assets/${assetId}?raw=true`,{headers:auth})).blob(),expected=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/native-50mp.png'))],{type:'image/png'});const actual=await pixels(image),reference=await pixels(expected);expect(actual).toEqual({...reference,width:10000,height:5000,samples:200_000_000});await evidence('headless-raw-50mp.png',new Uint8Array(await image.arrayBuffer()));await evidence('headless-raw-50mp.json',JSON.stringify({actual,reference,originalSha256:createHash('sha256').update(new Uint8Array(original)).digest('hex'),originalBytes:original.byteLength}));
},180000);

it('headless project delivery validates ordinary PNG pixels and rejects unverified legacy image data',async()=>{
  for(const corrupt of [false,true]){
    const id=await document(),bytes=await readFile('tests/fixtures/raw/bayer-rggb.png');if(corrupt)bytes[bytes.length-15]^=255;
    const uploaded=await fetch(`${base}/documents/${id}/assets`,{method:'POST',headers:{...auth,'content-type':'image/png'},body:new Blob([new Uint8Array(bytes)])});expect(uploaded.status).toBe(201);const asset=(await uploaded.json()).asset;
    const layer=new RasterLayer({assetId:asset.id,width:64,height:48,name:'Encoded image'});expect((await fetch(`${base}/documents/${id}/commands`,json('POST',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}))).status).toBe(200);
    const result=await fetch(`${base}/documents/${id}/project`,{headers:auth});expect(result.status).toBe(corrupt?400:200);
    if(corrupt)expect((await result.json()).error).toMatch(/checksum/i);else{const project=await readProject(await result.blob());expect(new Uint8Array(await project.entries[0].blob.arrayBuffer())).toEqual(new Uint8Array(bytes));}
    expect((await(await fetch(`${base}/documents/${id}`,{headers:auth})).json()).revision).toBe(1);
  }
},20000);

it('REST inspection and retained project history expose recorded lens metadata without guessing missing values',async()=>{
 const id=await document(),bytes=new Uint8Array(await readFile('tests/fixtures/raw-shooting/recorded.dng'));
 const response=await raw(id,bytes,{},0,'raw-inspect');expect(response.status).toBe(200);const report=(await response.json()).report;
 expect(report.shooting).toEqual({version:1,lensMake:'Canoli Optics',lensModel:'Canoli Reference 24-70mm F2.8',focalLength:35,focalLength35mm:53,aperture:Math.fround(5.6),exposureTime:Math.fround(.008),iso:400});
 expect((await(await fetch(`${base}/documents/${id}`,{headers:auth})).json()).revision).toBe(0);
 expect((await(await fetch(`${base}/documents/${id}/assets`,{headers:auth})).json()).assets).toHaveLength(0);
 const first=await(await raw(id,bytes)).json(),developed=await fetch(`${base}/documents/${id}/raw-develop`,json('POST',{expectedRevision:1,layerId:first.layerId,options:{allowPrecisionLoss:true,development:{lens:{vignette:{k1:-.1}}}}}));expect(developed.status).toBe(200);expect((await developed.json()).report.shooting).toEqual(report.shooting);
 const saved=await readProject(await(await fetch(`${base}/documents/${id}/project?history=true`,{headers:auth})).blob());expect(saved.entries).toHaveLength(2);
 for(const asset of saved.entries){expect(asset.raw!.report.shooting).toEqual(report.shooting);expect(new Uint8Array(await asset.raw!.originalBlob.arrayBuffer())).toEqual(bytes);}
 const undo=await(await fetch(`${base}/documents/${id}/undo`,json('POST',{expectedRevision:2}))).json();expect(undo.document).toEqual(first.document);
},30000);
