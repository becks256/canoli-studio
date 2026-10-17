import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {RasterLayer,TextLayer} from '../src/dom';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,body:await r.json()};}

it('REST inspects real original asset dimensions without history changes and reports unverified local fonts',async()=>{
 const created=await request('/documents',{width:9,height:5}),path=`/documents/${created.body.document.id}`,bytes=await readFile('tests/fixtures/matting/color-line.png');
 const response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(bytes)}),asset=(await response.json()).asset;
 const layer=new RasterLayer({assetId:asset.id,width:18,height:10}),text=new TextLayer({fontFamily:'Not provided by REST'});
 const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()},{type:'layer.add',layer:text.toJSON()}]});
 const before=(await request(path)).body,result=await request(path+'/preflight',{expectedRevision:added.body.revision,options:{outputDpi:300,minimumPpi:200}});
 expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.report.revision).toBe(added.body.revision);
 expect(result.body.report.findings.find((f:{code:string})=>f.code==='low-resolution').effectivePpi).toBe(150);
 expect(result.body.report.fonts).toEqual([{family:'Not provided by REST',status:'unknown'}]);expect(result.body.report.findings.some((f:{code:string})=>f.code==='font-unchecked')).toBe(true);
 expect((await request(path)).body).toEqual(before);
 expect(new Uint8Array(await(await fetch(base+path+'/assets/'+asset.id+'?raw=true')).arrayBuffer())).toEqual(new Uint8Array(bytes));
});

it('REST rejects stale revisions and malformed policies without changing document or assets',async()=>{
 const created=await request('/documents',{}),path=`/documents/${created.body.document.id}`,before=(await request(path)).body;
 expect((await request(path+'/preflight',{expectedRevision:1})).status).toBe(409);
 for(const options of [{minimumPpi:0},{outputDpi:-10},{checkFonts:'yes'},{cloud:true}])expect((await request(path+'/preflight',{expectedRevision:0,options})).status).toBe(400);
 expect((await request(path)).body).toEqual(before);expect((await request(path+'/assets')).body).toEqual({assets:[]});
});

it('REST checks a genuine 50 MP source using metadata rather than proxy dimensions or decoding pixels',async()=>{
 const created=await request('/documents',{width:10000,height:5000}),path=`/documents/${created.body.document.id}`,bytes=await readFile('tests/fixtures/matting/native-50mp.png');
 const response=await fetch(base+path+'/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(bytes)}),asset=(await response.json()).asset,layer=new RasterLayer({assetId:asset.id,width:10000,height:5000});
 const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}),result=await request(path+'/preflight',{expectedRevision:added.body.revision});
 expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.report.findings).toEqual([]);expect(result.body.report.layersChecked).toBe(1);expect((await request(path)).body.revision).toBe(added.body.revision);
});
