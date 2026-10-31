import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import './typescript-worker.mjs';
try{
  const {instantiateKernel,runServerMatting}=await import('./matting-runtime.ts');
  const binary=await readFile(new URL('../public/wasm/pixels.wasm',import.meta.url)),kernel=await instantiateKernel(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));
  const result=await runServerMatting(kernel,workerData.document,workerData.request,workerData.inputs),mask=await result.maskBlob.arrayBuffer(),foreground=await result.foregroundBlob?.arrayBuffer();
  parentPort.postMessage({mask,foreground,width:result.width,height:result.height,unresolvedPixels:result.unresolvedPixels},foreground?[mask,foreground]:[mask]);
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
