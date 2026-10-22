import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {Clock3,X} from 'lucide-react';
import type {RecentFilesService} from '../workspace/recent-service';
import type {RecentKind} from '../workspace/recent-files';
import {Dialog} from './Dialog';
import {Button,IconButton} from './controls';

export function RecentFilesButton({library,onOpen,disabled}:{library:RecentFilesService;onOpen():void;disabled:boolean}){
 const snapshot=useSyncExternalStore(library.subscribe,library.getSnapshot),id=useId(),message=snapshot.error?'Some recent-file copies could not be saved. Open Recent files for details.':snapshot.pending?'Saving local recent-file copies…':'Open a saved local recent-file copy.';
 return <span className="recent-files-control"><IconButton label="Recent files" shortcutId="recent-files" title={message} aria-describedby={id} onClick={onOpen} disabled={disabled}><Clock3 size={17}/></IconButton>{(snapshot.pending>0||snapshot.error)&&<span className={`recent-file-indicator ${snapshot.error?'error':'pending'}`} aria-hidden="true"/>}<span id={id} className="recent-files-description">{message}</span></span>;
}
export function RecentFilesDialog({library,initialId,onClose,onOpen}:{library:RecentFilesService;initialId?:string;onClose():void;onOpen(file:File,kind:RecentKind):void}){
 const id=useId(),snapshot=useSyncExternalStore(library.subscribe,library.getSnapshot),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef<AbortController|null>(null),alive=useRef(true);
 const open=async(key:string)=>{const abort=new AbortController();pending.current?.abort();pending.current=abort;setBusy(true);setError('');try{const result=await library.read(key,abort.signal);if(!abort.signal.aborted&&alive.current){onClose();onOpen(result.file,result.kind);}}catch(cause){if(!abort.signal.aborted&&alive.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(alive.current&&!abort.signal.aborted)setBusy(false);}};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;pending.current?.abort();};},[]);
 useEffect(()=>{if(initialId)void open(initialId);return()=>pending.current?.abort();},[initialId,library]);
 const close=()=>{pending.current?.abort();onClose();};
 const mutate=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause));}finally{if(alive.current)setBusy(false);}};
 return <Dialog titleId={id} className="recent-files-dialog" onClose={close}>
  <div className="dialog-heading"><div><span className="section-caption">PICK UP WHERE YOU LEFT OFF</span><h2 id={id}>Recent files</h2></div><IconButton label="Close recent files" onClick={close} autoFocus><X size={19}/></IconButton></div>
  <p>These are saved local copies of files you opened or project downloads you requested. They stay in this browser. Open the original again to pick up changes made on disk.</p>
  <p className="field-hint">The 20 most recent entries are kept, with shared storage for identical bytes. Removing a copy leaves open documents and original disk files alone. Browser storage may be cleared; keep project downloads as backups.</p>
  {(error||snapshot.error)&&<p role="alert">{error||snapshot.error}</p>}
  {busy&&<p role="status">Checking or updating the local copy…</p>}{snapshot.loading&&<p role="status">Loading recent files…</p>}{snapshot.pending>0&&<p role="status">Saving {snapshot.pending} local {snapshot.pending===1?'copy':'copies'}…</p>}
  {!snapshot.loading&&!snapshot.entries.length&&<p>No recent local copies yet. Open a file or download a project to add one.</p>}
  <ul className="recent-files-list">{snapshot.entries.map((entry,index)=><li key={entry.id??'unavailable-'+index}>
   <div><strong>{entry.name}</strong><small>{entry.error??`${entry.kind==='project'?'Project':entry.kind==='photoshop'?'Photoshop':entry.kind?.toUpperCase()} · ${entry.size?.toLocaleString()} bytes · ${entry.openedAt!==null?'Saved '+new Date(entry.openedAt).toLocaleString():''}`}</small></div>
   <div className="recent-files-actions"><Button disabled={busy||!entry.id||!!entry.error} aria-label={`Open local copy ${entry.name}`} onClick={()=>void open(entry.id!)}>Open local copy</Button><Button variant="subtle" disabled={busy||!entry.id} aria-label={`Remove local copy ${entry.name}`} onClick={()=>void mutate(()=>library.remove(entry.id!))}>Remove</Button></div>
  </li>)}</ul>
  <div className="dialog-actions"><Button variant="subtle" disabled={busy||!snapshot.available} onClick={()=>void mutate(()=>library.refresh())}>Reload recent files</Button><Button variant="subtle" disabled={busy||!snapshot.available||!snapshot.entries.length} onClick={()=>void mutate(()=>library.clear())}>Clear local copies</Button><Button variant="primary" onClick={close}>{busy?'Cancel':'Done'}</Button></div>
 </Dialog>;
}
