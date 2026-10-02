import {
  uniformFilterMaskCoverage,
  regionalFilterMask,
} from "./filter-mask-coverage";
import { FilterTileCache } from "./filter-tile-cache";
import { filteredMasterTile, drawCompletedFilterTile } from "./smart-filters";
import { smartFilterHalo } from "../core/smart/filters";
import type { SmartObjectInstanceData } from "../core/smart/types";
import { createDocument, createRaster } from "../core/model";
import { ComponentRegistry } from "../core/smart/manager";
import { resolveSmartDocument } from "../core/smart/resolve";
import type { DodgeBurnOptions } from "../core/retouch/types";
import { renderTonalStroke } from "./retouch";
import { blendAdjustedTile } from "./adjustment-blend";
import { localTransform } from "../core/spatial";
import { maskTransform, maskGeometry } from "../core/masks";
import type { LayerMaskData } from "../core/masks";
import { maskCoverage, PaintedMaskRaster } from "./masks";
import type { AssetStore } from "../core/assets";
import type {
  DocumentData,
  LayerData,
  RasterLayerData,
  ToneEffectData,
} from "../core/model";
import { computeAdjustmentLuts } from "../core/adjustments";
import { defaultStyle } from "../core/drawing";
import { PixelProcessor } from "./processor";
import { createCanvas, release, renderTransform } from "./canvas";
import { AffineTransform } from "../core/affine";
import type { RenderSpace } from "./canvas";
import {
  ActiveStrokeRaster,
  drawPaint,
  drawText,
  drawVectors,
} from "./drawing";
import type { BrushStrokeData } from "../core/drawing";
import { CanvasCache } from "./cache";

export interface RenderRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PaintPreview {
  layerId: string;
  stroke: BrushStrokeData;
  /** Mask coverage target; absent for normal paint-layer previews. */
  maskMode?: "hide" | "reveal";
  tonal?: Omit<DodgeBurnOptions, "flow">;
}
/** Trusted renderer-only preview; the final stroke still commits through the DOM. */
export function previewMask(
  layer: LayerData,
  preview?: PaintPreview | null,
): LayerMaskData | null | undefined {
  const mask = layer.mask;
  return mask && preview?.maskMode && preview.layerId === layer.id
    ? {
        ...mask,
        strokes: [
          ...(mask.strokes ?? []),
          { mode: preview.maskMode, stroke: preview.stroke },
        ],
      }
    : mask;
}
export interface RenderOptions {
  /** Trusted transient tool data; never committed to document history. */
  paintPreview?: PaintPreview | null;
  /** Export/reference renders bypass retained viewport pixels. */
  cache?: boolean;
  readback?: boolean;
  region?: RenderRegion;
  scale?: number;
  maxPixels?: number;
  maxDimension?: number;
  /** Exact output aspect for export resampling; allocation budgets still apply. */
  outputSize?: { width: number; height: number };
}
interface CanvasRenderOptions extends RenderOptions {
  componentDepth?: number;
  /** Internal basis for isolated GPU reference rendering; never serialized. */
  rootTransform?: AffineTransform;
  /** Source document plane when rendering through a sampling transform. */
  documentTransform?: AffineTransform;
}
export interface DocumentRenderer {
  render(
    document: DocumentData,
    assets: AssetStore,
    options?: RenderOptions,
  ): Promise<HTMLCanvasElement>;
  clearCache(): void;
  dispose(): void;
}
export function workingSize(
  width: number,
  height: number,
  scale = 1,
  maxPixels = 4_000_000,
  maxDimension = 4096,
) {
  const factor = Math.min(
    scale,
    Math.sqrt(maxPixels / width / height),
    maxDimension / width,
    maxDimension / height,
  );
  return {
    width: Math.max(
      1,
      Math.floor(width * factor + Number.EPSILON * width * factor * 4),
    ),
    height: Math.max(
      1,
      Math.floor(height * factor + Number.EPSILON * height * factor * 4),
    ),
  };
}

/** All tools and exports share this region compositor. Image resolution is
 * independent of bounded buffers, stroke tiles and effect halos. */
export class CanvasRenderer implements DocumentRenderer {
  readonly processor = new PixelProcessor();
  private cache = new CanvasCache();
  private filterTiles = new FilterTileCache();
  private maskPaint = new PaintedMaskRaster(this.cache);
  get maskDiagnostics() {
    return this.maskPaint.diagnostics;
  }
  private activeStroke = new ActiveStrokeRaster();
  private signatures = new WeakMap<LayerData, string>();
  private assetIds = new WeakMap<AssetStore, number>();
  private nextAssetId = 0;
  private epoch = 0;
  private readonly fonts =
    typeof globalThis.document === "undefined"
      ? undefined
      : globalThis.document.fonts;
  private readonly fontsChanged = () => this.clearCache();
  constructor() {
    this.fonts?.addEventListener("loadingdone", this.fontsChanged);
    this.fonts?.addEventListener("loadingerror", this.fontsChanged);
  }

  private signature(layer: LayerData): string {
    const cached = this.signatures.get(layer);
    if (cached) return cached;
    const signature = JSON.stringify({ ...layer, mask: null });
    if (Object.isFrozen(layer)) this.signatures.set(layer, signature);
    return signature;
  }

  async renderMaskCoverage(
    mask: LayerMaskData,
    space: RenderSpace,
    x: number,
    y: number,
    key: string,
    retain = true,
    world = AffineTransform.translation(x, y),
    assets?: AssetStore,
  ) {
    const epoch = this.epoch;
    let bitmap: ImageBitmap | HTMLCanvasElement | undefined;
    if (mask.kind === "bitmap" && assets && assets.has(mask.assetId)) {
      bitmap = assets.get(mask.assetId).bitmap;
    }
    return maskCoverage(
      mask,
      space,
      x,
      y,
      this.processor,
      retain
        ? {
            paint: this.maskPaint,
            key,
            canCache: () => this.epoch === epoch,
          }
        : undefined,
      world,
      bitmap,
    );
  }

  private async raster(
    layer: RasterLayerData,
    assets: AssetStore,
    target: HTMLCanvasElement,
    space: RenderSpace,
    world: AffineTransform,
  ) {
    const context = target.getContext("2d")!,
      asset = assets.get(layer.assetId);
    const placement = renderTransform(space, world);
    const { x, y, width, height } = placement.bounds({
      x: 0,
      y: 0,
      width: layer.width,
      height: layer.height,
    });
    const left = Math.max(0, Math.floor(x)),
      top = Math.max(0, Math.floor(y));
    const right = Math.min(space.width, Math.ceil(x + width)),
      bottom = Math.min(space.height, Math.ceil(y + height));
    if (right <= left || bottom <= top) return;
    const effects = layer.effects.filter(
      (e) =>
        e.enabled &&
        (e.exposure !== 0 || e.contrast !== 0 || e.saturation !== 0),
    );
    const draw = (target: CanvasRenderingContext2D, tileX = 0, tileY = 0) => {
      target.save();
      try {
        target.setTransform(
          placement.a,
          placement.b,
          placement.c,
          placement.d,
          placement.e - tileX,
          placement.f - tileY,
        );
        target.drawImage(asset.bitmap, 0, 0, layer.width, layer.height);
      } finally {
        target.restore();
      }
    };
    if (!effects.length) {
      draw(context);
      return;
    }
    for (let ty = top; ty < bottom; ty += 1024)
      for (let tx = left; tx < right; tx += 1024) {
        const tile = createCanvas(
          Math.min(1024, right - tx),
          Math.min(1024, bottom - ty),
          true,
        );
        try {
          const c = tile.getContext("2d")!;
          draw(c, tx, ty);
          const pixels = await this.processor.process(
            c.getImageData(0, 0, tile.width, tile.height).data,
            effects,
          );
          const adjusted = c.createImageData(tile.width, tile.height);
          adjusted.data.set(pixels);
          c.putImageData(adjusted, 0, 0);
          context.drawImage(tile, tx, ty);
        } finally {
          release(tile);
        }
      }
  }

  private async smart(
    layer: SmartObjectInstanceData,
    registry: ComponentRegistry,
    assets: AssetStore,
    target: HTMLCanvasElement,
    space: RenderSpace,
    world: AffineTransform,
    options: CanvasRenderOptions,
  ) {
    const source = registry.get(layer.componentId).source;
    const master =
      source.kind === "document"
        ? source.document
        : {
            ...createDocument("Component source", source.width, source.height),
            id: `asset-master:${layer.componentId}`,
            children: [
              createRaster(
                "Source",
                source.assetId,
                source.width,
                source.height,
              ),
            ],
          };
    const sourceDocument = { ...master, components: registry.values() };
    const nativeWorld = world.multiply(
      AffineTransform.scale(
        layer.width / master.width,
        layer.height / master.height,
      ),
    );
    const placement = renderTransform(space, nativeWorld);
    const filterMask = layer.filterMask;
    const epoch = this.epoch;
    const maskBasis = filterMask
      ? (() => {
          const offset = maskTransform(filterMask, new AffineTransform());
          return filterMask.linked === false
            ? nativeWorld
                .inverse()
                .multiply(
                  options.documentTransform
                    ? options.documentTransform.multiply(offset)
                    : offset,
                )
            : offset;
        })()
      : new AffineTransform();
    const mask =
      filterMask?.enabled && filterMask.density > 0
        ? {
            density: filterMask.density,
            inverted: filterMask.inverted,
            constant: (region: RenderRegion) =>
              uniformFilterMaskCoverage(filterMask, region, maskBasis),
            render: (region: RenderRegion) => {
              return maskCoverage(
                filterMask,
                { ...region, sx: 1, sy: 1 },
                0,
                0,
                this.processor,
                undefined,
                maskBasis,
                filterMask.kind === "bitmap"
                  ? assets.get(filterMask.assetId).bitmap
                  : undefined,
              );
            },
          }
        : undefined;
    const inverse = placement.inverse();
    const filters = layer.smartFilters ?? [];
    const filterSignature = JSON.stringify([
      registry.values(),
      filters,
      master.width,
      master.height,
    ]);
    const retention =
      options.cache === false
        ? undefined
        : {
            cache: this.filterTiles,
            key: `filter:${this.assetIds.get(assets)}:${layer.componentId}`,
            signature: filterSignature,
            completed:
              mask && filterMask
                ? {
                    cache: this.cache,
                    key: `filtered-composite:${this.assetIds.get(assets)}:${layer.componentId}:${layer.id}`,
                    signature: (region: RenderRegion) =>
                      JSON.stringify([
                        filterSignature,
                        maskBasis,
                        regionalFilterMask(filterMask, region, maskBasis),
                      ]),
                  }
                : undefined,
            canCache: () => this.epoch === epoch,
          };
    const halo = smartFilterHalo(filters);
    // Partition in output coordinates so affine clipping never overlaps or leaves antialiased seams.
    // Size each output tile so its native sampling footprint stays near 512 pixels per axis.
    const nativePerPixel = Math.max(
      Math.abs(inverse.a) + Math.abs(inverse.c),
      Math.abs(inverse.b) + Math.abs(inverse.d),
    );
    const step = Math.max(1, Math.min(256, Math.floor(512 / nativePerPixel)));
    const context = target.getContext("2d")!;
    for (let ty = 0; ty < target.height; ty += step)
      for (let tx = 0; tx < target.width; tx += step) {
        const width = Math.min(step, target.width - tx),
          height = Math.min(step, target.height - ty);
        const bounds = inverse.bounds({ x: tx, y: ty, width, height });
        const left = Math.max(-halo - 2, Math.floor(bounds.x) - 2),
          top = Math.max(-halo - 2, Math.floor(bounds.y) - 2);
        const right = Math.min(
          master.width + halo + 2,
          Math.ceil(bounds.x + bounds.width) + 2,
        );
        const bottom = Math.min(
          master.height + halo + 2,
          Math.ceil(bounds.y + bounds.height) + 2,
        );
        if (right <= left || bottom <= top) continue;
        const tileRegion = {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        };
        context.save();
        try {
          context.beginPath();
          context.rect(tx, ty, width, height);
          context.clip();
          context.setTransform(
            placement.a,
            placement.b,
            placement.c,
            placement.d,
            placement.e,
            placement.f,
          );
          if (
            drawCompletedFilterTile(
              retention?.completed,
              tileRegion,
              filters,
              context,
            )
          )
            continue;
          const tile = await filteredMasterTile(
            (region) =>
              this.render(sourceDocument, assets, {
                region,
                outputSize: { width: region.width, height: region.height },
                maxPixels: region.width * region.height,
                maxDimension: Math.max(region.width, region.height),
                cache: options.cache,
                readback: true,
                componentDepth: (options.componentDepth ?? 0) + 1,
              }),
            this.processor,
            tileRegion,
            filters,
            master.width,
            master.height,
            mask,
            retention,
          );
          try {
            context.drawImage(tile.canvas, tile.x, tile.y);
          } finally {
            release(tile.canvas);
          }
        } finally {
          context.restore();
        }
      }
  }

  async render(
    document: DocumentData,
    assets: AssetStore,
    options: CanvasRenderOptions = {},
  ): Promise<HTMLCanvasElement> {
    const registry = document.components?.length
      ? new ComponentRegistry(document.components)
      : undefined;
    const registrySignature = registry
      ? JSON.stringify(document.components)
      : "";
    if (registry)
      document = resolveSmartDocument(document, registry, {
        preserveFiltered: true,
      });
    if ((options.componentDepth ?? 0) > 64)
      throw new Error(
        "Smart-filter component nesting exceeds the render budget.",
      );
    const region = options.region ?? {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    };
    const size = workingSize(
      options.outputSize?.width ?? region.width,
      options.outputSize?.height ?? region.height,
      options.outputSize ? 1 : options.scale,
      options.maxPixels,
      options.maxDimension,
    );
    const space: RenderSpace = {
      x: region.x,
      y: region.y,
      ...size,
      sx: size.width / region.width,
      sy: size.height / region.height,
    };
    const needsReadback = (nodes: LayerData[]): boolean =>
      nodes.some(
        (layer) =>
          layer.styles?.blendIf.enabled ||
          layer.kind === "adjustment" ||
          (layer.kind === "group" && needsReadback(layer.children)),
      );
    const output = createCanvas(
      size.width,
      size.height,
      options.readback || needsReadback(document.children),
    );
    const epoch = this.epoch;
    const cache = options.cache === false ? undefined : this.cache;
    const canCache = () => this.epoch === epoch;
    if (!this.assetIds.has(assets))
      this.assetIds.set(assets, ++this.nextAssetId);
    const scope = `${document.id}:${this.assetIds.get(assets)}:${registrySignature}`;
    const preview = options.paintPreview;
    if (cache && (!preview || preview.maskMode)) this.activeStroke.clear();
    const affected = new Set<string>();
    const mark = (layer: LayerData): boolean => {
      const childAffected =
        layer.kind === "group" && layer.children.map(mark).some(Boolean);
      if (layer.id === preview?.layerId || childAffected) {
        affected.add(layer.id);
        return true;
      }
      return false;
    };
    if (preview) document.children.forEach(mark);
    const paint = async (
      nodes: LayerData[],
      target: HTMLCanvasElement,
      current: RenderSpace,
      parent: AffineTransform,
    ) => {
      const targetContext = target.getContext("2d")!;
      for (const layer of nodes) {
        if (!layer.visible || layer.opacity === 0) continue;
        const world = parent.multiply(localTransform(layer));
        const style = layer.styles ?? defaultStyle(),
          shadow = style.dropShadow;
        // The halo is expressed in output pixels and propagated into child
        // rendering. Export strip boundaries therefore do not clip shadows.
        const haloX = shadow.enabled
          ? Math.ceil((shadow.blur * 3 + Math.abs(shadow.x)) * current.sx) + 2
          : 0;
        const haloY = shadow.enabled
          ? Math.ceil((shadow.blur * 3 + Math.abs(shadow.y)) * current.sy) + 2
          : 0;
        const padded: RenderSpace = {
          ...current,
          x: current.x - haloX / current.sx,
          y: current.y - haloY / current.sy,
          width: current.width + haloX * 2,
          height: current.height + haloY * 2,
        };
        const content = createCanvas(
          padded.width,
          padded.height,
          layer.kind === "group" && needsReadback(layer.children),
        );
        const result = createCanvas(
          current.width,
          current.height,
          style.blendIf.enabled,
        );
        try {
          // Cache unstyled content; opacity/blending and backdrop-dependent
          // Blend If are evaluated on every composition. Ancestors of a live
          // stroke are recomposed from their cached, unchanged children.
          const cacheable =
            (!affected.has(layer.id) ||
              layer.kind === "paint" ||
              (!!preview?.maskMode && layer.id === preview.layerId)) &&
            layer.kind !== "adjustment";
          const key = `${scope}:${layer.id}:${JSON.stringify([padded, world])}`;
          const signature = cacheable && cache ? this.signature(layer) : "";
          if (!cacheable || !cache?.read(key, signature, content)) {
            if (layer.kind === "smart-object") {
              if (!registry) throw new Error("Missing smart-object registry.");
              await this.smart(
                layer,
                registry,
                assets,
                content,
                padded,
                world,
                options,
              );
            } else if (layer.kind === "raster")
              await this.raster(layer, assets, content, padded, world);
            else if (layer.kind === "paint")
              await drawPaint(
                layer,
                assets,
                content,
                padded,
                world,
                this.processor,
              );
            else if (layer.kind === "vector")
              drawVectors(layer, content, padded, world);
            else if (layer.kind === "text")
              drawText(layer, content, padded, world);
            else if (layer.kind === "adjustment") {
              const c = content.getContext("2d")!;
              c.drawImage(target, haloX, haloY);
              if (layer.adjustment.kind === "patch") {
                const patch = layer.adjustment;
                const bitmap = assets.get(patch.assetId).bitmap;
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx),
                      height = Math.min(1024, padded.height - ty);
                    const tileSpace = {
                      ...padded,
                      x: padded.x + tx / padded.sx,
                      y: padded.y + ty / padded.sy,
                      width,
                      height,
                    };
                    const surface = createCanvas(width, height, true);
                    try {
                      const context = surface.getContext("2d")!;
                      const m = renderTransform(tileSpace, world);
                      context.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
                      context.drawImage(
                        bitmap,
                        0,
                        0,
                        patch.width,
                        patch.height,
                      );
                      const corrected = context.getImageData(
                        0,
                        0,
                        width,
                        height,
                      ).data;
                      const backdrop = c.getImageData(tx, ty, width, height);
                      const pixels = await this.processor.blendAdjustment(
                        backdrop.data,
                        corrected,
                        corrected,
                        1,
                      );
                      const output = c.createImageData(width, height);
                      output.data.set(pixels);
                      c.putImageData(output, tx, ty);
                    } finally {
                      release(surface);
                    }
                  }
              } else if (layer.adjustment.kind === "tonal") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx),
                      height = Math.min(1024, padded.height - ty);
                    const tileSpace = {
                      ...padded,
                      x: padded.x + tx / padded.sx,
                      y: padded.y + ty / padded.sy,
                      width,
                      height,
                    };
                    const image = c.getImageData(tx, ty, width, height);
                    let pixels: Uint8ClampedArray = image.data;
                    const strokes =
                      preview?.layerId === layer.id && preview.tonal
                        ? [
                            ...layer.adjustment.strokes,
                            { ...preview.tonal, brush: preview.stroke },
                          ]
                        : layer.adjustment.strokes;
                    for (const stroke of strokes)
                      pixels = await renderTonalStroke(
                        pixels,
                        stroke.brush,
                        stroke,
                        tileSpace,
                        this.processor,
                        world,
                      );
                    image.data.set(pixels);
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "hsl") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx),
                      height = Math.min(1024, padded.height - ty);
                    const image = c.getImageData(tx, ty, width, height);
                    image.data.set(
                      await this.processor.hsl(image.data, layer.adjustment),
                    );
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "tone") {
                const adj = layer.adjustment;
                if (
                  adj.exposure !== 0 ||
                  adj.contrast !== 0 ||
                  adj.saturation !== 0
                ) {
                  const effect: ToneEffectData = {
                    id: layer.id,
                    kind: "tone",
                    enabled: true,
                    exposure: adj.exposure,
                    contrast: adj.contrast,
                    saturation: adj.saturation,
                  };
                  for (let ty = 0; ty < padded.height; ty += 1024) {
                    for (let tx = 0; tx < padded.width; tx += 1024) {
                      const w = Math.min(1024, padded.width - tx);
                      const h = Math.min(1024, padded.height - ty);
                      const imgData = c.getImageData(tx, ty, w, h);
                      const processed = await this.processor.process(
                        imgData.data,
                        [effect],
                      );
                      const out = c.createImageData(w, h);
                      out.data.set(processed);
                      c.putImageData(out, tx, ty);
                    }
                  }
                }
              } else {
                const luts = computeAdjustmentLuts(layer.adjustment);
                for (let ty = 0; ty < padded.height; ty += 1024) {
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const w = Math.min(1024, padded.width - tx);
                    const h = Math.min(1024, padded.height - ty);
                    const imgData = c.getImageData(tx, ty, w, h);
                    const processed = await this.processor.applyLut(
                      imgData.data,
                      luts.combined,
                    );
                    const out = c.createImageData(w, h);
                    out.data.set(processed);
                    c.putImageData(out, tx, ty);
                  }
                }
              }
            } else if (layer.kind === "group")
              await paint(layer.children, content, padded, world);
            else
              throw new Error(
                "Smart-object references must be resolved before compositing.",
              );
            if (cacheable && canCache()) cache?.write(key, signature, content);
          }
          if (
            layer.kind === "paint" &&
            !preview?.maskMode &&
            layer.id === preview?.layerId
          ) {
            await drawPaint(
              { ...layer, strokes: [preview.stroke] },
              assets,
              content,
              padded,
              world,
              this.processor,
              cache && canCache() ? this.activeStroke : undefined,
              canCache() ? cache : undefined,
              canCache,
            );
          }
          const c = content.getContext("2d")!,
            r = result.getContext("2d")!;
          const maskData = previewMask(layer, preview);
          let maskCanvas: HTMLCanvasElement | undefined;
          if (maskData?.enabled && maskData.density > 0) {
            const rawMaskWorld = maskTransform(maskData, world);
            const maskWorld =
              maskData.linked === false && options.documentTransform
                ? options.documentTransform.multiply(rawMaskWorld)
                : rawMaskWorld;
            const origin = maskWorld.point({ x: 0, y: 0 });
            const maskKey = `${scope}:mask:${layer.id}`;
            const maskSignature = JSON.stringify([
              maskGeometry(maskData),
              maskData.feather ?? 0,
              padded,
              maskWorld,
            ]);
            let mask = cache
              ? createCanvas(padded.width, padded.height)
              : undefined;
            if (!mask || !cache!.read(maskKey, maskSignature, mask)) {
              if (mask) release(mask);
              mask = await this.renderMaskCoverage(
                maskData,
                padded,
                origin.x,
                origin.y,
                maskKey,
                !!cache,
                maskWorld,
                assets,
              );
              if (canCache()) cache?.write(maskKey, maskSignature, mask);
            }
            try {
              const m = mask.getContext("2d")!;
              m.fillStyle = "#ffffff";
              if (maskData.inverted) {
                m.globalCompositeOperation = "xor";
                m.fillRect(0, 0, mask.width, mask.height);
              }
              m.globalCompositeOperation = "destination-over";
              m.globalAlpha = 1 - maskData.density;
              m.fillRect(0, 0, mask.width, mask.height);
              if (layer.kind === "adjustment") {
                maskCanvas = createCanvas(mask.width, mask.height, true);
                maskCanvas.getContext("2d")!.drawImage(mask, 0, 0);
              } else {
                c.save();
                c.globalCompositeOperation = "destination-in";
                c.drawImage(mask, 0, 0);
                c.restore();
              }
            } finally {
              release(mask);
            }
          }
          if (shadow.enabled && shadow.opacity > 0) {
            const silhouette = createCanvas(padded.width, padded.height);
            const s = silhouette.getContext("2d")!;
            try {
              s.drawImage(content, 0, 0);
              s.globalCompositeOperation = "source-in";
              s.fillStyle = shadow.color;
              s.fillRect(0, 0, padded.width, padded.height);
              r.save();
              r.filter = `blur(${shadow.blur * Math.max(current.sx, current.sy)}px)`;
              r.globalAlpha = shadow.opacity;
              r.drawImage(
                silhouette,
                -haloX + shadow.x * current.sx,
                -haloY + shadow.y * current.sy,
              );
              r.restore();
            } finally {
              release(silhouette);
            }
          }
          if (style.colorOverlay.enabled) {
            c.save();
            c.globalCompositeOperation = "source-atop";
            c.globalAlpha = style.colorOverlay.opacity;
            c.fillStyle = style.colorOverlay.color;
            c.fillRect(0, 0, padded.width, padded.height);
            c.restore();
          }
          if (layer.kind === "adjustment") {
            try {
              for (let ty = 0; ty < current.height; ty += 1024)
                for (let tx = 0; tx < current.width; tx += 1024) {
                  const width = Math.min(1024, current.width - tx),
                    height = Math.min(1024, current.height - ty);
                  const targetData = targetContext.getImageData(
                    tx,
                    ty,
                    width,
                    height,
                  );
                  const contentData = c.getImageData(
                    haloX + tx,
                    haloY + ty,
                    width,
                    height,
                  );
                  const maskDataPixels = maskCanvas
                    ? maskCanvas
                        .getContext("2d")!
                        .getImageData(haloX + tx, haloY + ty, width, height)
                        .data
                    : null;
                  const blended = await blendAdjustedTile(
                    this.processor,
                    targetData,
                    contentData,
                    maskDataPixels,
                    layer.opacity * (layer.fillOpacity ?? 1),
                    layer.blendMode,
                    style.blendIf,
                  );
                  const adjusted = targetContext.createImageData(width, height);
                  adjusted.data.set(blended);
                  targetContext.putImageData(adjusted, tx, ty);
                }
            } finally {
              if (maskCanvas) release(maskCanvas);
            }
          } else {
            r.globalAlpha = layer.fillOpacity ?? 1;
            r.drawImage(content, -haloX, -haloY);
            r.globalAlpha = 1;
            if (style.blendIf.enabled) {
              for (let ty = 0; ty < current.height; ty += 1024)
                for (let tx = 0; tx < current.width; tx += 1024) {
                  const width = Math.min(1024, current.width - tx),
                    height = Math.min(1024, current.height - ty);
                  const pixels = await this.processor.blendIf(
                    r.getImageData(tx, ty, width, height).data,
                    targetContext.getImageData(tx, ty, width, height).data,
                    style.blendIf,
                  );
                  const adjusted = r.createImageData(width, height);
                  adjusted.data.set(pixels);
                  r.putImageData(adjusted, tx, ty);
                }
            }
            targetContext.save();
            targetContext.globalAlpha = layer.opacity;
            targetContext.globalCompositeOperation =
              layer.blendMode === "normal" ? "source-over" : layer.blendMode;
            targetContext.drawImage(result, 0, 0);
            targetContext.restore();
          }
        } finally {
          release(content);
          release(result);
        }
      }
    };
    try {
      await paint(
        document.children,
        output,
        space,
        options.rootTransform ?? new AffineTransform(),
      );
      return output;
    } catch (error) {
      release(output);
      throw error;
    }
  }
  clearCache() {
    this.epoch++;
    this.cache.clear();
    this.filterTiles.clear();
    this.maskPaint.clear();
    this.activeStroke.clear();
    this.signatures = new WeakMap();
  }
  dispose() {
    this.fonts?.removeEventListener("loadingdone", this.fontsChanged);
    this.fonts?.removeEventListener("loadingerror", this.fontsChanged);
    this.clearCache();
    this.processor.dispose();
  }
}
