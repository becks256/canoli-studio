import{FloatPixelProcessor,validateFloatWorkerWindow,type FloatCompositeOptions,type FloatToneOptions}from'./float-pixels';
import type { RedEyeAdjustmentData } from "../core/red-eye";
import type { LutAdjustmentData } from "../core/lut";
import type { TextureMaskSettings } from '../core/brush-texture';
import type { WetPaintLoadSettings, WetPaintMixSettings } from '../core/wet-paint';
import { loadWetPaint, mixWetPaint } from './wet-paint';
import { prepareBrushTexture } from './wasm';
import type { ColorRangeSettings } from "../core/color-range";
import type { WhiteBalanceAdjustmentData } from "../core/white-balance";
import type { GradientMapAdjustmentData } from "../core/gradient-map";
import { featherRegion } from "./feather-region";
import { modifySelectionCoverage } from "./selection-modification";
import { composeChannelSelection } from './channel-selection';
import { growQuickSelection } from './quick-selection';
import { selectNativeSubject } from './subject-selection';
import type { SubjectRequest } from '../core/subject-selection';
import {prepareMattingTile,refineMattingTile,type MattingTileRequest} from './matting-tile';
import {wasmMattingIterations} from './matting-iterations';
import {ClosedFormMatting} from '../intelligence/matting/closed-form';
import type { QuickSelectionRequest } from '../core/quick-selection';
import type { ChannelCoverageRequest } from '../core/alpha-channels';
import type { SelectionModificationRequest } from "../core/selection-modification";
import { encodeCapturedPng } from "./png";
import { prepareClipboard, type ClipboardRequest } from "./clipboard";
import { encodeCoverage, wandCoverage, type CoverageRequest } from "../core/pixel-selection";
import { applyEncodedFrequencyBand, applyLinearBlend, applyRedEye, applyHsl, applyChromatic, applyGradientMap, applyWhiteBalance, applyLookup, applyColorRange } from "./wasm";
import type { ChromaticAdjustmentData } from "../core/adjustments";
import type { HslAdjustmentData } from "../core/adjustments";
import type { SpatialFilterOptions } from "../core/smart/spatial-filter";
import type {BilateralFilterOptions} from '../core/smart/bilateral-filter';
import {
  findRetouchDonor,
  type DonorSearchOptions,
} from "../core/retouch/donor";
import { applyDodgeBurn } from "../core/retouch/dodgeBurn";
import { poissonBlend } from "../core/retouch/poisson";
import type { PoissonBlendOptions } from "../core/retouch/types";
import type { DodgeBurnOptions } from "../core/retouch/types";
import {
  applySpatialFilter,
  applyMedianFilter,
  applyBilateralFilter,
  featherAlpha,
  applyBlendIf,
  applyTone,
  applyLut,
  blendAdjustment,
  mixFiltered,
  computeWasmHistogram,
  instantiateKernel,
  wasmPoissonSolver,
  wasmDonorValidity,
  renderSelection,
} from "./wasm";
import type { SelectionTile, FeatherTile } from "./wasm";
import type { BlendIfData } from "../core/drawing";
import type { ToneEffectData } from "../core/model";

const kernel = fetch(`${import.meta.env.BASE_URL}wasm/pixels.wasm`)
  .then((response) => {
    if (!response.ok)
      throw new Error(
        "Could not load the WASM module. Run npm run build:wasm.",
      );
    return response.arrayBuffer();
  })
  .then(instantiateKernel);

kernel
  .then(() => self.postMessage({ type: "ready" }))
  .catch((error: Error) =>
    self.postMessage({ type: "fatal", error: error.message }),
  );

let matting:ClosedFormMatting|undefined;
let floating:FloatPixelProcessor|undefined;
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    pixels: Uint8ClampedArray;
    floatComposite?:{source:Float32Array;backdrop:Float32Array;options:FloatCompositeOptions};
    floatAffine?:{pixels:Float32Array;matrix:number[]};
    floatTone?:{pixels:Float32Array;options:FloatToneOptions};
    filteredMix?: {
      filtered: Uint8ClampedArray;
      mask: Uint8ClampedArray;
      density: number;
      inverted: boolean;
    };
    spatialFilter?: {
      width: number;
      height: number;
      options: SpatialFilterOptions;
    };
    medianFilter?: {width:number;height:number;radius:number};
    bilateralFilter?: {width:number;height:number;options:BilateralFilterOptions};
    donorSearch?: {
      width: number;
      height: number;
      coverage: Uint8Array | Uint8ClampedArray;
      options: DonorSearchOptions;
    };
    poisson?: {
      donor: Uint8ClampedArray;
      width: number;
      height: number;
      coverage: Uint8Array | Uint8ClampedArray;
      options: PoissonBlendOptions;
    };
    dodgeBurn?: {
      width: number;
      height: number;
      options: DodgeBurnOptions;
      coverage?: Uint8Array | Uint8ClampedArray;
    };
    hsl?: HslAdjustmentData;
    chromatic?: ChromaticAdjustmentData;
    frequencyEncoding?: {low:Uint8ClampedArray;band:"high"|"correction"};
    linearBlend?: { backdrop: Uint8ClampedArray; opacity: number; mode: "linear-light" | "linear-burn" };
    redEye?: RedEyeAdjustmentData;
    gradientMap?: GradientMapAdjustmentData;
    whiteBalance?: WhiteBalanceAdjustmentData;
    lookup?: LutAdjustmentData;
    colorRange?:ColorRangeSettings;
    brushTexture?: TextureMaskSettings;
    brushTextureSupport?:Uint8ClampedArray;
    wetPaintLoad?:WetPaintLoadSettings;
    wetPaintMix?:{carried:Float32Array;coverage:Uint8Array;settings:WetPaintMixSettings};
    effects?: ToneEffectData[];
    underlying?: Uint8ClampedArray;
    blend?: BlendIfData;
    featheredSelection?: { tile: SelectionTile; radiusX: number; radiusY: number };
    selection?: SelectionTile;
    feather?: FeatherTile;
    lut?: Uint8Array;
    adjustment?: {
      adjusted: Uint8ClampedArray;
      mask?: Uint8ClampedArray | null;
      opacity: number;
    };
    histogram?: boolean;
    coverage?: CoverageRequest;
    png?: { width: number; height: number };
    clipboard?: ClipboardRequest;
    selectionModification?: SelectionModificationRequest;
    channelSelection?: ChannelCoverageRequest;
    quickSelection?: QuickSelectionRequest;
    subject?: SubjectRequest;
    matting?: MattingTileRequest;
    mattingBegin?:{width:number;height:number};
    mattingAccumulate?:MattingTileRequest;
    mattingSolve?:boolean;
  }>,
) => {
  try {
    const data = event.data;
    if(data.floatComposite||data.floatAffine||data.floatTone){
      const owned=floating??=new FloatPixelProcessor(await kernel);let pixels:Float32Array;
      if(data.floatComposite){const request=data.floatComposite;validateFloatWorkerWindow(request.source);validateFloatWorkerWindow(request.backdrop);pixels=owned.composite(request.source,request.backdrop,request.options);}
      else if(data.floatTone){const request=data.floatTone;validateFloatWorkerWindow(request.pixels);pixels=owned.tone(request.pixels,request.options);}
      else{const request=data.floatAffine!;validateFloatWorkerWindow(request.pixels);pixels=owned.affine(request.pixels,request.matrix);}
      self.postMessage({id:data.id,pixels},{transfer:[pixels.buffer as ArrayBuffer]});return;
    }
    if(data.mattingBegin){matting?.dispose();matting=new ClosedFormMatting(data.mattingBegin.width,data.mattingBegin.height);self.postMessage({id:data.id});return;}
    if(data.mattingAccumulate){if(!matting)throw new Error('Missing matting session.');matting.add({...data.mattingAccumulate,...prepareMattingTile(data.pixels,data.mattingAccumulate)});self.postMessage({id:data.id});return;}
    if(data.mattingSolve){if(!matting)throw new Error('Missing matting session.');const mattingDiagnostics=await matting.solve((iteration,residual)=>self.postMessage({id:data.id,type:'progress',progress:{completed:iteration,total:2000,relativeResidual:residual}}),2000,'ic0',true,wasmMattingIterations(await kernel));self.postMessage({id:data.id,mattingDiagnostics});return;}
    if(data.matting){
      const mattingTile=refineMattingTile(await kernel,data.pixels,data.matting,matting);
      self.postMessage({id:data.id,mattingTile},{transfer:[mattingTile.alpha.buffer as ArrayBuffer,mattingTile.rgba.buffer as ArrayBuffer]});return;
    }
    if(data.subject){
      const selectionResult=await selectNativeSubject(await kernel,data.pixels,data.subject,progress=>self.postMessage({id:data.id,type:'progress',progress}));
      self.postMessage({id:data.id,selectionResult});return;
    }
    if(data.quickSelection){
      const selectionResult=await growQuickSelection(await kernel,data.pixels,data.quickSelection,progress=>self.postMessage({id:data.id,type:'progress',progress}));
      self.postMessage({id:data.id,selectionResult});return;
    }
    if(data.channelSelection){
      const selectionResult=await composeChannelSelection(await kernel,data.channelSelection,progress=>self.postMessage({id:data.id,type:'progress',progress}));
      self.postMessage({id:data.id,selectionResult});return;
    }
    if (data.selectionModification) {
      const selectionResult = await modifySelectionCoverage(await kernel, data.selectionModification,
        progress => self.postMessage({id:data.id,type:"progress",progress}));
      self.postMessage({id:data.id,selectionResult});
      return;
    }
    if (data.png) {
      const { width, height } = data.png;
      const png = await encodeCapturedPng(data.pixels, width, height);
      self.postMessage({ id: data.id, png });
      return;
    }
    if (data.clipboard) {
      const clipboard = await prepareClipboard(await kernel, data.pixels, data.clipboard);
      self.postMessage({ id: data.id, clipboard });
      return;
    }
    if (data.coverage) {
      const { width, height, wand } = data.coverage;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || data.pixels.length !== width * height * 4)
        throw new Error("Pixel coverage requires matching RGBA dimensions.");
      let alpha: Uint8Array;
      if (wand) alpha = wandCoverage(data.pixels, width, height, wand.x, wand.y, wand.tolerance, wand.contiguous);
      else {
        alpha = new Uint8Array(width * height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = data.pixels[i * 4 + 3];
      }
      self.postMessage({ id: data.id, coverage: encodeCoverage(alpha, width, height) });
      return;
    }
    if (data.hsl) {
      const pixels = applyHsl(await kernel, data.pixels, data.hsl);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if(data.colorRange){
      const colorRangeCoverage=applyColorRange(await kernel,data.pixels,data.colorRange);
      self.postMessage({id:data.id,colorRangeCoverage},{transfer:[colorRangeCoverage.buffer]});return;
    }
    if (data.brushTexture) {
      const pixels = prepareBrushTexture(await kernel, data.pixels, data.brushTexture,data.brushTextureSupport);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.wetPaintLoad) {
      const wetPaintCarried = loadWetPaint(await kernel, data.pixels, data.wetPaintLoad);
      self.postMessage({ id:data.id, wetPaintCarried }, { transfer:[wetPaintCarried.buffer] });
      return;
    }
    if (data.wetPaintMix) {
      const {carried,coverage,settings}=data.wetPaintMix;
      const wetPaint=mixWetPaint(await kernel,data.pixels,carried,coverage,settings);
      self.postMessage({id:data.id,wetPaint},{transfer:[wetPaint.pixels.buffer,wetPaint.carried.buffer]});
      return;
    }
    if (data.lookup) {
      const pixels = applyLookup(await kernel, data.pixels, data.lookup);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer as ArrayBuffer] }); return;
    }
    if (data.whiteBalance) {
      const pixels = applyWhiteBalance(await kernel, data.pixels, data.whiteBalance);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if(data.frequencyEncoding){const pixels=applyEncodedFrequencyBand(await kernel,data.pixels,data.frequencyEncoding.low,data.frequencyEncoding.band);self.postMessage({id:data.id,pixels},{transfer:[pixels.buffer]});return;}
    if (data.linearBlend) {
      const pixels=applyLinearBlend(await kernel,data.pixels,data.linearBlend.backdrop,data.linearBlend.opacity,data.linearBlend.mode);
      self.postMessage({id:data.id,pixels},{transfer:[pixels.buffer]});return;
    }
    if (data.redEye) {
      const pixels = applyRedEye(await kernel, data.pixels, data.redEye);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.gradientMap) {
      const pixels = applyGradientMap(await kernel, data.pixels, data.gradientMap);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.chromatic) {
      const pixels = applyChromatic(await kernel, data.pixels, data.chromatic);
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.filteredMix) {
      const { filtered, mask, density, inverted } = data.filteredMix;
      const pixels = mixFiltered(
        await kernel,
        data.pixels,
        filtered,
        mask,
        density,
        inverted,
      );
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if(data.bilateralFilter){
      const {width,height,options}=data.bilateralFilter,pixels=applyBilateralFilter(await kernel,data.pixels,width,height,options);
      self.postMessage({id:data.id,pixels},{transfer:[pixels.buffer]});return;
    }
    if (data.medianFilter) {
      const {width,height,radius}=data.medianFilter;
      const pixels=applyMedianFilter(await kernel,data.pixels,width,height,radius);
      self.postMessage({id:data.id,pixels},{transfer:[pixels.buffer]});
      return;
    }
    if (data.spatialFilter) {
      const { width, height, options } = data.spatialFilter;
      const pixels = applySpatialFilter(
        await kernel,
        data.pixels,
        width,
        height,
        options,
      );
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.donorSearch) {
      const { width, height, coverage, options } = data.donorSearch;
      self.postMessage({
        id: data.id,
        donorResult: findRetouchDonor(
          data.pixels,
          width,
          height,
          coverage,
          options,
          wasmDonorValidity(await kernel),
        ),
      });
      return;
    }
    if (data.poisson) {
      const { donor, width, height, coverage, options } = data.poisson;
      const poissonResult = poissonBlend(
        data.pixels,
        donor,
        width,
        height,
        coverage,
        options,
        wasmPoissonSolver(await kernel),
      );
      self.postMessage(
        { id: data.id, poissonResult },
        { transfer: [poissonResult.pixels.buffer] },
      );
      return;
    }
    if (data.dodgeBurn) {
      const { width, height, options, coverage } = data.dodgeBurn;
      const pixels = applyDodgeBurn(
        data.pixels,
        width,
        height,
        options,
        coverage,
      );
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    if (data.histogram) {
      const hist = computeWasmHistogram(await kernel, data.pixels);
      self.postMessage({ id: data.id, histogram: hist });
      return;
    }
    if (data.featheredSelection) {
      const { tile, radiusX, radiusY } = data.featheredSelection;
      const pixels = renderSelection(await kernel, tile);
      const region = featherRegion(pixels, { ...tile, radiusX, radiusY });
      if (region) {
        const softened = featherAlpha(await kernel, region.pixels,
          { width: region.width, height: region.height, radiusX, radiusY });
        for (let y = 0; y < region.height; y++) pixels.set(
          softened.subarray(y * region.width * 4, (y + 1) * region.width * 4),
          ((y + region.y) * tile.width + region.x) * 4);
      }
      self.postMessage({ id: data.id, pixels }, { transfer: [pixels.buffer] });
      return;
    }
    const result = data.lut
      ? applyLut(await kernel, data.pixels, data.lut)
      : data.adjustment
        ? blendAdjustment(
            await kernel,
            data.pixels,
            data.adjustment.adjusted,
            data.adjustment.mask ?? null,
            data.adjustment.opacity,
          )
        : data.feather
          ? featherAlpha(await kernel, data.pixels, data.feather)
          : data.selection
            ? renderSelection(await kernel, data.selection)
            : data.blend && data.underlying
              ? applyBlendIf(
                  await kernel,
                  data.pixels,
                  data.underlying,
                  data.blend,
                )
              : applyTone(await kernel, data.pixels, data.effects ?? []);
    self.postMessage(
      { id: event.data.id, pixels: result },
      { transfer: [result.buffer] },
    );
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error:
        error instanceof Error ? error.message : "Image processing failed.",
    });
  }
};
