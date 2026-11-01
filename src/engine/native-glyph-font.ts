import {normalizeFontRun,type FontRunInput,type OwnedFontRun} from '../fonts/shaping-types';
import {parseFontVariations,formatFontVariations} from '../core/font-variations';
import type {AssetStore} from '../core/assets';
import {yieldTask} from '../core/task-yield';
import {acquireFontWorkerSlot} from '../fonts/client';
import {validateGlyphSelectorSteps,type GlyphSelectorBytes} from '../fonts/glyph-sfnt';

export interface NativeGlyphFontControl {signal?:AbortSignal;timeoutMs?:number;check?:()=>void}
export interface NativeGlyphFont {
 readonly sourceFamily:string;readonly family:string;readonly glyphCount:number;readonly settings:string;readonly monochrome:boolean;
 shapeRun(input:FontRunInput,control?:NativeGlyphFontControl):Promise<OwnedFontRun>;
 character(glyphId:number):string;
 check():void;release():void;
}
let serial=0;
const nativeState=(face:FontFace)=>JSON.stringify(['family','style','weight','stretch','unicodeRange','status','ascentOverride','descentOverride','lineGapOverride','featureSettings','variationSettings','display','sizeAdjust'].map(key=>(face as unknown as Record<string,unknown>)[key]));
/** Private original-source shaping and glyph-ID access, without a new grant. */
export async function captureNativeGlyphFont(assets:AssetStore,id:string,settings='normal',control:NativeGlyphFontControl={}):Promise<NativeGlyphFont>{
 control={...control};const original=assets.captureLifetime();original();control.signal?.throwIfAborted();control.check?.();
 const timeout=control.timeoutMs??60000;if(!Number.isInteger(timeout)||timeout<=0||timeout>0x7fffffff)throw new Error('Invalid native glyph preparation time budget.');
 const lease=assets.fonts.retain(id),source=lease.resource,info=source.descriptor.report.faces[0],ranges=new Map(info.axes.map(axis=>[axis.tag,axis]));
 let released=false,worker:Worker|undefined,slot:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,selectors:Uint32Array|undefined;
 const abort=new AbortController(),faces:FontFace[]=[],states:string[]=[],family='CanoliGlyph_'+info.id+'_'+(++serial),set=globalThis.document?.fonts;
 const cancel=()=>abort.abort(control.signal?.reason??new Error('Native glyph preparation cancelled.'));
 const release=()=>{if(released)return;released=true;abort.abort(new Error('The native glyph font was released.'));worker?.terminate();worker=undefined;for(const face of faces)set?.delete(face);faces.length=0;states.length=0;selectors=undefined;lease.release();};
 const check=()=>{if(released)throw new Error('The native glyph font was released.');abort.signal.throwIfAborted();control.signal?.throwIfAborted();original();lease.check();control.check?.();if(released)throw new Error('The native glyph font was released.');abort.signal.throwIfAborted();control.signal?.throwIfAborted();lease.check();if(set&&globalThis.document?.fonts!==set)throw new Error('The native glyph font host changed.');if(faces.some((face,i)=>!set?.has(face)||face.status!=='loaded'||nativeState(face)!==states[i]))throw new Error('The native glyph font registration changed.');if(set&&[...set].filter(face=>face.family===family).some(face=>!faces.includes(face)))throw new Error('The native glyph font family changed.');};
 try{
  const axes=parseFontVariations(settings).flatMap(axis=>{const range=ranges.get(axis.tag);return range?[{tag:axis.tag,value:Math.max(range.min,Math.min(range.max,axis.value))}]:[];}),effective=formatFontVariations(axes);check();
  if(!set||typeof FontFace==='undefined'||typeof Worker==='undefined')throw new Error('Native glyph fonts require the browser font/worker host.');
  control.signal?.addEventListener('abort',cancel,{once:true});if(control.signal?.aborted)cancel();slot=await acquireFontWorkerSlot(abort.signal);check();timer=setTimeout(()=>abort.abort(new Error('Native glyph preparation exceeded its time budget.')),timeout);
  const guarded=<T>(promise:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{const stopped=()=>{abort.signal.removeEventListener('abort',stopped);reject(abort.signal.reason);};abort.signal.addEventListener('abort',stopped,{once:true});promise.then(value=>{abort.signal.removeEventListener('abort',stopped);resolve(value);},error=>{abort.signal.removeEventListener('abort',stopped);reject(error);});if(abort.signal.aborted)stopped();});
  const bytes=new Uint8Array(await guarded(source.renderBlob.arrayBuffer()));check();
  worker=new Worker(new URL('../generated/glyph-selector-worker.js',import.meta.url),{type:'module'});
  const result=await guarded(new Promise<GlyphSelectorBytes>((resolve,reject)=>{worker!.onmessage=event=>{const value=event.data;if(value?.error)reject(new Error(String(value.error)));else if(!value||Object.keys(value).some(key=>!['bytes','selectors','glyphCount'].includes(key)))reject(new Error('Invalid glyph font worker response.'));else resolve(value);};worker!.onerror=()=>reject(new Error('Native glyph font worker failed.'));worker!.onmessageerror=()=>reject(new Error('Invalid glyph font worker response.'));worker!.postMessage({bytes,timeoutMs:timeout});}));worker.terminate();worker=undefined;check();
  let deadline=performance.now()+2;for(const _ of validateGlyphSelectorSteps(bytes,result)){if(performance.now()>=deadline){await guarded(yieldTask());check();deadline=performance.now()+2;}void _;}check();if(result.glyphCount!==info.glyphCount)throw new Error('Native glyph count differs from its retained source.');selectors=result.selectors;
  for(const descriptor of info.descriptors){check();const face=new FontFace(family,Uint8Array.from(result.bytes).buffer,{...descriptor,variationSettings:effective});await guarded(face.load());check();if(face.status!=='loaded')throw new Error('Cannot load native glyph font.');faces.push(face);states.push(nativeState(face));set.add(face);check();}
  const colorTables=['COLR','CPAL','CBDT','CBLC','EBDT','EBLC','sbix','SVG '],v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tags=Array.from({length:v.getUint16(4)},(_,i)=>String.fromCharCode(...bytes.subarray(12+i*16,16+i*16))),monochrome=!tags.some(tag=>colorTables.includes(tag));
  check();return Object.freeze({sourceFamily:info.cssFamily,family,glyphCount:info.glyphCount,settings:effective,monochrome,async shapeRun(input:FontRunInput,requested:NativeGlyphFontControl={}){const run=normalizeFontRun(input),child={...requested};check();const {captureNativeFontRun}=await import('./native-font-shape');check();const signals=[abort.signal,...(control.signal?[control.signal]:[]),...(child.signal?[child.signal]:[])];return captureNativeFontRun(assets,id,run,effective,{...child,signal:AbortSignal.any(signals),check(){check();child.check?.();check();}});},character(glyphId:number){check();if(glyphId===0)throw new Error('Glyph zero requires missing-glyph paint integration.');if(!Number.isInteger(glyphId)||glyphId<1||glyphId>=info.glyphCount)throw new Error('Native glyph ID is outside its original font.');return String.fromCodePoint(selectors![glyphId]);},check,release});
 }catch(error){release();throw error;}
 finally{worker?.terminate();worker=undefined;if(timer)clearTimeout(timer);slot?.();control.signal?.removeEventListener('abort',cancel);}
}
