import {useState,useMemo} from 'react';
import {X} from 'lucide-react';
import {BrushSymmetry} from '../dom';
import type {BrushSymmetryData} from '../core/brush-symmetry';
import {symmetryMatrices} from '../core/brush-symmetry';
import {AffineTransform} from '../core/affine';
import {Dialog} from './Dialog';
import {Button,IconButton,Select,NumberField,Slider} from './controls';

type Mode='none'|'vertical'|'horizontal'|'both'|'radial'|'custom';
export function symmetryDraft(data:BrushSymmetryData|null,width:number,height:number):{mode:Mode;x:number;y:number;count:number}{
 const initial={mode:'none' as Mode,x:width/2,y:height/2,count:4};if(!data)return initial;
 const first=data.copies[0],same=(candidate:BrushSymmetry)=>{const a=candidate.toJSON().copies;return a.length===data.copies.length&&a.every((m,i)=>Object.keys(m).every(key=>{const k=key as keyof typeof m;return Math.abs(m[k]-data.copies[i][k])<=1e-10*Math.max(1,Math.abs(m[k]),Math.abs(data.copies[i][k]));}));};
 if(data.copies.length===1&&same(BrushSymmetry.mirrorVertical(first.e/2)))return{...initial,mode:'vertical',x:first.e/2};
 if(data.copies.length===1&&same(BrushSymmetry.mirrorHorizontal(first.f/2)))return{...initial,mode:'horizontal',y:first.f/2};
 if(data.copies.length===3){const x=first.e/2,y=data.copies[1].f/2;if(same(BrushSymmetry.bothAxes({x,y})))return{...initial,mode:'both',x,y};}
 try{const center=new AffineTransform(1-first.a,-first.b,-first.c,1-first.d).inverse().point({x:first.e,y:first.f}),count=data.copies.length+1;if(same(BrushSymmetry.radial(center,count)))return{mode:'radial',x:center.x,y:center.y,count};}catch{/* Custom affine copies remain intact. */}
 return{...initial,mode:'custom'};
}
function value(mode:Mode,x:number,y:number,count:number,custom:BrushSymmetryData|null){
 if(mode==='none')return null;if(mode==='custom')return custom;
 return(mode==='vertical'?BrushSymmetry.mirrorVertical(x):mode==='horizontal'?BrushSymmetry.mirrorHorizontal(y):mode==='both'?BrushSymmetry.bothAxes({x,y}):BrushSymmetry.radial({x,y},count)).toJSON();
}
export function BrushSymmetryGuides({data,width,height}:{data:BrushSymmetryData|null;width:number;height:number}){
 const draft=useMemo(()=>symmetryDraft(data,width,height),[data,width,height]);if(draft.mode==='none'||draft.mode==='custom')return null;
 const {mode,x,y,count}=draft,reach=Math.hypot(width,height,Math.abs(x),Math.abs(y))*2;
 return <g data-testid="brush-symmetry-guides" fill="none" stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="5 5" opacity=".65">
  {(mode==='vertical'||mode==='both')&&<path d={`M${x} 0V${height}`} vectorEffect="non-scaling-stroke"/>}
  {(mode==='horizontal'||mode==='both')&&<path d={`M0 ${y}H${width}`} vectorEffect="non-scaling-stroke"/>}
  {mode==='radial'&&Array.from({length:count},(_,i)=>{const angle=2*Math.PI*i/count;return <path key={i} d={`M${x} ${y}L${x+Math.cos(angle)*reach} ${y+Math.sin(angle)*reach}`} vectorEffect="non-scaling-stroke"/>;})}
 </g>;
}
export function BrushSymmetryDialog({symmetry,width,height,onApply,onClose}:{symmetry:BrushSymmetryData|null;width:number;height:number;onApply(value:BrushSymmetryData|null):void;onClose():void}){
 const [draft,setDraft]=useState(()=>symmetryDraft(symmetry,width,height)),[dirty,setDirty]=useState(false);
 const change=(patch:Partial<typeof draft>)=>{setDirty(true);setDraft(current=>({...current,...patch}));};
 let data=symmetry,error='';try{if(dirty)data=value(draft.mode,draft.x,draft.y,draft.count,symmetry);}catch(problem){error=problem instanceof Error?problem.message:String(problem);}
 const radius=Math.min(width,height),marker={x:draft.x-radius/4,y:draft.y-radius/10},size=radius/35;
 let preview:AffineTransform[]=[];try{preview=symmetryMatrices(data??undefined).map(matrix=>{const center=matrix.point(marker),values=[matrix.a*size,matrix.b*size,matrix.c*size,matrix.d*size];return new AffineTransform(...values as [number,number,number,number],center.x,center.y);});}catch{/* Preserve custom values if only diagram precision is unavailable. */}
 return <Dialog titleId="brush-symmetry-title" className="brush-symmetry-dialog" onClose={onClose} localEscape>
  <div className="dialog-heading"><div><span className="section-caption">BRUSH DYNAMICS</span><h2 id="brush-symmetry-title">Brush symmetry</h2></div><IconButton label="Close brush symmetry" autoFocus onClick={onClose}><X size={19}/></IconButton></div>
  <p>Reflect or rotate new ink around document-space lines or a center. Existing strokes keep their captured copies.</p>
  <Select label="Symmetry mode" layout="stacked" value={draft.mode} options={[{value:'none',label:'Off'},{value:'vertical',label:'Vertical mirror'},{value:'horizontal',label:'Horizontal mirror'},{value:'both',label:'Both axes'},{value:'radial',label:'Radial'},...(draft.mode==='custom'?[{value:'custom',label:'Custom copies'}]:[])]} onChange={mode=>change({mode:mode as Mode})}/>
  {draft.mode!=='none'&&draft.mode!=='custom'&&<div className="brush-tip-settings">
   {draft.mode!=='horizontal'&&<NumberField label={draft.mode==='vertical'?'Mirror line X':'Symmetry center X'} value={draft.x} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} onCommit={x=>change({x})} suffix="px"/>}
   {draft.mode!=='vertical'&&<NumberField label={draft.mode==='horizontal'?'Mirror line Y':'Symmetry center Y'} value={draft.y} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} onCommit={y=>change({y})} suffix="px"/>}
  </div>}
  {draft.mode==='radial'&&<Slider label="Radial sectors" value={draft.count} min={2} max={32} step={1} onPreview={count=>change({count})} onCommit={count=>change({count})}/>}
  <svg className="brush-symmetry-preview" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Symmetry copy preview"><rect width={width} height={height} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke"/><BrushSymmetryGuides data={data} width={width} height={height}/>{preview.map((matrix,i)=><path key={i} d="M-3 -2L4 0L-3 2Z" transform={`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`} fill="var(--color-accent)" opacity={i?'.65':'1'}/>)}</svg>{!preview.length&&<p>Preview is unavailable at these transform scales. The captured values remain preserved.</p>}
  <p className="text-muted">The diagram uses a marker to show {1+(data?.copies.length??0)} {data?'copies':'original'}. Overlapping copies build flow together; stroke opacity applies once. All copies obey the same selection.</p>
  {draft.mode==='custom'&&<p>These custom copies will be kept. Choose another mode to replace them.</p>}
  {error&&<p role="alert">{error}</p>}
  <div className="brush-tip-actions end"><Button disabled={draft.mode==='custom'||draft.mode==='none'} onClick={()=>change({x:width/2,y:height/2})}>Center on canvas</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!error} onClick={()=>onApply(data)}>Apply symmetry</Button></div>
 </Dialog>;
}
