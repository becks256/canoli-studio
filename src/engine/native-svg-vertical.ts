import type {NativeSvgGlyphSource} from './native-svg-source';
import {textPathData} from '../core/text-path';
import {AffineTransform} from '../core/affine';
import {applyTextStyle} from '../core/text-style';
import {yieldTask} from '../core/task-yield';
import type {OwnedFontRun} from '../fonts/shaping-types';
import type {FloatGlyph} from './float-glyph';
import type {NativeGlyphFont,NativeGlyphFontControl} from './native-glyph-font';
import type {NativeSvgGlyphMatch} from './native-svg-glyph';
import type {StyledTextPlan} from './styled-text';
import {captureNativeFontInstance} from './native-font-instance';
import {captureSvgGlyphDocument,measureSvgGlyphOrigins} from './svg-glyph-paint';
import {captureNativeSvgLineRoot,compareNativeSvgGlyphPaint} from './native-svg-verify';
import {createCanvas,release} from './canvas';

/** Original full-text contexts and native orientation ranges supply glyph IDs.
 * Independent nominal metrics remove default vertical origins exactly once;
 * complete source ink remains the publication authority. */
const caps:Record<string,string[]>={'normal':[],'small-caps':['smcp'],'all-small-caps':['c2sc','smcp'],'petite-caps':['pcap'],'all-petite-caps':['c2pc','pcap'],'unicase':['unic'],'titling-caps':['titl']};
export async function matchNativeVerticalSvgLine(plan:StyledTextPlan,font:NativeGlyphFont,index:number,control:NativeGlyphFontControl,selection?:NativeSvgGlyphSource):Promise<NativeSvgGlyphMatch>{
 const options={...control},started=performance.now(),timeout=options.timeoutMs??60000,check=()=>{options.signal?.throwIfAborted();plan.check();font.check();options.check?.();options.signal?.throwIfAborted();plan.check();font.check();if(performance.now()-started>=timeout)throw new Error('Native vertical glyph matching exceeded its time budget.');},budget=()=>Math.max(1,Math.ceil(timeout-(performance.now()-started)));check();
 const line=plan.scene.lines[index],style=selection?.style??line.spans[0].style,characters=plan.paint!.characters[index];
 if(!font.svgMetrics)return Object.freeze({status:'unavailable',reason:'This vertical SVG line requires additional native baseline decomposition.'});
 const orientationCharacters=line.path?plan.paint!.pathCharacters[index]:characters;if(!orientationCharacters)return Object.freeze({status:'unavailable',reason:'The vertical source requires captured native path itemization.'});
 // Native carets resolve bidi independently of the paragraph direction. In
 // upright Arabic, BTT also changes required substitutions; preserve that item.
 const items:{start:number;end:number;upright:boolean;direction:'ltr'|'rtl'|'ttb'|'btt'}[]=[];
 for(let i=selection?.start??0;i<(selection?.end??characters.length);i++){const rotation=orientationCharacters[i].rotation;if(rotation!==0&&rotation!==90)return Object.freeze({status:'unavailable',reason:'The native vertical orientation requires additional source mapping.'});const upright=rotation===0,last=items.at(-1),geometry=orientationCharacters[i],delta=geometry.end.y-geometry.start.y,reverse=delta?delta<0:last?.upright===upright?last.direction==='rtl'||last.direction==='btt':line.direction==='rtl',direction=upright?(reverse?'btt':'ttb'):(reverse?'rtl':'ltr');if(last&&last.upright===upright&&last.direction===direction)last.end=i+1;else items.push({start:i,end:i+1,upright,direction});}
 const baselineData=line.path?textPathData(line.path):undefined,world=new AffineTransform(...plan.scene.transform as[number,number,number,number,number,number]),factor=Math.fround(Math.sqrt((world.a**2+world.b**2+world.c**2+world.d**2)/2)),source=selection?.root??captureNativeSvgLineRoot(plan,index),canvas=createCanvas(1,1),context=canvas.getContext('2d')!;let last:NativeSvgGlyphMatch|undefined;
 try{applyTextStyle(context,style);const css=captureNativeFontInstance(context,style.fontWeight,font.descriptors,style.fontSize),axes=font.axes.filter(a=>a.tag==='ital'||a.tag==='slnt').map(a=>a.tag as 'ital'|'slnt'),instances=axes.length?[...axes.map(styleAxis=>({...css,styleAxis})),{...css,styleAxis:'none'as const}]:[css],kerns=style.fontKerning==='auto'?[1,0]:[style.fontKerning==='none'?0:1];
  for(const instance of instances)for(const kern of kerns)for(const native of [false,true]){
   const glyphs:Readonly<FloatGlyph>[]=[],pathGlyphs:Readonly<FloatGlyph>[]=[],runs:OwnedFontRun[]=[];let deadline=performance.now()+2;
   for(const item of items){
    const direction=item.direction;let run=await font.shapeRun({text:selection?.text??line.spans[0].text,itemOffset:item.start,itemLength:item.end-item.start,direction,features:[{tag:'kern',value:kern},...(caps[style.fontVariantCaps??'normal']??[]).map(tag=>({tag,value:1})),...(style.letterSpacing||item.upright?[{tag:'liga',value:0},{tag:'clig',value:0}]:[])],css:instance},{...options,timeoutMs:budget(),check});check();
    if(run.glyphs.some(g=>g.glyphId===0))return Object.freeze({status:'unavailable',reason:'The vertical SVG line requires missing-glyph or font-fallback painting.'});
    const baseline=line.writing!.orientation==='sideways'?'alphabetic'as const:'central'as const,writing=Object.freeze({mode:line.writing!.mode,orientation:item.upright?'upright'as const:'sideways'as const}),ids=[...new Set(run.glyphs.map(g=>g.glyphId))],metrics=await font.svgMetrics!(ids,style,instance,Math.fround(style.fontSize*factor),{...options,timeoutMs:budget(),check},{direction:item.upright?'ttb':'ltr',native});if(metrics.nativeMetrics){run=await font.shapeRun({...run.request,nativeMetrics:metrics.nativeMetrics},{...options,timeoutMs:budget(),check});check();}runs.push(run);const nominals=new Map(metrics.glyphs.map(g=>[g.id,g])),probes=run.glyphs.map(g=>({font,glyphId:g.glyphId,style,surface:'svg'as const,color:selection?.color(g.cluster)??plan.paint!.colors[index][0],transform:world,writing,baseline,...(line.path?{rotation:characters[g.cluster].rotation-(item.upright?0:90)}:{})})),measured=await measureSvgGlyphOrigins(await captureSvgGlyphDocument(probes,{...options,timeoutMs:budget(),check}),check),scale=metrics.em/(factor*run.unitsPerEm),clusters=[...new Set(run.glyphs.map(g=>g.cluster))].sort((a,b)=>a-b),ends=new Map(clusters.map((c,i)=>[c,clusters[i+1]??item.end]));let penX=0,penY=0,cluster=-1,startX=0,startY=0;
    for(let i=0;i<run.glyphs.length;i++){const g=run.glyphs[i];if(cluster!==g.cluster){cluster=g.cluster;startX=penX;startY=penY;}const range=characters.slice(g.cluster,ends.get(g.cluster)),angle=line.path?(characters[g.cluster].rotation-(item.upright?0:90))*Math.PI/180:0,cos=Math.cos(angle),sin=Math.sin(angle),anchor=range.flatMap(c=>[c.start,c.end]).reduce((a,b)=>-sin*a.x+cos*a.y<=-sin*b.x+cos*b.y?a:b),own=measured[i],nominal=nominals.get(g.glyphId)!,dx=item.upright?(penX-startX+g.xOffset-nominal.xOffset)*scale:(penY-startY+g.yOffset)*scale,dy=item.upright?-(penY-startY+g.yOffset-nominal.yOffset)*scale:(penX-startX+g.xOffset)*scale;
     const hidden=!!line.path&&range.every(c=>c.start.x===0&&c.start.y===0&&c.end.x===0&&c.end.y===0&&c.extent.width===0&&c.extent.height===0),transform=line.path?world.multiply(AffineTransform.translation(line.x,line.y)):world;
     if(!hidden){glyphs.push(Object.freeze({font,glyphId:g.glyphId,style,surface:'svg',color:selection?.color(g.cluster)??plan.paint!.colors[index][0],writing,baseline,transform,origin:Object.freeze({x:anchor.x-own.start.x+cos*dx-sin*dy,y:anchor.y-own.start.y+sin*dx+cos*dy}),...(line.path?{rotation:angle*180/Math.PI}:{})}));
      if(line.path){const flat=plan.paint!.pathCharacters[index]!.slice(g.cluster,ends.get(g.cluster)),align=(line.align==='left'?0:line.align==='center'?.5:1)*Math.round(plan.metrics[index].advance*factor*64)/64,left=Math.round(Math.min(...flat.flatMap(c=>[c.start.y,c.end.y]))*factor*64)/64-align,right=Math.round(Math.max(...flat.flatMap(c=>[c.start.y,c.end.y]))*factor*64)/64-align,width=right-left,ownAdvance=Math.round(own.advance*factor*64)/64,mid=Math.fround(Math.fround(Math.fround(left+width/2)/factor)+Math.fround(line.path.startOffset)),offset=Math.fround(mid-Math.fround(ownAdvance/2/factor)),localY=dy+(ownAdvance-width)/(2*factor);
       pathGlyphs.push(Object.freeze({font,glyphId:g.glyphId,style,surface:'svg',color:selection?.color(g.cluster)??plan.paint!.colors[index][0],writing,baseline,transform,origin:Object.freeze({x:cos*dx-sin*localY,y:sin*dx+cos*localY}),path:Object.freeze({data:baselineData!,startOffset:offset,baselineOffset:line.path.baselineOffset})}));}
     }penX+=g.xAdvance;penY+=g.yAdvance;
     if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
    }
   }
   for(const projection of ['vertical','vertical-matrix','vertical-path','vertical-line-top']as const){if(projection==='vertical-path'&&!line.path)continue;let primitives:readonly Readonly<FloatGlyph>[]=projection==='vertical-path'?pathGlyphs:projection==='vertical'?glyphs:glyphs.map(g=>Object.freeze({...g,origin:undefined,transform:g.transform.multiply(AffineTransform.translation(g.origin!.x,g.origin!.y))}));
   if(projection==='vertical-line-top'){
    if(!selection)continue;
    // The native painter rounds each original inline fragment's line top.
    // Recover its CSS offset from whole-source inline metadata on the 1/64 grid;
    // use the native rounding rule, never a displacement inferred from pixels.
    const flat=plan.paint!.pathCharacters[index]??characters,min=(rows:typeof characters)=>rows.reduce((n,c)=>Math.min(n,c.start.y,c.end.y),Infinity),offset=Math.round((min(flat.slice(selection.start,selection.end))-min(flat))*factor*64)/64,delta=(Math.floor(offset+.5)-offset)/factor;
    primitives=(line.path?pathGlyphs:glyphs).map((g,i)=>{const angle=(glyphs[i].rotation??0)*Math.PI/180;return Object.freeze({...g,origin:Object.freeze({x:(g.origin?.x??0)-Math.sin(angle)*delta,y:(g.origin?.y??0)+Math.cos(angle)*delta})});});
   }
   const paint=await compareNativeSvgGlyphPaint(plan,index,source,primitives,{...options,check},budget),evidence=Object.freeze({projection,nativeMetrics:native,hiddenGlyphs:runs.reduce((n,r)=>n+r.glyphs.length,0)-glyphs.length,svgAdvance:plan.metrics[index].advance,svgPixelsCompared:paint.pixels,svgMaxAlphaError:paint.error,sourceGlyphs:runs.reduce((n,r)=>n+r.glyphs.length,0),sourceClusters:runs.reduce((n,r)=>n+new Set(r.glyphs.map(g=>g.cluster)).size,0),opacitySamples:Object.freeze([1,.5]),bounds:paint.bounds});
   if(paint.error){last=Object.freeze({status:'mismatch',reason:'The complete native vertical SVG ink differs from source-font glyph paint.',evidence});continue;}check();return Object.freeze({status:'matched',run:runs[0],runs:Object.freeze(runs),glyphs:Object.freeze(primitives),evidence});
   }
  }return last!;
 }finally{release(canvas);}
}
