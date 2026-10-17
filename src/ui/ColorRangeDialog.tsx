import { useEffect,useMemo,useRef,useState } from 'react';
import type { EditorApplication } from '../editor';
import { allLayers } from '../core/model';
import { colorRangeOptionsSchema } from '../core/color-range';
import { previewColorRange,sampleColorRange,type ColorRangePreview } from '../engine/color-range';
import { Dialog } from './Dialog';
import { Button,NumberField,Select,Slider } from './controls';
import { ColorInput } from './ColorInput';

export function ColorRangeDialog({editor,onClose}:{editor:EditorApplication;onClose():void}){
  const [document]=useState(()=>editor.document),[snapshot]=useState(()=>document.getSnapshot());
  const [colors,setColors]=useState(['#ffffff']),[exclude,setExclude]=useState<string[]>([]),[fuzziness,setFuzziness]=useState(40),[invert,setInvert]=useState(false);
  const [source,setSource]=useState('merged'),[operation,setOperation]=useState<'replace'|'add'|'subtract'|'intersect'>('replace');
  const [mode,setMode]=useState<'replace'|'add'|'exclude'>('replace'),[display,setDisplay]=useState('selection');
  const [point,setPoint]=useState({x:Math.floor(document.width/2),y:Math.floor(document.height/2)});
  const [preview,setPreview]=useState<ColorRangePreview>(),[previewBusy,setPreviewBusy]=useState(false),[working,setWorking]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState('');
  const [progress,setProgress]=useState({completed:0,total:1});
  const canvas=useRef<HTMLCanvasElement>(null),active=useRef<AbortController|null>(null),previewAbort=useRef<AbortController|null>(null),sampling=useRef<AbortController|null>(null),busyRef=useRef(false);
  const options=useMemo(()=>colorRangeOptionsSchema.parse({colors,exclude,fuzziness,invert,operation,source:source==='merged'?{kind:'merged'}:{kind:'layer',layerId:source}}),[colors,exclude,fuzziness,invert,operation,source]);
  const currentOptions=useRef(options);currentOptions.current=options;
  const close=()=>{active.current?.abort();previewAbort.current?.abort();sampling.current?.abort();onClose();};
  useEffect(()=>()=>{active.current?.abort();previewAbort.current?.abort();sampling.current?.abort();},[]);
  useEffect(()=>{sampling.current?.abort();},[options]);
  useEffect(()=>editor.subscribe(()=>{
    if(editor.document!==document){active.current?.abort();previewAbort.current?.abort();sampling.current?.abort();onClose();}
    else if(!busyRef.current&&document.getSnapshot().revision!==snapshot.revision){setStale(true);previewAbort.current?.abort();sampling.current?.abort();setError('The document changed. Close and reopen Color Range to sample the new revision.');}
  }),[editor,document,snapshot.revision,onClose]);
  useEffect(()=>{
    if(stale||working)return;
    const abort=new AbortController();previewAbort.current=abort;setPreviewBusy(true);setError('');
    const timer=setTimeout(()=>void previewColorRange(snapshot.document,editor.assetStore,options,abort.signal).then(result=>{
      if(!abort.signal.aborted)setPreview(result);
    }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(!abort.signal.aborted)setPreviewBusy(false);}),120);
    return()=>{clearTimeout(timer);abort.abort();};
  },[editor,options,snapshot,stale,working]);
  useEffect(()=>{
    if(!preview||!canvas.current)return;const target=canvas.current;target.width=preview.width;target.height=preview.height;
    const pixels=preview.pixels.slice();
    for(let i=0;i<preview.coverage.length;i++){
      const value=preview.coverage[i];
      if(display==='selection'){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=value;pixels[i*4+3]=255;}
      else if(display==='overlay')for(let channel=0;channel<3;channel++)pixels[i*4+channel]*=.25+.75*value/255;
    }
    target.getContext('2d')!.putImageData(new ImageData(pixels,preview.width,preview.height),0,0);
  },[preview,display]);
  const sample=async(next=point)=>{
    sampling.current?.abort();const abort=new AbortController();sampling.current=abort;setError('');
    try{
      const color=await sampleColorRange(snapshot.document,editor.assetStore,options,next,abort.signal);
      if(abort.signal.aborted||currentOptions.current!==options)return;
      if(document.getSnapshot().revision!==snapshot.revision)throw new Error('The document changed. Reopen Color Range.');
      if(mode==='replace')setColors([color]);else if(mode==='add'){if(colors.length>=32)throw new Error('Up to 32 included colors are supported.');setColors(values=>[...values,color]);}
      else{if(exclude.length>=32)throw new Error('Up to 32 excluded colors are supported.');setExclude(values=>[...values,color]);}
    }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
  };
  const locked=working||stale,layers=allLayers(snapshot.document.children).filter(layer=>layer.kind!=='adjustment');
  const samples=(values:string[],replace:(values:string[])=>void,label:string)=><div className="color-range-samples">{values.map((value,index)=><span key={index}>
    <ColorInput label={`${label} color ${index+1}`} value={value} disabled={locked} onPreview={()=>{}} onCancel={()=>{}} onCommit={color=>replace(values.map((entry,i)=>i===index?color:entry))} />
    <Button variant="subtle" aria-label={`Remove ${label.toLowerCase()} color ${index+1}`} disabled={locked||(label==='Included'&&values.length===1)} onClick={()=>replace(values.filter((_,i)=>i!==index))}>×</Button>
  </span>)}</div>;
  return <Dialog titleId="color-range-title" className="color-range-dialog" onClose={close}>
    <div className="dialog-heading"><h2 id="color-range-title">Color Range</h2></div>
    <p className="script-description">Sample visible colors to create a soft selection. Fuzziness widens the CIELAB color-distance falloff. Invert selects other visible source pixels; transparent pixels stay unselected.</p>
    <div className="color-range-layout"><div>
      <Select label="Color Range source" value={source} disabled={locked} options={[{value:'merged',label:'Visible composite'},...layers.map(layer=>({value:layer.id,label:layer.name}))]} onChange={setSource}/>
      <Select label="Combine selection" value={operation} disabled={locked} options={['replace','add','subtract','intersect'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))} onChange={value=>setOperation(value as typeof operation)}/>
      <Slider label="Fuzziness" value={fuzziness} min={0} max={200} step={1} disabled={locked} onPreview={setFuzziness} onCommit={setFuzziness}/>
      <label className="context-check-field"><input type="checkbox" aria-label="Invert color range" checked={invert} disabled={locked} onChange={event=>setInvert(event.target.checked)}/> Invert visible pixels</label>
      <p className="section-description">Included colors</p>{samples(colors,setColors,'Included')}
      <Button variant="subtle" disabled={locked||colors.length>=32} onClick={()=>setColors(values=>[...values,'#ffffff'])}>Add included color</Button>
      <p className="section-description">Excluded colors</p>{samples(exclude,setExclude,'Excluded')}
      <Button variant="subtle" disabled={locked||exclude.length>=32} onClick={()=>setExclude(values=>[...values,'#000000'])}>Add excluded color</Button>
    </div><div>
      <Select label="Selection preview" value={display} options={[{value:'selection',label:'Selection mask'},{value:'overlay',label:'Dim unselected'},{value:'image',label:'Source image'}]} onChange={setDisplay}/>
      <canvas ref={canvas} className="color-range-preview" aria-label="Color Range preview" onClick={event=>{
        if(locked||!preview)return;const rect=event.currentTarget.getBoundingClientRect();const next={x:Math.min(document.width-1,Math.floor((event.clientX-rect.left)/rect.width*document.width)),y:Math.min(document.height-1,Math.floor((event.clientY-rect.top)/rect.height*document.height))};setPoint(next);void sample(next);
      }}/>
      {previewBusy&&<p role="status">Updating color preview…</p>}
      <p className="text-muted">Preview uses a display proxy. Apply samples native document pixels. Click the preview or enter a point to sample the original source color.</p>
      <Select label="Sampling action" value={mode} disabled={locked} options={[{value:'replace',label:'Replace included colors'},{value:'add',label:'Add included color'},{value:'exclude',label:'Add excluded color'}]} onChange={value=>setMode(value as typeof mode)}/>
      <div className="color-range-point"><NumberField label="Sample X" value={point.x} min={0} max={document.width-1} step={1} disabled={locked} onCommit={x=>setPoint(value=>({...value,x}))}/><NumberField label="Sample Y" value={point.y} min={0} max={document.height-1} step={1} disabled={locked} onCommit={y=>setPoint(value=>({...value,y}))}/></div>
      <Button variant="subtle" disabled={locked} onClick={()=>void sample()}>Sample pixel</Button>
    </div></div>
    {working&&<div role="status">Selecting color range… <progress aria-label="Color Range progress" max={progress.total} value={progress.completed}/></div>}
    {error&&<p role="alert">{error}</p>}
    <div className="artboard-actions"><Button variant="subtle" onClick={close}>Cancel</Button><Button variant="primary" disabled={locked} onClick={async()=>{
      const abort=new AbortController();active.current=abort;previewAbort.current?.abort();sampling.current?.abort();busyRef.current=true;setWorking(true);setError('');
      try{if(document.getSnapshot().revision!==snapshot.revision)throw new Error('The document changed. Reopen Color Range.');await document.selectColorRange(options,{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted)onClose();}
      catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
      finally{busyRef.current=false;if(active.current===abort)active.current=null;setWorking(false);}
    }}>Apply color range</Button></div>
  </Dialog>;
}
