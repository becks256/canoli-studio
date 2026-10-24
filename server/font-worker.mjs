import {parentPort,workerData} from 'node:worker_threads';
import {tsImport} from 'tsx/esm/api';
try{
  const{prepareFontBytes}=await tsImport('../src/fonts/parser.ts',import.meta.url);
  parentPort.postMessage({result:await prepareFontBytes(new Uint8Array(await workerData.source.arrayBuffer()),workerData.options)});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
