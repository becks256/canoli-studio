import {afterAll,beforeAll,expect,it} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {Document,TextLayer,ParagraphStyle} from '../src/dom';
const server=createApiServer();let base:string;
beforeAll(async()=>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async()=>{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function request(path:string,data?:unknown){const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:response.status,body:await response.json()};}
it('reports headless font usage and shares strict replacement, atomic locks, revisions and undo',async()=>{
 const source=new Document(),style=source.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontFamily:'serif'}}));const text=source.layers.add(new TextLayer({text:'Keep Unicode é العربية'}));text.paragraphStyle=style;
 const created=await request('/documents',{width:400,height:300}),path=`/documents/${created.body.document.id}`;
 const layer=text.toJSON();if(layer.kind!=='text')throw new Error('Expected text');delete layer.paragraphStyle;
 const added=await request(path+'/commands',{expectedRevision:0,commands:[{type:'paragraphStyle.set',style:style.toJSON()},{type:'layer.add',layer},{type:'text.paragraphStyle',id:text.id,styleId:style.id}]});expect(added.status,JSON.stringify(added.body)).toBe(200);
 const usage=await request(path+'/fonts');expect(usage.status).toBe(200);expect(usage.body.revision).toBe(added.body.revision);expect(usage.body.fonts).toEqual([{family:'serif',textLayers:1,paragraphStyles:1,overrides:0,embeddedScopes:0,lockedTextLayers:0}]);
 const command={type:'document.font.replace',from:'serif',to:'monospace'};
 const changed=await request(path+'/commands',{expectedRevision:added.body.revision,commands:[command]});expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.document.children[0].fontFamily).toBe('monospace');expect(changed.body.document.children[0].paragraphStyle.overrides).toEqual({});expect(changed.body.document.children[0].text).toBe(text.text);
 expect((await request(path+'/commands',{expectedRevision:added.body.revision,commands:[command]})).status).toBe(409);
 for(const bad of [{...command,to:null},{...command,from:''},{...command,extra:1}])expect((await request(path+'/commands',{expectedRevision:changed.body.revision,commands:[{type:'document.rename',name:'Not committed'},bad]})).status).toBe(400);
 expect((await request(path)).body.document).toEqual(changed.body.document);
 const undone=await request(path+'/undo',{expectedRevision:changed.body.revision});expect(undone.body.document).toEqual(added.body.document);
 const redone=await request(path+'/redo',{expectedRevision:undone.body.revision});expect(redone.body.document).toEqual(changed.body.document);
 const locked=await request(path+'/commands',{expectedRevision:redone.body.revision,commands:[{type:'layer.update',id:text.id,patch:{locked:true}}]});expect(locked.status).toBe(200);
 const failed=await request(path+'/commands',{expectedRevision:locked.body.revision,commands:[{type:'document.rename',name:'Not committed'},{type:'document.font.replace',from:'monospace',to:'serif'}]});expect(failed.status).toBe(400);expect((await request(path)).body.document).toEqual(locked.body.document);
});
