import type { ImageAsset } from "../../core/assets";
import type { AnalysisImageInput } from "../adapters/types";

/** Bounded analysis preview, never a source/import resolution limit. */
export function readAnalysisImage(asset: ImageAsset): AnalysisImageInput {
  const scale = Math.min(1, 512 / Math.max(asset.width, asset.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(asset.width * scale));
  canvas.height = Math.max(1, Math.round(asset.height * scale));
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not allocate the analysis preview.");
    context.drawImage(asset.bitmap, 0, 0, canvas.width, canvas.height);
    return {
      assetId: asset.id,
      width: canvas.width,
      height: canvas.height,
      buffer: new Uint8Array(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
      ),
    };
  } finally {
    canvas.width = canvas.height = 0;
  }
}
