import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {RasterLayer,TextLayer,LayerGroup,AffineTransform} from '../src/dom';
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

it('REST alignment policy reports affine authored geometry against an independent locked key without an edit',async()=>{
 const created=await request('/documents',{width:300,height:200}),path=`/documents/${created.body.document.id}`,group=new LayerGroup({name:'Parent'});group.transform=new AffineTransform(0,1,-1,0,80,20);
 const target=group.layers.add(new TextLayer({name:'Target',text:'AA',fontSize:20,x:10,y:5})),reference=new TextLayer({name:'Reference',text:'AAAA',fontSize:20,x:100,y:40,locked:true}),added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()},{type:'layer.add',layer:reference.toJSON()}]}),before=(await request(path)).body;
 const result=await request(path+'/preflight',{expectedRevision:added.body.revision,options:{checkBounds:false,checkFonts:false,alignments:[{layerIds:[target.id],alignment:'left',target:{type:'layer',id:reference.id},tolerance:0}]}});expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.report).toMatchObject({version:2,alignment:{rules:1,requested:1,mismatched:1,matched:0}});expect(result.body.report.findings[0]).toMatchObject({code:'alignment-mismatch',layerId:target.id,path:[group.id,target.id],alignment:{actual:51,expected:100,delta:49}});expect((await request(path)).body).toEqual(before);
});
it('REST rejects stale, malformed and missing alignment targets while retaining exact current document data',async()=>{
 const created=await request('/documents',{}),path=`/documents/${created.body.document.id}`,text=new TextLayer({text:'AA'}),added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:text.toJSON()}]}),before=(await request(path)).body;
 expect((await request(path+'/preflight',{expectedRevision:0,options:{alignments:[]}})).status).toBe(409);
 for(const policy of [{layerIds:['missing'],alignment:'left',target:{type:'canvas'}},{layerIds:[text.id],alignment:'left',target:{type:'layer',id:'missing'}},{layerIds:[text.id],alignment:'left',target:{type:'canvas'},tolerance:-1},{layerIds:[text.id],alignment:'left',target:{type:'selection'}}]){expect((await request(path+'/preflight',{expectedRevision:added.body.revision,options:{alignments:[policy]}})).status).toBe(400);expect((await request(path)).body).toEqual(before);}
});
