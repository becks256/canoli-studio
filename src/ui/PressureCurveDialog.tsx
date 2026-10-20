import {useState} from 'react';
import {X} from 'lucide-react';
import {Dialog} from './Dialog';
import {Button,IconButton,Slider,Select} from './controls';
import {pressureCurveSchema,PRESSURE_CURVE_PRESETS,type PressureCurveData} from '../core/pressure-curve';

export function PressureCurveDialog({curve,onApply,onClose,variant='pressure'}:{curve:PressureCurveData|null;onApply(curve:PressureCurveData|null):void;onClose():void;variant?:'pressure'|'tilt'}){
 const tilt=variant==='tilt',title=tilt?'Tilt response':'Pressure response',titleId=tilt?'tilt-curve-title':'pressure-curve-title';
 const [useDefault,setUseDefault]=useState(!curve);
 const [draft,setDraft]=useState(()=>structuredClone(curve??PRESSURE_CURVE_PRESETS.linear));
 const parsed=pressureCurveSchema.safeParse(draft);
 const preset=Object.entries(PRESSURE_CURVE_PRESETS).find(([,value])=>JSON.stringify(value)===JSON.stringify(draft))?.[0]??'custom';
 const change=(index:number,field:'input'|'output',value:number)=>{setUseDefault(false);setDraft(current=>({points:current.points.map((point,i)=>i===index?{...point,[field]:value}:point)}));};
 const add=()=>{setUseDefault(false);setDraft(current=>{
  let after=0;for(let i=1;i<current.points.length-1;i++)if(current.points[i+1].input-current.points[i].input>current.points[after+1].input-current.points[after].input)after=i;
  const a=current.points[after],b=current.points[after+1],points=[...current.points];points.splice(after+1,0,{input:(a.input+b.input)/2,output:(a.output+b.output)/2});return{points};
 });};
 const save=()=>{if(!parsed.success)return;onApply(useDefault?null:parsed.data);};
 return <Dialog titleId={titleId} className="pressure-curve-dialog" onClose={onClose} localEscape={tilt}>
  <div className="dialog-heading"><div><span className="section-caption">BRUSH DYNAMICS</span><h2 id={titleId}>{title}</h2></div><IconButton label={tilt?"Close tilt response":"Close pressure response"} onClick={onClose} autoFocus><X size={19}/></IconButton></div>
  <p>{tilt?"Shape how pen inclination flattens the tip. Enable Tilt roundness to use the curve. Changes apply to new strokes.":"Shape how recorded pressure changes brush size and opacity. Enable Pressure size or Pressure opacity to use the curve. Changes apply to new strokes."}</p>
  <Select label={tilt?"Tilt response preset":"Response preset"} layout="stacked" value={useDefault?'default':preset} options={[{value:'default',label:tilt?'Default (linear)':'Default response'},{value:'custom',label:'Custom'},{value:'linear',label:'Linear'},{value:'soft',label:tilt?'Soft — earlier flattening':'Soft — lighter pressure'},{value:'firm',label:tilt?'Firm — later flattening':'Firm — heavier pressure'}]} onChange={value=>{setUseDefault(value==='default');if(value!=='custom')setDraft(structuredClone(PRESSURE_CURVE_PRESETS[value==='default'?'linear':value as keyof typeof PRESSURE_CURVE_PRESETS]));}}/>
  {useDefault?<p>{tilt?"Default tilt response increases flattening linearly from upright to horizontal. The tip retains at least 1% roundness.":"Default response keeps a minimum size of 5% and opacity of 1% when pressure controls are enabled. Choose a curve for the full response, including zero."}</p>:<>
  <svg viewBox="-30 -10 240 230" role="img" aria-label={tilt?"Tilt response graph: pen tilt horizontally, flattening vertically":"Pressure response graph: input pressure horizontally, brush response vertically"} className="pressure-curve-graph">
   <path d="M0 0 V180 H180" fill="none" stroke="currentColor" opacity=".3"/>
   <path d="M0 180 L180 0" fill="none" stroke="currentColor" opacity=".2" strokeDasharray="3 3"/>
   <polyline points={draft.points.map(point=>`${point.input*180},${(1-point.output)*180}`).join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth="2"/>
   {draft.points.map((point,i)=><circle key={i} cx={point.input*180} cy={(1-point.output)*180} r="3" fill="var(--color-accent)"/>)}
   <text x="90" y="205" textAnchor="middle" fill="currentColor" fontSize="10">{tilt?"Pen tilt":"Input pressure"}</text><text x="-22" y="90" textAnchor="middle" transform="rotate(-90 -22 90)" fill="currentColor" fontSize="10">{tilt?"Flattening":"Brush response"}</text>
  </svg>
  {!parsed.success&&<p role="alert">{parsed.error.issues[0].message}</p>}
  <div className="pressure-curve-points">{draft.points.map((point,index)=><div className="pressure-curve-point" role="group" aria-label={`${tilt?"Tilt":"Pressure"} point ${index+1}`} key={index}>
   <Slider label={`Point ${index+1} input`} suffix="%" value={point.input*100} min={0} max={100} step={1} disabled={index===0||index===draft.points.length-1} onPreview={value=>change(index,'input',value/100)} onCommit={value=>change(index,'input',value/100)}/>
   <Slider label={`Point ${index+1} output`} suffix="%" value={point.output*100} min={0} max={100} step={1} onPreview={value=>change(index,'output',value/100)} onCommit={value=>change(index,'output',value/100)}/>
   <Button variant="subtle" aria-label={`Remove ${tilt?"tilt":"pressure"} point ${index+1}`} disabled={index===0||index===draft.points.length-1} onClick={()=>setDraft(current=>({points:current.points.filter((_,i)=>i!==index)}))}>Remove</Button>
  </div>)}</div></>}
  <div className="pressure-curve-actions"><Button disabled={!parsed.success||draft.points.length>=16} onClick={add}>Add point</Button><Button onClick={()=>{setUseDefault(false);setDraft(structuredClone(PRESSURE_CURVE_PRESETS.linear));}}>Reset to linear</Button><Button onClick={onClose}>Cancel</Button><Button disabled={!parsed.success} onClick={save}>Apply response</Button></div>
 </Dialog>;
}
