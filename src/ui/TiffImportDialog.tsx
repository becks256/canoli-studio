import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import type {TiffImportProgress,TiffImportReport} from '../core/interchange/tiff/types';
import {Button,IconButton,Select} from './controls';
import {Dialog} from './Dialog';

export function TiffImportDialog({file,editor,onClose,onBusyChange,onImported}:{file:File;editor:EditorApplication;onClose():void;onBusyChange(value:boolean):void;onImported():void}){
 const [report,setReport]=useState<TiffImportReport|null>(null),[page,setPage]=useState(0),[consent,setConsent]=useState(false),[floatSpace,setFloatSpace]=useState(''),[error,setError]=useState(''),[running,setRunning]=useState(false),[progress,setProgress]=useState<TiffImportProgress|null>(null),pending=useRef<AbortController|null>(null);
 useEffect(()=>{const abort=new AbortController();pending.current=abort;setReport(null);setError('');setPage(0);setConsent(false);setFloatSpace('');void editor.inspectTiff(file,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setReport(value);},cause=>{if(!abort.signal.aborted)setError(String(cause instanceof Error?cause.message:cause));});return()=>{abort.abort();pending.current?.abort();};},[editor,file]);
 const close=()=>{pending.current?.abort();onClose();},selected=report?.pages[page];
 const run=async()=>{const abort=new AbortController();pending.current?.abort();pending.current=abort;setRunning(true);setProgress(null);setError('');onBusyChange(true);try{await editor.openTiff(file,{page,allowPrecisionLoss:consent,...(selected?.requiresColorAssumption&&floatSpace?{floatColorSpace:floatSpace as 'srgb'|'linear-srgb'}:{})},{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted){onImported();onClose();}}catch(cause){if(!abort.signal.aborted)setError(String(cause instanceof Error?cause.message:cause));}finally{onBusyChange(false);if(!abort.signal.aborted)setRunning(false);}};
 return <Dialog titleId="tiff-import-title" className="svg-import-dialog" onClose={close}>
  <div className="dialog-header"><h2 id="tiff-import-title">Import TIFF</h2><IconButton label="Close TIFF import" onClick={close}><X size={18}/></IconButton></div>
  <div className="svg-import-body">
   <p><strong>{file.name}</strong></p><p>Open the selected page as a new raster document. Existing edited documents stay open. Original TIFF bytes and the selected page stay in saved projects.</p>
   {!report&&!error&&<p role="status">Inspecting TIFF…</p>}
   {report&&<><p>{report.bigTiff?'BigTIFF':'TIFF'} · {report.pages.length} {report.pages.length===1?'page':'pages'}</p><Select label="TIFF page" layout="stacked" value={String(page)} disabled={running} options={report.pages.map(p=>({value:String(p.index),label:`Page ${p.index+1} — ${p.orientation>=5?p.height:p.width} × ${p.orientation>=5?p.width:p.height} px`}))} onChange={value=>{setPage(Number(value));setConsent(false);setFloatSpace('');}}/>
    {selected&&<><p>{selected.sampleFormat===3?'32-bit floating-point samples':`${selected.bits} bits per sample`} · {selected.samples} channels · Orientation {selected.orientation}</p>{selected.unsupported.length>0&&<><h3>Unsupported on this page</h3><ul>{selected.unsupported.map(text=><li key={text}>{text}</li>)}</ul></>}<h3>Conversion limits</h3><ul>{selected.warnings.map(text=><li key={text}>{text}</li>)}</ul>{selected.requiresColorAssumption&&<Select label="Float TIFF color interpretation" layout="stacked" value={floatSpace} disabled={running} options={[{value:'',label:'Choose an interpretation'},{value:'srgb',label:'sRGB (encoded values)'},{value:'linear-srgb',label:'Linear sRGB'}]} onChange={setFloatSpace}/>}
     {selected.requiresPrecisionLoss&&<label><input type="checkbox" checked={consent} disabled={running} onChange={event=>setConsent(event.target.checked)}/> Convert this page to 8-bit editing precision</label>}</>}
   </>}
   {running&&<div role="status"><p>{progress?.phase==='decoding'?'Decoding TIFF pixels…':'Inspecting TIFF…'}</p><progress aria-label="TIFF import progress" max={1} value={progress?.fraction??undefined}/></div>}
   {error&&<p role="alert">{error}</p>}
  </div>
  <div className="dialog-footer"><Button variant="subtle" onClick={close}>Cancel</Button><Button variant="primary" disabled={!selected?.canDecode||running||selected.requiresPrecisionLoss&&!consent||selected.requiresColorAssumption&&!floatSpace} onClick={()=>void run()}>Import TIFF page</Button></div>
 </Dialog>;
}
