import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

async function independent(page:Page,info:TestInfo,dpi=72){
 const paths:Record<string,string>={};
 for(const key of ['png','pdf']){
  const pending=page.waitForEvent('download');
  await page.evaluate(key=>{const a=document.createElement('a'),blob=(window as unknown as {pdfOutputs:Record<string,Blob>}).pdfOutputs[key];a.href=URL.createObjectURL(blob);a.download='native.'+key;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},key);
  paths[key]=info.outputPath('native.'+key);await(await pending).saveAs(paths[key]);
 }
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-pdf-interoperability.py',paths.pdf,paths.png,'--dpi',String(dpi)],{encoding:'utf8',timeout:120000});
 expect(checked.status,checked.stderr||checked.stdout).toBe(0);return JSON.parse(checked.stdout);
}

for(const [scenario,dpi] of [['composition',72],['composition',300],['wide',72],['wide',300],['empty',72]] as const)
test(`native PDF ${scenario} at ${dpi} DPI retains exact image samples and independent rendered appearance`,async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(async({scenario,dpi})=>{
  const {editor,Document,RasterLayer,PaintLayer,PaintFill,CloneStroke,VectorLayer,VectorPath,TextLayer,LayerGroup,LayerMask,MarqueeSelection,LayerStyle,AffineTransform,AdjustmentLayer,SmartToneFilter}=window.luma;
  const width=scenario==='wide'?16417:scenario==='empty'?1:2081,height=scenario==='wide'?129:scenario==='empty'?1:193;
  editor.newDocument({width,height,name:'Private PDF document name'});const doc=editor.document;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
  const c=canvas.getContext('2d')!,image=c.createImageData(256,128);
  for(let y=0;y<128;y++)for(let x=0;x<256;x++)image.data.set([x,255-x,y*2,(x+y)%256],(y*256+x)*4);
  c.putImageData(image,0,0);const source=await editor.assetStore.add(await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png')),'Private PDF source',undefined,false);canvas.width=canvas.height=0;
  if(scenario!=='empty'){
   doc.layers.add(new RasterLayer({assetId:source.id,width:256,height:128,x:1960,y:20}));
   const group=doc.layers.add(new LayerGroup({opacity:.73}));group.transform=new AffineTransform(1,.05,-.08,1,1920,12);
   const vector=group.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:0,y:0,width:350,height:180},12,{fill:'#3060d0',stroke:'#ff8060',strokeWidth:3}));
   group.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:1920,y:5,width:300,height:180}),feather:3,density:.8});
   const text=doc.layers.add(new TextLayer({text:'Canoli Studio',fontFamily:'monospace',fontSize:24,x:1900,y:112,color:'#4070a0'}));text.styles=new LayerStyle({dropShadow:{enabled:true,x:11,y:7,blur:4,color:'#502080',opacity:.7}});
   const paint=doc.layers.add(new PaintLayer());paint.strokes.add(new CloneStroke({points:[{x:2000,y:100},{x:2100,y:120}],size:40,hardness:.5,tiles:[{assetId:source.id,x:1960,y:20,width:256,height:128}]}));paint.strokes.add(new PaintFill({bounds:{x:2030,y:64,width:35,height:67},color:'#0080ff',opacity:.4}));
   const master=new Document({width:128,height:96});master.layers.add(new TextLayer({text:'PDF',fontSize:28,fontFamily:'monospace',x:8,y:8,color:'#ff6000'}));const key=doc.defineComponent(master),smart=doc.placeSmartObject(key,{x:1970,y:120});smart.setFilters([new SmartToneFilter({exposure:.5})]);
   doc.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:.2,contrast:5,saturation:10},opacity:.6}));
   if(scenario==='wide'){const v=doc.layers.add(new VectorLayer());v.paths.add(VectorPath.rectangle({x:16350.5,y:55.25,width:60,height:65},8,{fill:'#ff8040',stroke:'#4050ff',strokeWidth:3}));}
   const hidden=doc.layers.add(new PaintLayer({visible:false}));hidden.strokes.add(new PaintFill({bounds:{x:0,y:0,width,height},color:'#ff0000'}));
  }
  const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision,sourceBytes=await source.blob.arrayBuffer(),png=await editor.exportPng();
  const surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  let output:Awaited<ReturnType<typeof editor.export>>;try{output=await editor.export({format:'pdf',pdfDpi:dpi});}finally{editor.renderer.render=render;}
  (window as unknown as {pdfOutputs:Record<string,Blob>}).pdfOutputs={png,pdf:output.blob};
  const afterBytes=new Uint8Array(await editor.assetStore.get(source.id).blob.arrayBuffer());
  return{width,height,readonly:before===JSON.stringify(doc.toJSON())&&revision===doc.getSnapshot().revision,sourceUnchanged:afterBytes.length===sourceBytes.byteLength&&afterBytes.every((v,i)=>v===new Uint8Array(sourceBytes)[i]),released:surfaces.every(s=>!s.width&&!s.height),tiles:surfaces.length,report:output.report,mimeType:output.mimeType,extension:output.extension};
 },{scenario,dpi});
 expect(result.readonly).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.released).toBe(true);
 expect(result.mimeType).toBe('application/pdf');expect(result.extension).toBe('pdf');expect(result.report.warnings.join(' ')).toContain('rasterized');
 const decoded=await independent(page,info,dpi);await info.attach('pdf-independent',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

for(const action of ['cancel','progress-error','source-remove','source-close','store-dispose','host-edit','unrelated-asset','encoding-source'] as const)
test(`PDF ${action} respects snapshot ownership and releases native surfaces`,async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async action=>{
  const {RasterLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();
  editor.newDocument({width:2050,height:260});const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d')!.fillRect(0,0,16,16);
  const blob=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!))),source=await editor.assetStore.add(blob,'Source',undefined,false),unrelated=await editor.assetStore.add(blob,'Unrelated',undefined,false);
  const layer=editor.document.layers.add(new RasterLayer({assetId:source.id,width:2050,height:260}));
  const before=JSON.stringify(editor.document.toJSON()),png=await editor.exportPng(),abort=new AbortController(),surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);let invoked=false,returned=false,error='';
  editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  try{const output=await editor.export({format:'pdf'},{signal:abort.signal,onProgress:p=>{
   if(invoked||(action==='encoding-source'?p.phase!=='encoding':p.phase!=='rendering'||p.fraction!==0))return;invoked=true;
   if(action==='cancel')abort.abort(new Error('Cancel PDF'));else if(action==='progress-error')throw new Error('Progress callback failure');
   else if(action==='source-remove'||action==='encoding-source')editor.assetStore.remove(source.id);else if(action==='source-close')source.bitmap.close();else if(action==='store-dispose')editor.assetStore.dispose();else if(action==='host-edit')layer.opacity=.25;else editor.assetStore.remove(unrelated.id);
  }});returned=true;(window as unknown as {pdfOutputs:Record<string,Blob>}).pdfOutputs={png,pdf:output.blob};}catch(cause){error=String(cause);}finally{editor.renderer.render=render;}
  if(action==='host-edit')editor.document.undo();
  const result={invoked,returned,error,calls:surfaces.length,released:surfaces.every(s=>!s.width&&!s.height),readonly:before===JSON.stringify(editor.document.toJSON())};editor.dispose();return result;
 },action);
 expect(result.invoked).toBe(true);expect(result.released).toBe(true);expect(result.readonly).toBe(true);
 if(action==='host-edit'||action==='unrelated-asset'){expect(result.returned).toBe(true);expect(result.calls).toBe(10);await independent(page,info);}
 else{expect(result.returned).toBe(false);expect(result.error).toMatch(/Cancel PDF|callback failure|source changed|disposed/);}
 await info.attach('pdf-lifetime',{body:JSON.stringify(result),contentType:'application/json'});
});

test('50 MP PDF preserves original bytes through save/reopen and every native stored sample',async({page},info)=>{
 test.setTimeout(180000);const bytes=[...await readFile('tests/fixtures/matting/native-50mp.png')];await page.goto('/');
 const result=await page.evaluate(async bytes=>{
  const {editor}=window.luma;editor.newDocument();await editor.importImage(new File([new Uint8Array(bytes)],'native-50mp.png',{type:'image/png'}));
  const before=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();await editor.openProject(new File([project],'native-pdf.luma'));
  const source=editor.assetStore.values()[0],original=new Uint8Array(await source.blob.arrayBuffer()),png=await editor.exportPng(),surfaces:HTMLCanvasElement[]=[],render=editor.renderer.render.bind(editor.renderer);editor.renderer.render=async(...args)=>{const tile=await render(...args);surfaces.push(tile);return tile;};
  let pdf:Blob;const start=performance.now();try{pdf=(await editor.export({format:'pdf'})).blob;}finally{editor.renderer.render=render;}
  (window as unknown as {pdfOutputs:Record<string,Blob>}).pdfOutputs={png,pdf};
  return{size:[editor.document.width,editor.document.height],sourceSize:[source.width,source.height],sameModel:before===JSON.stringify(editor.document.toJSON()),sourceUnchanged:original.length===bytes.length&&original.every((v,i)=>v===bytes[i]),released:surfaces.every(s=>!s.width&&!s.height),tileCount:surfaces.length,milliseconds:performance.now()-start};
 },bytes);
 expect(result.size).toEqual([10000,5000]);expect(result.sourceSize).toEqual(result.size);expect(result.sameModel).toBe(true);expect(result.sourceUnchanged).toBe(true);expect(result.released).toBe(true);expect(result.tileCount).toBe(395);
 const decoded=await independent(page,info);await info.attach('pdf-native-50mp',{body:JSON.stringify({runtime:result,decoder:decoded}),contentType:'application/json'});
});

test('PDF dialog cancels a real export, retains artwork and retries with physical sizing',async({page},info)=>{
 const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));await page.goto('/');
 await page.evaluate(()=>{const {editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:4096,height:4096});const p=editor.document.layers.add(new PaintLayer());p.strokes.add(new PaintFill({bounds:{x:0,y:0,width:4096,height:4096},color:'#804020',opacity:.5}));});
 const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');
 await dialog.getByLabel('Format',{exact:true}).selectOption('pdf');await expect(dialog.getByRole('spinbutton',{name:'PDF resolution',exact:true})).toHaveValue('72');
 await dialog.getByRole('button',{name:'Export .pdf',exact:true}).click();
 await expect.poll(()=>dialog.getByRole('progressbar').getAttribute('value')).not.toBe('0');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog.getByRole('button',{name:'Export .pdf',exact:true})).toBeEnabled();
 expect(downloads).toEqual([]);expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 const dpi=dialog.getByRole('spinbutton',{name:'PDF resolution',exact:true});await dpi.fill('300');await dpi.press('Enter');
 await expect(dialog).toContainText('13.653 × 13.653 inches');
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export .pdf',exact:true}).click();const output=await pending;
 const pdf=info.outputPath('retry.pdf');await output.saveAs(pdf);await expect(dialog).not.toBeVisible();expect(downloads).toHaveLength(1);
 const pngPending=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const png=info.outputPath('reference.png');await(await pngPending).saveAs(png);
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-pdf-interoperability.py',pdf,png,'--dpi','300'],{encoding:'utf8',timeout:120000});
 expect(checked.status,checked.stderr||checked.stdout).toBe(0);await info.attach('pdf-dialog-independent',{body:checked.stdout,contentType:'application/json'});
});

test('PDF report explains unsupported physical pages without crashing or limiting the document',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const {editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:1e12,height:1});editor.document.layers.add(new PaintLayer()).strokes.add(new PaintFill({bounds:{x:0,y:0,width:1,height:1},color:'#804020'}));});
 await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.locator('.export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('pdf');
 await expect(dialog).toContainText('exceeds supported physical page geometry');
 const dpi=dialog.getByRole('spinbutton',{name:'PDF resolution',exact:true});await dpi.fill('1000000');await dpi.press('Enter');
 await expect(dialog).not.toContainText('exceeds supported physical page geometry');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>window.luma.editor.document.width)).toBe(1e12);
});

for(const action of ['font-add','font-remove','font-descriptor','encoding-change','pending-font','unrelated-font','hidden-font'] as const)test(`PDF ${action} guards native font appearance`,async({page},info)=>{
 const bytes=await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2');let resume=()=>{};
 if(action==='pending-font'){const gate=new Promise<void>(resolve=>{resume=resolve;});await page.route('**/pending-pdf-font.woff2',async route=>{await gate;await route.fulfill({body:bytes,contentType:'font/woff2'});});}
 await page.goto('/');
 try{
 const result=await page.evaluate(async({action,font})=>{
  const{TextLayer}=window.luma,{EditorApplication}=await import(/* @vite-ignore */String('/src/editor.ts')),editor:typeof window.luma.editor=new EditorApplication();editor.newDocument({width:400,height:140});
  const family='Canoli PDF Page Font',face=new FontFace(family,action==='pending-font'?'url("/pending-pdf-font.woff2")':new Uint8Array(font));if(action==='pending-font')void face.load().catch(()=>{});else await face.load();document.fonts.add(face);
  editor.document.layers.add(new TextLayer({text:'Native page-only font',fontFamily:`"${family}", monospace`,fontSize:28,visible:action!=='hidden-font'}));
  const replacement=new FontFace(action==='unrelated-font'?'Unrelated PDF Font':family,new Uint8Array(font)),before=JSON.stringify(editor.document.toJSON()),render=editor.renderer.render.bind(editor.renderer),surfaces:HTMLCanvasElement[]=[];let changed=false,returned=false,error='',calls=0;const status=face.status;
  editor.renderer.render=async(...args)=>{calls++;const tile=await render(...args);surfaces.push(tile);return tile;};
  try{await editor.export({format:'pdf'},{onProgress:p=>{if(changed||p.phase!==(action==='encoding-change'?'encoding':'rendering'))return;changed=true;if(action==='font-remove'||action==='hidden-font')document.fonts.delete(face);else if(action==='font-descriptor')face.weight='700';else document.fonts.add(replacement);}});returned=true;}catch(e){error=String(e);}finally{editor.renderer.render=render;document.fonts.delete(face);document.fonts.delete(replacement);}
  const result={action,status,calls,changed,returned,error,released:surfaces.every(s=>!s.width&&!s.height),readonly:before===JSON.stringify(editor.document.toJSON())};editor.dispose();return result;
 },{action,font:[...bytes]});
 await info.attach('font-lifetime',{body:JSON.stringify(result),contentType:'application/json'});expect(result.released).toBe(true);expect(result.readonly).toBe(true);
 if(action==='hidden-font'||action==='unrelated-font'){expect(result.returned,JSON.stringify(result)).toBe(true);expect(result.calls).toBe(3);}else{expect(result.returned).toBe(false);expect(result.error).toMatch(/font.*changed|font.*not loaded/i);expect(result.calls).toBe(action==='encoding-change'?3:0);}if(action==='pending-font')expect(result.status).toBe('loading');
 }finally{resume();}
});
