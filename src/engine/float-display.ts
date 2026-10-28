import{IccSession,registerIdleIccOwner,type IccControl}from'../core/color/icc-client';
import{iccTarget}from'../core/color/profile-source';
import type{IccSamples}from'../core/color/icc-types';

interface Entry{
 session:IccSession;abort:AbortController;owner:symbol;
 activity:{control?:IccControl};unregister?:()=>void;
}
let idle:Entry|undefined;
function progressFor(activity:Entry['activity']):NonNullable<IccControl['onProgress']>{
 return phase=>{const current=activity.control;current?.signal?.throwIfAborted();current?.onProgress?.(phase);};
}
function close(entry:Entry){
 if(idle===entry)idle=undefined;
 entry.unregister?.();entry.unregister=undefined;entry.activity.control=undefined;
 entry.session.dispose();
}
export function retireFloatDisplay(owner:symbol){if(idle?.owner===owner)close(idle);}

/** One idle, host-owned linear-sRGB display transform across all renderers.
 * It remains an actual native owner, yields its slot to queued work, and holds
 * neither a scene/source lease nor a caller's progress/abort closure while idle.
 * IccSession disposal itself retains its immediate termination contract. */
export async function borrowFloatDisplay(owner:symbol,control:IccControl={}):Promise<{
 applyWindow(samples:IccSamples):Promise<IccSamples>;release():void;
}>{
 control.signal?.throwIfAborted();let entry=idle;idle=undefined;
 if(entry){entry.unregister?.();entry.unregister=undefined;if(entry.session.isClosed){close(entry);entry=undefined;}}
 const abort=entry?.abort??new AbortController(),activity=entry?.activity??{control};activity.control=control;
 const cancel=()=>abort.abort(control.signal?.reason);
 control.signal?.addEventListener('abort',cancel,{once:true});if(control.signal?.aborted)cancel();
 const detach=()=>{control.signal?.removeEventListener('abort',cancel);activity.control=undefined;};
 try{
  abort.signal.throwIfAborted();
  if(!entry){
   const prepared=await IccSession.prepareRgb(iccTarget('linear-srgb').source,iccTarget('srgb').source,
    {inputFormat:'rgba-float32',outputFormat:'rgba8'},
    {signal:abort.signal,onProgress:progressFor(activity)});
   entry={session:prepared.session,abort,activity,owner};
  }
  const captured=entry;captured.owner=owner;let released=false,healthy=true,cacheable=true,inFlight=0;
  abort.signal.throwIfAborted();
  return{
   applyWindow:async samples=>{
    if(released)throw new Error('Float display lease is closed.');
    // Larger valid windows still process normally, but do not retain their
    // native scratch as idle display state. This is not an input-size limit.
    if(samples.length/4>65536)cacheable=false;
    inFlight++;
    try{control.signal?.throwIfAborted();return await captured.session.applyWindow(samples);}
    catch(error){healthy=false;throw error;}
    finally{inFlight--;}
   },
   release:()=>{
    if(released)return;released=true;detach();
    if(!healthy||!cacheable||inFlight||abort.signal.aborted||captured.session.isClosed){close(captured);return;}
    if(idle)close(idle);idle=captured;
    captured.unregister=registerIdleIccOwner(()=>close(captured));
   },
  };
 }catch(error){detach();if(entry)close(entry);throw error;}
}
