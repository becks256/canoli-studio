import { MetadataService } from "../intelligence/metadata/service";
import { AnalysisService } from "../intelligence/candidates/service";
import { id } from "./model";
import {decodeTiffFile} from './interchange/tiff/client';
import {tiffDecodeOptionsSchema,type TiffDecodeOptions,type TiffDecodeSettings,type TiffImportControl} from './interchange/tiff/types';

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
}
export interface AssetImportOptions extends TiffImportControl {tiff?:TiffDecodeOptions}

export class AssetStore {
  readonly metadata = new MetadataService();
  readonly analysis = new AnalysisService();
  private assets = new Map<string, ImageAsset>();
  private generation = 0;
  private pending = new Set<string>();
  /** Guards asynchronous ownership transfers against disposal of their target store. */
  captureLifetime(): () => void {
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
    if (this.assets.has(asset.id)) throw new Error("Duplicate asset ID.");
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

  async add(
    blob: Blob,
    name: string,
    assetId: string = id(),
    analyzeMetadata = true,
    options: AssetImportOptions = {},
  ): Promise<ImageAsset> {
    options.signal?.throwIfAborted();
    if (!["image/png", "image/jpeg", "image/webp", "image/tiff"].includes(blob.type))
      throw new Error("Use a PNG, JPEG, WebP or supported TIFF image.");
    if(options.tiff!==undefined&&blob.type!=='image/tiff')throw new Error('TIFF decoding settings require a TIFF source.');
    const tiff=blob.type==='image/tiff'?Object.freeze(tiffDecodeOptionsSchema.parse(options.tiff??{})):undefined;
    if (this.assets.has(assetId) || this.pending.has(assetId))
      throw new Error("Duplicate asset ID.");
    const generation = this.generation;
    this.pending.add(assetId);
    let bitmap: ImageBitmap;
    try {
      let decoded=blob;
      if(tiff){if(typeof createImageBitmap==='undefined')throw new Error('TIFF source pixels require the browser image host.');decoded=(await decodeTiffFile(blob,tiff,{signal:options.signal,onProgress:p=>{if(generation!==this.generation)throw new Error('The asset store changed during import.');options.onProgress?.(p);}})).png;}
      options.signal?.throwIfAborted();
      if (typeof createImageBitmap !== "undefined") {
        bitmap = await createImageBitmap(decoded);
      } else {
        bitmap = {
          width: 512,
          height: 512,
          close: () => {},
        } as unknown as ImageBitmap;
      }
    } catch (error) {
      this.pending.delete(assetId);
      if(tiff||options.signal?.aborted)throw error;
      throw new Error(
        "The browser could not decode this image. Check the file format and available device memory.",
      );
    }
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
        ...(tiff?{tiff}:{}),
      };
      this.assets.set(assetId, asset);
      if (analyzeMetadata)
        this.metadata.analyze(assetId, {
          blob,
          name: asset.name,
          width: asset.width,
          height: asset.height,
        });
      return asset;
    } catch (error) {
      bitmap.close();
      throw error;
    } finally {
      this.pending.delete(assetId);
    }
  }

  remove(assetId: string) {
    this.metadata.remove(assetId);
    const asset = this.assets.get(assetId);
    if (asset) {
      asset.bitmap.close();
      this.assets.delete(assetId);
    }
  }

  dispose() {
    this.generation++;
    this.metadata.dispose();
    this.assets.forEach((asset) => asset.bitmap.close());
    this.assets.clear();
  }
}
