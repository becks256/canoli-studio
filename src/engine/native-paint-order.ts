import type {NativeTextVisualPosition} from './styled-text';

/** Preserve original source identity and shaped glyph order inside a cluster.
 * Native untracked metadata ranks paint only; it never supplies paint poses. */
export function nativeSvgPaintOrder<T extends Readonly<{sourceCluster?:number}>>(glyphs:readonly T[],visual:readonly NativeTextVisualPosition[]):readonly T[]{
 if(visual.some(position=>!Number.isFinite(position.order)))throw new Error('Native paint ordering metadata is invalid.');
 const ranked=glyphs.map((glyph,index)=>{
  const cluster=glyph.sourceCluster;
  if(cluster===undefined||!Number.isInteger(cluster)||cluster<0||cluster>=visual.length)throw new Error('Native glyph paint has no valid original source cluster.');
  return {glyph,index,order:visual[cluster].order};
 });
 ranked.sort((a,b)=>a.order-b.order||a.index-b.index);
 return Object.freeze(ranked.map(entry=>entry.glyph));
}
