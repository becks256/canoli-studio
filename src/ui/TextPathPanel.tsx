import {useEffect,useRef,useState} from 'react';
import {TextPath,VectorLayer,type TextLayer} from '../dom';
import {allLayers} from '../core/model';
import {layerTransform} from '../core/spatial';
import {splitPathSegment} from '../core/bezier';
import {PATH_POINT_LIMIT} from '../core/drawing';
import type {EditorCommand} from '../core/commands';
import {Button,NumberField,Select} from './controls';

export function TextPathPanel({layer,disabled,onAction,onPreview}:{layer:TextLayer;disabled:boolean;onAction:(action:()=>void)=>void;onPreview:(command:EditorCommand)=>void}){
 const owner=layer.document,document=owner?.getSnapshot().document,path=layer.textPath;
 const [page,setPage]=useState(0),[source,setSource]=useState(''),[anchor,setAnchor]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef<AbortController|undefined>(undefined);
 useEffect(()=>()=>{pending.current?.abort();},[layer,owner]);
 const choices=document?allLayers(document.children).flatMap(node=>node.kind==='vector'?node.paths.map((p,index)=>({key:JSON.stringify([node.id,p.id]),layerId:node.id,pathId:p.id,label:`${node.name} — Path ${index+1}`})):[]):[],lastPage=Math.max(0,Math.ceil(choices.length/32)-1),currentPage=Math.min(page,lastPage),visible=choices.slice(currentPage*32,(currentPage+1)*32),chosen=visible.find(c=>c.key===source)??visible[0],blocked=disabled||busy;
 const prepare=async(value:TextPath|null)=>{pending.current?.abort();const request=new AbortController();pending.current=request;setBusy(true);setError('');try{await layer.setTextPath(value,{signal:request.signal});}catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}finally{if(pending.current===request){pending.current=undefined;setBusy(false);}}};
 const attach=()=>{try{if(!owner||!document||!chosen)throw new Error('Choose a vector path.');const vector=owner.getLayer(chosen.layerId);if(!(vector instanceof VectorLayer))throw new Error('The vector source changed.');const data=vector.paths.get(chosen.pathId)?.toJSON();if(!data)throw new Error('The path source changed.');if(data.subpaths?.length)throw new Error('Choose a single-contour path. Compound baselines need separate text objects.');const matrix=layerTransform(document,layer.id)!.inverse().multiply(layerTransform(document,vector.id)!);const points=data.points.map(p=>({...matrix.point(p),in:matrix.point(p.in),out:matrix.point(p.out)}));void prepare(new TextPath({points,closed:data.closed}));}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}};
 const change=(value:TextPath)=>onAction(()=>{layer.textPath=value;});
 const offset=(key:'startOffset'|'baselineOffset',value:number,preview=false)=>{if(!path)return;const next=path.with({[key]:value});if(preview)onPreview({type:'layer.update',id:layer.id,patch:{textPath:next.toJSON()}});else change(next);};
 const index=path?Math.max(0,Math.min(path.points.length-1,Math.trunc(anchor)-1)):0,point=path?.points[index];
 const coordinate=(key:'x'|'y',value:number,handle?:'in'|'out',preview=false)=>{if(!path)return;const points=path.points,p=points[index];if(handle)p[handle][key]=value;else{const delta=value-p[key];p[key]=value;p.in[key]+=delta;p.out[key]+=delta;}const next=path.with({points});if(preview)onPreview({type:'layer.update',id:layer.id,patch:{textPath:next.toJSON()}});else change(next);};
 return <details className="text-path-panel"><summary>Text on a path</summary>
  <p>Copy a vector baseline into this text. The original vector stays independent. Path text uses one logical line. Choose Vector pen (P) to edit this text’s baseline on the canvas.</p>
  {choices.length>0?<><Select label="Baseline source" layout="stacked" value={chosen?.key??''} options={visible.map(c=>({value:c.key,label:c.label}))} disabled={blocked} onChange={setSource}/>{choices.length>32&&<div className="button-row"><Button disabled={currentPage===0||blocked} onClick={()=>setPage(currentPage-1)}>Previous paths</Button><span>{currentPage+1} / {lastPage+1}</span><Button disabled={currentPage===lastPage||blocked} onClick={()=>setPage(currentPage+1)}>Next paths</Button></div>}<Button disabled={blocked||!chosen} onClick={attach}>Use vector path</Button></>:<p>Draw a vector path with the Pen tool, then select this text again.</p>}
  {path&&<><NumberField label="Path start offset" layout="stacked" value={path.startOffset} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} suffix="px" disabled={blocked} onPreview={v=>offset('startOffset',v,true)} onCommit={v=>offset('startOffset',v)}/>
   <NumberField label="Path baseline offset" layout="stacked" value={path.baselineOffset} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} suffix="px" disabled={blocked} onPreview={v=>offset('baselineOffset',v,true)} onCommit={v=>offset('baselineOffset',v)}/>
   <Select label="Baseline direction" layout="stacked" value={path.reverse?'reverse':'forward'} options={[{value:'forward',label:'Forward'},{value:'reverse',label:'Reverse'}]} disabled={blocked} onChange={v=>change(path.with({reverse:v==='reverse'}))}/>
   <Select label="Baseline contour" layout="stacked" value={path.closed?'closed':'open'} options={[{value:'open',label:'Open'},{value:'closed',label:'Closed'}]} disabled={blocked||path.points.length<2} onChange={v=>change(path.with({closed:v==='closed'}))}/>
   <details><summary>Baseline anchors</summary><NumberField label="Baseline anchor" layout="stacked" value={index+1} min={1} max={path.points.length} step={1} disabled={blocked} onCommit={setAnchor}/>
    {point&&(['x','y']as const).map(key=><NumberField key={key} label={`Baseline anchor ${key.toUpperCase()}`} layout="stacked" value={point[key]} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} suffix="px" disabled={blocked} onPreview={v=>coordinate(key,v,undefined,true)} onCommit={v=>coordinate(key,v)}/>)}
    {point&&(['in','out']as const).flatMap(handle=>(['x','y']as const).map(key=><NumberField key={handle+key} label={`Baseline ${handle} handle ${key.toUpperCase()}`} layout="stacked" value={point[handle][key]} min={-Number.MAX_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} suffix="px" disabled={blocked} onPreview={v=>coordinate(key,v,handle,true)} onCommit={v=>coordinate(key,v,handle)}/>))}
    <Button disabled={blocked||path.points.length>=PATH_POINT_LIMIT||!path.closed&&index===path.points.length-1} onClick={()=>change(path.with({points:splitPathSegment(path.points,path.closed,index)}))}>Split baseline segment</Button>
    <Button disabled={blocked||path.points.length<=(path.closed?1:2)} onClick={()=>change(path.with({points:path.points.filter((_,i)=>i!==index)}))}>Remove baseline anchor</Button>
   </details><Button disabled={blocked} onClick={()=>void prepare(null)}>Remove text path</Button></>}
  {busy&&<p role="status">Preparing text path…</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
