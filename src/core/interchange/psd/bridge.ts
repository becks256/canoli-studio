/**
 * Bidirectional bridge connecting Canoli Studio Document model and binary PSD files.
 */

import {
  createDocument,
  createRaster,
  createGroup,
  type LayerData,
  id,
  type DocumentData,
  type RasterLayerData,
} from "../../model";
import { getPsdCapabilityReport, parsePsd, parsePsdAsync } from "./parser";
import { buildPsd, type LayerPixelSource } from "./builder";
import { validatePsdDimensions } from "./export-plan";
import {psdLayerTree,type PsdLayerNode} from "./groups";
import type {LayerMaskData} from "../../masks";
import {
  PSD_BLEND_MODE_MAP,
  type PsdCapabilityReport,
  type PsdExportOptions,
  type PsdImportOptions,
  type PsdParsedDocument,
} from "./types";

export interface PsdImportResult {
  document: DocumentData;
  report: PsdCapabilityReport;
  assets: Map<string, ImageData>;
}

/**
 * Converts a PSD binary buffer into a Canoli Studio DocumentData, capability report, and assets map.
 */
export function psdToDocument(
  buffer: ArrayBuffer | Uint8Array,
  options: PsdImportOptions = {},
): PsdImportResult {
  return parsedPsdToDocument(parsePsd(buffer, options), options);
}

/** Async trusted adapter, including native 8-bit ZIP and ZIP prediction. */
export async function psdToDocumentAsync(
  buffer: ArrayBuffer | Uint8Array,
  options: PsdImportOptions = {},
): Promise<PsdImportResult> {
  return parsedPsdToDocument(await parsePsdAsync(buffer, options), options);
}

function parsedPsdToDocument(parsed: PsdParsedDocument, options: PsdImportOptions): PsdImportResult {
  const report = getPsdCapabilityReport(parsed, options);

  const doc = createDocument(
    parsed.header.version===2?"Imported PSB":"Imported PSD",
    parsed.header.width,
    parsed.header.height,
  );

  const assets = new Map<string, ImageData>();

  const shouldFlatten =
    options.mode === "flatten" ||
    !report.canImportAsLayers;

  if (shouldFlatten) {
    // Import composite image as single background layer
    if (parsed.composite) {
      const assetId = id();
      assets.set(assetId, parsed.composite);

      const bgLayer = createRaster(
        "Background",
        assetId,
        parsed.header.width,
        parsed.header.height,
      );
      bgLayer.x = 0;
      bgLayer.y = 0;
      bgLayer.opacity = 1;
      bgLayer.blendMode = "normal";
      bgLayer.visible = true;

      doc.children.push(bgLayer);
    }
    return { document: doc, report, assets };
  }

  function nativeMask(pLayer:PsdLayerNode['layer']):LayerMaskData|undefined {
    if(options.preserveMasks===false||!pLayer.mask)return;
    const source=pLayer.mask,white=source.defaultColor===255;
    const settings={enabled:!source.disabled,inverted:white!==!!source.inverted,density:source.density??1,
      linked:source.relativeToLayer??false,x:source.left,y:source.top};
    if(!pLayer.maskData)return{kind:'paint',base:0,strokes:[],...settings};
    const pixels=pLayer.maskData;
    for(let p=0;p<pixels.data.length;p+=4){const value=pixels.data[p];pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=255;pixels.data[p+3]=white?255-value:value;}
    const assetId=id();assets.set(assetId,pixels);return{kind:'bitmap',assetId,...settings};
  }
  function convert(node:PsdLayerNode,parent={x:0,y:0}):LayerData|undefined {
    const source=node.layer;
    let layer:LayerData;
    if(source.isGroup){
      layer=createGroup(source.name);
      // PSD record positions are document-space; native children are local.
      layer.children=node.children.flatMap(child=>{const value=convert(child,{x:source.left,y:source.top});return value?[value]:[];});
      const mode=source.groupBlendModeKey??source.blendModeKey;
      layer.blendMode=mode==='pass'?'pass-through':PSD_BLEND_MODE_MAP[mode]??'normal';
    }else if(source.imageData){
      const assetId=id();assets.set(assetId,source.imageData);
      layer=createRaster(source.name,assetId,source.width,source.height);
      layer.blendMode=PSD_BLEND_MODE_MAP[source.blendModeKey]??'normal';
    }else return;
    layer.x=source.left-parent.x;layer.y=source.top-parent.y;
    layer.opacity=source.opacity/255;layer.visible=source.flags.visible;layer.locked=!!source.protectedFlags||source.flags.transparencyProtected;
    if(source.fillOpacity!==undefined)layer.fillOpacity=source.fillOpacity/255;
    layer.mask=nativeMask(source);
    return layer;
  }
  doc.children=psdLayerTree(parsed.layers).flatMap(node=>{const layer=convert(node);return layer?[layer]:[];});

  return { document: doc, report, assets };
}

/**
 * Exports a Canoli Studio DocumentData into a binary PSD file.
 */
export async function documentToPsd(
  document: DocumentData,
  assetResolver: (
    assetId: string,
  ) => Promise<ImageData | null> | ImageData | null,
  options: PsdExportOptions = {},
): Promise<Uint8Array> {
  validatePsdDimensions(document.width, document.height);
  // This low-level helper has no document renderer. Reject unsupported content
  // instead of silently dropping it; browser export uses engine/psd.ts.
  for (const node of document.children) {
    if (node.kind !== "raster" || node.transform || node.mask || (node.fillOpacity ?? 1) !== 1 ||
      node.erasures?.length || node.styles?.blendIf.enabled || node.styles?.colorOverlay.enabled || node.styles?.dropShadow.enabled ||
      node.effects.some(effect => effect.enabled && (effect.exposure !== 0 || effect.contrast !== 0 || effect.saturation !== 0)))
      throw new Error("This document requires rendered PSD export. Use editor.export({format: 'psd'}) to preserve its appearance.");
    if (!Number.isSafeInteger(node.x) || !Number.isSafeInteger(node.y) ||
      Math.min(node.x, node.y) < -0x80000000 || Math.max(node.x + node.width, node.y + node.height) > 0x7fffffff)
      throw new Error("Fractional or out-of-range raster placement requires rendered PSD export.");
  }
  const layersWithPixels: LayerPixelSource[] = [];

  for (const child of document.children) {
    if (child.kind === "raster") {
      const raster = child as RasterLayerData;
      const img = await assetResolver(raster.assetId);
      if (!img) throw new Error(`Missing image asset for PSD export: ${raster.assetId}`);
      validatePsdDimensions(img.width, img.height);
      if (img.width !== raster.width || img.height !== raster.height)
        throw new Error("Scaled raster placement requires rendered PSD export.");
      if (img) {
        layersWithPixels.push({
          layer: raster,
          imageData: img,
        });
      }
    }
  }

  return buildPsd(document, layersWithPixels, options);
}
