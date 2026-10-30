import type {KeyboardEvent} from 'react';
import {perspectiveLocalQuad,IDENTITY_PERSPECTIVE,type PerspectiveData} from '../core/perspective';
import type {AffineTransform} from '../core/affine';
import {PERSPECTIVE_CORNER_BINDINGS} from './shortcuts';

export function PerspectiveOverlay({layer,world,zoom,onNudge}:{
  layer:{width:number;height:number;perspective?:PerspectiveData|null};world:AffineTransform;zoom:number;
  onNudge(index:number,dx:number,dy:number):void;
}){
  const points=perspectiveLocalQuad(layer.width,layer.height,layer.perspective??{corners:IDENTITY_PERSPECTIVE}).map(p=>world.point(p));
  const key=(event:KeyboardEvent,index:number)=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.nativeEvent.isComposing)return;
    const delta=PERSPECTIVE_CORNER_BINDINGS[event.key];
    if(delta){event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;onNudge(index,delta.x*step,delta.y*step);}
    else if(event.key===' '||event.key==='Enter'){event.preventDefault();event.stopPropagation();}
  };
  return <div className="perspective-corners" role="group" aria-label="Perspective corners">
    {['Top left','Top right','Bottom right','Bottom left'].map((name,index)=><button type="button" key={name}
      className="perspective-corner" data-perspective-corner={index} aria-label={`${name} perspective corner`}
      title="Drag this corner. Arrow keys move 1 canvas pixel; Shift moves 10."
      style={{left:points[index].x*zoom,top:points[index].y*zoom}} onKeyDown={event=>key(event,index)}/>) }
  </div>;
}
