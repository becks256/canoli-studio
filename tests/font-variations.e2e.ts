import {gunzipSync} from 'node:zlib';
import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {historyPng,historyProject,historyScript} from './helpers/history-inspector';

test('independent static font instances match native variable axes and survive Inspector edits, undo, scripts and reopening',async({page},info)=>{
 test.setTimeout(240000);
 const warnings:string[]=[];page.on('console',message=>{if(message.text().includes('Cannot update a component'))warnings.push(message.text());});
 const font=await readFile('tests/fixtures/font-variations/Axes.ttf'),reference=await readFile('tests/fixtures/font-variations/Axes-mid.ttf');
 await page.goto('/');await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
 const result=await page.evaluate(async({font,reference})=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:320,height:160});
  const source=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));
  const first=editor.document.layers.add(new TextLayer({name:'Default axes',text:'AAAA',fontFamily:source.family,fontSize:40,color:'#2468ac',x:12,y:12}));
  const varied=editor.document.layers.add(new TextLayer({name:'Variable axes',text:'AAAA',fontFamily:source.family,fontSize:40,color:'#2468ac',fontVariationSettings:'"TEST" 50, "wght" 600',x:12,y:72}));editor.document.selectedLayer=varied;
  const native=new FontFace('IndependentStaticAxes',new Uint8Array(reference).buffer);await native.load();document.fonts.add(native);
  const base=new FontFace('IndependentDefaultAxes',new Uint8Array(font).buffer);await base.load();document.fonts.add(base);
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=160;const context=canvas.getContext('2d')!;context.textBaseline='top';context.fillStyle='#2468ac';context.font='normal 40px IndependentDefaultAxes';context.fillText('AAAA',12,12);context.font='normal 40px IndependentStaticAxes';context.fillText('AAAA',12,72);const advance=context.measureText('AAAA').width;
  const expected=context.getImageData(0,0,320,160).data.slice(),referencePng=canvas.toDataURL();
  const image=await createImageBitmap(await editor.exportPng());context.clearRect(0,0,320,160);context.drawImage(image,0,0);image.close();const actual=context.getImageData(0,0,320,160).data;let maximum=0;for(let index=0;index<actual.length;index++)maximum=Math.max(maximum,Math.abs(actual[index]-expected[index]));
  return{maximum,width:varied.width,expectedWidth:Math.round(advance),baseWidth:first.width,referencePng,sourceFamily:source.family};
 },{font:[...font],reference:[...reference]});
 expect(result.maximum).toBe(0);expect(result.width).toBe(result.expectedWidth);expect(result.width).not.toBe(result.baseWidth);
 await writeFile(info.outputPath('axes-reference.png'),Buffer.from(result.referencePng.split(',')[1],'base64'));
 const before=await historyPng(page,info,'axes-before.png');await page.locator('.variable-font-axes summary').click();
 const field=page.getByRole('spinbutton',{name:/^Axis TEST/});await field.fill('20.5');await field.press('Enter');const edited=await historyPng(page,info,'axes-edited.png');expect(edited.bytes).not.toEqual(before.bytes);
 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyPng(page,info,'axes-undo.png')).bytes).toEqual(before.bytes);
 await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyPng(page,info,'axes-redo.png')).bytes).toEqual(edited.bytes);
 const project=await historyProject(page,info,'axes-project.luma');expect(project.value.document.children[1]).toMatchObject({fontVariationSettings:'"TEST" 20.5, "wght" 600'});expect(Buffer.from(await project.value.fonts[0].original.arrayBuffer())).toEqual(font);
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),example=guide.match(/<!-- example: embedded-font-axes -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();await historyScript(page,example!,'Variable study ready');
 const scripted=await historyProject(page,info,'axes-script.luma');expect(scripted.value.document.children[2]).toMatchObject({name:'Variable study',fontVariationSettings:'"TEST" 50, "wght" 600',width:result.width});
 await page.reload();await page.getByTestId('project-input').setInputFiles(project.path);await expect(page.getByRole('button',{name:'Select Variable axes',exact:true})).toBeVisible();expect((await historyPng(page,info,'axes-reopened.png')).bytes).toEqual(edited.bytes);
 await page.getByRole('button',{name:'Select Variable axes',exact:true}).click();await page.locator('.variable-font-axes summary').click();await expect(page.getByRole('spinbutton',{name:/^Axis TEST/})).toHaveValue('20.5');
 await page.screenshot({path:info.outputPath('axes-inspector.png')});
 expect(warnings).toEqual([]);
});

test('native cache eviction preserves pinned tuples and detects altered instance state before export',async({page},info)=>{
 test.setTimeout(240000);const font=await readFile('tests/fixtures/font-variations/Axes.ttf');await page.goto('/');
 const result=await page.evaluate(async font=>{
  const{captureNativeFontVariations}=await import(/* @vite-ignore */String('/src/fonts/variations.ts'));
  const{editor,TextLayer}=window.luma;editor.newDocument({width:320,height:160});const file=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));
  const layer=editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:file.family,fontSize:40,fontVariationSettings:'"TEST" 50, "wght" 600'}));
  const capture=captureNativeFontVariations([layer.toJSON()as import('../src/core/model').TextLayerData]),pinned=[...document.fonts].filter(face=>face.family===capture.families[0]);
  const prefix=`CanoliVariation_${file.id}_`,count=()=>[...document.fonts].filter(face=>face.family.startsWith(prefix)).length;
  for(let value=0;value<=100;value++)layer.fontVariationSettings=`"TEST" ${value}`;
  capture.check();const retained=pinned.every(face=>document.fonts.has(face)),during=count();capture.release();const after=count();
  const before=await editor.exportPng(),request=layer.fontVariationSettings!,tuple=[...document.fonts].find(face=>face.family.startsWith(prefix)&&face.variationSettings.includes('"TEST" 100'))!;
  if(!tuple)throw new Error('Missing last native tuple');const original=tuple.variationSettings;tuple.variationSettings='"TEST" 99';let error='';try{await editor.exportPng();}catch(cause){error=String(cause);}finally{tuple.variationSettings=original;}
  const restored=await editor.exportPng(),same=BufferlessEqual(new Uint8Array(await before.arrayBuffer()),new Uint8Array(await restored.arrayBuffer()));
  function BufferlessEqual(a:Uint8Array,b:Uint8Array){return a.length===b.length&&a.every((value,index)=>value===b[index]);}
  return{retained,during,after,error,same,setting:layer.fontVariationSettings,request,originalBytes:editor.assetStore.fonts.get(file.id).original.size};
 },[...font]);
 expect(result.retained).toBe(true);expect(result.during).toBeLessThanOrEqual(65);expect(result.after).toBeLessThanOrEqual(64);expect(result.error).toMatch(/variable.font|owned/i);expect(result.same).toBe(true);expect(result.setting).toBe(result.request);expect(result.originalBytes).toBe(font.length);
 await writeFile(info.outputPath('axes-cache.json'),JSON.stringify(result,null,2));
});

test('missing native descriptor support rejects explicit axes without fallback edits and permits reset',async({page},info)=>{
 const font=await readFile('tests/fixtures/font-variations/Axes.ttf');await page.addInitScript(()=>{delete(FontFace.prototype as unknown as Record<string,unknown>).variationSettings;});await page.goto('/');
 const result=await page.evaluate(async font=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:320,height:160});const source=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf')),layer=editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:source.family,fontSize:40}));
  const before=editor.document.toJSON(),revision=editor.document.getSnapshot().revision;let error='';try{layer.fontVariationSettings='"TEST" 50';}catch(cause){error=String(cause);}
  const unchanged=JSON.stringify(before)===JSON.stringify(editor.document.toJSON())&&revision===editor.document.getSnapshot().revision;layer.resetVariableAxes();await editor.exportPng();return{error,unchanged,setting:layer.fontVariationSettings,width:layer.width};
 },[...font]);
 expect(result.error).toContain('cannot render native font variations');expect(result.unchanged).toBe(true);expect(result.setting).toBe('normal');expect(result.width).toBeGreaterThan(0);await writeFile(info.outputPath('axes-unsupported.json'),JSON.stringify(result,null,2));
});

test('owned fallback families retain native variation and clamping across one shaped line',async({page},info)=>{
 const names=['Axes.ttf','Axes-fallback.ttf','Axes-mid.ttf','Axes-fallback-mid.ttf'],files=await Promise.all(names.map(name=>readFile('tests/fixtures/font-variations/'+name)));
 await page.goto('/');const result=await page.evaluate(async files=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:320,height:120});
  // Opposite declaration/family order proves matching follows authored tokens.
  const fallback=await editor.document.fonts.embed(new File([new Uint8Array(files[1])],'fallback.ttf')),primary=await editor.document.fonts.embed(new File([new Uint8Array(files[0])],'primary.ttf'));
  const family=`${primary.family}, ${fallback.family}, serif`,text=editor.document.layers.add(new TextLayer({text:'ABBA',fontFamily:family,fontVariationSettings:'"TEST" 50, "wght" 600',fontSize:40,color:'#2468ac',x:12,y:12}));
  for(const[index,family]of ['StaticPrimaryAxes','StaticFallbackAxes'].entries()){const face=new FontFace(family,new Uint8Array(files[index+2]).buffer);await face.load();document.fonts.add(face);}
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=120;const context=canvas.getContext('2d')!;context.font='normal 40px StaticPrimaryAxes, StaticFallbackAxes, serif';context.textBaseline='top';context.fillStyle='#2468ac';const width=Math.round(context.measureText('ABBA').width);context.fillText('ABBA',12,12);const reference=canvas.toDataURL(),expected=context.getImageData(0,0,320,120).data.slice();
  const image=await createImageBitmap(await editor.exportPng());context.clearRect(0,0,320,120);context.drawImage(image,0,0);image.close();const actual=context.getImageData(0,0,320,120).data;let maximum=0;for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));return{width,actualWidth:text.width,maximum,reference,family:text.fontFamily};
 },files.map(file=>[...file]));
 expect(result.maximum).toBe(0);expect(result.actualWidth).toBe(result.width);expect(result.family).toContain('serif');await writeFile(info.outputPath('axes-fallback-reference.png'),Buffer.from(result.reference.split(',')[1],'base64'));await historyPng(page,info,'axes-fallback.png');
});

test('a genuine 50 MP RAW and variable font retain every source and output sample across reopening and native tile boundaries',async({page},info)=>{
 test.setTimeout(480000);const font=await readFile('tests/fixtures/font-variations/Axes.ttf'),staticFont=await readFile('tests/fixtures/font-variations/Axes-mid.ttf');const rawPath=info.outputPath('font-axes-50mp.dng');await writeFile(rawPath,gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')));
 await page.goto('/');await page.getByTestId('import-input').setInputFiles(rawPath);const review=page.getByRole('dialog',{name:'Import camera RAW',exact:true});await review.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await review.getByRole('button',{name:'Import RAW image',exact:true}).click();await expect(review).toHaveCount(0,{timeout:180000});
 const result=await page.evaluate(async({font,staticFont})=>{
  const{editor,PaintLayer,PaintFill,TextLayer}=window.luma,originalDocument=editor.document;
  const embedded=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));
  editor.document.layers.add(new PaintLayer({name:'Opaque reference region'})).strokes.add(new PaintFill({bounds:{x:2016,y:2024,width:600,height:200},color:'#ffffff'}));
  const text=editor.document.layers.add(new TextLayer({text:'AAAA AAAA',fontSize:40,fontFamily:embedded.family,fontVariationSettings:'"TEST" 50, "wght" 600',color:'#000000',x:2032,y:2040})),source=text.text,model=JSON.stringify(editor.document.toJSON()),project=await editor.saveProject();
  await editor.openProject(new File([project],'Font features 50MP.luma'));await editor.closeDocument(originalDocument,{discardChanges:true});const asset=editor.assetStore.values().find(value=>value.raw)!,original=asset.raw!.originalBlob;
  const originalSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const referenceFace=new FontFace('IndependentLargeAxes',new Uint8Array(staticFont).buffer);await referenceFace.load();document.fonts.add(referenceFace);
  const glyphs=document.createElement('canvas');glyphs.width=600;glyphs.height=200;const c=glyphs.getContext('2d')!;c.font='normal 40px IndependentLargeAxes';c.textBaseline='top';c.fillStyle='#000000';c.fillText(source,16,16);
  const reference=document.createElement('canvas');reference.width=600;reference.height=200;const r=reference.getContext('2d')!;r.fillStyle='#ffffff';r.fillRect(0,0,600,200);r.drawImage(glyphs,0,0);const referencePng=await new Promise<Blob>(resolve=>reference.toBlob(value=>resolve(value!)));glyphs.width=glyphs.height=reference.width=reference.height=0;
  const surfaces:HTMLCanvasElement[]=[],renderer=editor.renderer,render=renderer.render.bind(renderer);renderer.render=async(...args)=>{const value=await render(...args);if(args[2]?.readback&&args[2]?.cache===false)surfaces.push(value);return value;};let png:Blob;
  try{png=await editor.exportPng();}finally{renderer.render=render;}
  (window as any).fontAxesLarge={png,reference:referencePng,project};return{originalBytes:original.size,originalSha256,modelUnchanged:JSON.stringify(editor.document.toJSON())===model,released:surfaces.every(canvas=>canvas.width===0&&canvas.height===0),surfaces:surfaces.length};
 },{font:[...font],staticFont:[...staticFont]});expect(result).toMatchObject({originalBytes:100000672,originalSha256:'cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85',modelUnchanged:true,released:true});expect(result.surfaces).toBeGreaterThan(0);
 for(const key of ['png','reference','project']){const pending=page.waitForEvent('download'),path=info.outputPath('font-axes-50mp-'+key+(key==='project'?'.luma':'.png'));await page.evaluate(key=>{const anchor=document.createElement('a'),blob=(window as any).fontAxesLarge[key];anchor.href=URL.createObjectURL(blob);anchor.download=key+(key==='project'?'.luma':'.png');anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);},key);await(await pending).saveAs(path);}
 await writeFile(info.outputPath('font-axes-50mp.json'),JSON.stringify(result,null,2));
});

test('variable-axis public workflow preserves sources, precision cancellation, reset, undo and reopened pixels',async({page},info)=>{test.setTimeout(240000);const{fontVariationsWorkflow}=await import('./helpers/font-variations');await fontVariationsWorkflow(page,info);});

test('native styles, inert plugins, portable recipes, SVG and workspace recovery retain axis intent and owned sources',async({page},info)=>{
 test.setTimeout(240000);const font=await readFile('tests/fixtures/font-variations/Axes.ttf');await page.goto('/');
 const result=await page.evaluate(async font=>{
  const{editor,TextLayer,ParagraphStyle,LayerGroup}=window.luma;editor.newDocument({name:'Axis style source',width:320,height:160});const source=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));
  const style=editor.document.paragraphStyles.add(new ParagraphStyle({name:'Variable style',format:{fontFamily:source.family,fontSize:40,color:'#2468ac',fontVariationSettings:'"TEST" 20, "wght" 600'}})),text=editor.document.layers.add(new TextLayer({name:'Styled axes',text:'AAAA',x:12,y:12}));text.paragraphStyle=style;editor.document.selectedLayer=text;style.update({fontVariationSettings:'"TEST" 50, "wght" 600'});const width=text.width;
  const before=JSON.stringify(editor.document.toJSON()),history=editor.document.getSnapshot().past.length,plugin={format:'luma-plugin',apiVersion:1,id:'canoli.axes-study',name:'Axis study',version:'1.0.0',description:'Change a declared native axis',permissions:['document:read','document:write'],commands:[{id:'change',title:'Change axes',source:'document.selectedLayer.fontVariationSettings=\'"TEST" 80\';'}]};editor.plugins.install(plugin);const inert=JSON.stringify(editor.document.toJSON())===before;editor.plugins.setGrantedPermissions(plugin.id,['document:read']);let denied=false;try{await editor.runPlugin(plugin.id,'change');}catch{denied=true;}
  const rejected=JSON.stringify(editor.document.toJSON())===before;editor.plugins.setGrantedPermissions(plugin.id,['document:read','document:write']);await editor.runPlugin(plugin.id,'change');const pluginWidth=text.width,oneUndo=editor.document.getSnapshot().past.length===history+1;editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===before,original=await editor.exportPng(),svg=await editor.export({format:'svg'}),xml=await svg.blob.text();
  await editor.openSvg(new File([svg.blob],'Variable axes.svg'));const importedPng=await editor.exportPng(),queue=[...editor.document.layers];let importedText:typeof text|undefined;while(queue.length){const layer=queue.shift()!;if(layer instanceof TextLayer){importedText=layer;break;}if(layer instanceof LayerGroup)queue.push(...layer.layers);}if(!importedText)throw new Error('Expected editable SVG text');const importedSetting=importedText.fontVariationSettings;
  editor.newDocument({name:'Axis recipe source',width:320,height:160});const recipeFont=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));editor.recipes.startRecording();editor.document.layers.add(new TextLayer({name:'Portable axes',text:'AAAA',fontFamily:recipeFont.family,fontSize:40,fontVariationSettings:'"TEST" 50, "wght" 600',color:'#2468ac',x:12,y:12}));const recipe=await editor.recipes.stopRecording({name:'Variable type'}),pack=await editor.recipes.exportRecipePackage(recipe);
  editor.newDocument({name:'Axis recipient',width:320,height:160});const empty=JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length;await editor.recipes.executeRecipePackage(pack);const recipeText=editor.document.layers.at(0);if(!(recipeText instanceof TextLayer))throw new Error('Expected portable text');const packagedPng=await editor.exportPng(),recipeOneUndo=editor.document.getSnapshot().past.length===past+1;editor.document.undo();const recipeUndo=JSON.stringify(editor.document.toJSON())===empty;editor.document.redo();
  await editor.saveWorkspace();(window as any).axisTransport={original,imported:importedPng,packaged:packagedPng,svg:svg.blob,pack};return{inert,denied,rejected,oneUndo,undo,width,pluginWidth,importedSetting,recipeSetting:recipeText.fontVariationSettings,recipeWidth:recipeText.width,recipeOneUndo,recipeUndo,xmlHasAxes:xml.includes('font-variation-settings:'),svgFeatures:svg.report.featuresPreserved,fonts:editor.document.fonts.files.length};
 },[...font]);
 expect(result).toMatchObject({inert:true,denied:true,rejected:true,oneUndo:true,undo:true,recipeSetting:'"TEST" 50, "wght" 600',recipeOneUndo:true,recipeUndo:true,xmlHasAxes:true,fonts:1});expect(result.importedSetting).toMatch(/^"TEST"\s*50\s*,\s*"wght"\s*600$/);expect(result.recipeWidth).toBe(result.width);expect(result.pluginWidth).not.toBe(result.width);expect(result.svgFeatures).toContain('Declared variable-font axis requests as editable SVG typography');
 for(const key of ['original','imported','packaged','svg','pack']){const pending=page.waitForEvent('download');await page.evaluate(key=>{const blob=(window as any).axisTransport[key],url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=key;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},key);await(await pending).saveAs(info.outputPath('axes-transport-'+key+(key==='svg'?'.svg':key==='pack'?'.json':'.png')));}
 await page.reload();await page.evaluate(async()=>{await window.luma.editor.restoreWorkspace();});await expect(page.getByRole('tab',{name:/Axis recipient/})).toBeVisible();await historyPng(page,info,'axes-transport-workspace.png');await historyProject(page,info,'axes-transport-workspace.luma');await writeFile(info.outputPath('axes-transport.json'),JSON.stringify(result,null,2));
});

for(const mode of ['point','paragraph']as const)test(`variable-axis corner resize keeps the opposite corner and one undo: ${mode}`,async({page},info)=>{
 const font=await readFile('tests/fixtures/font-variations/Axes.ttf');await page.goto('/');await page.evaluate(async({font,mode})=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:800,height:600});const source=await editor.document.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));
  editor.document.selectedLayer=editor.document.layers.add(new TextLayer({text:'AAAA AAAA AAAA',fontFamily:source.family,fontSize:40,fontVariationSettings:'"TEST" 50, "wght" 600',...(mode==='paragraph'?{wrapWidth:300}:{}),x:120,y:120,color:'#2468ac'}));
 },{font:[...font],mode});await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+1');
 const before=await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),data:window.luma.editor.document.selectedLayer!.toJSON(),past:window.luma.editor.document.getSnapshot().past.length}));if(before.data.kind!=='text')throw new Error('Expected text');
 const box=(await page.locator('.handle-nw').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+box.height/2);expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before.model);await page.mouse.up();
 const after=await page.evaluate(()=>({data:window.luma.editor.document.selectedLayer!.toJSON(),past:window.luma.editor.document.getSnapshot().past.length}));if(after.data.kind!=='text')throw new Error('Expected text');expect(after.data.x+after.data.width).toBeCloseTo(before.data.x+before.data.width,5);expect(after.data.y+after.data.height).toBeCloseTo(before.data.y+before.data.height,5);expect(after.data.fontVariationSettings).toBe(before.data.fontVariationSettings);expect(after.past).toBe(before.past+1);await page.keyboard.press('Control+z');expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before.model);await writeFile(info.outputPath('axes-resize-'+mode+'.json'),JSON.stringify({before,after},null,2));
});

test('copied variable-font artwork retains exact native output after source closure and releases its last native owner',async({page},info)=>{
 test.setTimeout(240000);const font=await readFile('tests/fixtures/font-variations/Axes.ttf'),staticFont=await readFile('tests/fixtures/font-variations/Axes-mid.ttf');await page.goto('/');
 const result=await page.evaluate(async({font,staticFont})=>{
  const{editor,TextLayer}=window.luma,source=editor.document;source.resize(320,160);const file=await source.fonts.embed(new File([new Uint8Array(font)],'Axes.ttf'));
  const text=source.layers.add(new TextLayer({name:'Copied variable type',text:'AAAA',fontFamily:file.family,fontSize:40,fontVariationSettings:'"TEST" 50, "wght" 600',color:'#2468ac',x:12,y:12}));source.selectedLayer=text;
  const face=new FontFace('IndependentLifetimeAxes',new Uint8Array(staticFont).buffer);await face.load();document.fonts.add(face);const reference=document.createElement('canvas');reference.width=320;reference.height=160;const context=reference.getContext('2d')!;context.font='normal 40px IndependentLifetimeAxes';context.textBaseline='top';context.fillStyle='#2468ac';context.fillText('AAAA',12,12);const referencePng=reference.toDataURL();
  const original=await editor.exportPng(),saved=await editor.saveArtworkToLibrary({name:'Variable font artwork',description:'',tags:[]}),target=editor.newDocument({name:'Copied variable font',width:320,height:160});editor.activateDocument(source);await editor.copySelectedLayersTo(target);editor.activateDocument(target);
  const copied=await editor.exportPng();await editor.closeDocument(source,{discardChanges:true});const sourceClosed=await editor.exportPng(),library=editor.newDocument({name:'Library variable font',width:320,height:160});await editor.placeLibraryArtwork(saved.entry.id);await editor.closeDocument(target,{discardChanges:true});
  const libraryOnly=await editor.exportPng(),project=await editor.saveProject(),prefix=`CanoliVariation_${file.id}_`,nativeBefore=[...document.fonts].filter(face=>face.family.startsWith(prefix)).length;
  const retained=editor.assetStore.fonts.get(file.id).original,bytes=new Uint8Array(await retained.arrayBuffer()),sameOriginal=bytes.length===font.length&&bytes.every((value,index)=>value===font[index]);
  editor.newDocument({name:'After variable source closure',width:320,height:160});await editor.closeDocument(library,{discardChanges:true});const nativeAfter=[...document.fonts].filter(face=>face.family.startsWith(prefix)).length;
  (window as any).axisLifetime={original,copied,sourceClosed,libraryOnly,project};return{sameOriginal,nativeBefore,nativeAfter,referencePng};
 },{font:[...font],staticFont:[...staticFont]});
 await writeFile(info.outputPath('axes-lifetime-reference.png'),Buffer.from(result.referencePng.split(',')[1],'base64'));
 expect(result.sameOriginal).toBe(true);expect(result.nativeBefore).toBeGreaterThan(0);expect(result.nativeAfter).toBe(0);
 for(const key of ['original','copied','sourceClosed','libraryOnly','project']){const pending=page.waitForEvent('download');await page.evaluate(key=>{const blob=(window as any).axisLifetime[key],url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=key;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},key);await(await pending).saveAs(info.outputPath('axes-lifetime-'+key+(key==='project'?'.luma':'.png')));}
 await writeFile(info.outputPath('axes-lifetime.json'),JSON.stringify(result,null,2));
});
