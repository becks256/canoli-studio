import {parentPort,workerData} from 'node:worker_threads';
import {tsImport} from 'tsx/esm/api';
try{
  const {rawNativeJob}=await tsImport('./raw-runtime.ts',import.meta.url);
  const result=await rawNativeJob(workerData.mode,new Uint8Array(workerData.bytes),workerData.options,progress=>parentPort.postMessage({progress}));
  parentPort.postMessage({result});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
