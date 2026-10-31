import { parentPort, workerData } from 'node:worker_threads';
import './typescript-worker.mjs';
try {
 const {calculateVectorBoolean}=await import('../src/engine/vector-boolean-kernel.ts');
 parentPort.postMessage({result:calculateVectorBoolean(workerData,progress=>parentPort.postMessage({progress}))});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
