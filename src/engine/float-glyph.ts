import {AffineTransform} from '../core/affine';
import {characterFormatSchema,DEFAULT_CHARACTER_FORMAT,type CharacterFormat} from '../core/character-format';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {validateFloatAlpha} from '../core/float-shadow';
import {yieldTask} from '../core/task-yield';
import {applyTextStyle} from '../core/text-style';
import {createCanvas,release} from './canvas';
import {validateFloatWorkerWindow} from './float-pixels';
import type {NativeGlyphFont} from './native-glyph-font';
import type {LinearTextColor} from './float-text-color';
import type {PixelProcessor} from './processor';

/** A resolved paint primitive, not a text shaper or public mutation DTO. */
export interface FloatGlyph {
 readonly font:NativeGlyphFont;readonly glyphId:number;
 readonly surface?:'svg';
 readonly origin?:Readonly<{x:number;y:number}>;
 readonly paintFontSize?:number;
 readonly style:Pick<CharacterFormat,'fontSize'|'fontWeight'|'fontStyle'|'fontStretch'>;
 readonly transform:AffineTransform;readonly color:LinearTextColor;
}
export type FloatGlyphCoverage=(glyph:Readonly<FloatGlyph>,area:FloatSourceWindow,check:()=>void)=>Promise<Float32Array>;
function configure(context:CanvasRenderingContext2D,glyph:Readonly<FloatGlyph>){
 const style=characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...glyph.style,fontFamily:glyph.font.family,color:'#ffffff',letterSpacing:0,wordSpacing:0,fontKerning:'none',fontVariantCaps:'normal',fontVariationSettings:'normal'});
 applyTextStyle(context,{...style,fontSize:glyph.paintFontSize??style.fontSize});context.textAlign='left';context.textBaseline='alphabetic';context.direction='ltr';context.fillStyle='#ffffff';
}
/** Native font outlines/hints supply a single glyph's scalar antialias coverage.
 * Original source RGB and authored alpha never pass through Canvas pixels. */
export const renderFloatGlyphCoverage:FloatGlyphCoverage=async(glyph,input,check)=>{
 if(glyph.surface==='svg'){check();glyph.font.check();if(!glyph.font.monochrome)throw new Error('Float glyph paint requires intrinsic color-font integration.');const {renderFloatSvgGlyphCoverage}=await import('./svg-glyph-paint');check();return renderFloatSvgGlyphCoverage(glyph,input,check);}
 const area=validateWindow(input),output=new Float32Array(area.width*area.height),cell=256,gutter=2;check();glyph.font.check();if(!glyph.font.monochrome)throw new Error('Float glyph paint requires intrinsic color-font integration.');const character=glyph.font.character(glyph.glyphId);
 const measure=createCanvas(1,1,true);let bounds;const origin=glyph.origin??{x:0,y:0};
 try{const c=measure.getContext('2d')!;configure(c,glyph);const m=c.measureText(character),x=origin.x-m.actualBoundingBoxLeft,y=origin.y-m.actualBoundingBoxAscent,width=m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;if(![x,y,width,height].every(Number.isFinite)||width<0||height<0)throw new Error('Native glyph bounds are invalid.');if(!width||!height){check();glyph.font.check();return output;}bounds=glyph.transform.bounds({x,y,width,height});}finally{release(measure);}
 for(let y=Math.floor(area.y/cell)*cell;y<area.y+area.height;y+=cell)for(let x=Math.floor(area.x/cell)*cell;x<area.x+area.width;x+=cell){
  check();glyph.font.check();if(bounds.x>=x+cell+gutter||bounds.y>=y+cell+gutter||bounds.x+bounds.width<=x-gutter||bounds.y+bounds.height<=y-gutter)continue;
  const canvas=createCanvas(cell+2*gutter,cell+2*gutter,true);
  try{const c=canvas.getContext('2d')!,m=glyph.transform;configure(c,glyph);c.setTransform(m.a,m.b,m.c,m.d,m.e-x+gutter,m.f-y+gutter);c.fillText(character,origin.x,origin.y);check();glyph.font.check();const left=Math.max(x,area.x),top=Math.max(y,area.y),width=Math.min(x+cell,area.x+area.width)-left,height=Math.min(y+cell,area.y+area.height)-top,bytes=c.getImageData(left-x+gutter,top-y+gutter,width,height).data;for(let row=0;row<height;row++)for(let column=0;column<width;column++)output[(top-area.y+row)*area.width+left-area.x+column]=bytes[(row*width+column)*4+3]/255;}finally{release(canvas);}
  await yieldTask();check();glyph.font.check();
 }
 check();glyph.font.check();return output;
};
/** Ordered per-glyph native linear source-over; whole-text union alpha cannot
 * substitute for these independently owned paint primitives. */
export async function renderFloatGlyphs(input:readonly FloatGlyph[],window:FloatSourceWindow,processor:Pick<PixelProcessor,'floatComposite'>,check:()=>void,coverage:FloatGlyphCoverage=renderFloatGlyphCoverage):Promise<Float32Array>{
 const area=validateWindow({...window}),glyphs=input.map(glyph=>{const origin=glyph.origin?Object.freeze({...glyph.origin}):undefined;if(glyph.paintFontSize!==undefined&&(!Number.isFinite(glyph.paintFontSize)||glyph.paintFontSize<=0)||origin&&![origin.x,origin.y].every(Number.isFinite)||glyph.surface!==undefined&&glyph.surface!=='svg')throw new Error('Invalid native glyph paint placement.');const style=characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...glyph.style}),color=Array.from(glyph.color,Math.fround);if(color.length!==4||color.some(v=>!Number.isFinite(v))||color[3]<0||color[3]>1)throw new Error('Native glyph paint requires finite linear RGB and alpha in [0,1].');return Object.freeze({...glyph,...(origin?{origin}:{}),style:Object.freeze(style),color:Object.freeze(color)as unknown as LinearTextColor,transform:AffineTransform.fromJSON(glyph.transform)});});
 const fonts=[...new Set(glyphs.map(glyph=>glyph.font))];const current=()=>{check();for(const font of fonts)font.check();};current();for(const glyph of glyphs){glyph.font.character(glyph.glyphId);if(!glyph.font.monochrome)throw new Error('Float glyph paint requires intrinsic color-font integration.');}let output:Float32Array=new Float32Array(area.width*area.height*4);
 for(const glyph of glyphs){current();if(!glyph.color[3])continue;const mask=await coverage(glyph,area,current);current();validateFloatAlpha(mask,area.width*area.height);const source=new Float32Array(output.length);let deadline=performance.now()+2;
  for(let i=0;i<mask.length;i++){if(mask[i]){const p=i*4;source[p]=glyph.color[0];source[p+1]=glyph.color[1];source[p+2]=glyph.color[2];source[p+3]=glyph.color[3]*mask[i];}if((i&511)===0&&performance.now()>=deadline){current();await yieldTask();current();deadline=performance.now()+2;}}
  const next=await processor.floatComposite(source,output,{mode:'normal'});current();validateFloatWorkerWindow(next);if(next.length!==output.length)throw new Error('Native glyph composition returned the wrong geometry.');output=next;
 }
 current();return output;
}
