import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Dialog} from './Dialog';
import {Button,IconButton,Slider} from './controls';
import type {EditorApplication} from '../editor';
import type {FrequencyPreviewFrame,PreparedFrequencySeparation} from '../engine/frequency-separation';

type Point={x:number;y:number};
type PreviewRequest={prepared:PreparedFrequencySeparation;sigma:number;center:Point;abort:AbortController;sequence:number};

export function FrequencySeparationDialog({editor,layerId,onClose,onBusyChange,onCreated}:{editor:EditorApplication;layerId:string;onClose():void;onBusyChange(value:boolean):void;onCreated():void}) {
  const [sigma,setSigma]=useState(4),[prepared,setPrepared]=useState<PreparedFrequencySeparation|null>(null),[center,setCenter]=useState<Point|null>(null);
  const [preparing,setPreparing]=useState(true),[running,setRunning]=useState(false),[previewing,setPreviewing]=useState(false);
  const [error,setError]=useState(''),[previewError,setPreviewError]=useState(''),[showOriginal,setShowOriginal]=useState(false),[displayed,setDisplayed]=useState<{sigma:number;region:FrequencyPreviewFrame['region']}|null>(null);
  const sourceDocument=useRef(editor.document),lifetime=useRef<AbortController|null>(null),pending=useRef<AbortController|null>(null),privateSource=useRef<PreparedFrequencySeparation|null>(null);
  const lowCanvas=useRef<HTMLCanvasElement>(null),highCanvas=useRef<HTMLCanvasElement>(null),frame=useRef<FrequencyPreviewFrame|null>(null),original=useRef(false);
  const requested=useRef<PreviewRequest|null>(null),working=useRef(false),sequence=useRef(0),drag=useRef<{id:number;x:number;y:number;center:Point;scaleX:number;scaleY:number}|null>(null);
  original.current=showOriginal;
  const draw=()=>{
    if(!frame.current||!lowCanvas.current||!highCanvas.current)return;
    for(const [target,source] of [[lowCanvas.current,original.current?frame.current.original:frame.current.low],[highCanvas.current,frame.current.high]] as const){
      target.width=source.width;target.height=source.height;target.getContext('2d')!.drawImage(source,0,0);
    }
  };
  useEffect(()=>{
    const abort=new AbortController();lifetime.current=abort;setPreparing(true);onBusyChange(true);
    void (async()=>{
      try{
        if(editor.document!==sourceDocument.current)throw new Error('The selected document changed. Close this dialog and retry.');
        const source=await editor.prepareFrequencySeparation(layerId,{signal:abort.signal});
        if(abort.signal.aborted){source.dispose();return;}
        privateSource.current=source;setPrepared(source);setCenter({x:source.bounds.x+source.bounds.width/2,y:source.bounds.y+source.bounds.height/2});
      }catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
      finally{onBusyChange(false);if(!abort.signal.aborted)setPreparing(false);}
    })();
    return()=>{abort.abort();pending.current?.abort();privateSource.current?.dispose();privateSource.current=null;frame.current?.dispose();frame.current=null;};
  },[editor,layerId,onBusyChange]);
  useEffect(()=>{draw();},[showOriginal]);
  useEffect(()=>{
    const ticket=++sequence.current;
    if(!prepared||!center||running){setPreviewing(false);return;}
    const abort=new AbortController();requested.current={prepared,sigma,center,abort,sequence:ticket};setPreviewing(true);setPreviewError('');
    const drain=async()=>{
      if(working.current)return;
      working.current=true;
      try{
        while(requested.current){
          const request=requested.current;requested.current=null;
          try{
            const next=await request.prepared.preview({sigma:request.sigma,center:request.center},{signal:request.abort.signal});
            if(request.abort.signal.aborted||request.sequence!==sequence.current){next.dispose();continue;}
            frame.current?.dispose();frame.current=next;draw();setDisplayed({sigma:request.sigma,region:next.region});setPreviewError('');
          }catch(cause){if(!request.abort.signal.aborted&&request.sequence===sequence.current)setPreviewError(cause instanceof Error?cause.message:String(cause));}
          finally{if(!request.abort.signal.aborted&&request.sequence===sequence.current)setPreviewing(false);}
        }
      }finally{working.current=false;}
    };
    void drain();
    return()=>{abort.abort();if(requested.current?.abort===abort)requested.current=null;};
  },[prepared,sigma,center?.x,center?.y,running]);
  const close=()=>{lifetime.current?.abort();pending.current?.abort();privateSource.current?.dispose();onClose();};
  const run=async()=>{
    if(!prepared)return;
    const abort=new AbortController();pending.current=abort;setRunning(true);setError('');onBusyChange(true);
    try{await prepared.commit({sigma},{signal:abort.signal});if(!abort.signal.aborted){onCreated();onClose();}}
    catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    finally{onBusyChange(false);if(!abort.signal.aborted)setRunning(false);}
  };
  const move=(value:Point)=>{
    if(!prepared||running)return;
    const bounds=prepared.bounds,w=Math.min(256,bounds.width),h=Math.min(192,bounds.height);
    const next={x:Math.max(bounds.x+w/2,Math.min(bounds.x+bounds.width-w/2,value.x)),y:Math.max(bounds.y+h/2,Math.min(bounds.y+bounds.height-h/2,value.y))};
    setCenter(current=>current?.x===next.x&&current?.y===next.y?current:next);
  };
  const panes=[{label:showOriginal?'Original source':'Color and tone',ref:lowCanvas},{label:'Fine detail',ref:highCanvas}];
  return <Dialog titleId="frequency-separation-title" onClose={close} localEscape className="frequency-separation-dialog">
    <div className="dialog-heading"><h2 id="frequency-separation-title">Frequency separation</h2><IconButton label="Close frequency separation" onClick={close}><X size={18}/></IconButton></div>
    <p>Separate color and tone from fine detail. The original stays available as a hidden layer; each band gets its own retouch layer.</p>
    <Slider label="Separation radius" value={sigma} min={0} max={4096/3} step={.1} suffix="px" scale="quadratic" disabled={running} onPreview={value=>{setError('');setSigma(value);}} onCommit={value=>{setError('');setSigma(value);}}/>
    <div className="frequency-preview-panes">
      {panes.map(({label,ref},index)=><figure key={index}><figcaption>{label}</figcaption><div className="frequency-preview-surface"><canvas ref={ref} width={256} height={192} tabIndex={0} role="img" aria-label={index===0?(showOriginal?'Original source preview':'Color and tone preview'):'Fine detail preview'}
        onPointerDown={event=>{if(!center||running||!prepared)return;event.preventDefault();event.currentTarget.focus();const box=event.currentTarget.getBoundingClientRect();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,center,scaleX:event.currentTarget.width/box.width,scaleY:event.currentTarget.height/box.height};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{const gesture=drag.current;if(gesture?.id===event.pointerId)move({x:gesture.center.x-(event.clientX-gesture.x)*gesture.scaleX,y:gesture.center.y-(event.clientY-gesture.y)*gesture.scaleY});}}
        onPointerUp={event=>{if(drag.current?.id===event.pointerId){drag.current=null;event.currentTarget.releasePointerCapture(event.pointerId);}}}
        onPointerCancel={()=>{drag.current=null;}}
        onKeyDown={event=>{if(!center||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;move({x:center.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:center.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)});}}
      /></div></figure>)}
    </div>
    <div className="frequency-preview-caption"><Button size="sm" aria-pressed={showOriginal} disabled={!displayed||running} onClick={()=>setShowOriginal(value=>!value)}>Show original</Button>
      <span>{displayed?`Native pixels · radius ${displayed.sigma.toFixed(1)} px · ${displayed.region.x}, ${displayed.region.y}`:(error||previewError?'Native preview unavailable':'Preparing native preview…')}</span></div>
    <p className="section-description">Drag a preview to inspect nearby pixels, or use its arrow keys (Shift for 10 pixels). Previews show neutral source bands; layer appearance stays on the final group. The radius stays shared by all three bands. Source transparency and a protected precision layer preserve the initial result.</p>
    {(preparing||previewing||running)&&<p role="status">{running?'Creating editable frequency layers…':preparing?'Preparing the original native source…':'Updating native preview…'}</p>}
    {(error||previewError)&&<p role="alert">{error||previewError}</p>}
    <div className="dialog-actions"><Button onClick={close}>{running||preparing?'Cancel separation':'Cancel'}</Button><Button variant="primary" disabled={!prepared||preparing||previewing||running||!!previewError} onClick={()=>void run()}>Create frequency layers</Button></div>
  </Dialog>;
}
