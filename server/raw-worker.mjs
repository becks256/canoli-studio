import {parentPort,workerData} from 'node:worker_threads';
import './typescript-worker.mjs';
try{
  const {rawNativeJob}=await import('./raw-runtime.ts');
  const result=await rawNativeJob(workerData.mode,new Uint8Array(workerData.bytes),workerData.options,progress=>parentPort.postMessage({progress}));
  parentPort.postMessage({result});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
