import { Worker } from 'node:worker_threads';
import { vectorBooleanRequestSchema, vectorBooleanResultSchema, type VectorBooleanRequest, type VectorBooleanResult, type VectorBooleanControl } from '../src/core/vector-boolean';

export function prepareServerVectorBoolean(value:VectorBooleanRequest,control:VectorBooleanControl={}):Promise<VectorBooleanResult>{
 control.signal?.throwIfAborted();const request=vectorBooleanRequestSchema.parse(value);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./vector-boolean-worker.mjs',import.meta.url),{workerData:request,execArgv:[]});let settled=false;
  const finish=(error?:unknown,result?:unknown)=>{
   if(settled)return;settled=true;clearTimeout(timer);control.signal?.removeEventListener('abort',cancel);void worker.terminate();
   if(error)reject(error);else try{control.signal?.throwIfAborted();resolve(vectorBooleanResultSchema.parse(result));}catch(cause){reject(cause);}
  };
  const cancel=()=>finish(control.signal?.reason??new Error('Boolean operation cancelled.'));
  const timer=setTimeout(()=>finish(new Error('Boolean operation exceeded its 30-second calculation budget.')),30000);
  control.signal?.addEventListener('abort',cancel,{once:true});
  worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Boolean worker closed (${code}).`)));
  worker.on('message',message=>{try{
   if(message.progress){const p=message.progress;if(!Number.isInteger(p.completed)||!Number.isInteger(p.total)||p.total!==request.paths.length-1||p.completed<0||p.completed>p.total)throw new Error('Invalid Boolean progress.');control.onProgress?.(p);}
   else if(message.error)finish(new Error(String(message.error)));else finish(undefined,message.result);
  }catch(error){finish(error);}});
  if(control.signal?.aborted)cancel();
 });
}
