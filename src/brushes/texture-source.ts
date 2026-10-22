import {AssetStore,type ImageAsset,type AssetImportOptions} from '../core/assets';
import {textureMaskOptionsSchema,type TextureMaskSettings} from '../core/brush-texture';

/** Tool preferences have no document-local asset ID. */
export const brushTexturePreferenceSchema=textureMaskOptionsSchema.nullable();
export type BrushTexturePreference=TextureMaskSettings|null;

interface CapturedSource {store:AssetStore;asset:Readonly<ImageAsset>}
interface TargetSource {source:Readonly<ImageAsset>;asset:Readonly<ImageAsset>}

/** Internal owner for a texture preference, independent of document history.
 * Original source bytes/bitmap are retained; ensureIn() only creates explicit leases.
 * The original remains independent of per-document gesture references.
 */
export class BrushTextureSourceOwner {
  private current:CapturedSource|null=null;
  private targets=new WeakMap<AssetStore,TargetSource>();
  private generation=0;
  private disposed=false;
  private pending:AbortController|null=null;

  /** Borrowed immutable source record; never close or adopt its bitmap. */
  get source():Readonly<ImageAsset>|null{return this.current?.asset??null;}
  /** Explicit owner-to-owner capture, without inserting an unused document asset. */
  captureFrom(source:BrushTextureSourceOwner):Readonly<ImageAsset>{
    this.assertOpen();source.assertOpen();
    if(!source.current)throw new Error('Choose a brush texture source first.');
    return this.capture(source.current.store,source.current.asset.id);
  }
  private assertOpen(){if(this.disposed)throw new Error('The brush texture source owner is disposed.');}
  private cancelPending(){this.pending?.abort(new DOMException('Texture source request was replaced.','AbortError'));this.pending=null;}
  private replace(source:CapturedSource){
    const previous=this.current;
    this.current=source;
    this.targets=new WeakMap();
    previous?.store.dispose();
    return source.asset;
  }

  /** Capture a ready source synchronously. Invalid inputs leave pending/current work intact. */
  capture(store:AssetStore,assetId:string):Readonly<ImageAsset>{
    this.assertOpen();
    const staging=new AssetStore();
    let asset:Readonly<ImageAsset>;
    try{asset=store.shareTo(staging,assetId);}
    catch(error){staging.dispose();throw error;}
    this.generation++;
    this.cancelPending();
    const current=this.current?.asset;
    if(current&&current.raw===asset.raw&&current.bitmap===asset.bitmap&&current.blob===asset.blob&&current.name===asset.name&&
       current.width===asset.width&&current.height===asset.height&&current.tiff?.page===asset.tiff?.page&&
       current.tiff?.allowPrecisionLoss===asset.tiff?.allowPrecisionLoss&&current.avif?.allowPrecisionLoss===asset.avif?.allowPrecisionLoss&&current.avif?.assumeSrgb===asset.avif?.assumeSrgb){
      staging.dispose();
      return current;
    }
    return this.replace({store:staging,asset});
  }

  /** Decode privately and swap only after success; a failed replacement retains current pixels. */
  async import(blob:Blob,name:string,options:AssetImportOptions={}):Promise<Readonly<ImageAsset>>{
    const signal=options.signal,onProgress=options.onProgress;
    this.assertOpen();signal?.throwIfAborted();
    const generation=++this.generation;
    this.cancelPending();
    const abort=new AbortController();this.pending=abort;
    const cancel=()=>abort.abort(signal?.reason);
    signal?.addEventListener('abort',cancel,{once:true});
    const staging=new AssetStore();
    const check=()=>{abort.signal.throwIfAborted();this.assertOpen();if(this.generation!==generation)throw new Error('The brush texture source changed during import.');};
    try{
      const asset=await staging.add(blob,name,undefined,false,{...options,signal:abort.signal,onProgress:progress=>{check();onProgress?.(progress);check();}});
      check();
      // Install through an explicit lease so the published record is immutable too.
      const retained=new AssetStore();
      try{const owned=staging.shareTo(retained,asset.id);this.replace({store:retained,asset:owned});return owned;}
      catch(error){if(this.current?.store!==retained)retained.dispose();throw error;}
    }finally{
      signal?.removeEventListener('abort',cancel);
      if(this.pending===abort)this.pending=null;
      staging.dispose();
    }
  }

  /** Synchronous, collision-safe document reference. Repeated gestures reuse a live lease. */
  ensureIn(destination:AssetStore):Readonly<ImageAsset>{
    return this.leaseIn(destination).asset;
  }
  /** Reports newly created references so cancelled gestures can release unused assets. */
  leaseIn(destination:AssetStore):{asset:Readonly<ImageAsset>;created:boolean}{
    this.assertOpen();destination.captureLifetime();
    const current=this.current;if(!current)throw new Error('Choose a brush texture source first.');
    const cached=this.targets.get(destination);
    if(cached?.source===current.asset&&destination.has(cached.asset.id)&&destination.get(cached.asset.id)===cached.asset&&cached.asset.bitmap.width===cached.asset.width&&cached.asset.bitmap.height===cached.asset.height)return {asset:cached.asset,created:false};
    const asset=current.store.shareTo(destination,current.asset.id);
    this.targets.set(destination,{source:current.asset,asset});
    return {asset,created:true};
  }

  private reset(){
    this.generation++;this.cancelPending();
    const previous=this.current;this.current=null;this.targets=new WeakMap();previous?.store.dispose();
  }
  clear(){this.assertOpen();this.reset();}
  dispose(){if(this.disposed)return;this.disposed=true;this.reset();}
}
