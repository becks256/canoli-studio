import {z} from 'zod';
import {AffineTransform} from '../core/affine';
import {characterFormatSchema,DEFAULT_CHARACTER_FORMAT} from '../core/character-format';
import {applyTextStyle} from '../core/text-style';
import {yieldTask} from '../core/task-yield';
import {captureNativeFontVariations} from '../fonts/variations';
import type {OwnedFontRun} from '../fonts/shaping-types';
import type {NativeGlyphFont,NativeGlyphFontControl} from './native-glyph-font';
import type {FloatGlyph} from './float-glyph';
import {createCanvas,release} from './canvas';

const inputSchema=z.object({
 text:z.string().max(10000),direction:z.enum(['ltr','rtl']).default('ltr'),
 script:z.string().regex(/^[A-Za-z]{4}$/).optional(),language:z.string().regex(/^[A-Za-z0-9-]{1,64}$/).default('und'),
 style:characterFormatSchema.pick({fontSize:true,fontWeight:true,fontStyle:true,fontStretch:true,fontKerning:true,fontVariantCaps:true,letterSpacing:true,wordSpacing:true}).partial().strict().default({}),
 transform:z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]).default([1,0,0,1,0,0]),
}).strict();
export type NativeGlyphRunInput=z.input<typeof inputSchema>;
export type NativeGlyphPlacement=Readonly<Omit<FloatGlyph,'color'>>;
export interface NativeGlyphMatchEvidence {
 readonly nativeAdvance:number;readonly shapedAdvance:number;readonly pixelsCompared:number;
 readonly maxAlphaError:number;readonly opacitySamples:readonly number[];
 readonly bounds:Readonly<{x:number;y:number;width:number;height:number}>;
}
export type NativeGlyphMatch=
 |Readonly<{status:'matched';run:OwnedFontRun;glyphs:readonly NativeGlyphPlacement[];evidence:Readonly<NativeGlyphMatchEvidence>}>
 |Readonly<{status:'mismatch'|'unavailable';reason:string;evidence?:Readonly<NativeGlyphMatchEvidence>}>;
const caps:Record<string,string[]>={'normal':[],'small-caps':['smcp'],'all-small-caps':['c2sc','smcp'],'petite-caps':['pcap'],'all-petite-caps':['c2pc','pcap'],'unicase':['unic'],'titling-caps':['titl']};
/** Compare one complete uniform Canvas shaping run. This neither itemizes native
 * bidi/font fallback nor proves SVG/path/vertical equivalence. No placements are
 * published when the complete native ink or advance differs. */
export async function matchNativeGlyphRun(font:NativeGlyphFont,input:NativeGlyphRunInput,control:NativeGlyphFontControl={}):Promise<NativeGlyphMatch>{
 const request=inputSchema.parse(input),options={...control},timeout=options.timeoutMs??60000;
 if(!Number.isInteger(timeout)||timeout<=0||timeout>0x7fffffff)throw new Error('Invalid native glyph matching time budget.');
 const started=performance.now(),current=()=>{options.signal?.throwIfAborted();font.check();options.check?.();options.signal?.throwIfAborted();font.check();if(performance.now()-started>=timeout)throw new Error('Native glyph matching exceeded its time budget.');};current();
 if(!font.monochrome)return Object.freeze({status:'unavailable',reason:'Intrinsic color glyph paint is not integrated.'});
 const style=Object.freeze(characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...request.style,fontFamily:font.sourceFamily,color:'#ffffff',fontVariationSettings:font.settings})),transform=Object.freeze(new AffineTransform(...request.transform));
 const variation=captureNativeFontVariations([style]),canvas=createCanvas(1,1,true),context=canvas.getContext('2d')!;
 const check=()=>{current();variation.check();};
 const native=(c:CanvasRenderingContext2D)=>{applyTextStyle(c,style);c.textAlign='left';c.textBaseline='alphabetic';c.direction=request.direction;c.fillStyle='#ffffff';};
 const glyph=(c:CanvasRenderingContext2D)=>{applyTextStyle(c,{...style,fontFamily:font.family,fontVariationSettings:'normal',fontKerning:'none',fontVariantCaps:'normal',letterSpacing:0,wordSpacing:0});c.textAlign='left';c.textBaseline='alphabetic';c.direction='ltr';c.fillStyle='#ffffff';};
 try{
  check();native(context);const reference=context.measureText(request.text),nativeAdvance=reference.width;
  const kerns=style.fontKerning==='auto'?[1,0]:[style.fontKerning==='none'?0:1];let last:NativeGlyphMatch|undefined;
  for(const kern of kerns){
   const features=[{tag:'kern',value:kern},...(caps[style.fontVariantCaps??'normal']??[]).map(tag=>({tag,value:1})),...(style.letterSpacing?[{tag:'liga',value:0},{tag:'clig',value:0}]:[])];
   check();const run=await font.shapeRun({text:request.text,direction:request.direction,script:request.script,language:request.language,features},{...options,timeoutMs:Math.max(1,Math.ceil(timeout-(performance.now()-started))),check});check();
   if(run.glyphs.some(g=>g.glyphId===0))return Object.freeze({status:'unavailable',reason:'The run requires missing-glyph or font-fallback painting.'});
   const scale=style.fontSize/run.unitsPerEm,placements:NativeGlyphPlacement[]=[],draws:{character:string;transform:AffineTransform;bounds:ReturnType<AffineTransform['bounds']>}[]=[],measures=new Map<number,{character:string;metrics:TextMetrics}>(),sorted=[...new Set(run.glyphs.map(g=>g.cluster))].sort((a,b)=>a-b),ends=new Map(sorted.map((start,i)=>[start,sorted[i+1]??request.text.length]));let penX=0,penY=0;
   let left=-reference.actualBoundingBoxLeft,top=-reference.actualBoundingBoxAscent,right=reference.actualBoundingBoxRight,bottom=reference.actualBoundingBoxDescent;
   glyph(context);
   let deadline=performance.now()+2;
   for(let i=0;i<run.glyphs.length;i++){
    const g=run.glyphs[i],x=penX+g.xOffset*scale,y=penY-g.yOffset*scale;
    let measured=measures.get(g.glyphId);if(!measured){const character=font.character(g.glyphId);measured={character,metrics:context.measureText(character)};measures.set(g.glyphId,measured);}const {character,metrics:m}=measured;
    left=Math.min(left,x-m.actualBoundingBoxLeft);top=Math.min(top,y-m.actualBoundingBoxAscent);right=Math.max(right,x+m.actualBoundingBoxRight);bottom=Math.max(bottom,y+m.actualBoundingBoxDescent);
    const pose=transform.multiply(AffineTransform.translation(x,y));placements.push(Object.freeze({font,glyphId:g.glyphId,style,transform:pose}));draws.push({character,transform:pose,bounds:pose.bounds({x:-m.actualBoundingBoxLeft,y:-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent})});penX+=g.xAdvance*scale;penY-=g.yAdvance*scale;
    if(run.glyphs[i+1]?.cluster!==g.cluster){const cluster=request.text.slice(g.cluster,ends.get(g.cluster));penX+=(style.letterSpacing??0)+[...cluster].filter(c=>c===' '||c==='\u00a0').length*(style.wordSpacing??0);}
    if((i&127)===0&&performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
   }
   if(![nativeAdvance,penX,penY,left,top,right,bottom].every(Number.isFinite))throw new Error('Native glyph matching geometry is nonfinite.');
   const box=transform.bounds({x:left,y:top,width:right-left,height:bottom-top}),x=Math.floor(box.x)-2,y=Math.floor(box.y)-2,width=Math.ceil(box.x+box.width)+2-x,height=Math.ceil(box.y+box.height)+2-y;
   if(![x,y,width,height].every(Number.isSafeInteger)||width<0||height<0)throw new Error('Native glyph matching geometry is outside safe pixel coordinates.');
   let maxAlphaError=0,pixelsCompared=0;const samples=[1,.5],evidence=()=>Object.freeze({nativeAdvance,shapedAdvance:penX,pixelsCompared,maxAlphaError,opacitySamples:Object.freeze([...samples]),bounds:Object.freeze({x,y,width,height})});
   const tolerance=run.glyphs.length*style.fontSize/(run.unitsPerEm*128)+Number.EPSILON*Math.max(1,Math.abs(penX))*16;
   if(Math.abs(penX-nativeAdvance)>tolerance||penY!==0){last=Object.freeze({status:'mismatch',reason:'The complete native advance differs from source-font shaping.',evidence:evidence()});continue;}
   const cell=256,gutter=2;
   for(let cy=Math.floor(y/cell)*cell;cy<y+height;cy+=cell)for(let cx=Math.floor(x/cell)*cell;cx<x+width;cx+=cell){
    check();const a=createCanvas(cell+2*gutter,cell+2*gutter,true),b=createCanvas(cell+2*gutter,cell+2*gutter,true);
    try{
     const ac=a.getContext('2d')!,bc=b.getContext('2d')!;
     for(const alpha of samples){
      ac.resetTransform();bc.resetTransform();ac.clearRect(0,0,a.width,a.height);bc.clearRect(0,0,b.width,b.height);native(ac);glyph(bc);ac.globalAlpha=alpha;bc.globalAlpha=alpha;
      ac.setTransform(transform.a,transform.b,transform.c,transform.d,transform.e-cx+gutter,transform.f-cy+gutter);ac.fillText(request.text,0,0);
      let visited=0;for(const p of draws){const r=p.bounds;if(r.width&&r.height&&r.x<cx+cell+gutter&&r.y<cy+cell+gutter&&r.x+r.width>cx-gutter&&r.y+r.height>cy-gutter){const m=p.transform;bc.setTransform(m.a,m.b,m.c,m.d,m.e-cx+gutter,m.f-cy+gutter);bc.fillText(p.character,0,0);}if((++visited&127)===0&&performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}}
      check();
      const av=ac.getImageData(gutter,gutter,cell,cell).data,bv=bc.getImageData(gutter,gutter,cell,cell).data;
      for(let i=3;i<av.length;i+=4)maxAlphaError=Math.max(maxAlphaError,Math.abs(av[i]-bv[i]));pixelsCompared+=cell*cell;
     }
    }finally{release(a);release(b);}
    await yieldTask();check();
   }
   if(maxAlphaError){last=Object.freeze({status:'mismatch',reason:'The complete native glyph paint differs from the shaped placements.',evidence:evidence()});continue;}
   check();return Object.freeze({status:'matched',run,glyphs:Object.freeze(placements),evidence:evidence()});
  }
  check();return last!;
 }finally{release(canvas);variation.release();}
}
