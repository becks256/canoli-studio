import {rawDevelopOptionsSchema,rawImportReportSchema,type RawDevelopOptions,type RawImportReport} from './types';
import type {NativeRawModule} from './codec/canoli_raw_decoder.js';

export interface OwnedRawImage {
  readonly report:Readonly<RawImportReport>;
  readonly width:number;readonly height:number;readonly channels:1|3;
  /** An owned copy of a full-width row interval; no borrowed WASM views escape. */
  readRows(top:number,rows:number):Uint16Array;
  readRegion?(left:number,top:number,width:number,height:number):Uint16Array;
  dispose():void;
}
const qualities={linear:0,vng:1,ppg:2,ahd:3,dcb:4,dht:11,aahd:12};
const whiteBalances={camera:0,auto:1,daylight:2,custom:3};

/** Private native instance with one explicit output lease. */
export function rawDecoder(module:NativeRawModule){
  let active=false;
  const text=(pointer:number,limit=256)=>{
    pointer>>>=0;const heap=module.HEAPU8;
    if(!pointer||pointer>=heap.length)throw new Error('Invalid RAW native string pointer.');
    const bytes=heap.subarray(pointer,Math.min(pointer+limit,heap.length)),end=bytes.indexOf(0);
    if(end<0)throw new Error('Invalid RAW native string extent.');
    return new TextDecoder().decode(bytes.subarray(0,end)).replace(/[\u0000-\u001f\u007f]/g,' ');
  };
  function run(bytes:Uint8Array,mode:0|1,options:RawDevelopOptions){
    if(active)throw new Error('Dispose the previous RAW image before reusing its decoder.');
    const settings=rawDevelopOptionsSchema.parse(options);let input=0,retained=false;active=true;
    try{
      if(!bytes.length||bytes.length>0xffffffff)throw new Error('RAW source cannot be represented in the native WASM address space.');
      input=module._malloc(bytes.length)>>>0;
      if(!input||input+bytes.length>module.HEAPU8.length)throw new Error('RAW source allocation failed.');
      module.HEAPU8.set(bytes,input);
      const status=module._canoli_raw_process(input,bytes.length,mode,settings.image,whiteBalances[settings.whiteBalance],qualities[settings.demosaic],settings.highlights,settings.exposure,settings.highlightPreservation,settings.multipliers.red,settings.multipliers.green,settings.multipliers.blue);
      if(status!==0)throw new Error(text(module._canoli_raw_error(),1024)||`RAW native processing failed (${status}).`);
      const heap=module.HEAPU8,pointer=module._canoli_raw_info()>>>0;
      if(!pointer||pointer%4||pointer+128>heap.length)throw new Error('Invalid RAW native information extent.');
      const info=new Uint32Array(heap.buffer,pointer,32).slice();
      if(info[0]!==1||info[19]>1||info[20]>1||info[13]>1||info[25]>1||info[18]!==mode)throw new Error('Invalid RAW native protocol.');
      const unsupported:string[]=[];
      if(!info[20])unsupported.push('Camera color calibration is unavailable; uncalibrated channels cannot be identified as sRGB.');
      if(info[25])unsupported.push('RAW extra sample channels require a preserved-coverage development pipeline.');
      if(info[1]*info[2]*8>0x7fffffff||info[5]*info[6]*8>0x7fffffff)unsupported.push('RAW geometry exceeds the native pointer-difference representation.');
      const warnings=['Native development uses full-frame sensor/processing memory. Working-output conversion is separate from retained RAW precision.'];
      if(!info[19]&&info[11]>1)warnings.push('Camera-recorded white balance is unavailable. Choose Auto, Daylight or Custom.');
      if(info[14])warnings.push(`The native decoder reported processing warning bits ${info[14]}.`);
      const report=rawImportReportSchema.parse({version:1,nativeVersion:text(module._canoli_raw_text(3)),make:text(module._canoli_raw_text(0)),model:text(module._canoli_raw_text(1)),decoder:text(module._canoli_raw_text(2)),cfaDescription:text(module._canoli_raw_text(4)),
        rawWidth:info[1],rawHeight:info[2],width:info[3],height:info[4],displayWidth:info[5],displayHeight:info[6],flip:info[7],imageCount:info[8],image:info[9],filters:info[10],channels:info[11],dngVersion:info[12],foveon:!!info[13],nativeWarnings:info[14],
        hasCameraWhiteBalance:!!info[19],hasColorMatrix:!!info[20],hasExtraSamples:!!info[25],bitDepth:info[21]||null,whiteLevel:info[22],blackLevel:info[23],canDevelop:unsupported.length===0,unsupported,warnings});
      Object.freeze(report.unsupported);Object.freeze(report.warnings);Object.freeze(report);
      if(mode===0)return{report};
      const pixels=module._canoli_raw_pixels()>>>0,width=report.displayWidth,height=report.displayHeight,channels=info[17],length=width*height*channels*2;
      if(!pixels||pixels%2||info[16]!==16||![1,3].includes(channels)||length!==info[15]||pixels+length>heap.length||!Number.isSafeInteger(length)||!report.canDevelop)throw new Error('Invalid RAW native linear pixel result.');
      active=retained=true;let closed=false;
      const image:OwnedRawImage={report,width,height,channels:channels as 1|3,
        readRows(top,rows){
          if(closed)throw new Error('The RAW image is disposed.');
          if(!Number.isSafeInteger(top)||!Number.isSafeInteger(rows)||top<0||rows<1||top+rows>height)throw new Error('Invalid RAW row interval.');
          const current=module.HEAPU8,start=pixels+top*width*channels*2,count=rows*width*channels;
          if(start+count*2>current.length)throw new Error('RAW output lifetime changed.');
          return new Uint16Array(current.buffer,start,count).slice();
        },
        readRegion(left,top,w,h){
          if(closed)throw new Error('The RAW image is disposed.');
          if(![left,top,w,h].every(Number.isSafeInteger)||left<0||top<0||w<1||h<1||left+w>width||top+h>height)throw new Error('Invalid RAW region.');
          const current=module.HEAPU8,result=new Uint16Array(w*h*channels);
          for(let y=0;y<h;y++){
            const start=pixels+((top+y)*width+left)*channels*2,count=w*channels;
            if(start+count*2>current.length)throw new Error('RAW output lifetime changed.');
            result.set(new Uint16Array(current.buffer,start,count),y*count);
          }
          return result;
        },
        dispose(){if(closed)return;closed=true;active=false;module._canoli_raw_release();},
      };
      return{report,image:Object.freeze(image)};
    }finally{
      try{if(!retained){active=false;module._canoli_raw_release();}}finally{if(input)module._free(input);}
    }
  }
  return{inspect:(bytes:Uint8Array,image=0)=>run(bytes,0,{image}).report,develop:(bytes:Uint8Array,options:RawDevelopOptions={})=>run(bytes,1,options).image!};
}
