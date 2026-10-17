import { parentPort, workerData } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';
try {
 const {calculateVectorBoolean}=await tsImport('../src/engine/vector-boolean-kernel.ts',import.meta.url);
 parentPort.postMessage({result:calculateVectorBoolean(workerData,progress=>parentPort.postMessage({progress}))});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
