import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {BrushTip} from '../dom/values';
import {brushTipSchema,type BrushTipData} from '../core/brush-tip';
import {paintStampGeometry} from '../core/paint-stamps';
import {Dialog} from './Dialog';
import {Button,IconButton,Select,Slider} from './controls';
import {PressureCurveDialog} from './PressureCurveDialog';

export function BrushTipDialog({tip,pencil=false,onApply,onClose}:{tip:BrushTipData|null;pencil?:boolean;onApply(tip:BrushTipData|null):void;onClose():void}){
 const [useDefault,setUseDefault]=useState(!tip),[draft,setDraft]=useState(()=>new BrushTip(tip??{}).toJSON());
 const [previewTilt,setPreviewTilt]=useState(45),[previewDirection,setPreviewDirection]=useState(45),[editCurve,setEditCurve]=useState(false);
 const previousCurve=useRef(false);
 useEffect(()=>{let frame:number|undefined;if(previousCurve.current&&!editCurve)frame=requestAnimationFrame(()=>document.getElementById('tip-tilt-curve-trigger')?.focus());previousCurve.current=editCurve;return()=>{if(frame!==undefined)cancelAnimationFrame(frame);};},[editCurve]);
 const change=(patch:Partial<BrushTipData>)=>{setUseDefault(false);setDraft(current=>({...current,...patch}));};
 const parsed=brushTipSchema.safeParse(draft);
 const geometry=paintStampGeometry({kind:pencil?'pencil':'brush',size:120,pressureSize:false,tip:useDefault?undefined:draft},{x:0,y:0,pressure:1,tilt:{altitude:(90-previewTilt)*Math.PI/180,azimuth:previewDirection*Math.PI/180}});
 if(editCurve)return <PressureCurveDialog variant="tilt" curve={draft.tiltCurve??null} onClose={()=>setEditCurve(false)} onApply={curve=>{setDraft(current=>{const next={...current};if(curve)next.tiltCurve=curve;else delete next.tiltCurve;return next;});setUseDefault(false);setEditCurve(false);}}/>;
 return <Dialog titleId="brush-tip-title" className="brush-tip-dialog" onClose={onClose} localEscape>
  <div className="dialog-heading"><div><span className="section-caption">BRUSH DYNAMICS</span><h2 id="brush-tip-title">Brush tip</h2></div><IconButton label="Close brush tip" autoFocus onClick={onClose}><X size={19}/></IconButton></div>
  <p>Shape the tip and choose how stylus tilt changes its angle and roundness. Existing strokes keep their authored settings.</p>
  <Select label="Tip type" layout="stacked" value={useDefault?'default':'shaped'} options={[{value:'default',label:pencil?'Default square pencil':'Default round tip'},{value:'shaped',label:'Shaped tip'}]} onChange={value=>setUseDefault(value==='default')}/>
  <svg className="brush-tip-preview" viewBox="0 0 280 180" role="img" aria-label="Tip footprint preview"><path d="M20 90H260M140 10V170" stroke="currentColor" opacity=".15"/><g transform={`matrix(${geometry.cos} ${geometry.sin} ${-geometry.sin} ${geometry.cos} 140 90)`} fill="var(--color-accent)" fillOpacity=".35" stroke="var(--color-accent)" strokeWidth="1">{pencil?<rect x={-geometry.rx} y={-geometry.ry} width={geometry.rx*2} height={geometry.ry*2}/>:<ellipse rx={geometry.rx} ry={geometry.ry}/>}</g></svg>
  {!useDefault&&<><div className="brush-tip-settings"><Slider label="Tip roundness" value={draft.roundness*100} min={1} max={100} suffix="%" onPreview={value=>change({roundness:value/100})} onCommit={value=>change({roundness:value/100})}/><Slider label="Tip angle" value={draft.angle} min={-180} max={180} suffix="°" onPreview={value=>change({angle:value})} onCommit={value=>change({angle:value})}/></div>
   <div className="brush-tip-actions"><label className="check-field"><input type="checkbox" checked={draft.tiltAngle??false} onChange={event=>change({tiltAngle:event.target.checked})}/>Tilt controls angle</label><label className="check-field"><input type="checkbox" checked={draft.tiltRoundness??false} onChange={event=>change({tiltRoundness:event.target.checked})}/>Tilt controls roundness</label><Button id="tip-tilt-curve-trigger" onClick={()=>setEditCurve(true)}>Tilt response…</Button></div>
   <p className="text-muted">Tilt roundness uses {draft.tiltCurve?`${draft.tiltCurve.points.length} authored response points`:'a linear response'}. At least 1% roundness remains. A mouse uses the authored angle and roundness.</p></>}
  <p className="text-muted">Preview controls affect this diagram only.</p><div className="brush-tip-settings"><Slider label="Preview tilt from upright" value={previewTilt} min={0} max={90} suffix="°" onPreview={setPreviewTilt} onCommit={setPreviewTilt}/><Slider label="Preview direction" value={previewDirection} min={0} max={360} suffix="°" onPreview={setPreviewDirection} onCommit={setPreviewDirection}/></div>
  {!parsed.success&&<p role="alert">{parsed.error.issues[0].message}</p>}
  <div className="brush-tip-actions end"><Button onClick={()=>{setUseDefault(true);setDraft(new BrushTip().toJSON());}}>Use default tip</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!parsed.success} onClick={()=>onApply(useDefault?null:parsed.success?parsed.data:null)}>Apply tip</Button></div>
 </Dialog>;
}
