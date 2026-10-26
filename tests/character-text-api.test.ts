import {afterAll,beforeAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {TextLayer} from '../src/dom';
import {readProject} from '../src/core/project';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};}
it('REST formats literal characters with independent revisions, estimated geometry, atomic validation, undo and native persistence',async()=>{
 const created=await request('/documents',{width:320,height:180}),path=`/documents/${created.body.document.id}`,layer=new TextLayer({text:'A😀B'});
 const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:layer.toJSON()}]});expect(added.status).toBe(200);
 const patch={characterRanges:[{start:1,end:3,format:{fontSize:60,color:'#a43e29'}}]},changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch}]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0]).toMatchObject({...patch,text:'A😀B',height:72});
 for(const characterRanges of [[{start:1,end:2,format:{color:'red'}}],[{start:0,end:5,format:{color:'red'}}],[{start:0,end:1,format:{lineHeight:2}}],[{start:0,end:1,format:{fontFamily:'CanoliFont_'+'a'.repeat(64)}}]]){
  const bad=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'No partial edit'},{type:'layer.update',id:layer.id,patch:{characterRanges}}]});expect(bad.status).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);
 }
 expect((await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:layer.id,patch:{text:'Stale'}}]})).status).toBe(409);
 const undo=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undo.body.document).toEqual(added.body.document);const redo=await request(path+'/redo',{expectedRevision:undo.body.revision});expect(redo.body.document).toEqual(changed.body.document);
 const project=await readProject(await(await fetch(base+path+'/project')).blob());expect(project.document).toEqual(changed.body.document);
});
