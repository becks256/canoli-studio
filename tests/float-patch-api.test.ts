import {beforeAll,afterAll,it,expect} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {AdjustmentLayer,PatchAdjustment} from '../src/dom';
import {encodeFloatPatchAsset} from '../src/core/float-patch-codec';
import {readProject} from '../src/core/project';
import {SCHEMA_VERSION} from '../src/core/model';
const server=createApiServer({authToken:'native-patch-test'}),auth={authorization:'Bearer native-patch-test'};let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});
it('independent REST validates complete native correction originals before atomic revision, locks, Undo and project publication',async()=>{
 const made=await(await fetch(base+'/documents',json({name:'Independent native patch',width:64,height:48}))).json(),url=base+'/documents/'+made.document.id;
 const init=await(await fetch(url+'/commands',json({expectedRevision:0,commands:[{type:'document.precision.float'}]}))).json();
 const original=await encodeFloatPatchAsset(new Float32Array([4,-2,8,.375,16,-8,4,.125]),new Float32Array([.64123,1e-6]),2,1),imported=await fetch(url+`/tiff-import?expectedRevision=${init.revision}&name=Correction.tif`,{method:'POST',headers:{...auth,'content-type':'image/tiff','x-tiff-options':JSON.stringify({editingPrecision:'float32'})},body:original});expect(imported.status,await imported.clone().text()).toBe(201);const source=await imported.json(),before=await(await fetch(url,{headers:auth})).json();
 const layer=new AdjustmentLayer({name:'Native correction',adjustment:new PatchAdjustment({precision:'float32',assetId:source.assetId,width:12,height:6})}).toJSON();if(layer.kind!=='adjustment')throw new Error('No correction');
 for(const adjustment of [{...layer.adjustment,assetId:'missing-source'},{...layer.adjustment,precision:undefined},{...layer.adjustment,precision:'uint8'},{...layer.adjustment,width:0}]){
  const reply=await fetch(url+'/commands',json({expectedRevision:before.revision,commands:[{type:'document.rename',name:'Must roll back'},{type:'layer.add',layer:{...layer,adjustment}}]}));expect(reply.status).toBe(400);expect(await(await fetch(url,{headers:auth})).json()).toEqual(before);
 }
 const changed=await fetch(url+'/commands',json({expectedRevision:before.revision,commands:[{type:'layer.add',layer}]}));expect(changed.status,await changed.clone().text()).toBe(200);const after=await changed.json();expect(after.revision).toBe(before.revision+1);expect(after.document.schemaVersion).toBe(SCHEMA_VERSION);expect(after.document.children.find((node:{id:string})=>node.id===layer.id)).toEqual(layer);
 expect((await fetch(url+'/commands',json({expectedRevision:before.revision,commands:[{type:'layer.update',id:layer.id,patch:{opacity:.5}}]}))).status).toBe(409);
 const locked=await(await fetch(url+'/commands',json({expectedRevision:after.revision,commands:[{type:'layer.update',id:layer.id,patch:{locked:true}}]}))).json();expect((await fetch(url+'/commands',json({expectedRevision:locked.revision,commands:[{type:'layer.update',id:layer.id,patch:{adjustment:layer.adjustment}}]}))).status).toBe(400);
 const unlocked=await(await fetch(url+'/undo',json({expectedRevision:locked.revision}))).json();expect(unlocked.document).toEqual(after.document);
 const project=await readProject(await(await fetch(url+'/project?history=true',{headers:auth})).blob());expect(project.document).toEqual(after.document);const entry=project.entries.find(entry=>entry.id===source.assetId);expect(entry?.tiff?.editingPrecision).toBe('float32');expect(Buffer.from(await entry!.blob.arrayBuffer())).toEqual(Buffer.from(await original.arrayBuffer()));
 const undo=await(await fetch(url+'/undo',json({expectedRevision:unlocked.revision}))).json();expect(undo.document).toEqual(before.document);const redo=await(await fetch(url+'/redo',json({expectedRevision:undo.revision}))).json();expect(redo.document).toEqual(after.document);
},30000);
