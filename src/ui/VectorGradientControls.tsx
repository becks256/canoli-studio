import type {VectorPath} from '../dom';
import type {VectorGradientData,VectorGradientStop} from '../core/vector-gradient';
import {gradientStopColor} from '../core/vector-gradient';
import {bezierGeometryBounds} from '../core/bezier-bounds';
import {pathContours} from '../core/drawing';
import {Button,Select,NumberField,Slider} from './controls';

export function VectorGradientControls({path,disabled,onAction,onPreview,previewGradient}:{path:VectorPath;disabled:boolean;onAction(action:()=>void):void;onPreview(value:VectorGradientData):void;previewGradient?:VectorGradientData|null}){
 const gradient=previewGradient??path.fillGradient;
 const commit=(value:VectorGradientData)=>onAction(()=>{path.fillGradient=value;});
 const changeKind=(kind:string)=>{
  if(kind==='solid'){onAction(()=>path.update({fill:path.fill??gradient?.stops[0].color??'#d5e79b',fillGradient:null}));return;}
  const bounds=bezierGeometryBounds(pathContours(path.toJSON())),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
  const stops=gradient?.stops??[{position:0,color:path.fill??'#d5e79b'},{position:1,color:'#202d17'}];
  commit(kind==='linear'?{kind:'linear',start:{x:bounds.x,y:cy},end:{x:bounds.x+(bounds.width||1),y:cy},stops}:{kind:'radial',start:{x:cx,y:cy,radius:0},end:{x:cx,y:cy,radius:Math.max(bounds.width,bounds.height)/2||1},stops});
 };
 const replace=(index:number,patch:Partial<VectorGradientStop>)=>{if(gradient)commit({...gradient,stops:gradient.stops.map((stop,i)=>i===index?{...stop,...patch}:stop)});};
 const gap=gradient?.stops.slice(1).map((stop,i)=>({i,width:stop.position-gradient.stops[i].position})).sort((a,b)=>b.width-a.width)[0];
 return <div className="vector-gradient-controls">
  <Select label="Path fill type" value={gradient?.kind??'solid'} options={['solid','linear','radial']} disabled={disabled} onChange={changeKind}/>
  {gradient&&<>
   <div className="gradient-map-ramp" role="img" aria-label="Path gradient colors" style={{background:`linear-gradient(to right,${gradient.stops.map(stop=>`${gradientStopColor(stop)} ${stop.position*100}%`).join(',')})`}}/>
   {(['start','end'] as const).map(end=><div className="gradient-geometry" key={end}>
    {(['x','y'] as const).map(axis=><NumberField key={axis} layout="stacked" label={`Gradient ${end} ${axis}`} value={gradient[end][axis]} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} disabled={disabled} onCommit={value=>commit({...gradient,[end]:{...gradient[end],[axis]:value}})}/>)}
    {gradient.kind==='radial'&&<NumberField layout="stacked" label={`Gradient ${end} radius`} value={gradient[end].radius} min={end==='end'?Number.MIN_VALUE:0} max={Number.MAX_SAFE_INTEGER} disabled={disabled} onCommit={radius=>commit({...gradient,[end]:{...gradient[end],radius}})}/>}
   </div>)}
   {gradient.stops.map((stop,index)=><div className="vector-gradient-stop" key={index}>
    <label>Stop {index+1}<input type="color" aria-label={`Gradient stop ${index+1} color`} value={stop.color} disabled={disabled} onChange={event=>replace(index,{color:event.target.value})}/></label>
    <NumberField label={`Gradient stop ${index+1} position`} value={stop.position*100} min={index?gradient.stops[index-1].position*100:0} max={index<gradient.stops.length-1?gradient.stops[index+1].position*100:100} suffix="%" disabled={disabled} onCommit={position=>replace(index,{position:position/100})}/>
    <Slider label={`Gradient stop ${index+1} opacity`} value={(stop.opacity??1)*100} min={0} max={100} suffix="%" disabled={disabled} onPreview={opacity=>onPreview({...gradient,stops:gradient.stops.map((entry,i)=>i===index?{...entry,opacity:opacity/100}:entry)})} onCommit={opacity=>replace(index,{opacity:opacity/100})}/>
    <Button variant="subtle" size="sm" aria-label={`Remove gradient stop ${index+1}`} disabled={disabled||gradient.stops.length<=2} onClick={()=>commit({...gradient,stops:gradient.stops.filter((_,i)=>i!==index)})}>Remove</Button>
   </div>)}
   <div className="stroke-dash-actions"><Button size="sm" disabled={disabled||gradient.stops.length>=32} onClick={()=>{
    if(!gap||gap.width<=0){commit({...gradient,stops:[...gradient.stops,{...gradient.stops.at(-1)!}]});return;}const left=gradient.stops[gap.i],right=gradient.stops[gap.i+1],stop={position:(left.position+right.position)/2,color:'#'+[1,3,5].map(offset=>Math.round((parseInt(left.color.slice(offset,offset+2),16)+parseInt(right.color.slice(offset,offset+2),16))/2).toString(16).padStart(2,'0')).join(''),opacity:((left.opacity??1)+(right.opacity??1))/2};
    commit({...gradient,stops:[...gradient.stops.slice(0,gap.i+1),stop,...gradient.stops.slice(gap.i+1)]});
   }}>Add fill stop</Button><Button size="sm" variant="subtle" disabled={disabled} onClick={()=>commit({...gradient,stops:gradient.stops.slice().reverse().map(stop=>({...stop,position:1-stop.position}))})}>Reverse fill</Button></div>
   <details><summary>Gradient transform</summary>{(['a','b','c','d','e','f'] as const).map(key=><NumberField key={key} label={`Gradient transform ${key}`} value={gradient.transform?.[key]??(key==='a'||key==='d'?1:0)} min={-Number.MAX_VALUE} max={Number.MAX_VALUE} disabled={disabled} onCommit={value=>commit({...gradient,transform:{a:1,b:0,c:0,d:1,e:0,f:0,...gradient.transform,[key]:value}})}/>)}</details>
  </>}
 </div>;
}
