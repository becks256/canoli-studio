import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import './typescript-worker.mjs';
try{
  const {openPngRows}=await import('./png-rows.ts');
  const {instantiateKernel}=await import('../src/engine/wasm.ts');
  const {selectNativeSubject}=await import('../src/engine/subject-selection.ts');
  const image=openPngRows(new Uint8Array(workerData.png));
  if(image.width!==workerData.width||image.height!==workerData.height)throw new Error('PNG dimensions do not match the uploaded source.');
  const count=image.width*image.height;
  if(!Number.isSafeInteger(count)||count*4>0x7fffffff)throw new Error('Select Subject source exceeds the native working-buffer address range.');
  const pixels=new Uint8ClampedArray(count*4);
  for await(const strip of image.strips)pixels.set(strip.pixels,strip.y*image.width*4);
  const bytes=await readFile(new URL('../public/wasm/pixels.wasm',import.meta.url));
  const kernel=await instantiateKernel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const selection=await selectNativeSubject(kernel,pixels,{width:image.width,height:image.height,threshold:workerData.options.threshold,expandRadius:workerData.options.expandRadius});
  parentPort.postMessage({selection});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
