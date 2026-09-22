import {
  Document,
  RasterLayer,
  TextLayer,
  LayerGroup,
  ToneAdjustment,
  PaintLayer,
  BrushStroke,
  PencilStroke,
  CloneStroke,
  PaintFill,
  VectorLayer,
  VectorPath,
  MarqueeSelection,
  LayerStyle,
  BlendIf,
} from "../dom";
import type { EditorCommand } from "../core/commands";

// Bundled into an isolated worker created by an opaque-origin sandbox iframe.
// No UI references, credentials, source image bytes, or host globals enter here.
self.onmessage = async (event) => {
  const commands: EditorCommand[] = [];
  const logs: string[] = [];
  try {
    const document = Document.fromJSON(event.data.document);
    document.selectedLayer = document.getLayer(event.data.selectedId);
    document.onCommand((command) => {
      if (commands.length >= 256)
        throw new Error("Scripts may submit at most 256 commands.");
      commands.push(command);
    });
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
    const run = new Function(
      "document",
      "Document",
      "RasterLayer",
      "TextLayer",
      "LayerGroup",
      "ToneAdjustment",
      "PaintLayer",
      "BrushStroke",
      "PencilStroke",
      "CloneStroke",
      "PaintFill",
      "VectorLayer",
      "VectorPath",
      "MarqueeSelection",
      "LayerStyle",
      "BlendIf",
      "print",
      `"use strict"; return (async () => {\n${event.data.code}\n})();`,
    );
    await run(
      document,
      Document,
      RasterLayer,
      TextLayer,
      LayerGroup,
      ToneAdjustment,
      PaintLayer,
      BrushStroke,
      PencilStroke,
      CloneStroke,
      PaintFill,
      VectorLayer,
      VectorPath,
      MarqueeSelection,
      LayerStyle,
      BlendIf,
      print,
    );
    self.postMessage({
      type: "result",
      commands,
      selectedId: document.selectedLayer?.id ?? null,
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
