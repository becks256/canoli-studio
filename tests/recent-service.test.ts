import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {RecentFilesService} from '../src/workspace/recent-service';
import {recentEntrySchema,type RecentEntry,type RecentSummary,type RecentFileStore} from '../src/workspace/recent-files';

const hash=async(blob:Blob)=>createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');
class MemoryStore implements RecentFileStore {
 values=new Map<string,{entry:RecentEntry;blob:Blob}>();epoch='initial';closed=false;fail=false;writes=0;
 async generation(){return this.epoch;}
 async list():Promise<RecentSummary[]>{return[...this.values.values()].reverse().map(({entry})=>({...entry}));}
 async record(file:Parameters<RecentFileStore['record']>[0],signal?:AbortSignal){signal?.throwIfAborted();if(this.fail)throw new DOMException('quota','QuotaExceededError');if(file.generation!==this.epoch)throw new Error('Recent copies changed while preparing.');const id=file.name,entry=recentEntrySchema.parse({version:1,id,kind:file.kind,name:file.name,mime:file.mime,size:file.size,lastModified:file.lastModified,sha256:file.sha256,openedAt:Date.now(),rank:++this.writes});this.values.set(id,{entry,blob:file.blob});return entry;}
 async get(id:string){const value=this.values.get(id);if(!value)throw new Error('Missing local copy');return{entry:{...value.entry},blob:value.blob};}
 async remove(id:string){this.epoch=crypto.randomUUID();this.values.delete(id);}
 async clear(){this.epoch=crypto.randomUUID();this.values.clear();}
 dispose(){this.closed=true;}
}
const file=(name='art.png',body='abc')=>new File([body],name,{type:'image/png',lastModified:1234});

it('optional capture is durable before publication and returned copies preserve metadata and independent bytes',async()=>{
 const store=new MemoryStore(),service=new RecentFilesService(store,hash,true),source=new File(['abc'],'art.png',{type:'image/png',lastModified:-1234});service.remember(source,'image');await service.flush();expect(service.getSnapshot().pending).toBe(0);expect(service.getSnapshot().entries.map(item=>item.name)).toEqual(['art.png']);
 const opened=await service.read('art.png');expect(opened.kind).toBe('image');expect(opened.file.name).toBe('art.png');expect(opened.file.type).toBe('image/png');expect(opened.file.lastModified).toBe(-1234);expect(await opened.file.text()).toBe('abc');await service.clear();expect(await opened.file.text()).toBe('abc');expect(service.getSnapshot().entries).toEqual([]);service.dispose();expect(store.closed).toBe(true);
});
it('storage errors never throw from successful-I/O notification, retain prior entries and can retry',async()=>{
 const store=new MemoryStore(),service=new RecentFilesService(store,hash,true);service.remember(file('good.png'),'image');await service.flush();store.fail=true;expect(()=>service.remember(file('new.png'),'image')).not.toThrow();await service.flush();expect(service.getSnapshot().error).toMatch(/recent-file copy.*storage is full/);expect(service.getSnapshot().error).not.toMatch(/Latest changes are not saved/);expect(service.getSnapshot().entries.map(item=>item.name)).toEqual(['good.png']);store.fail=false;service.remember(file('new.png'),'image');await service.flush();expect(service.getSnapshot().error).toBe('');expect(service.getSnapshot().entries).toHaveLength(2);service.dispose();
});
it('clear aborts active and queued preparations without a late write',async()=>{
 const store=new MemoryStore();let start!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;});let hashes=0,cancelled=0;
 const service=new RecentFilesService(store,async(_blob,signal)=>{hashes++;start();return await new Promise<string>((_resolve,reject)=>{signal!.addEventListener('abort',()=>{cancelled++;reject(signal!.reason);},{once:true});});},true);
 service.remember(file('first.png'),'image');service.remember(file('second.png'),'image');await started;await service.clear();await service.flush();expect(hashes).toBe(1);expect(cancelled).toBe(1);expect(store.writes).toBe(0);expect(service.getSnapshot().pending).toBe(0);expect(service.getSnapshot().entries).toEqual([]);expect(service.getSnapshot().error).toBe('');service.dispose();
});
it('newer requests supersede old pending captures under the same twenty-entry retention policy',async()=>{
 const store=new MemoryStore();let active=0,maximum=0,hashes=0;const service=new RecentFilesService(store,async(blob,signal)=>{signal?.throwIfAborted();active++;maximum=Math.max(maximum,active);hashes++;try{return await hash(blob);}finally{active--;}},true);
 for(let i=0;i<25;i++)service.remember(file(String(i)+'.png'),'image');expect(service.getSnapshot().pending).toBe(20);await service.flush();expect(maximum).toBe(1);expect(hashes).toBe(20);expect([...store.values.keys()]).toEqual(Array.from({length:20},(_,i)=>String(i+5)+'.png'));expect(service.getSnapshot().pending).toBe(0);service.dispose();
});
it('rejects corrupt payloads and metadata changes before delivering a file',async()=>{
 const store=new MemoryStore();let change=false;const service=new RecentFilesService(store,async blob=>{const value=await hash(blob);if(change)store.values.get('art.png')!.entry.name='Changed.png';return value;},true);service.remember(file(),'image');await service.flush();const original=store.values.get('art.png')!.blob;store.values.get('art.png')!.blob=new Blob(['xyz']);await expect(service.read('art.png')).rejects.toThrow(/integrity/);store.values.get('art.png')!.blob=original;change=true;await expect(service.read('art.png')).rejects.toThrow(/changed during opening/);service.dispose();
});
it('a changed durable generation rejects even if a worker ignores notification cancellation',async()=>{
 const store=new MemoryStore();let resume!:(value:string)=>void,start!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;});const service=new RecentFilesService(store,async()=>{start();return await new Promise<string>(resolve=>{resume=resolve;});},true);service.remember(file(),'image');await started;await store.clear();resume(await hash(file()));await service.flush();expect(store.values.size).toBe(0);expect(store.writes).toBe(0);expect(service.getSnapshot().error).toMatch(/Recent copies changed/);service.dispose();
});
it('abort/disposal cancel reads, release queued captures and prohibit late publication',async()=>{
 const store=new MemoryStore();let block=false,start!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;});const service=new RecentFilesService(store,async(blob,signal)=>{if(!block)return hash(blob);start();return new Promise<string>((_resolve,reject)=>{signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true});});},true);service.remember(file(),'image');await service.flush();block=true;const abort=new AbortController(),reading=service.read('art.png',abort.signal);await started;abort.abort(new Error('Cancel read'));await expect(reading).rejects.toThrow(/Cancel read/);let publications=0;service.subscribe(()=>{publications++;});service.remember(file('queued.png'),'image');service.dispose();const before=publications;await service.flush();expect(publications).toBe(before);expect(service.getSnapshot().pending).toBe(0);expect(store.writes).toBe(1);await expect(service.read('art.png')).rejects.toThrow(/closed/);
});

it('a denied browser-storage capability leaves optional recents unavailable without aborting startup',()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousStorage=Object.getOwnPropertyDescriptor(globalThis,'indexedDB'),store=new MemoryStore();let service:RecentFilesService|undefined,accesses=0;
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'indexedDB',{configurable:true,get(){accesses++;throw new DOMException('Storage blocked','SecurityError');}});
  expect(()=>{service=new RecentFilesService(store,hash);}).not.toThrow();expect(accesses).toBe(1);expect(service!.getSnapshot()).toMatchObject({available:false,loading:false,pending:0,entries:[]});expect(service!.getSnapshot().error).toContain('unavailable');expect(()=>service!.remember(file(),'image')).not.toThrow();expect(store.writes).toBe(0);
 }finally{service?.dispose();if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');if(previousStorage)Object.defineProperty(globalThis,'indexedDB',previousStorage);else Reflect.deleteProperty(globalThis,'indexedDB');}
});
