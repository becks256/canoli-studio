import {afterAll,beforeAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {TextLayer,TextPath} from '../src/dom';
import {SCHEMA_VERSION} from '../src/core/model';
import {readProject} from '../src/core/project';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};}
it('independent REST sessions retain authored baselines, estimated frames, exact undo and native persistence',async()=>{
 const created=await request('/documents',{width:480,height:320}),url=`/documents/${created.body.document.id}`,layer=new TextLayer({text:'AAAA',fontSize:36}),path=new TextPath({points:[{x:24,y:150,in:{x:24,y:150},out:{x:100,y:30}},{x:420,y:150,in:{x:340,y:30},out:{x:420,y:150}}],startOffset:12});
 const added=await request(url+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});expect(added.status).toBe(200);const changed=await request(url+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{textPath:path.toJSON()}}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.schemaVersion).toBe(SCHEMA_VERSION);const text=changed.body.document.children[0];expect(text.textPath).toEqual(path.toJSON());expect(text.textPathOrigin).toEqual({x:-48,y:-12});
 const bytes=await(await fetch(base+url+'/project')).arrayBuffer(),project=await readProject(new Blob([bytes]));expect(project.document.children[0]).toEqual(text);expect((await request(url+'/undo',{expectedRevision:changed.body.revision})).status).toBe(200);expect((await request(url)).body.document).toEqual(added.body.document);
});
it('REST path edits enforce expected revisions, strict cache ownership and atomic logical-line validation',async()=>{
 const created=await request('/documents',{width:320,height:180}),url=`/documents/${created.body.document.id}`,layer=new TextLayer({text:'AA'}),path=new TextPath({points:[{x:0,y:80,in:{x:0,y:80},out:{x:0,y:80}},{x:200,y:80,in:{x:200,y:80},out:{x:200,y:80}}]});const added=await request(url+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});
 const stale=await request(url+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:layer.id,patch:{textPath:path.toJSON()}}]});expect(stale.status).toBe(409);
 for(const commands of [[{type:'layer.update',id:layer.id,patch:{textPathOrigin:{x:0,y:0}}}],[{type:'layer.update',id:layer.id,patch:{textPath:path.toJSON()}},{type:'layer.update',id:layer.id,patch:{text:'A\nB'}}]]){const rejected=await request(url+'/commands',{expectedRevision:added.body.revision,commands});expect(rejected.status).toBe(400);expect((await request(url)).body.document).toEqual(added.body.document);}
});
