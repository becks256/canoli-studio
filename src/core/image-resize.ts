import { AffineTransform } from './affine';
import { transformSelection } from './drawing';
import { allLayers, type DocumentData } from './model';
import type { LayerMaskData } from './masks';

/** Change output resolution without rewriting original assets or editable artwork. */
export function resizeImage(document: DocumentData, width: number, height: number) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0))
    throw new Error('Image dimensions must be positive safe integers.');
  if (width === document.width && height === document.height) return;
  const sx = width / document.width, sy = height / document.height;
  const scale = AffineTransform.scale(sx, sy);
  const scalePosition = (node: { x: number; y: number; transform?: ReturnType<AffineTransform['toJSON']> }) => {
    node.x *= sx; node.y *= sy;
    node.transform = scale.multiply(node.transform ? AffineTransform.fromJSON(node.transform) : new AffineTransform()).toJSON();
  };
  const scaleMask = (mask: LayerMaskData | null | undefined) => {
    if (!mask || mask.linked !== false) return;
    mask.x = (mask.x ?? 0) * sx; mask.y = (mask.y ?? 0) * sy;
    mask.basis = scale.multiply(mask.basis ? AffineTransform.fromJSON(mask.basis) : new AffineTransform()).toJSON();
  };
  for (const layer of document.children) scalePosition(layer);
  for (const layer of allLayers(document.children)) {
    scaleMask(layer.mask);
    if (layer.kind === 'smart-object') scaleMask(layer.filterMask);
  }
  for (const comp of document.layerComps ?? [])
    for (const layer of comp.layers)
      if (layer.parentId === null && layer.position) scalePosition(layer.position);
  for (const guide of document.guides ?? [])
    guide.position *= guide.orientation === 'vertical' ? sx : sy;
  document.selection = transformSelection(document.selection, scale);
  for(const channel of document.alphaChannels??[])
    channel.selection=transformSelection(channel.selection,scale)!;
  document.width = width; document.height = height;
}
