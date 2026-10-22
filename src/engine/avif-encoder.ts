import {avifGeometry,avifSettings,inspectAvif,assertAvifResult} from '../core/avif';
import {checkExport,type ExportControl} from './export-control';

/** Transfer only the exporter's owned frame; terminate the codec on every result/cancel/error. */
export async function encodeAvifFrame(buffer:ArrayBuffer,width:number,height:number,settings:unknown,requiresAlpha:boolean,control?:ExportControl,current:()=>void=()=>{}):Promise<Blob>{
  checkExport(control);const geometry=avifGeometry(width,height),options=avifSettings(settings);
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==geometry.bytes||typeof requiresAlpha!=='boolean')throw new Error('Invalid private AVIF frame.');
  if(typeof Worker==='undefined')throw new Error('AVIF export requires browser worker support.');
  const worker=new Worker(new URL('./avif-export.worker.ts',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{
    let settled=false,received=false,terminated=false;
    const terminate=()=>{if(!terminated){terminated=true;worker.terminate();}};
    const cleanup=()=>{control?.signal?.removeEventListener('abort',abort);worker.removeEventListener('messageerror',messageError);worker.onmessage=null;worker.onerror=null;terminate();};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const abort=()=>{try{checkExport(control);}catch(error){fail(error);}};
    const messageError=()=>fail(new Error('Invalid AVIF worker message.'));
    control?.signal?.addEventListener('abort',abort,{once:true});worker.addEventListener('messageerror',messageError);
    worker.onerror=()=>fail(new Error('AVIF worker failed. Retry export or choose another format.'));
    worker.onmessage=async(event:MessageEvent)=>{
      try{
        if(settled)return;checkExport(control);current();const value=event.data;
        if(value?.type==='started'&&Object.keys(value).length===1&&!received)return;
        if(value?.type==='error'&&typeof value.error==='string')throw new Error(value.error);
        if(received||value?.type!=='complete'||Object.keys(value).some(key=>!['type','width','height','blob'].includes(key))||value.width!==width||value.height!==height||!(value.blob instanceof Blob)||value.blob.type!=='image/avif')throw new Error('Invalid AVIF encoding result.');
        // Release the native codec heap before inspecting the immutable returned bytes.
        received=true;terminate();const bytes=new Uint8Array(await value.blob.arrayBuffer());
        if(settled)return;checkExport(control);current();assertAvifResult(inspectAvif(bytes),width,height,requiresAlpha);
        settled=true;cleanup();resolve(value.blob);
      }catch(error){fail(error);}
    };
    try{checkExport(control);current();worker.postMessage({type:'encode',width,height,buffer,settings:options,requiresAlpha},[buffer]);}catch(error){fail(error);}
  });
}
