import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {AlphaChannel,MarqueeSelection} from '../src/dom';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
const server=createApiServer();let base:string,kernel:PixelKernel;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
function alphas(selection:any){return Array.from(renderSelection(kernel,{selection,width:4,height:1,x:0,y:0,stepX:1,stepY:1})).filter((_,i)=>i%4===3);}

it('REST alpha channel CRUD and real native loading share fractional Boolean masks, atomic history and strict validation',async()=>{
  const created=await request('/documents',{width:4,height:1}),path=`/documents/${created.body.document.id}`;
  const channel=new AlphaChannel({name:'Soft',selection:new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[1,255,2,128,4,0]}})}).toJSON();
  let current=await request(path+'/commands',{expectedRevision:0,commands:[{type:'alphaChannel.set',channel},{type:'selection.set',selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:4,height:1}).toJSON()}]});
  expect(current.status).toBe(200);expect(current.body.document.alphaChannels).toEqual([channel]);
  const baseline=current.body.document;
  for(const [operation,expected] of [['replace',[255,128,0,0]],['add',[255,255,255,255]],['subtract',[0,127,255,255]],['intersect',[255,128,0,0]]] as const){
    const loaded=await request(path+'/alpha-channel-load',{expectedRevision:current.body.revision,id:channel.id,operation});expect(loaded.status,JSON.stringify(loaded.body)).toBe(200);
    expect(alphas(loaded.body.document.selection)).toEqual(expected);expect(loaded.body.document.alphaChannels).toEqual([channel]);
    current=await request(path+'/undo',{expectedRevision:loaded.body.revision});expect(current.body.document).toEqual(baseline);
  }
  const inverted=await request(path+'/alpha-channel-load',{expectedRevision:current.body.revision,id:channel.id,invert:true});expect(inverted.status).toBe(200);expect(alphas(inverted.body.document.selection)).toEqual([0,127,255,255]);
  for(const invalid of [{id:'missing'},{id:channel.id,operation:'xor'},{id:channel.id,unknown:true}]){
    expect((await request(path+'/alpha-channel-load',{expectedRevision:inverted.body.revision,...invalid})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(inverted.body.document);
  }
  expect((await request(path+'/alpha-channel-load',{expectedRevision:0,id:channel.id})).status).toBe(409);
  const failed=await request(path+'/commands',{expectedRevision:inverted.body.revision,commands:[{type:'alphaChannel.remove',id:channel.id},{type:'alphaChannel.reorder',id:channel.id,direction:'up'}]});expect(failed.status).toBe(400);expect((await request(path)).body.document).toEqual(inverted.body.document);
});

it('50 MP headless channel loading preserves native seams and cannot overwrite a concurrent revision',async()=>{
  const created=await request('/documents',{width:10000,height:5000}),path=`/documents/${created.body.document.id}`;
  const channel=new AlphaChannel({selection:new MarqueeSelection({shape:'rectangle',x:5000,y:0,width:5000,height:5000})}).toJSON();
  const saved=await request(path+'/commands',{expectedRevision:0,commands:[{type:'alphaChannel.set',channel}]});
  const loaded=await request(path+'/alpha-channel-load',{expectedRevision:saved.body.revision,id:channel.id});expect(loaded.status,JSON.stringify(loaded.body)).toBe(200);
  const {coverageAt}=await import('../src/core/pixel-selection');const coverage=loaded.body.document.selection.regions[0].coverage;
  expect([coverage.width,coverage.height]).toEqual([10000,5000]);expect([[0,0],[4999,4999],[5000,0],[9999,4999]].map(([x,y])=>coverageAt(coverage,x,y))).toEqual([0,0,255,255]);
  const pending=request(path+'/alpha-channel-load',{expectedRevision:loaded.body.revision,id:channel.id,invert:true});
  const renamed=await request(path+'/commands',{expectedRevision:loaded.body.revision,commands:[{type:'document.rename',name:'Concurrent'}]});expect(renamed.status).toBe(200);
  expect((await pending).status).toBe(409);expect((await request(path)).body.document).toEqual(renamed.body.document);
},30000);
