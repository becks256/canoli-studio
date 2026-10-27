import {useLayoutEffect,useRef} from 'react';
import type {SpacingGuide} from '../core/spacing';
const spacingFormat=new Intl.NumberFormat('en',{maximumFractionDigits:3});
/** DOM lines and screen-sized labels; no document-sized bitmap allocation. */
export function SpacingOverlay({guides,zoom}:{guides:readonly SpacingGuide[];zoom:number}){
 const host=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(!guides.length)return;
  const place=()=>{
   const labels=[...host.current?.querySelectorAll<HTMLSpanElement>('.spacing-guide > span')??[]];
   for(const label of labels)label.style.translate='';
   const frames=labels.map(label=>label.getBoundingClientRect()),placed:{left:number;right:number;top:number;bottom:number}[]=[];
   frames.forEach((rect,index)=>{
    const horizontal=guides[index].axis==='x';let dx=0,dy=0,box={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
    for(let attempt=0;attempt<=placed.length;attempt++){
     const collisions=placed.filter(other=>box.left<other.right+3&&box.right>other.left-3&&box.top<other.bottom+3&&box.bottom>other.top-3);
     if(!collisions.length)break;
     if(horizontal)dy=Math.min(...collisions.map(other=>other.top))-rect.height-4-rect.top;
     else dx=Math.max(...collisions.map(other=>other.right))+4-rect.left;
     box={left:rect.left+dx,right:rect.right+dx,top:rect.top+dy,bottom:rect.bottom+dy};
    }
    labels[index].style.translate=`${dx}px ${dy}px`;placed.push(box);
   });
  };
  place();document.fonts?.addEventListener('loadingdone',place);return()=>document.fonts?.removeEventListener('loadingdone',place);
 },[guides,zoom]);
 if(!guides.length)return null;
 return <div ref={host} className="spacing-overlay" aria-hidden="true">{guides.map((guide,index)=>{
  const horizontal=guide.axis==='x',label=spacingFormat.format(guide.gap),rounded=Number(guide.gap.toFixed(3))!==guide.gap;
  return <div key={index} aria-hidden="true" className={`spacing-guide ${horizontal?'horizontal':'vertical'}${guide.equal?' equal':''}`} data-axis={guide.axis} data-gap={guide.gap} data-equal={guide.equal} style={horizontal?{left:guide.from*zoom,top:guide.at*zoom,width:(guide.to-guide.from)*zoom}:{left:guide.at*zoom,top:guide.from*zoom,height:(guide.to-guide.from)*zoom}}><span title={`${guide.gap} document pixels${guide.equal?' · Equal spacing':''}`}>{rounded?'≈ ':''}{label} px{guide.equal?' =':''}</span></div>;
 })}</div>;
}
