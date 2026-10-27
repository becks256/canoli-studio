import {test,expect} from '@playwright/test';
import {writeFile}from 'node:fs/promises';
test('PSD composites match Canvas and independent linear-blend references with opaque and partial-alpha inputs',async({page},info)=>{
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
      const requested=mode==='normal'?'source-over':mode;c.globalCompositeOperation=requested;
      let expected:number[],reference='Native Canvas';
      if(mode==='linear-light'||mode==='linear-burn'){
        // Canvas silently ignores these assignments. Independent RGB8 scalar
        // references use clamp(D + factor*S - 1), then source-over alpha;
        // factor=2 for Linear Light, 1 for Linear Burn. No editor code used.
        if(c.globalCompositeOperation!=='source-over')throw new Error('Recheck native Canvas linear-blend support.');
        expected=mode==='linear-light'?(alpha===255?[200,70,46,255]:[151,103,102,192]):(alpha===255?[0,0,5,255]:[84,79,88,192]);
        reference='Independent scalar RGB8 values';
      }else{
        if(c.globalCompositeOperation!==requested)throw new Error('Canvas did not accept reference blend mode '+mode);
        c.drawImage(source,0,0);expected=[...c.getImageData(0,0,1,1).data];
      }
      results.push({mode,alpha,reference,canvasOperation:c.globalCompositeOperation,actual:[...actual],expected:[...expected],error:Math.max(...[0,1,2].map(i=>Math.abs(actual[i]*actual[3]/255-expected[i]*expected[3]/255)))});
    }
    return results;
  });
  await writeFile(info.outputPath('independent-blend-references.json'),JSON.stringify(results,null,2));
  for(const result of results){expect(Math.abs(result.actual[3]-result.expected[3]),JSON.stringify(result)).toBeLessThanOrEqual(1);expect(result.error,JSON.stringify(result)).toBeLessThanOrEqual(3);}
});
