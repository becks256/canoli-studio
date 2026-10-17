import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {RasterLayer,LayerGroup} from '../src/dom';
import {encodeRgbaPng} from '../src/engine/png';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
const server=createApiServer();let base:string,kernel:PixelKernel;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
async function upload(path:string,bytes:Uint8Array){const response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:bytes as Uint8Array<ArrayBuffer>});return(await response.json()).asset;}

it('REST derives genuine native source coverage, maps nested placement and retains fractional holes and undo',async()=>{
  const created=await request('/documents',{width:40,height:40}),path=`/documents/${created.body.document.id}`,pixels=new Uint8Array(9*7*4);
  for(const [x,y,alpha] of [[2,2,255],[3,2,128],[2,3,255],[4,3,255],[7,5,64]])pixels.set([255,0,0,alpha],(y*9+x)*4);
  const bytes=new Uint8Array(await(await encodeRgbaPng(pixels,9,7)).arrayBuffer()),asset=await upload(path,bytes);
  const group=new LayerGroup({x:10,y:20}),layer=group.layers.add(new RasterLayer({assetId:asset.id,x:2,y:3,width:18,height:14,visible:false,locked:true}));
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});expect(added.status).toBe(200);
  const selected=await request(path+'/select-subject',{expectedRevision:added.body.revision,targetLayerId:layer.id});expect(selected.status,JSON.stringify(selected.body)).toBe(200);
  const rgba=renderSelection(kernel,{selection:selected.body.document.selection,width:40,height:40,x:0,y:0,stepX:1,stepY:1});
  expect([[16,27],[18,27],[18,29],[26,33],[0,0]].map(([x,y])=>rgba[(y*40+x)*4+3])).toEqual([255,128,0,64,0]);
  for(const invalid of [{threshold:2},{expandRadius:.5},{targetLayerId:'missing'},{source:'fake'}]){
    expect((await request(path+'/select-subject',{expectedRevision:selected.body.revision,targetLayerId:layer.id,...invalid})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(selected.body.document);
  }
  expect((await request(path+'/select-subject',{expectedRevision:0,targetLayerId:layer.id})).status).toBe(409);
  const undo=await request(path+'/undo',{expectedRevision:selected.body.revision});expect(undo.body.document).toEqual(added.body.document);
  const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(selected.body.document);
  expect(new Uint8Array(await(await fetch(base+path+'/assets/'+asset.id+'?raw=true')).arrayBuffer())).toEqual(bytes);
});

it('uniform, missing and unsupported sources never replace existing REST selection',async()=>{
  const created=await request('/documents',{width:8,height:8}),path=`/documents/${created.body.document.id}`;
  const uniform=new Uint8Array(8*8*4).fill(255),asset=await upload(path,new Uint8Array(await(await encodeRgbaPng(uniform,8,8)).arrayBuffer()));
  const layer=new RasterLayer({assetId:asset.id,width:8,height:8}),added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()},{type:'selection.set',selection:{regions:[{shape:'rectangle',x:1,y:1,width:2,height:2,operation:'add'}]}}]});
  for(const options of [{targetLayerId:layer.id},{targetLayerId:'missing'},{}]){
    const failed=await request(path+'/select-subject',{expectedRevision:added.body.revision,...options});expect(failed.status).toBe(400);expect((await request(path)).body.document).toEqual(added.body.document);
  }
  for(const name of ['unsupported-16bit.png','unsupported-profile.png']){
    const bad=await upload(path,new Uint8Array(await readFile('tests/fixtures/color-range/'+name))),target=new RasterLayer({assetId:bad.id,width:bad.width,height:bad.height});
    const withTarget=await request(path+'/commands',{expectedRevision:(await request(path)).body.revision,commands:[{type:'layer.add',layer:target.toJSON()}]});
    expect((await request(path+'/select-subject',{expectedRevision:withTarget.body.revision,targetLayerId:target.id})).status).toBe(400);expect((await request(path)).body.document).toEqual(withTarget.body.document);
  }
});

it('actual 50 MP subject PNG preserves distant single-pixel alpha and rejects concurrent revisions',async()=>{
  const fixture=JSON.parse(await readFile('tests/fixtures/matting/native-50mp.json','utf8')),bytes=new Uint8Array(await readFile('tests/fixtures/matting/native-50mp.png'));
  const created=await request('/documents',{width:fixture.width,height:fixture.height}),path=`/documents/${created.body.document.id}`,asset=await upload(path,bytes),layer=new RasterLayer({assetId:asset.id,width:fixture.width,height:fixture.height});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}),start=performance.now();
  const selected=await request(path+'/select-subject',{expectedRevision:added.body.revision,targetLayerId:layer.id});expect(selected.status,JSON.stringify(selected.body)).toBe(200);
  const {coverageAt}=await import('../src/core/pixel-selection'),coverage=selected.body.document.selection.regions[0].coverage;
  const samples=fixture.points.map(([x,y]:number[])=>coverageAt(coverage,x,y));expect(samples).toEqual(fixture.alpha);
  await writeFile('/tmp/canoli-subject-rest.json',JSON.stringify({milliseconds:performance.now()-start,width:coverage.width,height:coverage.height,samples}));
  const pending=request(path+'/select-subject',{expectedRevision:selected.body.revision,targetLayerId:layer.id});
  const renamed=await request(path+'/commands',{expectedRevision:selected.body.revision,commands:[{type:'document.rename',name:'Concurrent'}]});expect(renamed.status).toBe(200);expect((await pending).status).toBe(409);expect((await request(path)).body.document).toEqual(renamed.body.document);
},60000);
