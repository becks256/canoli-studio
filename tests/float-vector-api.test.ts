import {beforeAll,afterAll,it,expect} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {VectorLayer,VectorPath,TextLayer} from '../src/dom';
import {readProject} from '../src/core/project';
const server=createApiServer({authToken:'float-vector-test'}),auth={authorization:'Bearer float-vector-test'};let base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
const json=(value:unknown)=>({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(value)});
it('independent REST retains native vector paint, strict edits, revisions, locks and source-free projects',async()=>{
 const initial=await(await fetch(base+'/documents',json({name:'Linear paths',width:64,height:48}))).json(),url=base+'/documents/'+initial.document.id,layer=new VectorLayer(),path=VectorPath.rectangle({x:0,y:0,width:64,height:48},0,{stroke:null,fillGradient:{kind:'linear',start:{x:0,y:0},end:{x:64,y:0},stops:[{position:0,color:'#ff0000',opacity:.375},{position:1,color:'#0000ff',opacity:.64123}]}});
 const response=await fetch(url+'/commands',json({expectedRevision:0,commands:[{type:'document.precision.float'},{type:'layer.add',layer:layer.toJSON()},{type:'path.add',id:layer.id,path:path.toJSON()}]}));expect(response.status,await response.clone().text()).toBe(200);const after=await response.json();expect(after.document.children[0].paths).toEqual([path.toJSON()]);
 for(const command of [{type:'path.update',id:layer.id,pathId:path.id,patch:{fillGradient:{kind:'linear',start:{x:0,y:0},end:{x:0,y:0},stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]}}},{type:'layer.add',layer:new TextLayer().toJSON()}]){
  const invalid=await fetch(url+'/commands',json({expectedRevision:after.revision,commands:[{type:'document.rename',name:'Must roll back'},command]}));expect(invalid.status).toBe(400);expect(await(await fetch(url,{headers:auth})).json()).toEqual(after);
 }
 expect((await fetch(url+'/commands',json({expectedRevision:0,commands:[{type:'document.rename',name:'Stale'}]}))).status).toBe(409);
 const project=await readProject(await(await fetch(url+'/project?history=true',{headers:auth})).blob());expect(project.document).toEqual(after.document);expect(project.entries).toHaveLength(0);expect(project.history?.past).toHaveLength(1);
 const locked=await(await fetch(url+'/commands',json({expectedRevision:after.revision,commands:[{type:'layer.update',id:layer.id,patch:{locked:true}}]}))).json();expect((await fetch(url+'/commands',json({expectedRevision:locked.revision,commands:[{type:'path.update',id:layer.id,pathId:path.id,patch:{fill:'#00ff00'}}]}))).status).toBe(400);
 const unlockUndo=await(await fetch(url+'/undo',json({expectedRevision:locked.revision}))).json();expect(unlockUndo.document).toEqual(after.document);const undo=await(await fetch(url+'/undo',json({expectedRevision:unlockUndo.revision}))).json();expect(undo.document).toEqual(initial.document);const redo=await(await fetch(url+'/redo',json({expectedRevision:undo.revision}))).json();expect(redo.document).toEqual(after.document);
});
