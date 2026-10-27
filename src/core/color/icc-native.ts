import createCanoliIcc,{type NativeIccModule}from './codec/canoli_icc.js';

export *from './icc-types';
import {iccIntents,iccTransformOptionsSchema,nativeIccReportSchema,type IccTransformOptions,type NativeIccReport,type IccPreparation}from './icc-types';
import {iccRgbOptionsSchema,iccSampleFormats,validateIccSamples,type IccRgbOptions,type IccRgbPreparation,type IccSamples}from './icc-types';
const signature=(value:number)=>String.fromCharCode(value>>>24,(value>>>16)&255,(value>>>8)&255,value&255);

/** Inert native boundary. Only a private worker/Node caller owns this module.
 * Callers provide complete profile bytes; transforms own their compiled tables.
 * Every returned report/pixel window owns its bytes, never an Emscripten view.
 */
export class NativeIccEngine{
 private closed=false;
 private ready=false;
 private rgb?:IccRgbPreparation['settings'];
 private constructor(private readonly module:NativeIccModule){if(module._canoli_icc_version()!==2190)throw new Error('Unexpected native ICC engine version.');}
 static async create(wasmBinary?:Uint8Array):Promise<NativeIccEngine>{
  const module=await createCanoliIcc({wasmBinary,locateFile:()=>new URL('./codec/canoli_icc.wasm',import.meta.url).href});return new NativeIccEngine(module);
 }
 private active(){if(this.closed)throw new Error('ICC engine is closed.');}
 private text(pointer:number,max=2048):string{
  const heap=this.module.HEAPU8;if(!Number.isSafeInteger(pointer)||pointer<=0||pointer>=heap.length)throw new Error('Invalid native ICC text pointer.');
  const end=Math.min(heap.length,pointer+max);let at=pointer;while(at<end&&heap[at])at++;
  if(at===end)throw new Error('Unterminated native ICC text.');return new TextDecoder().decode(heap.subarray(pointer,at));
 }
 private error():never{throw new Error(this.text(this.module._canoli_icc_error(),1024)||'Native ICC operation failed.');}
 private upload(bytes:Uint8Array,run:(pointer:number)=>number):NativeIccReport{
  this.active();this.ready=false;this.rgb=undefined;this.module._canoli_icc_close();
  if(!(bytes instanceof Uint8Array)||bytes.length<132||bytes.length>0xffffffff)throw new Error('A complete ICC profile is required.');
  const pointer=this.module._malloc(bytes.length)>>>0;if(!pointer)throw new Error('ICC source allocation failed.');
  try{this.module.HEAPU8.set(bytes,pointer);if(!run(pointer))this.error();return this.report();}
  finally{this.module._free(pointer);}
 }
 private report():NativeIccReport{
  const p=this.module._canoli_icc_info(),heap=this.module.HEAPU8;
  if(!Number.isSafeInteger(p)||p<=0||p+32>heap.length)throw new Error('Invalid native ICC report pointer.');
  const v=new DataView(heap.buffer,p,32),words=Array.from({length:8},(_,i)=>v.getUint32(i*4,true)),version=words[0],intents=(mask:number)=>iccIntents.filter((_,i)=>mask&(1<<i));
  return nativeIccReportSchema.parse({version:1,engine:'Little CMS 2.19.1',nativeVersion:this.module._canoli_icc_version(),profileVersion:`${version>>>24}.${(version>>>20)&15}.${(version>>>16)&15}`,deviceClass:signature(words[1]),colorSpace:signature(words[2]),connectionSpace:signature(words[3]),channels:words[4],description:this.text(this.module._canoli_icc_text(0)),copyright:this.text(this.module._canoli_icc_text(1)),manufacturer:this.text(this.module._canoli_icc_text(2)),model:this.text(this.module._canoli_icc_text(3)),inputIntents:intents(words[5]),outputIntents:intents(words[6]),proofIntents:intents(words[7])});
 }
 inspect(bytes:Uint8Array):NativeIccReport{return this.upload(bytes,p=>this.module._canoli_icc_inspect(p,bytes.length));}
 begin(bytes:Uint8Array,value:IccTransformOptions):IccPreparation{
  this.active();this.ready=false;this.rgb=undefined;this.module._canoli_icc_close();
  const options=iccTransformOptionsSchema.parse(value),proof=options.mode==='proof';
  const report=this.upload(bytes,p=>this.module._canoli_icc_begin(p,bytes.length,proof?1:0,iccIntents.indexOf(options.intent),proof?iccIntents.indexOf(options.proofIntent):0,Number(options.blackPointCompensation),Number(proof&&options.gamutWarning),proof?parseInt(options.warningColor.slice(1),16):0));
  const usesIntentFallback=proof?!report.proofIntents.includes(options.proofIntent):!report.outputIntents.includes(options.intent);
  this.ready=true;return{profile:report,settings:options,usesIntentFallback,warnings:usesIntentFallback?['The profile does not declare every requested intent table; Little CMS applies its supported fallback.']:[]};
 }
 apply(pixels:Uint8Array|Uint8ClampedArray):Uint8ClampedArray<ArrayBuffer>{
  this.active();if(!this.ready)throw new Error('Prepare an ICC transform before converting pixels.');
  if(this.rgb)throw new Error('Use applyWindow for an explicit RGB sample transform.');
  if(!(pixels instanceof Uint8Array||pixels instanceof Uint8ClampedArray)||!pixels.length||pixels.length%4||pixels.length>0x7fffffff)throw new Error('ICC conversion requires a complete nonempty RGBA8 pixel window.');
  let input=0,output=0;
  try{
   input=this.module._malloc(pixels.length)>>>0;if(!input)throw new Error('ICC input window allocation failed.');
   output=this.module._malloc(pixels.length)>>>0;if(!output)throw new Error('ICC output window allocation failed.');
   this.module.HEAPU8.set(pixels,input);if(!this.module._canoli_icc_apply(input,output,pixels.length/4))this.error();
   return new Uint8ClampedArray(this.module.HEAPU8.subarray(output,output+pixels.length));
  }finally{if(input)this.module._free(input);if(output)this.module._free(output);}
 }
 beginRgb(source:Uint8Array,destination:Uint8Array,value:IccRgbOptions={}):IccRgbPreparation{
  this.active();this.ready=false;this.rgb=undefined;this.module._canoli_icc_close();
  const settings=iccRgbOptionsSchema.parse(value);
  const from=this.inspect(source),to=this.inspect(destination);
  let input=0,output=0;
  try{
   input=this.module._malloc(source.length)>>>0;if(!input)throw new Error('ICC source allocation failed.');
   output=this.module._malloc(destination.length)>>>0;if(!output)throw new Error('ICC destination allocation failed.');
   this.module.HEAPU8.set(source,input);this.module.HEAPU8.set(destination,output);
   if(!this.module._canoli_icc_begin_rgb(input,source.length,output,destination.length,iccSampleFormats.indexOf(settings.inputFormat),iccSampleFormats.indexOf(settings.outputFormat),iccIntents.indexOf(settings.intent),Number(settings.blackPointCompensation)))this.error();
   const usesIntentFallback=!from.inputIntents.includes(settings.intent)||!to.outputIntents.includes(settings.intent);
   this.rgb={...settings};this.ready=true;
   return{source:from,destination:to,settings,usesIntentFallback,warnings:usesIntentFallback?['The input or output profile does not declare the requested intent table; Little CMS applies its supported fallback.']:[]};
  }catch(error){this.module._canoli_icc_close();throw error;}
  finally{if(input)this.module._free(input);if(output)this.module._free(output);}
 }
 applyWindow(samples:IccSamples):IccSamples{
  this.active();if(!this.ready||!this.rgb)throw new Error('Prepare an explicit RGB transform before converting sample windows.');
  validateIccSamples(samples,this.rgb.inputFormat);
  if(new Uint8Array(new Uint16Array([1]).buffer)[0]!==1)throw new Error('ICC native sample windows require a little-endian host.');
  const format=this.rgb.outputFormat,bytes=samples.length*(format==='rgba8'?1:format==='rgba16'?2:4);
  if(bytes>0x7fffffff)throw new Error('ICC output window exceeds native pointer representation.');
  let input=0,output=0;
  try{
   input=this.module._malloc(samples.byteLength)>>>0;if(!input)throw new Error('ICC input window allocation failed.');
   output=this.module._malloc(bytes)>>>0;if(!output)throw new Error('ICC output window allocation failed.');
   this.module.HEAPU8.set(new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength),input);
   if(!this.module._canoli_icc_apply_window(input,output,samples.length/4))this.error();
   const owned=this.module.HEAPU8.slice(output,output+bytes).buffer;
   return format==='rgba8'?new Uint8ClampedArray(owned):format==='rgba16'?new Uint16Array(owned):new Float32Array(owned);
  }finally{if(input)this.module._free(input);if(output)this.module._free(output);}
 }
 dispose(){if(this.closed)return;this.closed=true;this.ready=false;this.module._canoli_icc_close();}
}
