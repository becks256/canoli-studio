import{FloatRasterSource}from'./float-source/source';
import type{ColorOutput}from'./color/color-settings';
import { MetadataService } from "../intelligence/metadata/service";
import {FontSourceStore} from '../fonts/store';
import { AnalysisService } from "../intelligence/candidates/service";
import { id } from "./model";
import {decodeTiffFile} from './interchange/tiff/client';
import {decodeAvifFile} from './interchange/avif/client';
import {hasAvifBrand} from './interchange/avif/sniff';
import {ownRawSource,verifyRawSource,type RawImageSource} from './interchange/raw/source';
import {avifDecodeOptionsSchema,type AvifDecodeOptions,type AvifDecodeSettings,type AvifImportReport} from './interchange/avif/types';
import {tiffDecodeOptionsSchema,type TiffDecodeOptions,type TiffDecodeSettings,type TiffImportControl,type TiffFloatColor} from './interchange/tiff/types';

export interface SerializedAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  dataUrl: string;
}
export interface ImageAsset extends Omit<SerializedAsset, "dataUrl"> {
  readonly blob: Blob;
  bitmap: ImageBitmap;
  thumbnail: string;
  readonly tiff?: Readonly<TiffDecodeSettings>;
  /** Derived, checked color conversion of a float source; originals remain authoritative. */
  readonly tiffColor?:Readonly<TiffFloatColor>;
  readonly avif?: Readonly<AvifDecodeSettings>;
  /** Derived from original bytes on decode; not a second persisted source of truth. */
  readonly avifReport?: Readonly<AvifImportReport>;
  /** Accepted PNG plus an immutable, complete sensor original and development record. */
  readonly raw?: Readonly<RawImageSource>;
}
export interface AssetImportOptions extends TiffImportControl {tiff?:TiffDecodeOptions;avif?:AvifDecodeOptions;raw?:RawImageSource}

interface SharedBitmap {
  readonly bitmap: ImageBitmap;
  owners: number;
}
const sharedRecords = new WeakSet<ImageAsset>();
const encodedRecords = new WeakSet<ImageAsset>();

/** Pins immutable bytes and geometry, plus a real surface when this host has one. */
export function captureAssetSource(assets:AssetStore,assetId:string){
  const alive=assets.captureLifetime(),asset=assets.get(assetId),blob=asset.blob,raw=asset.raw,width=asset.width,height=asset.height;
  const bitmap=encodedRecords.has(asset)?null:asset.bitmap;
  const check=()=>{
    alive();if(!assets.has(assetId)||assets.get(assetId)!==asset||asset.blob!==blob||asset.raw!==raw||asset.width!==width||asset.height!==height||
      bitmap&&(asset.bitmap!==bitmap||bitmap.width!==width||bitmap.height!==height))throw new Error('Source image asset changed.');
  };
  check();return{asset,check};
}

export class AssetStore {
  readonly fonts:FontSourceStore;
  constructor(options:{fontSources?:ConstructorParameters<typeof FontSourceStore>[0]}={}){this.fonts=new FontSourceStore(options.fontSources);}
  readonly metadata = new MetadataService();
  readonly analysis = new AnalysisService();
  private assets = new Map<string, ImageAsset>();
  private generation = 0;
  private pending = new Set<string>();
  private disposed = false;
  private shared = new Map<string, SharedBitmap>();
  private assertOpen() {
    if (this.disposed) throw new Error('The asset store is disposed.');
  }
  /** Guards asynchronous ownership transfers against disposal of their target store. */
  captureLifetime(): () => void {
    this.assertOpen();
    const generation = this.generation;
    return () => {
      if (generation !== this.generation)
        throw new Error(
          "The target asset store was disposed during the operation.",
        );
    };
  }
  get(assetId: string): ImageAsset {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Missing image asset: ${assetId}`);
    return asset;
  }
  has(assetId: string): boolean {
    return this.assets.has(assetId);
  }
  values() {
    return [...this.assets.values()];
  }

  install(asset: ImageAsset, analyzeMetadata = true): ImageAsset {
    this.assertOpen();
    if (this.assets.has(asset.id) || this.pending.has(asset.id)) throw new Error("Duplicate asset ID.");
    if (sharedRecords.has(asset)) throw new Error('Use shareTo for a borrowed shared asset.');
    this.assets.set(asset.id, asset);
    if (analyzeMetadata) {
      this.metadata.analyze(asset.id, {
        blob: asset.blob,
        name: asset.name,
        width: asset.width,
        height: asset.height,
      });
    }
    return asset;
  }

  /** Headless adapter only, after validating the complete encoded image.
   * Pixel access must use that host's decoder. No ImageBitmap is fabricated. */
  installEncoded(input:Omit<ImageAsset,'bitmap'|'thumbnail'>):ImageAsset{
    if(input.blob.type!=='image/png'||!Number.isSafeInteger(input.width)||!Number.isSafeInteger(input.height)||input.width<=0||input.height<=0||!Number.isSafeInteger(input.width*input.height*4))throw new Error('Invalid encoded PNG asset geometry.');
    const asset:ImageAsset=Object.freeze({...input,...(input.raw?{raw:ownRawSource(input.raw)}:{}),thumbnail:'',get bitmap():ImageBitmap{throw new Error('This encoded image has no browser bitmap. Use the headless pixel decoder.');}});
    encodedRecords.add(asset);return this.install(asset,false);
  }

  /** Explicit shared ownership; returned records/bitmap are borrowed and immutable.
   * Ordinary install continues to adopt a caller-owned bitmap without sharing it. */
  shareTo(destination: AssetStore, assetId: string, sharedId = id()): Readonly<ImageAsset> {
    this.assertOpen();
    destination.assertOpen();
    if (typeof sharedId !== 'string' || !sharedId || sharedId.length > 240) throw new Error('A shared asset requires an ID of 1–240 characters.');
    if (this.pending.has(assetId)) throw new Error('The source image import has not finished.');
    const source = this.get(assetId), bitmap = source.bitmap;
    if (source.id !== assetId || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) ||
        source.width <= 0 || source.height <= 0 || source.width !== bitmap.width || source.height !== bitmap.height)
      throw new Error('The source bitmap or its original dimensions changed.');
    if (destination === this && sharedId === assetId) return source;
    if (destination.assets.has(sharedId) || destination.pending.has(sharedId)) throw new Error('Duplicate asset ID.');
    let lease = this.shared.get(assetId);
    if (lease && lease.bitmap !== bitmap) throw new Error('The shared source bitmap changed.');
    const copy: ImageAsset = Object.freeze({
      id: sharedId, name: source.name, width: source.width, height: source.height,
      blob: source.blob, bitmap, thumbnail: source.thumbnail,
      ...(source.tiff ? {tiff: Object.freeze(tiffDecodeOptionsSchema.parse(source.tiff)),...(source.tiffColor?{tiffColor:source.tiffColor}:{})} : {}),
      ...(source.avif ? {avif: Object.freeze(avifDecodeOptionsSchema.parse(source.avif)),avifReport:source.avifReport} : {}),
      ...(source.raw ? {raw:ownRawSource(source.raw)} : {}),
    });
    lease ??= {bitmap, owners: 1};
    this.shared.set(assetId, lease);
    destination.assets.set(sharedId, copy);
    destination.shared.set(sharedId, lease);
    sharedRecords.add(source);
    sharedRecords.add(copy);
    lease.owners++;
    return copy;
  }

  /** Trusted readonly precision lease, independent of this store's bitmap lifetime. */
  captureFloatSource(assetId:string,output:ColorOutput={profile:'linear-srgb'}):FloatRasterSource{
    this.assertOpen();const asset=this.get(assetId);if(!asset.tiff||!asset.tiffColor)throw new Error('Choose a retained float32 TIFF source; byte proxies are not precision sources.');return FloatRasterSource.capture(asset.blob,asset.width,asset.height,asset.tiff,asset.tiffColor.source,output);
  }

  async add(
    blob: Blob,
    name: string,
    assetId: string = id(),
    analyzeMetadata = true,
    options: AssetImportOptions = {},
  ): Promise<ImageAsset> {
    this.assertOpen();
    options.signal?.throwIfAborted();
    if (!["image/png", "image/jpeg", "image/webp", "image/tiff", "image/avif"].includes(blob.type))
      throw new Error("Use a PNG, JPEG, WebP, supported TIFF or AVIF image.");
    if(options.tiff!==undefined&&blob.type!=='image/tiff')throw new Error('TIFF decoding settings require a TIFF source.');
    if(options.avif!==undefined&&blob.type!=='image/avif')throw new Error('AVIF decoding settings require an AVIF source.');
    const current=this.captureLifetime(),check=()=>{current();options.signal?.throwIfAborted();};
    const raw=options.raw?await verifyRawSource(options.raw,blob,undefined,undefined,check):undefined;
    const tiff=blob.type==='image/tiff'?Object.freeze(tiffDecodeOptionsSchema.parse(options.tiff??{})):undefined;
    const avif=blob.type==='image/avif'?Object.freeze(avifDecodeOptionsSchema.parse(options.avif??{})):undefined;
    if(!avif){
      const current=this.captureLifetime(),check=()=>{current();options.signal?.throwIfAborted();};
      if(await hasAvifBrand(blob,check))throw new Error('AVIF source bytes require image/avif and explicit AVIF decoding choices.');
      check();
    }
    if (this.assets.has(assetId) || this.pending.has(assetId))
      throw new Error("Duplicate asset ID.");
    const generation = this.generation;
    this.pending.add(assetId);
    let bitmap: ImageBitmap;
    let avifReport:Readonly<AvifImportReport>|undefined;
    let tiffColor:Readonly<TiffFloatColor>|undefined;
    try {
      let decoded=blob;
      if(tiff){if(typeof createImageBitmap==='undefined')throw new Error('TIFF source pixels require the browser image host.');const result=await decodeTiffFile(blob,tiff,{signal:options.signal,onProgress:p=>{if(generation!==this.generation)throw new Error('The asset store changed during import.');options.onProgress?.(p);}});decoded=result.png;if(result.color){Object.freeze(result.color.source);Object.freeze(result.color.warnings);tiffColor=Object.freeze(result.color);}}
      if(avif){
        if(typeof createImageBitmap==='undefined')throw new Error('AVIF source pixels require the browser image host.');
        const result=await decodeAvifFile(blob,avif,{signal:options.signal,onProgress:p=>{if(generation!==this.generation)throw new Error('The asset store changed during import.');options.onProgress?.(p);}});
        decoded=result.png;Object.freeze(result.report.crop);Object.freeze(result.report.color);Object.freeze(result.report.warnings);Object.freeze(result.report.unsupported);avifReport=Object.freeze(result.report);
      }
      options.signal?.throwIfAborted();
      if (typeof createImageBitmap !== "undefined") {
        bitmap = await createImageBitmap(decoded);
        if(raw&&(bitmap.width!==raw.report.displayWidth||bitmap.height!==raw.report.displayHeight)){bitmap.close();throw new Error('Decoded RAW working bitmap differs from its accepted dimensions.');}
        if(avifReport&&(bitmap.width!==avifReport.displayWidth||bitmap.height!==avifReport.displayHeight)){bitmap.close();throw new Error('Decoded AVIF bitmap dimensions differ from the inspected presentation.');}
      } else {
        bitmap = {
          width: 512,
          height: 512,
          close: () => {},
        } as unknown as ImageBitmap;
      }
    } catch (error) {
      this.pending.delete(assetId);
      if(tiff||avif||options.signal?.aborted)throw error;
      throw new Error(
        "The browser could not decode this image. Check the file format and available device memory.",
      );
    }
    let published: ImageAsset | undefined;
    try {
      options.signal?.throwIfAborted();
      if (generation !== this.generation)
        throw new Error("The asset store changed during import.");
      let thumbnailDataUrl = "data:image/png;base64,";
      if (
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
      ) {
        const thumbnail = document.createElement("canvas");
        const factor = Math.min(1, 96 / bitmap.width, 96 / bitmap.height);
        thumbnail.width = Math.max(1, Math.round(bitmap.width * factor));
        thumbnail.height = Math.max(1, Math.round(bitmap.height * factor));
        thumbnail
          .getContext("2d")!
          .drawImage(bitmap, 0, 0, thumbnail.width, thumbnail.height);
        thumbnailDataUrl = thumbnail.toDataURL();
        thumbnail.width = thumbnail.height = 0;
      }
      const asset: ImageAsset = {
        id: assetId,
        name,
        width: bitmap.width,
        height: bitmap.height,
        blob,
        bitmap,
        thumbnail: thumbnailDataUrl,
        ...(tiff?{tiff,...(tiffColor?{tiffColor}:{})}:{}),
        ...(avif?{avif,avifReport}:{}),
        ...(raw?{raw}:{}),
      };
      this.assets.set(assetId, asset);
      published = asset;
      if (analyzeMetadata)
        this.metadata.analyze(assetId, {
          blob,
          name: asset.name,
          width: asset.width,
          height: asset.height,
        });
      if (generation !== this.generation || this.assets.get(assetId) !== asset)
        throw new Error('The asset store changed during import.');
      return asset;
    } catch (error) {
      if (!published) bitmap.close();
      else if (this.assets.get(assetId) === published) {
        this.assets.delete(assetId);
        this.release(assetId, published);
        try { this.metadata.remove(assetId); } catch { /* Preserve the import error after releasing its image. */ }
      }
      throw error;
    } finally {
      this.pending.delete(assetId);
    }
  }

  private release(assetId: string, asset: ImageAsset) {
    if(encodedRecords.has(asset))return;
    const lease = this.shared.get(assetId);
    this.shared.delete(assetId);
    if (!lease) asset.bitmap.close();
    else if (--lease.owners === 0) lease.bitmap.close();
  }

  remove(assetId: string) {
    try { this.metadata.remove(assetId); }
    finally {
      const asset = this.assets.get(assetId);
      if (asset) {
        this.assets.delete(assetId);
        this.release(assetId, asset);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    let failure: unknown;
    try { this.metadata.dispose(); } catch (error) { failure = error; }
    for (const [assetId, asset] of this.assets) {
      this.assets.delete(assetId);
      try { this.release(assetId, asset); } catch (error) { failure ??= error; }
    }
    this.assets.clear();
    try{this.fonts.dispose();}catch(error){failure??=error;}
    if (failure) throw failure;
  }
}
