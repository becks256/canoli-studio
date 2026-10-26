import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {characterTextWorkflow} from './helpers/character-text';

test('documented character-range script and ordinary Inspector output survive save, undo and reload',async({page},info)=>{await characterTextWorkflow(page,info);});

test('native mixed character pixels, cropped/cache output, SVG and native project survive exact undo/reopen',async({page},info)=>{
 const source=await readFile('tests/fixtures/fonts/Regular.ttf');await page.goto('/');
 const result=await page.evaluate(async source=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:320,height:180});const font=await editor.document.fonts.embed(new Blob([new Uint8Array(source)]));
  const layer=editor.document.layers.add(new TextLayer({text:'AA',fontFamily:font.family,fontSize:40,color:'#2468ac',x:16,y:12})),before=editor.document.toJSON();await layer.formatRange(1,2,{fontSize:80,color:'#cc4422'});const authored=editor.document.toJSON();
  const actual=await editor.renderer.render(authored,editor.assetStore,{readback:true}),actualPng=actual.toDataURL(),pixels=actual.getContext('2d')!.getImageData(0,0,320,180).data;
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d')!;
  c.font=`80px ${font.family}`;c.textBaseline='alphabetic';const alphabetic=c.measureText('A').actualBoundingBoxAscent;c.textBaseline='top';const baseline=alphabetic-c.measureText('A').actualBoundingBoxAscent;
  c.textBaseline='alphabetic';c.font=`40px ${font.family}`;c.fillStyle='#2468ac';c.fillText('A',16,12+baseline);const advance=c.measureText('A').width;c.font=`80px ${font.family}`;c.fillStyle='#cc4422';c.fillText('A',16+advance,12+baseline);
  const referencePng=canvas.toDataURL(),reference=c.getImageData(0,0,320,180).data,differences=pixels.reduce((n,v,i)=>n+Number(v!==reference[i]),0);
  const uncached=await editor.renderer.render(authored,editor.assetStore,{cache:false,readback:true}),crop=await editor.renderer.render(authored,editor.assetStore,{cache:false,readback:true,region:{x:10,y:10,width:120,height:120}}),cropped=crop.getContext('2d')!.getImageData(0,0,120,120).data;
  let cropDifferences=0;for(let y=0;y<120;y++)for(let x=0;x<120;x++)for(let ch=0;ch<4;ch++)cropDifferences+=Number(cropped[(y*120+x)*4+ch]!==pixels[((y+10)*320+x+10)*4+ch]);
  const svg=await(await editor.export({format:'svg'})).blob.text(),svgImage=new Image();svgImage.src=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));try{await svgImage.decode();c.clearRect(0,0,320,180);c.drawImage(svgImage,0,0);}finally{URL.revokeObjectURL(svgImage.src);}const svgPng=canvas.toDataURL();
  editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===JSON.stringify(before);editor.document.redo();const project=await editor.saveProject();await editor.openProject(new File([project],'Characters.luma'));const reopened=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{cache:false,readback:true});
  const out={actualPng,referencePng,svgPng,reopenedPng:reopened.toDataURL(),differences,cropDifferences,cacheEqual:uncached.toDataURL()===actualPng,undo,modelEqual:JSON.stringify(editor.document.toJSON())===JSON.stringify(authored),bounds:[layer.width,layer.height],svg,probes:document.querySelectorAll('[data-canoli-styled-paragraph-probe],[data-canoli-styled-text-probe]').length};for(const target of [actual,uncached,crop,reopened,canvas])target.width=target.height=0;return out;
 },[...source]);for(const key of ['actualPng','referencePng','svgPng','reopenedPng']as const)await writeFile(info.outputPath(key+'.png'),Buffer.from(result[key].split(',')[1],'base64'));await writeFile(info.outputPath('characters.svg'),result.svg);await writeFile(info.outputPath('result.json'),JSON.stringify(result,null,2));
 expect(result).toMatchObject({differences:0,cropDifferences:0,cacheEqual:true,undo:true,modelEqual:true,bounds:[72,96]});expect(result.svgPng).toBe(result.actualPng);expect(result.reopenedPng).toBe(result.actualPng);expect(result.svg).toContain('<tspan');expect(result.svg).toContain('@font-face');
 await expect.poll(()=>page.evaluate(()=>document.querySelectorAll('[data-canoli-styled-paragraph-probe],[data-canoli-styled-text-probe]').length)).toBe(0);
});

test('Inspector formats the selected range and typing into repeated text retains the actual insertion position',async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>{const{editor,TextLayer}=window.luma;editor.newDocument({width:400,height:200});const layer=editor.document.layers.add(new TextLayer({name:'Repeated',text:'AAAA',fontFamily:'monospace',color:'#123456'}));editor.document.selectedLayer=layer;});
 const content=page.getByRole('textbox',{name:'Text content',exact:true});await expect(content).toHaveValue('AAAA');await page.getByText('Character formatting',{exact:true}).click();
 await content.focus();await content.press('Home');await content.press('Shift+ArrowRight');
 const size=page.getByRole('spinbutton',{name:'Selected font size',exact:true});await expect(size).toBeEnabled();await size.fill('60');await size.press('Enter');await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.toJSON().children[0])).toMatchObject({characterRanges:[{start:0,end:1,format:{fontSize:60}}]});
 await content.focus();await content.evaluate(node=>(node as HTMLTextAreaElement).setSelectionRange(1,1));await content.press('A');await expect(content).toHaveValue('AAAAA');
 expect(await page.evaluate(()=>window.luma.editor.document.toJSON().children[0])).toMatchObject({characterRanges:[{start:0,end:2,format:{fontSize:60}}]});await content.press('Backspace');await expect(content).toHaveValue('AAAA');expect(await page.evaluate(()=>window.luma.editor.document.toJSON().children[0])).toMatchObject({characterRanges:[{start:0,end:1,format:{fontSize:60}}]});
 await content.press('Home');await content.press('Shift+ArrowRight');await page.getByRole('button',{name:'Clear selected character formatting',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.toJSON().children[0])).toMatchObject({characterRanges:[]});await page.screenshot({path:info.outputPath('character-inspector.png')});
 await page.evaluate(()=>{(window.luma.editor.document.layers.at(0)as import('../src/dom').TextLayer).text='BBBB';});await expect(size).toBeDisabled();
});

test('isolated async character formatting returns native host metrics and commits one undo; thrown scripts stay atomic',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor}=window.luma;editor.newDocument({width:400,height:240});const before=editor.document.toJSON(),history=editor.document.getSnapshot().past.length;
  await editor.runScript(`const title=document.layers.add(new TextLayer({name:'Script characters',text:'AA AA',fontSize:20,fontFamily:'serif',color:'#123456'}));await title.formatRange(3,5,{fontSize:60,color:'#cc4422'});title.x=title.width;await title.reflowNative();console.log('Native characters ready');`);
  const layer=editor.document.layers.at(0)as import('../src/dom').TextLayer,scriptWidth=layer.x,finalWidth=layer.width,authored=editor.document.toJSON(),oneUndo=editor.document.getSnapshot().past.length===history+1;
  let error='';try{await editor.runScript(`await document.layers.at(0).formatRange(0,1,{fontSize:100});throw new Error('reject formatted script');`);}catch(cause){error=String(cause);}const failedAtomic=JSON.stringify(editor.document.toJSON())===JSON.stringify(authored);editor.document.undo();const undo=JSON.stringify(editor.document.toJSON())===JSON.stringify(before);editor.document.redo();return{scriptWidth,finalWidth,oneUndo,failedAtomic,undo,error,authored};
 });await writeFile(info.outputPath('isolated-characters.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({oneUndo:true,failedAtomic:true,undo:true});expect(result.error).toContain('reject formatted script');expect(result.scriptWidth).toBe(result.finalWidth);expect(result.authored.children[0]).toMatchObject({characterRanges:[{start:3,end:5,format:{fontSize:60,color:'#cc4422'}}]});
});

test('changed or cancelled native preparation leaves source text, history and ranges untouched',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:400,height:200});const layer=editor.document.layers.add(new TextLayer({text:'A '.repeat(800),fontSize:20,wrapWidth:100})),before=layer.toJSON();
  let stale='';const pending=layer.formatRange(0,10,{fontSize:60});layer.name='Concurrent rename';try{await pending;}catch(cause){stale=String(cause);}const staleAtomic=JSON.stringify(layer.toJSON())===JSON.stringify({...before,name:'Concurrent rename'});
  const stable=editor.document.toJSON(),abort=new AbortController();const cancelled=layer.formatRange(0,10,{fontSize:60},{signal:abort.signal});abort.abort();let cancellation='';try{await cancelled;}catch(cause){cancellation=String(cause);}return{stale,staleAtomic,cancellation,cancelAtomic:JSON.stringify(editor.document.toJSON())===JSON.stringify(stable),probes:document.querySelectorAll('[data-canoli-styled-paragraph-probe],[data-canoli-styled-text-probe]').length};
 });await writeFile(info.outputPath('cancelled-characters.json'),JSON.stringify(result,null,2));expect(result).toMatchObject({staleAtomic:true,cancelAtomic:true,probes:0});expect(result.stale).toContain('changed');expect(result.cancellation).toContain('AbortError');
});

for(const mode of ['success','read-only','revoke-write']as const)test(`character plugin ${mode} retains inert installation and current grants`,async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async mode=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:400,height:240});editor.document.layers.add(new TextLayer({text:'A '.repeat(300),fontSize:20,wrapWidth:100}));const before=JSON.stringify(editor.document.toJSON()),id='character-'+mode;
  editor.plugins.install({format:'luma-plugin',apiVersion:1,id,name:'Character test',version:'1.0.0',description:'Local character formatting test',permissions:mode==='read-only'?['document:read']:['document:read','document:write'],commands:[{id:'format',title:'Format selected characters',source:"await document.layers.at(0).formatRange(0,20,{fontSize:40,color:'#a43e29'});print('Plugin characters ready');"}]});
  const inert=JSON.stringify(editor.document.toJSON())===before;let triggered=false,error='',logs:string[]=[];
  const observer=new MutationObserver(()=>{if(mode==='revoke-write'&&!triggered&&document.querySelector('[data-canoli-styled-paragraph-probe]')){triggered=true;editor.plugins.revokePermission(id,'document:write');observer.disconnect();}});if(mode==='revoke-write')observer.observe(document.body,{childList:true});
  try{try{logs=await editor.runPlugin(id,'format');}catch(cause){error=String(cause);}const changed=JSON.stringify(editor.document.toJSON())!==before;if(mode==='success')editor.document.undo();return{inert,triggered,error,logs,changed,restored:JSON.stringify(editor.document.toJSON())===before};}finally{observer.disconnect();if(editor.plugins.get(id))editor.plugins.remove(id);}
 },mode);await writeFile(info.outputPath('character-plugin-'+mode+'.json'),JSON.stringify(result,null,2));expect(result.inert).toBe(true);expect(result.restored).toBe(true);if(mode==='success'){expect(result.error).toBe('');expect(result.changed).toBe(true);expect(result.logs.join(' ')).toContain('Plugin characters ready');}else{expect(result.error).toContain('Permission');expect(result.changed).toBe(false);}if(mode==='revoke-write')expect(result.triggered).toBe(true);
});

test('export pins a font used only by a character range before live edits collect its declarations and history',async({page},info)=>{
 const source=await readFile('tests/fixtures/fonts/Regular.ttf');await page.goto('/');const result=await page.evaluate(async source=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:320,height:180});const font=await editor.document.fonts.embed(new Blob([new Uint8Array(source)])),layer=editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:'serif',fontSize:40,color:'#2468ac',x:16,y:12}));await layer.formatRange(0,4,{fontFamily:font.family,fontSize:80});
  const reference=await editor.exportPng();let changed=false,retained=false;const exported=await editor.export({format:'png'},{onProgress:()=>{if(changed)return;changed=true;layer.update({characterRanges:[]});font.remove();for(let i=0;i<65;i++)editor.document.name='After range source '+i;retained=editor.assetStore.fonts.has(font.id);}});
  const equal=await reference.arrayBuffer(),actual=await exported.blob.arrayBuffer();return{changed,retained,collected:!editor.assetStore.fonts.has(font.id),equal:equal.byteLength===actual.byteLength&&new Uint8Array(equal).every((v,i)=>v===new Uint8Array(actual)[i]),png:await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(exported.blob);})};
 },[...source]);await writeFile(info.outputPath('range-font-retained.png'),Buffer.from(result.png.split(',')[1],'base64'));await writeFile(info.outputPath('range-font-retained.json'),JSON.stringify({...result,png:undefined},null,2));expect(result).toMatchObject({changed:true,retained:true,collected:true,equal:true});
});

for(const wrapped of [false,true])test(`native ${wrapped?'paragraph':'point'} corner resizing retains character proportions and the opposite corner`,async({page},info)=>{
 await page.goto('/');const before=await page.evaluate(async wrapped=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:400,height:300});const layer=editor.document.layers.add(new TextLayer({name:'Resize characters',text:'AA AA',fontFamily:'monospace',fontSize:20,color:'#123456',x:100,y:100,...(wrapped?{wrapWidth:120}:{})}));await layer.formatRange(3,5,{fontSize:40});editor.document.selectedLayer=layer;return{data:layer.toJSON(),width:layer.width,height:layer.height,history:editor.document.getSnapshot().past.length};
 },wrapped);await page.keyboard.press('Control+1');const handle=page.locator('.handle-nw'),box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+(wrapped?30:-before.width),box.y+box.height/2+(wrapped?0:-before.height));await page.mouse.up();
 const after=await page.evaluate(()=>{const doc=window.luma.editor.document,layer=doc.layers.at(0)as import('../src/dom').TextLayer;return{data:layer.toJSON(),width:layer.width,height:layer.height,history:doc.getSnapshot().past.length};});if(before.data.kind!=='text'||after.data.kind!=='text')throw new Error('Missing text');expect(after.data.fontSize).toBe(wrapped?20:40);expect(after.data.characterRanges?.[0].format.fontSize).toBe(wrapped?40:80);expect(Math.abs(after.data.x+after.width-before.data.x-before.width)).toBeLessThanOrEqual(1);expect(Math.abs(after.data.y+after.height-before.data.y-before.height)).toBeLessThanOrEqual(1);expect(after.history).toBe(before.history+1);
 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.toJSON().children[0])).toEqual(before.data);await writeFile(info.outputPath('characters-resize.json'),JSON.stringify({wrapped,before,after},null,2));
});
