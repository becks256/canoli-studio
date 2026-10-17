import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import type {SvgImportReport,SvgImportControl} from '../core/svg-import';
import {Button,IconButton} from './controls';
import {Dialog} from './Dialog';

export function SvgImportDialog({file,editor,onClose,onBusyChange,onImported}:{file:File;editor:EditorApplication;onClose():void;onBusyChange(value:boolean):void;onImported():void}){
 const [report,setReport]=useState<SvgImportReport|null>(null),[error,setError]=useState(''),[running,setRunning]=useState(false),[phase,setPhase]=useState('Inspecting SVG…');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const abort=new AbortController();pending.current=abort;
  setReport(null);setError('');
  void editor.inspectSvg(file,{signal:abort.signal}).then(result=>{if(!abort.signal.aborted)setReport(result);},cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
  return()=>{abort.abort(new Error('SVG inspection cancelled.'));pending.current?.abort(new Error('SVG import cancelled.'));};
 },[editor,file]);
 const close=()=>{pending.current?.abort(new Error('SVG import cancelled.'));onClose();};
 const run=async(mode:'editable'|'flatten')=>{
  const abort=new AbortController();pending.current?.abort();pending.current=abort;setRunning(true);setError('');onBusyChange(true);
  const onProgress:SvgImportControl['onProgress']=p=>setPhase(p.phase==='reading'?'Reading SVG…':p.phase==='inspecting'?'Inspecting SVG…':p.phase==='decoding'?'Decoding image pixels…':'Rendering flattened SVG…');
  try{await editor.openSvg(file,{mode},{signal:abort.signal,onProgress});if(!abort.signal.aborted){onImported();onClose();}}
  catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
  finally{onBusyChange(false);if(!abort.signal.aborted)setRunning(false);}
 };
 return <Dialog titleId="svg-import-title" className="svg-import-dialog" onClose={close}>
  <div className="dialog-header"><h2 id="svg-import-title">Import SVG</h2><IconButton label="Close SVG import" onClick={close}><X size={18}/></IconButton></div>
  <div className="svg-import-body">
   <p><strong>{file.name}</strong></p>
   <p>Open as a new document. Existing edited documents stay open.</p>
   {!report&&!error&&<p role="status">Inspecting SVG…</p>}
   {report&&<>
    <p>{report.width} × {report.height} px · {report.elements} XML elements</p>
    <h3>Editable import</h3>
    <p>{report.canImportEditable?`${report.layers} native layers with editable placement and geometry.`:'Some artwork cannot be represented as editable native layers.'}</p>
    {!!report.featuresPreserved.length&&<ul>{report.featuresPreserved.map(text=><li key={text}>{text}</li>)}</ul>}
    {!!report.unsupportedFeatures.length&&<><h3>Requires flattened import</h3><ul>{report.unsupportedFeatures.map(text=><li key={text}>{text}</li>)}</ul>{report.additionalIssues>0&&<p>{report.additionalIssues} additional findings.</p>}</>}
    <h3>Conversion limits</h3><ul>{report.featuresDegraded.map(text=><li key={text}>{text}</li>)}</ul>
   </>}
   {running&&<p role="status">{phase}</p>}
   {error&&<p role="alert">{error}</p>}
  </div>
  <div className="dialog-footer"><Button variant="subtle" onClick={close}>Cancel</Button><Button variant="secondary" disabled={!report||running} onClick={()=>void run('flatten')}>Import flattened</Button><Button variant="primary" disabled={!report?.canImportEditable||running} onClick={()=>void run('editable')}>Import editable</Button></div>
 </Dialog>;
}
