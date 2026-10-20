import {checkExport,type ExportControl} from './export-control';
import type {PhotoshopEncodedChannel,PhotoshopChannelEncoding} from './photoshop-strip';

/** One private worker per export. Only captured strip buffers may be transferred. */
export class PhotoshopEncoder {
 private worker:Worker|null=null;
 private pending:{reject(error:unknown):void}|null=null;
 private sequence=0;
 private disposed=false;
 async encode(pixels:Uint8ClampedArray<ArrayBuffer>,width:number,rows:number,encoding:PhotoshopChannelEncoding,control?:ExportControl):Promise<PhotoshopEncodedChannel[]>{
  checkExport(control);if(this.disposed)throw new Error('Photoshop encoder is disposed.');
  if(this.pending)throw new Error('Photoshop encoding already in progress.');
  const worker=this.worker??=new Worker(new URL('./photoshop-export.worker.ts',import.meta.url),{type:'module'}),id=++this.sequence;
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{control?.signal?.removeEventListener('abort',abort);worker.removeEventListener('messageerror',messageError);this.pending=null;worker.onmessage=null;worker.onerror=null;};
   const fail=(error:unknown)=>{cleanup();this.dispose();reject(error);};
   const abort=()=>{try{checkExport(control);}catch(error){fail(error);}};
   const messageError=()=>fail(new Error('Invalid Photoshop encoding worker message.'));
   this.pending={reject:fail};control?.signal?.addEventListener('abort',abort,{once:true});
   worker.onerror=()=>fail(new Error('Photoshop encoding worker failed. Retry export.'));
   // Chromium can dispatch messageerror without supporting its handler property.
   worker.addEventListener('messageerror',messageError);
   worker.onmessage=event=>{
    try{
     checkExport(control);const value=event.data;
     if(value?.id!==id)throw new Error('Unexpected Photoshop encoding result.');
     if(typeof value.error==='string')throw new Error(value.error);
     if(!Array.isArray(value.channels)||value.channels.length!==(encoding==='mask'?1:encoding==='both'?7:4))throw new Error('Invalid Photoshop channel result.');
     for(const channel of value.channels){
      if(!(channel?.lengths instanceof Uint32Array)||channel.lengths.length!==rows||!(channel.data instanceof Blob))throw new Error('Invalid Photoshop channel data.');
      let sum=0;for(const size of channel.lengths){if(size<1||size>width*2+256)throw new Error('Invalid Photoshop scanline length.');sum+=size;}
      if(!Number.isSafeInteger(sum)||channel.data.size!==sum)throw new Error('Invalid Photoshop channel extent.');
     }
     cleanup();resolve(value.channels);
    }catch(error){fail(error);}
   };
   try{checkExport(control);worker.postMessage({id,pixels,width,rows,encoding},[pixels.buffer]);}catch(error){fail(error);}
  });
 }
 dispose(){if(this.disposed)return;this.disposed=true;const pending=this.pending;this.pending=null;this.worker?.terminate();this.worker=null;pending?.reject(new Error('Photoshop encoder was disposed.'));}
}
