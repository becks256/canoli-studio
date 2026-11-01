import {positionNativeSvgPathGlyphs} from './native-svg-path';
import {AffineTransform} from '../core/affine';
import {fontFamilyNames} from '../core/font-families';
import {parseFontVariations} from '../core/font-variations';
import {verticalWriting} from '../core/text-writing';
import {applyTextStyle} from '../core/text-style';
import {yieldTask} from '../core/task-yield';
import {captureNativeFontVariations} from '../fonts/variations';
import {captureNativeFontInstance} from './native-font-instance';
import {captureSvgGlyphDocument,measureSvgGlyphBounds,renderSvgCellAlpha} from './svg-glyph-paint';
import {createCanvas,release} from './canvas';
import type {StyledTextPlan} from './styled-text';
import type {NativeGlyphFont,NativeGlyphFontControl} from './native-glyph-font';
import type {OwnedFontRun} from '../fonts/shaping-types';
import type {FloatGlyph} from './float-glyph';

export interface NativeSvgGlyphEvidence {
 readonly projection:'matrix'|'origin'|'path'|'screen';
 readonly svgAdvance:number;readonly svgPixelsCompared:number;readonly svgMaxAlphaError:number;
 readonly hiddenGlyphs:number;readonly sourceGlyphs:number;readonly sourceClusters:number;readonly opacitySamples:readonly number[];
 readonly bounds:Readonly<{x:number;y:number;width:number;height:number}>;
}
export type NativeSvgGlyphMatch=
 |Readonly<{status:'matched';run:OwnedFontRun;glyphs:readonly Readonly<FloatGlyph>[];evidence:Readonly<NativeSvgGlyphEvidence>}>
 |Readonly<{status:'mismatch'|'unavailable';reason:string;evidence?:Readonly<NativeSvgGlyphEvidence>}>;
const caps:Record<string,string[]>={'normal':[],'small-caps':['smcp'],'all-small-caps':['c2sc','smcp'],'petite-caps':['pcap'],'all-petite-caps':['c2pc','pcap'],'unicase':['unic'],'titling-caps':['titl']};

/** Keep the whole captured native chunk. HarfBuzz supplies original glyph IDs
 * and within-cluster positioning; native SVG metadata supplies each cluster's
 * actual baseline/anchor. Addressable characters alone never identify a glyph.
 * A complete native SVG ink comparison guards every published placement. */
export async function matchNativeSvgGlyphLine(plan:StyledTextPlan,font:NativeGlyphFont,index:number,control:NativeGlyphFontControl={}):Promise<NativeSvgGlyphMatch>{
 const options={...control,signal:AbortSignal.any([...(control.signal?[control.signal]:[]),...(font.signal?[font.signal]:[])])},timeout=options.timeoutMs??60000;if(!Number.isInteger(index)||index<0||index>=plan.scene.lines.length)throw new Error('Native SVG line index is outside its captured source.');if(!Number.isInteger(timeout)||timeout<=0||timeout>0x7fffffff)throw new Error('Invalid native SVG matching time budget.');
 const started=performance.now(),check=()=>{options.signal?.throwIfAborted();plan.check();font.check();options.check?.();options.signal?.throwIfAborted();plan.check();font.check();if(performance.now()-started>=timeout)throw new Error('Native SVG glyph matching exceeded its time budget.');},remaining=()=>Math.max(1,Math.ceil(timeout-(performance.now()-started)));check();
 const line=plan.scene.lines[index],characters=plan.paint?.characters[index];if(verticalWriting(line.writing)||line.spans.length!==1||!characters)return Object.freeze({status:'unavailable',reason:'This SVG line requires captured native paint geometry and uniform horizontal glyph decomposition.'});
 const span=line.spans[0],style=span.style,names=fontFamilyNames(style.fontFamily),ranges=new Map(font.axes.map(a=>[a.tag,a])),tuple=(s:string)=>JSON.stringify(parseFontVariations(s).filter(a=>ranges.has(a.tag)).map(a=>[a.tag,Math.max(ranges.get(a.tag)!.min,Math.min(ranges.get(a.tag)!.max,a.value))]).sort(([a],[b])=>String(a).localeCompare(String(b))));
 if(!font.monochrome||!font.svgFont||names.length!==1||names[0]!==font.sourceFamily.toLowerCase()||tuple(style.fontVariationSettings??'normal')!==tuple(font.settings))return Object.freeze({status:'unavailable',reason:'The glyph font differs from the captured monochrome SVG source instance.'});
 if(characters.length!==span.text.length||!line.path&&characters.some(c=>c.rotation!==0))return Object.freeze({status:'unavailable',reason:'Native SVG character addressing requires additional source mapping.'});
 const world=new AffineTransform(...plan.scene.transform as[number,number,number,number,number,number]),parsed=new DOMParser().parseFromString(plan.markup,'image/svg+xml'),root=parsed.documentElement,texts=[...root.querySelectorAll('text')];if(root.localName!=='svg'||texts.length!==plan.scene.lines.length)throw new Error('Captured native SVG structure differs from its source.');for(let i=0;i<texts.length;i++)if(i!==index)texts[i].remove();
 const variation=captureNativeFontVariations([style]),measure=createCanvas(1,1);let last:NativeSvgGlyphMatch|undefined;
 try{
  const c=measure.getContext('2d')!;applyTextStyle(c,style);const css=captureNativeFontInstance(c,style.fontWeight,font.descriptors,style.fontSize),axes=font.axes.filter(a=>a.tag==='ital'||a.tag==='slnt').map(a=>a.tag as 'ital'|'slnt'),modes=axes.length?[...axes.map(styleAxis=>({...css,styleAxis})),{...css,styleAxis:'none'as const}]:[css],kerns=style.fontKerning==='auto'?[1,0]:[style.fontKerning==='none'?0:1];
  for(const kern of kerns)for(const mode of modes){
   check();variation.check();const features=[{tag:'kern',value:kern},...(caps[style.fontVariantCaps??'normal']??[]).map(tag=>({tag,value:1})),...(style.letterSpacing?[{tag:'liga',value:0},{tag:'clig',value:0}]:[])],run=await font.shapeRun({text:span.text,direction:line.direction,features,css:mode},{...options,timeoutMs:remaining(),check});check();
   if(run.glyphs.some(g=>g.glyphId===0))return Object.freeze({status:'unavailable',reason:'The SVG line requires missing-glyph or font-fallback painting.'});
   const color=plan.paint!.colors[index][0],glyphs:Readonly<FloatGlyph>[]=[],scale=style.fontSize/run.unitsPerEm,clusters=[...new Set(run.glyphs.map(g=>g.cluster))].sort((a,b)=>a-b),ends=new Map(clusters.map((c,i)=>[c,clusters[i+1]??span.text.length]));let penX=0,penY=0,cluster=-1,originX=0,originY=0,deadline=performance.now()+2;
   for(const g of run.glyphs){if(g.cluster!==cluster){cluster=g.cluster;originX=penX;originY=penY;}const geometry=characters[g.cluster];if(line.path&&characters.slice(g.cluster,ends.get(g.cluster)).every(c=>c.start.x===0&&c.start.y===0&&c.end.x===0&&c.end.y===0&&c.extent.width===0&&c.extent.height===0)){penX+=g.xAdvance;penY+=g.yAdvance;continue;}const angle=geometry.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),anchor=line.direction==='rtl'?characters.slice(g.cluster,ends.get(g.cluster)).flatMap(c=>[c.start,c.end]).reduce((a,b)=>a.x*cos+a.y*sin<=b.x*cos+b.y*sin?a:b):geometry.start,dx=(penX-originX+g.xOffset)*scale,dy=-(penY-originY+g.yOffset)*scale,x=anchor.x+cos*dx-sin*dy,y=anchor.y+sin*dx+cos*dy,transform=line.path?world.multiply(AffineTransform.translation(line.x,line.y)):world;glyphs.push(Object.freeze({font,glyphId:g.glyphId,style,surface:'svg',color,transform,origin:Object.freeze({x,y}),...(line.path?{rotation:geometry.rotation}:{})}));penX+=g.xAdvance;penY+=g.yAdvance;if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}}
   for(const projection of ['matrix','origin','path','screen']as const){
   let paints:readonly Readonly<FloatGlyph>[]=glyphs;
   if(projection==='matrix')paints=glyphs.map(g=>Object.freeze({...g,origin:undefined,transform:g.transform.multiply(AffineTransform.translation(g.origin!.x,g.origin!.y))}));
   if(projection==='path'){const positioned=await positionNativeSvgPathGlyphs(plan,font,index,run,mode,{...options,timeoutMs:remaining(),check});if(!positioned)continue;paints=positioned;}
   if(projection==='screen'){
    if(line.path||!font.svgMetrics||font.axes.some(a=>a.tag==='opsz'))continue;
    const factor=Math.fround(Math.sqrt((world.a**2+world.b**2+world.c**2+world.d**2)/2));if(!factor)continue;const computed=Math.fround(style.fontSize*factor),metrics=await font.svgMetrics([...new Set(run.glyphs.map(g=>g.glyphId))],style,mode,computed,{...options,timeoutMs:remaining(),check}),native=new Map(metrics.glyphs.map(g=>[g.id,g])),inverse=Math.fround(1/factor),first=glyphs[0].origin!,baseX=Math.fround(first.x/inverse),baseY=Math.fround(first.y/inverse),parent=new AffineTransform(world.a/factor,world.b/factor,world.c/factor,world.d/factor,world.e,world.f),scale=metrics.em/run.unitsPerEm,positioned:Readonly<FloatGlyph>[]=[];let penX=0,penY=0;
    for(let i=0;i<run.glyphs.length;i++){const g=run.glyphs[i],m=native.get(g.glyphId)!;positioned.push(Object.freeze({font,glyphId:g.glyphId,style,color,surface:'svg',paintFontSize:computed,transform:parent,origin:Object.freeze({x:Math.fround(baseX+Math.fround(penX+g.xOffset*scale)),y:Math.fround(baseY-Math.fround(penY+g.yOffset*scale))})}));penX=Math.fround(penX+Math.fround(m.advance+(g.xAdvance-m.nominal)*scale));penY=Math.fround(penY+g.yAdvance*scale);if(run.glyphs[i+1]?.cluster!==g.cluster){const source=span.text.slice(g.cluster,ends.get(g.cluster));penX=Math.fround(penX+Math.fround((style.letterSpacing+[...source].filter(c=>c===' '||c==='\u00a0').length*(style.wordSpacing+line.wordSpacingDelta))*factor));}}
    paints=positioned;
   }
   const candidate=await captureSvgGlyphDocument(paints,{...options,timeoutMs:remaining(),check}),derivedBounds=await measureSvgGlyphBounds(candidate,check),nativeBounds=world.bounds(plan.metrics[index].ink),x=Math.floor(Math.min(nativeBounds.x,derivedBounds.x))-4,y=Math.floor(Math.min(nativeBounds.y,derivedBounds.y))-4,right=Math.ceil(Math.max(nativeBounds.x+nativeBounds.width,derivedBounds.x+derivedBounds.width))+4,bottom=Math.ceil(Math.max(nativeBounds.y+nativeBounds.height,derivedBounds.y+derivedBounds.height))+4;
   if(![x,y,right,bottom].every(Number.isSafeInteger))throw new Error('Native SVG matching exceeds safe pixel coordinates.');let pixels=0,error=0;const cell=256,gutter=2;
   for(let cy=Math.floor(y/cell)*cell;cy<bottom;cy+=cell)for(let cx=Math.floor(x/cell)*cell;cx<right;cx+=cell)for(const alpha of [1,.5]){
    const expected=await renderSvgCellAlpha(root,cx,cy,cell,gutter,alpha,{...options,timeoutMs:remaining(),check}),actual=await renderSvgCellAlpha(candidate,cx,cy,cell,gutter,alpha,{...options,timeoutMs:remaining(),check});check();for(let i=0;i<expected.length;i++)error=Math.max(error,Math.abs(expected[i]-actual[i]));pixels+=expected.length;await yieldTask();check();
   }
   const evidence=Object.freeze({projection,hiddenGlyphs:run.glyphs.length-glyphs.length,svgAdvance:plan.metrics[index].advance,svgPixelsCompared:pixels,svgMaxAlphaError:error,sourceGlyphs:run.glyphs.length,sourceClusters:new Set(run.glyphs.map(g=>g.cluster)).size,opacitySamples:Object.freeze([1,.5]),bounds:Object.freeze({x,y,width:right-x,height:bottom-y})});
   if(error){last=Object.freeze({status:'mismatch',reason:'The complete captured SVG ink differs from source-font glyph paint.',evidence});continue;}check();return Object.freeze({status:'matched',run,glyphs:Object.freeze([...paints]),evidence});
   }
  }return last!;
 }finally{release(measure);variation.release();}
}
