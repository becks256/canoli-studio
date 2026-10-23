import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {Plug,X} from 'lucide-react';
import type {EditorApplication} from '../editor';
import {Dialog} from './Dialog';
import {Button,IconButton,Select,TextInput} from './controls';

export function ChatGptConnectionButton({editor,onOpen,disabled}:{editor:EditorApplication;onOpen():void;disabled:boolean}){
 const connections=useSyncExternalStore(editor.chatGpt.subscribe,editor.chatGpt.getSnapshot),count=connections.filter(connection=>connection.status==='connected').length;
 return <IconButton label="ChatGPT connection" shortcutId="chatgpt-connection" title={count?String(count)+' connected '+(count===1?'document':'documents'):'Connect an explicitly chosen document to the local ChatGPT plugin'} onClick={onOpen} disabled={disabled}><Plug size={17}/>{count>0&&<span aria-hidden="true">{count}</span>}</IconButton>;
}
export function ChatGptConnectionDialog({editor,onClose}:{editor:EditorApplication;onClose():void}){
 const id=useId(),state=useSyncExternalStore(editor.subscribe,editor.getSnapshot),connections=useSyncExternalStore(editor.chatGpt.subscribe,editor.chatGpt.getSnapshot),[sessionId,setSessionId]=useState(state.sessionId),[code,setCode]=useState(''),[write,setWrite]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;pending.current?.abort();};},[]);
 const connect=async()=>{const abort=new AbortController();pending.current=abort;setBusy(true);setError('');try{await editor.chatGpt.connect(code,sessionId,{read:true,write},{signal:abort.signal});if(alive.current&&!abort.signal.aborted){setCode('');setWrite(false);}}catch(cause){if(alive.current&&!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}finally{if(alive.current)setBusy(false);if(pending.current===abort)pending.current=null;}};
 const close=()=>{pending.current?.abort();onClose();};
 return <Dialog titleId={id} className="chatgpt-connection-dialog" localEscape onClose={close}>
  <div className="dialog-heading"><div><span className="section-caption">LOCAL DOCUMENT CONNECTION</span><h2 id={id}>ChatGPT connection</h2></div><IconButton label="Close ChatGPT connection" onClick={close}><X size={18}/></IconButton></div>
  <div className="chatgpt-connection-body">
   <p>Use the Canoli Studio desktop plugin to inspect and edit a document alongside you. Install the local package, ask ChatGPT to start a Canoli connection, then paste its connection code here.</p>
   <p><a href="/plugins/canoli-studio-chatgpt.zip" download>Download desktop plugin</a> · <a href="/developer/chatgpt-plugin.html" target="_blank" rel="noreferrer">Setup and supported tools</a></p>
   <Select label="Document to connect" layout="stacked" value={sessionId} disabled={busy} options={state.sessions.map(session=>({value:session.id,label:session.document.name+(session.id===state.sessionId?' · active document':'')+(state.sessions.some(other=>other.id!==session.id&&other.document.name===session.document.name)?' · '+session.id.slice(0,8):'')}))} onChange={setSessionId}/>
   <TextInput label="Canoli connection code" layout="stacked" value={code} disabled={busy} onChange={setCode}/>
   <p>This shares the chosen document’s layer names, text and settings with the connected ChatGPT session. Responses can enter your ChatGPT conversation. Original image files stay in Canoli.</p>
   <label className="checkbox-field"><input type="checkbox" checked={write} disabled={busy} onChange={event=>setWrite(event.target.checked)}/> Allow edits and undo/redo in this document</label>
   <p className="field-hint">Reading is allowed after you connect. Editing is optional and uses normal Canoli history. Requests based on an older revision reject; active canvas gestures finish before connected edits. Close this dialog to keep a connection active, or disconnect it below to stop access.</p>
   {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Connecting to the local plugin…</p>}
   <div className="dialog-actions"><Button variant="primary" disabled={busy||!code.trim()||!state.sessions.some(session=>session.id===sessionId)} onClick={()=>void connect()}>Connect selected document</Button>{busy&&<Button onClick={()=>pending.current?.abort()}>Cancel connection</Button>}</div>
   <h3>Document connections</h3>
   {!connections.length&&<p>No documents are connected.</p>}
   <ul className="chatgpt-connection-list">{connections.map(connection=><li key={connection.id}><div><strong>{state.sessions.find(session=>session.id===connection.sessionId)?.document.name??connection.documentName}</strong><p>{connection.status==='error'?connection.error:connection.permissions.write?'Connected · reading and editing allowed':'Connected · read-only'}</p><small>Connection {connection.id.slice(0,8)}</small></div><Button variant={connection.status==='connected'?'danger':'subtle'} onClick={()=>editor.chatGpt.disconnect(connection.id)}>{connection.status==='connected'?'Disconnect':'Dismiss'}</Button></li>)}</ul>
  </div>
  <div className="dialog-actions"><Button onClick={close}>Done</Button></div>
 </Dialog>;
}
