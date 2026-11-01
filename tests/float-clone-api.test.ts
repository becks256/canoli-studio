import {beforeAll,afterAll,it,expect} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {PaintLayer,CloneStroke} from '../src/dom';
import {encodeFloatWetTile} from '../src/core/float-wet-tile';
import {readProject} from '../src/core/project';
import {SCHEMA_VERSION} from '../src/core/model';
const server=createApiServer({authToken:'native-clone-test'}),auth={authorization:'Bearer native-clone-test'};let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});
it('independent REST validates native clone originals before atomic revision/history/project publication',async()=>{
 const made=await(await fetch(base+'/documents',json({name:'Independent native clone',width:64,height:48}))).json(),endpoint=base+'/documents/'+made.document.id,paint=new PaintLayer({name:'Native clone target'});
 const init=await fetch(endpoint+'/commands',json({expectedRevision:0,commands:[{type:'document.precision.float'},{type:'layer.add',layer:paint.toJSON()}]}));expect(init.status).toBe(200);const initial=await init.json();
 const original=await encodeFloatWetTile(new Float32Array([4,-2,8,.375,16,-8,4,.125]),2,1),imported=await fetch(endpoint+`/tiff-import?expectedRevision=${initial.revision}&name=Native.tif`,{method:'POST',headers:{...auth,'content-type':'image/tiff','x-tiff-options':JSON.stringify({editingPrecision:'float32'})},body:original});expect(imported.status,await imported.clone().text()).toBe(201);const source=await imported.json(),before=await(await fetch(endpoint,{headers:auth})).json();
 const stroke=new CloneStroke({precision:'float32',points:[{x:3.5,y:4.5}],size:4,opacity:.64123,tiles:[{x:3,y:4,width:2,height:1,assetId:source.assetId}]}).toJSON();if(stroke.kind!=='clone')throw new Error('No clone');
 const append=(value:unknown)=>({type:'paint.add',id:paint.id,stroke:value});
 for(const invalid of [{...stroke,tiles:[{...stroke.tiles[0],width:1}]},{...stroke,tiles:[{...stroke.tiles[0],assetId:'missing-source'}]},{...stroke,precision:undefined,opacity:0}]){
  const reply=await fetch(endpoint+'/commands',json({expectedRevision:before.revision,commands:[{type:'document.rename',name:'Must roll back'},append(invalid)]}));expect(reply.status).toBe(400);expect(await(await fetch(endpoint,{headers:auth})).json()).toEqual(before);
 }
 const changed=await fetch(endpoint+'/commands',json({expectedRevision:before.revision,commands:[append(stroke)]}));expect(changed.status,await changed.clone().text()).toBe(200);const after=await changed.json();expect(after.revision).toBe(before.revision+1);expect(after.document.schemaVersion).toBe(SCHEMA_VERSION);expect(after.document.children.find((layer:{id:string})=>layer.id===paint.id).strokes).toEqual([stroke]);
 expect((await fetch(endpoint+'/commands',json({expectedRevision:before.revision,commands:[append(stroke)]}))).status).toBe(409);
 const project=await readProject(await(await fetch(endpoint+'/project?history=true',{headers:auth})).blob());expect(project.document).toEqual(after.document);const entry=project.entries.find(entry=>entry.id===source.assetId);expect(entry?.tiff?.editingPrecision).toBe('float32');expect(Buffer.from(await entry!.blob.arrayBuffer())).toEqual(Buffer.from(await original.arrayBuffer()));
 const undo=await(await fetch(endpoint+'/undo',json({expectedRevision:after.revision}))).json();expect(undo.document).toEqual(before.document);const redo=await(await fetch(endpoint+'/redo',json({expectedRevision:undo.revision}))).json();expect(redo.document).toEqual(after.document);
},30000);
