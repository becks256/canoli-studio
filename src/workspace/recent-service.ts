import {RecentFileRepository,RECENT_FILES_LIMIT,recentKindSchema,type RecentFileStore,type RecentKind,type RecentSummary} from './recent-files';
import {hashRecentBlob} from './recent-hash';

export interface RecentFilesSnapshot {entries:readonly RecentSummary[];pending:number;loading:boolean;error:string;available:boolean;}
type Hasher=(blob:Blob,signal?:AbortSignal)=>Promise<string>;
/** Optional local file history: failure never turns a successful document open/save into failure. */
export class RecentFilesService {
 private disposed=false;private tail:Promise<unknown>=Promise.resolve();private listeners=new Set<()=>void>();
 private controllers=new Set<AbortController>();private captures=new Set<AbortController>();private channel?:BroadcastChannel;
 private pendingFiles=new Map<AbortController,File>();
 private snapshot:RecentFilesSnapshot;
 private verified=new WeakMap<File,{kind:RecentKind;sha256:string}>();
 constructor(private store:RecentFileStore=new RecentFileRepository(),private hash:Hasher=hashRecentBlob,available=typeof window!=='undefined'&&typeof indexedDB!=='undefined'&&typeof Worker!=='undefined'){
  this.snapshot={entries:[],pending:0,loading:available,error:available?'':'Local recent files are unavailable in this environment.',available};
  if(available){if(typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('luma-recent-files');this.channel.onmessage=event=>{if(event.data?.type==='changed'&&event.data?.version===1){if(['clear','remove'].includes(event.data.action))this.stopPending();void this.refresh().catch(()=>{});}};}void this.refresh().catch(()=>{});}
 }
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 getSnapshot=()=>this.snapshot;
 private publish(patch:Partial<RecentFilesSnapshot>){if(this.disposed)return;this.snapshot={...this.snapshot,...patch};for(const listener of this.listeners)try{listener();}catch(error){console.error('Recent-file listener failed.',error);}}
 private error(cause:unknown){const quota=cause&&typeof cause==='object'&&'name'in cause&&cause.name==='QuotaExceededError';this.publish({error:quota?'The recent-file copy could not be saved because browser storage is full. Keep a project download, remove unneeded local copies, then retry.':cause instanceof Error?cause.message:String(cause),loading:false});}
 private queue<T>(run:()=>Promise<T>):Promise<T>{const next=this.tail.then(()=>{if(this.disposed)throw new Error('Recent files are closed.');return run();});this.tail=next.catch(()=>{});return next;}
 private async list(signal?:AbortSignal){const entries=await this.store.list(signal);signal?.throwIfAborted();this.publish({entries,loading:false,error:''});}
 private changed(action:'record'|'remove'|'clear'){if(!this.disposed)this.channel?.postMessage({type:'changed',version:1,action});}
 refresh():Promise<void>{
  if(!this.snapshot.available)return Promise.reject(new Error(this.snapshot.error));
  return this.queue(async()=>{try{await this.list();}catch(error){this.error(error);throw error;}});
 }
 remember(file:File,kind:RecentKind):void{
  if(this.disposed||!this.snapshot.available)return;
  // Capture mutable metadata before queueing. Blob/File byte contents are immutable.
  let metadata:{kind:RecentKind;name:string;mime:string;size:number;lastModified:number};
  try{if(!(file instanceof File))throw new Error('Recent files require a file with a name.');recentKindSchema.parse(kind);metadata={kind,name:file.name,mime:file.type,size:file.size,lastModified:file.lastModified};}catch(error){this.error(error);return;}
  const active=[...this.captures].filter(controller=>!controller.signal.aborted);if(active.length>=RECENT_FILES_LIMIT)active[0].abort(new DOMException('A newer recent-file copy superseded this pending copy.','AbortError'));
  const abort=new AbortController(),release=()=>{this.pendingFiles.delete(abort);};abort.signal.addEventListener('abort',release,{once:true});this.pendingFiles.set(abort,file);this.controllers.add(abort);this.captures.add(abort);this.publish({pending:[...this.captures].filter(controller=>!controller.signal.aborted).length});
  void this.queue(async()=>{
   try{abort.signal.throwIfAborted();const source=this.pendingFiles.get(abort);if(!source)throw new Error('The pending local copy is no longer available.');const generation=await this.store.generation(abort.signal),verified=this.verified.get(source),sha256=verified?.kind===kind?verified.sha256:await this.hash(source,abort.signal);abort.signal.throwIfAborted();await this.store.record({...metadata,generation,sha256,blob:source},abort.signal);await this.list(abort.signal);this.changed('record');}
   catch(error){if(!abort.signal.aborted)this.error(error);}
   finally{release();abort.signal.removeEventListener('abort',release);this.controllers.delete(abort);this.captures.delete(abort);this.publish({pending:[...this.captures].filter(controller=>!controller.signal.aborted).length});}
  }).catch(()=>{});
 }
 async read(id:string,signal?:AbortSignal):Promise<{file:File;kind:RecentKind}>{
  if(!this.snapshot.available)throw new Error(this.snapshot.error);signal?.throwIfAborted();
  const abort=new AbortController(),cancel=()=>abort.abort(signal?.reason);this.controllers.add(abort);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try{return await this.queue(async()=>{
   abort.signal.throwIfAborted();const selected=await this.store.get(id,abort.signal),sha256=await this.hash(selected.blob,abort.signal);abort.signal.throwIfAborted();
   if(sha256!==selected.entry.sha256)throw new Error('The local copy failed its integrity check. Open the original file instead.');
   const latest=await this.store.get(id,abort.signal);abort.signal.throwIfAborted();
   if(latest.entry.sha256!==sha256||latest.entry.kind!==selected.entry.kind||latest.entry.name!==selected.entry.name||latest.entry.size!==selected.entry.size||latest.entry.mime!==selected.entry.mime||latest.entry.lastModified!==selected.entry.lastModified)throw new Error('The recent file changed during opening. Choose it again.');
   const file=new File([selected.blob],selected.entry.name,{type:selected.entry.mime,lastModified:selected.entry.lastModified});this.verified.set(file,{kind:selected.entry.kind,sha256});return{file,kind:selected.entry.kind};
  });}finally{this.controllers.delete(abort);signal?.removeEventListener('abort',cancel);}
 }
 private stopPending(){for(const controller of this.controllers)controller.abort(new DOMException('Recent-file copies changed.','AbortError'));}
 remove(id:string):Promise<void>{this.stopPending();return this.queue(async()=>{try{await this.store.remove(id);await this.list();this.changed('remove');}catch(error){this.error(error);throw error;}});}
 clear():Promise<void>{this.stopPending();return this.queue(async()=>{try{await this.store.clear();await this.list();this.changed('clear');}catch(error){this.error(error);throw error;}});}
 /** Wait for currently queued background copies; does not manufacture persistence success. */
 async flush():Promise<void>{await this.tail;}
 dispose(){if(this.disposed)return;this.stopPending();this.disposed=true;this.controllers.clear();this.captures.clear();this.pendingFiles.clear();this.snapshot={...this.snapshot,pending:0,loading:false};this.store.dispose();this.channel?.close();this.listeners.clear();}
}
