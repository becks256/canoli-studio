import {test,expect} from '@playwright/test';

for(const format of ['png','jpeg','webp'] as const)test(`${format} export cancels between strips and a subsequent export succeeds`,async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async(format)=>{
    const {editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:800,height:2400});
    const layer=editor.document.layers.add(new PaintLayer());
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:800,height:2400},color:'#ff0000'}));
    const abort=new AbortController(),fractions:number[]=[];
    let error='';
    try{await editor.export({format},{signal:abort.signal,onProgress:p=>{if(p.fraction!==null){fractions.push(p.fraction);if(p.fraction>0)abort.abort();}}});}
    catch(e){error=(e as Error).name;}
    const blob=await editor.exportPng();const bitmap=await createImageBitmap(blob);
    const size=[bitmap.width,bitmap.height];bitmap.close();
    const cancelled=[];
    for(const format of ['png','jpeg','webp','svg','psd'] as const){
      try{await editor.export({format},{signal:abort.signal});cancelled.push(false);}
      catch(e){cancelled.push((e as Error).name==='AbortError');}
    }
    return {error,fractions,size,cancelled};
  },format);
  expect(result.error).toBe('AbortError');expect(result.fractions.at(-1)).toBeLessThan(1);
  expect(result.size).toEqual([800,2400]);expect(result.cancelled).toEqual(Array(5).fill(true));
});

test('export dialog exposes progress and cancellation without downloading partial output',async({page})=>{
  const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(()=>{
    const e=window.luma.editor;
    e.document.layers.add(new window.luma.PaintLayer());
    e.export=async(_options,control)=>{
      control?.onProgress?.({phase:'rendering',fraction:0.25});
      await new Promise<void>((_resolve,reject)=>control!.signal!.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
      throw new Error('Unexpected export completion');
    };
  });
  await page.getByRole('button',{name:'Export…',exact:true}).click();
  const dialog=page.locator('.export-dialog');
  await dialog.getByRole('button',{name:'Export .png',exact:true}).click();
  await expect(dialog.getByRole('progressbar',{name:'Export progress'})).toHaveAttribute('value','0.25');
  const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});await expect(cancel).toBeEnabled();await cancel.click();
  await expect(dialog.getByRole('button',{name:'Export .png',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);expect(downloads).toEqual([]);
});
