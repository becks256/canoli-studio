import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const original=[...await readFile('tests/fixtures/raw/bayer-rggb.dng')];
const documented=(await readFile('docs/SCRIPTING_API.md','utf8')).match(/<!-- example: raw-isolated-development -->\s*```js\n([\s\S]*?)\n```/)?.[1];

test('documented isolated RAW constructor develops shared masters with one atomic undo and independent pixels',async({page},info)=>{
  expect(documented).toBeTruthy();await page.goto('/');const result=await page.evaluate(async({bytes,code,reference})=>{
    const {editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Scripted original.dng'),{allowPrecisionLoss:true});const image=editor.document.layers.at(0)as import('../src/dom').SmartObjectLayer,other=editor.document.placeSmartObject(image.componentId);other.visible=false;editor.document.selectedLayer=image;
    const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,logs=await editor.runScript(code),state=editor.document.getSnapshot(),asset=editor.assetStore.values().at(-1)!,canvas=new OffscreenCanvas(asset.width,asset.height),ctx=canvas.getContext('2d')!,expected=await createImageBitmap(new Blob([new Uint8Array(reference)],{type:'image/png'}));ctx.drawImage(asset.bitmap,0,0);const a=ctx.getImageData(0,0,asset.width,asset.height).data;ctx.clearRect(0,0,asset.width,asset.height);ctx.drawImage(expected,0,0);const b=ctx.getImageData(0,0,asset.width,asset.height).data;let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));expected.close();canvas.width=canvas.height=0;
    const developed=JSON.stringify(editor.document.toJSON());editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===before;editor.document.redo();const redo=JSON.stringify(editor.document.toJSON())===developed;const metadata=await editor.runScript('const value=await document.selectedLayer.getRawDevelopment();print(JSON.stringify(value.toJSON()));');
    return{logs,metadata,maximum,undo,redo,revisionDelta:state.revision-revision,assets:editor.assetStore.values().length,settings:asset.raw!.settings.development,shared:image.componentId===other.componentId};
  },{bytes:original,code:documented!,reference:[...await readFile('tests/fixtures/raw/exposure-up.png')]});expect(result).toMatchObject({logs:['RAW exposure developed'],maximum:0,undo:true,redo:true,revisionDelta:1,assets:2,settings:{exposure:1.25,highlightPreservation:0.5},shared:true});expect(JSON.parse(result.metadata[0])).toMatchObject({exposure:1.25,highlightPreservation:0.5});await info.attach('raw-isolated-command-pixels',{body:JSON.stringify(result),contentType:'application/json'});
});

for(const action of ['throw','no-consent','plain-object','overlap','locked']as const)test(`isolated RAW ${action} rejects without publishing private pixels or other staged commands`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,action})=>{
    const {editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Rollback.dng'),{allowPrecisionLoss:true});const image=editor.document.layers.at(0)!;editor.document.selectedLayer=image;if(action==='locked')image.locked=true;
    const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
    const operation=action==='plain-object'?'await image.developRaw({exposure:1},{allowPrecisionLoss:true});':action==='no-consent'?'await image.developRaw(new RawDevelopment({exposure:1}));':action==='overlap'?'const pending=image.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true});document.name="Interleaved";await pending;':'await image.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true});';
    let error='';try{await editor.runScript(`const image=document.selectedLayer;document.name="Uncommitted";${operation}${action==='throw'?'throw new Error("After RAW");':''}`);}catch(cause){error=String(cause);}
    return{error,unchanged:before===JSON.stringify(editor.document.toJSON()),revision:editor.document.getSnapshot().revision-revision,assets:editor.assetStore.values().length};
  },{bytes:original,action});expect(result).toMatchObject({unchanged:true,revision:0,assets:1});expect(result.error).toMatch(action==='throw'?/After RAW/:action==='no-consent'?/consent/:action==='plain-object'?/RawDevelopment constructor/:action==='overlap'?/changed during RAW/:/locked/);
});

for(const action of ['human-edit','cancel','replace-source','close-source','revoke-read','revoke-write']as const)test(`actual isolated RAW prepared pixels are discarded after ${action}`,async({page})=>{
  await page.goto('/');const result=await page.evaluate(async({bytes,action})=>{
    const {editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Guarded script.dng'),{allowPrecisionLoss:true});editor.document.selectedLayer=editor.document.layers.at(0);const asset=editor.assetStore.values()[0],replacement=action==='replace-source'?await createImageBitmap(asset.blob):null;
    const code='document.name="Uncommitted script";await document.selectedLayer.developRaw(new RawDevelopment({exposure:1}),{allowPrecisionLoss:true});';
    const plugin=action.startsWith('revoke')?editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'canoli.raw-guards',name:'RAW guards',version:'1.0.0',permissions:['document:read','document:write','assets:read','assets:write'],commands:[{id:'develop',title:'Develop',source:code}]}):null;
    const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,descriptor=Object.getOwnPropertyDescriptor(Worker.prototype,'onmessage')!,held:(()=>void)[]=[];
    Object.defineProperty(Worker.prototype,'onmessage',{...descriptor,set(handler){descriptor.set!.call(this,handler?function(this:Worker,event:MessageEvent){if(event.data?.png instanceof Blob&&event.data.report?.nativeVersion){held.push(()=>handler.call(this,event));}else handler.call(this,event);}:handler);}});
    let error='';try{
      const pending=(plugin?editor.runPlugin(plugin.id,'develop'):editor.runScript(code)).catch(cause=>{error=String(cause);});
      const start=performance.now();while(!held.length&&performance.now()-start<4000)await new Promise(resolve=>setTimeout(resolve,5));if(!held.length)throw new Error('No native RAW pixels reached the private boundary: '+error);
      if(action==='human-edit')editor.document.name='Human edit';else if(action==='cancel')editor.scripts.cancel();else if(action==='replace-source'){editor.assetStore.remove(asset.id);editor.assetStore.install({...asset,bitmap:replacement!},false);}else if(action==='close-source')asset.bitmap.close();else editor.plugins.revokePermission(plugin!.id,action==='revoke-read'?'assets:read':'assets:write');
      held.splice(0).forEach(release=>release());await pending;
    }finally{Object.defineProperty(Worker.prototype,'onmessage',descriptor);held.splice(0).forEach(release=>release());}
    return{error,unchanged:before===JSON.stringify(editor.document.toJSON()),name:editor.document.name,revisionDelta:editor.document.getSnapshot().revision-revision,assets:editor.assetStore.values().length};
  },{bytes:original,action});expect(result.assets).toBe(1);expect(result.error).not.toBe('');if(action==='human-edit')expect(result).toMatchObject({name:'Human edit',revisionDelta:1});else expect(result).toMatchObject({unchanged:true,revisionDelta:0});
});

test('RAW plugin installation stays inert and metadata/development use distinct current grants',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async bytes=>{
    const {editor}=window.luma;await editor.openRaw(new File([new Uint8Array(bytes)],'Permissions.dng'),{allowPrecisionLoss:true});editor.document.selectedLayer=editor.document.layers.at(0);const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
    const plugin=editor.plugins.install({format:'luma-plugin',apiVersion:2,id:'canoli.raw-permissions',name:'RAW permissions',version:'1.0.0',permissions:['document:read','document:write','assets:read','assets:write'],commands:[{id:'read',title:'Read',source:'const value=await document.selectedLayer.getRawDevelopment();print(value.toJSON().exposure);'},{id:'develop',title:'Develop',source:'await document.selectedLayer.developRaw(new RawDevelopment({exposure:0.5}),{allowPrecisionLoss:true});'}]});const inert=before===JSON.stringify(editor.document.toJSON());
    editor.plugins.setGrantedPermissions(plugin.id,['document:read','assets:read']);const logs=await editor.runPlugin(plugin.id,'read'),errors:string[]=[];
    for(const missing of ['document:write','assets:read','assets:write']as const){editor.plugins.setGrantedPermissions(plugin.id,['document:read','document:write','assets:read','assets:write'].filter(permission=>permission!==missing)as import('../src/plugins').PluginPermission[]);try{await editor.runPlugin(plugin.id,'develop');errors.push('Accepted');}catch(error){errors.push(String(error));}}
    editor.plugins.setGrantedPermissions(plugin.id,['document:read']);let denied='';try{await editor.runPlugin(plugin.id,'read');}catch(error){denied=String(error);}
    return{inert,logs,errors,denied,unchanged:before===JSON.stringify(editor.document.toJSON()),revisionDelta:editor.document.getSnapshot().revision-revision,assets:editor.assetStore.values().length};
  },original);expect(result).toMatchObject({inert:true,logs:['0'],unchanged:true,revisionDelta:0,assets:1});for(const error of result.errors)expect(error).toMatch(/Permission denied/);expect(result.denied).toMatch(/Permission denied/);
});
