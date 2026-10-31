import { parentPort,workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import './typescript-worker.mjs';
try{
  const {openPngRows}=await import('./png-rows.ts');
  const {instantiateKernel,applyColorRange}=await import('../src/engine/wasm.ts');
  const {SelectionRows}=await import('../src/core/selection-rows.ts');
  const image=openPngRows(new Uint8Array(workerData.png)),source=workerData.options.source;
  if(image.width!==workerData.assetWidth||image.height!==workerData.assetHeight)throw new Error('PNG source dimensions do not match the uploaded asset.');
  if(!Number.isSafeInteger(source.x+image.width)||!Number.isSafeInteger(source.y+image.height))throw new Error('Color Range source bounds exceed safe integer placement.');
  const left=Math.max(0,source.x),top=Math.max(0,source.y),right=Math.min(workerData.width,source.x+image.width),bottom=Math.min(workerData.height,source.y+image.height);
  if(right<=left||bottom<=top){for await(const strip of image.strips){}parentPort.postMessage({selection:{regions:[]}});}
  else{
    const bytes=await readFile(new URL('../public/wasm/pixels.wasm',import.meta.url));
    const kernel=await instantiateKernel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const region={x:left,y:top,width:right-left,height:bottom-top},rows=new SelectionRows(region);
    for await(const strip of image.strips){
      const first=Math.max(0,top-source.y-strip.y),last=Math.min(strip.height,bottom-source.y-strip.y);
      if(last<=first)continue;
      const pixels=new Uint8ClampedArray(region.width*(last-first)*4);
      for(let row=first;row<last;row++){
        const start=(row*image.width+left-source.x)*4;
        pixels.set(strip.pixels.subarray(start,start+region.width*4),(row-first)*region.width*4);
      }
      await rows.append(applyColorRange(kernel,pixels,workerData.options));
    }
    parentPort.postMessage({selection:rows.finish()});
  }
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
