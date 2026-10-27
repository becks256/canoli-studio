import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {VectorLayer,VectorPath} from '../src/dom';
import {SCHEMA_VERSION} from '../src/core/model';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};}
it('independent REST clipping retains paths, strict revisions, atomic lock validation and one Undo',async()=>{
 const created=await request('/documents',{width:160,height:120}),path=`/documents/${created.body.document.id}`,shape=new VectorLayer({name:'Base'}),color=new VectorLayer({name:'Color'});shape.paths.add(VectorPath.ellipse({x:20,y:20,width:80,height:60}));color.paths.add(VectorPath.rectangle({x:0,y:0,width:160,height:120}));
 const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:shape.toJSON()},{type:'layer.add',layer:color.toJSON()}]});expect(added.status).toBe(200);
 const changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:color.id,patch:{clipped:true}}]});expect(changed.status).toBe(200);expect(changed.body.document).toEqual({...added.body.document,schemaVersion:SCHEMA_VERSION,children:[shape.toJSON(),{...color.toJSON(),clipped:true}]});
 for(const invalid of [1,'true',null]){const bad=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'No partial change'},{type:'layer.update',id:color.id,patch:{clipped:invalid}}]});expect(bad.status).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);}
 expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:color.id,patch:{clipped:false}}]})).status).toBe(409);
 const undone=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const locked=await request(path+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:color.id,patch:{locked:true}}]});expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:shape.id,patch:{x:5}},{type:'layer.update',id:color.id,patch:{clipped:false}}]})).status).toBe(400);expect((await request(path)).body.document).toEqual(locked.body.document);
});
