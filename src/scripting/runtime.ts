import {
  LayerMask,
  LayerMetadata,
  Document,
  RasterLayer,
  SmartObjectLayer,
  GaussianBlurFilter,
  UnsharpMaskFilter,
  SmartToneFilter,
  TextLayer,
  AdjustmentLayer,
  LayerGroup,
  ToneAdjustment,
  PaintLayer,
  BrushStroke,
  TonalStroke,
  PatchAdjustment,
  EraserStroke,
  PencilStroke,
  CloneStroke,
  PaintFill,
  VectorLayer,
  VectorPath,
  MarqueeSelection,
  AffineTransform,
  Guide,
  LayerComp,
  LayerStyle,
  BlendIf,
} from "../dom";
import type { EditorCommand } from "../core/commands";
import type { AdjustmentLayerData } from "../core/model";

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
    document._preparePatch = (request) =>
      callHost(
        "retouch",
        "patch",
        [...commands],
        request,
      ) as Promise<AdjustmentLayerData>;
    document._prepareHeal = (request) =>
      callHost(
        "retouch",
        "heal",
        [...commands],
        request,
      ) as Promise<AdjustmentLayerData>;
    document.undo = document.redo = () => {
      throw new Error("Use editor undo/redo after a script finishes.");
    };
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
      "GaussianBlurFilter",
      "UnsharpMaskFilter",
      "SmartToneFilter",
      "TextLayer",
      "AdjustmentLayer",
      "LayerGroup",
      "ToneAdjustment",
      "PaintLayer",
      "BrushStroke",
      "TonalStroke",
      "PatchAdjustment",
      "EraserStroke",
      "PencilStroke",
      "CloneStroke",
      "PaintFill",
      "VectorLayer",
      "VectorPath",
      "MarqueeSelection",
      "AffineTransform",
      "Guide",
      "LayerComp",
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
      GaussianBlurFilter,
      UnsharpMaskFilter,
      SmartToneFilter,
      TextLayer,
      AdjustmentLayer,
      LayerGroup,
      ToneAdjustment,
      PaintLayer,
      BrushStroke,
      TonalStroke,
      PatchAdjustment,
      EraserStroke,
      PencilStroke,
      CloneStroke,
      PaintFill,
      VectorLayer,
      VectorPath,
      MarqueeSelection,
      AffineTransform,
      Guide,
      LayerComp,
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
