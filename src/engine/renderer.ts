import {capturePerspectiveMask} from './projective-mask';
import {nativeVectorFootprint} from './native-vector-footprint';
import{isFloatDocument}from'../core/float-document';
import{FloatSceneRenderer,type CapturedFloatScene,type FloatSceneControl}from'./float-scene';
import {clippingStacks} from '../core/clipping';
import {composeClippingStack} from './clipping';
import {usesNativeTextWriting,isVerticalText} from '../core/text-writing';
import {nativeToneSamplingGrid} from './smart-filter-grid';
import {prepareStyledTextParagraph} from './styled-text-layout';
import {characterInputForLayer} from '../core/character-layout';
import {subscribeNativeFontChanges} from '../fonts/native-events';
import {canonicalCellOffset} from './canvas';
import {drawProjectedBitmap,bitmapProjectionRequiresPrecision} from './bitmap-projection';
import {NativeCanvasGrid} from './native-canvas-grid';
import {pixelWorkGrid, nativeSamplingGrid} from './pixel-work-grid';
import {projectNativeMask} from "./projected-mask";
import {frequencyIdentitySource,nativeFrequencyRasterSource} from './frequency-identity';
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
import { smartFilterHalo, isActiveSmartFilter } from "../core/smart/filters";
import type { SmartObjectInstanceData } from "../core/smart/types";
import { createDocument, createRaster } from "../core/model";
import { ComponentRegistry } from "../core/smart/manager";
import { resolveSmartDocument } from "../core/smart/resolve";
import type { DodgeBurnOptions } from "../core/retouch/types";
import { renderTonalStroke, renderRetouchCoverage } from "./retouch";
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
  /** Viewport-only. Native render/export caches remain in sRGB8. */
  colorProof?: import('../core/color/color-settings').ColorProof | null;
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
  /** Shared by recursive layers and native tiles for input/cancellation. */
  taskBudget?:{deadline:number};
  componentDepth?: number;
  /** Internal basis for isolated GPU reference rendering; never serialized. */
  rootTransform?: AffineTransform;
  /** Source document plane when rendering through a sampling transform. */
  documentTransform?: AffineTransform;
}
export interface DocumentRenderer {
  captureFloatScene?(document:DocumentData,assets:AssetStore,control?:FloatSceneControl):Promise<CapturedFloatScene>;
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
  private readonly floatScene=new FloatSceneRenderer(this.processor);
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
  private maskSourceIds=new WeakMap<object,number>();
  private nextMaskSourceId=0;
  private epoch = 0;
  private readonly fonts =
    typeof globalThis.document === "undefined"
      ? undefined
      : globalThis.document.fonts;
  private readonly fontsChanged = () => this.clearCache();
  private readonly stopOwnedFonts=subscribeNativeFontChanges(this.fonts,this.fontsChanged);
  constructor() {
    this.fonts?.addEventListener("loadingdone", this.fontsChanged);
    this.fonts?.addEventListener("loadingerror", this.fontsChanged);
  }

  private floatPreview(document:DocumentData,preview?:PaintPreview|null):DocumentData{
    if(!preview)return document;
    if(!preview.maskMode){
      if(preview.tonal){
        let found=false;
        const visit=(layers:LayerData[]):LayerData[]=>layers.map(layer=>{
          if(layer.id===preview.layerId){
            if(layer.kind!=='adjustment'||layer.adjustment.kind!=='tonal')throw new Error('Float tonal preview requires a tonal adjustment layer.');
            found=true;return{...layer,adjustment:{...layer.adjustment,strokes:[...layer.adjustment.strokes,{brush:preview.stroke,...preview.tonal!}]}};
          }
          return layer.kind==='group'?{...layer,children:visit(layer.children)}:layer;
        });
        const children=visit(document.children);if(!found)throw new Error('Float tonal preview target is unavailable.');return{...document,children};
      }
      if(preview.stroke.kind!=='eraser')throw new Error('Color painting requires its float document integration.');
      let found=false;
      const visit=(layers:LayerData[]):LayerData[]=>layers.map(layer=>{
        if(layer.id===preview.layerId){if(layer.kind!=='raster')throw new Error('Float eraser preview requires an original raster layer.');found=true;return{...layer,erasures:[...(layer.erasures??[]),{width:layer.width,height:layer.height,stroke:preview.stroke}]};}
        return layer.kind==='group'?{...layer,children:visit(layer.children)}:layer;
      });
      const children=visit(document.children);if(!found)throw new Error('Float eraser preview target is unavailable.');return{...document,children};
    }
    const visit=(layers:LayerData[]):LayerData[]=>layers.map(layer=>layer.kind==='group'?{...layer,mask:previewMask(layer,preview),children:visit(layer.children)}:{...layer,mask:previewMask(layer,preview)});
    return{...document,children:visit(document.children)};
  }
  private floatMasks(assets:AssetStore,isCancelled?:()=>boolean):import('./float-scene').FloatMaskService{
    return async(mask,space,world,check)=>{
      check();const origin=world.point({x:0,y:0}),canvas=await this.renderMaskCoverage(mask,space,origin.x,origin.y,'float-mask',false,world,assets,()=>{check();return!!isCancelled?.();});
      try{check();applyMaskSettings(canvas,mask);const bytes=canvas.getContext('2d')!.getImageData(0,0,space.width,space.height).data,coverage=new Float32Array(space.width*space.height);for(let i=0;i<coverage.length;i++)coverage[i]=bytes[i*4+3]/255;check();return coverage;}finally{release(canvas);}
    };
  }
  private floatStrokes(assets:AssetStore,isCancelled?:()=>boolean):import('./float-scene').FloatStrokeService{
    return async(brush,space,world,check)=>{
      check();const bytes=await renderRetouchCoverage(brush,space,this.processor,world,assets,this.brushTextures,()=>{check();return!!isCancelled?.();});check();
      const coverage=new Float32Array(bytes.length);for(let i=0;i<bytes.length;i++)coverage[i]=bytes[i]/255;return coverage;
    };
  }
  async captureFloatScene(document:DocumentData,assets:AssetStore,control:FloatSceneControl={}):Promise<CapturedFloatScene>{
    if(!isFloatDocument(document))throw new Error('Native float scene output requires a float32 linear-sRGB document.');
    return this.floatScene.capture(document,assets,this.floatMasks(assets,control.isCancelled),control,this.floatStrokes(assets,control.isCancelled));
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

  /** Trusted read-only capture; callers own its lifetime across awaited reads. */
  capturePerspectiveMask(mask:LayerMaskData,options:import('./projective-mask').PerspectiveMaskOptions,assets:AssetStore,control:import('./float-projection').FloatProjectionControl={}){
    const epoch=this.epoch,isCancelled=control.isCancelled;
    return capturePerspectiveMask(mask,options,assets,this.processor,{...control,isCancelled:()=>{if(this.epoch!==epoch)throw new Error('Perspective mask renderer was cleared.');return!!isCancelled?.();}},this.brushTextures);
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
    const epoch = this.epoch,lifetime=assets?.captureLifetime();
    const source=mask.kind==='bitmap'&&assets?.has(mask.assetId)?assets.get(mask.assetId):undefined;
    const bitmap=source?.bitmap;
    if(bitmap){let identity=this.maskSourceIds.get(bitmap);if(identity===undefined)this.maskSourceIds.set(bitmap,identity=++this.nextMaskSourceId);key+=`:source:${identity}:${bitmap.width}:${bitmap.height}`;}
    const check=()=>{checkRenderCurrent(isCancelled);lifetime?.();if(source&&(!assets!.has(source.id)||assets!.get(source.id)!==source||source.bitmap!==bitmap))throw new Error('Mask source changed during projection.');return false;};
    check();const output=await maskCoverage(
      mask,space,x,y,this.processor,
      retain?{paint:this.maskPaint,key,canCache:()=>{check();return this.epoch===epoch;}}:undefined,
      world,bitmap,assets,retain?this.brushTextures:undefined,check,
    );
    try{check();return output;}catch(error){release(output);throw error;}
  }

  private async raster(
    layer: RasterLayerData,
    assets: AssetStore,
    target: HTMLCanvasElement,
    space: RenderSpace,
    world: AffineTransform,
    isCancelled?:()=>boolean,
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
    const mapping=placement.multiply(AffineTransform.scale(layer.width/asset.width,layer.height/asset.height)),bitmap=asset.bitmap,lifetime=assets.captureLifetime();
    const checkSource=()=>{lifetime();checkRenderCurrent(isCancelled);if(!assets.has(asset.id)||assets.get(asset.id)!==asset||asset.bitmap!==bitmap)throw new Error('Raster source changed during projection.');};
    const draw = (target: CanvasRenderingContext2D, tileX = 0, tileY = 0) => {
      checkSource();
      const matrix=AffineTransform.translation(-tileX,-tileY).multiply(mapping);
      if(bitmapProjectionRequiresPrecision(matrix,asset.width,asset.height))return drawProjectedBitmap(target,bitmap,matrix,{isCancelled:()=>{checkSource();return false;}});
      if(matrix.a===1&&matrix.b===0&&matrix.c===0&&matrix.d===1&&Number.isSafeInteger(matrix.e)&&Number.isSafeInteger(matrix.f)){
        target.save();try{target.setTransform(placement.a,placement.b,placement.c,placement.d,placement.e-tileX,placement.f-tileY);target.drawImage(bitmap,0,0,layer.width,layer.height);}finally{target.restore();}return;
      }
      const local={...space,x:space.x+tileX/space.sx,y:space.y+tileY/space.sy,width:target.canvas.width,height:target.canvas.height},grid=new NativeCanvasGrid(target,local,matrix.bounds({x:0,y:0,width:asset.width,height:asset.height}));
      try{for(const cell of grid.cells()){
        checkSource();const c=grid.canvas.getContext('2d')!,m=renderTransform(cell.space,world);c.save();try{c.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);c.drawImage(bitmap,0,0,layer.width,layer.height);}finally{c.restore();}grid.present(cell);
      }}finally{grid.dispose();}
    };
    if (!effects.length) {
      const drawing=draw(context);if(drawing)await drawing;checkSource();
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
          const drawing=draw(c,tx,ty);if(drawing)await drawing;
          const pixels = await this.processor.process(
            c.getImageData(0, 0, tile.width, tile.height).data,
            effects,
          );
          checkSource();
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
    const lastNative=filters.filter(isActiveSmartFilter).at(-1);
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
    const canonicalSampling=placement.a!==1||placement.b!==0||placement.c!==0||placement.d!==1||!Number.isSafeInteger(placement.e)||!Number.isSafeInteger(placement.f);
    // A unit native frequency plane can cover the outer tile's two-pixel
    // overscan in one request. Keep affine sampling and large-halo budgets on
    // the established grid; source/document resolution is independent.
    const nativeFrequency = filters.length===1 && (filters[0].kind==='frequency-band' ||
      (filters[0].kind==='native-composition' && frequencyIdentity!==null)) &&
      placement.a===1 && placement.b===0 && placement.c===0 && placement.d===1 &&
      Number.isSafeInteger(placement.e) && Number.isSafeInteger(placement.f);
    const samplingHalo=filters[0]?.kind==='native-composition'&&frequencyIdentity?Math.max(halo,frequencyIdentity.samplingHalo):halo;
    const paddedEdge=512+4+2*samplingHalo;
    // A native band over one literal raster can absorb its parent's composition
    // overscan in one request. Full projection/appearance graphs keep their
    // existing sampling grid; halo budgets still precede every allocation.
    const nativeBandOverscan=nativeFrequency&&filters[0].kind==='frequency-band'&&!filterMask&&nativeFrequencyRasterSource(master,assets)!==null;
    const bandPaddedEdge=1024+4+2*samplingHalo;
    const tileLimit=nativeFrequency && paddedEdge<=8192 && paddedEdge*paddedEdge<=4_000_000
      ?nativeBandOverscan&&bandPaddedEdge<=8192&&bandPaddedEdge*bandPaddedEdge<=4_000_000?1024:512:256;
    // Full resampling cells include rounding, overscan and the cumulative
    // filter halo inside the established 4 MP sampling allocation budget.
    const canonicalLimit=canonicalSampling?Math.floor((1994-2*halo)/nativePerPixel):Infinity;
    const step = Math.max(1, Math.min(tileLimit, Math.floor((nativeBandOverscan?tileLimit:512) / nativePerPixel),canonicalLimit));
    // Rectangular native requests avoid repeatedly processing the halo of a
    // narrow export strip. Composition includes both nested projection margins.
    const coalesce = nativeBandOverscan ||
      (nativeFrequency && filters[0].kind === 'native-composition' && frequencyIdentity !== null);
    const grid = nativeToneSamplingGrid(target.width,target.height,placement,filters,mask?filterMask?.feather??0:0) ?? (coalesce
      ? nativeSamplingGrid(target.width, target.height, step, samplingHalo, filters[0].kind === 'native-composition' ? 8 : 4)
      : {columns: step, rows: step});
    const context = target.getContext("2d")!;
    for (let ty = canonicalSampling?canonicalCellOffset(space.y,space.sy,grid.rows):0; ty < target.height; ty += grid.rows)
      for (let tx = canonicalSampling?canonicalCellOffset(space.x,space.sx,grid.columns):0; tx < target.width; tx += grid.columns) {
        if(options.taskBudget && performance.now()>=options.taskBudget.deadline){
          await yieldTask();
          options.taskBudget.deadline=performance.now()+8;
        }
        checkRenderCurrent(options.isCancelled);
        const width = canonicalSampling?grid.columns:Math.min(grid.columns, target.width - tx),
          height = canonicalSampling?grid.rows:Math.min(grid.rows, target.height - ty);
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
            !nativeFrame && !bitmapProjectionRequiresPrecision(placement,tileRegion.width,tileRegion.height) && drawCompletedFilterTile(
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
          const drawSampled=(bitmap:HTMLCanvasElement,sourceX:number,sourceY:number)=>{
            if(bitmapProjectionRequiresPrecision(placement,bitmap.width,bitmap.height))return drawProjectedBitmap(context,bitmap,placement.multiply(AffineTransform.translation(sourceX,sourceY)),{isCancelled:options.isCancelled});
            if(!canonicalSampling){context.drawImage(bitmap,sourceX,sourceY);return;}
            const nativeGrid=new NativeCanvasGrid(context,space);
            try{for(const cell of nativeGrid.cells({x:tx,y:ty,width,height})){
              checkRenderCurrent(options.isCancelled);const c=nativeGrid.canvas.getContext('2d')!,m=renderTransform(cell.space,nativeWorld);c.save();try{c.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);c.drawImage(bitmap,sourceX,sourceY);}finally{c.restore();}nativeGrid.present(cell);
            }}finally{nativeGrid.dispose();}
          };
          try {
            if(nativeFrame){
              const left=Math.max(0,tile.x),top=Math.max(0,tile.y),right=Math.min(master.width,tile.x+tile.canvas.width),bottom=Math.min(master.height,tile.y+tile.canvas.height);
              if(right>left&&bottom>top){
                if(left===tile.x&&top===tile.y&&right===tile.x+tile.canvas.width&&bottom===tile.y+tile.canvas.height){const drawing=drawSampled(tile.canvas,tile.x,tile.y);if(drawing)await drawing;}
                else {
                  // Use the actual image boundary, preserving Canvas edge-clamp sampling
                  // and geometric antialiasing instead of interpolating into padded transparency.
                  const edge=createCanvas(right-left,bottom-top,true);
                  try{edge.getContext('2d')!.drawImage(tile.canvas,left-tile.x,top-tile.y,right-left,bottom-top,0,0,right-left,bottom-top);const drawing=drawSampled(edge,left,top);if(drawing)await drawing;}
                  finally{release(edge);}
                }
              }
            }else {const drawing=drawSampled(tile.canvas,tile.x,tile.y);if(drawing)await drawing;}
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
    if(isFloatDocument(document)){
      const sizeRegion=options.region??{x:0,y:0,width:document.width,height:document.height},size=workingSize(options.outputSize?.width??sizeRegion.width,options.outputSize?.height??sizeRegion.height,options.outputSize?1:options.scale,options.maxPixels,options.maxDimension);
      return this.floatScene.render(this.floatPreview(document,options.paintPreview),assets,this.floatMasks(assets,options.isCancelled),{region:sizeRegion,...size,rootTransform:options.rootTransform},{isCancelled:options.isCancelled},options.readback,options.colorProof,options.cache!==false,this.floatStrokes(assets,options.isCancelled));
    }
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
      clippingMembers = false,
    ) => {
      const targetContext = target.getContext("2d")!;
      const stacks=clippingMembers?nodes.map(base=>({base,layers:[]as LayerData[]})):clippingStacks(nodes);
      for (const stack of stacks) {
        // Promise continuations between layers do not let input tasks run. Share
        // the native-tile budget through groups and bounded layer recursion too.
        if (options.taskBudget && performance.now() >= options.taskBudget.deadline) {
          await yieldTask();
          options.taskBudget.deadline = performance.now() + 8;
        }
        checkRenderCurrent(options.isCancelled);
        const clipped=stack.layers.filter(node=>node.visible&&node.opacity>0);
        // A group used as a clipping base needs intrinsic transparency rather
        // than a copy of the external sibling backdrop.
        const layer=clipped.length&&stack.base.kind==='group'&&stack.base.blendMode==='pass-through'
          ? {...stack.base,blendMode:'normal' as const}:stack.base;
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
        if (!clipped.length && cache && isolated !== layer && !affected.has(layer.id) &&
            (layer.kind === "raster" || layer.kind === "text" || layer.kind === "vector" ||
              (layer.kind === "paint" && layer.strokes.every(stroke => stroke.kind === "fill" && !stroke.clip))) &&
            layer.blendMode === "normal" && (layer.fillOpacity ?? 1) === 1 &&
            !style.blendIf.enabled) {
          const placement = renderTransform(current, world);
          const ink = layer.kind === "text" && layer.textPath===undefined&&layer.characterRanges===undefined&&!usesNativeTextWriting(layer) ? measureTextInk(layer) : undefined;
          const vectorInk=layer.kind==='vector'?nativeVectorFootprint(layer):undefined;
          const bounds = layer.kind === "raster"
            ? [localBounds(layer)!]
            : layer.kind==='vector'?vectorInk?[vectorInk]:[]
            : layer.kind === "paint" ? layer.strokes.map(strokeBounds)
            : ink ? [ink] : undefined;
          // Cold plain text needs the same bounded working area as shadows;
          // retaining compact pixels after full-surface drawing is too late.
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
                await paint([layer],surface,bounded,parent,layer,externalBackdrop,clippingMembers);
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

        const finishedStyle = !clipped.length && layer.blendMode !== "linear-light" && layer.blendMode !== "linear-burn" && !!cache && cacheable && isImmutable(layer) &&
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
        const rawComposite = !clipped.length && layer.blendMode !== "linear-light" && layer.blendMode !== "linear-burn" && cacheable && !affected.has(layer.id) &&
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
          clipped.length>0 || layer.kind === "group" && needsReadback(layer.children),
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
        let occupied = layer.kind === "text" || layer.kind === "vector" ? cache?.bounds(key, signature) : undefined;
        let clippingCoverage:HTMLCanvasElement|undefined;
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
              else await this.raster(layer, assets, content, padded, world,options.isCancelled);
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
            else if (layer.kind === "text") {
              if(layer.characterRanges!==undefined||layer.textPath!==undefined||usesNativeTextWriting(layer)){
                const t=renderTransform(padded,world),surface=await prepareStyledTextParagraph({...characterInputForLayer(layer),width:content.width,height:content.height,alignmentWidth:isVerticalText(layer)&&!layer.textPath?layer.textInlineExtent:layer.width,transform:[t.a,t.b,t.c,t.d,t.e,t.f]},document,assets,{isCancelled:options.isCancelled});
                try{surface.check();content.getContext('2d')!.drawImage(surface.bitmap,0,0);textInk=surface.layout.ink;}finally{surface.release();}
              }else textInk = drawText(layer, content, padded, world,!!cache && cacheable && isImmutable(layer));
            }
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
                      if(bitmapProjectionRequiresPrecision(m,patch.width,patch.height))await drawProjectedBitmap(context,bitmap,m.multiply(AffineTransform.scale(patch.width/bitmap.width,patch.height/bitmap.height)),{isCancelled:options.isCancelled});
                      else context.drawImage(bitmap,0,0,patch.width,patch.height);
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
              const vectorInk=layer.kind==='vector'?nativeVectorFootprint(layer):undefined;
              const bounds = layer.kind === "raster"
                ? [localBounds(layer)!]
                : layer.kind==='vector'?vectorInk?[vectorInk]:[]
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
          if(clipped.length)clippingCoverage=await composeClippingStack(content,layer.fillOpacity??1,
            colorPlane=>paint(clipped,colorPlane,padded,parent,undefined,true,true),options.isCancelled);
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
                if(clippingCoverage){const coverage=clippingCoverage.getContext('2d')!;coverage.save();try{coverage.globalCompositeOperation='destination-in';coverage.drawImage(mask,0,0);}finally{coverage.restore();}}
              }
            } finally {
              release(mask);
            }
          }
          if (shadow.enabled && shadow.opacity > 0) {
            const silhouette = createCanvas(padded.width, padded.height);
            const s = silhouette.getContext("2d")!;
            try {
              s.drawImage(clippingCoverage??content, 0, 0);
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
          if ((preview || ((layer.kind === "text" || layer.kind === "vector") && isImmutable(layer))) &&
              rawComposite && style.colorOverlay.enabled && canCache())
            cache?.write(key, compositeSignature, content, 1,
              layer.kind === "text" || layer.kind === "vector" ? occupied : undefined);
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
              r.globalAlpha = clipped.length?1:layer.fillOpacity ?? 1;
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
              if ((layer.kind === "text" || layer.kind === "vector") && occupied) {
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
              const grid = pixelWorkGrid(current.width, current.height);
              for (let ty = 0; ty < current.height; ty += grid.rows)
                for (let tx = 0; tx < current.width; tx += grid.columns) {
                  checkRenderCurrent(options.isCancelled);
                  const w = Math.min(grid.columns, current.width - tx), h = Math.min(grid.rows, current.height - ty);
                  const image = targetContext.getImageData(tx, ty, w, h);
                  image.data.set(await this.processor.linearBlend(r.getImageData(tx, ty, w, h).data, image.data, layer.opacity, layer.blendMode));
                  checkRenderCurrent(options.isCancelled);
                  targetContext.putImageData(image, tx, ty);
                }
            } else {
              targetContext.save();
              targetContext.globalAlpha = isolated === layer ? 1 : layer.opacity;
              targetContext.globalCompositeOperation = layer.blendMode === "normal" || (layer.blendMode === "linear-light" || layer.blendMode === "linear-burn") ? "source-over" : layer.blendMode;
              targetContext.drawImage(result, 0, 0);targetContext.restore();
            }
          }
        } finally {
          if(clippingCoverage)release(clippingCoverage);
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
    this.brushTextures.retireCache();
  }
  clearCache() {
    this.floatScene.clear();
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
    this.floatScene.dispose();
    this.stopOwnedFonts();
    this.fonts?.removeEventListener("loadingdone", this.fontsChanged);
    this.fonts?.removeEventListener("loadingerror", this.fontsChanged);
    this.clearCache();
    this.brushTextures.dispose();
    this.processor.dispose();
  }
}
