import {test,expect} from '@playwright/test';
import {fontManagementWorkflow,openFontManager} from './helpers/font-management';

test('document font management matches independent native construction and preserves undo, styles, masters, scripts and projects',async({page},info)=>{await fontManagementWorkflow(page,info);});

test('font manager rejects stale revisions and locked followers, and cancel leaves the document intact',async({page})=>{
 await page.goto('/');const before=await page.evaluate(()=>{const {editor,TextLayer,ParagraphStyle,LayerGroup}=window.luma;editor.newDocument({width:400,height:300});const style=editor.document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontFamily:'serif'}}));const text=editor.document.layers.add(new TextLayer({text:'Locked'}));text.paragraphStyle=style;const group=editor.document.layers.add(new LayerGroup({name:'Locked group'}));text.moveTo(group);group.locked=true;return JSON.stringify(editor.document.toJSON());});
 let dialog=await openFontManager(page);await dialog.getByRole('button',{name:'serif',exact:true}).click();await dialog.getByRole('button',{name:'Replace font',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Unlock affected text');expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before);
 await page.evaluate(()=>{window.luma.editor.document.name='External change';});await expect(dialog.getByRole('alert').filter({hasText:'The document changed'})).toBeVisible();await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Refresh font list',exact:true}).click();await dialog.getByRole('button',{name:'serif',exact:true}).click();await dialog.getByLabel('Replacement font family',{exact:true}).fill('Unavailable Canoli Font 9273');await expect(dialog.getByText('Replacement font is unavailable; the browser would use a fallback.',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeDisabled();await dialog.getByLabel('Allow browser fallback for this replacement',{exact:true}).check();await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeEnabled();
 const state=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot()));await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot()))).toBe(state);
});

test('font list pagination, search, explicit installed-font access and modal typing stay independent of artwork',async({page},info)=>{
 await page.addInitScript(()=>{let count=0;Object.defineProperty(window,'queryLocalFonts',{configurable:true,value:async()=>{if(++count===1)throw new DOMException('Denied','NotAllowedError');return[{family:'Canoli Fixture'},{family:'Canoli Fixture'}];}});});
 await page.goto('/');await page.evaluate(()=>{const {editor,ParagraphStyle}=window.luma;for(let i=0;i<65;i++)editor.document.paragraphStyles.add(new ParagraphStyle({name:`Style ${i}`,format:{fontFamily:`Font ${String(i).padStart(2,'0')}`}}));});
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot())),dialog=await openFontManager(page);
 await page.keyboard.press('b');await expect(page.getByRole('button',{name:'Move tool (V)',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(dialog.getByText('65 requests · Page 1 of 3',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Next fonts',exact:true}).click();await expect(dialog.getByText('65 requests · Page 2 of 3',{exact:true})).toBeVisible();
 await dialog.getByLabel('Search document fonts',{exact:true}).fill('Font 64');await dialog.getByRole('button',{name:'Font 64',exact:true}).click();await dialog.getByLabel('Replacement font family',{exact:true}).fill('brush v h');
 await dialog.getByRole('button',{name:'List installed fonts',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Installed fonts could not be listed');await dialog.getByRole('button',{name:'List installed fonts',exact:true}).click();await expect(dialog.getByLabel('Replacement font preset',{exact:true}).locator('option[value="Canoli Fixture"]')).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await dialog.evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:info.outputPath('font-manager-mobile.png')});
 await dialog.getByRole('button',{name:'Done',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot()))).toBe(before);
});

test('switching or closing the captured owner cannot retarget a font replacement',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Original owner',fontFamily:'serif'}));(window as any).fontOwner=editor.document;});
 const dialog=await openFontManager(page);await dialog.getByRole('button',{name:'serif',exact:true}).click();
 const before=await page.evaluate(async()=>{const editor=window.luma.editor,owner=(window as any).fontOwner;editor.newDocument({name:'Other document'});await editor.closeDocument(owner,{discardChanges:true});return JSON.stringify(editor.document.getSnapshot());});
 await dialog.getByRole('button',{name:'Replace font',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('document changed or closed');
 expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot()))).toBe(before);await dialog.getByRole('button',{name:'Done',exact:true}).click();
});

test('late font availability cannot replace a newer request or edit after cancellation',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{
  const {editor,TextLayer}=window.luma;editor.document.layers.add(new TextLayer({text:'Keep source',fontFamily:'serif'}));
  const original=FontFace.prototype.load;(window as any).fontWaiters=[];
  FontFace.prototype.load=function(){if(!this.family.includes('luma-local-availability-probe'))return original.call(this);return new Promise<FontFace>((resolve,reject)=>{(window as any).fontWaiters.push(()=>original.call(this).then(resolve,reject));});};
 });
 let dialog=await openFontManager(page);await dialog.getByRole('button',{name:'serif',exact:true}).click();
 await dialog.getByLabel('Replacement font family',{exact:true}).fill('Delayed Canoli One');await expect.poll(()=>page.evaluate(()=>(window as any).fontWaiters.length)).toBe(1);
 await dialog.getByLabel('Replacement font family',{exact:true}).fill('monospace');await page.evaluate(async()=>{await(window as any).fontWaiters.shift()().catch(()=>{});});
 await expect(dialog.getByText('Replacement font is available in this browser.',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Replace font',exact:true})).toBeEnabled();
 const before=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot()));
 await dialog.getByLabel('Replacement font family',{exact:true}).fill('Delayed Canoli Two');await expect.poll(()=>page.evaluate(()=>(window as any).fontWaiters.length)).toBe(1);
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.evaluate(async()=>{await(window as any).fontWaiters.shift()().catch(()=>{});});
 expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.getSnapshot()))).toBe(before);
});

test('the executable guide and internal plugin grants share one font command and undo boundary',async({page})=>{
 const {readFile}=await import('node:fs/promises'),guide=await readFile('docs/FONT_MANAGEMENT.md','utf8'),example=guide.match(/<!-- example: document-font-management -->\s*```js\n([\s\S]*?)\n```/)?.[1];expect(example).toBeTruthy();
 await page.goto('/');const {historyScript}=await import('./helpers/history-inspector');await historyScript(page,example!,'Font guide verified');
 const result=await page.evaluate(async()=>{
  const {editor}=window.luma,document=editor.document;document.fonts.replace('sans-serif','serif');
  const plugin={format:'luma-plugin',apiVersion:1,id:'canoli.font-study',name:'Font study',version:'1.0.0',description:'Inspect and replace document font requests',permissions:['document:read','document:write'],commands:[{id:'replace',title:'Replace font',source:"print(document.fonts.items.length);document.fonts.replace('serif','monospace');"}]};
  const before=JSON.stringify(document.toJSON()),history=document.getSnapshot().past.length;editor.plugins.install(plugin);const inert=JSON.stringify(document.toJSON())===before;
  editor.plugins.setGrantedPermissions(plugin.id,['document:read']);let denied='';try{await editor.runPlugin(plugin.id,'replace');}catch(error){denied=String(error);}
  const rejected=JSON.stringify(document.toJSON())===before;editor.plugins.setGrantedPermissions(plugin.id,['document:read','document:write']);await editor.runPlugin(plugin.id,'replace');
  const accepted=!document.fonts.items.some(item=>item.family==='serif'),oneUndo=document.getSnapshot().past.length===history+1;document.undo();return{inert,denied:!!denied,rejected,accepted,oneUndo,undo:JSON.stringify(document.toJSON())===before};
 });expect(result).toEqual({inert:true,denied:true,rejected:true,accepted:true,oneUndo:true,undo:true});
});

test('portable font recipes and per-item batch parameters produce exact native output without changing the active document',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,TextLayer,Document}=window.luma;editor.newDocument({width:400,height:300});editor.recipes.startRecording();editor.document.layers.add(new TextLayer({name:'Batch caption',text:'Native font recipe é',fontFamily:'serif',fontSize:22,color:'#315b2a',x:20,y:25}));editor.document.fonts.replace('serif','monospace');
  const recipe=await editor.recipes.stopRecording({name:'Font campaign'});const file=await editor.recipes.exportRecipePackage(recipe);editor.newDocument({width:400,height:300});const initial=editor.document.toJSON(),history=editor.document.getSnapshot().past.length,packaged=await editor.recipes.executeRecipePackage(file);const packageValue=editor.document.layers.at(0)as InstanceType<typeof TextLayer>,packageFont=packageValue.fontFamily,oneUndo=editor.document.getSnapshot().past.length===history+1;editor.document.undo();const packageUndo=JSON.stringify(editor.document.toJSON())===JSON.stringify(initial);
  recipe.parameters=[{name:'family',label:'Family',type:'string',default:'monospace'}];for(const step of recipe.steps)if(step.action.type==='document.font.replace'){step.literalValues=false;step.action.to='${family}';}await editor.recipes.storage.save(recipe);
  const captured=editor.recipes.storage.get(recipe.id)!,source=new OffscreenCanvas(400,300);source.getContext('2d');const blob=await source.convertToBlob({type:'image/png'}),families=['monospace','sans-serif'];
  const run=await editor.batch.createBatch({name:'Font campaign',recipeId:recipe.id,recipeParams:{family:'monospace'},budgetId:'default-budget',variants:[{id:'native',name:'Native',targetWidth:400,targetHeight:300,format:'png',fit:'fill'}]},families.map((family,index)=>({id:`font-source-${index}`,name:`Original ${index}.png`,width:400,height:300,mimeType:'image/png',byteLength:blob.size,blob,parameters:{family}})));
  const changed=structuredClone(recipe);for(const step of changed.steps)if(step.action.type==='document.font.replace')step.action.to='serif';await editor.recipes.storage.save(changed);
  const before=JSON.stringify(editor.document.toJSON());await editor.batch.start(run.config.id);const finished=await editor.batch.waitForRun(run.config.id),rows=[];
  for(const[index,item]of finished.items.entries()){
    const output=await editor.batch.storage.getDeliverableBlob(item.deliverables[0].id);if(!output)throw new Error('Missing batch PNG');const image=await createImageBitmap(output),canvas=new OffscreenCanvas(400,300),context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();const actual=context.getImageData(0,0,400,300).data;
    const reference=new Document({width:400,height:300});reference.layers.add(new TextLayer({name:'Reference',text:'Native font recipe é',fontFamily:families[index],fontSize:22,color:'#315b2a',x:20,y:25}));const rendered=await editor.renderer.render(reference.toJSON(),editor.assetStore,{readback:true,cache:false}),expected=rendered.getContext('2d')!.getImageData(0,0,400,300).data;rendered.width=rendered.height=0;
    rows.push({status:item.status,family:(item.checkpoint!.children.find(layer=>layer.kind==='text')as {fontFamily:string}).fontFamily,exact:actual.every((value,i)=>value===expected[i]),visible:actual.some((value,i)=>i%4===3&&value>0)});
  }
  return{packaged:packaged.success,packageFont,oneUndo,packageUndo,status:finished.status,rows,activeUnchanged:JSON.stringify(editor.document.toJSON())===before,snapshotUsed:JSON.stringify(finished.config.recipeSnapshot)===JSON.stringify(captured)};
 });expect(result).toEqual({packaged:true,packageFont:'monospace',oneUndo:true,packageUndo:true,status:'completed',rows:['monospace','sans-serif'].map(family=>({status:'succeeded',family,exact:true,visible:true})),activeUnchanged:true,snapshotUsed:true});await info.attach('font-recipe-batch',{body:JSON.stringify(result),contentType:'application/json'});
});

test('locked instances inside embedded masters preserve native pixels and reject global font replacement atomically',async({page})=>{
 await page.goto('/');const results=await page.evaluate(async()=>{
  const {editor,Document,TextLayer,LayerGroup}=window.luma,rows=[];
  for(const mode of ['instance','ancestor']){
   const root=editor.newDocument({width:200,height:100}),leaf=new Document({width:100,height:50});leaf.layers.add(new TextLayer({text:'Locked leaf',fontFamily:'serif',fontSize:18}));const leafId=root.defineComponent(leaf);
   const parent=Document.fromJSON({...new Document({name:'Parent',width:200,height:100}).toJSON(),components:root.toJSON().components}),inner=parent.placeSmartObject(leafId),group=parent.layers.add(new LayerGroup({name:'Inner group'}));inner.moveTo(group);if(mode==='instance')inner.locked=true;else group.locked=true;
   const parentId=root.defineComponent(parent);root.placeSmartObject(parentId);const before=JSON.stringify(root.toJSON()),revision=root.getSnapshot().revision,png=new Uint8Array(await(await editor.exportPng()).arrayBuffer());let error='';try{root.fonts.replace('serif','monospace');}catch(cause){error=String(cause);}
   const after=new Uint8Array(await(await editor.exportPng()).arrayBuffer()),unchanged=JSON.stringify(root.toJSON())===before&&root.getSnapshot().revision===revision;
   const unlocked=root.getComponent(parentId),container=unlocked.layers.at(0)as InstanceType<typeof LayerGroup>;container.locked=false;container.layers.at(0)!.locked=false;root.defineComponent(unlocked,{id:parentId});const stable=JSON.stringify(root.toJSON());root.fonts.replace('serif','monospace');const family=(root.getComponent(leafId).layers.at(0)as InstanceType<typeof TextLayer>).fontFamily;root.undo();rows.push({mode,denied:error.includes('locked instance'),unchanged,pixelsEqual:png.length===after.length&&png.every((value,i)=>value===after[i]),family,undo:JSON.stringify(root.toJSON())===stable});
  }return rows;
 });expect(results).toEqual(['instance','ancestor'].map(mode=>({mode,denied:true,unchanged:true,pixelsEqual:true,family:'monospace',undo:true})));
});
