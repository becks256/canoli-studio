/**
 * Bidirectional bridge connecting Luma Document model and binary PSD files.
 */

import {
  createDocument,
  createRaster,
  id,
  type DocumentData,
  type RasterLayerData,
} from "../../model";
import { getPsdCapabilityReport, parsePsd } from "./parser";
import { buildPsd, type LayerPixelSource } from "./builder";
import {
  PSD_BLEND_MODE_MAP,
  type PsdCapabilityReport,
  type PsdExportOptions,
  type PsdImportOptions,
} from "./types";

export interface PsdImportResult {
  document: DocumentData;
  report: PsdCapabilityReport;
  assets: Map<string, ImageData>;
}

/**
 * Converts a PSD binary buffer into a Luma DocumentData, capability report, and assets map.
 */
export function psdToDocument(
  buffer: ArrayBuffer | Uint8Array,
  options: PsdImportOptions = {},
): PsdImportResult {
  const parsed = parsePsd(buffer);
  const report = getPsdCapabilityReport(parsed);

  const doc = createDocument(
    "Imported PSD",
    parsed.header.width,
    parsed.header.height,
  );

  const assets = new Map<string, ImageData>();

  const shouldFlatten =
    options.mode === "flatten" ||
    !report.canImportAsLayers ||
    parsed.layers.filter((l) => l.imageData).length === 0;

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

  // Import individual layers
  // Note: PSD layers in the file are bottom-to-top or top-to-bottom depending on version,
  // standard Photoshop layer records are bottom-to-top.
  for (const pLayer of parsed.layers) {
    if (pLayer.isGroupEnd) continue;

    if (pLayer.imageData) {
      const assetId = id();
      assets.set(assetId, pLayer.imageData);

      const blend = PSD_BLEND_MODE_MAP[pLayer.blendModeKey] ?? "normal";
      const opacity = pLayer.opacity / 255.0;

      const rasterLayer = createRaster(
        pLayer.name,
        assetId,
        pLayer.width,
        pLayer.height,
      );
      rasterLayer.x = pLayer.left;
      rasterLayer.y = pLayer.top;
      rasterLayer.opacity = opacity;
      rasterLayer.blendMode = blend;
      rasterLayer.visible = pLayer.flags.visible;

      // User raster layer mask
      if (options.preserveMasks !== false && pLayer.maskData && pLayer.mask) {
        const maskWidth = Math.max(0, pLayer.mask.right - pLayer.mask.left);
        const maskHeight = Math.max(0, pLayer.mask.bottom - pLayer.mask.top);
        if (maskWidth > 0 && maskHeight > 0) {
          rasterLayer.mask = {
            kind: "selection",
            selection: {
              regions: [
                {
                  shape: "rectangle",
                  x: pLayer.mask.left,
                  y: pLayer.mask.top,
                  width: maskWidth,
                  height: maskHeight,
                  operation: "add",
                },
              ],
            },
            enabled: !pLayer.mask.disabled,
            inverted: pLayer.mask.defaultColor === 255,
            density: 1,
            linked: true,
            x: 0,
            y: 0,
          };
        }
      }

      doc.children.push(rasterLayer);
    }
  }

  return { document: doc, report, assets };
}

/**
 * Exports a Luma DocumentData into a binary PSD file.
 */
export async function documentToPsd(
  document: DocumentData,
  assetResolver: (
    assetId: string,
  ) => Promise<ImageData | null> | ImageData | null,
  options: PsdExportOptions = {},
): Promise<Uint8Array> {
  const layersWithPixels: LayerPixelSource[] = [];

  for (const child of document.children) {
    if (child.kind === "raster") {
      const raster = child as RasterLayerData;
      if (raster.erasures?.length)
        throw new Error("PSD export cannot preserve raster erasures yet. Save a Luma project or export PNG to retain the edited pixels.");
      const img = await assetResolver(raster.assetId);
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
