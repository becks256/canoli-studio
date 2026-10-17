import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
import {colorRangeCoverage} from '../src/core/color-range';
const server=createApiServer();let base:string,kernel:PixelKernel;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
async function upload(path:string,file:string){const bytes=await readFile('tests/fixtures/color-range/'+file),response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(bytes)});return{bytes,body:await response.json()};}
function alpha(document:any){return Array.from(renderSelection(kernel,{selection:document.selection??{regions:[]},width:document.width,height:document.height,x:0,y:0,stepX:1,stepY:1})).filter((_,i)=>i%4===3);}

it('real PNG Color Range REST sampling shares native coverage, clipping, revision checks and atomic undo',async()=>{
  const created=await request('/documents',{width:6,height:6}),path=`/documents/${created.body.document.id}`;
  const asset=await upload(path,'filters-type-6.png'),source={kind:'asset' as const,assetId:asset.body.asset.id,x:-1,y:1};
  const options={colors:['#6f339f'],exclude:['#000000'],fuzziness:70,source};
  const selected=await request(path+'/color-range',{expectedRevision:0,...options});expect(selected.status,JSON.stringify(selected.body)).toBe(200);
  const fixture=JSON.parse(await readFile('tests/fixtures/color-range/png-reference.json','utf8')).find((value:any)=>value.file==='filters-type-6.png');
  const expected=Array(36).fill(0),coverage=colorRangeCoverage(new Uint8ClampedArray(fixture.expected),options);
  for(let y=0;y<5;y++)for(let x=1;x<7;x++)expected[(y+1)*6+x-1]=coverage[y*7+x];expect(alpha(selected.body.document)).toEqual(expected);
  for(const invalid of [{...options,colors:[]},{...options,fuzziness:201},{...options,unknown:true},{...options,source:{kind:'merged'}}]){
    expect((await request(path+'/color-range',{expectedRevision:selected.body.revision,...invalid})).status).toBe(400);
    expect((await request(path)).body.document).toEqual(selected.body.document);
  }
  expect((await request(path+'/color-range',{expectedRevision:0,...options})).status).toBe(409);
  const undone=await request(path+'/undo',{expectedRevision:selected.body.revision});expect(undone.body.document).toEqual(created.body.document);
  const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(selected.body.document);
  const second=await request(path+'/color-range',{expectedRevision:redone.body.revision,...options,operation:'subtract'});expect(second.status).toBe(200);
  const downloaded=await fetch(base+path+'/assets/'+asset.body.asset.id+'?raw=true');expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(new Uint8Array(asset.bytes));
});

it('malformed or unsupported PNG sources fail without replacing the selection',async()=>{
  const created=await request('/documents',{width:8,height:8}),path=`/documents/${created.body.document.id}`;
  const selected=await request(path+'/commands',{expectedRevision:0,commands:[{type:'selection.set',selection:{regions:[{shape:'rectangle',operation:'add',x:0,y:0,width:8,height:8}]}}]});
  for(const file of ['unsupported-16bit.png','unsupported-profile.png']){
    const asset=await upload(path,file),result=await request(path+'/color-range',{expectedRevision:selected.body.revision,colors:['#ff0000'],source:{kind:'asset',assetId:asset.body.asset.id}});
    expect(result.status,JSON.stringify(result.body)).toBe(400);expect((await request(path)).body.document).toEqual(selected.body.document);
  }
});

it('native 50 MP PNG sampling stays asynchronous and cannot overwrite a concurrent REST revision',async()=>{
  const created=await request('/documents',{width:10000,height:5000}),path=`/documents/${created.body.document.id}`,asset=await upload(path,'native-50mp.png');
  const start=performance.now(),selected=await request(path+'/color-range',{expectedRevision:0,colors:['#ff0000'],fuzziness:0,source:{kind:'asset',assetId:asset.body.asset.id}});
  expect(selected.status,JSON.stringify(selected.body)).toBe(200);expect(selected.body.document.selection.regions[0].coverage.width).toBe(10000);expect(selected.body.document.selection.regions[0].coverage.height).toBe(5000);
  const {coverageAt}=await import('../src/core/pixel-selection');const coverage=selected.body.document.selection.regions[0].coverage;
  expect([[0,0],[9999,0],[0,4999],[9999,4999]].map(([x,y])=>coverageAt(coverage,x,y))).toEqual([255,0,0,255]);
  console.log('50 MP REST Color Range:',(performance.now()-start).toFixed(1),'ms');
  await writeFile('/tmp/canoli-color-range-rest.json',JSON.stringify({width:10000,height:5000,elapsedMs:performance.now()-start,nativeCorners:[255,0,0,255],boundedPngStrips:true}));
  const pending=request(path+'/color-range',{expectedRevision:selected.body.revision,colors:['#0000ff'],fuzziness:40,source:{kind:'asset',assetId:asset.body.asset.id}});
  const renamed=await request(path+'/commands',{expectedRevision:selected.body.revision,commands:[{type:'document.rename',name:'Concurrent'}]});expect(renamed.status).toBe(200);
  expect((await pending).status).toBe(409);expect((await request(path)).body.document).toEqual(renamed.body.document);
},60000);
