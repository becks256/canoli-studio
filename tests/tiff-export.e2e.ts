import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

async function saveBlob(page:Page,key:string,path:string){const pending=page.waitForEvent('download');await page.evaluate(key=>{const blob=(window as unknown as {tiffBlobs:Record<string,Blob>}).tiffBlobs[key],a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=key==='png'?'reference.png':key+'.tif';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},key);await(await pending).saveAs(path);}
async function independent(page:Page,directory:string,cases:{key:string;width:number;height:number;bigTiff:boolean}[]){
 await mkdir(directory,{recursive:true});const png=directory+'/reference.png';await saveBlob(page,'png',png);const manifest=[];
 for(const item of cases){const path=directory+'/'+item.key+'.tif';await saveBlob(page,item.key,path);manifest.push({...item,path,referencePng:png});}
 const path=directory+'/cases.json';await writeFile(path,JSON.stringify(manifest));const checked=spawnSync('python3',['scripts/check-tiff-interoperability.py',path],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);return JSON.parse(checked.stdout);
}
for(const scenario of ['rgba','composition','smart-paint','wide','page-font'] as const)test(`native TIFF ${scenario} matches PNG through independent classic/BigTIFF decoding`,async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 if(scenario==='page-font'){const font=[...await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')];await page.evaluate(async font=>{const face=new FontFace('TIFF Pixel Font',new Uint8Array(font));await face.load();document.fonts.add(face);},font);}
 const result=await page.evaluate(async scenario=>{
  const {editor,Document,RasterLayer,PaintLayer,PaintFill,CloneStroke,VectorLayer,VectorPath,TextLayer,LayerGroup,LayerMask,MarqueeSelection,LayerStyle,AffineTransform,AdjustmentLayer,SmartToneFilter}=window.luma;
  const width=scenario==='wide'?16417:2081,height=scenario==='wide'?146:289;editor.newDocument({width,height,name:'Private document name'});const doc=editor.document;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const c=canvas.getContext('2d')!,image=c.createImageData(256,128);for(let y=0;y<128;y++)for(let x=0;x<256;x++)image.data.set([x,255-x,y*2,(x+y)%256],(y*256+x)*4);c.putImageData(image,0,0);const source=await editor.assetStore.add(await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png')),'Private source name',undefined,false),sourceHash=await crypto.subtle.digest('SHA-256',await source.blob.arrayBuffer());canvas.width=canvas.height=0;
  const raster=doc.layers.add(new RasterLayer({assetId:source.id,width:256,height:128,x:960,y:80}));
  if(scenario==='page-font')doc.layers.add(new TextLayer({text:'A page-only font becomes portable pixels',fontFamily:'"TIFF Pixel Font", monospace',fontSize:32,x:1000,y:55,color:'#3060a0'}));
  if(scenario==='composition'){
   raster.clear(new MarqueeSelection({shape:'rectangle',x:1000,y:124,width:32,height:9}));const group=doc.layers.add(new LayerGroup({opacity:.73}));group.transform=new AffineTransform(1,.05,-.08,1,900,12);
   const vector=group.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:0,y:0,width:500,height:260},12,{fill:'#3060d0',stroke:'#ff8060',strokeWidth:3}));group.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:920,y:5,width:360,height:270}),feather:3,density:.8});
   const text=doc.layers.add(new TextLayer({text:'  Canoli\u00a0Studio\nNative TIFF',fontFamily:'monospace',fontKerning:'normal',fontSize:30,wordSpacing:8,x:1010,y:112,color:'#4070a0'}));text.styles=new LayerStyle({dropShadow:{enabled:true,x:11,y:7,blur:4,color:'#502080',opacity:.7}});
   doc.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:.2,contrast:5,saturation:10},opacity:.6}));
  }
  if(scenario==='smart-paint'){
   const paint=doc.layers.add(new PaintLayer());paint.strokes.add(new CloneStroke({points:[{x:1000,y:140},{x:1200,y:170}],size:80,hardness:.5,tiles:[{assetId:source.id,x:960,y:80,width:256,height:128}]}));paint.strokes.add(new PaintFill({bounds:{x:1020,y:124,width:140,height:20},color:'#0080ff',opacity:.4}));
   const master=new Document({width:128,height:96});master.layers.add(new TextLayer({text:'TIFF',fontSize:28,fontFamily:'monospace',x:8,y:8,color:'#ff6000'}));const key=doc.defineComponent(master);doc.placeSmartObject(key,{x:1950,y:120});const filtered=doc.placeSmartObject(key,{x:1770,y:121});filtered.setFilters([new SmartToneFilter({exposure:1})]);
  }
  if(scenario==='wide'){const v=doc.layers.add(new VectorLayer({opacity:.5}));v.paths.add(VectorPath.rectangle({x:16350.5,y:55.25,width:60,height:70},8,{fill:'#ff8040',stroke:'#4050ff',strokeWidth:3}));v.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:16340,y:52,width:80,height:80}),feather:2.5});doc.layers.add(new TextLayer({text:'Wide TIFF',fontFamily:'serif',fontSize:24,x:16200,y:59,color:'#804020'}));}
  const hidden=doc.layers.add(new PaintLayer({visible:false}));hidden.strokes.add(new PaintFill({bounds:{x:0,y:0,width:2081,height:289},color:'#ff0000'}));
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,past=doc.getSnapshot().past.length,outputs:Record<string,Blob>={png:await editor.exportPng()},reports=[];
  for(const variant of ['auto','classic','big'] as const){const output=await editor.export({format:'tiff',tiffVariant:variant});outputs[variant]=output.blob;reports.push({variant,extension:output.extension,mimeType:output.mimeType,report:output.report});}
  (window as unknown as {tiffBlobs:Record<string,Blob>}).tiffBlobs=outputs;const afterHash=await crypto.subtle.digest('SHA-256',await source.blob.arrayBuffer());
  return{scenario,width,height,readonly:before===JSON.stringify(doc.toJSON())&&revision===doc.getSnapshot().revision&&past===doc.getSnapshot().past.length,sourceUnchanged:new Uint8Array(sourceHash).every((v,i)=>v===new Uint8Array(afterHash)[i]),reports};
 },scenario);
 expect(result.readonly).toBe(true);expect(result.sourceUnchanged).toBe(true);for(const r of result.reports){expect(r.extension).toBe('tif');expect(r.mimeType).toBe('image/tiff');expect(r.report.warnings.join(' ')).toContain('flattened');expect(r.report.featuresPreserved.join(' ')).toContain('Unassociated RGBA');}
 const decoded=await independent(page,info.outputPath('independent'),['auto','classic','big'].map(key=>({key,width:result.width,height:result.height,bigTiff:key==='big'})));await info.attach('tiff-independent',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

for(const action of ['cancel','progress-error','source-remove','source-close','store-dispose','host-edit','unrelated-asset'] as const)test(`TIFF ${action} preserves snapshot ownership and cleanup`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async action=>{
  const{RasterLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:2050,height:260});const canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,16,16);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!))),source=await editor.assetStore.add(blob,'Source',undefined,false),unrelated=await editor.assetStore.add(blob,'Unrelated',undefined,false);editor.document.layers.add(new RasterLayer({assetId:source.id,width:2050,height:260}));
  const before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision,abort=new AbortController(),render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[];let invoked=false,returned=false,error='',calls=0;
  editor.renderer.render=async(...args)=>{calls++;const tile=await render(...args);surfaces.push(tile);return tile;};
  try{await editor.export({format:'tiff'},{signal:abort.signal,onProgress:p=>{if(invoked||p.phase!=='rendering'||p.fraction!==0)return;invoked=true;if(action==='cancel')abort.abort(new Error('Cancel TIFF'));else if(action==='progress-error')throw new Error('Progress callback failure');else if(action==='source-remove')editor.assetStore.remove(source.id);else if(action==='source-close')source.bitmap.close();else if(action==='store-dispose')editor.assetStore.dispose();else if(action==='host-edit')editor.document.name='Later host edit';else editor.assetStore.remove(unrelated.id);}});returned=true;}catch(cause){error=String(cause);}finally{editor.renderer.render=render;}
  let undo=false;if(action==='host-edit'){editor.document.undo();undo=before===JSON.stringify(editor.document.toJSON());}
  const result={action,invoked,returned,error,calls,released:surfaces.every(s=>!s.width&&!s.height),readonly:before===JSON.stringify(editor.document.toJSON()),revision,after:editor.document.getSnapshot().revision,undo};editor.dispose();return result;
 },action);
 await info.attach('tiff-lifetime',{body:JSON.stringify(result),contentType:'application/json'});expect(result.invoked).toBe(true);expect(result.released).toBe(true);expect(result.readonly).toBe(true);
 if(action==='host-edit'||action==='unrelated-asset'){expect(result.returned,JSON.stringify(result)).toBe(true);expect(result.calls).toBe(10);if(action==='host-edit')expect(result.undo).toBe(true);}else{expect(result.returned).toBe(false);expect(result.calls).toBe(0);expect(result.error).toMatch(/Cancel TIFF|Progress callback failure|source changed|disposed/);}
});

for(const dependency of ['clone','patch','bitmap-mask','master','asset-master','filter-mask','encoding-source'] as const)test(`TIFF pins ${dependency} through the last encoding callback`,async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async dependency=>{
  const{Document,RasterLayer,PaintLayer,CloneStroke,AdjustmentLayer,PatchAdjustment,LayerMask,SmartToneFilter}=window.luma;
  const{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:80,height:80});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,16,16);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!))),source=await editor.assetStore.add(blob,'Dependency',undefined,false);canvas.width=canvas.height=0;
  if(dependency==='clone'){const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new CloneStroke({points:[{x:8,y:8}],size:16,tiles:[{assetId:source.id,x:0,y:0,width:16,height:16}]}));}
  else if(dependency==='patch')editor.document.layers.add(new AdjustmentLayer({adjustment:new PatchAdjustment({assetId:source.id,width:16,height:16}).toJSON()}));
  else if(dependency==='bitmap-mask'){const layer=editor.document.layers.add(new PaintLayer());layer.mask=new LayerMask({assetId:source.id});}
  else if(dependency==='asset-master'){const master=new Document({width:16,height:16}),instance=editor.document.placeSmartObject(editor.document.defineComponent(master));await editor.relinkSmartObject(instance,new File([blob],'asset-master.png',{type:'image/png'}));}
  else{const master=new Document({width:16,height:16});if(dependency!=='filter-mask')master.layers.add(new RasterLayer({assetId:source.id,width:16,height:16}));const instance=editor.document.placeSmartObject(editor.document.defineComponent(master));if(dependency==='filter-mask'){instance.setFilters([new SmartToneFilter({exposure:1})]);instance.filterMask=new LayerMask({assetId:source.id});}}
  const target=dependency==='asset-master'?editor.assetStore.values().find(asset=>asset.id!==source.id)!:source;
  const before=JSON.stringify(editor.document.toJSON()),render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[];let calls=0,changed=false,error='',returned=false;
  editor.renderer.render=async(...args)=>{calls++;const tile=await render(...args);surfaces.push(tile);return tile;};
  try{await editor.export({format:'tiff'},{onProgress:p=>{if(changed||p.phase!==(dependency==='encoding-source'?'encoding':'rendering'))return;changed=true;editor.assetStore.remove(target.id);}});returned=true;}catch(e){error=String(e);}finally{editor.renderer.render=render;}
  const result={dependency,calls,changed,returned,error,released:surfaces.every(s=>!s.width&&!s.height),readonly:before===JSON.stringify(editor.document.toJSON())};editor.dispose();return result;
 },dependency);
 await info.attach('dependency-lifetime',{body:JSON.stringify(result),contentType:'application/json'});expect(result.changed).toBe(true);expect(result.returned).toBe(false);expect(result.error).toMatch(/source changed/);expect(result.released).toBe(true);expect(result.readonly).toBe(true);expect(result.calls).toBe(dependency==='encoding-source'?2:0);
});

for(const action of ['font-add','font-remove','font-descriptor','encoding-change','pending-font','unrelated-font','hidden-font'] as const)test(`TIFF ${action} guards native font appearance`,async({page},info)=>{
 const bytes=await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2');let resume=()=>{};
 if(action==='pending-font'){const gate=new Promise<void>(resolve=>{resume=resolve;});await page.route('**/pending-tiff-font.woff2',async route=>{await gate;await route.fulfill({body:bytes,contentType:'font/woff2'});});}
 await page.goto('/');
 try{
 const result=await page.evaluate(async({action,font})=>{
  const{TextLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:400,height:140});
  const family='Canoli TIFF Page Font',face=new FontFace(family,action==='pending-font'?'url("/pending-tiff-font.woff2")':new Uint8Array(font));if(action==='pending-font')void face.load().catch(()=>{});else await face.load();document.fonts.add(face);
  editor.document.layers.add(new TextLayer({text:'Native page-only font',fontFamily:`"${family}", monospace`,fontSize:28,visible:action!=='hidden-font'}));
  const replacement=new FontFace(action==='unrelated-font'?'Unrelated TIFF Font':family,new Uint8Array(font)),before=JSON.stringify(editor.document.toJSON()),render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[];let changed=false,returned=false,error='',calls=0;const status=face.status;
  editor.renderer.render=async(...args)=>{calls++;const tile=await render(...args);surfaces.push(tile);return tile;};
  try{await editor.export({format:'tiff'},{onProgress:p=>{if(changed||p.phase!==(action==='encoding-change'?'encoding':'rendering'))return;changed=true;if(action==='font-remove'||action==='hidden-font')document.fonts.delete(face);else if(action==='font-descriptor')face.weight='700';else document.fonts.add(replacement);}});returned=true;}catch(e){error=String(e);}finally{editor.renderer.render=render;document.fonts.delete(face);document.fonts.delete(replacement);}
  const result={action,status,calls,changed,returned,error,released:surfaces.every(s=>!s.width&&!s.height),readonly:before===JSON.stringify(editor.document.toJSON())};editor.dispose();return result;
 },{action,font:[...bytes]});
 await info.attach('font-lifetime',{body:JSON.stringify(result),contentType:'application/json'});expect(result.released).toBe(true);expect(result.readonly).toBe(true);
 if(action==='hidden-font'||action==='unrelated-font'){expect(result.returned,JSON.stringify(result)).toBe(true);expect(result.calls).toBe(3);}else{expect(result.returned).toBe(false);expect(result.error).toMatch(/font.*changed|font.*not loaded/i);expect(result.calls).toBe(action==='encoding-change'?3:0);}if(action==='pending-font')expect(result.status).toBe('loading');
 }finally{resume();}
});

test('native 50 MP TIFF preserves saved sources and every exported RGBA pixel',async({page},info)=>{
 test.setTimeout(180000);const bytes=await readFile('tests/fixtures/matting/native-50mp.png');await page.goto('/');
 const result=await page.evaluate(async bytes=>{
  const{PaintLayer,PaintFill}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-50mp.png',{type:'image/png'}));
  const sourceId=(editor.document.selectedLayer as InstanceType<typeof window.luma.RasterLayer>).assetId,paint=editor.document.layers.add(new PaintLayer());for(const [x,y]of [[2045,61],[4093,125],[9993,4993]])paint.strokes.add(new PaintFill({bounds:{x,y,width:7,height:7},color:'#ff8040',opacity:.5}));
  const saved=editor.document.toJSON(),project=await editor.saveProject();await editor.openProject(new File([project],'native-tiff.luma'));const reopened=JSON.stringify(saved)===JSON.stringify(editor.document.toJSON()),source=editor.assetStore.get(sourceId),original=new Uint8Array(await source.blob.arrayBuffer()),before=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
  const render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[],regions:{width:number;height:number}[]=[],progress:number[]=[];editor.renderer.render=async(...args)=>{const tile=await render(...args);regions.push({width:tile.width,height:tile.height});surfaces.push(tile);return tile;};
  const start=performance.now();let outputs:Record<string,Blob>;
  try{outputs={png:await editor.exportPng(),classic:(await editor.export({format:'tiff',tiffVariant:'classic'},{onProgress:p=>{if(p.fraction!==null)progress.push(p.fraction);}})).blob,big:(await editor.export({format:'tiff',tiffVariant:'big'})).blob};}finally{editor.renderer.render=render;}
  (window as unknown as {tiffBlobs:Record<string,Blob>}).tiffBlobs=outputs;
  const result={milliseconds:performance.now()-start,width:editor.document.width,height:editor.document.height,reopened,sourceSize:[source.width,source.height],sourceUnchanged:original.length===bytes.length&&original.every((v,i)=>v===bytes[i]),readonly:before===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision,released:surfaces.every(s=>!s.width&&!s.height),regions,progress};editor.dispose();return result;
 },[...bytes]);
 expect([result.width,result.height]).toEqual([10000,5000]);expect(result.sourceSize).toEqual([10000,5000]);expect(result.reopened).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.readonly).toBe(true);expect(result.released).toBe(true);expect(result.regions).toHaveLength(1185);expect(result.regions.every(r=>r.width<=2048&&r.height<=64)).toBe(true);expect(result.progress[0]).toBe(0);expect(result.progress.at(-1)).toBe(1);
 const decoded=await independent(page,info.outputPath('native-50mp'),['classic','big'].map(key=>({key,width:10000,height:5000,bigTiff:key==='big'})));await info.attach('native-50mp',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

test('TIFF dialog cancels real native export without a partial download and retries',async({page},info)=>{
 const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));await page.goto('/');await page.evaluate(()=>{const{editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:4096,height:4096});const paint=editor.document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:4096,height:4096},color:'#804020',opacity:.5}));});
 const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('tiff');await expect(dialog.getByLabel('TIFF compatibility')).toHaveValue('auto');await dialog.getByRole('button',{name:'Export .tif',exact:true}).click();await expect.poll(()=>dialog.getByRole('progressbar').getAttribute('value')).not.toBe('0');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog.getByRole('button',{name:'Export .tif',exact:true})).toBeEnabled();expect(downloads).toEqual([]);expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 await dialog.getByLabel('TIFF compatibility').selectOption('classic');const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .tif',exact:true}).click();const output=await pending;expect(output.suggestedFilename()).toMatch(/\.tif$/);await output.saveAs(info.outputPath('retry.tif'));await expect(dialog).toHaveCount(0);expect(downloads).toHaveLength(1);
});
