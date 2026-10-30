import {parentPort,workerData} from 'node:worker_threads';
import {tsImport} from 'tsx/esm/api';
let resume;
parentPort.on('message',message=>{
  if(message?.kind!=='continue'||!resume)throw new Error('Unexpected native TIFF acknowledgement.');
  const next=resume;resume=undefined;next();
});
try{
  const {prepareNativeTiff,inspectNativeTiff}=await tsImport('./tiff-native-runtime.ts',import.meta.url);
  if(workerData.mode==='inspect')parentPort.postMessage({kind:'report',report:await inspectNativeTiff(workerData.original)});
  else if(workerData.mode==='prepare')await prepareNativeTiff(workerData.input,workerData.buildId,workerData.directory,message=>parentPort.postMessage(message),()=>new Promise(resolve=>{resume=resolve;}));
  else throw new Error('Invalid native TIFF worker mode.');
}catch(error){parentPort.postMessage({kind:'error',error:error instanceof Error?error.message:String(error)});}
