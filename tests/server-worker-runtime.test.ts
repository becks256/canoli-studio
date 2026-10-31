import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';

it('loads the actual native RAW worker from a plain JavaScript parent without parent TypeScript hooks',()=>{
 const worker=new URL('../server/raw-worker.mjs',import.meta.url).href;
 const source=new URL('./fixtures/raw/bayer-rggb.dng',import.meta.url).href;
 const script=`
  import {Worker} from 'node:worker_threads';
  import {readFile} from 'node:fs/promises';
  import {createHash} from 'node:crypto';
  const original=await readFile(new URL(${JSON.stringify(source)}));
  const hash=()=>createHash('sha256').update(original).digest('hex'),before=hash();
  const bytes=original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength);
  const worker=new Worker(new URL(${JSON.stringify(worker)}),{workerData:{mode:'inspect',bytes,options:{}},transferList:[bytes],execArgv:[]});
  try{
   const result=await new Promise((resolve,reject)=>{
    worker.once('error',reject);worker.once('exit',code=>reject(Error('Native worker exited before its result: '+code)));
    worker.on('message',message=>{if(message.error)reject(Error(message.error));else if(message.result)resolve(message.result);});
   });
   console.log(JSON.stringify({width:result.report.displayWidth,height:result.report.displayHeight,originalUnchanged:hash()===before}));
  }finally{await worker.terminate();}
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
 expect(result.status,result.stderr||String(result.error)).toBe(0);
 expect(JSON.parse(result.stdout)).toEqual({width:64,height:48,originalUnchanged:true});
},20000);

it('rejects native loader registration in the API parent thread',()=>{
 const loader=new URL('../server/typescript-worker.mjs',import.meta.url).href;
 const script=`try{await import(${JSON.stringify(loader)});process.exitCode=1;}catch(error){console.log(error.message);}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:5000});
 expect(result.status,result.stderr||String(result.error)).toBe(0);
 expect(result.stdout.trim()).toBe('The native TypeScript loader requires a worker thread.');
});
