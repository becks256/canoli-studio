import type { PsdParsedLayer } from './types';

/** Losses that cannot be represented by the current native bitmap-mask path. */
export function psdMaskIssue(layer: PsdParsedLayer): string | undefined {
  if (layer.hasVectorMask) return 'Photoshop vector masks';
  const mask = layer.mask;
  if (!mask) return;
  if (!layer.imageData && !layer.isGroup) return 'Photoshop masks on non-raster layers';
  if (mask.unsupportedFeatures?.length) return mask.unsupportedFeatures.join(', ');
  if ((mask.feather ?? 0) !== 0) return 'Photoshop mask feathering';
  if (mask.right > mask.left && mask.bottom > mask.top && !layer.maskData)
    return 'missing or unsupported raster mask channel';
}
