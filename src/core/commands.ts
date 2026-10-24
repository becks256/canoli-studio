import { replaceVectorPaths, type VectorBooleanSelection } from './vector-boolean';
import {replaceDocumentFont} from './font-management';
import {documentFontUsage,fontFamilyRequestSchema} from './font-management';
import {fontFileSchema,documentFontFiles,visitFontFileScopes,type FontFileData} from './font-files';
import {sameFontResource} from '../fonts/resources';
import {fontFamilyNames,replaceFontFamilyToken} from './font-families';
import {paragraphStyleSchema,resolveParagraphStyleLibrary,paragraphOverrideKeysSchema,paragraphFormat,paragraphTextLayers,PARAGRAPH_FORMAT_KEYS,resolveParagraphBinding,sameParagraphFormat,type ParagraphStyleData,type ParagraphFormat} from './paragraph-styles';
import {vectorStrokeKeys} from './vector-stroke';
import { isImmutable, shareUnchanged } from "./immutable";
import { lassoSelection, polygonSelectionSchema } from "./lasso";
import {
  flipCommands,
  distributionCommands,
  alignmentCommands,
  type LayerAlignment,
  type AlignmentTarget,
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
import { resizeImage } from "./image-resize";
import { alphaChannelSchema, type AlphaChannelData } from './alpha-channels';
import { cropDocument } from "./crop";
import type { CropBounds } from "./crop";
import type {
  SelectionData,
  SelectionOperation,
  Point,
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
  LayerBlendMode,
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
    | "x"
    | "y"
  >
> & { blendMode?: LayerBlendMode; frequencyRadius?: number | null } &
  Partial<Pick<RasterLayerData, "width" | "height" | "erasures">> &
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
      | "wordSpacing"
      | "fontKerning"
      | "fontVariantCaps"
      | "fontStretch"
      | "wrapWidth"
      | "paragraphSpacing"
      | "firstLineIndent"
      | "paragraphJustify"
      | "fontWeight"
      | "fontStyle"
      | "direction"
    >
  > &
  Partial<Pick<AdjustmentLayerData, "adjustment">>;

// Serializable commands are the single mutation boundary for UI, automation,
// and a future AI adapter. No renderer or UI code mutates document nodes.
export type EditorCommand =
  | {type:'layer.align';ids:string[];alignment:LayerAlignment;target?:AlignmentTarget}
  | {type:'font.file.add';file:FontFileData}
  | {type:'font.file.rename';id:string;name:string}
  | {type:'font.file.remove';id:string;replaceWith?:string}
  | {type:'paragraphStyle.set';style:ParagraphStyleData}
  | {type:'paragraphStyle.remove';id:string}
  | {type:'document.font.replace';from:string;to:string}
  | {type:'text.paragraphStyle';id:string;styleId:string|null;keepOverrides?:boolean}
  | {type:'text.paragraphOverrides.clear';id:string;keys?:(keyof ParagraphFormat)[]}
  | { type: "document.guides"; guides: GuideData[] }
  | { type: "document.rename"; name: string }
  | { type: "document.resize"; width: number; height: number }
  | { type: "document.resizeImage"; width: number; height: number }
  | { type: "document.crop"; bounds: CropBounds }
  | { type: "selection.set"; selection: SelectionData | null }
  | { type: "selection.polygon"; points: Point[]; operation?: "replace" | SelectionOperation }
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
  | { type: "paths.replace"; operands: VectorBooleanSelection['operands']; result: VectorPathData | null }
  | { type: "smartObject.filterMask"; id: string; mask: LayerMaskData | null }
  | { type: "smartObject.filters"; id: string; filters: SmartFilterData[] }
  | { type: "layerComp.set"; comp: LayerCompData }
  | { type: 'alphaChannel.set'; channel: AlphaChannelData }
  | { type: 'alphaChannel.remove'; id: string }
  | { type: 'alphaChannel.reorder'; id: string; direction: 'up'|'down' }
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

function reflowText(layer:TextLayerData){
  const bounds=measureTextBounds(layer.text,layer.fontSize,layer.fontFamily,layer.lineHeight,{
    letterSpacing:layer.letterSpacing,wordSpacing:layer.wordSpacing,fontKerning:layer.fontKerning,
    direction:layer.direction,fontWeight:layer.fontWeight,fontStyle:layer.fontStyle,wrapWidth:layer.wrapWidth,
    fontVariantCaps:layer.fontVariantCaps,fontStretch:layer.fontStretch,
    paragraphSpacing:layer.paragraphSpacing,firstLineIndent:layer.firstLineIndent,paragraphJustify:layer.paragraphJustify,
  });
  layer.width=bounds.width;layer.height=bounds.height;
}
function apply(document: DocumentData, command: EditorCommand): void {
  if(command.type==='font.file.add'){
    const file=fontFileSchema.parse(command.file),existing=documentFontFiles(document).find(value=>value.id===file.id);
    if(existing){if(!sameFontResource(existing.resource,file.resource))throw new Error('Font resource identity collision.');return;}
    const family=file.resource.report.faces[0].cssFamily.toLowerCase();
    for(const request of documentFontUsage(document))if(fontFamilyNames(request.family).includes(family))replaceDocumentFont(document,request.family,request.family,reflowText,(scope,definitions)=>apply(scope,{type:'component.replaceAll',definitions}),true);
    document.fontFiles=[...(document.fontFiles??[]),file];return;
  }
  if(command.type==='font.file.rename'){
    const name=fontFileSchema.shape.name.parse(command.name);let found=false;
    visitFontFileScopes(document,scope=>{for(const file of scope.fontFiles??[])if(file.id===command.id){file.name=name;found=true;}});
    if(!found)throw new Error('Font file not found.');return;
  }
  if(command.type==='font.file.remove'){
    const file=documentFontFiles(document).find(value=>value.id===command.id);if(!file)throw new Error('Font file not found.');
    const family=file.resource.report.faces[0].cssFamily,requests=documentFontUsage(document).filter(request=>fontFamilyNames(request.family).includes(family.toLowerCase()));
    if(requests.length&&command.replaceWith===undefined)throw new Error('This font file is in use. Choose a replacement before removing it.');
    if(command.replaceWith!==undefined){fontFamilyRequestSchema.parse(command.replaceWith);if(fontFamilyNames(command.replaceWith).includes(family.toLowerCase()))throw new Error('The replacement still references the font being removed.');}
    const replacements=requests.map(request=>({from:request.family,to:fontFamilyRequestSchema.parse(replaceFontFamilyToken(request.family,family,command.replaceWith!))}));
    for(const replacement of replacements)replaceDocumentFont(document,replacement.from,replacement.to,reflowText,(scope,definitions)=>apply(scope,{type:'component.replaceAll',definitions}));
    visitFontFileScopes(document,scope=>{if(scope.fontFiles)scope.fontFiles=scope.fontFiles.filter(value=>value.id!==file.id);});return;
  }
  if(command.type==='document.font.replace'){
    replaceDocumentFont(document,command.from,command.to,reflowText,(scope,definitions)=>apply(scope,{type:'component.replaceAll',definitions}));return;
  }
  if (command.type === 'paths.replace') { replaceVectorPaths(document, command.operands, command.result); return; }
  if (command.type === "transaction") {
    for (const child of command.commands) apply(document, child);
    return;
  }
  if(command.type==='paragraphStyle.set'){
    const style=paragraphStyleSchema.parse(command.style),entries=[...(document.paragraphStyles??[])],index=entries.findIndex(value=>value.id===style.id);
    if(index<0)entries.push(style);else entries[index]=style;
    const resolved=resolveParagraphStyleLibrary(entries),updated=resolved.find(value=>value.id===style.id)!;
    if(!sameParagraphFormat(updated.format,style.format))throw new Error('Paragraph style formatting disagrees with its base and overrides.');
    const byId=new Map(resolved.map(value=>[value.id,value]));
    for(const layer of paragraphTextLayers(document.children))if(layer.paragraphStyle){
      const definition=byId.get(layer.paragraphStyle.id);if(!definition)throw new Error('Paragraph style not found.');
      const expected={...definition.format,...layer.paragraphStyle.overrides};
      if(!sameParagraphFormat(paragraphFormat(layer),expected)){
        if(isLocked(document,layer.id))throw new Error('Unlock text and its parent groups before changing a linked paragraph style.');
        resolveParagraphBinding(layer,definition);reflowText(layer);
      }
    }
    document.paragraphStyles=resolved;return;
  }
  if(command.type==='paragraphStyle.remove'){
    if(!document.paragraphStyles?.some(style=>style.id===command.id))throw new Error('Paragraph style not found.');
    for(const layer of paragraphTextLayers(document.children))if(layer.paragraphStyle?.id===command.id){
      if(isLocked(document,layer.id))throw new Error('Unlock linked text before removing its paragraph style.');
      delete layer.paragraphStyle;
    }
    document.paragraphStyles=document.paragraphStyles.filter(style=>style.id!==command.id).map(style=>{
      if(style.basedOn?.id!==command.id)return style;
      const detached={...style};delete detached.basedOn;return detached;
    });return;
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
  if(command.type==='alphaChannel.set'){
    const channel=alphaChannelSchema.parse(command.channel),entries=document.alphaChannels??[];
    const index=entries.findIndex(entry=>entry.id===channel.id);
    if(index<0)entries.push(channel);else entries[index]=channel;
    document.alphaChannels=entries;return;
  }
  if(command.type==='alphaChannel.remove'||command.type==='alphaChannel.reorder'){
    const entries=document.alphaChannels??[],index=entries.findIndex(entry=>entry.id===command.id);
    if(index<0)throw new Error('Alpha channel not found.');
    if(command.type==='alphaChannel.remove')document.alphaChannels=entries.filter(entry=>entry.id!==command.id);
    else{
      if(command.direction!=='up'&&command.direction!=='down')throw new Error('Invalid alpha channel direction.');
      const target=index+(command.direction==='up'?-1:1);
      if(target>=0&&target<entries.length)[entries[index],entries[target]]=[entries[target],entries[index]];
    }
    return;
  }
  if (command.type === "selection.set") {
    document.selection = structuredClone(command.selection);
    return;
  }
  if (command.type === "selection.polygon") {
    const { points, operation } = polygonSelectionSchema.parse({ points: command.points, operation: command.operation });
    const selection = lassoSelection(points, document.width, document.height);
    if (!selection.regions.length)
      throw new Error("The polygon must cover at least one canvas pixel.");
    document.selection = operation === "replace" ? selection : {
      regions: [...(document.selection?.regions ?? []), { ...selection.regions[0], operation }],
    };
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
  if(command.type==='layer.align'){
    // Layout moves authored boxes; ordinary text updates may reflow against a
    // different available font set, changing the very bounds being aligned.
    for(const change of alignmentCommands(document,command.ids,command.alignment,command.target)){
      const layer=findLayer(document,change.id)!;layer.x=change.patch.x;layer.y=change.patch.y;
    }
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
  if (command.type === "document.resizeImage") {
    resizeImage(document, command.width, command.height);
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
    case 'text.paragraphStyle': {
      if(layer.kind!=='text')throw new Error('Paragraph styles require a text layer.');
      if(command.styleId===null){delete layer.paragraphStyle;return;}
      const style=document.paragraphStyles?.find(value=>value.id===command.styleId);if(!style)throw new Error('Paragraph style not found.');
      layer.paragraphStyle={id:style.id,overrides:command.keepOverrides?structuredClone(layer.paragraphStyle?.overrides??{}):{}};
      resolveParagraphBinding(layer,style);reflowText(layer);return;
    }
    case 'text.paragraphOverrides.clear': {
      if(layer.kind!=='text'||!layer.paragraphStyle)throw new Error('Select text with a linked paragraph style.');
      const style=document.paragraphStyles?.find(value=>value.id===layer.paragraphStyle!.id);if(!style)throw new Error('Paragraph style not found.');
      layer.paragraphStyle=structuredClone(layer.paragraphStyle);
      for(const key of command.keys===undefined?PARAGRAPH_FORMAT_KEYS:paragraphOverrideKeysSchema.parse(command.keys))delete layer.paragraphStyle.overrides[key];
      resolveParagraphBinding(layer,style);reflowText(layer);return;
    }
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
      const { assetId, effects, erasures, kind: _kind, ...placement } = layer;
      const width = Math.ceil(layer.width),
        height = Math.ceil(layer.height);
      const source = createRaster(layer.name, assetId, width, height);
      source.id = `${command.componentId}:source`;
      source.effects = structuredClone(effects);
      if (erasures) source.erasures = structuredClone(erasures);
      const master = createDocument(layer.name, width, height);
      master.id = command.componentId;
      master.children = [source];
      const definition: SmartComponentDefinition = {
        id: command.componentId,
        name: layer.name,
        source: effects.length || erasures?.length
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
      if ("frequencyRadius" in command.patch && layer.kind !== "group") throw new Error("A shared frequency radius requires a group.");
      if ("erasures" in command.patch && layer.kind !== "raster") throw new Error("Erasures require a raster layer.");
      if (layer.kind !== 'text' && ['text','fontSize','fontFamily','color','align','lineHeight','letterSpacing','wordSpacing','fontKerning','fontVariantCaps','fontStretch','fontWeight','fontStyle','direction'].some(key=>key in command.patch))
        throw new Error('Typography properties require a text layer.');
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
              "frequencyRadius",
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
              "wordSpacing",
              "fontKerning",
              "fontVariantCaps",
              "fontStretch",
              "wrapWidth",
              "paragraphSpacing",
              "firstLineIndent",
              "paragraphJustify",
              "fontWeight",
              "fontStyle",
              "direction",
              "adjustment",
              "erasures",
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
        if(layer.paragraphStyle){
          const style=document.paragraphStyles?.find(value=>value.id===layer.paragraphStyle!.id);if(!style)throw new Error('Paragraph style not found.');
          const overrides={...layer.paragraphStyle.overrides};
          for(const key of PARAGRAPH_FORMAT_KEYS)if(key in command.patch){
            const value=command.patch[key];if(value===undefined)delete overrides[key];else(overrides as Record<string,unknown>)[key]=value;
          }
          layer.paragraphStyle={id:style.id,overrides};resolveParagraphBinding(layer,style);
        }
        reflowText(layer);
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
            for (const contour of path.subpaths ?? []) contour.id = command.newIds?.[contour.id] ?? id();
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
            !["points", "closed", "fill", "stroke", "strokeWidth","fillGradient","fillRule","subpaths",...vectorStrokeKeys].includes(
              key,
            ),
        )
      )
        throw new Error("Unsupported path property.");
      const { points, ...properties } = command.patch;
      Object.assign(path, structuredClone(properties));
      if ("points" in command.patch)
        path.points = points?.map(point => isImmutable(point) ? point : structuredClone(point)) as typeof path.points;
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
  // Store-owned snapshots are recursively frozen. Common editing commands only
  // need a new root and the path to their target, never copies of pixel coverage.
  while (command.type === "transaction" && command.commands.length === 1) command = command.commands[0];
  let next: DocumentData;
  const rootOnly = ["document.rename", "document.resize", "document.guides", "selection.set", "selection.polygon"].includes(command.type);
  const targeted = command.type === "layer.update" || command.type === "paint.add" || command.type === "paint.remove" || command.type === "path.update" || command.type === "path.add" || command.type === "path.remove";
  if (isImmutable(document) && rootOnly) next = { ...document };
  else if (isImmutable(document) && command.type === 'paths.replace') {
    const targets=new Set(command.operands.map(ref=>ref.layerId));
    const copy=(nodes:LayerData[]):LayerData[]=>nodes.map(node=>{
      if(node.kind==='vector'&&targets.has(node.id))return {...node};
      if(node.kind==='group'){
        const children=copy(node.children);
        if(children.some((child,index)=>child!==node.children[index]))return {...node,children};
      }
      return node;
    });
    next={...document,children:copy(document.children)};
  }
  else if (isImmutable(document) && targeted) {
    const targetId = "id" in command ? command.id : "";
    const copyPath = (nodes: LayerData[]): LayerData[] => nodes.map(node => {
      if (node.id === targetId) {
        if (command.type === "path.add" && node.kind === "vector") return { ...node, paths: [...node.paths] };
        if (command.type === "path.update" && node.kind === "vector")
          return { ...node, paths: node.paths.map(path => path.id === command.pathId ? { ...path } : path) };
        if (command.type === "paint.add" && node.kind === "paint") return { ...node, strokes: [...node.strokes] };
        return { ...node };
      }
      if (node.kind === "group" && findLayer({ ...document, children: node.children }, targetId)) return { ...node, children: copyPath(node.children) };
      return node;
    });
    next = { ...document, children: copyPath(document.children) };
  } else next = structuredClone(document);
  // Erasure updates append to immutable prior records. Copy only new records;
  // cloning every previous selection clip here makes each stroke more expensive.
  if (command.type === "layer.update") {
    const { erasures, ...rest } = command.patch;
    const patch = structuredClone(rest) as LayerPatch;
    if ("erasures" in command.patch)
      patch.erasures = erasures?.map(entry => isImmutable(entry) ? entry : structuredClone(entry));
    apply(next, { ...command, patch });
  } else apply(next, command);
  validateDocument(next, checkComponents);
  return shareUnchanged(document, next);
}

export function describe(command: EditorCommand): string {
  switch (command.type) {
    case 'layer.align':return command.target?.type==='canvas'?'Align layers to canvas':command.target?.type==='layer'?'Align layers to key object':'Align selected layers';
    case 'font.file.add':return 'Embed font file';
    case 'font.file.rename':return 'Rename font file';
    case 'font.file.remove':return 'Remove font file';
    case 'document.font.replace':return 'Replace document font';
    case 'paragraphStyle.set':return 'Edit paragraph style';
    case 'paragraphStyle.remove':return 'Remove paragraph style';
    case 'text.paragraphStyle':return command.styleId?'Apply paragraph style':'Detach paragraph style';
    case 'text.paragraphOverrides.clear':return 'Reset paragraph style overrides';
    case 'alphaChannel.set': return 'Save alpha channel';
    case 'alphaChannel.remove': return 'Remove alpha channel';
    case 'alphaChannel.reorder': return 'Reorder alpha channel';
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
    case "selection.polygon":
      return "Polygon selection";
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
    case "paths.replace":
      return "Combine vector paths";
    case "document.guides":
      return "Edit guides";
    case "document.rename":
      return "Rename document";
    case "document.resizeImage":
      return "Resize image";
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
    command.type === "document.resizeImage" ||
    command.type === "document.crop" ||
    command.type === "document.resize" ||
    (command.type === "transaction" &&
      command.commands.some(changesCanvasSpace))
  );
}
