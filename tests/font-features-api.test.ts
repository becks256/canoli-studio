import {SCHEMA_VERSION as CURRENT_DOCUMENT_SCHEMA} from '../src/core/model';
import {beforeAll,afterAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {TextLayer,LayerGroup,VectorLayer,ParagraphStyle} from '../src/dom';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api/v1`;});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};}

it('REST applies native font requests through strict revisioned commands, atomic history and ancestor locks',async()=>{
 const created=await request('/documents',{width:640,height:320}),path=`/documents/${created.body.document.id}`,group=new LayerGroup(),text=group.layers.add(new TextLayer({text:'Original ß العربية',fontWeight:'553.25'})),vector=group.layers.add(new VectorLayer());
 const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.add',layer:group.toJSON()}]});expect(added.status).toBe(200);
 const patch={fontVariantCaps:'all-small-caps',fontStretch:'condensed'},changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[{type:'layer.update',id:text.id,patch}]});
 expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);expect(changed.body.document.children[0].children[0]).toMatchObject({...patch,text:text.text,fontWeight:'553.25'});
 for(const invalid of [{fontVariantCaps:'uppercase'},{fontVariantCaps:null},{fontStretch:'75%'},{fontStretch:75}]){
  expect((await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'No partial change'},{type:'layer.update',id:text.id,patch:invalid}]})).status).toBe(400);expect((await request(path)).body.document).toEqual(changed.body.document);
 }
 expect((await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'layer.update',id:vector.id,patch}]})).status).toBe(400);
 expect((await request(path+'/commands',{expectedRevision:0,commands:[{type:'layer.update',id:text.id,patch}]})).status).toBe(409);
 const undone=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undone.status).toBe(200);expect(undone.body.document).toEqual(added.body.document);
 const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const locked=await request(path+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:group.id,patch:{locked:true}}]});expect((await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'layer.update',id:text.id,patch:{fontStretch:'normal'}}]})).status).toBe(400);expect((await request(path)).body.document).toEqual(locked.body.document);
});
it('REST propagates capital/stretch style edits and clears only explicitly reset text overrides',async()=>{
 const created=await request('/documents',{}),path=`/documents/${created.body.document.id}`,style=new ParagraphStyle({name:'Body',format:{fontVariantCaps:'small-caps',fontStretch:'condensed'}}),text=new TextLayer({text:'Linked caption'});
 const initial=await request(path+'/commands',{expectedRevision:0,commands:[{type:'paragraphStyle.set',style:style.toJSON()},{type:'layer.add',layer:text.toJSON()},{type:'text.paragraphStyle',id:text.id,styleId:style.id}]});expect(initial.status,JSON.stringify(initial.body)).toBe(200);
 expect(initial.body.document.children[0].paragraphStyle.overrides).toEqual({});
 const local=await request(path+'/commands',{expectedRevision:initial.body.revision,commands:[{type:'layer.update',id:text.id,patch:{fontVariantCaps:'normal'}}]});
 const changed=await request(path+'/commands',{expectedRevision:local.body.revision,commands:[{type:'paragraphStyle.set',style:{...style.toJSON(),format:{...style.format,fontVariantCaps:'all-small-caps',fontStretch:'expanded'}}}]});
 expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0]).toMatchObject({fontVariantCaps:'normal',fontStretch:'expanded',paragraphStyle:{overrides:{fontVariantCaps:'normal'}}});
 const reset=await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'text.paragraphOverrides.clear',id:text.id,keys:['fontVariantCaps']}]});expect(reset.status).toBe(200);expect(reset.body.document.children[0]).toMatchObject({fontVariantCaps:'all-small-caps',fontStretch:'expanded',paragraphStyle:{overrides:{}}});
});
