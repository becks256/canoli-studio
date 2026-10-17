import {useState} from 'react';
import type {VectorPath} from '../dom';
import {vectorStrokeSchema} from '../core/vector-stroke';
import {NumberField,Select,Button} from './controls';

/** Text dashes are a draft; only Apply/Enter submits one validated command. */
export function VectorStrokeControls({path,disabled,onAction}:{path:VectorPath;disabled:boolean;onAction(action:()=>void):void}){
 const value=path.strokeDashArray.join(', '),[previous,setPrevious]=useState(value),[draft,setDraft]=useState(value),[error,setError]=useState('');
 if(value!==previous){setPrevious(value);setDraft(value);setError('');}
 const apply=()=>{
  try{
   const text=draft.trim();if(/^,|,$|,\s*,/.test(text))throw new Error('Use nonnegative numbers separated by commas or spaces.');
   const tokens=text?text.split(/\s*,\s*|\s+/):[];
   if(tokens.some(token=>!/^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)))throw new Error('Use nonnegative dash and gap lengths in pixels.');
   const parsed=vectorStrokeSchema.safeParse({strokeDashArray:tokens.map(Number)});if(!parsed.success)throw new Error('Use up to 256 finite nonnegative dash and gap lengths.');const {strokeDashArray}=parsed.data;setError('');onAction(()=>{path.strokeDashArray=strokeDashArray!;});
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
 };
 return <div className="vector-stroke-controls">
  <Select layout="stacked" label="Stroke cap" value={path.strokeCap} options={['butt','round','square']} disabled={disabled} onChange={value=>onAction(()=>{path.strokeCap=value as VectorPath['strokeCap'];})}/>
  <Select layout="stacked" label="Stroke join" value={path.strokeJoin} options={['miter','round','bevel']} disabled={disabled} onChange={value=>onAction(()=>{path.strokeJoin=value as VectorPath['strokeJoin'];})}/>
  <NumberField layout="stacked" label="Stroke miter limit" value={path.strokeMiterLimit} min={1} max={Number.MAX_SAFE_INTEGER} disabled={disabled||path.strokeJoin!=='miter'} onCommit={value=>onAction(()=>{path.strokeMiterLimit=value;})}/>
  <label className="stroke-dash-field"><span>Dash / gap lengths (px)</span><input aria-label="Stroke dash array" value={draft} maxLength={8192} disabled={disabled} placeholder="Solid" onChange={event=>{setDraft(event.target.value);setError('');}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();apply();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(value);setError('');}}}/></label>
  <div className="stroke-dash-actions"><Button size="sm" disabled={disabled||draft===value} onClick={apply}>Apply dashes</Button><Button size="sm" variant="subtle" disabled={disabled||!path.strokeDashArray.length} onClick={()=>onAction(()=>{path.strokeDashArray=[];})}>Solid stroke</Button></div>
  {error&&<p role="alert">{error}</p>}
  <NumberField layout="stacked" label="Stroke dash offset" value={path.strokeDashOffset} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} disabled={disabled} suffix="px" onCommit={value=>onAction(()=>{path.strokeDashOffset=value;})}/>
 </div>;
}
