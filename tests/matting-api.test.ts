import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {RasterLayer,LayerGroup,AffineTransform,LayerMask,MarqueeSelection} from '../src/dom';
import {openPngRows} from '../server/png-rows';
import {encodeRgbaPng} from '../src/engine/png';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
async function upload(path:string,name:string){const bytes=await readFile('tests/fixtures/matting/'+name),response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(bytes)});return{bytes,asset:(await response.json()).asset};}
async function decoded(path:string,assetId:string){const bytes=new Uint8Array(await(await fetch(base+path+'/assets/'+assetId+'?raw=true')).arrayBuffer()),image=openPngRows(bytes),pixels=new Uint8Array(image.width*image.height*4);for await(const strip of image.strips)pixels.set(strip.pixels,strip.y*image.width*4);return{width:image.width,height:image.height,pixels};}

it('the real REST worker loads a multi-chunk graph through its tsx loader and retains independent native pixels',async()=>{
  const fixture=JSON.parse(await readFile('tests/fixtures/matting/closed-form-reference.json','utf8')).cases.find((item:{name:string})=>item.name==='distant-native-patch');
  const created=await request('/documents',{width:fixture.width,height:fixture.height}),path=`/documents/${created.body.document.id}`;
  const put=async(pixels:Uint8Array)=>{
    const png=await encodeRgbaPng(pixels,fixture.width,fixture.height),response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:png});
    expect(response.status).toBe(201);return(await response.json()).asset;
  };
  const sourceBytes=new Uint8Array(fixture.rgba),labels=new Uint8Array(fixture.width*fixture.height*4);
  fixture.labels.forEach((label:number,i:number)=>{labels[i*4]=labels[i*4+1]=labels[i*4+2]=255;labels[i*4+3]=label;});
  const source=await put(sourceBytes),trimap=await put(labels),layer=new RasterLayer({assetId:source.id,width:fixture.width,height:fixture.height});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});
  const result=await request(path+'/refine-edge',{expectedRevision:added.body.revision,layerId:layer.id,options:{smoothness:0,trimapAssetId:trimap.id}});
  expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.revision).toBe(added.body.revision+1);
  const output=await decoded(path,result.body.document.children[0].mask.assetId);
  for(let i=0;i<fixture.alpha.length;i++)expect(Math.abs(output.pixels[i*4+3]-fixture.alpha[i])).toBeLessThanOrEqual(1);
  const original=await decoded(path,source.id);expect(original.pixels).toEqual(sourceBytes);
  const undone=await request(path+'/undo',{expectedRevision:result.body.revision});expect(undone.body.document).toEqual(added.body.document);
  const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(result.body.document);
});

it('REST defaults to the global closed-form solution across wide unknown regions with real PNG output',async()=>{
  const fixture=JSON.parse(await readFile('tests/fixtures/matting/closed-form-reference.json','utf8')).cases.find((item:{name:string})=>item.name==='wide-unknown'),created=await request('/documents',{width:fixture.width,height:fixture.height}),path=`/documents/${created.body.document.id}`;
  const source=await upload(path,'closed-form-wide-unknown.png'),trimap=await upload(path,'closed-form-wide-unknown-trimap.png'),layer=new RasterLayer({assetId:source.asset.id,width:fixture.width,height:fixture.height});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}),result=await request(path+'/refine-edge',{expectedRevision:added.body.revision,layerId:layer.id,options:{smoothness:0,trimapAssetId:trimap.asset.id}});expect(result.status,JSON.stringify(result.body)).toBe(200);
  const output=await decoded(path,result.body.document.children[0].mask.assetId),alpha=Array.from({length:fixture.alpha.length},(_,i)=>output.pixels[i*4+3]),errors=alpha.map((value,i)=>Math.abs(value-fixture.alpha[i]));expect(Math.max(...errors)).toBeLessThanOrEqual(1);expect(errors.reduce((sum,value)=>sum+value,0)/errors.length).toBeLessThan(.02);expect(result.body.revision).toBe(added.body.revision+1);expect(result.body.document.children[0].assetId).toBe(source.asset.id);
  expect(new Uint8Array(await(await fetch(base+path+'/assets/'+source.asset.id+'?raw=true')).arrayBuffer())).toEqual(new Uint8Array(source.bytes));
});

it('REST creates real corrected foreground and matte PNGs in one reversible command while retaining the original',async()=>{
  const created=await request('/documents',{width:9,height:5}),path=`/documents/${created.body.document.id}`,source=await upload(path,'color-line.png'),trimap=await upload(path,'color-line-trimap.png'),layer=new RasterLayer({assetId:source.asset.id,width:9,height:5,name:'Original'});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});
  const result=await request(path+'/refine-edge',{expectedRevision:added.body.revision,layerId:layer.id,options:{solver:'color-line',radius:25,smoothness:0,decontaminate:true,trimapAssetId:trimap.asset.id}});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.revision).toBe(added.body.revision+1);
  const [original,output]=result.body.document.children;expect(original).toEqual({...layer.toJSON(),visible:false});expect(output.assetId).not.toBe(source.asset.id);expect(output.mask.kind).toBe('bitmap');
  const color=await decoded(path,output.assetId),mask=await decoded(path,output.mask.assetId);expect([color.width,color.height]).toEqual([9,5]);expect(Array.from(color.pixels.slice((2*9+4)*4,(2*9+5)*4))).toEqual([199,20,11,255]);expect(Array.from({length:9},(_,x)=>mask.pixels[(2*9+x)*4+3])).toEqual([255,255,204,166,128,89,51,0,0]);
  expect(new Uint8Array(await(await fetch(base+path+'/assets/'+source.asset.id+'?raw=true')).arrayBuffer())).toEqual(new Uint8Array(source.bytes));
  const undo=await request(path+'/undo',{expectedRevision:result.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(result.body.document);
  for(const options of [{decontaminate:true,outputTo:'mask'},{radius:-1},{smooth:1,smoothness:2},{trimapAssetId:'missing'},{unknown:true}]){
    const before=(await request(path)).body;expect((await request(path+'/refine-edge',{expectedRevision:before.revision,layerId:layer.id,options})).status).toBe(400);expect((await request(path)).body.document).toEqual(before.document);
  }
});

it('headless mask sampling respects full placement, effective density/inversion and one shared history entry',async()=>{
  const created=await request('/documents',{width:100,height:80}),path=`/documents/${created.body.document.id}`,source=await upload(path,'color-line.png'),group=new LayerGroup();group.transform=AffineTransform.translation(40,20).multiply(AffineTransform.rotation(Math.PI/2));
  const layer=group.layers.add(new RasterLayer({assetId:source.asset.id,width:18,height:10,x:2,y:3}));layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:9,height:10}),density:.5,inverted:true});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});
  const result=await request(path+'/refine-edge',{expectedRevision:added.body.revision,layerId:layer.id,options:{radius:0,smoothness:0}});expect(result.status,JSON.stringify(result.body)).toBe(200);
  // Source center 4.5 maps to the local x=9 edge; its sampled document-pixel center is outside.
  const mask=await decoded(path,result.body.document.children[0].children[0].mask.assetId);expect(Array.from({length:9},(_,x)=>mask.pixels[(2*9+x)*4+3])).toEqual([128,128,128,128,255,255,255,255,255]);
  expect(result.body.document.children[0].children[0].mask.basis).toEqual({a:2,b:0,c:0,d:2,e:0,f:0});
});

it('native 50 MP REST refinement retains distant partial alpha and rejects stale work without installing assets',async()=>{
  const fixture=JSON.parse(await readFile('tests/fixtures/matting/native-50mp.json','utf8')),created=await request('/documents',{width:10000,height:5000}),path=`/documents/${created.body.document.id}`,source=await upload(path,'native-50mp.png'),layer=new RasterLayer({assetId:source.asset.id,width:10000,height:5000});
  const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}),start=performance.now();
  const result=await request(path+'/refine-edge',{expectedRevision:added.body.revision,layerId:layer.id,options:{radius:0,smoothness:0}});expect(result.status,JSON.stringify(result.body)).toBe(200);
  const mask=await decoded(path,result.body.document.children[0].mask.assetId),samples=fixture.points.map(([x,y]:number[])=>mask.pixels[(y*10000+x)*4+3]);expect(samples).toEqual(fixture.alpha.map((value:number)=>value?255:0));
  await writeFile('/tmp/canoli-matting-rest.json',JSON.stringify({milliseconds:performance.now()-start,width:mask.width,height:mask.height,samples}));
  const assets=(await request(path+'/assets')).body,pending=request(path+'/refine-edge',{expectedRevision:result.body.revision,layerId:layer.id,options:{radius:10}}),renamed=await request(path+'/commands',{expectedRevision:result.body.revision,commands:[{type:'document.rename',name:'Concurrent'}]});expect(renamed.status).toBe(200);expect((await pending).status).toBe(409);expect((await request(path)).body.document).toEqual(renamed.body.document);expect((await request(path+'/assets')).body).toEqual(assets);
},120000);
