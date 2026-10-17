import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('paragraph inspector previews, cancels, commits and resets without intercepting typing',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{
  const{editor,TextLayer,LayerGroup}=window.luma;editor.newDocument({width:800,height:600});const group=editor.document.layers.add(new LayerGroup());editor.document.selectedLayer=group.layers.add(new TextLayer({name:'Editable paragraph',text:'One two three four five six seven eight\nLast paragraph',fontSize:20,fontFamily:'monospace',wrapWidth:180,paragraphSpacing:8,firstLineIndent:12,x:30,y:30,color:'#2050a0'}));
 });
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+1');
 await page.waitForFunction(()=>!document.querySelector('footer .status-dot.working'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const model=()=>page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON())),pixels=()=>page.locator('.canvas-wrap canvas').evaluate(node=>(node as HTMLCanvasElement).toDataURL());
 const original=await model(),image=await pixels(),past=await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length),width=page.getByRole('spinbutton',{name:'Paragraph width',exact:true});
 await expect(page.getByRole('combobox',{name:'Text layout',exact:true})).toHaveValue('paragraph');
 await width.fill('120');await expect.poll(pixels).not.toBe(image);expect(await model()).toBe(original);
 await width.press('Escape');await expect(width).toHaveValue('180');await expect.poll(pixels).toBe(image);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(past);
 await width.fill('140');await width.press('Enter');await expect.poll(()=>page.evaluate(()=>{const layer=window.luma.editor.document.selectedLayer?.toJSON();return layer?.kind==='text'?layer.width:null;})).toBe(140);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(past+1);
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');expect(await model()).toBe(original);
 await page.getByRole('button',{name:'Reset paragraph',exact:true}).click();await expect(width).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Text layout',exact:true})).toHaveValue('point');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(past+1);
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');expect(await model()).toBe(original);
 const content=page.getByRole('textbox',{name:'Text content',exact:true});await content.fill('V P stay in the paragraph');await expect(page.getByRole('button',{name:'Move tool (V)',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+z');expect(await model()).toBe(original);
 await page.evaluate(()=>{window.luma.editor.document.layers.at(0)!.locked=true;});await expect(width).toBeDisabled();await expect(page.getByRole('button',{name:'Reset paragraph',exact:true})).toBeDisabled();
});

for(const mode of ['plain','affine','empty'] as const)test(`paragraph corner resize preserves font, opposite corner and one undo: ${mode}`,async({page},info)=>{
 await page.goto('/');await page.evaluate(mode=>{
  const{editor,TextLayer,LayerGroup,AffineTransform}=window.luma;editor.newDocument({width:800,height:600});const group=editor.document.layers.add(new LayerGroup());if(mode==='affine')group.transform=new AffineTransform(1,.12,.18,1,10,10);
  editor.document.selectedLayer=group.layers.add(new TextLayer({text:mode==='empty'?'':'One two three four five six seven eight',fontFamily:'monospace',fontSize:20,wrapWidth:220,paragraphSpacing:8,firstLineIndent:12,x:40,y:40,color:'#2050a0'}));
 },mode);
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();await page.keyboard.press('Control+1');
 const before=await page.evaluate(()=>({json:JSON.stringify(window.luma.editor.document.toJSON()),data:window.luma.editor.document.selectedLayer!.toJSON(),past:window.luma.editor.document.getSnapshot().past.length}));
 if(before.data.kind!=='text')throw new Error('Expected text');
 const box=(await page.locator('.handle-nw').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+box.height/2);
 expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before.json);
 await page.mouse.up();const after=await page.evaluate(()=>({data:window.luma.editor.document.selectedLayer!.toJSON(),past:window.luma.editor.document.getSnapshot().past.length}));if(after.data.kind!=='text')throw new Error('Expected text');
 expect(after.data.fontSize).toBe(before.data.fontSize);expect(after.data.width).toBeLessThan(before.data.width);expect(after.data.width).toBe(after.data.wrapWidth);expect(after.data.text).toBe(before.data.text);expect(after.data.x+after.data.width).toBeCloseTo(before.data.x+before.data.width,5);expect(after.data.y+after.data.height).toBeCloseTo(before.data.y+before.data.height,5);expect(after.past).toBe(before.past+1);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before.json);
 await info.attach('paragraph-resize',{body:JSON.stringify({mode,before:before.data,after:after.data,exactUndo:true}),contentType:'application/json'});
});

test('missing native grapheme support disables new wrapping and permits point recovery',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{
  const{editor,TextLayer}=window.luma;editor.newDocument({width:480,height:240});editor.document.selectedLayer=editor.document.layers.add(new TextLayer({text:'Recover this paragraph',wrapWidth:160,fontFamily:'monospace',fontSize:20}));
  Object.defineProperty(Intl,'Segmenter',{value:undefined,configurable:true});editor.document.name='Unsupported graphemes';
 });
 await expect(page.getByText('This browser cannot wrap paragraph text.',{exact:false})).toBeVisible();await expect(page.getByRole('spinbutton',{name:'Paragraph width',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Reset paragraph',exact:true}).click();await expect(page.getByRole('combobox',{name:'Text layout',exact:true})).toHaveValue('point');await expect(page.getByRole('combobox',{name:'Text layout',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>window.luma.editor.document.selectedLayer!.toJSON())).toMatchObject({text:'Recover this paragraph',wrapWidth:null,paragraphSpacing:0,firstLineIndent:0});
});

test('documented paragraph constructors, setters and reset run inside the isolated runtime with atomic failure',async({page},info)=>{
 const guide=await readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: paragraph-text -->\s*```js\n([\s\S]*?)```/)?.[1];if(!source)throw new Error('Missing documented paragraph example.');
 await page.goto('/');const original=await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()));
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();const input=page.getByLabel('Script code',{exact:true}),output=page.getByLabel('Script output');await input.fill(source);await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(output).toContainText('Paragraph ready 280 18 20');
 const result=await page.evaluate(()=>window.luma.editor.document.toJSON());expect(result.children).toHaveLength(1);expect(result.children[0]).toMatchObject({kind:'text',wrapWidth:280,width:280,paragraphSpacing:18,firstLineIndent:20});
 await input.fill("document.name='Must roll back';document.selectedLayer.wrapWidth=0;");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(output).toContainText('width');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(result);
 await input.fill("const text=document.selectedLayer;text.wrapWidth=160;text.paragraphSpacing=9;text.firstLineIndent=-8;text.resetParagraph();print('Reset ready',text.wrapWidth===undefined,text.paragraphSpacing,text.firstLineIndent);");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(output).toContainText('Reset ready true 0 0');
 await page.getByRole('button',{name:'Close scripts',exact:true}).click();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(result);await page.keyboard.press('Control+z');expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(original);
 await info.attach('paragraph-isolated',{body:JSON.stringify({documentedExample:true,resetAtomic:true,invalidRolledBack:true,exactUndo:true}),contentType:'application/json'});
});
