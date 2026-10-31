import {parentPort,workerData} from 'node:worker_threads';
import './typescript-worker.mjs';
try{
  const {inspectDesign}=await import('../src/core/preflight.ts');
  const {document,revision,options,assets}=workerData;
  parentPort.postMessage({report:await inspectDesign(document,revision,options,{assets:new Map(assets)})});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
