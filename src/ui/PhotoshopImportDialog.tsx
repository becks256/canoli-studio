import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import type {PhotoshopInspection,PhotoshopImportProgress} from '../core/photoshop-import';
import {PsdImportDialog} from './PsdImportDialog';
import {Dialog} from './Dialog';
import {Button,IconButton} from './controls';

export function PhotoshopImportDialog({file,editor,onClose,onBusyChange,onImported}:{file:File;editor:EditorApplication;onClose():void;onBusyChange(value:boolean):void;onImported():void}){
 const [inspection,setInspection]=useState<PhotoshopInspection|null>(null),[running,setRunning]=useState(false),[progress,setProgress]=useState<PhotoshopImportProgress|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),pending=useRef<AbortController|null>(null);
 useEffect(()=>{const abort=new AbortController();pending.current=abort;setInspection(null);setError('');void editor.inspectPsd(file,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setInspection(value);},cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});return()=>{abort.abort();pending.current?.abort();};},[editor,file,attempt]);
 const close=()=>{pending.current?.abort();onClose();};
 const run=async(mode:'layered'|'flatten')=>{const abort=new AbortController();pending.current?.abort();pending.current=abort;setRunning(true);setProgress(null);setError('');onBusyChange(true);try{await editor.openPsd(file,{mode},{signal:abort.signal,onProgress:setProgress});if(!abort.signal.aborted){onImported();onClose();}}catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}finally{onBusyChange(false);if(!abort.signal.aborted)setRunning(false);}};
 if(inspection)return <PsdImportDialog fileName={file.name} parsedPsd={inspection} report={inspection.report} busy={running} progress={progress} error={error} onClose={close} onImportLayers={()=>void run('layered')} onImportFlattened={()=>void run('flatten')}/>;
 return <Dialog titleId="photoshop-inspect-title" className="psd-import-dialog" onClose={close}><div className="dialog-header"><h2 id="photoshop-inspect-title">Import Photoshop</h2><IconButton label="Close Photoshop import" onClick={close}><X size={18}/></IconButton></div><div className="dialog-body"><p>{file.name}</p>{error?<p role="alert">{error}</p>:<p role="status">Inspecting Photoshop file…</p>}</div><div className="dialog-footer"><Button onClick={close}>Cancel</Button>{error&&<Button onClick={()=>setAttempt(value=>value+1)}>Inspect again</Button>}</div></Dialog>;
}
