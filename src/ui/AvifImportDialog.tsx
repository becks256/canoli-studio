import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import type {AvifImportReport,AvifImportControl} from '../core/interchange/avif/types';
import {Button,IconButton} from './controls';
import {Dialog} from './Dialog';

export function AvifImportReview({report,precision,color,onPrecision,onColor,busy=false}:{report:Readonly<AvifImportReport>;precision:boolean;color:boolean;onPrecision(value:boolean):void;onColor(value:boolean):void;busy?:boolean}){
  const names={srgb:'sRGB','display-p3':'Display P3','linear-srgb':'Linear sRGB',icc:'Embedded RGB profile',unspecified:'Color not yet identified',unsupported:'Unsupported color'};
  return <>
    <p>{report.displayWidth} × {report.displayHeight} px · {report.bitDepth===null?'Unknown precision':`${report.bitDepth} bits per sample`} · {names[report.color.kind]}{report.alpha?' · Transparency':''}</p>
    {(report.width!==report.displayWidth||report.height!==report.displayHeight)&&<p className="text-muted">Encoded extent: {report.width} × {report.height} px. The image’s crop and orientation are applied without resampling.</p>}
    {!!report.unsupported.length&&<><h3>Unsupported in this image</h3><ul>{report.unsupported.map(text=><li key={text}>{text}</li>)}</ul></>}
    <h3>Color and precision</h3><ul>{report.warnings.map(text=><li key={text}>{text}</li>)}</ul>
    {report.requiresPrecisionLoss&&<label className="check-field"><input type="checkbox" checked={precision} disabled={busy} onChange={event=>onPrecision(event.target.checked)}/>Convert AVIF to 8-bit editing precision</label>}
    {report.requiresColorAssumption&&<label className="check-field"><input type="checkbox" checked={color} disabled={busy} onChange={event=>onColor(event.target.checked)}/>Allow sRGB fallback for unidentified AVIF color</label>}
    <p className="text-muted">Identified source color takes precedence over a fallback. HDR is not tone-mapped. Original AVIF bytes stay with the image.</p>
  </>;
}
export function AvifImportDialog({file,editor,onClose,onBusyChange,onImported}:{file:File;editor:EditorApplication;onClose():void;onBusyChange(value:boolean):void;onImported():void}){
  const [report,setReport]=useState<AvifImportReport|null>(null),[precision,setPrecision]=useState(false),[color,setColor]=useState(false),[error,setError]=useState(''),[running,setRunning]=useState(false),[progress,setProgress]=useState<Parameters<NonNullable<AvifImportControl['onProgress']>>[0]|null>(null),pending=useRef<AbortController|null>(null);
  useEffect(()=>{const abort=new AbortController();pending.current=abort;setReport(null);setError('');setPrecision(false);setColor(false);void editor.inspectAvif(file,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setReport(value);},cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});return()=>{abort.abort();pending.current?.abort();};},[editor,file]);
  const close=()=>{pending.current?.abort();onClose();};
  const run=async()=>{
    const abort=new AbortController();pending.current?.abort();pending.current=abort;setRunning(true);setError('');setProgress(null);onBusyChange(true);
    try{await editor.openAvif(file,{allowPrecisionLoss:precision,assumeSrgb:color},{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted){onImported();onClose();}}
    catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    finally{onBusyChange(false);if(!abort.signal.aborted)setRunning(false);}
  };
  return <Dialog titleId="avif-import-title" className="svg-import-dialog" onClose={close}>
    <div className="dialog-header"><h2 id="avif-import-title">Import AVIF</h2><IconButton label="Close AVIF import" onClick={close}><X size={18}/></IconButton></div>
    <div className="svg-import-body"><p><strong>{file.name}</strong></p><p>Open the primary image as an editable raster document. Existing edited documents stay open. Saved projects retain the complete original AVIF and these decoding choices.</p>
      {!report&&!error&&<p role="status">Inspecting AVIF…</p>}
      {report&&<AvifImportReview report={report} precision={precision} color={color} onPrecision={setPrecision} onColor={setColor} busy={running}/>}
      {running&&<div role="status"><p>{progress?.phase==='decoding'?'Decoding AVIF pixels…':'Inspecting AVIF…'}</p><progress aria-label="AVIF import progress" max={1} value={progress?.fraction??undefined}/></div>}
      {error&&<p role="alert">{error}</p>}
    </div>
    <div className="dialog-footer"><Button variant="subtle" onClick={close}>Cancel</Button><Button variant="primary" disabled={!report?.canDecode||running||report.requiresPrecisionLoss&&!precision||report.requiresColorAssumption&&!color} onClick={()=>void run()}>Import AVIF image</Button></div>
  </Dialog>;
}
