import type {NativeSvgGlyphSource} from './native-svg-source';
import {AffineTransform} from '../core/affine';
import {textPathData} from '../core/text-path';
import {yieldTask} from '../core/task-yield';
import type {FontRunCss} from '../fonts/css-instance';
import type {OwnedFontRun} from '../fonts/shaping-types';
import type {FloatGlyph} from './float-glyph';
import type {NativeGlyphFont,NativeGlyphFontControl} from './native-glyph-font';
import type {StyledTextPlan} from './styled-text';
import {captureSvgGlyphDocument,measureSvgGlyphAdvances} from './svg-glyph-paint';

/** Replay the original baseline with the original native typographic items.
 * The straight textPath probe preserves native path itemization. Its positions
 * and independently measured candidate advances recover native inline units;
 * reference pixels never supply coordinates or a fitting objective. A caller
 * must verify complete original/candidate ink before publishing these poses. */
export async function positionNativeSvgPathGlyphs(plan:StyledTextPlan,font:NativeGlyphFont,index:number,run:OwnedFontRun,css:FontRunCss,control:NativeGlyphFontControl,selection?:NativeSvgGlyphSource):Promise<readonly Readonly<FloatGlyph>[]|undefined>{
 const line=plan.scene.lines[index],flat=plan.paint?.pathCharacters[index];
 if(!line.path||!font.svgMetrics||!flat)return;
 const options={...control},mode={...css},check=()=>{options.signal?.throwIfAborted();plan.check();font.check();options.check?.();options.signal?.throwIfAborted();plan.check();font.check();};check();
 const world=new AffineTransform(...plan.scene.transform as[number,number,number,number,number,number]),factor=Math.fround(Math.sqrt((world.a**2+world.b**2+world.c**2+world.d**2)/2));if(!factor)return;
 const style=selection?.style??line.spans[0].style,colorAt=selection?.color??(()=>plan.paint!.colors[index][0]),color=colorAt(run.request.itemOffset),ids=[...new Set(run.glyphs.map(g=>g.glyphId))],computed=Math.fround(style.fontSize*factor),metrics=await font.svgMetrics(ids,style,mode,computed,{...options,check});check();
 const measure=await captureSvgGlyphDocument(ids.map(glyphId=>({font,glyphId,style,surface:'svg',color,transform:world})),{...options,check}),advances=await measureSvgGlyphAdvances(measure,check);check();
 if(advances.length!==ids.length)throw new Error('Native baseline glyph advances are incomplete.');
 const ownWidths=new Map(ids.map((id,i)=>[id,Math.round(advances[i]*factor*64)/64])),scale=metrics.em/run.unitsPerEm,data=textPathData(line.path),transform=world.multiply(AffineTransform.translation(line.x,line.y)),sorted=[...new Set(run.glyphs.map(g=>g.cluster))].sort((a,b)=>a-b),layout=new Map<number,{left:number;width:number;angle:number;hidden:boolean}>(),characters=plan.paint!.characters[index],align=(line.align==='left'?0:line.align==='center'?.5:1)*Math.round(plan.metrics[index].advance*factor*64)/64;
 let deadline=performance.now()+2;
 for(let i=0;i<sorted.length;i++){
  const cluster=sorted[i],end=sorted[i+1]??selection?.end??line.spans[0].text.length;let left=Infinity,right=-Infinity,hidden=true;
  for(let j=cluster;j<end;j++){const c=flat[j],original=characters[j];left=Math.min(left,c.start.x,c.end.x);right=Math.max(right,c.start.x,c.end.x);hidden&&=original.start.x===0&&original.start.y===0&&original.end.x===0&&original.end.y===0&&original.extent.width===0&&original.extent.height===0;}
  left=Math.round(left*factor*64)/64-align;right=Math.round(right*factor*64)/64-align;layout.set(cluster,{left,width:right-left,angle:characters[cluster].rotation*Math.PI/180,hidden});
  if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
 }
 const positioned:Readonly<FloatGlyph>[]=[];let penX=0,penY=0,cluster=-1;
 for(const g of run.glyphs){
  if(g.cluster!==cluster){cluster=g.cluster;penX=penY=0;}const item=layout.get(cluster)!,own=ownWidths.get(g.glyphId)!;
  if(!item.hidden){const mid=Math.fround(Math.fround(Math.fround(item.left+item.width/2)/factor)+Math.fround(line.path.startOffset)),offset=Math.fround(mid-Math.fround(own/2/factor)),dx=(own-item.width)/2+penX+g.xOffset*scale,dy=-(penY+g.yOffset*scale),cos=Math.cos(item.angle),sin=Math.sin(item.angle),origin=Object.freeze({x:(cos*dx-sin*dy)/factor,y:(sin*dx+cos*dy)/factor});
   positioned.push(Object.freeze({font,glyphId:g.glyphId,style,surface:'svg',color:colorAt(g.cluster),transform,origin,path:Object.freeze({data,startOffset:offset,baselineOffset:line.path.baselineOffset})}));}
  penX+=g.xAdvance*scale;penY+=g.yAdvance*scale;
  if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
 }
 check();return Object.freeze(positioned);
}
