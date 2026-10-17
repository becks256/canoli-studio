import {preflightDocumentView} from '../core/preflight-view';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import {exportFontFamilies} from '../core/font-references';
import {preflightOptionsSchema,preflightReportSchema,type PreflightOptions,type PreflightReport,type PreflightControl,type PreflightFontStatus} from '../core/preflight';
import {fontAvailability} from './font-availability';

/** Local family probe only; timeout/abort cannot be mistaken for a missing font. */
export function probePreflightFont(family:string,signal?:AbortSignal):Promise<PreflightFontStatus>{
  signal?.throwIfAborted();
  if(typeof document!=='undefined'&&document.fonts){
    const normalized=family.trim().replace(/^(['"])(.*)\1$/,'$2').toLowerCase();let loading=false;
    for(const face of document.fonts){
      if(face.family.replace(/^(['"])(.*)\1$/,'$2').toLowerCase()!==normalized)continue;
      if(face.status==='loaded')return Promise.resolve('available');
      if(face.status==='loading')loading=true;
    }
    if(loading)return Promise.resolve('unknown');
  }
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(value:PreflightFontStatus,error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(error)reject(error);else resolve(value);};
    const cancel=()=>finish('unknown',signal?.reason??new Error('Design checks cancelled.'));
    const timer=setTimeout(()=>finish('unknown'),2000);
    signal?.addEventListener('abort',cancel,{once:true});
    void fontAvailability(family).then(value=>finish(value),()=>finish('unknown'));
    if(signal?.aborted)cancel();
  });
}

/** No image decoding or pixel capture. A dedicated worker owns geometry traversal. */
export async function preparePreflight(document:DocumentData,revision:number,assets:AssetStore,options:PreflightOptions={},control:PreflightControl={},check:()=>void=()=>{},probeFonts=true):Promise<PreflightReport>{
  const settings=preflightOptionsSchema.parse(options),originals=assets.values(),alive=assets.captureLifetime();
  const current=()=>{control.signal?.throwIfAborted();alive();check();for(const asset of originals)if(assets.get(asset.id)!==asset)throw new Error('Source assets changed during design checks.');};
  current();const fonts:[string,PreflightFontStatus][]=[];
  if(settings.checkFonts&&probeFonts){
    const families=exportFontFamilies(document,settings.includeHidden);let next=0;
    await Promise.all(Array.from({length:Math.min(8,families.length)},async()=>{
      while(next<families.length){const family=families[next++],status=await probePreflightFont(family,control.signal);current();fonts.push([family.trim().toLowerCase(),status]);}
    }));
  }
  current();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./preflight.worker.ts',import.meta.url),{type:'module'});let settled=false;
    const finish=(error?:unknown,result?:unknown)=>{if(settled)return;settled=true;control.signal?.removeEventListener('abort',cancel);worker.terminate();try{current();if(error)throw error;resolve(preflightReportSchema.parse(result));}catch(cause){reject(cause);}};
    const cancel=()=>finish(control.signal?.reason??new Error('Design checks cancelled.'));
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>event.data.error?finish(new Error(event.data.error)):finish(undefined,event.data.report);
    worker.onerror=()=>finish(new Error('Design-check worker failed.'));
    worker.onmessageerror=()=>finish(new Error('Invalid design-check worker message.'));
    try{current();worker.postMessage({document:preflightDocumentView(document,settings.checkBounds),revision,options:settings,assets:originals.map(asset=>[asset.id,{width:asset.width,height:asset.height}]),fonts});}catch(error){finish(error);}
  });
}
