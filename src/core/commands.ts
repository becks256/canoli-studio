import {
  flipCommands,
  distributionCommands,
  type DistributionAxis,
  type DistributionMode,
} from "./layer-layout";
import {
  planLayerComp,
  layerCompSchema,
  type LayerCompData,
} from "./layer-comps";
import { convertLayers } from "./smart/convert";
import { smartFiltersSchema, type SmartFilterData } from "./smart/filters";
import { ComponentRegistry } from "./smart/manager";
import type { SmartComponentDefinition } from "./smart/types";
import type { GuideData } from "./guides";
import { AffineTransform } from "./affine";
import { cropDocument } from "./crop";
import type { CropBounds } from "./crop";
import type {
  SelectionData,
  PaintOperationData,
  VectorPathData,
} from "./drawing";
import { layerMaskSchema, type LayerMaskData } from "./masks";
import { layerTransform, parentId } from "./spatial";
import {
  allLayers,
  createDocument,
  createRaster,
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
  AdjustmentLayerData,
  ToneEffectData,
} from "./model";

export type LayerPatch = Partial<
  Pick<
    LayerBaseData,
    | "transform"
    | "mask"
    | "metadata"
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
      | "text"
      | "fontSize"
      | "fontFamily"
      | "color"
      | "align"
      | "lineHeight"
      | "letterSpacing"
      | "fontWeight"
      | "fontStyle"
      | "direction"
    >
  > &
  Partial<Pick<AdjustmentLayerData, "adjustment">>;

// Serializable commands are the single mutation boundary for UI, automation,
// and a future AI adapter. No renderer or UI code mutates document nodes.
export type EditorCommand =
  | { type: "document.guides"; guides: GuideData[] }
  | { type: "document.rename"; name: string }
  | { type: "document.resize"; width: number; height: number }
  | { type: "document.crop"; bounds: CropBounds }
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
  | { type: "smartObject.filterMask"; id: string; mask: LayerMaskData | null }
  | { type: "smartObject.filters"; id: string; filters: SmartFilterData[] }
  | { type: "layerComp.set"; comp: LayerCompData }
  | { type: "layerComp.remove"; id: string }
  | { type: "layerComp.apply"; id: string }
  | { type: "component.set"; definition: SmartComponentDefinition }
  | { type: "component.remove"; id: string }
  | { type: "component.replaceAll"; definitions: SmartComponentDefinition[] }
  | {
      type: "smartObject.duplicateIndependent";
      id: string;
      instanceId: string;
      componentIds: Record<string, string>;
    }
  | { type: "smartObject.convertToRaster"; id: string; layer: RasterLayerData }
  | {
      type: "smartObject.convertLayers";
      ids: string[];
      componentId: string;
      instanceId: string;
    }
  | {
      type: "smartObject.convertRaster";
      id: string;
      componentId: string;
      instanceId: string;
    }
  | { type: "layer.flip"; ids: string[]; axis: DistributionAxis }
  | {
      type: "layer.distribute";
      ids: string[];
      axis: DistributionAxis;
      mode: DistributionMode;
    }
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
  | { type: "mask.setFromMatting"; id: string; mask: LayerMaskData }
  | { type: "transaction"; label: string; commands: EditorCommand[] };

function apply(document: DocumentData, command: EditorCommand): void {
  if (command.type === "transaction") {
    for (const child of command.commands) apply(document, child);
    return;
  }
  if (command.type === "component.replaceAll") {
    const before = new ComponentRegistry(document.components);
    const after = new ComponentRegistry(command.definitions);
    const old = new Map(before.values().map((value) => [value.id, value]));
    const next = new Map(after.values().map((value) => [value.id, value]));
    const affected = new Set<string>();
    for (const key of new Set([...old.keys(), ...next.keys()])) {
      if (JSON.stringify(old.get(key)) === JSON.stringify(next.get(key)))
        continue;
      if (old.has(key))
        for (const dependent of before.affectedBy(key)) affected.add(dependent);
      if (next.has(key))
        for (const dependent of after.affectedBy(key)) affected.add(dependent);
    }
    for (const layer of allLayers(document.children)) {
      if (
        layer.kind === "smart-object" &&
        affected.has(layer.componentId) &&
        isLocked(document, layer.id)
      )
        throw new Error("A locked instance prevents updating this component.");
    }
    document.components = after.values();
    return;
  }
  if (command.type === "smartObject.convertLayers") {
    convertLayers(
      document,
      command.ids,
      command.componentId,
      command.instanceId,
    );
    return;
  }
  if (command.type === "component.set") {
    const update = new ComponentRegistry(document.components).withDefinitions([
      command.definition,
    ]);
    for (const layer of allLayers(document.children))
      if (
        layer.kind === "smart-object" &&
        update.invalidated.has(layer.componentId) &&
        isLocked(document, layer.id)
      ) {
        throw new Error("A locked instance prevents updating this component.");
      }
    document.components = update.registry.values();
    return;
  }
  if (command.type === "component.remove") {
    if (
      allLayers(document.children).some(
        (layer) =>
          layer.kind === "smart-object" && layer.componentId === command.id,
      )
    )
      throw new Error("Component is still placed in the document.");
    document.components = new ComponentRegistry(document.components)
      .without(command.id)
      .values();
    return;
  }
  if (command.type === "selection.set") {
    document.selection = structuredClone(command.selection);
    return;
  }
  if (command.type === "layerComp.set") {
    const comp = layerCompSchema.parse(command.comp);
    if (comp.documentId !== document.id)
      throw new Error("Layer comp belongs to another document.");
    const entries = document.layerComps ?? [];
    const index = entries.findIndex((entry) => entry.id === comp.id);
    if (index < 0) entries.push(comp);
    else entries[index] = comp;
    document.layerComps = entries;
    return;
  }
  if (
    command.type === "layerComp.remove" ||
    command.type === "layerComp.apply"
  ) {
    const comp = document.layerComps?.find((entry) => entry.id === command.id);
    if (!comp) throw new Error("Layer comp not found.");
    if (command.type === "layerComp.remove")
      document.layerComps = document.layerComps!.filter(
        (entry) => entry.id !== command.id,
      );
    else apply(document, planLayerComp(document, comp).command);
    return;
  }
  if (command.type === "layer.flip") {
    for (const change of flipCommands(document, command.ids, command.axis))
      apply(document, change);
    return;
  }
  if (command.type === "layer.distribute") {
    for (const change of distributionCommands(
      document,
      command.ids,
      command.axis,
      command.mode,
    ))
      apply(document, change);
    return;
  }
  if (command.type === "document.guides") {
    document.guides = structuredClone(command.guides);
    return;
  }
  if (command.type === "document.rename") {
    document.name = command.name;
    return;
  }
  if (command.type === "document.crop") {
    cropDocument(document, command.bounds);
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
    case "smartObject.filterMask": {
      if (layer.kind !== "smart-object")
        throw new Error("Filter masks require a smart-object instance.");
      layer.filterMask =
        command.mask === null ? null : layerMaskSchema.parse(command.mask);
      return;
    }
    case "smartObject.filters": {
      if (layer.kind !== "smart-object")
        throw new Error("Smart filters require a smart-object instance.");
      layer.smartFilters = smartFiltersSchema.parse(command.filters);
      return;
    }
    case "smartObject.duplicateIndependent": {
      if (layer.kind !== "smart-object")
        throw new Error("Independent copy requires a smart-object layer.");
      if (
        allLayers(document.children).some(
          (node) => node.id === command.instanceId,
        )
      )
        throw new Error("Instance ID already exists.");
      const registry = new ComponentRegistry(
        document.components,
      ).withIndependentCopy(layer.componentId, command.componentIds);
      const copy = structuredClone(layer);
      copy.id = command.instanceId;
      copy.componentId = command.componentIds[layer.componentId];
      copy.name = `${copy.name.slice(0, 234)} copy`;
      copy.x += 24;
      copy.y += 24;
      document.components = registry.values();
      siblings.splice(siblings.indexOf(layer) + 1, 0, copy);
      return;
    }
    case "smartObject.convertToRaster": {
      if (layer.kind !== "smart-object" || command.layer.kind !== "raster")
        throw new Error(
          "Rasterization requires a smart-object source and raster result.",
        );
      if (
        allLayers(document.children).some(
          (node) => node.id === command.layer.id,
        )
      )
        throw new Error("Raster result ID already exists.");
      siblings.splice(
        siblings.indexOf(layer),
        1,
        structuredClone(command.layer),
      );
      return;
    }
    case "smartObject.convertRaster": {
      if (layer.kind !== "raster")
        throw new Error("Conversion currently requires a raster layer.");
      if (
        document.components?.some(
          (component) => component.id === command.componentId,
        )
      )
        throw new Error("Component ID already exists.");
      if (
        allLayers(document.children).some(
          (node) => node.id === command.instanceId,
        )
      )
        throw new Error("Instance ID already exists.");
      const { assetId, effects, kind: _kind, ...placement } = layer;
      const width = Math.ceil(layer.width),
        height = Math.ceil(layer.height);
      const source = createRaster(layer.name, assetId, width, height);
      source.id = `${command.componentId}:source`;
      source.effects = structuredClone(effects);
      const master = createDocument(layer.name, width, height);
      master.id = command.componentId;
      master.children = [source];
      const definition: SmartComponentDefinition = {
        id: command.componentId,
        name: layer.name,
        source: effects.length
          ? { kind: "document", document: master }
          : { kind: "asset", assetId, width, height },
      };
      document.components = new ComponentRegistry(document.components)
        .withDefinitions([definition])
        .registry.values();
      siblings.splice(siblings.indexOf(layer), 1, {
        ...placement,
        id: command.instanceId,
        kind: "smart-object",
        componentId: command.componentId,
      });
      return;
    }
    case "layer.update":
      if (
        Object.keys(command.patch).some(
          (key) =>
            ![
              "transform",
              "mask",
              "metadata",
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
              "letterSpacing",
              "fontWeight",
              "fontStyle",
              "direction",
              "adjustment",
            ].includes(key),
        )
      ) {
        throw new Error("Unsupported layer property.");
      }
      if (
        layer.kind !== "raster" &&
        layer.kind !== "text" &&
        layer.kind !== "smart-object" &&
        ("width" in command.patch || "height" in command.patch)
      )
        throw new Error(
          "Only raster and text layers have intrinsic dimensions.",
        );
      if (layer.kind !== "adjustment" && "adjustment" in command.patch) {
        throw new Error("Only adjustment layers have adjustment settings.");
      }
      Object.assign(layer, command.patch);
      if (layer.kind === "text") {
        const bounds = measureTextBounds(
          layer.text,
          layer.fontSize,
          layer.fontFamily,
          layer.lineHeight,
          {
            letterSpacing: layer.letterSpacing,
            fontWeight: layer.fontWeight,
            fontStyle: layer.fontStyle,
          },
        );
        layer.width = bounds.width;
        layer.height = bounds.height;
      }
      break;
    case "mask.setFromMatting":
      layer.mask = structuredClone(command.mask);
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
      const world = layerTransform(document, layer.id)!;
      const destinationWorld = destinationId
        ? layerTransform(document, destinationId)!
        : new AffineTransform();
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
        const local = destinationWorld.inverse().multiply(world).toJSON();
        layer.x = local.e;
        layer.y = local.f;
        layer.transform = { ...local, e: 0, f: 0 };
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
  checkComponents = true,
): DocumentData {
  const next = structuredClone(document);
  apply(next, command);
  validateDocument(next, checkComponents);
  return next;
}

export function describe(command: EditorCommand): string {
  switch (command.type) {
    case "layer.flip":
      return "Flip selected layers";
    case "layer.distribute":
      return "Distribute selected layers";
    case "layerComp.set":
      return "Save layer comp";
    case "layerComp.remove":
      return "Remove layer comp";
    case "layerComp.apply":
      return "Apply layer comp";
    case "smartObject.duplicateIndependent":
      return "New smart object via copy";
    case "smartObject.filterMask":
      return "Edit smart-filter mask";
    case "smartObject.filters":
      return "Edit smart filters";
    case "smartObject.convertLayers":
      return "Convert selection to smart object";
    case "smartObject.convertToRaster":
      return "Rasterize smart object";
    case "smartObject.convertRaster":
      return "Convert to smart object";
    case "component.replaceAll":
      return "Apply smart-object contents";
    case "component.set":
      return "Update component";
    case "component.remove":
      return "Remove component";
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
    case "document.guides":
      return "Edit guides";
    case "document.rename":
      return "Rename document";
    case "document.resize":
      return "Resize artboard";
    case "document.crop":
      return "Crop canvas";
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
    case "mask.setFromMatting":
      return "Refine edge mask";
    case "transaction":
      return command.label;
  }
}

/** Session tool coordinates must be discarded after these operations, including undo/redo. */
export function changesCanvasSpace(command: EditorCommand): boolean {
  return (
    command.type === "document.crop" ||
    command.type === "document.resize" ||
    (command.type === "transaction" &&
      command.commands.some(changesCanvasSpace))
  );
}
