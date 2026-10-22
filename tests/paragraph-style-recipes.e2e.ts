import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('recorded linked group packages retain exact native appearance, style scope, one undo and conflict rollback',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,ParagraphStyle,TextLayer,LayerGroup}=window.luma;const document=editor.newDocument({width:600,height:300});
  const style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:24,color:'#315b2a',lineHeight:1.4}})),group=document.layers.add(new LayerGroup({name:'Linked group'}));
  const first=group.layers.add(new TextLayer({name:'First',text:'Portable linked typography.',x:24,y:24,wrapWidth:240})),second=group.layers.add(new TextLayer({name:'Second',text:'Local red survives a base change.',x:300,y:24,wrapWidth:240}));
  first.paragraphStyle=style;second.paragraphStyle=style;second.color='#a43e29';const template=group.toJSON();group.remove();
  editor.recipes.startRecording();document._dispatch({type:'layer.add',layer:template});style.update({fontSize:28,paragraphSpacing:10});const recipe=await editor.recipes.stopRecording({name:'Portable linked typography'});
  const pixels=async()=>{const canvas=await editor.renderer.render(editor.document.toJSON(),editor.assetStore,{readback:true,cache:false});const bytes=canvas.getContext('2d')!.getImageData(0,0,600,300).data;canvas.width=canvas.height=0;return bytes;};
  const original=await pixels(),file=await editor.recipes.exportRecipePackage(recipe),target=editor.newDocument({width:600,height:300}),before=target.toJSON(),history=target.getSnapshot().past.length;
  const executed=await editor.recipes.executeRecipePackage(file),copied=target.toJSON(),actual=await pixels(),oneUndo=target.getSnapshot().past.length===history+1;
  const copiedGroup=target.layers.at(0)as InstanceType<typeof LayerGroup>,copiedSecond=copiedGroup.layers.at(1)as InstanceType<typeof TextLayer>;
  const values={success:executed.success,nativeExact:original.every((value,index)=>value===actual[index]),visible:actual.some((v,i)=>i%4===3&&v>0),oneUndo,
   name:copiedSecond.paragraphStyle!.name,overrides:copiedSecond.paragraphOverrides,size:copiedSecond.fontSize,freshStyleId:copiedSecond.paragraphStyle!.id!==style.id};
  target.undo();const undo=JSON.stringify(target.toJSON())===JSON.stringify(before);target.redo();const redo=JSON.stringify(target.toJSON())===JSON.stringify(copied);
  const saved=await editor.saveProject();await editor.openProject(new File([saved],'linked-package.luma'));const reopened=await pixels();
  const stable=editor.document.toJSON(),revision=editor.document.getSnapshot().revision;let conflict='';try{await editor.recipes.executeRecipePackage(file);}catch(error){conflict=String(error);}
  return{...values,undo,redo,reopenedExact:actual.every((value,index)=>value===reopened[index]),conflict:conflict.includes('different formatting'),conflictAtomic:JSON.stringify(editor.document.toJSON())===JSON.stringify(stable)&&revision===editor.document.getSnapshot().revision};
 });expect(result).toEqual({success:true,nativeExact:true,visible:true,oneUndo:true,name:'Body',overrides:{color:'#a43e29'},size:28,freshStyleId:true,undo:true,redo:true,reopenedExact:true,conflict:true,conflictAtomic:true});
 await info.attach('paragraph-recipe-package',{body:JSON.stringify(result),contentType:'application/json'});
});

test('documented paragraph-style recipe imports through the real dialog, previews safely and runs with a numeric parameter',async({page},info)=>{
 const guide=await readFile('docs/RECIPE_PARAGRAPH_STYLES.md','utf8'),example=guide.match(/<!-- example: paragraph-style-recipe -->\s*```json\n([\s\S]*?)\n```/)?.[1];if(!example)throw new Error('Missing recipe guide');
 const published=await page.request.get('/developer/recipe-paragraph-styles.html');expect(published.ok()).toBe(true);expect(await published.text()).toContain('Paragraph styles in recipes');
 await page.goto('/');await page.evaluate(()=>{const {editor,TextLayer}=window.luma;editor.newDocument({width:600,height:300});editor.document.layers.add(new TextLayer({name:'Text',text:'Imported portable body typography',x:24,y:24}));});
 const before=await page.evaluate(()=>window.luma.editor.document.toJSON());await page.getByRole('button',{name:'Recipes',exact:true}).click();const dialog=page.locator('.recipe-dialog');
 await dialog.locator('input[type=file][accept=".json"]').setInputFiles({name:'body.json',mimeType:'application/json',buffer:Buffer.from(example)});
 await dialog.locator('.recipe-card').filter({hasText:'Apply reusable body style'}).click();await expect(dialog.locator('.dryrun-status-badge')).toContainText('Valid');
 const number=dialog.getByRole('spinbutton',{name:'Body size value',exact:true});await number.fill('36');await number.press('Enter');await expect(dialog.locator('.dryrun-status-badge')).toContainText('Valid');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
 await dialog.getByRole('button',{name:'Run Recipe',exact:true}).click();await expect(dialog.locator('.dryrun-alert-box.success')).toBeVisible();await page.keyboard.press('Escape');
 const value=await page.evaluate(()=>{const text=window.luma.editor.document.layers.at(0)as InstanceType<typeof window.luma.TextLayer>;return{size:text.fontSize,name:text.paragraphStyle!.name,overrides:text.paragraphOverrides};});expect(value).toEqual({size:36,name:'Body',overrides:{}});
 await info.attach('paragraph-recipe-guide',{body:JSON.stringify(value),contentType:'application/json'});
});

test('batch snapshots replay recorded linked text on two originals with per-item sizes and exact full-frame PNGs',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {editor,ParagraphStyle,TextLayer,Document}=window.luma;const document=editor.newDocument({width:600,height:300});
  editor.recipes.startRecording();const style=document.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:24,color:'#315b2a',lineHeight:1.4}}));
  const text=document.layers.add(new TextLayer({name:'Text',text:'Batch keeps linked body typography',x:24,y:24,wrapWidth:540}));text.paragraphStyle=style;
  style.update({fontSize:28});const recipe=await editor.recipes.stopRecording({name:'Batch body style'});
  recipe.parameters=[{name:'size',label:'Size',type:'number',default:28,min:1,max:100}];for(const step of recipe.steps)if(step.action.type==='paragraphStyle.update'){step.literalValues=false;step.action.format.fontSize='${size}';}
  await editor.recipes.storage.save(recipe);const captured=editor.recipes.storage.get(recipe.id)!;const source=new OffscreenCanvas(600,300);source.getContext('2d');const blob=await source.convertToBlob({type:'image/png'});
  const run=await editor.batch.createBatch({name:'Linked typography campaign',recipeId:recipe.id,recipeParams:{size:28},budgetId:'default-budget',variants:[{id:'native',name:'Native',targetWidth:600,targetHeight:300,format:'png',fit:'fill'}]},[28,34].map((size,index)=>({id:`source-${index}`,name:`Original ${index}.png`,width:600,height:300,mimeType:'image/png',byteLength:blob.size,blob,parameters:{size}})));
  const changed=structuredClone(recipe);for(const step of changed.steps)if(step.action.type==='paragraphStyle.update')step.action.format.fontSize=99;await editor.recipes.storage.save(changed);
  const before=editor.document.toJSON();await editor.batch.start(run.config.id);const finished=await editor.batch.waitForRun(run.config.id),rows=[];
  for(const [index,item]of finished.items.entries()){
   const size=[28,34][index],checkpoint=item.checkpoint!,layer=checkpoint.children.find(layer=>layer.kind==='text')as {fontSize:number;paragraphStyle:{id:string}};
   const output=await editor.batch.storage.getDeliverableBlob(item.deliverables[0].id);if(!output)throw new Error('Missing batch PNG');
   const bitmap=await createImageBitmap(output),canvas=new OffscreenCanvas(600,300),ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();const actual=ctx.getImageData(0,0,600,300).data;
   const expected=new Document({width:600,height:300});expected.layers.add(new TextLayer({name:'Reference',text:'Batch keeps linked body typography',x:24,y:24,wrapWidth:540,fontSize:size,color:'#315b2a',lineHeight:1.4}));
   const reference=await editor.renderer.render(expected.toJSON(),editor.assetStore,{readback:true,cache:false}),bytes=reference.getContext('2d')!.getImageData(0,0,600,300).data;reference.width=reference.height=0;
   rows.push({status:item.status,size:layer.fontSize,base:checkpoint.paragraphStyles![0].format.fontSize,linked:layer.paragraphStyle.id===checkpoint.paragraphStyles![0].id,nativeExact:actual.every((v,i)=>v===bytes[i]),visible:actual.some((v,i)=>i%4===3&&v>0)});
  }
  return{status:finished.status,rows,activeUnchanged:JSON.stringify(editor.document.toJSON())===JSON.stringify(before),snapshotUsed:JSON.stringify(finished.config.recipeSnapshot)===JSON.stringify(captured),distinctStyleIds:finished.items[0].checkpoint!.paragraphStyles![0].id!==finished.items[1].checkpoint!.paragraphStyles![0].id};
 });expect(result).toEqual({status:'completed',rows:[28,34].map(size=>({status:'succeeded',size,base:size,linked:true,nativeExact:true,visible:true})),activeUnchanged:true,snapshotUsed:true,distinctStyleIds:true});
 await info.attach('paragraph-recipe-batch',{body:JSON.stringify(result),contentType:'application/json'});
});
