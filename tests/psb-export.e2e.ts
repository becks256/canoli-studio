import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

async function save(page:Page,key:string,path:string){
 const pending=page.waitForEvent('download');await page.evaluate(key=>{const blob=(window as unknown as {photoshopOutputs:Record<string,Blob>}).photoshopOutputs[key],a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='native.'+(key==='png'?'png':'psb');a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},key);await(await pending).saveAs(path);
}
async function independent(page:Page,info:TestInfo,items:{key:string;names:string[];visibility:boolean[];singleLayerReference?:boolean}[]){
 const reference=info.outputPath('native.png');await save(page,'png',reference);const cases=[];
 for(const item of items){const path=info.outputPath(item.key+'.psb');await save(page,item.key,path);cases.push({...item,path,reference,format:'psb'});}
 const manifest=info.outputPath('cases.json');await writeFile(manifest,JSON.stringify(cases));
 const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-export.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);return JSON.parse(checked.stdout);
}

for(const scenario of ['composition','wide'] as const)test(`PSB ${scenario} preserves native preview and independently recomposed pixel layers`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async scenario=>{
  const {editor,PaintLayer,PaintFill,VectorLayer,VectorPath,TextLayer,LayerGroup,LayerMask,MarqueeSelection,AdjustmentLayer,AffineTransform}=window.luma;
  const width=scenario==='wide'?38417:2081,height=193;editor.newDocument({width,height,name:'PSB delivery'});const doc=editor.document;
  const base=doc.layers.add(new PaintLayer({name:'Native wide artwork'}));base.strokes.add(new PaintFill({color:'#804020',bounds:{x:0,y:0,width,height},opacity:.5}));
  const group=doc.layers.add(new LayerGroup({name:'Shapes'}));group.transform=new AffineTransform(1,.04,-.07,1,width-300,4);
  const vector=group.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:0,y:0,width:240,height:170},9,{fill:'#3060d0',stroke:'#ff8060',strokeWidth:3}));
  group.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:width-310,y:0,width:280,height:190}),feather:2});
  doc.layers.add(new TextLayer({text:'Native PSB',fontFamily:'monospace',fontSize:24,x:width-270,y:30}));
  doc.layers.add(new AdjustmentLayer({name:'Tone',adjustment:{kind:'tone',exposure:.25,contrast:4,saturation:8}}));
  const top=doc.layers.add(new PaintLayer({name:'Top pixels Ω',opacity:.6}));top.strokes.add(new PaintFill({color:'#ff8040',bounds:{x:width-220,y:120,width:210,height:30}}));
  const hidden=doc.layers.add(new PaintLayer({name:'Hidden pixels',visible:false}));hidden.strokes.add(new PaintFill({color:'#ff0000',bounds:{x:0,y:0,width,height}}));
  await document.fonts.ready;const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,png=await editor.exportPng(),outputs:Record<string,Blob>={png},reports=[];
  for(const mode of ['layers','flatten'] as const){const result=await editor.export({format:'psb',psdMode:mode});outputs[mode]=result.blob;reports.push({mime:result.mimeType,extension:result.extension,report:result.report});}
  (window as unknown as {photoshopOutputs:Record<string,Blob>}).photoshopOutputs=outputs;
  return{beforeUnchanged:before===JSON.stringify(doc.toJSON())&&revision===doc.getSnapshot().revision,reports};
 },scenario);
 expect(result.beforeUnchanged).toBe(true);for(const report of result.reports){expect(report.mime).toBe('image/vnd.adobe.photoshop');expect(report.extension).toBe('psb');expect(report.report.warnings.join(' ')).toContain('PSB-compatible');}
 const decoded=await independent(page,info,[{key:'layers',names:['Merged through Tone','Top pixels Ω','Hidden pixels'],visibility:[true,true,false]},{key:'flatten',names:['PSB delivery'],visibility:[true],singleLayerReference:true}]);
 await info.attach('psb-independent',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

for(const width of [30001,100000])test(`independent ${width}-pixel PSB imports without a full-size canvas, reopens and exports valid 32-bit RLE`,async({page},info)=>{
 await page.goto('/');const bytes=[...await readFile(`tests/fixtures/psb/rle-${width}.psb`)];
 const result=await page.evaluate(async({bytes,width})=>{
  const {editor}=window.luma;const input=new Uint8Array(bytes),hash=async(b:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))];
  const create=document.createElement.bind(document),widths:number[]=[],descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width')!;
  document.createElement=function(...args:Parameters<typeof document.createElement>){const value=create(...args);if(args[0]==='canvas')Object.defineProperty(value,'width',{configurable:true,get(){return descriptor.get!.call(this);},set(n:number){widths.push(n);descriptor.set!.call(this,n);}});return value;} as typeof document.createElement;
  try{await editor.openPsd(input);}finally{document.createElement=create;}
  const originalSource=editor.assetStore.values()[0],sourceHash=await hash(originalSource.blob),before=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();
  await editor.openProject(new File([project],'wide-photoshop.luma'));const after=editor.assetStore.values()[0];
  const png=await editor.exportPng(),psb=(await editor.export({format:'psb',psdMode:'flatten'})).blob;
  (window as unknown as {photoshopOutputs:Record<string,Blob>}).photoshopOutputs={png,psb};
  return{size:[editor.document.width,editor.document.height],sourceSize:[after.width,after.height],sameModel:before===JSON.stringify(editor.document.toJSON()),sameSource:JSON.stringify(sourceHash)===JSON.stringify(await hash(after.blob)),inputUnchanged:input.every((v,i)=>v===bytes[i]),noFullCanvas:widths.every(w=>w<width),maximumImportCanvas:Math.max(0,...widths),name:editor.document.name};
 },{bytes,width});
 expect(result.size).toEqual([width,3]);expect(result.sourceSize).toEqual(result.size);expect(result.sameModel).toBe(true);expect(result.sameSource).toBe(true);expect(result.inputUnchanged).toBe(true);expect(result.noFullCanvas).toBe(true);
 const decoded=await independent(page,info,[{key:'psb',names:[result.name],visibility:[true],singleLayerReference:true}]);
 const sourcePixels=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['-c',"from PIL import Image;import numpy as np,sys;a=np.asarray(Image.open(sys.argv[1]).convert('RGBA'));b=np.asarray(Image.open(sys.argv[2]).convert('RGBA'));assert np.array_equal(a,b);print('Every independently generated source pixel matches browser output')",info.outputPath('native.png'),`tests/fixtures/psb/rle-${width}.png`],{encoding:'utf8',timeout:30000});expect(sourcePixels.status,sourcePixels.stderr).toBe(0);
 await info.attach('psb-input-roundtrip',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

for(const action of ['cancel','callback-error','remove-hidden','remove-hidden-flatten','remove-visible','closed-bitmap','disposed-store','encoding-remove','host-edit','unrelated-asset'] as const)
test(`PSB ${action} pins independent hidden/visible sources and leaves no partial output`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async action=>{
  const {editor,RasterLayer}=window.luma;editor.newDocument({width:2081,height:140});const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d')!.fillRect(0,0,16,16);const blob=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!)));
  const source=await editor.assetStore.add(blob,'Visible',undefined,false),hidden=await editor.assetStore.add(blob,'Hidden',undefined,false),unrelated=await editor.assetStore.add(blob,'Unrelated',undefined,false);
  const layer=editor.document.layers.add(new RasterLayer({assetId:source.id,width:2081,height:140}));editor.document.layers.add(new RasterLayer({assetId:hidden.id,width:16,height:16,visible:false}));
  const before=JSON.stringify(editor.document.toJSON()),abort=new AbortController(),surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);let changed=false,returned=false,error='';
  editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  try{await editor.export({format:'psb',psdMode:action==='remove-hidden-flatten'?'flatten':'layers'},{signal:abort.signal,onProgress:p=>{
   if(changed||(action==='encoding-remove'?p.phase!=='encoding':p.phase!=='rendering'||p.fraction!==0))return;changed=true;
   if(action==='cancel')abort.abort(new Error('Cancel PSB'));else if(action==='callback-error')throw new Error('PSB callback error');
   else if(action==='remove-hidden'||action==='remove-hidden-flatten')editor.assetStore.remove(hidden.id);else if(action==='remove-visible'||action==='encoding-remove')editor.assetStore.remove(source.id);else if(action==='closed-bitmap')source.bitmap.close();else if(action==='disposed-store')editor.assetStore.dispose();else if(action==='host-edit')layer.opacity=.25;else editor.assetStore.remove(unrelated.id);
  }});returned=true;}catch(e){error=String(e);}finally{editor.renderer.render=render;}
  if(action==='host-edit')editor.document.undo();
  return{changed,returned,error,released:surfaces.every(s=>!s.width&&!s.height),calls:surfaces.length,readonly:before===JSON.stringify(editor.document.toJSON())};
 },action);
 expect(result.changed).toBe(true);expect(result.released).toBe(true);expect(result.readonly).toBe(true);
 if(action==='host-edit'||action==='unrelated-asset'||action==='remove-hidden-flatten')expect(result.returned).toBe(true);
 else{expect(result.returned).toBe(false);expect(result.error).toMatch(/Cancel PSB|callback error|source changed|disposed/);if(action!=='encoding-remove')expect(result.calls).toBe(0);}
 await info.attach('psb-lifetime',{body:JSON.stringify(result),contentType:'application/json'});
});

test('Photoshop import rejects stale publication and disposes decoded private assets',async({page})=>{
 await page.goto('/');const bytes=[...await readFile('tests/fixtures/psb/rle-30001.psb')];
 const result=await page.evaluate(async bytes=>{
  const {editor,TextLayer}=window.luma,prototype=Object.getPrototypeOf(editor.assetStore) as typeof editor.assetStore;
  editor.document.layers.add(new TextLayer({text:'Keep this work'}));const before=editor.document.id,add=prototype.add,closed=ImageBitmap.prototype.close;
  let staged=false,closeCalls=0,error='';
  prototype.add=async function(...args:Parameters<typeof add>){const asset=await add.apply(this,args);if(this!==editor.assetStore){staged=true;editor.document.name='Newer work';}return asset;};
  ImageBitmap.prototype.close=function(){closeCalls++;return closed.call(this);};
  try{await editor.openPsd(new Uint8Array(bytes));}catch(e){error=String(e);}finally{prototype.add=add;ImageBitmap.prototype.close=closed;}
  return{staged,closeCalls,error,same:editor.document.id===before,name:editor.document.name,assets:editor.assetStore.values().length};
 },bytes);
 expect(result.staged).toBe(true);expect(result.closeCalls).toBeGreaterThan(0);expect(result.error).toContain('Document session changed');expect(result.same).toBe(true);expect(result.name).toBe('Newer work');expect(result.assets).toBe(0);
});

test('50 MP PSB retains original sources, native layer samples and merged preview',async({page},info)=>{
 test.setTimeout(180000);const bytes=[...await readFile('tests/fixtures/matting/native-50mp.png')];await page.goto('/');
 const result=await page.evaluate(async bytes=>{
  const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'original-50mp.png',{type:'image/png'}));
  const before=JSON.stringify(editor.document.toJSON()),saved=await editor.saveProject();await editor.openProject(new File([saved],'source.luma'));const source=editor.assetStore.values()[0],original=new Uint8Array(await source.blob.arrayBuffer()),png=await editor.exportPng();
  const surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);editor.renderer.render=async(...args)=>{const c=await render(...args);surfaces.push(c);return c;};
  const start=performance.now();let output:Blob;try{output=(await editor.export({format:'psb',psdMode:'flatten'})).blob;}finally{editor.renderer.render=render;}
  (window as unknown as {photoshopOutputs:Record<string,Blob>}).photoshopOutputs={png,psb:output};
  return{size:[editor.document.width,editor.document.height],readonly:before===JSON.stringify(editor.document.toJSON()),name:editor.document.name,sourceUnchanged:original.length===bytes.length&&original.every((v,i)=>v===bytes[i]),released:surfaces.every(s=>!s.width&&!s.height),tiles:surfaces.length,milliseconds:performance.now()-start};
 },bytes);
 expect(result.size).toEqual([10000,5000]);expect(result.readonly).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.released).toBe(true);expect(result.tiles).toBe(395);
 const decoded=await independent(page,info,[{key:'psb',names:[result.name],visibility:[true],singleLayerReference:true}]);await info.attach('psb-native-50mp',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

for(const action of ['font-add','font-remove','font-descriptor','encoding-change','pending-font','unrelated-font','hidden-font'] as const)test(`PSB ${action} guards native font appearance`,async({page},info)=>{
 const bytes=await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2');let resume=()=>{};
 if(action==='pending-font'){const gate=new Promise<void>(resolve=>{resume=resolve;});await page.route('**/pending-psb-font.woff2',async route=>{await gate;await route.fulfill({body:bytes,contentType:'font/woff2'});});}
 await page.goto('/');
 try{
 const result=await page.evaluate(async({action,font})=>{
  const{TextLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:400,height:140});
  const family='Canoli PSB Page Font',face=new FontFace(family,action==='pending-font'?'url("/pending-psb-font.woff2")':new Uint8Array(font));if(action==='pending-font')void face.load().catch(()=>{});else await face.load();document.fonts.add(face);
  editor.document.layers.add(new TextLayer({text:'Native page-only font',fontFamily:`"${family}", monospace`,fontSize:28,visible:action!=='hidden-font'}));
  const replacement=new FontFace(action==='unrelated-font'?'Unrelated PSB Font':family,new Uint8Array(font)),before=JSON.stringify(editor.document.toJSON()),render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[];let changed=false,returned=false,error='',calls=0;const status=face.status;
  editor.renderer.render=async(...args)=>{calls++;const tile=await render(...args);surfaces.push(tile);return tile;};
  try{await editor.export({format:'psb'},{onProgress:p=>{if(changed||p.phase!==(action==='encoding-change'?'encoding':'rendering'))return;changed=true;if(action==='font-remove'||action==='hidden-font')document.fonts.delete(face);else if(action==='font-descriptor')face.weight='700';else document.fonts.add(replacement);}});returned=true;}catch(e){error=String(e);}finally{editor.renderer.render=render;document.fonts.delete(face);document.fonts.delete(replacement);}
  const result={action,status,calls,changed,returned,error,released:surfaces.every(s=>!s.width&&!s.height),readonly:before===JSON.stringify(editor.document.toJSON())};editor.dispose();return result;
 },{action,font:[...bytes]});
 await info.attach('font-lifetime',{body:JSON.stringify(result),contentType:'application/json'});expect(result.released).toBe(true);expect(result.readonly).toBe(true);
 if(action==='unrelated-font'){expect(result.returned,JSON.stringify(result)).toBe(true);expect(result.calls).toBe(6);}else{expect(result.returned).toBe(false);expect(result.error).toMatch(/font.*changed|font.*not loaded/i);expect(result.calls).toBe(action==='encoding-change'?6:0);}if(action==='pending-font')expect(result.status).toBe('loading');
 }finally{resume();}
});



test('PSB dialog cancels native work without download or history changes and retries',async({page},info)=>{
 const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));await page.goto('/');
 await page.evaluate(()=>{const {editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:4096,height:4096,name:'PSB retry'});const p=editor.document.layers.add(new PaintLayer());p.strokes.add(new PaintFill({bounds:{x:0,y:0,width:4096,height:4096},color:'#804020',opacity:.5}));});
 const before=await page.evaluate(()=>({document:JSON.stringify(window.luma.editor.document.toJSON()),revision:window.luma.editor.document.getSnapshot().revision}));
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('psb');await dialog.getByLabel('PSB layers',{exact:true}).selectOption('flatten');
 await dialog.getByRole('button',{name:'Export .psb',exact:true}).click();
 await expect.poll(async()=>Number(await dialog.getByRole('progressbar').getAttribute('value'))).toBeGreaterThan(0);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog.getByRole('button',{name:'Export .psb',exact:true})).toBeEnabled();expect(downloads).toEqual([]);
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .psb',exact:true}).click();const path=info.outputPath('retry.psb');await(await pending).saveAs(path);await expect(dialog).not.toBeVisible();expect(downloads).toHaveLength(1);
 const pngPending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const reference=info.outputPath('reference.png');await(await pngPending).saveAs(reference);
 const after=await page.evaluate(()=>({document:JSON.stringify(window.luma.editor.document.toJSON()),revision:window.luma.editor.document.getSnapshot().revision}));expect(after).toEqual(before);
 const manifest=info.outputPath('retry-cases.json');await writeFile(manifest,JSON.stringify([{path,reference,format:'psb',names:['PSB retry'],visibility:[true],singleLayerReference:true}]));const checked=spawnSync(process.env.CANOLI_PSB_PYTHON||'python3',['scripts/check-photoshop-export.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);
 await info.attach('psb-dialog-independent',{body:checked.stdout,contentType:'application/json'});
});
