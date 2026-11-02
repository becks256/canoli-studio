import {verifyNativeSvgCandidates,type NativeSvgCandidates} from './native-svg-candidates';
import type {NativeSvgGlyphSource} from './native-svg-source';
import {nativeInlineRange} from './native-svg-path';
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
import {createCanvas,release} from './canvas';

/** Original full-text contexts and native orientation ranges supply glyph IDs.
 * Independent nominal metrics remove default vertical origins exactly once;
 * complete source ink remains the publication authority. */
const caps:Record<string,string[]>={'normal':[],'small-caps':['smcp'],'all-small-caps':['c2sc','smcp'],'petite-caps':['pcap'],'all-petite-caps':['c2pc','pcap'],'unicase':['unic'],'titling-caps':['titl']};
export function nativeVerticalTextItems(plan:StyledTextPlan,index:number,selection?:Pick<NativeSvgGlyphSource,'start'|'end'>){
 const line=plan.scene.lines[index],characters=plan.paint!.characters[index],orientationCharacters=line.path?plan.paint!.pathCharacters[index]:characters;if(!orientationCharacters)return;
 // Native carets resolve bidi independently of the paragraph direction. In
 // upright Arabic, BTT also changes required substitutions; preserve that item.
 const items:{start:number;end:number;upright:boolean;direction:'ltr'|'rtl'|'ttb'|'btt'}[]=[];
 for(let i=selection?.start??0;i<(selection?.end??characters.length);i++){const rotation=plan.paint!.visual?.[index]?.[i]?.rotation??orientationCharacters[i].rotation;if(rotation!==0&&rotation!==90)return undefined;const upright=rotation===0,last=items.at(-1),geometry=orientationCharacters[i],delta=geometry.end.y-geometry.start.y,reverse=plan.paint!.visual?.[index]?.[i]?.direction?plan.paint!.visual[index]![i].direction==='rtl':delta?delta<0:last?.upright===upright?last.direction==='rtl'||last.direction==='btt':line.direction==='rtl',direction=upright?(reverse?'btt':'ttb'):(reverse?'rtl':'ltr');if(last&&last.upright===upright&&last.direction===direction)last.end=i+1;else items.push({start:i,end:i+1,upright,direction});}
 return items;
}

export async function matchNativeVerticalSvgLine(plan:StyledTextPlan,font:NativeGlyphFont,index:number,control:NativeGlyphFontControl,selection?:NativeSvgGlyphSource):Promise<NativeSvgGlyphMatch>{
 return verifyNativeSvgCandidates(plan,font,index,nativeVerticalSvgCandidates(plan,font,index,control,selection),control,selection?.root);
}

export async function* nativeVerticalSvgCandidates(plan:StyledTextPlan,font:NativeGlyphFont,index:number,control:NativeGlyphFontControl,selection?:NativeSvgGlyphSource):NativeSvgCandidates{
 if(plan.paint?.inlineAllocation?.[index])yield* prepareNativeVerticalSvgCandidates(plan,font,index,control,selection,true);
 if(!plan.scene.lines[index].path&&(selection?.style??plan.scene.lines[index].spans[0].style).letterSpacing<0)yield* prepareNativeVerticalSvgCandidates(plan,font,index,control,selection,false,true);
 return yield* prepareNativeVerticalSvgCandidates(plan,font,index,control,selection,false);
}

async function* prepareNativeVerticalSvgCandidates(plan:StyledTextPlan,font:NativeGlyphFont,index:number,control:NativeGlyphFontControl,selection:NativeSvgGlyphSource|undefined,signed:boolean,inlineTop=false):NativeSvgCandidates{
 const options={...control},started=performance.now(),timeout=options.timeoutMs??60000,check=()=>{options.signal?.throwIfAborted();plan.check();font.check();options.check?.();options.signal?.throwIfAborted();plan.check();font.check();if(performance.now()-started>=timeout)throw new Error('Native vertical glyph matching exceeded its time budget.');},budget=()=>Math.max(1,Math.ceil(timeout-(performance.now()-started)));check();
 const line=plan.scene.lines[index],style=selection?.style??line.spans[0].style,characters=plan.paint!.characters[index];
 if(!font.svgMetrics)return Object.freeze({status:'unavailable',reason:'This vertical SVG line requires additional native baseline decomposition.'});
 const orientationCharacters=line.path?plan.paint!.pathCharacters[index]:characters;if(!orientationCharacters)return Object.freeze({status:'unavailable',reason:'The vertical source requires captured native path itemization.'});
 const items=nativeVerticalTextItems(plan,index,selection);if(!items)return Object.freeze({status:'unavailable',reason:'The native vertical orientation requires additional source mapping.'});
 const baselineData=line.path?textPathData(line.path):undefined,world=new AffineTransform(...plan.scene.transform as[number,number,number,number,number,number]),factor=Math.fround(Math.sqrt((world.a**2+world.b**2+world.c**2+world.d**2)/2)),canvas=createCanvas(1,1),context=canvas.getContext('2d')!;
 try{applyTextStyle(context,style);const css=captureNativeFontInstance(context,style.fontWeight,font.descriptors,style.fontSize),axes=font.axes.filter(a=>a.tag==='ital'||a.tag==='slnt').map(a=>a.tag as 'ital'|'slnt'),instances=axes.length?[...axes.map(styleAxis=>({...css,styleAxis})),{...css,styleAxis:'none'as const}]:[css],kerns=style.fontKerning==='auto'?[1,0]:[style.fontKerning==='none'?0:1];
  for(const instance of instances)for(const kern of kerns)for(const native of signed?[true,false]:[false,true]){
   const glyphs:Readonly<FloatGlyph>[]=[],pathGlyphs:Readonly<FloatGlyph>[]=[],nativePathGlyphs:Readonly<FloatGlyph>[]=[],runs:OwnedFontRun[]=[],negativeClusters=new Set<number>(),sourceSizes=new Map<number,number>(),sourceEnds=new Map<number,number>(),fragments:NonNullable<import('./native-svg-inline-frames').NativeSvgInlineCandidateAllocation['fragments']>[number][]=[],zeroAdvance=new Set<number>();let deadline=performance.now()+2;
   for(const item of items){
    const direction=item.direction;let run=await font.shapeRun({text:selection?.text??line.spans[0].text,itemOffset:item.start,itemLength:item.end-item.start,direction,features:[{tag:'kern',value:kern},...(caps[style.fontVariantCaps??'normal']??[]).map(tag=>({tag,value:1})),...(style.letterSpacing||item.upright?[{tag:'liga',value:0},{tag:'clig',value:0}]:[])],css:instance},{...options,timeoutMs:budget(),check});check();
    if(run.glyphs.some(g=>g.glyphId===0))return Object.freeze({status:'unavailable',reason:'The vertical SVG line requires missing-glyph or font-fallback painting.'});
    const baseline=line.writing!.orientation==='sideways'?'alphabetic'as const:'central'as const,writing=Object.freeze({mode:line.writing!.mode,orientation:item.upright?'upright'as const:'sideways'as const}),ids=[...new Set(run.glyphs.map(g=>g.glyphId))],metrics=await font.svgMetrics!(ids,style,instance,Math.fround(style.fontSize*factor),{...options,timeoutMs:budget(),check},{direction:item.upright?'ttb':'ltr',native});if(metrics.nativeMetrics){run=await font.shapeRun({...run.request,nativeMetrics:metrics.nativeMetrics},{...options,timeoutMs:budget(),check});check();}runs.push(run);const nominals=new Map(metrics.glyphs.map(g=>[g.id,g])),scale=metrics.em/(factor*run.unitsPerEm),clusters=[...new Set(run.glyphs.map(g=>g.cluster))].sort((a,b)=>a-b),ends=new Map(clusters.map((c,i)=>[c,clusters[i+1]??item.end])),clusterSpaces=new Map(clusters.map(cluster=>[cluster,[...(selection?.text??line.spans[0].text).slice(cluster,ends.get(cluster))].filter(c=>c===' '||c==='\u00a0').length])),spacing=(g:OwnedFontRun['glyphs'][number])=>style.letterSpacing+(item.upright?-(g.yAdvance-nominals.get(g.glyphId)!.yAdvance):g.xAdvance-nominals.get(g.glyphId)!.nominal)*scale+clusterSpaces.get(g.cluster)!*(style.wordSpacing+line.wordSpacingDelta),probes=run.glyphs.map(g=>({font,glyphId:g.glyphId,sourceCluster:g.cluster,style,surface:'svg'as const,color:selection?.color(g.cluster)??plan.paint!.colors[index][0],transform:world,writing,baseline,...(signed?{paintLetterSpacing:spacing(g)}:{}),...(line.path?{rotation:characters[g.cluster].rotation-(item.upright?0:90)}:{})})),measured=await measureSvgGlyphOrigins(await captureSvgGlyphDocument(probes,{...options,timeoutMs:budget(),check}),check);const advances=new Map<number,number>();for(const glyph of run.glyphs)advances.set(glyph.cluster,(advances.get(glyph.cluster)??0)+(item.upright?-glyph.yAdvance:glyph.xAdvance));for(const cluster of clusters){const spaces=clusterSpaces.get(cluster)!,advance=advances.get(cluster)!*scale+style.letterSpacing+(signed?spaces*(style.wordSpacing+line.wordSpacingDelta):0);sourceEnds.set(cluster,ends.get(cluster)!);sourceSizes.set(cluster,Math.trunc(advance*factor*64)/64);if(advance<0)negativeClusters.add(cluster);}if(inlineTop)fragments.push(Object.freeze({glyphs:Object.freeze(run.glyphs.map(g=>Object.freeze({cluster:g.cluster,advance:Math.fround((item.upright?-g.yAdvance:g.xAdvance)*metrics.em/run.unitsPerEm)}))),spacings:Object.freeze(clusters.map(cluster=>Object.freeze({cluster,advance:Math.fround((style.letterSpacing+clusterSpaces.get(cluster)!*(style.wordSpacing+line.wordSpacingDelta))*factor)})))}));let penX=0,penY=0,cluster=-1,startX=0,startY=0;
    for(let i=0;i<run.glyphs.length;i++){const g=run.glyphs[i];if(cluster!==g.cluster){cluster=g.cluster;startX=penX;startY=penY;}const range=characters.slice(g.cluster,ends.get(g.cluster)),angle=line.path?(characters[g.cluster].rotation-(item.upright?0:90))*Math.PI/180:0,cos=Math.cos(angle),sin=Math.sin(angle),anchor=range.flatMap(c=>[c.start,c.end]).reduce((a,b)=>(negativeClusters.has(g.cluster)?-sin*a.x+cos*a.y>=-sin*b.x+cos*b.y:-sin*a.x+cos*a.y<=-sin*b.x+cos*b.y)?a:b),own=measured[i],nominal=nominals.get(g.glyphId)!,dx=item.upright?(penX-startX+g.xOffset-nominal.xOffset)*scale:(penY-startY+g.yOffset)*scale,dy=item.upright?-(penY-startY+g.yOffset-nominal.yOffset)*scale:(penX-startX+g.xOffset)*scale;
     const hidden=!!line.path&&range.every(c=>c.start.x===0&&c.start.y===0&&c.end.x===0&&c.end.y===0&&c.extent.width===0&&c.extent.height===0),transform=line.path?world.multiply(AffineTransform.translation(line.x,line.y)):world;
     if(!hidden){if(!g.xAdvance&&!g.yAdvance)zeroAdvance.add(glyphs.length);glyphs.push(Object.freeze({font,glyphId:g.glyphId,sourceCluster:g.cluster,style,surface:'svg',color:selection?.color(g.cluster)??plan.paint!.colors[index][0],writing,baseline,transform,...(signed?{paintLetterSpacing:spacing(g)}:{}),origin:Object.freeze({x:anchor.x-own.start.x+cos*dx-sin*dy,y:anchor.y-own.start.y+sin*dx+cos*dy}),...(line.path?{rotation:angle*180/Math.PI}:{})}));
      if(line.path){const flat=(signed?plan.paint!.inlineAllocation![index]!.characters:plan.paint!.pathCharacters[index]!).slice(g.cluster,ends.get(g.cluster)),align=(line.align==='left'?0:line.align==='center'?.5:1)*Math.round(plan.metrics[index].advance*factor*64)/64,left=Math.round((signed&&negativeClusters.has(g.cluster)?Math.max(...flat.flatMap(c=>[c.start.y,c.end.y])):Math.min(...flat.flatMap(c=>[c.start.y,c.end.y])))*factor*64)/64-align,right=Math.round(Math.max(...flat.flatMap(c=>[c.start.y,c.end.y]))*factor*64)/64-align,width=signed?sourceSizes.get(g.cluster)!:right-left,ownAdvance=signed?Math.trunc(((item.upright?-nominal.yAdvance:nominal.nominal)*scale+spacing(g))*factor*64)/64:Math.round(own.advance*factor*64)/64,mid=Math.fround(Math.fround(Math.fround(left+width/2)/factor)+Math.fround(line.path.startOffset)),offset=Math.fround(mid-Math.fround(ownAdvance/2/factor)),localY=dy+(ownAdvance-width)/(2*factor);
       pathGlyphs.push(Object.freeze({font,glyphId:g.glyphId,sourceCluster:g.cluster,style,surface:'svg',color:selection?.color(g.cluster)??plan.paint!.colors[index][0],writing,baseline,transform,...(signed?{paintLetterSpacing:spacing(g)}:{}),origin:Object.freeze({x:cos*dx-sin*localY,y:sin*dx+cos*localY}),path:Object.freeze({data:baselineData!,startOffset:offset,baselineOffset:line.path.baselineOffset})}));
       const nativeRange=nativeInlineRange(plan.paint!.pathCharacters[index]!,'y'),fraction=line.align==='left'?0:line.align==='center'?.5:1,nativeAlign=signed?Math.fround(Math.round(plan.paint!.inlineAllocation![index]!.anchorExtent*factor*64)/64*fraction):Math.round((nativeRange.min+(nativeRange.max-nativeRange.min)*fraction)*factor*64)/64,nativeMid=Math.fround(Math.fround(Math.fround(left+align-nativeAlign+width/2)/factor)+Math.fround(line.path.startOffset)),nativeOffset=Math.fround(nativeMid-Math.fround(ownAdvance/2/factor));nativePathGlyphs.push(Object.freeze({...pathGlyphs.at(-1)!,path:Object.freeze({data:baselineData!,startOffset:nativeOffset,baselineOffset:line.path.baselineOffset})}));}
     }penX+=g.xAdvance;penY+=g.yAdvance;
     if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
    }
   }
   for(const projection of (signed?['vertical-signed-native-path']:inlineTop?['vertical-native-inline-top']:negativeClusters.size?(line.path?['vertical-native-source-top','vertical-native-anchor-path','vertical-source-top','vertical','vertical-matrix','vertical-path','vertical-line-top']:['vertical-source-top','vertical','vertical-matrix','vertical-line-top']):['vertical','vertical-matrix','vertical-path','vertical-line-top','vertical-native-anchor-path'])as readonly import('./native-svg-glyph').NativeSvgGlyphEvidence['projection'][]){if((projection==='vertical-path'||projection==='vertical-native-anchor-path'||projection==='vertical-native-source-top')&&!line.path)continue;let primitives:readonly Readonly<FloatGlyph>[]=projection==='vertical-signed-native-path'||projection==='vertical-native-anchor-path'||projection==='vertical-native-source-top'?nativePathGlyphs:projection==='vertical-path'?pathGlyphs:projection==='vertical'?glyphs:glyphs.map(g=>Object.freeze({...g,origin:undefined,transform:g.transform.multiply(AffineTransform.translation(g.origin!.x,g.origin!.y))}));
   if(projection==='vertical-native-inline-top'){
    const range=nativeInlineRange(characters,'y'),offset=line.direction==='rtl'?Math.round(Math.max(0,range.max-range.min-plan.metrics[index].advance)*factor*64)/64:0,delta=(Math.floor(offset+.5)-offset)/factor;
    primitives=glyphs.map(g=>Object.freeze({...g,origin:Object.freeze({x:g.origin!.x,y:g.origin!.y+delta})}));
   }
   if(projection==='vertical-signed-native-path'){
    const range=plan.paint!.inlineAllocation![index]!.range,offset=line.direction==='rtl'?Math.round(Math.max(0,range.max-range.min-plan.metrics[index].advance)*factor*64)/64:0,delta=(Math.floor(offset+.5)-offset)/factor;
    // A zero-advance attachment follows its original cluster pose. It does not
    // become a new typographic path item with an independent midpoint.
    primitives=nativePathGlyphs.map((value,i)=>{const g=zeroAdvance.has(i)?glyphs[i]:value,angle=(glyphs[i].rotation??0)*Math.PI/180;return Object.freeze({...g,origin:Object.freeze({x:(g.origin?.x??0)-Math.sin(angle)*delta,y:(g.origin?.y??0)+Math.cos(angle)*delta})});});
   }
   if(projection==='vertical-line-top'||projection==='vertical-source-top'||projection==='vertical-native-source-top'){
    if(!selection||(projection==='vertical-source-top'||projection==='vertical-native-source-top')&&!negativeClusters.has(glyphs[0]?.sourceCluster??-1))continue;
    // The native painter rounds each original inline fragment's line top.
    // Recover its CSS offset from whole-source inline metadata on the 1/64 grid;
    // use the native rounding rule, never a displacement inferred from pixels.
    const flat=plan.paint!.pathCharacters[index]??characters,min=(rows:typeof characters)=>projection!=='vertical-line-top'?rows.reduce((n,c)=>Math.max(n,c.start.y,c.end.y),-Infinity):rows.reduce((n,c)=>Math.min(n,c.start.y,c.end.y),Infinity),offset=Math.round((min(flat.slice(selection.start,selection.end))-min(flat))*factor*64)/64,delta=(Math.floor(offset+.5)-offset)/factor;
    primitives=(projection==='vertical-native-source-top'?nativePathGlyphs:line.path?pathGlyphs:glyphs).map((g,i)=>{const angle=(glyphs[i].rotation??0)*Math.PI/180;return Object.freeze({...g,origin:Object.freeze({x:(g.origin?.x??0)-Math.sin(angle)*delta,y:(g.origin?.y??0)+Math.cos(angle)*delta})});});
   }
   const inlineAllocation=signed||inlineTop?Object.freeze({...(inlineTop?{fragments:Object.freeze(fragments)}:{}),factor,offset:line.direction==='rtl'?(()=>{const range=signed?plan.paint!.inlineAllocation![index]!.range:nativeInlineRange(characters,'y'),offset=Math.round(Math.max(0,range.max-range.min-plan.metrics[index].advance)*factor*64)/64;return(Math.floor(offset+.5)-offset)/factor;})():0,rotations:Object.freeze(glyphs.map(g=>g.rotation??0)),sizes:Object.freeze([...sourceSizes].map(([start,advance])=>Object.freeze({start,end:sourceEnds.get(start)!,advance})))}):undefined;
   check();yield Object.freeze({...(inlineAllocation?{inlineAllocation}:{}),projection,nativeMetrics:native,hiddenGlyphs:runs.reduce((n,r)=>n+r.glyphs.length,0)-primitives.length,runs:Object.freeze(runs),glyphs:Object.freeze([...primitives])});
   }
  }return undefined;
 }finally{release(canvas);}
}
