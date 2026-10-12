import {test,expect} from '@playwright/test';
test('freeform lasso supports pixel copy, undo, modifiers, shortcut and cancellation',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 await page.evaluate(async()=>{
  const e=window.luma.editor;e.newDocument({width:100,height:100});
  const c=document.createElement('canvas');c.width=c.height=100;c.getContext('2d')!.fillRect(0,0,100,100);
  const blob=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!)));
  await e.importImage(new File([blob],'black.png',{type:'image/png'}));
 });
 await page.keyboard.press('Control+1');await page.keyboard.press('l');
 await expect(page.getByRole('button',{name:'Lasso tool (L)',exact:true})).toHaveAttribute('aria-pressed','true');
 const box=(await page.locator('.canvas-wrap').boundingBox())!;
 const draw=async(points:number[][])=>{
  await page.mouse.move(box.x+points[0][0],box.y+points[0][1]);await page.mouse.down();
  for(const [x,y]of points.slice(1))await page.mouse.move(box.x+x,box.y+y);
  await page.mouse.up();
 };
 const selected=async(x:number,y:number)=>page.evaluate(async({x,y})=>{
  const {containsSelection}=await import(/* @vite-ignore */ String('/src/core/drawing.ts'));
  return containsSelection(window.luma.editor.document.selection!.toJSON(),x,y);
 },{x,y});
 await draw([[10,10],[80,10],[10,80]]);
 await expect(page.getByTestId('pixel-selection-outline')).toBeVisible();
 expect(await selected(20,20)).toBe(true);expect(await selected(70,70)).toBe(false);
 const original=await page.evaluate(()=>window.luma.editor.document.selection!.toJSON());
 await page.keyboard.down('Alt');await draw([[15,15],[30,15],[30,30],[15,30]]);await page.keyboard.up('Alt');
 expect(await selected(20,20)).toBe(false);expect(await selected(40,20)).toBe(true);
 await page.keyboard.press('Control+z');expect(await selected(20,20)).toBe(true);
 await page.keyboard.down('Shift');await draw([[60,60],[80,60],[80,80],[60,80]]);await page.keyboard.up('Shift');
 expect(await selected(70,70)).toBe(true);
 await page.keyboard.down('Shift');await page.keyboard.down('Alt');await draw([[10,10],[40,10],[40,40],[10,40]]);await page.keyboard.up('Alt');await page.keyboard.up('Shift');
 expect(await selected(20,20)).toBe(true);expect(await selected(70,70)).toBe(false);
 await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
 await page.mouse.move(box.x+50,box.y+50);await page.mouse.down();await page.mouse.move(box.x+80,box.y+80);
 await expect(page.getByTestId('lasso-preview')).toBeVisible();await page.keyboard.press('Escape');await page.mouse.up();
 expect(await page.evaluate(()=>window.luma.editor.document.selection!.toJSON())).toEqual(original);
 await expect(page.getByTestId('lasso-preview')).toHaveCount(0);
 await page.keyboard.press('Control+c');
 await expect.poll(()=>page.evaluate(()=>window.luma.editor.pixels.canPaste)).toBe(true);
 await page.keyboard.press('Control+v');
 await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.layers.length)).toBe(2);
});
