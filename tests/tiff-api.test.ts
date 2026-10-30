import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile,mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createApiServer} from '../server/app';
import {readProject} from '../src/core/project';
import {openPngRows} from '../server/png-rows';

const cache=await mkdtemp(join(tmpdir(),'canoli-tiff-api-')),server=createApiServer({authToken:'tiff-native-test',precisionCacheDirectory:cache}),auth={authorization:'Bearer tiff-native-test'};let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(cache,{recursive:true,force:true});});
const json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function document(){const response=await fetch(base+'/documents',json({name:'Precision session',width:300,height:200}));expect(response.status).toBe(201);return(await response.json()).document.id as string;}
async function original(){return new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-raw.tif'));}
async function tiff(id:string,bytes:Uint8Array,options:unknown={editingPrecision:'float32'},revision=0,mode='tiff-import'){return fetch(`${base}/documents/${id}/${mode}?expectedRevision=${revision}&name=Original.tif`,{method:'POST',headers:{...auth,'content-type':'image/tiff','x-tiff-options':JSON.stringify(options)},body:new Blob([new Uint8Array(bytes)])});}
async function snapshot(id:string){return(await fetch(`${base}/documents/${id}`,{headers:auth})).json();}
async function window(id:string,asset:string,revision:number,width=131,height=79){return fetch(`${base}/documents/${id}/assets/${asset}/float-window?expectedRevision=${revision}&width=${width}&height=${height}`,{headers:auth});}

it('REST inspects/imports native TIFF, returns exact float originals and shares commands, history and portable projects',async()=>{
  const id=await document(),bytes=await original(),before=await snapshot(id),inspection=await tiff(id,bytes,{},0,'tiff-inspect');expect(inspection.status,await inspection.clone().text()).toBe(200);expect((await snapshot(id)).revision).toBe(0);
  const response=await tiff(id,bytes);expect(response.status,await response.clone().text()).toBe(201);const result=await response.json(),assetId=result.assetId;
  expect(result).toMatchObject({revision:1,canUndo:true,document:{precision:'float32',width:300,height:200,children:[{kind:'raster',width:131,height:79}]},source:{format:'rgba-float32-le',colorSpace:'linear-srgb',sourceSha256:digest(bytes)}});
  const native=await window(id,assetId,1);expect(native.status,await native.clone().text()).toBe(200);expect(native.headers.get('x-canoli-pixel-format')).toBe('rgba-float32-le');expect(native.headers.get('x-canoli-color-space')).toBe('linear-srgb');expect(native.headers.get('x-canoli-source-sha256')).toBe(digest(bytes));expect(Buffer.from(await native.arrayBuffer())).toEqual(gunzipSync(await readFile('tests/fixtures/uint16-float/u16-raw-linear.f32le.gz')));
  const raw=await fetch(`${base}/documents/${id}/assets/${assetId}?original=true`,{headers:auth});expect(raw.status).toBe(200);expect(raw.headers.get('content-type')).toBe('image/tiff');expect(new Uint8Array(await raw.arrayBuffer())).toEqual(bytes);
  const preview=await fetch(`${base}/documents/${id}/assets/${assetId}?preview=true`,{headers:auth});expect(preview.status).toBe(200);expect(preview.headers.get('x-canoli-preview-only')).toBe('true');const png=openPngRows(new Uint8Array(await preview.arrayBuffer()));expect([png.width,png.height]).toEqual([96,58]);for await(const _strip of png.strips){}
  const meta=await(await fetch(`${base}/documents/${id}/assets/${assetId}`,{headers:auth})).json();expect(meta.asset).toMatchObject({width:131,height:79,tiff:{editingPrecision:'float32'},precisionSource:{colorSpace:'linear-srgb',sourceSha256:digest(bytes)}});expect(JSON.stringify(meta)).not.toMatch(/\.tile|canoli-tiff-/);
  const edit=await fetch(`${base}/documents/${id}/commands`,json({expectedRevision:1,commands:[{type:'layer.update',id:result.layerId,patch:{opacity:.625}}]}));expect(edit.status).toBe(200);
  const projectResponse=await fetch(`${base}/documents/${id}/project?history=true`,{headers:auth});expect(projectResponse.status,await projectResponse.clone().text()).toBe(200);const project=await readProject(await projectResponse.blob());expect(project.document).toMatchObject({precision:'float32',children:[{opacity:.625}]});expect(project.history?.past).toHaveLength(2);expect(new Uint8Array(await project.entries[0].blob.arrayBuffer())).toEqual(bytes);expect(project.entries[0].tiff).toMatchObject({editingPrecision:'float32'});
  expect((await fetch(`${base}/documents/${id}/undo`,json({expectedRevision:2}))).status).toBe(200);const undo=await(await fetch(`${base}/documents/${id}/undo`,json({expectedRevision:3}))).json();expect(undo.revision).toBe(4);expect(undo.document).toEqual(before.document);const redo=await(await fetch(`${base}/documents/${id}/redo`,json({expectedRevision:4}))).json();expect(redo.document).toEqual(result.document);expect((await window(id,assetId,5)).status).toBe(200);
},30000);

it('REST wrong choices, malformed inputs, stale revisions and oversized working windows never publish partial TIFF changes',async()=>{
  const id=await document(),bytes=await original();
  for(const [input,options] of [[bytes,{}],[new Uint8Array([1,2,3]),{editingPrecision:'float32'}],[new Uint8Array(await readFile('tests/fixtures/tiff/gray16-le.tif')),{editingPrecision:'float32'}]]as const){const response=await tiff(id,input,options);expect(response.status).toBe(400);}
  expect((await tiff(id,bytes,{editingPrecision:'float32',unknown:true})).status).toBe(400);expect((await tiff(id,bytes,{editingPrecision:'float32'},9)).status).toBe(409);expect(await snapshot(id)).toMatchObject({revision:0,canUndo:false,document:{children:[]}});expect((await(await fetch(`${base}/documents/${id}/assets`,{headers:auth})).json()).assets).toEqual([]);
  const first=await(await tiff(id,bytes)).json();expect((await window(id,first.assetId,0)).status).toBe(409);expect((await window(id,first.assetId,1,10000,5000)).status).toBe(400);expect((await window(id,first.assetId,1,0,1)).status).toBe(400);expect((await snapshot(id)).revision).toBe(1);expect((await tiff(id,bytes,{editingPrecision:'float32'},0)).status).toBe(409);
},30000);

it('REST concurrent human edits cancel native preparation and verified file-cache corruption rebuilds on read retry',async()=>{
  const id=await document(),bytes=await original(),pending=tiff(id,bytes),changed=await fetch(`${base}/documents/${id}/commands`,json({expectedRevision:0,commands:[{type:'document.rename',name:'Human revision'}]}));expect(changed.status).toBe(200);expect((await pending).status).toBe(409);expect(await snapshot(id)).toMatchObject({revision:1,document:{name:'Human revision',children:[]}});
  const previous=new Set(await readdir(cache)),result=await(await tiff(id,bytes,{editingPrecision:'float32'},1)).json(),before=await window(id,result.assetId,2);expect(before.status).toBe(200);const expected=new Uint8Array(await before.arrayBuffer());
  const roots=(await readdir(cache)).filter(name=>!previous.has(name));expect(roots).toHaveLength(1);const path=join(cache,roots[0],'0.tile'),content=new Uint8Array(await readFile(path));content[content.length-1]^=1;await writeFile(path,content);
  const first=await window(id,result.assetId,2);expect(first.status).toBe(400);expect((await first.json()).error).toMatch(/corrupt/i);
  const recovered=await window(id,result.assetId,2);expect(recovered.status,await recovered.clone().text()).toBe(200);expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(expected);expect((await snapshot(id)).revision).toBe(2);
},30000);

it('REST document deletion releases its verified TIFF files and invalidates source reads',async()=>{
  const id=await document(),previous=new Set(await readdir(cache)),result=await(await tiff(id,await original())).json();expect(result.revision).toBe(1);
  const roots=(await readdir(cache)).filter(name=>!previous.has(name));expect(roots).toHaveLength(1);
  const response=await fetch(`${base}/documents/${id}`,{method:'DELETE',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({expectedRevision:1})});expect(response.status,await response.clone().text()).toBe(200);
  expect((await readdir(cache)).filter(name=>roots.includes(name))).toEqual([]);expect((await window(id,result.assetId,1)).status).toBe(404);
},30000);

it('disconnecting during genuine 50 MP TIFF preparation cancels admission and removes private staging',async()=>{
  const id=await document(),previous=new Set(await readdir(cache)),abort=new AbortController(),bytes=new Uint8Array(await readFile('tests/fixtures/uint16-float/u16-native-50mp.tif'));
  const pending=fetch(`${base}/documents/${id}/tiff-import?expectedRevision=0`,{method:'POST',headers:{...auth,'content-type':'image/tiff','x-tiff-options':JSON.stringify({editingPrecision:'float32'})},body:new Blob([bytes]),signal:abort.signal});
  const settled=Promise.allSettled([pending]);await expect.poll(async()=>(await readdir(cache)).filter(name=>!previous.has(name)).length,{timeout:10000}).toBe(1);abort.abort();expect((await settled)[0].status).toBe('rejected');
  await expect.poll(async()=>(await readdir(cache)).filter(name=>!previous.has(name)),{timeout:10000}).toEqual([]);expect(await snapshot(id)).toMatchObject({revision:0,canUndo:false,document:{children:[]}});expect((await(await fetch(`${base}/documents/${id}/assets`,{headers:auth})).json()).assets).toEqual([]);
},30000);
