import { parentPort,workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
try{
  const {openPngRows}=await tsImport('./png-rows.ts',import.meta.url);
  const {instantiateKernel}=await tsImport('../src/engine/wasm.ts',import.meta.url);
  const {growQuickSelection}=await tsImport('../src/engine/quick-selection.ts',import.meta.url);
  const image=openPngRows(new Uint8Array(workerData.png)),source=workerData.options.source;
  if(image.width!==workerData.assetWidth||image.height!==workerData.assetHeight)throw new Error('PNG dimensions do not match the uploaded source.');
  if(!Number.isSafeInteger(source.x+image.width)||!Number.isSafeInteger(source.y+image.height))throw new Error('Quick Selection source bounds exceed safe placement.');
  const x=Math.max(0,source.x),y=Math.max(0,source.y),right=Math.min(workerData.width,source.x+image.width),bottom=Math.min(workerData.height,source.y+image.height);
  const width=right-x,height=bottom-y;
  if(width<=0||height<=0)throw new Error('Quick Selection source is outside the canvas.');
  if(!Number.isSafeInteger(width*height)||width*height*4>0x7fffffff)throw new Error('Quick Selection source exceeds the native working-buffer address range.');
  const pixels=new Uint8ClampedArray(width*height*4);
  for await(const strip of image.strips){
    const first=Math.max(0,y-source.y-strip.y),last=Math.min(strip.height,bottom-source.y-strip.y);
    for(let row=first;row<last;row++){
      const start=(row*image.width+x-source.x)*4;
      pixels.set(strip.pixels.subarray(start,start+width*4),(strip.y+row+source.y-y)*width*4);
    }
  }
  const bytes=await readFile(new URL('../public/wasm/pixels.wasm',import.meta.url));
  const kernel=await instantiateKernel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const selection=await growQuickSelection(kernel,pixels,{...workerData.options,x,y,width,height});
  parentPort.postMessage({selection});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
