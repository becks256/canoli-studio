import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
const server=createApiServer();let base:string,kernel:PixelKernel;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
async function upload(path:string,name:string){const bytes=await readFile('tests/fixtures/color-range/'+name),response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(bytes)});return{bytes,body:await response.json()};}

it('native PNG Quick Selection respects document placement, strict validation, immutable assets and shared undo',async()=>{
  const created=await request('/documents',{width:10,height:8}),path=`/documents/${created.body.document.id}`,asset=await upload(path,'filters-type-6.png');
  const fixture=JSON.parse(await readFile('tests/fixtures/color-range/png-reference.json','utf8')).find((value:any)=>value.file==='filters-type-6.png');
  const index=Array.from({length:35},(_,i)=>i).find(i=>fixture.expected[i*4+3]===255)!;
  const x=index%7+1,y=Math.floor(index/7)+2,options={points:[{x:x+.5,y:y+.5}],size:.5,tolerance:0,edgeThreshold:0,source:{kind:'asset',assetId:asset.body.asset.id,x:1,y:2}};
  const selected=await request(path+'/quick-selection',{expectedRevision:0,...options});expect(selected.status,JSON.stringify(selected.body)).toBe(200);
  const pixels=renderSelection(kernel,{selection:selected.body.document.selection,width:10,height:8,x:0,y:0,stepX:1,stepY:1}),expected=Array(80).fill(0);expected[y*10+x]=255;expect(Array.from(pixels).filter((_,i)=>i%4===3)).toEqual(expected);
  for(const invalid of [{...options,points:[]},{...options,size:513},{...options,unknown:true},{...options,source:{kind:'merged'}}]){
    expect((await request(path+'/quick-selection',{expectedRevision:selected.body.revision,...invalid})).status).toBe(400);expect((await request(path)).body.document).toEqual(selected.body.document);
  }
  expect((await request(path+'/quick-selection',{expectedRevision:0,...options})).status).toBe(409);
  const undo=await request(path+'/undo',{expectedRevision:selected.body.revision});expect(undo.body.document).toEqual(created.body.document);
  const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(selected.body.document);
  expect(new Uint8Array(await(await fetch(base+path+'/assets/'+asset.body.asset.id+'?raw=true')).arrayBuffer())).toEqual(new Uint8Array(asset.bytes));
});

it('unsupported headless sources reject without replacing an existing selection',async()=>{
  const created=await request('/documents',{width:8,height:8}),path=`/documents/${created.body.document.id}`;
  const before=await request(path+'/commands',{expectedRevision:0,commands:[{type:'selection.set',selection:{regions:[{shape:'rectangle',x:0,y:0,width:8,height:8,operation:'add'}]}}]});
  for(const name of ['unsupported-16bit.png','unsupported-profile.png']){
    const asset=await upload(path,name),result=await request(path+'/quick-selection',{expectedRevision:before.body.revision,points:[{x:1,y:1}],source:{kind:'asset',assetId:asset.body.asset.id}});expect(result.status).toBe(400);expect((await request(path)).body.document).toEqual(before.body.document);
  }
});

it('native 50 MP REST Quick Selection keeps connected components and rejects concurrent changes',async()=>{
  const created=await request('/documents',{width:10000,height:5000}),path=`/documents/${created.body.document.id}`,asset=await upload(path,'native-50mp.png');
  const options={points:[{x:.5,y:.5}],size:.5,tolerance:0,edgeThreshold:0,source:{kind:'asset',assetId:asset.body.asset.id}},start=performance.now();
  const selected=await request(path+'/quick-selection',{expectedRevision:0,...options});expect(selected.status,JSON.stringify(selected.body)).toBe(200);
  const {coverageAt}=await import('../src/core/pixel-selection'),coverage=selected.body.document.selection.regions[0].coverage;
  const samples=[[0,0],[511,511],[512,512],[4999,2499],[5000,2499],[0,4999],[9999,4999]].map(([x,y])=>coverageAt(coverage,x,y));expect(samples).toEqual([255,255,255,255,0,0,0]);
  await writeFile('/tmp/canoli-quick-rest.json',JSON.stringify({width:10000,height:5000,milliseconds:performance.now()-start,samples}));
  const pending=request(path+'/quick-selection',{expectedRevision:selected.body.revision,...options});
  const renamed=await request(path+'/commands',{expectedRevision:selected.body.revision,commands:[{type:'document.rename',name:'Concurrent'}]});expect(renamed.status).toBe(200);expect((await pending).status).toBe(409);expect((await request(path)).body.document).toEqual(renamed.body.document);
},60000);
