import {useEffect,useMemo,useRef,useState} from 'react';
import {Dialog} from './Dialog';
import {Button,Select} from './controls';
import type {EditorApplication} from '../editor';
import {previewMatting} from '../engine/preview-matting';
import type {MattingTileResult} from '../engine/matting-tile';
import type {RefineEdgeOptions,RefineEdgeControl,RefineEdgeProgress,TrimapStroke} from '../core/matting';
import type {MattingViewMode} from '../intelligence/matting/types';

export function RefineEdgeDialog({editor,onClose,onApply}:{editor:EditorApplication;onClose():void;onApply(options:RefineEdgeOptions,control:RefineEdgeControl):Promise<void>}){
  const [snapshot]=useState(()=>{const layer=editor.document.selectedLayer?.toJSON();return{document:editor.document,data:editor.document.getSnapshot().document,revision:editor.document.getSnapshot().revision,layer,asset:layer?.kind==='raster'?editor.assetStore.get(layer.assetId):undefined};});
  const selected=snapshot.layer,isRaster=selected?.kind==='raster',asset=snapshot.asset;
  const [viewMode,setViewMode]=useState<MattingViewMode>('overlay'),[radius,setRadius]=useState(10),[smooth,setSmooth]=useState(10),[feather,setFeather]=useState(0),[contrast,setContrast]=useState(0),[shiftEdge,setShiftEdge]=useState(0);
  const [decontaminate,setDecontaminate]=useState(false),[amount,setAmount]=useState(100),[output,setOutput]=useState<'mask'|'new-layer'>('mask'),[solver,setSolver]=useState<'closed-form'|'color-line'>('closed-form');
  const [mode,setMode]=useState<TrimapStroke['mode']>('refine'),[size,setSize]=useState(20),[strokes,setStrokes]=useState<TrimapStroke[]>([]),[draft,setDraft]=useState<TrimapStroke|null>(null);
  const [preview,setPreview]=useState<MattingTileResult|null>(null),[processing,setProcessing]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<RefineEdgeProgress>({completed:0,total:1});
  const canvas=useRef<HTMLCanvasElement|null>(null),previewAbort=useRef<AbortController|null>(null),applyAbort=useRef<AbortController|null>(null),draftRef=useRef<TrimapStroke|null>(null),frame=useRef<number|null>(null);
  const options=useMemo(()=>({solver,radius,smooth,feather,contrast,shiftEdge,decontaminate,decontaminateAmount:amount/100,outputTo:output,trimapStrokes:strokes}),[solver,radius,smooth,feather,contrast,shiftEdge,decontaminate,amount,output,strokes]);
  const check=()=>{if(editor.document!==snapshot.document||editor.document.getSnapshot().revision!==snapshot.revision)throw new Error('The document changed. Close Refine Edge and reopen it for the current revision.');};
  const close=()=>{previewAbort.current?.abort();applyAbort.current?.abort();draftRef.current=null;onClose();};
  useEffect(()=>()=>{previewAbort.current?.abort();applyAbort.current?.abort();if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
  useEffect(()=>snapshot.document.subscribe(()=>{previewAbort.current?.abort();if(!applyAbort.current)setError('The document changed. Close Refine Edge and reopen it for the current revision.');}),[snapshot.document]);
  useEffect(()=>{
    if(!isRaster||!selected||applyAbort.current)return;
    const abort=new AbortController();previewAbort.current=abort;setProcessing(true);setError('');
    const timer=setTimeout(()=>{void(async()=>{
      try{check();const value=await previewMatting(snapshot.data,editor.assetStore,selected.id,options,abort.signal,check);if(!abort.signal.aborted)setPreview(value);}
      catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
      finally{if(previewAbort.current===abort){setProcessing(false);previewAbort.current=null;}}
    })();},75);
    return()=>{clearTimeout(timer);abort.abort();};
  },[editor,snapshot,isRaster,selected,options]);
  useEffect(()=>{
    if(!preview||!canvas.current)return;
    const target=canvas.current;target.width=preview.width;target.height=preview.height;const context=target.getContext('2d')!,image=context.createImageData(preview.width,preview.height),data=image.data;
    for(let i=0;i<preview.alpha.length;i++){
      const a=preview.alpha[i]*preview.rgba[i*4+3]/65025,base=i*4;
      for(let c=0;c<3;c++)data[base+c]=viewMode==='marching-ants'?Math.round(a*255):viewMode==='on-white'?Math.round(preview.rgba[base+c]*a+255*(1-a)):viewMode==='on-black'?Math.round(preview.rgba[base+c]*a):viewMode==='overlay'?Math.round(preview.rgba[base+c]*(.4+.6*a)+(c===0?153*(1-a):0)):preview.rgba[base+c];
      data[base+3]=viewMode==='on-transparency'?Math.round(a*255):255;
    }context.putImageData(image,0,0);
  },[preview,viewMode]);
  const point=(event:React.PointerEvent<HTMLCanvasElement>)=>{const box=event.currentTarget.getBoundingClientRect();return{x:(event.clientX-box.x)*asset!.width/box.width,y:(event.clientY-box.y)*asset!.height/box.height};};
  const publish=()=>{if(frame.current!==null)return;frame.current=requestAnimationFrame(()=>{frame.current=null;setDraft(draftRef.current?{...draftRef.current,points:[...draftRef.current.points]}:null);});};
  const hasForeground=useMemo(()=>!!preview?.alpha.some((value,i)=>value>0&&preview.rgba[i*4+3]>0),[preview]);
  const finish=()=>{const stroke=draftRef.current;draftRef.current=null;setDraft(null);if(stroke?.points.length)setStrokes(value=>[...value,stroke]);};
  const slider=(id:string,label:string,value:number,set:(value:number)=>void,min:number,max:number,step=1)=><div className="refine-edge-slider-row"><label htmlFor={id}>{label} ({value})</label><input id={id} type="range" min={min} max={max} step={step} value={value} disabled={working} onChange={event=>set(Number(event.target.value))}/></div>;
  return <Dialog titleId="refine-edge-title" className="refine-edge-dialog" onClose={close}>
    <div className="refine-edge-header"><h2 id="refine-edge-title">Refine Edge</h2><Button onClick={close}>Close</Button></div>
    {!isRaster?<p role="alert">Select a raster layer to refine its edge.</p>:<div className="refine-edge-body">
      <div className={`refine-edge-canvas-container ${viewMode==='on-transparency'?'checkerboard-bg':''}`}>
        <div style={{position:'relative',display:'inline-block',width:preview?.width??Math.min(512,asset!.width),maxWidth:'100%',lineHeight:0}}>
          <canvas ref={canvas} data-testid="refine-edge-preview-canvas" aria-label="Paint native trimap marks" style={{display:'block',width:'100%',height:'auto',touchAction:'none'}}
            onPointerDown={event=>{if(working||!preview)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);draftRef.current={mode,size,points:[point(event)]};publish();}}
            onPointerMove={event=>{const stroke=draftRef.current;if(!stroke)return;const next=point(event),last=stroke.points.at(-1)!;if(Math.hypot(next.x-last.x,next.y-last.y)<.25)return;if(strokes.reduce((n,value)=>n+value.points.length,0)+stroke.points.length>=20000){setError('Trimap marks support at most 20,000 points. Undo or clear marks to continue.');return;}stroke.points.push(next);publish();}}
            onPointerUp={finish} onPointerCancel={()=>{draftRef.current=null;setDraft(null);}}/>
          {draft&&<svg viewBox={`0 0 ${asset!.width} ${asset!.height}`} preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}} data-testid="trimap-draft"><circle cx={draft.points[0].x} cy={draft.points[0].y} r={draft.size/2} fill={draft.mode==='foreground'?'#89d5a2':draft.mode==='background'?'#f5aea0':'#9ec7ee'}/><polyline points={draft.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={draft.mode==='foreground'?'#89d5a2':draft.mode==='background'?'#f5aea0':'#9ec7ee'} strokeWidth={draft.size} strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
        {(processing||working)&&<div role="status" className="refine-edge-processing-indicator">{working?(progress.phase==='solve'?`Solving matte · iteration ${progress.iteration??0}`:progress.phase==='encode'?'Encoding native matte…':'Preparing native matte…'):'Updating preview…'}{working&&<progress aria-label="Matting progress" value={progress.completed} max={progress.total}/>}</div>}
      </div>
      <div className="refine-edge-controls">
        <Select label="View Mode" value={viewMode} options={[{value:'overlay',label:'Overlay / Ruby'},{value:'on-black',label:'On Black'},{value:'on-white',label:'On White'},{value:'on-transparency',label:'On Transparency'},{value:'marching-ants',label:'Black & White'}]} onChange={value=>setViewMode(value as MattingViewMode)}/>
        <p className="text-muted">Preview uses a scaled source. Apply processes native pixels.</p>
        <Select label="Matting solver" value={solver} disabled={working} options={[{value:'closed-form',label:'Closed form (global)'},{value:'color-line',label:'Color line (local)'}]} onChange={value=>setSolver(value as typeof solver)}/>
        <fieldset disabled={working}><legend>Trimap marks</legend><Select label="Trimap brush" value={mode} options={[{value:'foreground',label:'Foreground'},{value:'background',label:'Background'},{value:'refine',label:'Unknown edge'}]} onChange={value=>setMode(value as TrimapStroke['mode'])}/>
          {slider('refine-brush-size','Brush diameter',size,setSize,.5,512,.5)}
          <Button disabled={!strokes.length||working} onClick={()=>setStrokes(value=>value.slice(0,-1))}>Undo mark</Button><Button disabled={!strokes.length||working} onClick={()=>setStrokes([])}>Clear marks</Button>
        </fieldset>
        {slider('refine-radius','Radius',radius,setRadius,0,50)}{slider('refine-smooth','Smooth',smooth,setSmooth,0,100)}{slider('refine-feather','Feather',feather,setFeather,0,50,.5)}{slider('refine-contrast','Contrast',contrast,setContrast,-100,100)}{slider('refine-shift-edge','Shift Edge',shiftEdge,setShiftEdge,-100,100)}
        <label className="refine-edge-checkbox-label"><input type="checkbox" checked={decontaminate} disabled={working} onChange={event=>{setDecontaminate(event.target.checked);if(event.target.checked)setOutput('new-layer');}}/>Decontaminate Colors</label>
        {decontaminate&&slider('refine-decontaminate-amount','Amount',amount,setAmount,0,100)}
        <Select label="Matting output" value={output} disabled={working} options={decontaminate?[{value:'new-layer',label:'New layer with matte'}]:[{value:'mask',label:'Layer mask'},{value:'new-layer',label:'New layer with matte'}]} onChange={value=>setOutput(value as typeof output)}/>
        {decontaminate&&<p className="text-muted">Corrected colors go to a new layer; the original stays in the document.</p>}
        {preview&&preview.unresolvedPixels>0&&<p className="text-muted">Some preview pixels retain the initial mask where foreground/background constraints are missing.</p>}
        {preview&&!hasForeground&&<p className="text-muted">No foreground in the preview. Paint foreground marks or change the selection.</p>}
        {error&&<p role="alert">{error}</p>}
        <div className="refine-edge-actions"><Button data-testid="refine-edge-cancel" onClick={close}>{working?'Cancel matting':'Cancel'}</Button><Button data-testid="refine-edge-apply" variant="primary" disabled={working||processing||!hasForeground||!!error||!!draft} onClick={()=>{void(async()=>{
          const abort=new AbortController();applyAbort.current=abort;previewAbort.current?.abort();setWorking(true);setError('');setProgress({completed:0,total:1});
          try{check();await onApply(options,{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted)onClose();}
          catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
          finally{if(applyAbort.current===abort)applyAbort.current=null;setWorking(false);}
        })();}}>Apply</Button></div>
      </div>
    </div>}
  </Dialog>;
}
