import type {CharacterFormat} from '../core/character-format';
import type {LinearTextColor} from './float-text-color';
import type {StyledTextPlan} from './styled-text';
import {captureNativeSvgLineRoot} from './native-svg-verify';
import type {NativeTextItem} from './native-text-items';

/** Private source selection. Original DOM spans and full UTF-16 shaping context
 * remain intact; scalar opacity only selects the original paint for verification. */
export interface NativeSvgGlyphSource {
 readonly text:string;readonly start:number;readonly end:number;
 readonly style:Readonly<CharacterFormat>;readonly root:Element;
 /** Already itemized original context, clipped to this private selection. */
 readonly items?:readonly Readonly<NativeTextItem>[];
 color(cluster:number):LinearTextColor;
}
export function captureNativeSvgGlyphSource(plan:StyledTextPlan,index:number,first:number,last:number):NativeSvgGlyphSource{
 plan.check();const line=plan.scene.lines[index],colors=plan.paint?.colors[index];
 if(!line||!colors||!Number.isInteger(first)||!Number.isInteger(last)||first<0||last<=first||last>line.spans.length)throw new Error('Invalid native glyph source selection.');
 const offsets=[0];for(const span of line.spans)offsets.push(offsets.at(-1)!+span.text.length);
 const root=captureNativeSvgLineRoot(plan,index),spans=[...root.querySelectorAll('tspan')];if(spans.length!==line.spans.length)throw new Error('Native glyph paint spans differ from their captured source.');
 for(let i=0;i<spans.length;i++)if(i<first||i>=last)(spans[i]as SVGElement).style.fillOpacity='0';
 return Object.freeze({text:line.spans.map(s=>s.text).join(''),start:offsets[first],end:offsets[last],style:line.spans[first].style,root,color(cluster:number){
  if(!Number.isInteger(cluster)||cluster<offsets[first]||cluster>=offsets[last])throw new Error('Glyph paint cluster differs from its captured source.');
  let lo=first,hi=last;while(lo+1<hi){const mid=(lo+hi)>>>1;if(offsets[mid]<=cluster)lo=mid;else hi=mid;}return colors[lo];
 }});
}
