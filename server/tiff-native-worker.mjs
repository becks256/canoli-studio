import {parentPort,workerData} from 'node:worker_threads';
import './typescript-worker.mjs';
let resume;
parentPort.on('message',message=>{
  if(message?.kind!=='continue'||!resume)throw new Error('Unexpected native TIFF acknowledgement.');
  const next=resume;resume=undefined;next();
});
try{
  const {prepareNativeTiff,inspectNativeTiff}=await import('./tiff-native-runtime.ts');
  if(workerData.mode==='inspect')parentPort.postMessage({kind:'report',report:await inspectNativeTiff(workerData.original)});
  else if(workerData.mode==='prepare')await prepareNativeTiff(workerData.input,workerData.buildId,workerData.directory,message=>parentPort.postMessage(message),()=>new Promise(resolve=>{resume=resolve;}));
  else throw new Error('Invalid native TIFF worker mode.');
}catch(error){parentPort.postMessage({kind:'error',error:error instanceof Error?error.message:String(error)});}
