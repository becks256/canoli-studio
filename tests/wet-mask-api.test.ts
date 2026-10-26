import {SCHEMA_VERSION as CURRENT_DOCUMENT_SCHEMA} from '../src/core/model';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {Document,LayerMask,PaintLayer,BrushStroke,WetPaintStroke} from '../src/dom';
import {PngRowEncoder} from '../src/core/png-stream';

const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const request=async(path:string,data?:unknown)=>{const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};};

for(const filter of [false,true])it(`validates native prepared ${filter?'filter':'ordinary'} mask assets atomically with stale, invalid, undo and redo checks`,async()=>{
 const created=await request('/documents',{width:16,height:16}),endpoint=`/documents/${created.body.document.id}`,owner=new Document({width:16,height:16});
 const target=filter?owner.placeSmartObject(owner.defineComponent(new Document({width:16,height:16}))):new PaintLayer();
 const commands=[...(filter?[{type:'component.set',definition:owner.toJSON().components![0]}]:[]),{type:'layer.add',layer:target.toJSON()}];
 const added=await request(endpoint+'/commands',{expectedRevision:0,commands});expect(added.status).toBe(200);
 const upload=async(alpha:number)=>{const png=new PngRowEncoder(1,1);await png.append(new Uint8Array([255,255,255,alpha]),1);const blob=await png.finish(),response=await request(endpoint+'/assets',{name:'Mask pixels',width:1,height:1,contentType:'image/png',data:Buffer.from(await blob.arrayBuffer()).toString('base64')});expect(response.status).toBe(201);return response.body.asset.id as string;};
 const output=await upload(128),support=await upload(255),empty=await upload(0);
 const mask=(coverage:string,opacity=1)=>new LayerMask({base:1}).applyWetPaint(new WetPaintStroke({opacity,brush:new BrushStroke({points:[{x:4.5,y:4.5}]}),tiles:[{x:4,y:4,width:1,height:1,assetId:output,coverage:{assetId:coverage}}]})).toJSON();
 const command=(value:ReturnType<typeof mask>)=>filter?{type:'smartObject.filterMask',id:target.id,mask:value}:{type:'layer.update',id:target.id,patch:{mask:value}};
 for(const [coverage,opacity] of [[empty,1],[empty,0],['missing',1]] as const){const bad=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Rejected'},command(mask(coverage,opacity))]});expect(bad.status,JSON.stringify(bad.body)).toBe(400);expect((await request(endpoint)).body.document).toEqual(added.body.document);}
 const changed=await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[command(mask(support))]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);
 expect(changed.body.document.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);expect(changed.body.document.children[0][filter?'filterMask':'mask'].strokes[0].mode).toBe('wet');
 expect((await request(endpoint+'/commands',{expectedRevision:added.body.revision,commands:[{type:'document.rename',name:'Stale'}]})).status).toBe(409);
 const undo=await request(endpoint+'/undo',{expectedRevision:changed.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(endpoint+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(changed.body.document);
});
