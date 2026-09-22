import { id } from "./model";

export interface SerializedAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  dataUrl: string;
}
export interface ImageAsset extends SerializedAsset {
  bitmap: ImageBitmap;
  thumbnail: string;
}

export class AssetStore {
  private assets = new Map<string, ImageAsset>();
  get(assetId: string): ImageAsset {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Missing image asset: ${assetId}`);
    return asset;
  }
  values() {
    return [...this.assets.values()];
  }

  async add(
    blob: Blob,
    name: string,
    assetId: string = id(),
  ): Promise<ImageAsset> {
    if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type))
      throw new Error("Use a PNG, JPEG, or WebP image.");
    if (this.assets.has(assetId)) throw new Error("Duplicate asset ID.");
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new Error(
        "The browser could not decode this image. Check the file format and available device memory.",
      );
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(blob);
      });
      const thumbnail = document.createElement("canvas");
      const factor = Math.min(1, 96 / bitmap.width, 96 / bitmap.height);
      thumbnail.width = Math.max(1, Math.round(bitmap.width * factor));
      thumbnail.height = Math.max(1, Math.round(bitmap.height * factor));
      thumbnail
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, thumbnail.width, thumbnail.height);
      const asset: ImageAsset = {
        id: assetId,
        name: name.slice(0, 240),
        width: bitmap.width,
        height: bitmap.height,
        dataUrl,
        bitmap,
        thumbnail: thumbnail.toDataURL(),
      };
      thumbnail.width = thumbnail.height = 0;
      this.assets.set(assetId, asset);
      return asset;
    } catch (error) {
      bitmap.close();
      throw error;
    }
  }

  serialize(ids: Set<string>): SerializedAsset[] {
    return [...ids].map((assetId) => {
      const {
        bitmap: _bitmap,
        thumbnail: _thumbnail,
        ...data
      } = this.get(assetId);
      return data;
    });
  }

  remove(assetId: string) {
    const asset = this.assets.get(assetId);
    if (asset) {
      asset.bitmap.close();
      this.assets.delete(assetId);
    }
  }

  dispose() {
    this.assets.forEach((asset) => asset.bitmap.close());
    this.assets.clear();
  }
}
