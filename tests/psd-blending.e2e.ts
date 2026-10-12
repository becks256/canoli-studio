import {test,expect} from '@playwright/test';
test('PSD composites match Canvas blend modes with opaque and partial-alpha inputs',async({page})=>{
  await page.goto('/');
  const results=await page.evaluate(async()=>{
    const {createDocument,createRaster,BLEND_MODES}=await import(/* @vite-ignore */ String('/src/core/model.ts'));
    const {documentToPsd}=await import(/* @vite-ignore */ String('/src/core/interchange/psd/bridge.ts'));
    const {parsePsd}=await import(/* @vite-ignore */ String('/src/core/interchange/psd/parser.ts'));
    const results=[];
    for(const mode of BLEND_MODES)for(const alpha of [255,128]){
      const d=createDocument('Blend',1,1);
      const b=createRaster('B','back',1,1),s=createRaster('S','front',1,1);s.blendMode=mode;
      d.children.push(b,s);
      const bg=new ImageData(new Uint8ClampedArray([53,151,219,alpha]),1,1);
      const fg=new ImageData(new Uint8ClampedArray([201,87,41,alpha]),1,1);
      const bytes=await documentToPsd(d,(id:string)=>id==='back'?bg:fg);
      const actual=parsePsd(bytes).composite!.data;
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const source=document.createElement('canvas');source.width=source.height=1;
      const c=canvas.getContext('2d')!;c.putImageData(bg,0,0);source.getContext('2d')!.putImageData(fg,0,0);
      c.globalCompositeOperation=mode==='normal'?'source-over':mode;c.drawImage(source,0,0);
      const expected=c.getImageData(0,0,1,1).data;
      results.push({mode,alpha,actual:[...actual],expected:[...expected],error:Math.max(...[0,1,2].map(i=>Math.abs(actual[i]*actual[3]/255-expected[i]*expected[3]/255)))});
    }
    return results;
  });
  for(const result of results){expect(Math.abs(result.actual[3]-result.expected[3]),JSON.stringify(result)).toBeLessThanOrEqual(1);expect(result.error,JSON.stringify(result)).toBeLessThanOrEqual(3);}
});
