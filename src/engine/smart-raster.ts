import type { AssetStore } from "../core/assets";
import { AffineTransform } from "../core/affine";
import { cropDocument } from "../core/crop";
import { maskTransform } from "../core/masks";
import {
  findLayer,
  isLocked,
  id,
  type DocumentData,
  type RasterLayerData,
} from "../core/model";
import { layerTransform, parentId } from "../core/spatial";
import { exportPng } from "./png";
import type { DocumentRenderer } from "./renderer";
import { release } from "./canvas";
import {captureFrequencyRadius} from '../core/frequency-separation';

/** Bake the instance's content and affine placement; keep outer compositing properties editable. */
export async function prepareSmartRaster(
  document: DocumentData,
  layerId: string,
  assets: AssetStore,
  renderer: DocumentRenderer,
  check: () => void = () => {},
): Promise<{ layer: RasterLayerData; blob: Blob }> {
  check();
  const instance = findLayer(document, layerId);
  if (instance?.kind !== "smart-object" || isLocked(document, layerId))
    throw new Error(
      "Rasterization requires an unlocked smart-object instance.",
    );
  const world = layerTransform(document, layerId)!;
  const bounds = world.bounds({
    x: 0,
    y: 0,
    width: instance.width,
    height: instance.height,
  });
  const x = Math.floor(bounds.x),
    y = Math.floor(bounds.y);
  const width = Math.ceil(bounds.x + bounds.width) - x,
    height = Math.ceil(bounds.y + bounds.height) - y;
  const isolated = structuredClone(document);
  isolated.children = [
    {
      ...structuredClone(captureFrequencyRadius(document,instance)),
      x: world.e,
      y: world.f,
      transform: { a: world.a, b: world.b, c: world.c, d: world.d, e: 0, f: 0 },
      visible: true,
      clipped: undefined,
      opacity: 1,
      fillOpacity: 1,
      blendMode: "normal",
      styles: undefined,
      mask: null,
    },
  ];
  isolated.selection = null;
  cropDocument(isolated, { x, y, width, height });
  const guarded: DocumentRenderer = {
    async render(...args) {
      check();
      const canvas = await renderer.render(...args);
      try {
        check();
        return canvas;
      } catch (error) {
        release(canvas);
        throw error;
      }
    },
    clearCache() {},
    dispose() {},
  };
  const blob = await exportPng(isolated, assets, guarded);
  check();
  const parent = parentId(document, layerId);
  const parentWorld = parent
    ? layerTransform(document, parent)!
    : new AffineTransform();
  const placement = parentWorld
    .inverse()
    .multiply(AffineTransform.translation(x, y));
  const {
    kind: _kind,
    componentId: _component,
    smartFilters: _filters,
    filterMask: _filterMask,
    ...outer
  } = structuredClone(instance);
  const layer: RasterLayerData = {
    ...outer,
    kind: "raster",
    id: id(),
    assetId: id(),
    effects: [],
    width,
    height,
    x: placement.e,
    y: placement.f,
    transform: {
      a: placement.a,
      b: placement.b,
      c: placement.c,
      d: placement.d,
      e: 0,
      f: 0,
    },
  };
  if (layer.mask && layer.mask.linked !== false) {
    const relative = AffineTransform.translation(-x, -y).multiply(
      maskTransform(layer.mask, world),
    );
    layer.mask = {
      ...layer.mask,
      x: relative.e,
      y: relative.f,
      basis: {
        a: relative.a,
        b: relative.b,
        c: relative.c,
        d: relative.d,
        e: 0,
        f: 0,
      },
    };
  }
  return { layer, blob };
}
