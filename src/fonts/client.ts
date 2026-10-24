import {z} from 'zod';
import {freezeOwnedData} from '../core/immutable';
import {fontDigest,fontFaceId,fontInspectionSchema,fontInspectOptionsSchema,fontPrepareOptionsSchema,fontPreparedBytesSchema,fontProgressSchema,type FontInspection,type FontInspectOptions,type FontPrepareOptions,type FontSourceControl,type PreparedFontSource} from './types';

// One active host job/parser worker. Waiting jobs hold immutable source Blobs.
// Native FontFace.load cannot be forcibly cancelled; abandoned results are
// discarded and never registered, even if the browser finishes loading later.
let active=false;
const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
function acquire(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>{const at=waiting.indexOf(entry);if(at>=0)waiting.splice(at,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('Font source operation cancelled.'));pump();};
    const entry={start(){if(signal?.aborted){cancel();return;}active=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active=false;pump();});}};
    waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
  });
}
const inspected=z.object({report:fontInspectionSchema}).strict();
function run(blob:Blob,mode:'inspect',options:FontInspectOptions,control:FontSourceControl):Promise<FontInspection>;
function run(blob:Blob,mode:'prepare',options:FontPrepareOptions,control:FontSourceControl):Promise<PreparedFontSource>;
function run(blob:Blob,mode:'inspect'|'prepare',options:FontInspectOptions|FontPrepareOptions,control:FontSourceControl):Promise<FontInspection|PreparedFontSource>{
  control.signal?.throwIfAborted();
  const timeoutMs=z.number().int().positive().max(0x7fffffff).parse(control.timeoutMs??60000);
  if(!(blob instanceof Blob)||!blob.size)throw new Error('Choose a nonempty font source Blob.');
  if(typeof Worker==='undefined')return Promise.reject(new Error('Font sources require the browser worker host.'));
  return new Promise((resolve,reject)=>{
    let worker:Worker;
    try{worker=new Worker(new URL('../generated/font-source-worker.js',import.meta.url),{type:'module'});}catch(error){reject(error);return;}
    let settled=false,received=false,terminated=false;
    const terminate=()=>{if(!terminated){terminated=true;worker.terminate();}};
    const cleanup=()=>{terminate();clearTimeout(timer);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;control.signal?.removeEventListener('abort',cancel);};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const cancel=()=>fail(control.signal?.reason??new Error('Font source operation cancelled.'));
    const check=()=>{control.signal?.throwIfAborted();if(settled)throw new Error('Font source operation has ended.');};
    const timer=setTimeout(()=>fail(new Error('Font source operation exceeded its time budget.')),timeoutMs);
    const finish=async(value:unknown)=>{
      if(settled||received)return;received=true;terminate();
      try{
        check();const decoded=mode==='inspect'?inspected.parse(value):fontPreparedBytesSchema.parse(value),report=decoded.report;
        if(report.byteLength!==blob.size||report.sha256!==await fontDigest(await blob.arrayBuffer()))throw new Error('Font source fingerprint does not match its inspection.');check();
        for(const face of report.faces)if(face.id!==await fontFaceId(report.sha256,face.index))throw new Error('Font face identity does not match its source.');check();
        let result:FontInspection|PreparedFontSource;
        if(mode==='inspect'){
          const settings=fontInspectOptionsSchema.parse(options);
          if(report.offset!==settings.offset||report.faces.length!==Math.min(settings.limit,report.faceCount-settings.offset))throw new Error('Font inspection does not match its requested page.');
          result=await freezeOwnedData(report);
        }else{
          const prepared=fontPreparedBytesSchema.parse(decoded),settings=fontPrepareOptionsSchema.parse(options),face=report.faces[0];
          if(report.faces.length!==1||report.offset!==prepared.faceIndex||face.index!==prepared.faceIndex||prepared.faceIndex!==(settings.faceIndex??0)||report.faceCount>1&&settings.faceIndex===undefined)throw new Error('Prepared font does not match the selected face.');
          if(prepared.renderBlob.type!==`font/${prepared.renderFormat}`||prepared.renderSha256!==await fontDigest(await prepared.renderBlob.arrayBuffer()))throw new Error('Prepared native font fingerprint differs.');check();
          const header=await prepared.renderBlob.slice(0,4).arrayBuffer();check();
          const signatures={ttf:[0x00010000,0x74727565],otf:[0x4f54544f],woff:[0x774f4646],woff2:[0x774f4632]};
          if(header.byteLength!==4||!signatures[prepared.renderFormat].includes(new DataView(header).getUint32(0)))throw new Error('Prepared native font format differs from its bytes.');
          if(prepared.extracted!==['ttc','dfont'].includes(report.format)||prepared.repacked!==(report.format==='ttc')||!prepared.extracted&&report.format!==prepared.renderFormat)throw new Error('Prepared font container identity differs.');
          if(!prepared.extracted&&(prepared.renderBlob.size!==blob.size||prepared.renderSha256!==report.sha256)||prepared.repacked&&!prepared.extracted||prepared.omittedTables.length&&!prepared.repacked)throw new Error('Prepared font source transformation is inconsistent.');
          if(typeof FontFace==='undefined')throw new Error('This browser cannot validate native font faces.');
          control.onProgress?.({phase:'validating',fraction:null});check();
          const fontFaces:FontFace[]=[];
          for(const descriptor of face.descriptors){
            check();const font=new FontFace(face.cssFamily,await prepared.renderBlob.arrayBuffer(),descriptor);check();
            try{await font.load();}catch{check();throw new Error('This browser could not validate the selected font face.');}check();
            if(font.status!=='loaded')throw new Error('The browser could not load the selected native font.');fontFaces.push(font);
          }
          result=Object.freeze({...prepared,report:await freezeOwnedData(report),omittedTables:Object.freeze([...prepared.omittedTables])as unknown as ('DSIG')[],original:blob,fontFaces:Object.freeze(fontFaces)});
        }
        check();settled=true;cleanup();resolve(result);
      }catch(error){fail(error);}
    };
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>{
      if(settled||received)return;
      try{const data=event.data;if(data&&typeof data.error==='string')fail(new Error(data.error));else if(data&&'progress'in data){control.onProgress?.(fontProgressSchema.parse(data.progress));check();}else void finish(data);}catch(error){fail(error);}
    };
    worker.onerror=()=>fail(new Error('Font parser worker failed. Check the source and available browser memory.'));
    worker.onmessageerror=()=>fail(new Error('Invalid font parser response.'));
    try{worker.postMessage({blob,mode,options,timeoutMs});if(control.signal?.aborted)cancel();}catch(error){fail(error);}
  });
}
export async function inspectFontFile(blob:Blob,options:FontInspectOptions={},control:FontSourceControl={}):Promise<FontInspection>{
  const settings=fontInspectOptionsSchema.parse(options),release=await acquire(control.signal);
  try{return await run(blob,'inspect',settings,control);}finally{release();}
}
export async function prepareFontFile(blob:Blob,options:FontPrepareOptions={},control:FontSourceControl={}):Promise<PreparedFontSource>{
  const settings=fontPrepareOptionsSchema.parse(options),release=await acquire(control.signal);
  try{return await run(blob,'prepare',settings,control);}finally{release();}
}
