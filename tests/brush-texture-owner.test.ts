import {afterEach,expect,it,vi} from 'vitest';
import {AssetStore,type ImageAsset} from '../src/core/assets';
import {BrushTextureSourceOwner} from '../src/brushes/texture-source';

const sources:AssetStore[]=[];
const store=()=>{const value=new AssetStore();sources.push(value);return value;};
function source(target:AssetStore,key='grain',width=10000,height=5000){
 const close=vi.fn(),bitmap={width,height,close} as unknown as ImageBitmap;
 const asset:ImageAsset={id:key,name:'Original grain',width,height,bitmap,thumbnail:'data:image/png;base64,',blob:new Blob(['exact original bytes'],{type:'image/tiff'}),tiff:{page:2,allowPrecisionLoss:true}};
 target.install(asset,false);return{asset,close};
}
afterEach(()=>{for(const value of sources.splice(0))value.dispose();vi.unstubAllGlobals();});

it('draft owners commit without a document reference and survive cancellation or source closure',()=>{
 const a=store(),b=store(),{close}=source(a),active=new BrushTextureSourceOwner(),draft=new BrushTextureSourceOwner();active.capture(a,'grain');draft.captureFrom(active);
 const original=active.source;a.dispose();expect(b.values()).toHaveLength(0);expect(close).not.toHaveBeenCalled();
 expect(()=>active.captureFrom(new BrushTextureSourceOwner())).toThrow(/Choose/);expect(active.source).toBe(original);
 active.captureFrom(draft);expect(active.source).toBe(original);draft.dispose();expect(close).not.toHaveBeenCalled();
 const first=active.leaseIn(b);expect(first.created).toBe(true);expect(active.leaseIn(b)).toEqual({asset:first.asset,created:false});
 b.remove(first.asset.id);expect(active.leaseIn(b).created).toBe(true);active.dispose();expect(close).not.toHaveBeenCalled();b.dispose();expect(close).toHaveBeenCalledTimes(1);
});

for(const first of ['source','target'] as const)it(`releases an explicit shared bitmap exactly once when ${first} closes first`,()=>{
 const a=store(),b=store(),{asset,close}=source(a),shared=a.shareTo(b,'grain','document-grain');
 expect(shared).not.toBe(asset);expect(shared.blob).toBe(asset.blob);expect(shared.bitmap).toBe(asset.bitmap);expect(shared.tiff).toEqual({page:2,allowPrecisionLoss:true});expect(shared.tiff).not.toBe(asset.tiff);expect(Object.isFrozen(shared)).toBe(true);expect(Object.isFrozen(shared.tiff)).toBe(true);
 (first==='source'?a:b).dispose();expect(close).not.toHaveBeenCalled();expect((first==='source'?b:a).values()[0].bitmap.width).toBe(10000);(first==='source'?b:a).dispose();expect(close).toHaveBeenCalledTimes(1);a.dispose();b.dispose();expect(close).toHaveBeenCalledTimes(1);
});

it('supports chains and aliases without confusing IDs or allowing borrowed records to be adopted',()=>{
 const a=store(),b=store(),c=store(),{asset,close}=source(a),first=a.shareTo(b,'grain'),second=b.shareTo(c,first.id);
 expect(first.id).not.toBe('grain');expect(second.id).not.toBe(first.id);expect(a.shareTo(a,'grain','grain')).toBe(asset);a.shareTo(a,'grain','alias');
 expect(()=>store().install(first as ImageAsset,false)).toThrow(/shareTo/);expect(()=>store().install(asset,false)).toThrow(/shareTo/);
 a.remove('grain');a.remove('alias');b.dispose();expect(close).not.toHaveBeenCalled();c.remove(second.id);expect(close).toHaveBeenCalledTimes(1);
});

it('rejects collisions, disposed destinations, changed geometry and missing sources without losing ownership',()=>{
 const a=store(),b=store(),{close}=source(a),existing=source(b,'occupied');
 expect(()=>a.shareTo(b,'grain','occupied')).toThrow(/Duplicate/);expect(b.get('occupied')).toBe(existing.asset);expect(()=>a.shareTo(b,'missing')).toThrow(/Missing image/);expect(()=>a.shareTo(b,'grain','')).toThrow();
 const altered=source(a,'altered');altered.asset.width=42;expect(()=>a.shareTo(b,'altered')).toThrow(/dimensions changed/);expect(altered.close).not.toHaveBeenCalled();
 b.dispose();expect(()=>a.shareTo(b,'grain')).toThrow(/disposed/);expect(close).not.toHaveBeenCalled();a.dispose();expect(close).toHaveBeenCalledTimes(1);
});

it('ordinary unshared installation still adopts exactly one caller-owned bitmap',()=>{
 const a=store(),{close}=source(a);a.remove('grain');expect(close).toHaveBeenCalledTimes(1);a.dispose();expect(close).toHaveBeenCalledTimes(1);expect(()=>a.install({} as ImageAsset,false)).toThrow(/disposed/);expect(()=>a.captureLifetime()).toThrow(/disposed/);
});

it('asset disposal releases all shared references even when metadata cleanup throws',()=>{
 const a=store(),b=store(),first=source(a,'first'),second=source(a,'second');a.shareTo(b,'first','first');a.shareTo(b,'second','second');vi.spyOn(a.metadata,'dispose').mockImplementation(()=>{throw new Error('Cleanup failed');});
 expect(()=>a.dispose()).toThrow('Cleanup failed');expect(a.values()).toHaveLength(0);expect(first.close).not.toHaveBeenCalled();expect(second.close).not.toHaveBeenCalled();b.dispose();expect(first.close).toHaveBeenCalledTimes(1);expect(second.close).toHaveBeenCalledTimes(1);a.dispose();
});

it('source owner reuses one document lease, preserves copied TIFF choices and releases only its own resources',()=>{
 const a=store(),b=store(),c=store(),{asset,close}=source(a),owner=new BrushTextureSourceOwner(),captured=owner.capture(a,'grain');expect(captured.blob).toBe(asset.blob);expect(captured.tiff).toEqual(asset.tiff);expect(captured.width).toBe(10000);
 const first=owner.ensureIn(b);expect(owner.ensureIn(b)).toBe(first);expect(b.values()).toHaveLength(1);a.dispose();expect(close).not.toHaveBeenCalled();const other=owner.ensureIn(c);owner.dispose();expect(close).not.toHaveBeenCalled();expect(b.get(first.id).bitmap).toBe(c.get(other.id).bitmap);b.dispose();expect(close).not.toHaveBeenCalled();c.dispose();expect(close).toHaveBeenCalledTimes(1);expect(()=>owner.ensureIn(store())).toThrow(/disposed/);
});

it('invalid source replacement preserves current state; document ID reuse cannot overwrite a different source',()=>{
 const a=store(),b=store(),{close}=source(a),owner=new BrushTextureSourceOwner();owner.capture(a,'grain');const current=owner.source,first=owner.ensureIn(b);expect(()=>owner.capture(a,'missing')).toThrow();expect(owner.source).toBe(current);expect(owner.ensureIn(b)).toBe(first);
 b.remove(first.id);const collision=source(b,first.id),replacement=owner.ensureIn(b);expect(replacement.id).not.toBe(first.id);expect(b.get(first.id)).toBe(collision.asset);expect(replacement.bitmap).toBe(current!.bitmap);owner.clear();a.dispose();expect(close).not.toHaveBeenCalled();b.remove(replacement.id);expect(close).toHaveBeenCalledTimes(1);expect(collision.close).not.toHaveBeenCalled();owner.dispose();
});

it('decode failure preserves the prior texture; successful import is immutable and independent of borrowed documents',async()=>{
 const a=store(),{close}=source(a),owner=new BrushTextureSourceOwner();owner.capture(a,'grain');const before=owner.source;vi.stubGlobal('createImageBitmap',vi.fn().mockRejectedValue(new Error('Decode failed')));
 await expect(owner.import(new Blob(['bad'],{type:'image/png'}),'Bad')).rejects.toThrow(/could not decode/);expect(owner.source).toBe(before);expect(close).not.toHaveBeenCalled();
 const nextClose=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:32,height:16,close:nextClose}));const imported=await owner.import(new Blob(['new source'],{type:'image/png'}),'New');expect(Object.isFrozen(imported)).toBe(true);expect(await imported.blob.text()).toBe('new source');const b=store(),borrowed=owner.ensureIn(b);owner.dispose();expect(nextClose).not.toHaveBeenCalled();b.remove(borrowed.id);expect(nextClose).toHaveBeenCalledTimes(1);a.dispose();expect(close).toHaveBeenCalledTimes(1);
});

for(const action of ['clear','dispose','capture','import','abort'] as const)it(`pending decode cannot replace a newer source after ${action}`,async()=>{
 const a=store(),original=source(a),owner=new BrushTextureSourceOwner();owner.capture(a,'grain');const ready=owner.source;let finish!:(value:unknown)=>void;const pendingClose=vi.fn(),bitmap={width:20,height:10,close:pendingClose};vi.stubGlobal('createImageBitmap',vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({width:2,height:2,close:vi.fn()}));
 const abort=new AbortController(),pending=owner.import(new Blob(['old'],{type:'image/png'}),'Old',{signal:abort.signal});const rejected=expect(pending).rejects.toThrow();await Promise.resolve();
 if(action==='clear')owner.clear();else if(action==='dispose')owner.dispose();else if(action==='capture')owner.capture(a,'grain');else if(action==='import')await owner.import(new Blob(['new'],{type:'image/png'}),'New');else abort.abort();
 const current=owner.source;finish(bitmap);await rejected;expect(owner.source).toBe(current);expect(pendingClose).toHaveBeenCalledTimes(1);if(action==='abort')expect(current).toBe(ready);expect(original.close).not.toHaveBeenCalled();owner.dispose();
});

it('pending imports reserve IDs against adoption and sharing without disturbing existing owners',async()=>{
 const a=store(),b=store(),{asset,close}=source(a);let finish!:(value:unknown)=>void;const pendingClose=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;})));
 const pending=b.add(new Blob(['pending'],{type:'image/png'}),'Pending','reserved',false);await Promise.resolve();expect(()=>a.shareTo(b,'grain','reserved')).toThrow(/Duplicate/);expect(()=>b.shareTo(a,'reserved')).toThrow(/not finished/);expect(()=>b.install({...asset,id:'reserved'},false)).toThrow(/Duplicate/);expect(close).not.toHaveBeenCalled();
 finish({width:2,height:2,close:pendingClose});expect((await pending).id).toBe('reserved');b.dispose();expect(pendingClose).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();
});

it('foreign replacement of a shared record cannot transfer or close a bitmap owned elsewhere',()=>{
 const a=store(),b=store(),c=store(),original=source(a),foreign=source(c,'foreign');a.shareTo(b,'grain','copy');original.asset.bitmap=foreign.asset.bitmap;
 expect(()=>a.shareTo(store(),'grain')).toThrow(/shared source bitmap changed/);a.dispose();expect(original.close).not.toHaveBeenCalled();expect(foreign.close).not.toHaveBeenCalled();b.dispose();expect(original.close).toHaveBeenCalledTimes(1);c.dispose();expect(foreign.close).toHaveBeenCalledTimes(1);
});

it('invalid captures do not cancel a pending valid replacement and caller option mutation cannot change cancellation',async()=>{
 const a=store(),owner=new BrushTextureSourceOwner();source(a);owner.capture(a,'grain');const before=owner.source;let finish!:(value:unknown)=>void;const close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;})));
 const first=new AbortController(),other=new AbortController(),options={signal:first.signal},removed=vi.spyOn(first.signal,'removeEventListener'),pending=owner.import(new Blob(['pending'],{type:'image/png'}),'Pending',options),rejected=expect(pending).rejects.toThrow();await Promise.resolve();expect(()=>owner.capture(a,'missing')).toThrow(/Missing image/);expect(owner.source).toBe(before);options.signal=other.signal;first.abort();finish({width:8,height:8,close});await rejected;expect(owner.source).toBe(before);expect(close).toHaveBeenCalledTimes(1);expect(removed).toHaveBeenCalledWith('abort',expect.any(Function));owner.dispose();
});

for(const action of ['dispose','remove','throw'] as const)it(`metadata publication ${action} cannot return a closed import or close it twice`,async()=>{
 const a=store(),close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:8,height:8,close}));
 // Removal itself publishes; stop before re-entering that notification.
 let once=true;a.metadata.subscribe(()=>{if(!once)return;once=false;if(action==='dispose')a.dispose();else if(action==='remove')a.remove('image');else throw new Error('Listener failed');});
 await expect(a.add(new Blob(['image'],{type:'image/png'}),'Image','image')).rejects.toThrow();expect(a.has('image')).toBe(false);expect(close).toHaveBeenCalledTimes(1);
});

it('recapturing the same original preserves the preference and document IDs without accumulating redundant leases',()=>{
 const a=store(),b=store(),{close}=source(a),owner=new BrushTextureSourceOwner(),captured=owner.capture(a,'grain'),documentAsset=owner.ensureIn(b);
 for(let index=0;index<100;index++){expect(owner.capture(a,'grain')).toBe(captured);expect(owner.ensureIn(b)).toBe(documentAsset);}
 expect(b.values()).toHaveLength(1);a.dispose();owner.dispose();expect(close).not.toHaveBeenCalled();b.dispose();expect(close).toHaveBeenCalledTimes(1);
});

it('reentrant resource cleanup cannot release the same image twice',()=>{
 const a=store(),{asset}=source(a);let closes=0;asset.bitmap.close=()=>{closes++;a.remove('grain');};a.dispose();expect(closes).toBe(1);expect(a.values()).toHaveLength(0);
});
