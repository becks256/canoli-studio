import {parentPort,workerData} from 'node:worker_threads';
import './typescript-worker.mjs';
try{
  const {openPngRows}=await import('./png-rows.ts'),image=openPngRows(new Uint8Array(workerData.png));let samples=0;
  for await(const strip of image.strips)samples+=strip.pixels.length;
  if(samples!==image.width*image.height*4)throw new Error('PNG sample extent differs from its geometry.');
  parentPort.postMessage({width:image.width,height:image.height});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
