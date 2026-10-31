import {localBounds} from '../spatial';
import { AffineTransform } from "../affine";
import { isActiveSmartFilter } from './filters';
import {activePerspective} from '../perspective';
import { rebaseUnlinkedMask } from "../masks";
import {
  base,
  type DocumentData,
  type LayerBaseData,
  type LayerData,
} from "../model";
import { ComponentRegistry } from "./manager";
import type { SmartDocumentData, SmartLayerData } from "./types";

export interface ComponentExpansionBudget {
  maxNodes?: number;
  maxDepth?: number;
  preserveFiltered?: boolean;
  /** @internal Renderer-only read view; public defaults remain defensive. */
  retainImmutable?: boolean;
  /** @internal SVG export keeps generated master-canvas clips as editable geometry. */
  vectorCanvasClips?: boolean;
  /** @internal Identify generated SVG boundaries without relying on names/IDs. */
  onVectorCanvasClip?: (layerId: string) => void;
  /** @internal Reference-frame adapter for renderer root/document transforms. */
  maskFrame?:AffineTransform;
}
/** Ephemeral render tree only. Never replace authored definitions with this expansion. */
export function resolveSmartDocument(
  input: SmartDocumentData,
  registry: ComponentRegistry,
  budget: ComponentExpansionBudget = {},
): DocumentData {
  const maxNodes = budget.maxNodes ?? 4096;
  const maxDepth = budget.maxDepth ?? 64;
  if (
    ![maxNodes, maxDepth].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error("Invalid component expansion budget.");
  if(budget.maskFrame!==undefined&&!(budget.maskFrame instanceof AffineTransform))throw new Error('Use an affine component mask frame.');
  const document = budget.retainImmutable ? registry.validatedView(input) : registry.validatePlacements(input);
  const used = new Set<string>();
  const reserve = (layers: SmartLayerData[]) => {
    for (const layer of layers) {
      used.add(layer.id);
      if (layer.kind === "group") reserve(layer.children);
    }
  };
  reserve(document.children);
  const allocate = (path: string[]): string => {
    const stem = `component:${JSON.stringify(path)}`;
    let value = stem;
    let suffix = 0;
    while (used.has(value)) value = `${stem}:${++suffix}`;
    used.add(value);
    return value;
  };
  let count = 0;
  const enter = (depth: number) => {
    if (++count > maxNodes || depth > maxDepth)
      throw new Error("Component expansion exceeds the render-tree budget.");
  };
  // Preserving a filtered node must not bypass the logical component expansion budget.
  function countExpansion(layer: SmartLayerData, depth: number): void {
    enter(depth);
    if (layer.kind === "group")
      layer.children.forEach((child) => countExpansion(child, depth + 1));
    else if (layer.kind === "smart-object")
      countMaster(layer.componentId, depth);
  }
  function countMaster(componentId: string, depth: number): void {
    const source = registry.get(componentId).source;
    if (source.kind === "document") {
      enter(depth + 1);
      source.document.children.forEach((child) =>
        countExpansion(child, depth + 2),
      );
    }
  }
  const basis = (layer: Pick<LayerBaseData, 'x' | 'y' | 'transform'>) =>
    AffineTransform.translation(layer.x, layer.y).multiply(
      layer.transform
        ? AffineTransform.fromJSON(layer.transform)
        : new AffineTransform(),
    );
  function expand(
    layer: SmartLayerData,
    parent: AffineTransform,
    documentFrame:AffineTransform,
    scoped: boolean,
    path: string[],
    depth: number,
    frequencyRadius?: number,
  ): LayerData {
    enter(depth);
    const world = parent.multiply(basis(layer));
    const properties = {
      ...layer,
      id: scoped ? allocate([...path, layer.id]) : layer.id,
    };
    // Flattened render/export nodes retain resolved typography, not links into
    // an embedded document's independent style-library namespace.
    if(scoped&&layer.kind==='text')delete (properties as import('../model').TextLayerData).paragraphStyle;
    if (layer.kind === 'smart-object' && frequencyRadius !== undefined && layer.smartFilters?.some(filter => filter.kind === 'frequency-band' && filter.sigma !== frequencyRadius)) {
      (properties as typeof layer).smartFilters = layer.smartFilters.map(filter => filter.kind === 'frequency-band' ? {...filter,sigma:frequencyRadius} : filter);
    }
    if (scoped && properties.mask?.linked === false) {
      properties.mask = rebaseUnlinkedMask(properties.mask,documentFrame);
    }
    if (layer.kind === "group")
      return {
        ...properties,
        kind: "group",
        children: layer.children.map((child) =>
            expand(child, world, documentFrame,scoped, [...path, layer.id], depth + 1, layer.frequencyRadius ?? frequencyRadius),
        ),
      };
    if (layer.kind !== "smart-object") return properties as LayerData;
    if (scoped && layer.filterMask?.linked === false) {
      (properties as typeof layer).filterMask = rebaseUnlinkedMask(layer.filterMask,documentFrame);
    }
    if (activePerspective(layer.perspective)||layer.smartFilters?.some(isActiveSmartFilter)) {
      if (!budget.preserveFiltered)
        throw new Error(
          "Filtered smart objects require the native-plane renderer.",
        );
      countMaster(layer.componentId, depth);
      return properties as LayerData;
    }
    const {
      componentId: _component,
      width: _width,
      height: _height,
      kind: _kind,
      ...instance
    } = properties as typeof layer;
    const source = registry.get(layer.componentId).source;
    if (source.kind === "asset")
      return {
        ...instance,
        kind: "raster",
        assetId: source.assetId,
        width: layer.width,
        height: layer.height,
        effects: [],
      };
    const master = source.document;
    const sole = master.children.length === 1 ? master.children[0] : undefined;
    // A full-frame raster already supplies the artboard boundary. Applying a second
    // transformed clip multiplies edge antialiasing and changes converted pixels.
    const ordinaryRaster = sole?.kind === "raster" &&
      !sole.clipped &&
      sole.visible &&
      sole.x === 0 &&
      sole.y === 0 &&
      sole.width === master.width &&
      sole.height === master.height &&
      sole.opacity === 1 &&
      (sole.fillOpacity ?? 1) === 1 &&
      sole.blendMode === "normal" &&
      !sole.transform &&
      !sole.mask &&
      !sole.styles;
    const footprint=ordinaryRaster?localBounds(sole):undefined;
    const containsFootprint=!!footprint&&footprint.x>=0&&footprint.y>=0&&footprint.x+footprint.width<=master.width&&footprint.y+footprint.height<=master.height;
    if (ordinaryRaster&&containsFootprint&&!activePerspective(sole.perspective)) {
      return {
        ...instance,
        kind: "raster",
        assetId: sole.assetId,
        width: layer.width,
        height: layer.height,
        effects: structuredClone(sole.effects),
        erasures: sole.erasures ? structuredClone(sole.erasures) : undefined,
      };
    }
    const scope = [...path, layer.id, layer.componentId];
    const contentScale=AffineTransform.scale(layer.width/master.width,layer.height/master.height);
    const contentFrame=documentFrame.multiply(world).multiply(contentScale);
    // Separate placement from source scaling so instance masks use instance-pixel coordinates.
    enter(depth + 1);
    const content: LayerData = {
      ...base("Component contents"),
      id: allocate([...scope, "contents"]),
      kind: "group",
      transform: contentScale.toJSON(),
      mask: ordinaryRaster&&containsFootprint?null:budget.vectorCanvasClips ? {
        kind:'vector',enabled:true,inverted:false,density:1,linked:true,fillRule:'nonzero',
        paths:[{points:[{x:0,y:0},{x:master.width,y:0},{x:master.width,y:master.height},{x:0,y:master.height}].map(point=>({...point,in:{...point},out:{...point}}))}],
      } : {
        kind: "selection",
        enabled: true,
        inverted: false,
        density: 1,
        linked: true,
        selection: {
          regions: [
            {
              shape: "rectangle",
              operation: "add",
              x: 0,
              y: 0,
              width: master.width,
              height: master.height,
            },
          ],
        },
      },
      children: master.children.map((child) =>
        expand(child, new AffineTransform(),contentFrame, true, scope, depth + 2),
      ),
    };
    if (budget.vectorCanvasClips&&content.mask) budget.onVectorCanvasClip?.(content.id);
    return { ...instance, kind: "group", children: [content] };
  }
  const { components: _definitions, ...ordinary } = document;
  return {
    ...ordinary,
    children: document.children.map((layer) =>
      expand(layer, new AffineTransform(),budget.maskFrame??new AffineTransform(), false, [], 0),
    ),
  };
}
