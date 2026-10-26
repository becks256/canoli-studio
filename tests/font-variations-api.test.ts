import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {readFile} from 'node:fs/promises';
import {createApiServer} from '../server/app';
import {TextLayer} from '../src/dom';
import {SCHEMA_VERSION} from '../src/core/model';
import {readProject} from '../src/core/project';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};}
it('REST retains declared variable sources and axis settings with atomic validation, revisions, exact native source bytes and history',async()=>{
 const created=await request('/documents',{width:320,height:160}),path=`/documents/${created.body.document.id}`,bytes=await readFile('tests/fixtures/font-variations/Axes.ttf');
 const response=await fetch(base+path+'/fonts?expectedRevision=0',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes)}),embedded=await response.json();expect(response.status).toBe(201);expect(embedded.metrics).toBe('estimated');
 const family=embedded.file.resource.report.faces[0].cssFamily,text=new TextLayer({text:'AAAA',fontFamily:family}),added=await request(path+'/commands',{expectedRevision:embedded.revision,commands:[{type:'layer.add',layer:text.toJSON()}]});expect(added.status).toBe(200);
 const changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:text.id,patch:{fontVariationSettings:'"TEST" 50, "wght" 600'}}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.schemaVersion).toBe(SCHEMA_VERSION);
 for(const value of ['"TEST" 101','"NOPE" 5','"TEST" 1,','"wght" 900','"TEST" 50; color:red']){
  const bad=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'No partial publication'},{type:'layer.update',id:text.id,patch:{fontVariationSettings:value}}]});expect(bad.status,value).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);
 }
 expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:text.id,patch:{fontVariationSettings:'normal'}}]})).status).toBe(409);
 const undone=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const saved=await fetch(base+path+'/project'),project=await readProject(await saved.blob());expect(project.document).toEqual(redone.body.document);expect(Buffer.from(await project.fonts[0].original.arrayBuffer())).toEqual(bytes);
 const locked=await request(path+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:text.id,patch:{locked:true}}]});expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:text.id,patch:{fontVariationSettings:'normal'}}]})).status).toBe(400);
});
