import {expect,test} from '@playwright/test';
import {textPathPenWorkflow} from './helpers/text-path-pen';
test('ordinary Pen edits the text baseline through native preview, cancellation, Undo, keys, exact SVG and project reopening',async({page},info)=>{test.setTimeout(180000);await textPathPenWorkflow(page,info);});

for(const closed of [false,true])test(`reflected text baseline handles retain asymmetric clicks, Alt independence, mirrored edits and exact Undo: closed=${closed}`,async({page},info)=>{
 await page.goto('/');await page.evaluate(closed=>{const{editor,TextLayer,TextPath,AffineTransform}=window.luma;const doc=editor.newDocument({width:480,height:320}),layer=doc.layers.add(new TextLayer({text:'AAAAA',fontFamily:'serif',fontSize:32,textPath:new TextPath({closed,reverse:true,points:[{x:100,y:180,in:{x:80,y:200},out:{x:140,y:100}},{x:380,y:180,in:{x:300,y:100},out:{x:400,y:200}}]})}));layer.transform=new AffineTransform(-1,.1,.2,1,450,-15);doc.selectedLayer=layer;},closed);
 await page.getByRole('button',{name:'Vector pen (P)',exact:true}).click();await page.keyboard.press('Control+1');const controls=page.getByTestId('pen-controls'),handle=controls.locator('circle').nth(1);await expect(handle).toBeVisible();expect((await controls.locator('path').first().getAttribute('d'))!.trim().endsWith('Z')).toBe(closed);
 const original=await page.evaluate(()=>window.luma.editor.document.toJSON()),past=await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length);
 {const b=(await handle.boundingBox())!;await page.mouse.click(b.x+b.width/2,b.y+b.height/2);}expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(original);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(past);
 for(const alt of [false,true]){
  const box=(await handle.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;if(alt)await page.keyboard.down('Alt');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y+10,{steps:6});await page.mouse.up();if(alt)await page.keyboard.up('Alt');
  const points=await page.evaluate(()=>{const layer=window.luma.editor.document.selectedLayer!.toJSON();if(layer.kind!=='text')throw new Error('Missing text');return layer.textPath!.points;});const out={x:140-18/1.02,y:100+12/1.02};expect(points[0].out.x).toBeCloseTo(out.x,4);expect(points[0].out.y).toBeCloseTo(out.y,4);expect(points[0].in.x).toBeCloseTo(alt?80:200-out.x,4);expect(points[0].in.y).toBeCloseTo(alt?200:360-out.y,4);expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(past+1);await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(original);
 }
 await page.screenshot({path:info.outputPath('reflected-baseline.png')});
});
