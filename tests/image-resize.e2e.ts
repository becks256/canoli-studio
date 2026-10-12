import {test,expect} from '@playwright/test';

test('Image size scales editable artwork, links dimensions, cancels and undoes independently of canvas size',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const {editor,PaintLayer,PaintFill}=window.luma;
    editor.newDocument({width:100,height:80});
    const layer=editor.document.layers.add(new PaintLayer({x:10,y:10}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:20,height:20},color:'#ff0000'}));
  });
  await page.getByRole('button',{name:'Image size…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Image size',exact:true});
  await dialog.getByRole('spinbutton',{name:'Width',exact:true}).fill('200');
  await dialog.getByRole('spinbutton',{name:'Width',exact:true}).press('Tab');
  await expect(dialog.getByRole('spinbutton',{name:'Height',exact:true})).toHaveValue('160');
  await dialog.getByRole('button',{name:'Apply resize',exact:true}).click();
  const pixels=await page.evaluate(async()=>{
    const {editor}=window.luma;
    const output=await editor.renderer.render(editor.document.getSnapshot().document,editor.assetStore);
    const sample=(x:number,y:number)=>[...output.getContext('2d')!.getImageData(x,y,1,1).data];
    const result={width:editor.document.width,height:editor.document.height,inside:sample(55,55),outside:sample(15,15)};
    output.width=0;return result;
  });
  expect(pixels).toEqual({width:200,height:160,inside:[255,0,0,255],outside:[0,0,0,0]});
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>window.luma.editor.document.width)).toBe(100);
  await page.keyboard.press('Control+Alt+i');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('spinbutton',{name:'Width',exact:true}).fill('300');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>window.luma.editor.document.width)).toBe(100);
  await page.evaluate(()=>window.luma.editor.runScript('document.resizeImage(document.width * 2, document.height * 2);'));
  expect(await page.evaluate(()=>[window.luma.editor.document.width,window.luma.editor.document.height])).toEqual([200,160]);
});
