import {characterFormatSchema,DEFAULT_CHARACTER_FORMAT,type CharacterFormat} from '../core/character-format';
import {applyTextStyle} from '../core/text-style';
import {yieldTask} from '../core/task-yield';
import type {AssetStore} from '../core/assets';
import type {FontRunCss} from '../fonts/css-instance';
import type {NativeGlyphFontControl} from './native-glyph-font';
import {captureNativeFontRun} from './native-font-shape';
import {captureNativeTextSize} from './native-text-size';
import {createCanvas,release} from './canvas';

export type NativeSvgMetricsStyle=Pick<CharacterFormat,'fontSize'|'fontWeight'|'fontStyle'|'fontStretch'>;
export interface NativeSvgMetrics {readonly em:number;readonly glyphs:readonly Readonly<{id:number;nominal:number;advance:number}>[]}
/** Independent native nominal advances at the renderer's screen-font size.
 * Original HarfBuzz nominal metrics separate source GPOS from native advances;
 * neither requested artwork positions nor verification pixels fit this data. */
export async function captureNativeSvgMetrics(assets:AssetStore,id:string,bytes:Uint8Array,family:string,settings:string,ids:readonly number[],characters:readonly string[],style:NativeSvgMetricsStyle,css:FontRunCss,computedSize:number,control:NativeGlyphFontControl):Promise<NativeSvgMetrics>{
 const request=characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...style,fontFamily:family,fontKerning:'none',fontVariantCaps:'normal',letterSpacing:0,wordSpacing:0,fontVariationSettings:'normal'}),glyphs=[...ids],text=[...characters],options={...control},started=performance.now(),timeout=options.timeoutMs??60000,check=()=>{options.signal?.throwIfAborted();options.check?.();options.signal?.throwIfAborted();if(performance.now()-started>=timeout)throw new Error('Native SVG metrics exceeded their time budget.');};check();
 if(!Number.isFinite(computedSize)||computedSize<=0||glyphs.length!==text.length)throw new Error('Invalid native SVG metrics request.');
 const canvas=createCanvas(1,1),rows:{id:number;nominal:number;advance:number}[]=[];
 try{const c=canvas.getContext('2d')!;applyTextStyle(c,{...request,fontSize:computedSize});const em=await captureNativeTextSize(computedSize,{...options,timeoutMs:Math.max(1,Math.ceil(timeout-(performance.now()-started))),check});
  for(let start=0;start<glyphs.length;start+=5000){check();const names=text.slice(start,start+5000),source=await captureNativeFontRun(assets,id,{text:names.join(''),nominal:true,css},settings,{...options,timeoutMs:Math.max(1,Math.ceil(timeout-(performance.now()-started))),check},bytes);check();if(source.glyphs.length!==names.length||source.glyphs.some((g,i)=>g.glyphId!==glyphs[start+i]))throw new Error('Native SVG nominal metrics differ from original glyph IDs.');
   let deadline=performance.now()+2;for(let i=0;i<names.length;i++){rows.push({id:glyphs[start+i],nominal:source.glyphs[i].xAdvance,advance:c.measureText(names[i]).width});if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}}
  }check();if(rows.some(r=>![r.nominal,r.advance].every(Number.isFinite)))throw new Error('Invalid native SVG glyph advances.');return Object.freeze({em,glyphs:Object.freeze(rows.map(r=>Object.freeze(r)))});
 }finally{release(canvas);}
}
