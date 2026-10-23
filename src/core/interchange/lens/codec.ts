import {freeze} from '../../immutable';
import {lensProfileSelectionSchema,type LensProfileSelectionOptions} from './schema';
import type {NativeLensModule} from './codec/canoli_lens_correction.js';

export interface LensFrame {width:number;height:number;flip?:number}
const distortionModels={none:0,poly3:1,poly5:2,ptlens:3},chromaticModels={none:0,linear:1,poly3:2};
export function lensCorrectionCodec(module:NativeLensModule){
  let active=false,generation=0;
  const error=()=>{
    const pointer=module._canoli_lens_error()>>>0,heap=module.HEAPU8;
    if(!pointer||pointer>=heap.length)return 'Invalid lens correction error result.';
    const bytes=heap.subarray(pointer,Math.min(pointer+1024,heap.length)),end=bytes.indexOf(0);
    return end<0?'Invalid lens correction error extent.':new TextDecoder().decode(bytes.subarray(0,end))||'Native lens correction failed.';
  };
  const status=(value:number)=>{if(value!==0)throw new Error(error());};
  function copy(pointer:number,count:number){
    pointer>>>=0;const heap=module.HEAPU8;
    if(!pointer||pointer%4||!Number.isSafeInteger(count)||count<1||pointer+count*4>heap.length)throw new Error('Invalid lens correction native extent.');
    return new Float32Array(heap.buffer,pointer,count).slice();
  }
  return {prepare(input:LensProfileSelectionOptions,frame:LensFrame,scale=1){
    if(active)throw new Error('Dispose the previous lens correction before reusing its module.');
    const selection=lensProfileSelectionSchema.parse(input),{width,height}=frame,flip=frame.flip??0;
    if(![width,height,flip].every(Number.isSafeInteger)||width<1||height<1||width>0x7fffffff||height>0x7fffffff||flip<0||flip>7||!Number.isFinite(scale)||scale<.1||scale>10)throw new Error('Invalid lens correction frame or scale.');
    active=true;const token=++generation;let retained=false;const pointers:number[]=[];
    const allocation=(bytes:Uint8Array)=>{
      const pointer=module._malloc(Math.max(1,bytes.byteLength))>>>0;pointers.push(pointer);
      if(!pointer||pointer+bytes.byteLength>module.HEAPU8.length)throw new Error('Lens correction input allocation failed.');
      module.HEAPU8.set(bytes,pointer);return pointer;
    };
    try{
      const profile=selection.definition,first=profile.calibrations.find(set=>[...set.distortion,...set.chromatic,...set.vignette].some(point=>point.model!=='none'))??profile.calibrations[0],maker=new TextEncoder().encode(profile.maker),model=new TextEncoder().encode(profile.model);
      let x=profile.center.x*(flip&1?-1:1),y=profile.center.y*(flip&2?-1:1);if(flip&4)[x,y]=[y,x];
      status(module._canoli_lens_create(allocation(maker),maker.length,allocation(model),model.length,first.cropFactor,first.aspectRatio,x,y,profile.focalRange.min,profile.focalRange.max));
      for(const set of profile.calibrations)for(const kind of ['distortion','chromatic','vignette']as const)for(const point of set[kind]){
        const terms=Float32Array.from(point.terms),pointer=allocation(new Uint8Array(terms.buffer));
        try{status(module._canoli_lens_add(kind==='distortion'?1:kind==='chromatic'?2:3,kind==='distortion'?distortionModels[point.model as keyof typeof distortionModels]:kind==='chromatic'?chromaticModels[point.model as keyof typeof chromaticModels]:1,point.focalLength,'aperture'in point?point.aperture:0,'focusDistance'in point?point.focusDistance:0,'realFocalLength'in point?point.realFocalLength??0:0,set.cropFactor,set.aspectRatio,pointer,terms.length));}
        finally{module._free(pointer);pointers.pop();}
      }
      const requested=(selection.distortion?8:0)|(selection.chromatic?1:0)|(selection.vignette?2:0);
      status(module._canoli_lens_initialize(selection.focalLength,selection.cropFactor,width,height,selection.aperture??0,selection.focusDistance??0,scale,requested));
      const pointer=module._canoli_lens_info()>>>0,heap=module.HEAPU8;
      if(!pointer||pointer%4||pointer+32>heap.length)throw new Error('Invalid lens correction information extent.');
      const info=new Uint32Array(heap.buffer,pointer,8).slice(),coefficients=copy(module._canoli_lens_coefficients(),32);
      const expected=(selection.distortion&&coefficients.slice(0,5).some(n=>n!==0)?8:0)|(selection.chromatic&&(coefficients[9]!==1||coefficients[10]!==1||coefficients.slice(11,21).some(n=>n!==0))?1:0)|(selection.vignette&&coefficients.slice(23,26).some(n=>n!==0)?2:0)|(Math.fround(scale)!==1?32:0);
      if(info[0]!==1||info[1]!==width||info[2]!==height||info[3]!==requested||info[4]!==expected||(selection.distortion?info[5]<1||info[5]>3:info[5]!==0)||(selection.chromatic?info[6]<1||info[6]>2:info[6]!==0)||(selection.vignette?info[7]!==1:info[7]!==0)||coefficients.some(value=>!Number.isFinite(value)))throw new Error('Invalid lens correction native result.');
      const report=freeze({version:1 as const,width,height,requested,applied:info[4],distortionModel:info[5],chromaticModel:info[6],vignetteModel:info[7],coefficients:Array.from(coefficients)});
      let closed=false;retained=true;
      const check=()=>{if(closed||!active||generation!==token)throw new Error('The lens correction is disposed.');};
      const region=(x:number,y:number,w:number,h:number,channels:number)=>{
        check();if(![x,y,w,h].every(Number.isSafeInteger)||x<0||y<0||w<1||h<1||x+w>width||y+h>height||w*h*channels>1000000)throw new Error('Invalid lens correction region or scratch budget.');
        status(channels===6?module._canoli_lens_coordinates(x,y,w,h):module._canoli_lens_gains(x,y,w,h));check();const data=copy(module._canoli_lens_data(),w*h*channels);
        if(data.some(value=>!Number.isFinite(value)||channels===1&&value<=0))throw new Error('Invalid lens correction coordinate or gain.');return data;
      };
      return Object.freeze({report,coordinates:(x:number,y:number,w:number,h:number)=>region(x,y,w,h,6),gains:(x:number,y:number,w:number,h:number)=>region(x,y,w,h,1),dispose(){if(closed)return;closed=true;if(generation===token){active=false;module._canoli_lens_release();}}});
    }finally{for(const pointer of pointers)if(pointer)module._free(pointer);if(!retained){active=false;module._canoli_lens_release();}}
  }};
}
export type OwnedLensCorrection=ReturnType<ReturnType<typeof lensCorrectionCodec>['prepare']>;
