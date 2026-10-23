import {z} from 'zod';
import {lensDatabaseSourceSchema,type LensDatabaseSource} from './catalog';

export const LENS_LIBRARY_DATABASE='canoli-lens-profiles';
export interface StoredLensDatabase {version:1;source:LensDatabaseSource;blob:Blob}
const storedSchema=z.object({version:z.literal(1),source:lensDatabaseSourceSchema,blob:z.instanceof(Blob)}).strict();
export function storedLensDatabase(value:unknown,key:IDBValidKey):StoredLensDatabase{
  const row=storedSchema.parse(value);
  if(row.source.sha256!==key||row.source.byteLength!==row.blob.size||row.source.type!==row.blob.type)throw new Error('Stored lens database identity or extent differs from its original.');return row;
}
export interface LensDatabaseRow {key:IDBValidKey;value:unknown}
/** Original XML only. Compiled/parsed profiles are deliberately not a second persisted truth. */
export class LensLibraryRepository {
  private disposed=false;
  private active=new Map<IDBTransaction,(cause:unknown)=>void>();
  private database():Promise<IDBDatabase>{
    if(this.disposed)return Promise.reject(new Error('Lens library is closed.'));
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(LENS_LIBRARY_DATABASE,1);let settled=false;
      request.onupgradeneeded=()=>{if(this.disposed||settled){request.transaction?.abort();return;}for(const name of ['files','state'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
      request.onblocked=()=>{settled=true;reject(new Error('Lens library storage is blocked by another tab. Close that tab and retry.'));};
      request.onerror=()=>{settled=true;reject(request.error??new Error('Lens library storage could not be opened.'));};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();if(this.disposed||settled){db.close();if(!settled)reject(new Error('Lens library is closed.'));}else{settled=true;resolve(db);}};
    });
  }
  private async transaction<T>(mode:IDBTransactionMode,body:(tx:IDBTransaction,result:(value:T)=>void,fail:(cause:unknown)=>void)=>void,signal?:AbortSignal):Promise<T>{
    signal?.throwIfAborted();const db=await this.database();
    try{return await new Promise<T>((resolve,reject)=>{
      let tx:IDBTransaction,result:T,cause:unknown;
      try{signal?.throwIfAborted();if(this.disposed)throw new Error('Lens library is closed.');tx=db.transaction(['files','state'],mode);}catch(error){reject(error);return;}
      const finish=()=>{this.active.delete(tx);signal?.removeEventListener('abort',abort);};
      const fail=(error:unknown)=>{cause=error;try{tx.abort();}catch{finish();reject(error);}};
      const abort=()=>fail(signal?.reason??new Error('Lens library operation cancelled.'));
      this.active.set(tx,fail);tx.oncomplete=()=>{finish();resolve(result);};tx.onabort=()=>{finish();reject(cause??tx.error??new Error('Lens library transaction failed.'));};
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
      try{body(tx,value=>{result=value;},fail);}catch(error){fail(error);}
    });}finally{db.close();}
  }
  private epochIn(tx:IDBTransaction,read:(value:string)=>void,fail:(cause:unknown)=>void){
    const request=tx.objectStore('state').get('epoch');request.onsuccess=()=>{try{read(request.result===undefined?'initial':z.string().min(1).max(128).parse(request.result));}catch(cause){fail(cause);}};
  }
  epoch(signal?:AbortSignal):Promise<string>{return this.transaction('readonly',(tx,result,fail)=>this.epochIn(tx,result,fail),signal);}
  list(signal?:AbortSignal):Promise<LensDatabaseRow[]>{
    return this.transaction('readonly',(tx,result,fail)=>{
      const rows:LensDatabaseRow[]=[],request=tx.objectStore('files').openCursor();request.onsuccess=()=>{try{const cursor=request.result;if(cursor){rows.push({key:cursor.key,value:cursor.value});cursor.continue();}else result(rows);}catch(cause){fail(cause);}};
    },signal);
  }
  read(key:IDBValidKey,signal?:AbortSignal):Promise<unknown>{return this.transaction('readonly',(tx,result)=>{const request=tx.objectStore('files').get(key);request.onsuccess=()=>result(request.result);},signal);}
  install(source:LensDatabaseSource,blob:Blob,expectedEpoch:string,signal?:AbortSignal):Promise<void>{
    const row=storedLensDatabase({version:1,source,blob},source.sha256);z.string().min(1).max(128).parse(expectedEpoch);
    return this.transaction('readwrite',(tx,result,fail)=>this.epochIn(tx,epoch=>{
      if(epoch!==expectedEpoch){fail(new Error('Lens library changed during import. Refresh and retry.'));return;}
      tx.objectStore('files').put(row,row.source.sha256);tx.objectStore('state').put(crypto.randomUUID(),'epoch');result();
    },fail),signal);
  }
  remove(key:IDBValidKey,signal?:AbortSignal):Promise<void>{return this.transaction('readwrite',(tx,result)=>{tx.objectStore('files').delete(key);tx.objectStore('state').put(crypto.randomUUID(),'epoch');result();},signal);}
  clear(signal?:AbortSignal):Promise<void>{return this.transaction('readwrite',(tx,result)=>{tx.objectStore('files').clear();tx.objectStore('state').put(crypto.randomUUID(),'epoch');result();},signal);}
  dispose(){if(this.disposed)return;this.disposed=true;for(const fail of [...this.active.values()])fail(new Error('Lens library is closed.'));this.active.clear();}
}
