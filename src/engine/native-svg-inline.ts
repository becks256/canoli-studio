import {yieldTask} from '../core/task-yield';
import {verticalWriting} from '../core/text-writing';
import type {StyledTextCharacterGeometry,StyledTextLine} from './styled-text';

const NS='http://www.w3.org/2000/svg';
export interface NativeSvgInlineAllocation {
 readonly characters:readonly StyledTextCharacterGeometry[];
 readonly range:Readonly<{min:number;max:number}>;
 readonly layoutRange:Readonly<{min:number;max:number}>;
 /** Native start/end anchor separation, including signed fragment advances.
  * Character rectangles alone can clamp those advances to zero. */
 readonly anchorExtent:number;
}
const hidden=(c:StyledTextCharacterGeometry)=>!c.start.x&&!c.start.y&&!c.end.x&&!c.end.y&&!c.extent.width&&!c.extent.height&&!c.rotation;

/** Keep the complete original text and spans in their captured SVG context.
 * Padding moves only a disposable straight measurement baseline. It is derived
 * from native source geometry, never reference pixels or a source-size limit. */
export async function captureNativeSvgInlineAllocation(text:SVGTextElement,svg:SVGSVGElement,group:SVGGElement,line:StyledTextLine,check:()=>void):Promise<Readonly<NativeSvgInlineAllocation>|undefined>{
 const axis=verticalWriting(line.writing)?'y':'x',plain=text.cloneNode(true)as SVGTextElement,flat=text.cloneNode(true)as SVGTextElement,defs=document.createElementNS(NS,'defs'),path=document.createElementNS(NS,'path');
 const reset=(node:SVGTextElement)=>{node.removeAttribute('transform');node.removeAttribute('dx');node.removeAttribute('dy');node.setAttribute('x','0');node.setAttribute('y','0');node.setAttribute('text-anchor',line.direction==='ltr'?'start':'end');};
 reset(plain);reset(flat);for(const content of plain.querySelectorAll('textPath'))content.replaceWith(...content.childNodes);
 const read=async(node:SVGTextElement,padding=0)=>{
  check();const count=node.getNumberOfChars();check();if(!Number.isInteger(count)||count<0)throw new Error('Native inline addressing is invalid.');
  const rows:StyledTextCharacterGeometry[]=[];let deadline=performance.now()+2;
  for(let index=0;index<count;index++){
   check();const a=node.getStartPositionOfChar(index);check();const b=node.getEndPositionOfChar(index);check();const box=node.getExtentOfChar(index);check();const rotation=node.getRotationOfChar(index);check();
   if(![a.x,a.y,b.x,b.y,box.x,box.y,box.width,box.height,rotation].every(Number.isFinite)||box.width<0||box.height<0)throw new Error('Native inline geometry is invalid.');
   const shift=!a.x&&!a.y&&!b.x&&!b.y&&!box.width&&!box.height&&!rotation?0:padding;
   rows.push(Object.freeze({index,start:Object.freeze({x:a.x-(axis==='x'?shift:0),y:a.y-(axis==='y'?shift:0)}),end:Object.freeze({x:b.x-(axis==='x'?shift:0),y:b.y-(axis==='y'?shift:0)}),extent:Object.freeze({x:box.x-(axis==='x'?shift:0),y:box.y-(axis==='y'?shift:0),width:box.width,height:box.height}),rotation}));
   if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
  }return Object.freeze(rows);
 };
 const range=(rows:readonly StyledTextCharacterGeometry[])=>{let min=Infinity,max=-Infinity;for(const c of rows){min=Math.min(min,c.start[axis],c.end[axis]);max=Math.max(max,c.start[axis],c.end[axis]);}if(!Number.isFinite(min)||!Number.isFinite(max))throw new Error('Native inline extent is invalid.');return Object.freeze({min,max});};
 try{
  check();group.append(plain);const layout=await read(plain);if(!layout.length)return;
  let extent=0;for(const c of layout)extent=Math.max(extent,Math.abs(c.start[axis]),Math.abs(c.end[axis]),Math.abs(c.extent[axis]),Math.abs(c.extent[axis]+(axis==='x'?c.extent.width:c.extent.height)));
  // A power-of-two margin keeps the baseline origin exactly representable.
  // Native coordinate/allocation failures still reject; sources are not capped.
  const padding=2**Math.ceil(Math.log2(Math.max(64,extent+16))),length=padding*4;
  if(!Number.isFinite(length)||!Number.isFinite(Math.fround(length)))throw new Error('Native inline baseline is not representable.');
  const id='canoli-signed-inline-baseline';path.setAttribute('id',id);path.setAttribute('d',`M0 0${axis==='y'?'V':'H'}${length}`);defs.append(path);svg.prepend(defs);
  const content=flat.querySelector('textPath');if(!content)return;content.setAttribute('href','#'+id);content.setAttribute('startOffset',String(padding));group.append(flat);
  const characters=await read(flat,padding);if(characters.length!==layout.length)throw new Error('Native inline addressing differs from its source.');
  // Withhold incomplete metadata if the native host still clips a source item.
  if(characters.some((c,i)=>hidden(c)&&!hidden(layout[i])))return;
  const witness=characters.findIndex(c=>!hidden(c));if(witness<0)return;
  check();const first=flat.getStartPositionOfChar(witness)[axis];check();flat.setAttribute('text-anchor',line.direction==='ltr'?'end':'start');check();const last=flat.getStartPositionOfChar(witness)[axis];check();const anchorExtent=first-last;
  if(!Number.isFinite(anchorExtent))throw new Error('Native inline anchor is invalid.');
  return Object.freeze({characters,range:range(characters),layoutRange:range(layout),anchorExtent});
 }finally{plain.remove();flat.remove();defs.remove();}
}
