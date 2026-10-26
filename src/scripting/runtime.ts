import {registerFontVariationSource} from '../fonts/variations';
import {
  LayerMask,
  LayerMetadata,
  Document,
  RasterLayer,
  SmartObjectLayer,
  RawDevelopment,
  LensCorrection,
  LensProfile,
  GaussianBlurFilter,
  MedianFilter,
  BilateralDenoiseFilter,
  FrequencyBandFilter,
  NativeCompositionFilter,
  DocumentToneFilter,
  UnsharpMaskFilter,
  SmartToneFilter,
  TextLayer,
  ParagraphStyle,
  AdjustmentLayer,
  LayerGroup,
  ToneAdjustment,
  PaintLayer,
  PressureCurve,
  BrushTip,
  BrushSymmetry,
  BrushTexture,
  BrushStroke,
  WetPaintStroke,
  TonalStroke,
  PatchAdjustment,
  RedEyeAdjustment,
  EraserStroke,
  PencilStroke,
  CloneStroke,
  PaintFill,
  VectorLayer,
  VectorPath,
  VectorContour,
  MarqueeSelection,
  AffineTransform,
  Guide,
  LayerComp,
  AlphaChannel,
  LayerStyle,
  BlendIf,
} from "../dom";
import type { EditorCommand } from "../core/commands";
import type { AdjustmentLayerData } from "../core/model";
import {inspectDesign,preflightAssetMetadataSchema} from '../core/preflight';
import {ComponentRegistry} from '../core/smart/manager';
import {findLayer} from '../core/model';
import {rawDevelopOptionsSchema,parseRawDevelopmentOptions} from '../core/interchange/raw/types';
import {rawDevelopmentPlanSchema} from '../core/interchange/raw/commands';
import {z} from 'zod';

// Bundled into an isolated worker created by an opaque-origin sandbox iframe.
// No UI references, credentials, source image bytes, or host globals enter here.

const pendingHostCalls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
let nextCallId = 1;

function callHost(service: string, method: string, ...args: unknown[]) {
  const callId = nextCallId++;
  return new Promise((resolve, reject) => {
    pendingHostCalls.set(callId, { resolve, reject });
    self.postMessage({
      type: "host:call",
      id: callId,
      service,
      method,
      args,
    });
  });
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type === "host:call:result") {
    const pending = pendingHostCalls.get(message.id);
    if (pending) {
      pendingHostCalls.delete(message.id);
      pending.resolve(message.result);
    }
    return;
  }
  if (message?.type === "host:call:error") {
    const pending = pendingHostCalls.get(message.id);
    if (pending) {
      pendingHostCalls.delete(message.id);
      pending.reject(new Error(message.error ?? "Host call failed."));
    }
    return;
  }

  const commands: EditorCommand[] = [];
  const logs: string[] = [];
  try {
    const fonts=event.data.fonts??[];
    // Remove the private payload from the event before invoking untrusted code.
    delete event.data.fonts;
    for(const source of fonts){
      const set=(self as typeof self&{fonts?:FontFaceSet}).fonts;
      if(!set||typeof FontFace==='undefined')throw new Error('This browser cannot measure embedded fonts in isolated scripts.');
      const bytes=await source.blob.arrayBuffer();
      const faces:FontFace[]=[];for(const descriptor of source.descriptors){const face=new FontFace(source.family,bytes,descriptor);await face.load();set.add(face);faces.push(face);}
      registerFontVariationSource(set,bytes,source.info,()=>{if(faces.some(face=>face.status!=='loaded'||!set.has(face)))throw new Error('An isolated native font changed.');});
    }
    fonts.length=0;
    const document = Document.fromJSON(event.data.document);
    document.selectLayers(
      (event.data.selectedIds ?? [])
        .map((id: string) => document.getLayer(id))
        .filter(Boolean),
    );
    document.onCommand((command) => {
      if (commands.length >= 256)
        throw new Error("Scripts may submit at most 256 commands.");
      commands.push(command);
    });
    document._prepareTextLayout=async(layerId,patch,control)=>{
      if(control.signal)throw new Error('Use Scripts-panel cancellation; AbortSignal is available to trusted host code only.');
      const revision=document.getSnapshot().revision;
      const bounds=z.object({width:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER),height:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER)}).strict().parse(await callHost('typography','measure',[...commands],{layerId,patch}));
      if(document.getSnapshot().revision!==revision)throw new Error('Script document changed during typography preparation.');
      return bounds;
    };
    document._rasterizeSmartObject = async (layerId) => {
      const revision = document.getSnapshot().revision;
      const layer = (await callHost("retouch", "rasterize", [...commands], {
        layerId,
      })) as import("../core/model").RasterLayerData;
      if (document.getSnapshot().revision !== revision)
        throw new Error("Script document changed during rasterization.");
      document._dispatch({
        type: "smartObject.convertToRaster",
        id: layerId,
        layer,
      });
      const result = document.getLayer(layer.id) as RasterLayer;
      document.selectedLayer = result;
      return result;
    };
    document._readRawDevelopment=async layerId=>{
      const value=await callHost('raw','settings',[...commands],{layerId});
      return value===null?null:rawDevelopOptionsSchema.parse(value);
    };
    document._prepareRawDevelopment=async(layerId,development,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; callbacks and AbortSignal are available to trusted host code only.');
      const options=parseRawDevelopmentOptions({allowPrecisionLoss:control.allowPrecisionLoss??false,development});
      const revision=document.getSnapshot().revision,layer=findLayer(document._read(),layerId);
      if(layer?.kind!=='smart-object')throw new Error('Choose an attached RAW smart object.');
      const before=new ComponentRegistry(document._read().components).get(layer.componentId);
      if(before.source.kind!=='asset')throw new Error('This smart object has no retained RAW original.');
      const plan=rawDevelopmentPlanSchema.parse(await callHost('retouch','raw-develop',[...commands],{layerId,options}));
      if(document.getSnapshot().revision!==revision)throw new Error('Script document changed during RAW development.');
      const source=plan.definition.source,report=plan.report;
      if(plan.definition.id!==before.id||plan.definition.name!==before.name||source.kind!=='asset'||source.link||source.assetId===before.source.assetId||!report.canDevelop||report.image!==options.development.image||source.width!==report.displayWidth||source.height!==report.displayHeight)
        throw new Error('RAW development result differs from its requested master or geometry.');
      document._dispatch({type:'transaction',label:'Develop RAW',commands:[{type:'component.set',definition:{...plan.definition,source}}]});
      return report;
    };
    document._preparePatch = (request) =>
      callHost(
        "retouch",
        "patch",
        [...commands],
        request,
      ) as Promise<AdjustmentLayerData>;
    document._prepareSelectionModification = (request, control) => {
      if (control.signal || control.onProgress) throw new Error("Use Scripts-panel cancellation; progress callbacks and AbortSignal are available to trusted host code only.");
      return callHost("selection", "modify", [...commands], request) as Promise<import("../core/drawing").SelectionData>;
    };
    document._prepareVectorBoolean=(selection,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; callbacks and AbortSignal are available to trusted host code only.');
      return callHost('vector','boolean',[...commands],selection) as Promise<import('../core/vector-boolean').VectorBooleanResult>;
    };
    document._prepareColorRange=(request,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; progress callbacks and AbortSignal are available to trusted host code only.');
      return callHost('selection','color-range',[...commands],request) as Promise<import('../core/drawing').SelectionData>;
    };
    document._prepareQuickSelection=(request,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; callbacks and AbortSignal are available to trusted host code only.');
      return callHost('selection','quick',[...commands],request) as Promise<import('../core/drawing').SelectionData>;
    };
    document._preflight=async(options,control)=>{
      if(control.signal)throw new Error('Use Scripts-panel cancellation; AbortSignal is available to trusted host code only.');
      const assets=preflightAssetMetadataSchema.parse(await callHost('assets','list'));
      return inspectDesign(document._read(),document.getSnapshot().revision,options,{assets:new Map(assets.map(asset=>[asset.id,{width:asset.width,height:asset.height}]))});
    };
    document._prepareSubject=(request,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; callbacks and AbortSignal are available to trusted host code only.');
      return callHost('selection','subject',[...commands],request) as Promise<import('../core/drawing').SelectionData>;
    };
    document._prepareMatting=async(request,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; callbacks and AbortSignal are available to trusted host code only.');
      return{plan:await callHost('retouch','matting',[...commands],request) as import('../core/matting').MattingPlan};
    };
    document._prepareChannelLoad=(request,control)=>{
      if(control.signal||control.onProgress)throw new Error('Use Scripts-panel cancellation; callbacks and AbortSignal are available to trusted host code only.');
      return callHost('selection','channel',[...commands],request) as Promise<import('../core/drawing').SelectionData>;
    };
    document._prepareHeal = (request) =>
      callHost(
        "retouch",
        "heal",
        [...commands],
        request,
      ) as Promise<AdjustmentLayerData>;
    document.undo = document.redo = document.navigateHistory = () => {
      throw new Error("Use editor undo/redo after a script finishes.");
    };
    const branchMutation = () => {throw new Error('Use editor history branches after a script finishes.');};
    document.createHistoryBranch = document.checkoutHistoryBranch = document.renameHistoryBranch = document.deleteHistoryBranch = branchMutation;
    const comparisonMutation = () => {throw new Error('Use editor history comparisons after a script finishes.');};
    document.createHistoryComparison = document.updateHistoryComparison = document.deleteHistoryComparison = document.createHistoryBranchFromComparison = comparisonMutation;
    const rejectHistoryOrigin = () => {throw new Error('History origins are assigned by the host.');};
    document._setDefaultHistoryOrigin = document._withHistoryOrigin = rejectHistoryOrigin;
    const print = (...values: unknown[]) => {
      if (logs.length < 100)
        logs.push(
          values
            .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
            .join(" ")
            .slice(0, 2000),
        );
    };

    const host = Object.freeze({
      version: 1,
      capabilities: Object.freeze(["jobs", "assets", "retouch"]),
      jobs: Object.freeze({
        submit: (request: unknown) => callHost("jobs", "submit", request),
        get: (jobId: string) => callHost("jobs", "get", jobId),
        cancel: (jobId: string) => callHost("jobs", "cancel", jobId),
        list: () => callHost("jobs", "list"),
        applyCandidate: (candidateId: string, options?: unknown) =>
          callHost("jobs", "applyCandidate", candidateId, options ?? {}),
      }),
      assets: Object.freeze({
        get: (assetId: string) => callHost("assets", "get", assetId),
        list: () => callHost("assets", "list"),
      }),
    });

    const run = new Function(
      "document",
      "LayerMask",
      "LayerMetadata",
      "Document",
      "RasterLayer",
      "SmartObjectLayer",
      "RawDevelopment",
      "LensCorrection",
      "LensProfile",
      "GaussianBlurFilter",
      "MedianFilter",
      "BilateralDenoiseFilter",
      "FrequencyBandFilter",
      "NativeCompositionFilter",
      "DocumentToneFilter",
      "UnsharpMaskFilter",
      "SmartToneFilter",
      "TextLayer",
      "ParagraphStyle",
      "AdjustmentLayer",
      "LayerGroup",
      "ToneAdjustment",
      "PaintLayer",
      "PressureCurve",
      "BrushTip",
      "BrushSymmetry",
      "BrushTexture",
      "BrushStroke",
      "WetPaintStroke",
      "TonalStroke",
      "PatchAdjustment",
      "RedEyeAdjustment",
      "EraserStroke",
      "PencilStroke",
      "CloneStroke",
      "PaintFill",
      "VectorLayer",
      "VectorPath",
      "VectorContour",
      "MarqueeSelection",
      "AffineTransform",
      "Guide",
      "LayerComp",
      "AlphaChannel",
      "LayerStyle",
      "BlendIf",
      "print",
      "host",
      `"use strict"; return (async () => {\n${event.data.code}\n})();`,
    );
    await run(
      document,
      LayerMask,
      LayerMetadata,
      Document,
      RasterLayer,
      SmartObjectLayer,
      RawDevelopment,
      LensCorrection,
      LensProfile,
      GaussianBlurFilter,
      MedianFilter,
      BilateralDenoiseFilter,
      FrequencyBandFilter,
      NativeCompositionFilter,
      DocumentToneFilter,
      UnsharpMaskFilter,
      SmartToneFilter,
      TextLayer,
      ParagraphStyle,
      AdjustmentLayer,
      LayerGroup,
      ToneAdjustment,
      PaintLayer,
      PressureCurve,
  BrushTip,
  BrushSymmetry,
  BrushTexture,
  BrushStroke,
  WetPaintStroke,
      TonalStroke,
      PatchAdjustment,
      RedEyeAdjustment,
      EraserStroke,
      PencilStroke,
      CloneStroke,
      PaintFill,
      VectorLayer,
      VectorPath,
      VectorContour,
      MarqueeSelection,
      AffineTransform,
      Guide,
      LayerComp,
      AlphaChannel,
      LayerStyle,
      BlendIf,
      print,
      host,
    );
    self.postMessage({
      type: "result",
      commands,
      selectedId: document.selectedLayer?.id ?? null,
      selectedIds: document.selectedLayers.map((layer) => layer.id),
      logs,
    });
  } catch (cause) {
    self.postMessage({
      type: "error",
      error: cause instanceof Error ? cause.message : "Script failed.",
      logs,
    });
  }
};
