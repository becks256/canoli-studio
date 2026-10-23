import {z} from 'zod';
import {PaintLayer,VectorLayer,TextLayer,LayerGroup} from '../../dom';
import type {EditorApplication} from '../../editor';
import type {DocumentSession} from '../../workspace/document-session';
import {execute} from '../../core/commands';
import {parseCommands} from '../../core/validation';
import {referencedAssets} from '../../core/model';
import {validateWetPaintAssets} from '../../core/wet-assets';
import {wetBrowserAssets} from '../../engine/wet-composite';
import {bridgeEventSchema,boundedJson,connectionPermissionsSchema,failure,MCP_BRIDGE_VERSION,MCP_METADATA_BYTES,parseConnectionCode,type ConnectionOperation,type ConnectionPermissions,type ConnectionResult} from './protocol';

export interface ChatGptConnectionView {readonly id:string;readonly sessionId:string;readonly documentName:string;readonly permissions:ConnectionPermissions;readonly status:'connected'|'error';readonly error:string}
interface Owner {id:string;origin:string;credential:string;session:DocumentSession;permissions:ConnectionPermissions;abort:AbortController;operations:Map<string,AbortController>}
class ConnectionFailure extends Error {constructor(readonly code:'REVISION_CONFLICT'|'BUSY',message:string,readonly revision:number){super(message);}}
const pairedSchema=z.object({version:z.literal(MCP_BRIDGE_VERSION),id:z.string().uuid(),owner:z.string().regex(/^[a-f0-9]{64}$/),permissions:connectionPermissionsSchema}).strict();
async function responseJson(response:Response,signal?:AbortSignal){
 signal?.throwIfAborted();if(!response.body)throw new Error('The local plugin returned an empty response.');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){signal?.throwIfAborted();const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>MCP_METADATA_BYTES)throw new Error('Connection metadata exceeds its 2 MB budget.');chunks.push(value.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));boundedJson(value);
 if(!response.ok)throw new Error(typeof value?.error==='string'?value.error:'The local plugin request failed.');return value;
}
function summary(session:DocumentSession){const document=session.document,state=document.getSnapshot();return{id:document.id,name:document.name,revision:state.revision,width:document.width,height:document.height};}

/** Trusted opt-in browser connection, separate from isolated scripts and REST. */
export class ChatGptConnections {
 private owners=new Map<string,Owner>();private connecting=new Set<AbortController>();private listeners=new Set<()=>void>();private snapshot:readonly ChatGptConnectionView[]=Object.freeze([]);private disposed=false;private unsubscribe?:()=>void;private interactionGuard:(sessionId:string)=>boolean=()=>false;
 constructor(private readonly editor:EditorApplication){}
 getSnapshot=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 setInteractionGuard(check:(sessionId:string)=>boolean){this.interactionGuard=check;return()=>{if(this.interactionGuard===check)this.interactionGuard=()=>false;};}
 private publish(){for(const listener of this.listeners)try{listener();}catch{/* An observer cannot change a connection's authority. */}}
 private assertOwner(owner:Owner,signal?:AbortSignal){
  signal?.throwIfAborted();owner.abort.signal.throwIfAborted();if(this.disposed||this.owners.get(owner.id)!==owner||!this.editor.documentSessions.includes(owner.session))throw new Error('The connected document was closed or disconnected.');
 }
 async connect(code:string,sessionId:string,permissions:ConnectionPermissions,control:{signal?:AbortSignal}={}){
  if(this.disposed)throw new Error('ChatGPT connections are closed.');control.signal?.throwIfAborted();
  const target=this.editor.documentSessions.find(session=>session.id===sessionId);if(!target)throw new Error('Choose an open document.');
  const endpoint=parseConnectionCode(code),granted=connectionPermissionsSchema.parse(permissions),abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason),timeout=setTimeout(()=>abort.abort(new Error('The local plugin did not respond. Start a new connection in ChatGPT and retry.')),10_000);
  control.signal?.addEventListener('abort',cancel,{once:true});if(control.signal?.aborted)cancel();
  this.connecting.add(abort);
  let paired:z.infer<typeof pairedSchema>|undefined;
  try{
   paired=pairedSchema.parse(await responseJson(await fetch(endpoint.origin+'/v1/pair',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json'},body:boundedJson({code:endpoint.code,document:summary(target),permissions:granted})}),abort.signal));
   if(JSON.stringify(paired.permissions)!==JSON.stringify(granted))throw new Error('The local plugin changed the requested permissions.');
   abort.signal.throwIfAborted();if(this.disposed||!this.editor.documentSessions.includes(target))throw new Error('The selected document closed while connecting.');
   const owner:Owner={id:paired.id,origin:endpoint.origin,credential:paired.owner,session:target,permissions:granted,abort:new AbortController(),operations:new Map()};
   this.owners.set(owner.id,owner);this.snapshot=Object.freeze([...this.snapshot,Object.freeze({id:owner.id,sessionId:target.id,documentName:target.document.name,permissions:Object.freeze({...granted}),status:'connected' as const,error:''})]);
   this.unsubscribe??=this.editor.subscribe(()=>{for(const candidate of this.owners.values())if(!this.editor.documentSessions.includes(candidate.session))this.disconnect(candidate.id);});
   this.publish();void this.poll(owner);return owner.id;
  }catch(cause){
   if(paired)void fetch(endpoint.origin+'/v1/connections/'+paired.id,{method:'DELETE',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:'Bearer '+paired.owner},keepalive:true}).catch(()=>{});
   else void fetch(endpoint.origin+'/v1/cancel-pair',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:endpoint.code}),keepalive:true}).catch(()=>{});
   throw cause;
  }finally{this.connecting.delete(abort);clearTimeout(timeout);control.signal?.removeEventListener('abort',cancel);}
 }
 private async request(owner:Owner,path:string,options:{method?:string;value?:unknown;signal?:AbortSignal}={}){
  this.assertOwner(owner,options.signal);const signal=options.signal?AbortSignal.any([owner.abort.signal,options.signal]):owner.abort.signal;
  const value=await responseJson(await fetch(owner.origin+'/v1/connections/'+owner.id+path,{method:options.method??'GET',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal,headers:{Authorization:'Bearer '+owner.credential,...(options.value===undefined?{}:{'Content-Type':'application/json'})},...(options.value===undefined?{}:{body:boundedJson(options.value)})}),signal);this.assertOwner(owner,options.signal);return value;
 }
 private async poll(owner:Owner){
  try{while(!owner.abort.signal.aborted){const event=bridgeEventSchema.parse(await this.request(owner,'/events'));if(event.kind==='cancel'){owner.operations.get(event.id)?.abort(new Error('The connected request was cancelled.'));continue;}if(event.kind==='heartbeat')continue;
    if(owner.operations.has(event.id))throw new Error('The plugin repeated an in-flight request.');const abort=new AbortController();owner.operations.set(event.id,abort);void this.handle(owner,event.id,event.operation,abort).finally(()=>owner.operations.delete(event.id));
  }}catch(cause){if(this.owners.get(owner.id)===owner)this.disconnect(owner.id,cause instanceof Error?cause.message:String(cause));}
 }
 private async handle(owner:Owner,id:string,operation:ConnectionOperation,abort:AbortController){
  let result:ConnectionResult;
  try{result=await this.execute(owner,id,operation,abort.signal);}catch(cause){result=cause instanceof ConnectionFailure?failure(cause.code,cause.message,cause.revision):failure(abort.signal.aborted?'CANCELLED':cause instanceof z.ZodError?'INVALID_REQUEST':'FAILED',cause instanceof Error?cause.message:String(cause));}
  try{this.assertOwner(owner);z.object({accepted:z.literal(true)}).strict().parse(await this.request(owner,'/results/'+id,{method:'POST',value:{result,document:summary(owner.session)}}));}catch(cause){if(this.owners.get(owner.id)===owner)this.disconnect(owner.id,cause instanceof Error?cause.message:String(cause));}
 }
 private async execute(owner:Owner,id:string,operation:ConnectionOperation,signal:AbortSignal):Promise<ConnectionResult>{
  this.assertOwner(owner,signal);const document=owner.session.document,assets=owner.session.assets;
  if(operation.kind==='inspect'){
   const state=document.getSnapshot(),value={document:document.toJSON(),revision:state.revision,canUndo:document.canUndo,canRedo:document.canRedo,history:{past:state.past.map(entry=>entry.label),future:state.future.map(entry=>entry.label)},selectedIds:[...state.selectedIds],interactionPending:this.interactionGuard(owner.session.id)};boundedJson(value);return{ok:true,value};
  }
  if(operation.kind==='template'){
   const layer=operation.layerKind==='paint'?new PaintLayer():operation.layerKind==='vector'?new VectorLayer():operation.layerKind==='text'?new TextLayer({text:'Text'}):new LayerGroup();
   const value={layer:layer.toJSON(),revision:document.getSnapshot().revision,inserted:false};boundedJson(value);return{ok:true,value};
  }
  if(!owner.permissions.write)return failure('PERMISSION_DENIED','This document connection is read-only.');
  const check=()=>{this.assertOwner(owner,signal);if(document.getSnapshot().revision!==operation.expectedRevision)throw new ConnectionFailure('REVISION_CONFLICT','Read the current document before revising the edit.',document.getSnapshot().revision);if(this.interactionGuard(owner.session.id))throw new ConnectionFailure('BUSY','Finish the active canvas gesture before connected edits are applied.',document.getSnapshot().revision);};
  if(document.getSnapshot().revision!==operation.expectedRevision)return failure('REVISION_CONFLICT','Read the current document before revising the edit.',document.getSnapshot().revision);
  if(this.interactionGuard(owner.session.id))return failure('BUSY','Finish the active canvas gesture before connected edits are applied.',document.getSnapshot().revision);
  const lifetime=assets.captureLifetime();
  let command:import('../../core/commands').EditorCommand|undefined;
  const stateBefore=document.getSnapshot();let candidate=stateBefore.document;
  if(operation.kind==='apply'){
   const commands=parseCommands(operation.commands);command={type:'transaction',label:operation.label,commands};candidate=execute(document.toJSON(),command);
  }else candidate=(operation.kind==='undo'?stateBefore.past:stateBefore.future).at(-1)?.document??candidate;
  const pinned=[...referencedAssets(candidate)].map(id=>{const source=assets.get(id);return{id,source,bitmap:source.bitmap,blob:source.blob,width:source.width,height:source.height};});
  const checkSources=()=>{check();lifetime();for(const entry of pinned){const source=assets.get(entry.id);if(source!==entry.source||source.bitmap!==entry.bitmap||source.blob!==entry.blob||source.width!==entry.width||source.height!==entry.height||source.bitmap.width!==entry.width||source.bitmap.height!==entry.height)throw new Error('Source assets changed while preparing the connected edit.');}};
  await validateWetPaintAssets(candidate,wetBrowserAssets(assets,checkSources));checkSources();
  z.object({authorized:z.literal(true)}).strict().parse(await this.request(owner,'/authorize/'+id,{method:'POST',signal}));checkSources();
  let warning:string|undefined;
  try{if(operation.kind==='apply')document._withHistoryOrigin({surface:'connected-client',connectionId:owner.id,requestId:id},()=>document._dispatch(command!));else if(operation.kind==='undo')document.undo();else document.redo();}
  catch(cause){if(document.getSnapshot().revision===operation.expectedRevision)throw cause;warning='The edit was recorded, but a document observer failed. Inspect the current document before continuing.';}
  const state=document.getSnapshot();return{ok:true,value:{revision:state.revision,canUndo:document.canUndo,canRedo:document.canRedo,...(warning?{warning}:{})}};
 }
 disconnect(id:string,error=''){
  const owner=this.owners.get(id);if(owner){this.owners.delete(id);owner.abort.abort(new Error('Document disconnected.'));for(const operation of owner.operations.values())operation.abort();owner.operations.clear();void fetch(owner.origin+'/v1/connections/'+id,{method:'DELETE',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:'Bearer '+owner.credential},keepalive:true}).catch(()=>{});owner.credential='';}
  this.snapshot=Object.freeze(error?this.snapshot.map(view=>view.id===id?Object.freeze({...view,status:'error' as const,error}):view):this.snapshot.filter(view=>view.id!==id));this.publish();
 }
 dispose(){if(this.disposed)return;this.disposed=true;for(const controller of this.connecting)controller.abort(new Error('ChatGPT connections are closed.'));this.connecting.clear();for(const id of [...this.owners.keys()])this.disconnect(id);this.unsubscribe?.();this.unsubscribe=undefined;this.listeners.clear();}
}
