import {nativeVerificationPalette} from './native-svg-palette';
import {AffineTransform} from '../core/affine';
import {yieldTask} from '../core/task-yield';
import type {FloatGlyph} from './float-glyph';
import type {NativeGlyphFontControl} from './native-glyph-font';
import type {StyledTextPlan} from './styled-text';
import {captureSvgGlyphDocument,measureSvgGlyphBounds,renderSvgCellAlpha,renderSvgCellWeight} from './svg-glyph-paint';

export function captureNativeSvgLineRoot(plan:StyledTextPlan,index:number){
 plan.check();const parsed=new DOMParser().parseFromString(plan.markup,'image/svg+xml'),root=parsed.documentElement,texts=[...root.querySelectorAll('text')];
 if(root.localName!=='svg'||texts.length!==plan.scene.lines.length)throw new Error('Captured native SVG structure differs from its source.');
 for(let i=0;i<texts.length;i++)if(i!==index)texts[i].remove();plan.check();return root;
}

/** Complete original/candidate reported geometry, two fixed alpha samples,
 * and the same canonical world lattice guard every decomposition backend. */
export async function compareNativeSvgGlyphPaint(plan:StyledTextPlan,index:number,source:Element,glyphs:readonly Readonly<FloatGlyph>[],control:NativeGlyphFontControl,budget:()=>number){
 const options={...control},check=()=>{options.signal?.throwIfAborted();plan.check();options.check?.();options.signal?.throwIfAborted();plan.check();};check();
 const candidate=await captureSvgGlyphDocument(glyphs,{...options,timeoutMs:budget(),check});if(plan.scene.lines[index].spans.length>1){const colors=plan.paint!.colors[index],palette=nativeVerificationPalette(colors),spans=[...source.querySelectorAll('tspan')],texts=[...candidate.querySelectorAll('text')];if(spans.length!==colors.length||texts.length!==glyphs.length)throw new Error('Native verification paint differs from its source.');for(let i=0;i<spans.length;i++)spans[i].setAttribute('fill',palette.fill(colors[i]));for(let i=0;i<texts.length;i++)texts[i].setAttribute('fill',palette.fill(glyphs[i].color));source.setAttribute('data-canoli-verification-palette','');candidate.setAttribute('data-canoli-verification-palette','');}const derived=await measureSvgGlyphBounds(candidate,check),world=new AffineTransform(...plan.scene.transform as[number,number,number,number,number,number]),native=world.bounds(plan.metrics[index].ink),x=Math.floor(Math.min(native.x,derived.x))-4,y=Math.floor(Math.min(native.y,derived.y))-4,right=Math.ceil(Math.max(native.x+native.width,derived.x+derived.width))+4,bottom=Math.ceil(Math.max(native.y+native.height,derived.y+derived.height))+4;
 if(![x,y,right,bottom].every(Number.isSafeInteger))throw new Error('Native SVG matching exceeds safe pixel coordinates.');let pixels=0,error=0;const cell=256,gutter=2;
 for(let cy=Math.floor(y/cell)*cell;cy<bottom;cy+=cell)for(let cx=Math.floor(x/cell)*cell;cx<right;cx+=cell)for(const alpha of [1,.5]){
  const expected=await renderSvgCellAlpha(source,cx,cy,cell,gutter,alpha,{...options,timeoutMs:budget(),check}),actual=await renderSvgCellAlpha(candidate,cx,cy,cell,gutter,alpha,{...options,timeoutMs:budget(),check});check();for(let i=0;i<expected.length;i++)error=Math.max(error,Math.abs(expected[i]-actual[i]));pixels+=expected.length;await yieldTask();check();
 }
 check();return Object.freeze({pixels,error,bounds:Object.freeze({x,y,width:right-x,height:bottom-y})});
}


/** Per-color canonical weights prove source ownership and occlusion order.
 * Actual authored HDR RGB/alpha remain separately captured source values. */
export async function compareNativeSvgPaintOwnership(plan:StyledTextPlan,index:number,glyphs:readonly Readonly<FloatGlyph>[],bounds:Readonly<{x:number;y:number;width:number;height:number}>,control:NativeGlyphFontControl,budget:()=>number){
 const owners=[...new Set(glyphs.map(glyph=>glyph.font))],options={...control},check=()=>{options.signal?.throwIfAborted();plan.check();options.check?.();options.signal?.throwIfAborted();plan.check();for(const font of owners)font.check();},colors=plan.paint!.colors[index],key=(color:readonly number[])=>JSON.stringify(color),palette=[...new Set(colors.map(key))],verification=nativeVerificationPalette(colors);check();if(palette.length<2)return Object.freeze({pixels:0,error:0,colors:palette.length});
 const source=captureNativeSvgLineRoot(plan,index),candidate=await captureSvgGlyphDocument(glyphs,{...options,timeoutMs:budget(),check}),spans=[...source.querySelectorAll('tspan')],texts=[...candidate.querySelectorAll('text')];if(spans.length!==colors.length||texts.length!==glyphs.length)throw new Error('Native paint ownership differs from its source spans.');let pixels=0,error=0;const cell=256,gutter=2;
 for(const selected of palette){
  for(const text of source.querySelectorAll('text'))text.setAttribute('fill','#000');for(let i=0;i<spans.length;i++)spans[i].setAttribute('fill',verification.fill(colors[i],selected));for(let i=0;i<texts.length;i++)texts[i].setAttribute('fill',verification.fill(glyphs[i].color,selected));
  for(let y=Math.floor(bounds.y/cell)*cell;y<bounds.y+bounds.height;y+=cell)for(let x=Math.floor(bounds.x/cell)*cell;x<bounds.x+bounds.width;x+=cell)for(const alpha of [1,.5]){
   check();const expected=await renderSvgCellWeight(source,x,y,cell,gutter,alpha,{...options,timeoutMs:budget(),check}),actual=await renderSvgCellWeight(candidate,x,y,cell,gutter,alpha,{...options,timeoutMs:budget(),check});check();for(let i=0;i<expected.length;i++)error=Math.max(error,Math.abs(expected[i]-actual[i]));pixels+=expected.length;await yieldTask();check();
  }
 }check();return Object.freeze({pixels,error,colors:palette.length});
}
