import type {AssetStore} from '../core/assets';
import {acquireFontWorkerSlot} from '../fonts/client';
import {normalizeFontRun,decodeFontRun,type FontRunInput,type OwnedFontRun} from '../fonts/shaping-types';
import type {NativeGlyphFontControl} from './native-glyph-font';
/** Disposable worker ownership makes HarfBuzz object/heap retirement explicit. */
export async function captureNativeFontRun(assets:AssetStore,id:string,input:FontRunInput,settings:string,control:NativeGlyphFontControl={}):Promise<OwnedFontRun>{
 const request=normalizeFontRun(input);control={...control};const timeout=control.timeoutMs??60000;if(!Number.isInteger(timeout)||timeout<=0||timeout>0x7fffffff)throw new Error('Invalid font shaping time budget.');
 const alive=assets.captureLifetime(),current=()=>{control.signal?.throwIfAborted();alive();control.check?.();control.signal?.throwIfAborted();alive();};current();const lease=assets.fonts.retain(id);let slot:(()=>void)|undefined;
 try{slot=await acquireFontWorkerSlot(control.signal);current();lease.check();const source=lease.resource,info=source.descriptor.report.faces[0];
  return await new Promise<OwnedFontRun>((resolve,reject)=>{let ended=false,received=false,worker:Worker|undefined;const cleanup=()=>{worker?.terminate();worker=undefined;clearTimeout(timer);control.signal?.removeEventListener('abort',cancel);},fail=(error:unknown)=>{if(ended)return;ended=true;cleanup();reject(error);},cancel=()=>fail(control.signal?.reason??new Error('Font shaping cancelled.')),timer=setTimeout(()=>fail(new Error('Font shaping exceeded its time budget.')),timeout),check=()=>{if(ended)throw new Error('Font shaping already ended.');current();lease.check();};
   control.signal?.addEventListener('abort',cancel,{once:true});
   void(async()=>{try{check();const bytes=new Uint8Array(await source.renderBlob.arrayBuffer());check();worker=new Worker(new URL('../generated/font-shaping-worker.js',import.meta.url),{type:'module'});worker.onerror=()=>fail(new Error('Font shaping worker failed.'));worker.onmessageerror=()=>fail(new Error('Invalid font shaping response.'));worker.onmessage=event=>{if(received||ended)return;received=true;void(async()=>{try{check();if(event.data?.error)throw new Error(String(event.data.error));worker?.terminate();worker=undefined;const result=await decodeFontRun(event.data,request,settings,info,check);check();ended=true;cleanup();resolve(result);}catch(error){fail(error);}})();};worker.postMessage({bytes,input:request,settings,timeoutMs:timeout});}catch(error){fail(error);}})();if(control.signal?.aborted)cancel();
  });
 }finally{slot?.();lease.release();}
}
