import {parentPort,workerData} from 'node:worker_threads';
import {tsImport} from 'tsx/esm/api';
try{
  const {inspectDesign}=await tsImport('../src/core/preflight.ts',import.meta.url);
  const {document,revision,options,assets}=workerData;
  parentPort.postMessage({report:await inspectDesign(document,revision,options,{assets:new Map(assets)})});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
