import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('isolated paragraph-style guide updates native pixels, preserves overrides and round-trips one script undo/project',async({page},info)=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8'),code=guide.match(/<!-- example: paragraph-styles -->\s*```js\n([\s\S]*?)\n```/)?.[1];if(!code)throw new Error('Missing guide');
  await page.goto('/');const result=await page.evaluate(async code=>{
    const {editor,Document,TextLayer}=window.luma;editor.newDocument({width:600,height:300});const before=editor.document.toJSON(),history=editor.document.getSnapshot().past.length;
    await editor.runScript(code);const authored=editor.document.toJSON(),document=editor.document,first=document.layers.at(0)as InstanceType<typeof TextLayer>,second=document.layers.at(1)as InstanceType<typeof TextLayer>;
    const oneUndo=document.getSnapshot().past.length===history+1,expected=new Document({width:600,height:300});
    expected.layers.add(new TextLayer({name:'Expected first',text:'Linked typography wraps naturally across frames.',wrapWidth:240,x:24,y:24,fontFamily:'sans-serif',fontSize:28,color:'#315b2a',lineHeight:1.4,paragraphSpacing:10}));
    expected.layers.add(new TextLayer({name:'Expected second',text:'Local color stays independent of the shared size.',wrapWidth:240,x:300,y:24,fontFamily:'sans-serif',fontSize:28,color:'#a43e29',lineHeight:1.4,paragraphSpacing:10}));
    async function pixels(data=editor.document.toJSON(),cache=true,region?:{x:number;y:number;width:number;height:number}){
      const canvas=await editor.renderer.render(data,editor.assetStore,{readback:true,cache,region});const bytes=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;canvas.width=canvas.height=0;return bytes;
    }
    const actual=await pixels(),reference=await pixels(expected.toJSON(),false),uncached=await pixels(undefined,false);let cropDifferences=0;
    const region={x:21,y:19,width:523,height:218},crop=await pixels(undefined,false,region);
    for(let y=0;y<region.height;y++)for(let x=0;x<region.width;x++)for(let c=0;c<4;c++)if(crop[(y*region.width+x)*4+c]!==actual[((y+region.y)*600+x+region.x)*4+c])cropDifferences++;
    const style=first.paragraphStyle!,overrides=second.paragraphOverrides,firstSize=first.fontSize,secondSize=second.fontSize;
    const stable=document.toJSON();try{await editor.runScript('document.paragraphStyles.at(0).update({fontSize:42});throw new Error("Abort style edit");');}catch{}
    const failedAtomic=JSON.stringify(document.toJSON())===JSON.stringify(stable);
    document.undo();const undo=JSON.stringify(document.toJSON())===JSON.stringify(before);document.redo();
    const file=await editor.saveProject();await editor.openProject(new File([file],'paragraph-styles.luma'));const reopened=await pixels();
    const restored=editor.document.toJSON(),text=editor.document.layers.at(1)as InstanceType<typeof TextLayer>,restoredStyle=text.paragraphStyle!;
    restoredStyle.update({fontSize:32,color:'#3366aa'});const updated=await pixels();text.resetParagraphOverrides(['color']);const reset=await pixels();
    const report=editor.getExportCapabilityReport({format:'svg'});
    return{oneUndo,cropDifferences,referenceEqual:actual.every((v,i)=>v===reference[i]),cacheEqual:actual.every((v,i)=>v===uncached[i]),
      visible:actual.some((v,i)=>i%4===3&&v>0),failedAtomic,undo,reopenedEqual:actual.every((v,i)=>v===reopened[i]),modelEqual:JSON.stringify(authored)===JSON.stringify(restored),
      styleName:style.name,firstSize,secondSize,overrides,updated:updated.some((v,i)=>v!==reopened[i]),reset:reset.some((v,i)=>v!==updated[i]),
      svgWarning:report.warnings.some((w:string)=>w.includes('linked paragraph-style')),schema:restored.schemaVersion};
  },code);
  expect(result).toMatchObject({oneUndo:true,cropDifferences:0,referenceEqual:true,cacheEqual:true,visible:true,failedAtomic:true,undo:true,reopenedEqual:true,modelEqual:true,
    styleName:'Body',firstSize:28,secondSize:28,overrides:{color:'#a43e29'},updated:true,reset:true,svgWarning:true,schema:42});
  await info.attach('paragraph-style-native',{body:JSON.stringify(result),contentType:'application/json'});
});

test('Inspector creates, applies, overrides, updates, resets and manages unused paragraph styles without selection edits',async({page},info)=>{
  await page.goto('/');await page.evaluate(()=>{
    const {editor,TextLayer}=window.luma;editor.newDocument({width:600,height:280});const first=editor.document.layers.add(new TextLayer({name:'First',text:'First styled frame',fontSize:24,x:24,y:24}));
    editor.document.layers.add(new TextLayer({name:'Second',text:'Second styled frame',fontSize:18,x:24,y:120}));editor.document.selectedLayer=first;
  });
  const section=page.getByRole('region',{name:'Paragraph styles',exact:true}),state=()=>page.evaluate(()=>({json:window.luma.editor.document.toJSON(),history:window.luma.editor.document.getSnapshot().past.length}));
  await section.getByRole('textbox',{name:'New paragraph style name',exact:true}).fill('Body');const before=await state();
  await section.getByRole('button',{name:'Create style from text',exact:true}).click();const created=await state();expect(created.history).toBe(before.history+1);
  const styleId=created.json.paragraphStyles![0].id;
  await page.getByRole('button',{name:'Select Second',exact:true}).click();const untouched=await state();
  await section.getByRole('combobox',{name:'Paragraph style',exact:true}).selectOption(styleId);expect(await state()).toEqual(untouched);
  await section.getByRole('button',{name:'Apply paragraph style',exact:true}).click();
  const size=page.getByRole('spinbutton',{name:'Font size',exact:true});await expect(size).toHaveValue('24');
  await size.fill('30');await size.press('Enter');await expect(section.getByRole('status')).toContainText('1 local override');
  const local=await state();await section.getByRole('button',{name:'Update style from text',exact:true}).click();const updated=await state();
  expect(updated.history).toBe(local.history+1);expect(updated.json.children.map(layer=>layer.kind==='text'?layer.fontSize:null)).toEqual([30,30]);
  await section.getByRole('button',{name:'Reset style overrides',exact:true}).click();await expect(section.getByRole('status')).toContainText('Follows all style settings');
  await section.getByRole('textbox',{name:'Style name',exact:true}).fill('Editorial');await section.getByRole('button',{name:'Rename paragraph style',exact:true}).click();await expect(section.getByRole('status')).toContainText('Editorial');
  await section.getByRole('button',{name:'Detach paragraph style',exact:true}).click();await expect(size).toHaveValue('30');
  const detached=await state();await section.getByRole('combobox',{name:'Paragraph style',exact:true}).selectOption(styleId);expect(await state()).toEqual(detached);
  await section.getByRole('button',{name:'Delete paragraph style',exact:true}).click();expect((await state()).json.paragraphStyles).toEqual([]);await expect(size).toHaveValue('30');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');expect((await state()).json.paragraphStyles).toHaveLength(1);
  await section.getByRole('combobox',{name:'Paragraph style',exact:true}).selectOption(styleId);await section.getByRole('button',{name:'Apply paragraph style',exact:true}).click();
  await section.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('paragraph-styles-inspector.png')});
});

test('actual cross-document copy remaps conflicting root styles, preserves overrides and isolates embedded master scopes',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,TextLayer,ParagraphStyle}=window.luma,source=editor.newDocument({width:500,height:250});
    const style=source.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:24,color:'#335577'}}));
    const first=source.layers.add(new TextLayer({name:'Root text',text:'Root style',x:24,y:24}));first.paragraphStyle=style;first.fontSize=27;
    const embeddedText=source.layers.add(new TextLayer({name:'Embedded text',text:'Independent master',x:24,y:100}));embeddedText.paragraphStyle=style;
    const object=source.createSmartObject([embeddedText]),before=source.toJSON();
    const target=editor.newDocument({width:500,height:250});target._dispatch({type:'paragraphStyle.set',style:{...style.toJSON(),format:{...style.format,fontSize:60}}});
    const existing=target.layers.add(new TextLayer({name:'Existing',text:'Destination',x:260,y:24}));existing.paragraphStyle=target.paragraphStyles.getById(style.id)!;
    const targetBefore=target.toJSON(),history=target.getSnapshot().past.length;editor.activateDocument(source);source.layerSelection.select([first,object]);
    const copies=await editor.copySelectedLayersTo(target),root=copies.find(layer=>layer instanceof TextLayer)as InstanceType<typeof TextLayer>,smart=copies.find(layer=>layer.kind==='smart-object')as InstanceType<typeof window.luma.SmartObjectLayer>;
    const copied=target.toJSON(),master=target.getComponent(smart.componentId),inside=master.layers.at(0)as InstanceType<typeof TextLayer>;
    const pixels=async(data:ReturnType<typeof target.toJSON>)=>{
      const canvas=await editor.renderer.render(data,editor.assetStore,{readback:true,cache:false});const bytes=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;canvas.width=canvas.height=0;return bytes;
    };
    const originalPixels=await pixels(before),copiedPixels=await pixels({...copied,children:copied.children.filter(layer=>layer.id!==existing.id)});
    const correct={oneUndo:target.getSnapshot().past.length===history+1,rootSize:root.fontSize,rootColor:root.color,rootOverrides:root.paragraphOverrides,
      mapped:root.paragraphStyle!.id!==style.id,name:root.paragraphStyle!.name,existingSize:existing.fontSize,embeddedSize:inside.fontSize,embeddedStyle:inside.paragraphStyle!.name,
      sourceUnchanged:JSON.stringify(before)===JSON.stringify(source.toJSON()),pixelsEqual:originalPixels.every((v,i)=>v===copiedPixels[i])};
    target.undo();const undo=JSON.stringify(target.toJSON())===JSON.stringify(targetBefore);target.redo();
    const redo=JSON.stringify(target.toJSON())===JSON.stringify(copied);editor.activateDocument(target);const project=await editor.saveProject();await editor.openProject(new File([project],'copied-styles.luma'));
    return{...correct,undo,redo,reopened:JSON.stringify(editor.document.toJSON())===JSON.stringify(copied)};
  });
  expect(result).toMatchObject({oneUndo:true,rootSize:27,rootColor:'#335577',rootOverrides:{fontSize:27},mapped:true,name:'Body 2',existingSize:60,embeddedSize:24,embeddedStyle:'Body',sourceUnchanged:true,pixelsEqual:true,undo:true,redo:true,reopened:true});
  await info.attach('paragraph-style-transfer',{body:JSON.stringify(result),contentType:'application/json'});
});

test('serialized whitespace style names copy into a real destination without collisions or changed overrides',async({page},info)=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {editor,Document,TextLayer,ParagraphStyle}=window.luma,original=new Document({width:500,height:250});
    const style=original.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:24,color:'#335577'}}));
    const text=original.layers.add(new TextLayer({name:'Serialized source',text:'Preserve linked copy',x:24,y:24}));text.paragraphStyle=style;text.fontSize=27;
    const data=original.toJSON();data.paragraphStyles![0].name='\u00a0Body\u00a0';const source=Document.fromJSON(data);
    const {AssetStore}=await import(/* @vite-ignore */ String('/src/core/assets.ts'));editor.replace(source,new AssetStore());
    const target=editor.newDocument({width:500,height:250}),existingStyle=target.paragraphStyles.add(new ParagraphStyle({name:'Body',format:{fontSize:60}}));
    const existing=target.layers.add(new TextLayer({text:'Destination',x:260,y:24}));existing.paragraphStyle=existingStyle;
    const before=target.toJSON(),history=target.getSnapshot().past.length;editor.activateDocument(source);source.selectedLayer=source.layers.at(0)!;
    const [layer]=await editor.copySelectedLayersTo(target),copy=layer as InstanceType<typeof TextLayer>,copied=target.toJSON();
    const values={name:copy.paragraphStyle!.name,fontSize:copy.fontSize,overrides:copy.paragraphOverrides,existingSize:existing.fontSize,
      oneUndo:target.getSnapshot().past.length===history+1,sourceName:source.paragraphStyles.at(0)!.name};
    target.undo();const undo=JSON.stringify(target.toJSON())===JSON.stringify(before);target.redo();
    return{...values,undo,redo:JSON.stringify(target.toJSON())===JSON.stringify(copied)};
  });
  expect(result).toEqual({name:'Body 2',fontSize:27,overrides:{fontSize:27},existingSize:60,oneUndo:true,sourceName:'\u00a0Body\u00a0',undo:true,redo:true});
  await info.attach('paragraph-style-serialized-transfer',{body:JSON.stringify(result),contentType:'application/json'});
});
