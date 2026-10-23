import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {readProject} from '../src/core/project';
import {openPngRows} from '../server/png-rows';
import lensBuild from '../src/core/interchange/lens/codec/build.json';

const server=createApiServer({authToken:'profile-test'});let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const auth={authorization:'Bearer profile-test'},json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});
const manifest=JSON.parse(await readFile('tests/fixtures/raw-profile/manifest.json','utf8'));
async function rgba(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),parts:Uint8ClampedArray[]=[];for await(const strip of image.strips)parts.push(strip.pixels);return Buffer.concat(parts.map(p=>Buffer.from(p)));}
async function imported(){
  const created=await(await fetch(base+'/documents',json({name:'Calibrated RAW',width:64,height:48}))).json(),id=created.document.id,bytes=await readFile('tests/fixtures/raw/bayer-rggb.dng');
  const response=await fetch(`${base}/documents/${id}/raw-import?expectedRevision=0&name=Profile.dng`,{method:'POST',headers:{...auth,'content-type':'image/x-adobe-dng','x-raw-options':'{"allowPrecisionLoss":true}'},body:new Blob([new Uint8Array(bytes)])});expect(response.status).toBe(201);
  return{id,bytes,before:await response.json()};
}

it('REST calibrated development retains exact independent pixels, full tables, native provenance and atomic project history',async()=>{
  const {id,bytes,before}=await imported(),fixture=manifest.cases.find((value:{file:string})=>value.file.includes('ptlens-bayer'));
  const response=await fetch(`${base}/documents/${id}/raw-develop`,json({expectedRevision:1,layerId:before.layerId,options:{allowPrecisionLoss:true,development:{lens:fixture.options}}}));expect(response.status,await response.clone().text()).toBe(200);const after=await response.json(),assetId=after.document.components[0].source.assetId;
  const png=await(await fetch(`${base}/documents/${id}/assets/${assetId}?raw=true`,{headers:auth})).blob();expect(await rgba(png)).toEqual(await rgba(new Blob([new Uint8Array(await readFile('tests/fixtures/raw-profile/'+fixture.file))])));
  const saved=await readProject(await(await fetch(`${base}/documents/${id}/project?history=true`,{headers:auth})).blob()),source=saved.entries.find(entry=>entry.id===assetId)!.raw!;
  expect(source.settings.development.lens!.profile!.definition).toMatchObject(fixture.options.profile.definition);expect(source.lensWasmSha256).toBe(lensBuild.artifacts['canoli_lens_correction.wasm'].sha256);expect(Buffer.from(await source.originalBlob.arrayBuffer())).toEqual(bytes);expect(saved.history?.past.at(-1)?.label).toBe('Develop RAW');
  const invalid=structuredClone(fixture.options);for(const set of invalid.profile.definition.calibrations)for(const point of set.distortion)point.terms=[-1,0,0];
  const rejected=await fetch(`${base}/documents/${id}/raw-develop`,json({expectedRevision:2,layerId:before.layerId,options:{allowPrecisionLoss:true,development:{lens:invalid}}}));expect(rejected.status).toBe(400);
  const retained=await(await fetch(`${base}/documents/${id}`,{headers:auth})).json();expect(retained.document).toEqual(after.document);expect(retained.revision).toBe(2);
  const undone=await(await fetch(`${base}/documents/${id}/undo`,json({expectedRevision:2}))).json();expect(undone.document).toEqual(before.document);
  const redone=await(await fetch(`${base}/documents/${id}/redo`,json({expectedRevision:3}))).json();expect(redone.document).toEqual(after.document);
},30000);

it('REST transports complete calibration tables larger than the ordinary command metadata budget in JSON',async()=>{
  const {id,before}=await imported(),definition={model:'Large explicit calibration table',focalRange:{min:1,max:14000},calibrations:[{cropFactor:1.5,distortion:Array.from({length:14000},(_,i)=>({model:'poly3',focalLength:i+1,realFocalLength:(i+1)*1.02,terms:[-.02]}))}]};
  const request={expectedRevision:1,layerId:before.layerId,options:{allowPrecisionLoss:true,development:{lens:{profile:{definition,focalLength:43,cropFactor:1.5}}}}};expect(Buffer.byteLength(JSON.stringify(request))).toBeGreaterThan(1_000_000);
  const response=await fetch(`${base}/documents/${id}/raw-develop`,json(request));expect(response.status,await response.clone().text()).toBe(200);const after=await response.json(),assetId=after.document.components[0].source.assetId;
  const metadata=await(await fetch(`${base}/documents/${id}/assets/${assetId}`,{headers:auth})).json();expect(metadata.asset.raw.settings.development.lens.profile.definition.calibrations[0].distortion).toHaveLength(14000);expect(metadata.asset.raw.lensWasmSha256).toBe(lensBuild.artifacts['canoli_lens_correction.wasm'].sha256);expect(after.revision).toBe(2);
},60000);
