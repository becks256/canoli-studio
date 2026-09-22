import type { AssetStore } from "../core/assets";
import type { DocumentData, LayerData, RasterLayerData } from "../core/model";
import { defaultStyle } from "../core/drawing";
import { PixelProcessor } from "./processor";
import { createCanvas, release } from "./canvas";
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
    width: Math.max(1, Math.floor(width * factor + Number.EPSILON * width * factor * 4)),
    height: Math.max(1, Math.floor(height * factor + Number.EPSILON * height * factor * 4)),
  };
}

/** All tools and exports share this region compositor. Image resolution is
 * independent of bounded buffers, stroke tiles and effect halos. */
export class CanvasRenderer implements DocumentRenderer {
  readonly processor = new PixelProcessor();
  private cache = new CanvasCache();
  private activeStroke = new ActiveStrokeRaster();
  private signatures = new WeakMap<LayerData, string>();
  private assetIds = new WeakMap<AssetStore, number>();
  private nextAssetId = 0;
  private epoch = 0;
  private signature(layer: LayerData): string {
    const cached = this.signatures.get(layer);
    if (cached) return cached;
    const signature = JSON.stringify(layer);
    if (Object.isFrozen(layer)) this.signatures.set(layer, signature);
    return signature;
  }

  private async raster(
    layer: RasterLayerData,
    assets: AssetStore,
    target: HTMLCanvasElement,
    space: RenderSpace,
    ox: number,
    oy: number,
  ) {
    const context = target.getContext("2d")!,
      asset = assets.get(layer.assetId);
    const x = (ox - space.x) * space.sx,
      y = (oy - space.y) * space.sy;
    const width = layer.width * space.sx,
      height = layer.height * space.sy;
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
    if (!effects.length) {
      context.drawImage(asset.bitmap, x, y, width, height);
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
          c.drawImage(asset.bitmap, x - tx, y - ty, width, height);
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

  async render(
    document: DocumentData,
    assets: AssetStore,
    options: RenderOptions = {},
  ): Promise<HTMLCanvasElement> {
    const region = options.region ?? {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    };
    const size = workingSize(
      region.width,
      region.height,
      options.scale,
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
    const needsReadback = (nodes: LayerData[]): boolean => nodes.some((layer) =>
      layer.styles?.blendIf.enabled || (layer.kind === "group" && needsReadback(layer.children)));
    const output = createCanvas(size.width, size.height, options.readback || needsReadback(document.children));
    const epoch = this.epoch;
    const cache = options.cache === false ? undefined : this.cache;
    const canCache = () => this.epoch === epoch;
    if (!this.assetIds.has(assets)) this.assetIds.set(assets, ++this.nextAssetId);
    const scope = `${document.id}:${this.assetIds.get(assets)}`;
    const preview = options.paintPreview;
    if (cache && !preview) this.activeStroke.clear();
    const affected = new Set<string>();
    const mark = (layer: LayerData): boolean => {
      const childAffected = layer.kind === "group" && layer.children.map(mark).some(Boolean);
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
      offsetX: number,
      offsetY: number,
    ) => {
      const targetContext = target.getContext("2d")!;
      for (const layer of nodes) {
        if (!layer.visible || layer.opacity === 0) continue;
        const x = offsetX + layer.x,
          y = offsetY + layer.y;
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
        const content = createCanvas(padded.width, padded.height, layer.kind === "group" && needsReadback(layer.children));
        const result = createCanvas(current.width, current.height, style.blendIf.enabled);
        try {
          // Cache unstyled content; opacity/blending and backdrop-dependent
          // Blend If are evaluated on every composition. Ancestors of a live
          // stroke are recomposed from their cached, unchanged children.
          const cacheable = !affected.has(layer.id) || layer.kind === "paint";
          const key = `${scope}:${layer.id}:${JSON.stringify([padded, x, y])}`;
          const signature = cacheable && cache ? this.signature(layer) : "";
          if (!cacheable || !cache?.read(key, signature, content)) {
            if (layer.kind === "raster")
              await this.raster(layer, assets, content, padded, x, y);
            else if (layer.kind === "paint")
              await drawPaint(layer, assets, content, padded, x, y, this.processor);
            else if (layer.kind === "vector")
              drawVectors(layer, content, padded, x, y);
            else if (layer.kind === "text")
              drawText(layer, content, padded, x, y);
            else await paint(layer.children, content, padded, x, y);
            if (cacheable && canCache()) cache?.write(key, signature, content);
          }
          if (layer.kind === "paint" && layer.id === preview?.layerId) {
            await drawPaint(
              { ...layer, strokes: [preview.stroke] }, assets, content,
              padded, x, y, this.processor,
              cache && canCache() ? this.activeStroke : undefined,
              canCache() ? cache : undefined, canCache,
            );
          }
          const c = content.getContext("2d")!,
            r = result.getContext("2d")!;
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
        } finally {
          release(content);
          release(result);
        }
      }
    };
    try {
      await paint(document.children, output, space, 0, 0);
      return output;
    } catch (error) {
      release(output);
      throw error;
    }
  }
  clearCache() {
    this.epoch++;
    this.cache.clear();
    this.activeStroke.clear();
    this.signatures = new WeakMap();
  }
  dispose() {
    this.clearCache();
    this.processor.dispose();
  }
}
