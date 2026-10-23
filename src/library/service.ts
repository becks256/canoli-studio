import {ArtworkRepository} from './storage';
import {artworkContentSchema,artworkMetadataSchema,artworkRow,type ArtworkMetadata,type ArtworkEntry,type ArtworkSummary,type PreparedArtwork} from './model';
import {artworkWorker,type ArtworkWorkerRequest} from './client';
export interface ArtworkLibrarySnapshot {entries:readonly ArtworkSummary[];loading:boolean;pending:number;error:string;available:boolean}
type ArtworkStore=Pick<ArtworkRepository,'epoch'|'list'|'read'|'recover'|'guard'|'install'|'update'|'remove'|'clear'|'dispose'>;
type Worker=(request:ArtworkWorkerRequest,signal?:AbortSignal)=>Promise<unknown>;
const available=()=>{try{return typeof window!=='undefined'&&typeof indexedDB!=='undefined'&&typeof globalThis.Worker!=='undefined';}catch{return false;}};
/** Explicit optional local storage. No account, canvas mutation or startup I/O. */
export class ArtworkLibrary {
 private workerTail:Promise<unknown>=Promise.resolve();private disposed=false;private controllers=new Set<AbortController>();private listeners=new Set<()=>void>();private channel?:BroadcastChannel;private snapshot:ArtworkLibrarySnapshot;
 constructor(private repository:ArtworkStore=new ArtworkRepository(),private worker:Worker=artworkWorker,supported=available()){
  this.snapshot={entries:[],loading:false,pending:0,error:supported?'':'The local artwork library is unavailable in this environment.',available:supported};
  try{if(supported&&typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('canoli-artwork-library');this.channel.onmessage=event=>{if(event.data?.type==='changed'&&event.data?.version===1){this.cancel();void this.refresh().catch(()=>{});}};}}catch{/* Durable epochs remain authoritative without notifications. */}
 }
 getSnapshot=()=>this.snapshot;subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(patch:Partial<ArtworkLibrarySnapshot>){if(this.disposed)return;this.snapshot={...this.snapshot,...patch};for(const listener of this.listeners)try{listener();}catch{/* A UI subscriber cannot reverse committed storage. */}}
 private prepare(request:ArtworkWorkerRequest,signal:AbortSignal):Promise<unknown>{const next=this.workerTail.then(()=>{signal.throwIfAborted();return this.worker(request,signal);});this.workerTail=next.catch(()=>{});return next;}
 private async committed(){try{await this.list();}catch{this.publish({loading:false,error:'The library change was saved, but its list could not refresh. Reload the artwork library.'});}this.changed();}
 private changed(){try{this.channel?.postMessage({type:'changed',version:1});}catch{/* Committed results remain acknowledged. */}}
 private async operation<T>(run:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(this.disposed||!this.snapshot.available)throw new Error(this.snapshot.error||'Artwork library is closed.');signal?.throwIfAborted();const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason);this.controllers.add(controller);signal?.addEventListener('abort',cancel,{once:true});this.publish({pending:this.controllers.size,error:''});
  try{return await run(controller.signal);}catch(error){if(!controller.signal.aborted)this.publish({error:error&&typeof error==='object'&&'name'in error&&error.name==='QuotaExceededError'?'Browser storage is full. Export a library pack, remove unneeded entries and retry.':error instanceof Error?error.message:String(error)});throw error;}finally{this.controllers.delete(controller);signal?.removeEventListener('abort',cancel);this.publish({pending:this.controllers.size});}
 }
 private async list(signal?:AbortSignal){const rows=await this.repository.list(signal);signal?.throwIfAborted();const entries=rows.map(row=>{try{const entry=artworkRow(row);return{id:entry.id,entry,error:''};}catch{return{id:typeof row.key==='string'?row.key:null,entry:null,error:'This artwork record is unreadable. Recover its bytes before removing it.'};}});entries.sort((a,b)=>(b.entry?.updatedAt??0)-(a.entry?.updatedAt??0));this.publish({entries,loading:false});}
 refresh(signal?:AbortSignal):Promise<void>{return this.operation(async current=>{this.publish({loading:true});try{await this.list(current);}finally{this.publish({loading:false});}},signal);}
 generation(signal?:AbortSignal):Promise<string>{if(this.disposed)throw new Error('Artwork library is closed.');return this.repository.epoch(signal);}
 async save(prepare:()=>Promise<Blob>,metadata:ArtworkMetadata,signal?:AbortSignal):Promise<{entry:ArtworkEntry;added:boolean}>{const normalized=artworkMetadataSchema.parse(metadata);return this.operation(async current=>{
  const epoch=await this.repository.epoch(current);current.throwIfAborted();const blob=await prepare();current.throwIfAborted();const content=artworkContentSchema.parse(await this.prepare({type:'inspect',blob},current));current.throwIfAborted();const result=await this.repository.install([{metadata:normalized,content,blob}],epoch,current);await this.committed();return{entry:result.entries[0],added:result.added===1};
 },signal);}
 async read(id:string,signal?:AbortSignal):Promise<{entry:ArtworkEntry;blob:Blob;generation:string}>{return this.operation(async current=>{
  const epoch=await this.repository.epoch(current),value=await this.repository.read(id,current),content=artworkContentSchema.parse(await this.prepare({type:'inspect',blob:value.blob},current));current.throwIfAborted();if(JSON.stringify(content)!==JSON.stringify(value.entry.content))throw new Error('Saved artwork failed its content integrity check. Recover the stored bytes or restore a pack.');if(await this.repository.epoch(current)!==epoch)throw new Error('Artwork library changed during preparation. Reload and choose it again.');return{...value,generation:epoch};
 },signal);}
 commitPlacement(value:{entry:ArtworkEntry;generation:string},commit:()=>void,signal?:AbortSignal){return this.operation(current=>this.repository.guard(value.entry,value.generation,commit,current),signal);}
 async update(entry:ArtworkEntry,metadata:ArtworkMetadata,signal?:AbortSignal){return this.operation(async current=>{const value=await this.repository.update(entry.id,entry.revision,metadata,current);await this.committed();return value;},signal);}
 async importPack(blob:Blob,signal?:AbortSignal){return this.operation(async current=>{const epoch=await this.repository.epoch(current),entries=await this.prepare({type:'import',blob},current) as PreparedArtwork[];current.throwIfAborted();const result=await this.repository.install(entries,epoch,current);await this.committed();return{added:result.added,reused:result.entries.length-result.added};},signal);}
 async exportPack(ids:readonly string[],signal?:AbortSignal):Promise<Blob>{return this.operation(async current=>{if(!ids.length)throw new Error('Choose artwork to export.');const epoch=await this.repository.epoch(current),entries:PreparedArtwork[]=[];for(const id of new Set(ids)){const value=await this.repository.read(id,current);entries.push({metadata:value.entry.metadata,content:value.entry.content,blob:value.blob});}const blob=await this.prepare({type:'export',entries},current);current.throwIfAborted();if(!(blob instanceof Blob)||await this.repository.epoch(current)!==epoch)throw new Error('Artwork library changed during pack export. Reload and retry.');return blob;},signal);}
 async recover(id:string,signal?:AbortSignal){return this.operation(current=>this.repository.recover(id,current),signal);}
 async remove(id:string){this.cancel();return this.operation(async current=>{await this.repository.remove(id,current);await this.committed();});}
 async clear(){this.cancel();return this.operation(async current=>{await this.repository.clear(current);await this.committed();});}
 cancel(){for(const controller of this.controllers)controller.abort(new DOMException('Artwork operation cancelled.','AbortError'));}
 dispose(){if(this.disposed)return;this.cancel();this.disposed=true;this.repository.dispose();this.channel?.close();this.listeners.clear();}
}
