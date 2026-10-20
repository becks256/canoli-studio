import {projectNativeMask} from "./projected-mask";
import {frequencyIdentitySource} from './frequency-identity';
import {yieldTask} from './task-yield';
import { maskSignature } from "./mask-signature";
import {BrushTextureSampler} from './brush-texture';
import { checkRenderCurrent } from "./render-control";
import type { ClonePreviewSource } from "./clone-preview";
import type { TonalStrokeData } from "../core/adjustments";
import { isImmutable } from "../core/immutable";
import { contentSignature } from "./content-signature";
import {
  uniformFilterMaskCoverage,
  regionalFilterMask,
} from "./filter-mask-coverage";
import { FilterTileCache } from "./filter-tile-cache";
import { drawNativeWetContent, hasWetContent } from './wet-native';
import { filteredMasterTile, drawCompletedFilterTile } from "./smart-filters";
import { smartFilterHalo } from "../core/smart/filters";
import type { SmartObjectInstanceData } from "../core/smart/types";
import { createDocument, createRaster } from "../core/model";
import { ComponentRegistry } from "../core/smart/manager";
import { resolveSmartDocument } from "../core/smart/resolve";
import type { DodgeBurnOptions } from "../core/retouch/types";
import { renderTonalStroke } from "./retouch";
import { blendAdjustedTile } from "./adjustment-blend";
import { localTransform, localBounds } from "../core/spatial";
import { maskTransform, maskGeometry } from "../core/masks";
import type { LayerMaskData } from "../core/masks";
import { maskCoverage, PaintedMaskRaster, applyMaskSettings } from "./masks";
import type { AssetStore } from "../core/assets";
import type {
  DocumentData,
  LayerData,
  PaintLayerData,
  RasterLayerData,
  ToneEffectData,
} from "../core/model";
import { computeAdjustmentLuts } from "../core/adjustments";
import { defaultStyle, strokeBounds } from "../core/drawing";
import { PixelProcessor } from "./processor";
import { createCanvas, release, renderTransform } from "./canvas";
import { AffineTransform } from "../core/affine";
import type { RenderSpace } from "./canvas";
import {
  ActiveStrokeRaster,
  drawPaint,
  drawText,
  measureTextInk,
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
  cloneSource?: ClonePreviewSource;
  /** Mask coverage target; absent for normal paint-layer previews. */
  maskMode?: "hide" | "reveal";
  /** Apply coverage to smart filters rather than the ordinary layer mask. */
  filterMask?: boolean;
  tonal?: Omit<DodgeBurnOptions, "flow">;
}
/** Trusted renderer-only preview; the final stroke still commits through the DOM. */
export function previewMask(
  layer: LayerData,
  preview?: PaintPreview | null,
): LayerMaskData | null | undefined {
  const mask = layer.mask;
  return mask && preview?.maskMode && !preview.filterMask && preview.layerId === layer.id
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
  /** Internal transient cancellation predicate; never serialized. */
  isCancelled?: () => boolean;
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
  /** Bounded sharing within one render only, including uncached reference/export work. */
  frequencyScratch?:FilterTileCache;
  /** Shared by recursive native tiles so source shortcuts still allow input/cancellation. */
  taskBudget?:{deadline:number};
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
  /** Optional native coverage service for vector exports with rasterized masks. */
  renderMaskCoverage?(
    mask:LayerMaskData,space:RenderSpace,x:number,y:number,key:string,
    retain?:boolean,world?:AffineTransform,assets?:AssetStore,isCancelled?:()=>boolean,
  ):Promise<HTMLCanvasElement>;
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
  private readonly brushTextures=new BrushTextureSampler(this.processor);
  private cache = new CanvasCache();
  private filterTiles = new FilterTileCache();
  private maskPaint = new PaintedMaskRaster(this.cache);
  get maskDiagnostics() {
    return this.maskPaint.diagnostics;
  }
  private activeStroke = new ActiveStrokeRaster();
  private signatures = new WeakMap<LayerData, string>();
  private styledIds = new WeakMap<LayerData, number>();
  private nextStyledId = 0;
  private rasterPrefixes = new Map<string, { layer: RasterLayerData; signature: string; basis: string }>();
  private patchPrefixes = new Map<string, { layer: LayerData; backdrop: LayerData[] }>();
  private tonalPrefixes = new Map<string, { backdrop: LayerData[]; strokes: TonalStrokeData[]; signature: string }>();
  private tonalVersion = 0;
  private paintPrefixes = new Map<string, { layer: PaintLayerData; signature: string; basis: string }>();
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
    const signature = contentSignature(layer);
    if (Object.isFrozen(layer)) this.signatures.set(layer, signature);
    return signature;
  }

  private finishedStyleSignature(layer: LayerData, documentTransform?: AffineTransform): string {
    let identity = this.styledIds.get(layer);
    if (identity === undefined) {
      identity = ++this.nextStyledId;
      this.styledIds.set(layer, identity);
    }
    return `styled:${identity}:${JSON.stringify(documentTransform)}`;
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
    isCancelled?:()=>boolean,
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
      assets,
      retain?this.brushTextures:undefined,
      ()=>this.epoch!==epoch||!!isCancelled?.(),
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

  private async documentTone(layer:SmartObjectInstanceData,registry:ComponentRegistry,assets:AssetStore,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,options:CanvasRenderOptions){
    const effects=(layer.smartFilters??[]).filter(effect=>effect.enabled&&effect.kind==='document-tone').map(effect=>({...effect,kind:'tone' as const})) as ToneEffectData[];
    if(!effects.length)return;
    const preview=options.paintPreview,mask=layer.filterMask&&preview?.filterMask&&preview.maskMode&&preview.layerId===layer.id?{...layer.filterMask,strokes:[...(layer.filterMask.strokes??[]),{mode:preview.maskMode,stroke:preview.stroke}]}:layer.filterMask;
    let coverage:HTMLCanvasElement|undefined;
    try{
      if(mask?.enabled&&mask.density>0){
        const source=registry.get(layer.componentId).source,width=source.kind==='asset'?source.width:source.document.width,height=source.kind==='asset'?source.height:source.document.height;
        const nativeWorld=world.multiply(AffineTransform.scale(layer.width/width,layer.height/height)),offset=maskTransform(mask,new AffineTransform());
        const basis=mask.linked===false?nativeWorld.inverse().multiply(options.documentTransform??new AffineTransform()).multiply(offset):offset;
        coverage=await projectNativeMask(space,nativeWorld,region=>{const origin=basis.point({x:0,y:0});return this.renderMaskCoverage(regionalFilterMask(mask,region,basis),{...region,sx:1,sy:1},origin.x,origin.y,`document-tone-mask:${layer.id}`,options.cache!==false,basis,assets,options.isCancelled);},options.isCancelled);
      }
      const c=target.getContext('2d')!;
      for(let ty=0;ty<space.height;ty+=1024)for(let tx=0;tx<space.width;tx+=1024){
        checkRenderCurrent(options.isCancelled);const w=Math.min(1024,space.width-tx),h=Math.min(1024,space.height-ty),image=c.getImageData(tx,ty,w,h),original=coverage?image.data.slice():undefined;
        let pixels=await this.processor.process(image.data,effects);checkRenderCurrent(options.isCancelled);
        if(coverage&&original&&mask)pixels=await this.processor.mixFilteredOwned(original,pixels,coverage.getContext('2d')!.getImageData(tx,ty,w,h).data,mask.density,mask.inverted);
        checkRenderCurrent(options.isCancelled);const adjusted=c.createImageData(w,h);adjusted.data.set(pixels);c.putImageData(adjusted,tx,ty);
      }
    }finally{if(coverage)release(coverage);}
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
    const frequencyIdentity=frequencyIdentitySource(master,registry,assets);
    const nativeWorld = world.multiply(
      AffineTransform.scale(
        layer.width / master.width,
        layer.height / master.height,
      ),
    );
    const placement = renderTransform(space, nativeWorld);
    const preview = options.paintPreview;
    const filterMask = layer.filterMask && preview?.filterMask && preview.maskMode && preview.layerId === layer.id
      ? { ...layer.filterMask, strokes: [...(layer.filterMask.strokes ?? []), { mode: preview.maskMode, stroke: preview.stroke }] }
      : layer.filterMask;
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
                options.cache === false ? undefined : {
                  paint: this.maskPaint,
                  key: `filter-mask:${this.assetIds.get(assets)}:${layer.componentId}:${layer.id}`,
                  retainFull: !(preview?.filterMask && preview.layerId === layer.id),
                  // Coverage is read back for worker blending on each affected tile.
                  readback: true,
                  canCache: () => this.epoch === epoch && !options.isCancelled?.(),
                },
                maskBasis,
                filterMask.kind === "bitmap"
                  ? assets.get(filterMask.assetId).bitmap
                  : undefined,
                assets,
                options.cache===false?undefined:this.brushTextures,
                options.isCancelled,
              );
            },
          }
        : undefined;
    const inverse = placement.inverse();
    const filters = (layer.smartFilters ?? []).filter(filter=>filter.kind!=="document-tone");
    const lastNative=filters.filter(filter=>filter.enabled).at(-1);
    const nativeFrame = !lastNative || lastNative.kind === "native-composition" || lastNative.kind === "frequency-band";
    const sourceSignature=JSON.stringify([[...registry.reachableFrom(layer.componentId)].sort().map(id=>registry.get(id)),master.width,master.height]);
    const filterSignature=JSON.stringify([sourceSignature,filters]);
    const retention =
      options.cache === false
        ? undefined
        : {
            cache: this.filterTiles,
            key: `filter:${this.assetIds.get(assets)}:${layer.componentId}`,
            signature: filterSignature,
            sourceSignature,
            completed:
              mask && filterMask
                ? {
                    cache: this.cache,
                    key: `filtered-composite:${this.assetIds.get(assets)}:${layer.componentId}:${layer.id}`,
                    signature: (region: RenderRegion) =>
                      JSON.stringify([
                        filterSignature,
                        maskBasis,
                        maskSignature(regionalFilterMask(filterMask, region, maskBasis)),
                      ]),
                  }
                : undefined,
            canCache: () => this.epoch === epoch && !options.isCancelled?.(),
          };
    const halo = smartFilterHalo(filters);
    // Partition in output coordinates so affine clipping never overlaps or leaves antialiased seams.
    // Size each output tile so its native sampling footprint stays near 512 pixels per axis.
    const nativePerPixel = Math.max(
      Math.abs(inverse.a) + Math.abs(inverse.c),
      Math.abs(inverse.b) + Math.abs(inverse.d),
    );
    // A unit native frequency plane can cover the outer tile's two-pixel
    // overscan in one request. Keep affine sampling and large-halo budgets on
    // the established grid; source/document resolution is independent.
    const nativeFrequency = filters.length===1 && filters[0].kind==='frequency-band' &&
      placement.a===1 && placement.b===0 && placement.c===0 && placement.d===1 &&
      Number.isSafeInteger(placement.e) && Number.isSafeInteger(placement.f);
    const paddedEdge=512+4+2*halo;
    const tileLimit=nativeFrequency && paddedEdge<=8192 && paddedEdge*paddedEdge<=4_000_000?512:256;
    const step = Math.max(1, Math.min(tileLimit, Math.floor(512 / nativePerPixel)));
    const context = target.getContext("2d")!;
    for (let ty = 0; ty < target.height; ty += step)
      for (let tx = 0; tx < target.width; tx += step) {
        if(options.taskBudget && performance.now()>=options.taskBudget.deadline){
          await yieldTask();
          options.taskBudget.deadline=performance.now()+8;
        }
        checkRenderCurrent(options.isCancelled);
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
            !nativeFrame && drawCompletedFilterTile(
              retention?.completed,
              tileRegion,
              filters,
              context,
            )
          )
            continue;
          const tile = await filteredMasterTile(
            (region) =>
              this.render(frequencyIdentity?.unchanged(region)?{...sourceDocument,children:[frequencyIdentity.raster]}:sourceDocument, assets, {
                region,
                outputSize: { width: region.width, height: region.height },
                maxPixels: region.width * region.height,
                maxDimension: Math.max(region.width, region.height),
                cache: options.cache,
                readback: true,
                componentDepth: (options.componentDepth ?? 0) + 1,
                frequencyScratch:options.frequencyScratch,
                taskBudget:options.taskBudget,
                isCancelled: options.isCancelled,
              }),
            this.processor,
            tileRegion,
            filters,
            master.width,
            master.height,
            mask,
            retention,
            options.frequencyScratch?{cache:options.frequencyScratch,key:`filter:${this.assetIds.get(assets)}:${layer.componentId}`,signature:sourceSignature,canCache:()=>this.epoch===epoch&&!options.isCancelled?.()}:undefined,
          );
          try {
            if(nativeFrame){
              const left=Math.max(0,tile.x),top=Math.max(0,tile.y),right=Math.min(master.width,tile.x+tile.canvas.width),bottom=Math.min(master.height,tile.y+tile.canvas.height);
              if(right>left&&bottom>top){
                if(left===tile.x&&top===tile.y&&right===tile.x+tile.canvas.width&&bottom===tile.y+tile.canvas.height)context.drawImage(tile.canvas,tile.x,tile.y);
                else {
                  // Use the actual image boundary, preserving Canvas edge-clamp sampling
                  // and geometric antialiasing instead of interpolating into padded transparency.
                  const edge=createCanvas(right-left,bottom-top,true);
                  try{edge.getContext('2d')!.drawImage(tile.canvas,left-tile.x,top-tile.y,right-left,bottom-top,0,0,right-left,bottom-top);context.drawImage(edge,left,top);}
                  finally{release(edge);}
                }
              }
            }else context.drawImage(tile.canvas, tile.x, tile.y);
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
    checkRenderCurrent(options.isCancelled);
    if(!options.taskBudget)options={...options,taskBudget:{deadline:performance.now()+8}};
    const ownedFrequencyScratch=options.frequencyScratch?undefined:new FilterTileCache(8*1024*1024);
    if(ownedFrequencyScratch)options={...options,frequencyScratch:ownedFrequencyScratch};
    const registry = document.components?.length
      ? new ComponentRegistry(document.components)
      : undefined;
    const registrySignature = registry
      ? JSON.stringify(document.components)
      : "";
    if (registry)
      document = resolveSmartDocument(document, registry, {
        preserveFiltered: true,
        retainImmutable: true,
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
          layer.kind === "adjustment" || layer.blendMode === "linear-light" || layer.blendMode === "linear-burn" ||
          (layer.kind === "group" && needsReadback(layer.children)),
      );
    const output = createCanvas(
      size.width,
      size.height,
      options.readback || needsReadback(document.children),
    );
    const epoch = this.epoch;
    const cache = options.cache === false ? undefined : this.cache;
    const canCache = () => this.epoch === epoch && !options.isCancelled?.();
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
      isolated?: LayerData,
      externalBackdrop = false,
    ) => {
      const targetContext = target.getContext("2d")!;
      for (const layer of nodes) {
        checkRenderCurrent(options.isCancelled);
        if (!layer.visible || layer.opacity === 0) continue;
        const world = parent.multiply(localTransform(layer));
        const style = layer.styles ?? defaultStyle(),
          shadow = style.dropShadow;
        if (layer.blendMode === 'pass-through') {
          if (layer.kind !== 'group') throw new Error('Only groups support pass-through blending.');
          const maskData = previewMask(layer, preview);
          const opacity = isolated === layer ? 1 : layer.opacity;
          if (opacity === 1 && !(maskData?.enabled && maskData.density > 0)) {
            await paint(layer.children, target, current, world, undefined, true);
            continue;
          }
          // Children see the real sibling backdrop. Blend the complete result
          // back with that backdrop once in premultiplied space; never apply
          // group opacity separately to each child or mask the backdrop itself.
          const before = createCanvas(current.width, current.height);
          let after: HTMLCanvasElement | undefined;
          let coverage: HTMLCanvasElement | undefined;
          try {
            after = createCanvas(current.width, current.height, needsReadback(layer.children));
            before.getContext('2d')!.drawImage(target, 0, 0);
            after.getContext('2d')!.drawImage(target, 0, 0);
            await paint(layer.children, after, current, world, undefined, true);
            if (maskData?.enabled && maskData.density > 0) {
              const rawWorld = maskTransform(maskData, world);
              const maskWorld = maskData.linked === false && options.documentTransform
                ? options.documentTransform.multiply(rawWorld) : rawWorld;
              const origin = maskWorld.point({x:0,y:0});
              coverage = await this.renderMaskCoverage(maskData,current,origin.x,origin.y,`${scope}:pass:${layer.id}`,!!cache,maskWorld,assets,options.isCancelled);
              applyMaskSettings(coverage,maskData);
              const c = coverage.getContext('2d')!;
              c.globalCompositeOperation='destination-in';c.globalAlpha=opacity;c.fillStyle='#fff';c.fillRect(0,0,current.width,current.height);
            } else {
              coverage=createCanvas(current.width,current.height);
              const c=coverage.getContext('2d')!;c.globalAlpha=opacity;c.fillStyle='#fff';c.fillRect(0,0,current.width,current.height);
            }
            const b=before.getContext('2d')!,a=after.getContext('2d')!;
            b.globalCompositeOperation='destination-out';b.drawImage(coverage,0,0);
            a.globalCompositeOperation='destination-in';a.drawImage(coverage,0,0);
            checkRenderCurrent(options.isCancelled);
            targetContext.save();
            try {
              targetContext.globalAlpha=1;targetContext.globalCompositeOperation='copy';targetContext.drawImage(before,0,0);
              targetContext.globalCompositeOperation='lighter';targetContext.drawImage(after,0,0);
            } finally {targetContext.restore();}
          } finally {release(before);if(after)release(after);if(coverage)release(coverage);}
          continue;
        }
        // The halo is expressed in output pixels and propagated into child
        // rendering. Export strip boundaries therefore do not clip shadows.
        const haloX = shadow.enabled
          ? Math.ceil((shadow.blur * 3 + Math.abs(shadow.x)) * current.sx) + 2
          : 0;
        const haloY = shadow.enabled
          ? Math.ceil((shadow.blur * 3 + Math.abs(shadow.y)) * current.sy) + 2
          : 0;
        if (cache && isolated !== layer && !affected.has(layer.id) &&
            (layer.kind === "raster" || (layer.kind === "text" && shadow.enabled) ||
              (layer.kind === "paint" && layer.strokes.every(stroke => stroke.kind === "fill" && !stroke.clip))) &&
            layer.blendMode === "normal" && (layer.fillOpacity ?? 1) === 1 &&
            !style.blendIf.enabled) {
          const placement = renderTransform(current, world);
          const ink = layer.kind === "text" ? measureTextInk(layer) : undefined;
          const bounds = layer.kind === "raster"
            ? [localBounds(layer)!]
            : layer.kind === "paint" ? layer.strokes.map(strokeBounds)
            : ink ? [ink] : undefined;
          // Unsupported glyph metrics take the full reference path. Logical
          // text width alone cannot bound italic, RTL or overlapping glyph ink.
          if (bounds) {
            const blurSupport = shadow.enabled ? shadow.blur * 3 * Math.max(current.sx,current.sy) : 0;
            const marginX = shadow.enabled ? Math.ceil(blurSupport+Math.abs(shadow.x*current.sx))+2 : 0;
            const marginY = shadow.enabled ? Math.ceil(blurSupport+Math.abs(shadow.y*current.sy))+2 : 0;
            let left = current.width, top = current.height, right = 0, bottom = 0;
            for (const bound of bounds) {
              const box = placement.bounds(bound);
              left = Math.min(left, Math.floor(box.x)-2-marginX); top = Math.min(top, Math.floor(box.y)-2-marginY);
              right = Math.max(right, Math.ceil(box.x+box.width)+2+marginX); bottom = Math.max(bottom, Math.ceil(box.y+box.height)+2+marginY);
            }
            left = Math.max(0,left); top = Math.max(0,top);
            right = Math.min(current.width,right); bottom = Math.min(current.height,bottom);
            if (right <= left || bottom <= top) continue;
            // Keep the viewport's exact output-pixel grid. Isolated composition
            // leaves opacity for the parent, preserving backdrop alpha behavior.
            if ((right-left)*(bottom-top) < current.width*current.height*.75) {
              const bounded = {...current,x:current.x+left/current.sx,y:current.y+top/current.sy,width:right-left,height:bottom-top};
              // Finished appearances can draw directly without an intermediate
              // surface. Their key includes the same halo as the inner compositor.
              const maskActive = !!(layer.mask?.enabled && layer.mask.density > 0);
              const directSignature = isImmutable(layer) && (shadow.enabled || maskActive)
                ? this.finishedStyleSignature(layer, options.documentTransform)
                : !shadow.enabled && !maskActive
                  ? style.colorOverlay.enabled
                    ? JSON.stringify(["color-overlay", this.signature(layer), style.colorOverlay])
                    : this.signature(layer)
                  : undefined;
              if (directSignature !== undefined) {
                const keySpace = {...bounded,x:bounded.x-haloX/current.sx,y:bounded.y-haloY/current.sy,
                  width:bounded.width+haloX*2,height:bounded.height+haloY*2};
                const boundedKey = `${scope}:${layer.id}:${JSON.stringify([keySpace, world])}`;
                targetContext.save();
                try {
                  targetContext.globalAlpha = layer.opacity;
                  targetContext.globalCompositeOperation = "source-over";
                  if (cache.draw(boundedKey, directSignature, targetContext, left, top)) continue;
                } finally { targetContext.restore(); }
              }
              const surface = createCanvas(right-left,bottom-top);
              try {
                await paint([layer],surface,bounded,parent,layer);
                targetContext.save();
                try {
                  targetContext.globalAlpha = isolated === layer ? 1 : layer.opacity;
                  targetContext.globalCompositeOperation = "source-over";
                  targetContext.drawImage(surface,left,top);
                } finally { targetContext.restore(); }
              } finally { release(surface); }
              continue;
            }
          }
        }
        const padded: RenderSpace = {
          ...current,
          x: current.x - haloX / current.sx,
          y: current.y - haloY / current.sy,
          width: current.width + haloX * 2,
          height: current.height + haloY * 2,
        };
        // Cache unstyled content; opacity/blending and backdrop-dependent
        // Blend If are evaluated on every composition. Ancestors of a live
        // stroke are recomposed from their cached, unchanged children.
        const nativeWetPreview = (layer.kind === 'paint' || (layer.kind === 'raster' && preview?.stroke.kind === 'eraser')) && hasWetContent(layer) && preview?.layerId === layer.id && !preview.maskMode ? preview : undefined;
        const cacheable =
          !nativeWetPreview &&
          !(preview?.filterMask && preview.layerId === layer.id) &&
          (!affected.has(layer.id) ||
            layer.kind === "paint" || layer.kind === "raster" ||
            (!!preview?.maskMode && layer.id === preview.layerId)) &&
          layer.kind !== "adjustment" &&
          // Mutable vector previews cannot populate the raw cache. Serializing
          // thousands of points to probe it adds work without a possible hit.
          (layer.kind !== "vector" || isImmutable(layer.paths));
        const key = `${scope}:${layer.id}:${JSON.stringify([padded, world])}`;
        const signature = cacheable && cache ? this.signature(layer) : "";
        const patchBackdrop = layer.kind === "adjustment" && layer.adjustment.kind === "patch"
          ? nodes.slice(0, nodes.indexOf(layer)) : [];
        const retainPatch = !externalBackdrop && !!cache && layer.kind === "adjustment" && layer.adjustment.kind === "patch" &&
          isImmutable(layer) && !affected.has(layer.id) && !layer.mask && layer.opacity === 1 &&
          (layer.fillOpacity ?? 1) === 1 && layer.blendMode === "normal" &&
          !style.blendIf.enabled && !style.colorOverlay.enabled && !shadow.enabled &&
          patchBackdrop.every(node => isImmutable(node) && !affected.has(node.id));
        const patchKey = `${key}:patch:${JSON.stringify(options.documentTransform)}`;
        if (retainPatch) {
          const previous = this.patchPrefixes.get(patchKey);
          if (previous?.layer === layer && previous.backdrop.length === patchBackdrop.length &&
              previous.backdrop.every((node, i) => node === patchBackdrop[i])) {
            targetContext.save();
            try {
              targetContext.globalAlpha = 1;
              targetContext.globalCompositeOperation = "copy";
              if (cache!.draw(patchKey, "completed", targetContext)) continue;
            } finally { targetContext.restore(); }
          }
        }

        const finishedStyle = layer.blendMode !== "linear-light" && layer.blendMode !== "linear-burn" && !!cache && cacheable && isImmutable(layer) &&
          !affected.has(layer.id) && !style.blendIf.enabled &&
          (shadow.enabled || !!(layer.mask?.enabled && layer.mask.density > 0));
        let finishedSignature = "";
        if (finishedStyle) {
          finishedSignature = this.finishedStyleSignature(layer, options.documentTransform);
          targetContext.save();
          try {
            targetContext.globalAlpha = isolated === layer ? 1 : layer.opacity;
            targetContext.globalCompositeOperation = layer.blendMode === "normal" || (layer.blendMode === "linear-light" || layer.blendMode === "linear-burn") ? "source-over" : layer.blendMode;
            if (cache!.draw(key, finishedSignature, targetContext)) continue;
          } finally { targetContext.restore(); }
        }
        // Composite a retained, unchanged surface synchronously. No cache-owned
        // canvas escapes across an await, and no postprocessing mutates it.
        const rawComposite = layer.blendMode !== "linear-light" && layer.blendMode !== "linear-burn" && cacheable && !affected.has(layer.id) &&
          !shadow.enabled && !style.blendIf.enabled &&
          (layer.fillOpacity ?? 1) === 1 &&
          !(layer.mask?.enabled && layer.mask.density > 0);
        const compositeSignature = style.colorOverlay.enabled
          ? JSON.stringify(["color-overlay", signature, style.colorOverlay]) : signature;
        if (rawComposite && cache) {
          targetContext.save();
          try {
            targetContext.globalAlpha = isolated === layer ? 1 : layer.opacity;
            targetContext.globalCompositeOperation =
              layer.blendMode === "normal" || (layer.blendMode === "linear-light" || layer.blendMode === "linear-burn") ? "source-over" : layer.blendMode;
            if (cache.draw(key, compositeSignature, targetContext)) continue;
          } finally { targetContext.restore(); }
        }
        const content = createCanvas(
          padded.width,
          padded.height,
          layer.kind === "group" && needsReadback(layer.children),
        );
        // Ordinary content already has the exact output geometry. Keep a separate
        // surface only when shadow/fill/Blend If needs another processing stage.
        const directContent = layer.kind !== "adjustment" && !shadow.enabled &&
          !style.blendIf.enabled && (layer.fillOpacity ?? 1) === 1;
        const result = directContent ? content : createCanvas(
          current.width,
          current.height,
          style.blendIf.enabled,
        );
        let occupied = layer.kind === "text" ? cache?.bounds(key, signature) : undefined;
        try {
          if (!cacheable || !cache?.read(key, signature, content)) {
            let textInk: ReturnType<typeof drawText>;
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
              await this.documentTone(layer,registry,assets,content,padded,world,options);
            } else if ((layer.kind === 'raster' || layer.kind === 'paint') && hasWetContent(layer)) {
              await drawNativeWetContent(layer, assets, content, padded, world, this.processor, options.isCancelled, options.cache === false ? undefined : this.brushTextures, nativeWetPreview);
            } else if (layer.kind === "raster") {
              const basis = contentSignature({ ...layer, erasures: [] });
              const previous = cache ? this.rasterPrefixes.get(key) : undefined;
              const erasures = layer.erasures ?? [];
              let start = 0;
              const reusable = previous && isImmutable(layer) && isImmutable(previous.layer) &&
                previous.basis === basis && (previous.layer.erasures?.length ?? 0) <= erasures.length &&
                (previous.layer.erasures ?? []).every((entry, i) => entry === erasures[i]) &&
                cache!.read(key, previous.signature, content);
              if (reusable) start = previous.layer.erasures?.length ?? 0;
              else await this.raster(layer, assets, content, padded, world);
              for (const entry of erasures.slice(start)) await drawPaint({ ...layer, kind: "paint", strokes: [entry.stroke] }, assets, content, padded, world.multiply(AffineTransform.scale(layer.width / entry.width, layer.height / entry.height)), this.processor, undefined, cache, canCache, undefined, options.isCancelled,options.cache===false?undefined:this.brushTextures);
              if (cache && canCache() && isImmutable(layer)) {
                this.rasterPrefixes.delete(key);
                this.rasterPrefixes.set(key, { layer, signature, basis });
                while (this.rasterPrefixes.size > 64)
                  this.rasterPrefixes.delete(this.rasterPrefixes.keys().next().value!);
              }
            }
            else if (layer.kind === "paint") {
              // A committed append can start from the retained, unstyled prefix.
              // Identity checks are safe only for immutable store-owned strokes.
              const basis = contentSignature({ ...layer, strokes: [] });
              const previous = cache ? this.paintPrefixes.get(key) : undefined;
              let start = 0;
              if (previous && isImmutable(layer) && isImmutable(previous.layer) &&
                  previous.basis === basis && previous.layer.strokes.length <= layer.strokes.length &&
                  previous.layer.strokes.every((stroke, i) => stroke === layer.strokes[i]) &&
                  cache!.read(key, previous.signature, content)) {
                start = previous.layer.strokes.length;
              }
              await drawPaint(
                start ? { ...layer, strokes: layer.strokes.slice(start) } : layer,
                assets,
                content,
                padded,
                world,
                this.processor,
                undefined,
                cache,
                canCache,
                undefined,
                options.isCancelled,
                options.cache===false?undefined:this.brushTextures,
              );
              if (cache && canCache() && isImmutable(layer)) {
                this.paintPrefixes.delete(key);
                this.paintPrefixes.set(key, { layer, signature, basis });
                while (this.paintPrefixes.size > 64)
                  this.paintPrefixes.delete(this.paintPrefixes.keys().next().value!);
              }
            }
            else if (layer.kind === "vector")
              drawVectors(layer, content, padded, world);
            else if (layer.kind === "text")
              textInk = drawText(layer, content, padded, world,
                !!cache && cacheable && isImmutable(layer));
            else if (layer.kind === "adjustment") {
              const c = content.getContext("2d")!;
              c.drawImage(target, haloX, haloY);
              if (layer.adjustment.kind === "patch") {
                const patch = layer.adjustment;
                const bitmap = assets.get(patch.assetId).bitmap;
                const patchTransform = renderTransform(padded, world);
                const corners = [
                  { x: 0, y: 0 }, { x: patch.width, y: 0 },
                  { x: 0, y: patch.height }, { x: patch.width, y: patch.height },
                ].map(point => patchTransform.point(point));
                // Keep the existing tile rasterization grid, but transfer only
                // affected pixels. Two output pixels cover interpolation edges.
                const left = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))) - 2);
                const top = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))) - 2);
                const right = Math.min(padded.width, Math.ceil(Math.max(...corners.map(p => p.x))) + 2);
                const bottom = Math.min(padded.height, Math.ceil(Math.max(...corners.map(p => p.y))) + 2);
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx),
                      height = Math.min(1024, padded.height - ty);
                    const x = Math.max(tx, left), y = Math.max(ty, top);
                    const affectedWidth = Math.min(tx + width, right) - x;
                    const affectedHeight = Math.min(ty + height, bottom) - y;
                    if (affectedWidth <= 0 || affectedHeight <= 0) continue;
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
                        x - tx,
                        y - ty,
                        affectedWidth,
                        affectedHeight,
                      ).data;
                      const backdrop = c.getImageData(x, y, affectedWidth, affectedHeight);
                      const pixels = await this.processor.blendAdjustment(
                        backdrop.data,
                        corrected,
                        corrected,
                        1,
                      );
                      const output = c.createImageData(affectedWidth, affectedHeight);
                      output.data.set(pixels);
                      c.putImageData(output, x, y);
                    } finally {
                      release(surface);
                    }
                  }
              } else if (layer.adjustment.kind === "tonal") {
                const backdrop = nodes.slice(0, nodes.indexOf(layer));
                const committed = layer.adjustment.strokes;
                const reusable = !externalBackdrop && !!cache && isImmutable(committed) &&
                  backdrop.every(node => isImmutable(node) && !affected.has(node.id));
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
                    const prefixKey = `${key}:tonal:${tx}:${ty}:${JSON.stringify(options.documentTransform)}`;
                    const previous = reusable ? this.tonalPrefixes.get(prefixKey) : undefined;
                    let pixels: Uint8ClampedArray = image.data;
                    let start = 0;
                    if (previous && previous.backdrop.length === backdrop.length &&
                        previous.backdrop.every((node, i) => node === backdrop[i]) &&
                        previous.strokes.length <= committed.length &&
                        previous.strokes.every((stroke, i) => stroke === committed[i])) {
                      const retained = cache!.readPixels(prefixKey, previous.signature);
                      if (retained) { pixels = retained; start = previous.strokes.length; }
                    }
                    for (const stroke of committed.slice(start))
                      pixels = await renderTonalStroke(pixels, stroke.brush, stroke,
                        tileSpace, this.processor, world,assets,options.cache===false?undefined:this.brushTextures,options.isCancelled);
                    if (reusable && canCache() && (!previous || start !== committed.length)) {
                      const signature = String(++this.tonalVersion);
                      cache!.writePixels(prefixKey, signature, pixels);
                      this.tonalPrefixes.delete(prefixKey);
                      this.tonalPrefixes.set(prefixKey, { backdrop, strokes: committed, signature });
                      while (this.tonalPrefixes.size > 64)
                        this.tonalPrefixes.delete(this.tonalPrefixes.keys().next().value!);
                    }
                    // A live preview must never become the retained committed prefix.
                    if (preview?.layerId === layer.id && preview.tonal)
                      pixels = await renderTonalStroke(pixels, preview.stroke, preview.tonal,
                        tileSpace, this.processor, world,assets,options.cache===false?undefined:this.brushTextures,options.isCancelled);
                    image.data.set(pixels);
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "lut") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx), height = Math.min(1024, padded.height - ty);
                    const image = c.getImageData(tx, ty, width, height);
                    image.data.set(await this.processor.lookup(image.data, layer.adjustment));
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "white-balance") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx), height = Math.min(1024, padded.height - ty);
                    const image = c.getImageData(tx, ty, width, height);
                    image.data.set(await this.processor.whiteBalance(image.data, layer.adjustment));
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "red-eye") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx), height = Math.min(1024, padded.height - ty);
                    checkRenderCurrent(options.isCancelled);
                    const image = c.getImageData(tx, ty, width, height);
                    image.data.set(await this.processor.redEye(image.data, layer.adjustment));
                    checkRenderCurrent(options.isCancelled);
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "gradient-map") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024, padded.width - tx), height = Math.min(1024, padded.height - ty);
                    const image = c.getImageData(tx, ty, width, height);
                    image.data.set(await this.processor.gradientMap(image.data, layer.adjustment));
                    c.putImageData(image, tx, ty);
                  }
              } else if (layer.adjustment.kind === "color-balance" || layer.adjustment.kind === "vibrance") {
                for (let ty = 0; ty < padded.height; ty += 1024)
                  for (let tx = 0; tx < padded.width; tx += 1024) {
                    const width = Math.min(1024,padded.width-tx), height = Math.min(1024,padded.height-ty);
                    const image = c.getImageData(tx,ty,width,height);
                    image.data.set(await this.processor.chromatic(image.data,layer.adjustment));
                    c.putImageData(image,tx,ty);
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
            // Mutable command previews are short-lived. Retaining their transformed
            // raw surface copies pixels and evicts reusable committed layers.
            if (cacheable && isImmutable(layer) && canCache()) {
              const bounds = layer.kind === "raster"
                ? [localBounds(layer)!]
                : layer.kind === "paint" ? layer.strokes.map(strokeBounds)
                : layer.kind === "text" && textInk ? [textInk] : null;
              if (bounds) {
                const placement = renderTransform(padded, world);
                const boxes = bounds.map(bound => placement.bounds(bound));
                if (boxes.length) {
                  const x = Math.floor(Math.min(...boxes.map(box => box.x))) - 2;
                  const y = Math.floor(Math.min(...boxes.map(box => box.y))) - 2;
                  const right = Math.ceil(Math.max(...boxes.map(box => box.x + box.width))) + 2;
                  const bottom = Math.ceil(Math.max(...boxes.map(box => box.y + box.height))) + 2;
                  occupied = { x, y, width: right-x, height: bottom-y };
                } else occupied = { x: 0, y: 0, width: 0, height: 0 };
              }
              cache?.write(key, signature, content, layer.kind === "paint" ? 64 : 1, occupied);
            }
          }
          if (
            !nativeWetPreview &&
            (layer.kind === "paint" || (layer.kind === "raster" && preview?.stroke.kind === "eraser")) &&
            !preview?.maskMode &&
            layer.id === preview?.layerId
          ) {
            await drawPaint(
              { ...layer, kind: "paint", strokes: [preview.stroke] },
              assets,
              content,
              padded,
              world,
              this.processor,
              cache && canCache() ? this.activeStroke : undefined,
              canCache() ? cache : undefined,
              canCache,
              preview.cloneSource,
              options.isCancelled,
              options.cache===false?undefined:this.brushTextures,
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
                options.isCancelled,
              );
              if (canCache()) cache?.write(maskKey, maskSignature, mask);
            }
            try {
              applyMaskSettings(mask,maskData);
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
          // During gestures, promote unchanged overlay layers to finished
          // pixels in the SAME cache slot. Retaining both forms would thrash the
          // shared byte budget on modest multi-layer documents. The active layer
          // keeps its raw prefix; a later style change can rebuild cold content.
          // Text can also promote on ordinary edits: it has no stroke prefix to
          // preserve, and otherwise rebuilds every overlay on each keystroke.
          if ((preview || (layer.kind === "text" && isImmutable(layer))) &&
              rawComposite && style.colorOverlay.enabled && canCache())
            cache?.write(key, compositeSignature, content, 1,
              layer.kind === "text" ? occupied : undefined);
          if (layer.kind === "adjustment") {
            try {
              const directPatch = layer.adjustment.kind === "patch" &&
                layer.opacity === 1 && (layer.fillOpacity ?? 1) === 1 &&
                layer.blendMode === "normal" && !maskCanvas &&
                !style.blendIf.enabled && !style.colorOverlay.enabled &&
                !shadow.enabled;
              if (directPatch) {
                // Patch correction already preserves the backdrop alpha. At
                // full strength this is the completed composite, so avoid a
                // second full-canvas readback and worker interpolation pass.
                targetContext.save();
                try {
                  targetContext.globalAlpha = 1;
                  targetContext.globalCompositeOperation = "copy";
                  targetContext.drawImage(content, haloX, haloY,
                    current.width, current.height, 0, 0,
                    current.width, current.height);
                } finally {
                  targetContext.restore();
                }
                if (retainPatch && canCache()) {
                  cache!.write(patchKey, "completed", target);
                  this.patchPrefixes.delete(patchKey);
                  this.patchPrefixes.set(patchKey, { layer, backdrop: patchBackdrop });
                  while (this.patchPrefixes.size > 64)
                    this.patchPrefixes.delete(this.patchPrefixes.keys().next().value!);
                }
              } else for (let ty = 0; ty < current.height; ty += 1024)
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
            if (!directContent) {
              r.globalAlpha = layer.fillOpacity ?? 1;
              r.drawImage(content, -haloX, -haloY);
              r.globalAlpha = 1;
            }
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
            // Retain the completed appearance in the raw slot, sharing the
            // same bounded budget rather than keeping duplicate full surfaces.
            if (finishedStyle && canCache()) {
              let finishedBounds: typeof occupied;
              if (layer.kind === "text" && occupied) {
                // Raw coverage uses padded coordinates; the completed appearance
                // is on the current output grid. Masks/overlays cannot expand ink.
                const blur = shadow.enabled ? shadow.blur * 3 * Math.max(current.sx, current.sy) : 0;
                const dx = shadow.enabled ? shadow.x * current.sx : 0;
                const dy = shadow.enabled ? shadow.y * current.sy : 0;
                const x = Math.floor(occupied.x - haloX + Math.min(0, dx - blur)) - 2;
                const y = Math.floor(occupied.y - haloY + Math.min(0, dy - blur)) - 2;
                const right = Math.ceil(occupied.x + occupied.width - haloX + Math.max(0, dx + blur)) + 2;
                const bottom = Math.ceil(occupied.y + occupied.height - haloY + Math.max(0, dy + blur)) + 2;
                finishedBounds = { x, y, width: right - x, height: bottom - y };
              }
              cache!.write(key, finishedSignature, result, 1, finishedBounds);
            }
            if ((layer.blendMode === "linear-light" || layer.blendMode === "linear-burn") && isolated !== layer) {
              for(let ty=0;ty<current.height;ty+=1024)for(let tx=0;tx<current.width;tx+=1024){
                checkRenderCurrent(options.isCancelled);
                const w=Math.min(1024,current.width-tx),h=Math.min(1024,current.height-ty);
                const image=targetContext.getImageData(tx,ty,w,h);
                image.data.set(await this.processor.linearBlend(r.getImageData(tx,ty,w,h).data,image.data,layer.opacity,layer.blendMode));
                checkRenderCurrent(options.isCancelled);targetContext.putImageData(image,tx,ty);
              }
            } else {
              targetContext.save();
              targetContext.globalAlpha = isolated === layer ? 1 : layer.opacity;
              targetContext.globalCompositeOperation = layer.blendMode === "normal" || (layer.blendMode === "linear-light" || layer.blendMode === "linear-burn") ? "source-over" : layer.blendMode;
              targetContext.drawImage(result, 0, 0);targetContext.restore();
            }
          }
        } finally {
          release(content);
          if (result !== content) release(result);
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
      checkRenderCurrent(options.isCancelled);
      return output;
    } catch (error) {
      release(output);
      throw error;
    } finally {
      ownedFrequencyScratch?.clear();
    }
  }
  /** End in-flight view work while retaining document/asset-scoped pixels. */
  resetView() {
    this.epoch++;
    this.filterTiles.clear();
    this.maskPaint.clear();
    this.activeStroke.clear();
    this.brushTextures.clear();
  }
  clearCache() {
    this.resetView();
    this.cache.clear();
    this.signatures = new WeakMap();
    this.styledIds = new WeakMap();
    this.paintPrefixes.clear();
    this.rasterPrefixes.clear();
    this.tonalPrefixes.clear();
    this.patchPrefixes.clear();
  }
  dispose() {
    this.fonts?.removeEventListener("loadingdone", this.fontsChanged);
    this.fonts?.removeEventListener("loadingerror", this.fontsChanged);
    this.clearCache();
    this.processor.dispose();
  }
}
