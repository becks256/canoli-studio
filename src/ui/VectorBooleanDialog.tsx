import { useEffect, useMemo, useRef, useState } from 'react';
import { allLayers, isLocked } from '../core/model';
import { VectorLayer, type Document, type VectorPath, type VectorBooleanOperation, type VectorBooleanProgress } from '../dom';
import { Dialog } from './Dialog';
import { Button, Select, TextInput } from './controls';

export function VectorBooleanDialog({document:doc,onClose,onResult}:{document:Document;onClose():void;onResult(path:VectorPath|null):void}){
 const [source]=useState(()=>{
  const snapshot=doc.getSnapshot(),selected=new Set(doc.selectedLayers.map(l=>l.id));
  const candidates=allLayers(snapshot.document.children).flatMap(layer=>layer.kind==='vector'?layer.paths.map((path,index)=>({
   key:JSON.stringify([layer.id,path.id]),layerId:layer.id,pathId:path.id,label:`${layer.name} · Path ${index+1}`,disabled:!path.closed||isLocked(snapshot.document,layer.id),selected:selected.has(layer.id),
  })):[]);
  return{revision:snapshot.revision,candidates,byKey:new Map(candidates.map(c=>[c.key,c]))};
 });
 const [chosen,setChosen]=useState(()=>{const initial=source.candidates.filter(c=>c.selected&&!c.disabled).map(c=>c.key);return initial.length>128?[]:initial.length?initial:source.candidates.filter(c=>!c.disabled).slice(0,2).map(c=>c.key);});
 const [operation,setOperation]=useState<VectorBooleanOperation>('union'),[search,setSearch]=useState(''),[page,setPage]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<VectorBooleanProgress>();
 const active=useRef<AbortController|null>(null);useEffect(()=>()=>active.current?.abort(),[]);
 const close=()=>{active.current?.abort();onClose();};
 const entries=source.byKey,matches=useMemo(()=>source.candidates.filter(c=>c.label.toLowerCase().includes(search.toLowerCase())),[source,search]),count=Math.ceil(matches.length/32),current=Math.min(page,Math.max(0,count-1));
 return <Dialog titleId="vector-boolean-title" onClose={close}>
  <div className="dialog-heading"><h2 id="vector-boolean-title">Combine vector paths</h2></div>
  <p className="script-description">Combine closed path areas. The first operand supplies paint and layer appearance; other operands supply geometry. Stroke outlines, masks and effects are excluded from the area calculation. Empty operand layers are removed.</p>
  <form onSubmit={async event=>{
   event.preventDefault();if(working)return;const abort=new AbortController();active.current=abort;setWorking(true);setError('');setProgress(undefined);
   try{
    if(doc.getSnapshot().revision!==source.revision)throw new Error('The document changed. Close this dialog and choose operands again.');
    const paths=chosen.map(key=>{const ref=entries.get(key)!,layer=doc.getLayer(ref.layerId);if(!(layer instanceof VectorLayer))throw new Error('Vector layer no longer exists.');const p=layer.paths.get(ref.pathId);if(!p)throw new Error('Path no longer exists.');return p;});
    const result=await doc.combinePaths(operation,paths,{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted){onResult(result);onClose();}
   }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Boolean operation failed.');}
   finally{if(active.current===abort)active.current=null;setWorking(false);}
  }}>
   <Select label="Boolean operation" value={operation} disabled={working} options={[{value:'union',label:'Union'},{value:'subtract',label:'Subtract from first'},{value:'intersect',label:'Intersect'},{value:'exclude',label:'Exclude overlap'}]} onChange={v=>setOperation(v as VectorBooleanOperation)}/>
   <p className="text-muted">{chosen.length} selected · 2–128 paths, 128 contours and 20,000 anchors in total. {operation==='subtract'?'Subtract removes every later operand from the first.':operation==='exclude'?'Exclude applies symmetric difference to the chosen areas.':''}</p>
   <TextInput label="Find path" value={search} disabled={working} onChange={value=>{setSearch(value);setPage(0);}}/>
   <div className="boolean-path-list" role="group" aria-label="Boolean operands">
    {matches.slice(current*32,(current+1)*32).map(candidate=><label className="check-field" key={candidate.key}>
     <input type="checkbox" aria-label={candidate.label} checked={chosen.includes(candidate.key)} disabled={working||candidate.disabled||chosen.length>=128&&!chosen.includes(candidate.key)} onChange={event=>setChosen(values=>event.target.checked?[...values,candidate.key]:values.filter(key=>key!==candidate.key))}/>{candidate.label}{candidate.disabled?' · closed and unlocked required':''}
    </label>)}
   </div>
   {count>1&&<div className="artboard-actions"><Button type="button" variant="subtle" disabled={working||current===0} onClick={()=>setPage(current-1)}>Previous paths</Button><span>{current+1} / {count}</span><Button type="button" variant="subtle" disabled={working||current>=count-1} onClick={()=>setPage(current+1)}>Next paths</Button></div>}
   {chosen.length>0&&<Select label="First Boolean operand" value={chosen[0]} disabled={working} options={chosen.map(key=>({value:key,label:entries.get(key)!.label}))} onChange={key=>setChosen(values=>[key,...values.filter(k=>k!==key)])}/>}
   {working&&<div role="status">Combining vector paths… <progress aria-label="Boolean progress" max={progress?.total??1} value={progress?.completed??0}/></div>}
   {error&&<p role="alert">{error}</p>}
   <div className="artboard-actions"><Button type="button" variant="subtle" onClick={close}>Cancel</Button><Button type="submit" variant="primary" disabled={working||chosen.length<2}>Combine paths</Button></div>
  </form>
 </Dialog>;
}
