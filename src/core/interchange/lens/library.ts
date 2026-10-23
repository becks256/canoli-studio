import {freezeOwnedData} from '../../immutable';
import {parseLensDatabaseFile} from './client';
import {LensLibraryRepository,storedLensDatabase} from './storage';
import {lensDatabaseSourceSchema,type LensCatalog,type LensDatabaseSource} from './catalog';
import type {LensProfileData} from './schema';

export interface LensLibraryControl {signal?:AbortSignal}
export interface LensLibraryEntry {readonly key:IDBValidKey;readonly source:LensDatabaseSource|null;readonly catalog:LensCatalog|null;readonly error:string;readonly recoverable:boolean}
function errorMessage(cause:unknown){return cause&&typeof cause==='object'&&'name'in cause&&cause.name==='QuotaExceededError'?'The lens database could not be saved because browser storage is full. Export or remove unneeded local databases and retry.':cause instanceof Error?cause.message:String(cause);}
/** Trusted local data service. Construction/installation never executes document commands. */
export class LensLibraryService {
  private disposed=false;private controllers=new Set<AbortController>();
  constructor(private readonly repository=new LensLibraryRepository()){}
  private async operation<T>(control:LensLibraryControl,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(this.disposed)throw new Error('Lens library is closed.');control.signal?.throwIfAborted();
    const owned=new AbortController(),abort=()=>owned.abort(control.signal?.reason);this.controllers.add(owned);control.signal?.addEventListener('abort',abort,{once:true});
    try{return await run(owned.signal);}catch(cause){throw new Error(errorMessage(cause),{cause});}
    finally{control.signal?.removeEventListener('abort',abort);this.controllers.delete(owned);}
  }
  install(blob:Blob,name:string,control:LensLibraryControl={}):Promise<LensCatalog>{
    return this.operation(control,async signal=>{
      const epoch=await this.repository.epoch(signal),catalog=await parseLensDatabaseFile(blob,name,signal);
      await freezeOwnedData(catalog);signal.throwIfAborted();
      await this.repository.install(catalog.source,blob,epoch,signal);
      // Repository completion is the publication boundary. A later cancellation
      // cannot turn an already committed import into a reported failed import.
      return catalog;
    });
  }
  list(control:LensLibraryControl={}):Promise<readonly LensLibraryEntry[]>{
    return this.operation(control,async signal=>{
      const rows=await this.repository.list(signal),entries:LensLibraryEntry[]=[];
      for(const row of rows){
        signal.throwIfAborted();let source:LensDatabaseSource|null=null,catalog:LensCatalog|null=null,error='';
        const value=row.value&&typeof row.value==='object'?row.value as Record<string,unknown>:{};
        const descriptor=lensDatabaseSourceSchema.safeParse(value.source);if(descriptor.success)source=descriptor.data;
        try{
          const original=storedLensDatabase(row.value,row.key);catalog=await parseLensDatabaseFile(original.blob,original.source.name,signal);
          if(catalog.source.sha256!==original.source.sha256)throw new Error('Stored lens database checksum mismatch. Export its original for recovery or remove this copy.');
          await freezeOwnedData(catalog);
        }catch(cause){signal.throwIfAborted();catalog=null;error=errorMessage(cause);}
        if(source)await freezeOwnedData(source);signal.throwIfAborted();
        entries.push(Object.freeze({key:structuredClone(row.key),source,catalog,error,recoverable:value.blob instanceof Blob}));
      }
      signal.throwIfAborted();return Object.freeze(entries);
    });
  }
  profile(key:IDBValidKey,index:number,control:LensLibraryControl={}):Promise<LensProfileData>{
    return this.operation(control,async signal=>{
      if(!Number.isSafeInteger(index)||index<0)throw new Error('Invalid lens profile index.');
      const epoch=await this.repository.epoch(signal),row=storedLensDatabase(await this.repository.read(key,signal),key),catalog=await parseLensDatabaseFile(row.blob,row.source.name,signal);
      if(catalog.source.sha256!==row.source.sha256)throw new Error('Stored lens database checksum mismatch.');
      const entry=catalog.lenses.find(lens=>lens.index===index);if(!entry?.definition)throw new Error(entry?.issues.join(' ')||'The selected lens profile is unavailable.');
      await freezeOwnedData(entry.definition);signal.throwIfAborted();
      if(await this.repository.epoch(signal)!==epoch)throw new Error('Lens library changed during profile review. Refresh and retry.');
      signal.throwIfAborted();return entry.definition;
    });
  }
  original(key:IDBValidKey,control:LensLibraryControl={}):Promise<{blob:Blob;name:string;verified:boolean;error:string}>{
    return this.operation(control,async signal=>{
      const raw=await this.repository.read(key,signal),value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
      if(!(value.blob instanceof Blob))throw new Error('The stored original lens database is missing.');
      const blob=value.blob,parsed=lensDatabaseSourceSchema.safeParse(value.source),name=parsed.success?parsed.data.name:'Recovered lens database.xml';let verified=false,error='';
      try{
        const row=storedLensDatabase(raw,key),bytes=await blob.arrayBuffer();signal.throwIfAborted();
        const digest=await crypto.subtle.digest('SHA-256',bytes);signal.throwIfAborted();
        const hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(hash!==row.source.sha256)throw new Error('Stored lens database checksum mismatch. This download contains the available recovery bytes.');verified=true;
      }catch(cause){signal.throwIfAborted();error=errorMessage(cause);}
      signal.throwIfAborted();return {blob,name,verified,error};
    });
  }
  remove(key:IDBValidKey,control:LensLibraryControl={}):Promise<void>{return this.operation(control,signal=>this.repository.remove(key,signal));}
  clear(control:LensLibraryControl={}):Promise<void>{return this.operation(control,signal=>this.repository.clear(signal));}
  dispose(){if(this.disposed)return;this.disposed=true;for(const controller of this.controllers)controller.abort(new Error('Lens library is closed.'));this.controllers.clear();this.repository.dispose();}
}
