import type {
  SelectionData,
  PaintOperationData,
  VectorPathData,
} from "./drawing";
import { layerOrigin, parentId } from "./spatial";
import {
  allLayers,
  findContainer,
  findLayer,
  id,
  isLocked,
  measureTextBounds,
  toneOf,
  validateDocument,
} from "./model";
import type {
  DocumentData,
  LayerData,
  LayerBaseData,
  RasterLayerData,
  TextLayerData,
  ToneEffectData,
} from "./model";

export type LayerPatch = Partial<
  Pick<
    LayerBaseData,
    | "name"
    | "visible"
    | "locked"
    | "opacity"
    | "fillOpacity"
    | "styles"
    | "blendMode"
    | "x"
    | "y"
  >
> &
  Partial<Pick<RasterLayerData, "width" | "height">> &
  Partial<
    Pick<
      TextLayerData,
      "text" | "fontSize" | "fontFamily" | "color" | "align" | "lineHeight"
    >
  >;

// Serializable commands are the single mutation boundary for UI, automation,
// and a future AI adapter. No renderer or UI code mutates document nodes.
export type EditorCommand =
  | { type: "document.rename"; name: string }
  | { type: "document.resize"; width: number; height: number }
  | { type: "selection.set"; selection: SelectionData | null }
  | {
      type: "layer.place";
      id: string;
      targetId: string | null;
      placement: "before" | "after" | "inside";
      preservePosition: boolean;
    }
  | { type: "paint.add"; id: string; stroke: PaintOperationData }
  | { type: "paint.remove"; id: string; strokeId: string }
  | { type: "path.add"; id: string; path: VectorPathData }
  | {
      type: "path.update";
      id: string;
      pathId: string;
      patch: Partial<Omit<VectorPathData, "id">>;
    }
  | { type: "path.remove"; id: string; pathId: string }
  | { type: "layer.add"; layer: LayerData; parentId?: string }
  | { type: "layer.update"; id: string; patch: LayerPatch }
  | { type: "layer.remove"; id: string }
  | { type: "layer.duplicate"; id: string; newIds?: Record<string, string> }
  | { type: "layer.reorder"; id: string; direction: "up" | "down" }
  | { type: "layer.reparent"; id: string; parentId: string | null }
  | {
      type: "effect.tone";
      id: string;
      values: Partial<{
        exposure: number;
        contrast: number;
        saturation: number;
      }>;
    }
  | { type: "effect.reset"; id: string }
  | { type: "effect.add"; id: string; effect: ToneEffectData }
  | {
      type: "effect.update";
      id: string;
      effectId: string;
      values: Partial<
        Pick<ToneEffectData, "enabled" | "exposure" | "contrast" | "saturation">
      >;
    }
  | { type: "effect.remove"; id: string; effectId: string }
  | { type: "transaction"; label: string; commands: EditorCommand[] };

function apply(document: DocumentData, command: EditorCommand): void {
  if (command.type === "transaction") {
    for (const child of command.commands) apply(document, child);
    return;
  }
  if (command.type === "selection.set") {
    document.selection = structuredClone(command.selection);
    return;
  }
  if (command.type === "document.rename") {
    document.name = command.name;
    return;
  }
  if (command.type === "document.resize") {
    document.width = command.width;
    document.height = command.height;
    return;
  }
  if (command.type === "layer.add") {
    if (!command.parentId)
      document.children.push(structuredClone(command.layer));
    else {
      const parent = findLayer(document, command.parentId);
      if (!parent || parent.kind !== "group")
        throw new Error("Select an existing group.");
      if (isLocked(document, parent.id))
        throw new Error("Unlock the group before adding layers.");
      parent.children.push(structuredClone(command.layer));
    }
    return;
  }
  const layer = findLayer(document, command.id);
  if (!layer) throw new Error("Layer not found.");
  const lockOnly =
    command.type === "layer.update" &&
    Object.keys(command.patch).every((key) => key === "locked");
  if (isLocked(document, layer.id) && !lockOnly)
    throw new Error("Unlock this layer and its parent groups first.");
  const siblings = findContainer(document.children, layer.id)!;
  switch (command.type) {
    case "layer.update":
      if (
        Object.keys(command.patch).some(
          (key) =>
            ![
              "name",
              "visible",
              "locked",
              "opacity",
              "fillOpacity",
              "styles",
              "blendMode",
              "x",
              "y",
              "width",
              "height",
              "text",
              "fontSize",
              "fontFamily",
              "color",
              "align",
              "lineHeight",
            ].includes(key),
        )
      ) {
        throw new Error("Unsupported layer property.");
      }
      if (
        layer.kind !== "raster" &&
        layer.kind !== "text" &&
        ("width" in command.patch || "height" in command.patch)
      )
        throw new Error("Only raster and text layers have intrinsic dimensions.");
      Object.assign(layer, command.patch);
      if (layer.kind === "text") {
        const bounds = measureTextBounds(
          layer.text,
          layer.fontSize,
          layer.fontFamily,
          layer.lineHeight,
        );
        layer.width = bounds.width;
        layer.height = bounds.height;
      }
      break;
    case "layer.remove":
      siblings.splice(siblings.indexOf(layer), 1);
      break;
    case "layer.duplicate": {
      const copy = structuredClone(layer);
      for (const node of allLayers([copy])) {
        node.id = command.newIds?.[node.id] ?? id();
        if (node.kind === "raster")
          node.effects.forEach((effect) => {
            effect.id = command.newIds?.[effect.id] ?? id();
          });
        if (node.kind === "paint")
          node.strokes.forEach((stroke) => {
            stroke.id = command.newIds?.[stroke.id] ?? id();
          });
        if (node.kind === "vector")
          node.paths.forEach((path) => {
            path.id = command.newIds?.[path.id] ?? id();
          });
      }
      copy.name = `${copy.name.slice(0, 234)} copy`;
      copy.x += 24;
      copy.y += 24;
      siblings.splice(siblings.indexOf(layer) + 1, 0, copy);
      break;
    }
    case "layer.reorder": {
      const from = siblings.indexOf(layer);
      const to = Math.max(
        0,
        Math.min(
          siblings.length - 1,
          from + (command.direction === "up" ? 1 : -1),
        ),
      );
      siblings.splice(from, 1);
      siblings.splice(to, 0, layer);
      break;
    }
    case "layer.reparent": {
      if (
        command.parentId === layer.id ||
        (layer.kind === "group" &&
          allLayers(layer.children).some(
            (node) => node.id === command.parentId,
          ))
      ) {
        throw new Error("A group cannot contain itself.");
      }
      const parent = command.parentId
        ? findLayer(document, command.parentId)
        : undefined;
      if (command.parentId && (!parent || parent.kind !== "group"))
        throw new Error("Group not found.");
      if (parent && isLocked(document, parent.id))
        throw new Error("Unlock the destination group first.");
      siblings.splice(siblings.indexOf(layer), 1);
      if (parent?.kind === "group") parent.children.push(layer);
      else document.children.push(layer);
      break;
    }
    case "layer.place": {
      if (command.targetId === layer.id)
        throw new Error("Choose a different drop target.");
      const target = command.targetId
        ? findLayer(document, command.targetId)
        : undefined;
      if (command.targetId && !target)
        throw new Error("Drop target not found.");
      if (command.placement !== "inside" && !target)
        throw new Error("Choose a layer to place beside.");
      if (command.placement === "inside" && target && target.kind !== "group")
        throw new Error("Only groups can contain layers.");
      const destinationId =
        command.placement === "inside"
          ? command.targetId
          : parentId(document, target!.id);
      if (
        destinationId === layer.id ||
        (layer.kind === "group" &&
          allLayers(layer.children).some((child) => child.id === destinationId))
      )
        throw new Error("A group cannot contain itself.");
      if (destinationId && isLocked(document, destinationId))
        throw new Error("Unlock the destination group first.");
      const origin = layerOrigin(document, layer.id)!;
      const destinationOrigin = destinationId
        ? layerOrigin(document, destinationId)!
        : { x: 0, y: 0 };
      siblings.splice(siblings.indexOf(layer), 1);
      const destination = destinationId
        ? (
            findLayer(document, destinationId) as Extract<
              LayerData,
              { kind: "group" }
            >
          ).children
        : document.children;
      let index = destination.length;
      if (command.placement !== "inside")
        index =
          destination.findIndex((node) => node.id === target!.id) +
          (command.placement === "after" ? 1 : 0);
      destination.splice(index, 0, layer);
      if (command.preservePosition) {
        layer.x = origin.x - destinationOrigin.x;
        layer.y = origin.y - destinationOrigin.y;
      }
      break;
    }
    case "paint.add":
      if (layer.kind !== "paint") throw new Error("Select a paint layer.");
      layer.strokes.push(structuredClone(command.stroke));
      break;
    case "paint.remove":
      if (layer.kind !== "paint") throw new Error("Select a paint layer.");
      layer.strokes = layer.strokes.filter(
        (stroke) => stroke.id !== command.strokeId,
      );
      break;
    case "path.add":
      if (layer.kind !== "vector") throw new Error("Select a vector layer.");
      layer.paths.push(structuredClone(command.path));
      break;
    case "path.update": {
      if (layer.kind !== "vector") throw new Error("Select a vector layer.");
      const path = layer.paths.find((entry) => entry.id === command.pathId);
      if (!path) throw new Error("Path not found.");
      if (
        Object.keys(command.patch).some(
          (key) =>
            !["points", "closed", "fill", "stroke", "strokeWidth"].includes(
              key,
            ),
        )
      )
        throw new Error("Unsupported path property.");
      Object.assign(path, structuredClone(command.patch));
      break;
    }
    case "path.remove":
      if (layer.kind !== "vector") throw new Error("Select a vector layer.");
      layer.paths = layer.paths.filter((path) => path.id !== command.pathId);
      break;
    case "effect.tone": {
      if (layer.kind !== "raster")
        throw new Error("Select an image layer for adjustments.");
      const tone = { ...toneOf(layer), ...command.values };
      const existing = layer.effects.findIndex(
        (effect) => effect.id === tone.id,
      );
      if (existing === -1) layer.effects.push(tone);
      else layer.effects[existing] = tone;
      break;
    }
    case "effect.reset":
      if (layer.kind === "raster") layer.effects = [];
      break;
    case "effect.add":
      if (layer.kind !== "raster") throw new Error("Select an image layer.");
      layer.effects.push(structuredClone(command.effect));
      break;
    case "effect.update": {
      if (layer.kind !== "raster") throw new Error("Select an image layer.");
      const effect = layer.effects.find((item) => item.id === command.effectId);
      if (!effect) throw new Error("Adjustment not found.");
      Object.assign(effect, command.values);
      break;
    }
    case "effect.remove":
      if (layer.kind !== "raster") throw new Error("Select an image layer.");
      layer.effects = layer.effects.filter(
        (item) => item.id !== command.effectId,
      );
      break;
  }
}

export function execute(
  document: DocumentData,
  command: EditorCommand,
): DocumentData {
  const next = structuredClone(document);
  apply(next, command);
  validateDocument(next);
  return next;
}

export function describe(command: EditorCommand): string {
  switch (command.type) {
    case "selection.set":
      return command.selection ? "Set selection" : "Deselect";
    case "layer.place":
      return "Move layer";
    case "paint.add":
      return command.stroke.kind === "clone"
        ? "Clone stroke"
        : command.stroke.kind === "pencil"
          ? "Pencil stroke"
          : command.stroke.kind === "fill"
            ? "Fill selection"
            : "Brush stroke";
    case "paint.remove":
      return "Remove stroke";
    case "path.add":
      return "Add path";
    case "path.update":
      return "Edit path";
    case "path.remove":
      return "Remove path";
    case "document.rename":
      return "Rename document";
    case "document.resize":
      return "Resize artboard";
    case "layer.add":
      return command.layer.kind === "group"
        ? "Add group"
        : command.layer.kind === "paint"
          ? "Add paint layer"
          : command.layer.kind === "vector"
            ? "Add vector layer"
            : command.layer.kind === "text"
              ? "Add text layer"
              : "Import image";
    case "layer.update":
      return "Edit layer";
    case "layer.remove":
      return "Delete layer";
    case "layer.duplicate":
      return "Duplicate layer";
    case "layer.reorder":
      return "Reorder layer";
    case "layer.reparent":
      return "Move into group";
    case "effect.tone":
      return "Adjust image";
    case "effect.reset":
      return "Reset adjustments";
    case "effect.add":
      return "Add adjustment";
    case "effect.update":
      return "Edit adjustment";
    case "effect.remove":
      return "Remove adjustment";
    case "transaction":
      return command.label;
  }
}
