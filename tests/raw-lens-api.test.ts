import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {readProject} from '../src/core/project';
import {openPngRows} from '../server/png-rows';
const server=createApiServer({authToken:'lens-test'});let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const auth={authorization:'Bearer lens-test'},request=(method:string,body:unknown)=>({method,headers:{...auth,'content-type':'application/json'},body:JSON.stringify(body)});
async function rgba(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),parts:Uint8ClampedArray[]=[];for await(const part of image.strips)parts.push(part.pixels);return Buffer.concat(parts.map(p=>Buffer.from(p)));}
it('REST lens development retains transparent correction coverage, original bytes, settings and atomic history',async()=>{
 const created=await(await fetch(base+'/documents',request('POST',{name:'Lens session',width:64,height:48}))).json(),id=created.document.id,bytes=await readFile('tests/fixtures/raw/bayer-rggb.dng'),imported=await fetch(`${base}/documents/${id}/raw-import?expectedRevision=0&name=Lens.dng`,{method:'POST',headers:{...auth,'content-type':'image/x-adobe-dng','x-raw-options':'{"allowPrecisionLoss":true}'},body:new Blob([new Uint8Array(bytes)])});expect(imported.status).toBe(201);const before=await imported.json();
 const response=await fetch(`${base}/documents/${id}/raw-develop`,request('POST',{expectedRevision:1,layerId:before.layerId,options:{allowPrecisionLoss:true,development:{lens:{distortion:{k1:.04}}}}}));expect(response.status,await response.clone().text()).toBe(200);const after=await response.json(),assetId=after.document.components[0].source.assetId;
 const png=await(await fetch(`${base}/documents/${id}/assets/${assetId}?raw=true`,{headers:auth})).blob(),reference=new Blob([new Uint8Array(await readFile('tests/fixtures/raw-lens/pincushion.png'))]);expect(await rgba(png)).toEqual(await rgba(reference));expect((await rgba(png)).some((n,i)=>i%4===3&&n<255)).toBe(true);
 const project=await readProject(await(await fetch(`${base}/documents/${id}/project?history=true`,{headers:auth})).blob());expect(project.entries).toHaveLength(2);const asset=project.entries.find(entry=>entry.id===assetId)!;expect(asset.raw!.settings.development.lens!.distortion.k1).toBe(.04);expect(Buffer.from(await asset.raw!.originalBlob.arrayBuffer())).toEqual(bytes);
 for(const lens of [{distortion:{k1:-1,k2:.4,k3:1e-30}},{center:{x:0,y:0},vignette:{k1:-1,k2:.2,k3:1e-30}}]){
  const rejected=await fetch(`${base}/documents/${id}/raw-develop`,request('POST',{expectedRevision:2,layerId:before.layerId,options:{allowPrecisionLoss:true,development:{lens}}}));expect(rejected.status).toBe(400);expect((await rejected.json()).error).toMatch(/folds|positive/);
  const retained=await(await fetch(`${base}/documents/${id}`,{headers:auth})).json();expect(retained.revision).toBe(2);expect(retained.document).toEqual(after.document);
 }
 const undo=await(await fetch(`${base}/documents/${id}/undo`,request('POST',{expectedRevision:2}))).json();expect(undo.document).toEqual(before.document);const redo=await(await fetch(`${base}/documents/${id}/redo`,request('POST',{expectedRevision:3}))).json();expect(redo.document).toEqual(after.document);
},30000);
