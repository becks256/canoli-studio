import {z} from 'zod';
import {artworkRow,artworkEntrySchema,artworkMetadataSchema,artworkContentSchema,type ArtworkRow,type ArtworkEntry,type PreparedArtwork,type ArtworkMetadata} from './model';
export const ARTWORK_LIBRARY_DATABASE='canoli-artwork-library';
/** Entries and content-addressed native projects commit in one private transaction. */
export class ArtworkRepository {
 private disposed=false;private active=new Map<IDBTransaction,(cause:unknown)=>void>();
 private database():Promise<IDBDatabase>{
  if(this.disposed)return Promise.reject(new Error('Artwork library is closed.'));
  return new Promise((resolve,reject)=>{const request=indexedDB.open(ARTWORK_LIBRARY_DATABASE,1);let settled=false;
   request.onupgradeneeded=()=>{if(this.disposed||settled){request.transaction?.abort();return;}for(const name of ['entries','blobs','state'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
   request.onblocked=()=>{settled=true;reject(new Error('Artwork library is blocked by another tab. Close that tab and retry.'));};request.onerror=()=>{settled=true;reject(request.error??new Error('Artwork library storage is unavailable.'));};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();if(this.disposed||settled){db.close();if(!settled)reject(new Error('Artwork library is closed.'));}else{settled=true;resolve(db);}};
  });
 }
 private async transaction<T>(mode:IDBTransactionMode,body:(tx:IDBTransaction,result:(value:T)=>void,fail:(cause:unknown)=>void)=>void,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const db=await this.database();try{return await new Promise<T>((resolve,reject)=>{let tx:IDBTransaction,result:T,cause:unknown;
   try{signal?.throwIfAborted();if(this.disposed)throw new Error('Artwork library is closed.');tx=db.transaction(['entries','blobs','state'],mode);}catch(error){reject(error);return;}
   const finish=()=>{this.active.delete(tx);signal?.removeEventListener('abort',abort);},fail=(error:unknown)=>{cause=error;try{tx.abort();}catch{finish();reject(error);}},abort=()=>fail(signal?.reason??new DOMException('Artwork operation cancelled.','AbortError'));
   this.active.set(tx,fail);tx.oncomplete=()=>{finish();resolve(result);};tx.onabort=()=>{finish();reject(cause??tx.error??new Error('Artwork storage transaction failed.'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}try{body(tx,value=>{result=value;},fail);}catch(error){fail(error);}
  });}finally{db.close();}
 }
 private scan(tx:IDBTransaction,read:(rows:ArtworkRow[])=>void,fail:(cause:unknown)=>void){const rows:ArtworkRow[]=[],request=tx.objectStore('entries').openCursor();request.onsuccess=()=>{try{const cursor=request.result;if(cursor){rows.push({key:cursor.key,value:cursor.value});cursor.continue();}else read(rows);}catch(error){fail(error);}};}
 private epochIn(tx:IDBTransaction,read:(value:string)=>void,fail:(cause:unknown)=>void){const request=tx.objectStore('state').get('epoch');request.onsuccess=()=>{try{read(request.result===undefined?'initial':z.string().min(1).max(128).parse(request.result));}catch(error){fail(error);}};}
 private advance(tx:IDBTransaction){tx.objectStore('state').put(crypto.randomUUID(),'epoch');}
 epoch(signal?:AbortSignal):Promise<string>{return this.transaction('readonly',(tx,result,fail)=>this.epochIn(tx,result,fail),signal);}
 list(signal?:AbortSignal):Promise<ArtworkRow[]>{return this.transaction('readonly',(tx,result,fail)=>this.scan(tx,result,fail),signal);}
 read(id:string,signal?:AbortSignal):Promise<{entry:ArtworkEntry;blob:Blob}>{return this.transaction('readonly',(tx,result,fail)=>{const request=tx.objectStore('entries').get(id);request.onsuccess=()=>{try{const entry=artworkRow({key:id,value:request.result}),payload=tx.objectStore('blobs').get(entry.content.sha256);payload.onsuccess=()=>{try{if(!(payload.result instanceof Blob)||payload.result.size!==entry.content.bytes)throw new Error('Saved artwork bytes are missing or incomplete. Recover the stored copy or restore a pack.');result({entry,blob:payload.result});}catch(error){fail(error);}};}catch(error){fail(error);}};},signal);}
 recover(id:string,signal?:AbortSignal):Promise<Blob>{return this.transaction('readonly',(tx,result,fail)=>{const request=tx.objectStore('entries').get(id);request.onsuccess=()=>{try{const digest=z.string().regex(/^[a-f0-9]{64}$/).parse(request.result?.content?.sha256),payload=tx.objectStore('blobs').get(digest);payload.onsuccess=()=>{if(payload.result instanceof Blob)result(payload.result);else fail(new Error('No recoverable stored artwork bytes remain.'));};}catch(error){fail(error);}};},signal);}
 /** Serialize the final synchronous model commit against library removal/editing. */
 guard(entry:ArtworkEntry,epoch:string,commit:()=>void,signal?:AbortSignal):Promise<void>{return this.transaction('readonly',(tx,result,fail)=>this.epochIn(tx,current=>{if(current!==epoch)throw new Error('Artwork library changed before placement. Reload and retry.');const request=tx.objectStore('entries').get(entry.id);request.onsuccess=()=>{try{const latest=artworkRow({key:entry.id,value:request.result});if(latest.revision!==entry.revision||latest.content.sha256!==entry.content.sha256)throw new Error('Saved artwork changed before placement.');signal?.throwIfAborted();commit();result();}catch(error){fail(error);}};},fail),signal);}
 install(input:PreparedArtwork[],expectedEpoch:string,signal?:AbortSignal):Promise<{entries:ArtworkEntry[];added:number}>{
  const prepared=input.map(item=>{const metadata=artworkMetadataSchema.parse(item.metadata),content=artworkContentSchema.parse(item.content);if(!(item.blob instanceof Blob)||item.blob.size!==content.bytes)throw new Error('Invalid artwork byte extent.');return{metadata,content,blob:item.blob};});
  return this.transaction('readwrite',(tx,result,fail)=>this.epochIn(tx,epoch=>{if(epoch!==expectedEpoch)throw new Error('Artwork library changed during preparation. Reload and retry.');this.scan(tx,rows=>{
   let entries:ArtworkEntry[];try{entries=rows.map(artworkRow);}catch{throw new Error('Recover or remove unreadable library entries before installing more artwork.');}
   const byHash=new Map(entries.map(entry=>[entry.content.sha256,entry])),installed:ArtworkEntry[]=[];let added=0;
   for(const item of prepared){const previous=byHash.get(item.content.sha256);if(previous){if(JSON.stringify(previous.content)!==JSON.stringify(item.content))throw new Error('Duplicate artwork content metadata disagrees.');tx.objectStore('blobs').put(item.blob,previous.content.sha256);installed.push(previous);continue;}
    const now=Date.now(),entry=artworkEntrySchema.parse({version:1,id:crypto.randomUUID(),revision:crypto.randomUUID(),createdAt:now,updatedAt:now,metadata:item.metadata,content:item.content});tx.objectStore('entries').put(entry,entry.id);tx.objectStore('blobs').put(item.blob,entry.content.sha256);byHash.set(entry.content.sha256,entry);installed.push(entry);added++;
   }
   if(prepared.length)this.advance(tx);result({entries:installed,added});
  },fail);},fail),signal);
 }
 update(id:string,revision:string,metadata:ArtworkMetadata,signal?:AbortSignal):Promise<ArtworkEntry>{const normalized=artworkMetadataSchema.parse(metadata);return this.transaction('readwrite',(tx,result,fail)=>{const request=tx.objectStore('entries').get(id);request.onsuccess=()=>{try{const previous=artworkRow({key:id,value:request.result});if(previous.revision!==revision)throw new Error('This artwork was changed in another tab. Reload before saving.');const entry=artworkEntrySchema.parse({...previous,metadata:normalized,revision:crypto.randomUUID(),updatedAt:Date.now()});tx.objectStore('entries').put(entry,id);this.advance(tx);result(entry);}catch(error){fail(error);}};},signal);}
 remove(id:string,signal?:AbortSignal):Promise<void>{return this.transaction('readwrite',(tx,result,fail)=>this.scan(tx,rows=>{tx.objectStore('entries').delete(id);this.advance(tx);let rest:ArtworkEntry[];try{rest=rows.filter(row=>row.key!==id).map(artworkRow);}catch{result();return;}const retained=new Set(rest.map(entry=>entry.content.sha256)),request=tx.objectStore('blobs').openKeyCursor();request.onsuccess=()=>{try{const cursor=request.result;if(cursor){if(!retained.has(String(cursor.key)))tx.objectStore('blobs').delete(cursor.key);cursor.continue();}}catch(error){fail(error);}};result();},fail),signal);}
 clear(signal?:AbortSignal):Promise<void>{return this.transaction('readwrite',(tx,result)=>{tx.objectStore('entries').clear();tx.objectStore('blobs').clear();this.advance(tx);result();},signal);}
 dispose(){if(this.disposed)return;this.disposed=true;for(const fail of [...this.active.values()])fail(new Error('Artwork library is closed.'));this.active.clear();}
}
