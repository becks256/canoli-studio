import {z} from 'zod';

export const RECENT_FILES_DATABASE='luma-recent-files';
export const RECENT_FILES_LIMIT=20;
export const recentKindSchema=z.enum(['project','image','svg','tiff','avif','raw','photoshop']);
export type RecentKind=z.infer<typeof recentKindSchema>;
const extent=z.number().int().nonnegative().safe();
export const recentEntrySchema=z.object({
 version:z.literal(1),id:z.string().min(1).max(120),kind:recentKindSchema,name:z.string().min(1).max(1024),mime:z.string().max(128),
 size:extent.positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),lastModified:z.number().int().safe(),openedAt:extent.max(8640000000000000),rank:extent,
}).strict();
export type RecentEntry=z.infer<typeof recentEntrySchema>;
export type RecentSummary={id:string|null;name:string;kind:RecentKind|null;size:number|null;openedAt:number|null;lastModified:number|null;error?:string};
type Row={key:IDBValidKey;value:unknown};
type PreparedFile={kind:RecentKind;name:string;mime:string;size:number;lastModified:number;sha256:string;blob:Blob;generation:string};
export interface RecentFileStore {
 generation(signal?:AbortSignal):Promise<string>;
 list(signal?:AbortSignal):Promise<RecentSummary[]>;
 record(file:PreparedFile,signal?:AbortSignal):Promise<RecentEntry>;
 get(id:string,signal?:AbortSignal):Promise<{entry:RecentEntry;blob:Blob}>;
 remove(id:string,signal?:AbortSignal):Promise<void>;
 clear(signal?:AbortSignal):Promise<void>;
 dispose():void;
}

function validRow(row:Row):RecentEntry{
 const entry=recentEntrySchema.parse(row.value);if(entry.id!==row.key)throw new Error('Recent-file identifier changed.');return entry;
}
/** Own database: entry/blob publication, eviction and reference cleanup share a transaction. */
export class RecentFileRepository implements RecentFileStore {
 private disposed=false;private active=new Set<IDBTransaction>();private opening=new Set<IDBOpenDBRequest>();
 private database():Promise<IDBDatabase>{
  if(this.disposed)return Promise.reject(new Error('Recent files are closed.'));
  return new Promise((resolve,reject)=>{
   const request=indexedDB.open(RECENT_FILES_DATABASE,2);this.opening.add(request);let settled=false;
   request.onupgradeneeded=()=>{if(settled||this.disposed){request.transaction?.abort();return;}for(const name of ['entries','blobs','state'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
   request.onerror=()=>{this.opening.delete(request);settled=true;reject(request.error??new Error('Recent-file storage could not be opened.'));};
   request.onblocked=()=>{settled=true;reject(new Error('Recent-file storage is blocked by another tab. Close that tab and retry.'));};
   request.onsuccess=()=>{this.opening.delete(request);const db=request.result;db.onversionchange=()=>db.close();if(this.disposed||settled){db.close();if(!settled)reject(new Error('Recent files are closed.'));}else{settled=true;resolve(db);}};
  });
 }
 private async transaction<T>(mode:IDBTransactionMode,body:(tx:IDBTransaction,result:(value:T)=>void,fail:(error:unknown)=>void)=>void,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const db=await this.database();
  try{return await new Promise<T>((resolve,reject)=>{
   let result:T,cause:unknown,tx:IDBTransaction;try{signal?.throwIfAborted();if(this.disposed)throw new Error('Recent files are closed.');tx=db.transaction(['entries','blobs','state'],mode);}catch(error){reject(error);return;}
   this.active.add(tx);const abort=()=>{cause=signal?.reason;try{tx.abort();}catch{/* Completion already won. */}},done=()=>{this.active.delete(tx);signal?.removeEventListener('abort',abort);};
   const fail=(error:unknown)=>{cause=error;try{tx.abort();}catch{done();reject(error);}};
   tx.oncomplete=()=>{done();resolve(result);};tx.onabort=()=>{done();reject(cause??tx.error??new Error('Recent-file storage transaction failed.'));};
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
   try{body(tx,value=>{result=value;},fail);}catch(error){fail(error);}
  });}finally{db.close();}
 }
 private scan(tx:IDBTransaction,run:(rows:Row[])=>void,fail:(error:unknown)=>void){
  const rows:Row[]=[],request=tx.objectStore('entries').openCursor();request.onsuccess=()=>{try{const cursor=request.result;if(cursor){rows.push({key:cursor.key,value:cursor.value});cursor.continue();}else run(rows);}catch(error){fail(error);}};
 }
 private collect(tx:IDBTransaction,entries:RecentEntry[],fail:(error:unknown)=>void){
  const retained=new Set(entries.map(entry=>entry.sha256)),request=tx.objectStore('blobs').openKeyCursor();request.onsuccess=()=>{try{const cursor=request.result;if(!cursor)return;if(!retained.has(String(cursor.key)))tx.objectStore('blobs').delete(cursor.key);cursor.continue();}catch(error){fail(error);}};
 }
 private epoch(tx:IDBTransaction,run:(generation:string)=>void,fail:(error:unknown)=>void){const request=tx.objectStore('state').get('generation');request.onsuccess=()=>{try{run(request.result===undefined?'initial':z.string().min(1).max(120).parse(request.result));}catch(error){fail(error);}};}
 generation(signal?:AbortSignal):Promise<string>{return this.transaction('readonly',(tx,result,fail)=>this.epoch(tx,result,fail),signal);}
 list(signal?:AbortSignal):Promise<RecentSummary[]>{
  return this.transaction('readonly',(tx,result,fail)=>this.scan(tx,rows=>{
   const values=rows.map(row=>{try{const value=validRow(row);return{summary:{id:value.id,name:value.name,kind:value.kind,size:value.size,openedAt:value.openedAt,lastModified:value.lastModified},rank:value.rank};}catch{return{summary:{id:typeof row.key==='string'&&row.key.length>0&&row.key.length<=120?row.key:null,name:'Unavailable local copy',kind:null,size:null,openedAt:null,lastModified:null,error:'This saved entry is unreadable. Remove it, or clear recent copies if removal is unavailable.'},rank:-1};}});
   values.sort((a,b)=>b.rank-a.rank);result(values.map(value=>value.summary));
  },fail),signal);
 }
 record(file:PreparedFile,signal?:AbortSignal):Promise<RecentEntry>{
  // Validate before opening storage; the hash was prepared from immutable source bytes.
  const prepared=recentEntrySchema.parse({version:1,id:'prepared',kind:file.kind,name:file.name,mime:file.mime,size:file.size,sha256:file.sha256,lastModified:file.lastModified,openedAt:Date.now(),rank:0});
  if(!(file.blob instanceof Blob)||file.blob.size!==prepared.size)throw new Error('Recent-file copy has an invalid byte extent.');
  return this.transaction('readwrite',(tx,result,fail)=>this.epoch(tx,generation=>{if(file.generation!==generation)throw new Error('Recent copies changed while this copy was being prepared. Reopen the original file to retry.');this.scan(tx,rows=>{
   let entries:RecentEntry[];try{entries=rows.map(validRow);}catch{throw new Error('Recent files contain an unreadable entry. Remove it or clear recent copies before saving more.');}
   const prior=entries.find(entry=>entry.kind===prepared.kind&&entry.name===prepared.name&&entry.sha256===prepared.sha256),rank=Math.max(0,...entries.map(entry=>entry.rank))+1;
   const entry=recentEntrySchema.parse({...prepared,id:prior?.id??crypto.randomUUID(),rank});
   entries=[entry,...entries.filter(item=>item.id!==entry.id)].sort((a,b)=>b.rank-a.rank);
   const retained=entries.slice(0,RECENT_FILES_LIMIT),store=tx.objectStore('entries');store.put(entry,entry.id);for(const old of entries.slice(RECENT_FILES_LIMIT))store.delete(old.id);
   tx.objectStore('blobs').put(file.blob.slice(0,file.blob.size),entry.sha256);this.collect(tx,retained,fail);result(entry);
  },fail);},fail),signal);
 }
 get(id:string,signal?:AbortSignal):Promise<{entry:RecentEntry;blob:Blob}>{
  z.string().min(1).max(120).parse(id);
  return this.transaction('readonly',(tx,result,fail)=>{const request=tx.objectStore('entries').get(id);request.onsuccess=()=>{try{const entry=validRow({key:id,value:request.result}),payload=tx.objectStore('blobs').get(entry.sha256);payload.onsuccess=()=>{try{if(!(payload.result instanceof Blob)||payload.result.size!==entry.size)throw new Error('The local copy is missing or incomplete. Open the original file instead.');result({entry,blob:payload.result});}catch(error){fail(error);}};}catch(error){fail(error);}};},signal);
 }
 remove(id:string,signal?:AbortSignal):Promise<void>{
  z.string().min(1).max(120).parse(id);
  return this.transaction('readwrite',(tx,result,fail)=>this.scan(tx,rows=>{tx.objectStore('state').put(crypto.randomUUID(),'generation');tx.objectStore('entries').delete(id);const rest=rows.filter(row=>row.key!==id);try{this.collect(tx,rest.map(validRow),fail);}catch{/* Preserve unknown references until explicit recovery. */}result();},fail),signal);
 }
 clear(signal?:AbortSignal):Promise<void>{return this.transaction('readwrite',(tx,result)=>{tx.objectStore('state').put(crypto.randomUUID(),'generation');tx.objectStore('entries').clear();tx.objectStore('blobs').clear();result();},signal);}
 dispose(){this.disposed=true;for(const tx of this.active)try{tx.abort();}catch{/* Already completed. */}this.active.clear();}
}
