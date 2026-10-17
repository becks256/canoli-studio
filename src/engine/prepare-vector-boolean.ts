import { vectorBooleanRequestSchema, vectorBooleanResultSchema, type VectorBooleanRequest, type VectorBooleanResult, type VectorBooleanControl } from '../core/vector-boolean';

/** One isolated worker per operation; cancellation and the deadline terminate computation. */
export function prepareVectorBoolean(value:VectorBooleanRequest,control:VectorBooleanControl={},check:()=>void=()=>{}):Promise<VectorBooleanResult>{
  check();control.signal?.throwIfAborted();const request=vectorBooleanRequestSchema.parse(value);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./vector-boolean.worker.ts',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(error?:unknown,result?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);control.signal?.removeEventListener('abort',cancel);worker.terminate();
      if(error){reject(error);return;}
      try{check();control.signal?.throwIfAborted();resolve(vectorBooleanResultSchema.parse(result));}catch(cause){reject(cause);}
    };
    const cancel=()=>finish(control.signal?.reason??new Error('Boolean operation cancelled.'));
    const timer=setTimeout(()=>finish(new Error('Boolean operation exceeded its 30-second calculation budget.')),30000);
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.onerror=event=>{event.preventDefault();finish(new Error(event.message||'Boolean worker failed.'));};
    worker.addEventListener('messageerror',()=>finish(new Error('Boolean worker returned an unreadable message.')));
    worker.onmessage=event=>{
      try{check();control.signal?.throwIfAborted();
        if(event.data.progress){const p=event.data.progress;if(!Number.isInteger(p.completed)||!Number.isInteger(p.total)||p.total!==request.paths.length-1||p.completed<0||p.completed>p.total)throw new Error('Invalid Boolean progress.');control.onProgress?.(p);}
        else if(event.data.error)finish(new Error(String(event.data.error)));
        else finish(undefined,event.data.result);
      }catch(error){finish(error);}
    };
    if(control.signal?.aborted)cancel();else try{worker.postMessage(request);}catch(error){finish(error);}
  });
}
