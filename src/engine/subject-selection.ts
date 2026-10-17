import { subjectRequestSchema, type SubjectRequest, type SelectSubjectControl } from '../core/subject-selection';
import { SelectionRows } from '../core/selection-rows';
import { modifySelectionCoverage } from './selection-modification';
import type { PixelKernel } from './wasm';
import type { SelectionData } from '../core/drawing';

/** Worker-owned source plane; score/coverage bands avoid per-pixel float/label planes. */
export async function selectNativeSubject(kernel:PixelKernel,pixels:Uint8ClampedArray,input:SubjectRequest,
  progress:NonNullable<SelectSubjectControl['onProgress']>=()=>{}):Promise<SelectionData> {
  const request=subjectRequestSchema.parse(input),{width,height,threshold,expandRadius}=request,count=width*height;
  if(!Number.isSafeInteger(count)||pixels.length!==count*4||pixels.length>0x7fffffff)throw new Error('Invalid native Select Subject source geometry.');
  const source=kernel.bufferOffset(),params=Math.ceil((source+pixels.length)/8)*8,output=params+40,band=Math.min(count,262144),required=output+band;
  try{if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));}
  catch{throw new Error('Select Subject ran out of working memory. Try a manual selection.');}
  new Uint8ClampedArray(kernel.memory.buffer,source,pixels.length).set(pixels);
  progress({completed:0,total:count*3});kernel.subjectModel(source,width,height,params);
  for(let start=0;start<count;start+=band){
    const length=Math.min(band,count-start);kernel.subjectMaximum(source,width,height,start,length,params);
    progress({completed:start+length,total:count*3});
  }
  const rows=new SelectionRows({x:0,y:0,width,height});
  for(let start=0;start<count;start+=band){
    const length=Math.min(band,count-start);kernel.subjectAlpha(source,width,height,start,length,params,threshold,output);
    await rows.append(new Uint8Array(kernel.memory.buffer,output,length));progress({completed:count+start+length,total:count*3});
  }
  let selection=rows.finish();
  if(expandRadius&&selection.regions.length)selection=await modifySelectionCoverage(kernel,{selection,width,height,operation:'expand',radius:expandRadius},value=>progress({completed:count*2+count*value.completed/value.total,total:count*3}));
  progress({completed:count*3,total:count*3});return selection;
}
