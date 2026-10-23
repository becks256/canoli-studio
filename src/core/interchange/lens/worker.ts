import {z} from 'zod';
import {lensCorrectionSchema} from '../raw/lens';
import {rawImportReportSchema} from '../raw/types';
import {prepareRawLens} from '../raw/profile';
import factory from './codec/canoli_lens_correction.js';
import wasmUrl from './codec/canoli_lens_correction.wasm?url';
import build from './codec/build.json';

const requestSchema=z.object({lens:lensCorrectionSchema,report:rawImportReportSchema}).strict();
let started=false;
self.onmessage=async(event:MessageEvent)=>{
  try{
    if(started)throw new Error('This lens validation worker already owns a request.');started=true;
    const request=requestSchema.parse(event.data),lease=await prepareRawLens(request.lens,request.report,()=>factory({locateFile:()=>wasmUrl}));
    try{self.postMessage({ok:true,identity:lease?build.artifacts['canoli_lens_correction.wasm'].sha256:null});}finally{lease?.dispose();}
  }catch(cause){self.postMessage({error:cause instanceof Error?cause.message:String(cause)});}
};
