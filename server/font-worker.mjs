import {parentPort,workerData} from 'node:worker_threads';
import './typescript-worker.mjs';
try{
  const{prepareFontBytes}=await import('../src/fonts/parser.ts');
  parentPort.postMessage({result:await prepareFontBytes(new Uint8Array(await workerData.source.arrayBuffer()),workerData.options)});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
