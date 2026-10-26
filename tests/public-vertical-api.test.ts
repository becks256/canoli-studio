import {afterAll,beforeAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {TextLayer} from '../src/dom';
import {SCHEMA_VERSION} from '../src/core/model';
import {readProject} from '../src/core/project';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};}
it('independent REST vertical commands retain logical source, estimated frames and project/undo without browser synchronization',async()=>{
 const created=await request('/documents',{width:480,height:320}),url=`/documents/${created.body.document.id}`,layer=new TextLayer({text:'AA\nBB',fontSize:20,lineHeight:1}),added=await request(url+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]}),changed=await request(url+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{writingMode:'vertical-rl',textOrientation:'upright'}}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.schemaVersion).toBe(SCHEMA_VERSION);const text=changed.body.document.children[0];expect(text).toMatchObject({text:'AA\nBB',width:40,height:40,textFrameOrigin:{x:-40,y:0},textInlineExtent:40});
 const project=await readProject(new Blob([await(await fetch(base+url+'/project')).arrayBuffer()]));expect(project.document.children[0]).toEqual(text);expect((await request(url+'/undo',{expectedRevision:changed.body.revision})).status).toBe(200);expect((await request(url)).body.document).toEqual(added.body.document);
});
it('REST writer edits reject stale revisions, cache injection, unsupported enums and locks atomically',async()=>{
 const created=await request('/documents',{width:320,height:180}),url=`/documents/${created.body.document.id}`,layer=new TextLayer({text:'AA'}),added=await request(url+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});expect((await request(url+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:layer.id,patch:{writingMode:'vertical-lr'}}]})).status).toBe(409);
 for(const patch of [{textFrameOrigin:{x:0,y:0}},{textInlineExtent:20},{writingMode:'vertical'},{textOrientation:'rotated'}]){expect((await request(url+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch}]})).status).toBe(400);expect((await request(url)).body.document).toEqual(added.body.document);}
 const locked=await request(url+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{locked:true}}]});expect((await request(url+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{writingMode:'vertical-rl'}}]})).status).toBe(400);expect((await request(url)).body.document).toEqual(locked.body.document);
});
