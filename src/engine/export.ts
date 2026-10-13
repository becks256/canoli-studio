import { checkExport, type ExportControl } from "./export-control";
import type { AssetStore } from "../core/assets";
import type { DocumentData, VectorLayerData } from "../core/model";
import { allLayers } from "../core/model";
import type { DocumentRenderer } from "./renderer";
import { exportPng, encodeRgbaPng } from "./png";
import { createCanvas, release } from "./canvas";
import { exportPathSvg } from "../core/shapes";
import { documentToPsd } from "../core/interchange/psd/bridge";

export type ExportFormat = "png" | "jpeg" | "webp" | "svg" | "psd";

export interface ExportOptions {
  format: ExportFormat;
  quality?: number; // 0.01 to 1.0 (for JPEG and WebP)
  backgroundColor?: string; // background fill for JPEG (default: "#ffffff")
}

export interface ExportCapabilityReport {
  format: ExportFormat;
  warnings: string[];
  featuresPreserved: string[];
  featuresDegradedOrOmitted: string[];
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  report: ExportCapabilityReport;
}

/**
 * Produces an honest, detailed preflight capability report assessing
 * what document features are preserved or degraded/omitted when exporting
 * to the requested target format.
 */
export function getExportCapabilityReport(
  document: DocumentData,
  options: ExportOptions,
): ExportCapabilityReport {
  const format = options.format;
  const layers = allLayers(document.children);
  const hasVectors = layers.some((l) => l.kind === "vector");
  const hasRasters = layers.some(
    (l) => l.kind === "raster" || l.kind === "paint",
  );
  const hasAdjustments = layers.some((l) => l.kind === "adjustment");
  const hasText = layers.some((l) => l.kind === "text");
  const hasNonVectorLayers = hasRasters || hasAdjustments || hasText;

  const warnings: string[] = [];
  const featuresPreserved: string[] = [];
  const featuresDegradedOrOmitted: string[] = [];

  switch (format) {
    case "png":
      featuresPreserved.push(
        "Full alpha channel (transparency)",
        "Lossless pixel accuracy",
        "All layer types composited",
      );
      if (hasVectors) {
        warnings.push(
          `Vector layers will be rasterized at document resolution (${document.width}×${document.height}px).`,
        );
        featuresDegradedOrOmitted.push("Vector scalability and path editing");
      }
      break;

    case "jpeg":
      const bg = options.backgroundColor || "#ffffff";
      warnings.push(
        `JPEG does not support transparency. Transparent areas will be composited over the background color (${bg}).`,
      );
      featuresPreserved.push(
        "Full RGB color gamut",
        "High compression efficiency",
      );
      featuresDegradedOrOmitted.push(
        "Alpha channel (flattened)",
        "Lossless compression (lossy compression applied)",
      );
      if (hasVectors) {
        featuresDegradedOrOmitted.push("Vector scalability and path editing");
      }
      break;

    case "webp":
      featuresPreserved.push(
        "Alpha channel (transparency)",
        "Advanced predictive compression",
        "All layer types composited",
      );
      if (options.quality !== undefined && options.quality < 1) {
        warnings.push(
          `Lossy WebP compression will be applied at quality ${Math.round(options.quality * 100)}%.`,
        );
        featuresDegradedOrOmitted.push("Lossless bit-exact reproduction");
      }
      if (hasVectors) {
        featuresDegradedOrOmitted.push("Vector scalability and path editing");
      }
      break;

    case "svg":
      if (!hasVectors) {
        warnings.push(
          "The document contains no vector layers. The resulting SVG will be an empty canvas.",
        );
      } else {
        featuresPreserved.push(
          "Infinitely scalable Bézier vector paths",
          "Fill, stroke, and stroke-width styling",
        );
      }
      if (hasNonVectorLayers) {
        warnings.push(
          "SVG export extracts only vector layers. Raster, paint, text, and adjustment layers cannot be preserved as vector paths and will be omitted.",
        );
        featuresDegradedOrOmitted.push(
          "Raster and paint layers",
          "Adjustment layers",
          "Text layers",
        );
      }
      break;

    case "psd":
      if (layers.some((layer) => layer.kind === "raster" && layer.erasures?.length))
        warnings.push("PSD export cannot preserve raster erasures yet; use a Canoli Studio project or PNG.");
      featuresPreserved.push(
        "Individual raster layers preserved with coordinates and names",
        "Layer opacity and blend modes",
        "8-bit RGB channels with PackBits RLE compression",
        "Embedded ICC color profile (sRGB)",
        "Standard Photoshop composite image",
      );
      if (hasVectors) {
        warnings.push(
          "Vector shape layers are rasterized into pixel layers in PSD export.",
        );
        featuresDegradedOrOmitted.push(
          "Editable vector Bézier paths (rasterized)",
        );
      }
      if (hasText) {
        warnings.push(
          "Text layers are rendered to pixel layers in PSD export.",
        );
        featuresDegradedOrOmitted.push("Editable text typography (rasterized)");
      }
      if (hasAdjustments) {
        warnings.push(
          "Adjustment layers are flattened into underlying raster layers.",
        );
        featuresDegradedOrOmitted.push("Non-destructive adjustment layers");
      }
      break;
  }

  return {
    format,
    warnings,
    featuresPreserved,
    featuresDegradedOrOmitted,
  };
}

/**
 * Multi-format export engine supporting PNG, JPEG (with background fill),
 * WebP (with quality control), and SVG (vector extraction), accompanied
 * by an honest capability report.
 */
export async function exportDocument(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  options: ExportOptions,
  control?: ExportControl,
): Promise<ExportResult> {
  checkExport(control);
  control?.onProgress?.({phase:"rendering",fraction:null});
  const report = getExportCapabilityReport(document, options);

  if (options.format === "svg") {
    const vectorLayers = allLayers(document.children).filter(
      (l): l is VectorLayerData => l.kind === "vector" && l.visible,
    );
    const layerElements: string[] = [];
    for (const layer of vectorLayers) {
      const transform =
        layer.x !== 0 || layer.y !== 0
          ? ` transform="translate(${layer.x}, ${layer.y})"`
          : "";
      const opacity = layer.opacity < 1 ? ` opacity="${layer.opacity}"` : "";
      const paths = layer.paths
        .map((path) => `    ${exportPathSvg(path)}`)
        .join("\n");
      layerElements.push(
        `  <g id="${layer.id}"${opacity}${transform}>\n${paths}\n  </g>`,
      );
    }
    const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${document.width} ${document.height}" width="${document.width}" height="${document.height}">
${layerElements.join("\n")}
</svg>`;
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    return {
      blob,
      mimeType: "image/svg+xml",
      extension: "svg",
      report,
    };
  }

  if (options.format === "psd") {
    const psdBytes = await documentToPsd(
      document,
      async (assetId) => {
        if (!assets.has(assetId)) return null;
        const asset = assets.get(assetId);
        const canvas = createCanvas(asset.width, asset.height);
        try {
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(asset.bitmap, 0, 0);
          return ctx.getImageData(0, 0, asset.width, asset.height);
        } finally {
          release(canvas);
        }
      },
      { embedIcc: true, includeComposite: true },
    );
    const blob = new Blob(
      [
        new Uint8Array(
          psdBytes.buffer as ArrayBuffer,
          psdBytes.byteOffset,
          psdBytes.byteLength,
        ),
      ],
      { type: "image/vnd.adobe.photoshop" },
    );
    return {
      blob,
      mimeType: "image/vnd.adobe.photoshop",
      extension: "psd",
      report,
    };
  }

  if (options.format === "png") {
    const blob = await exportPng(document, assets, renderer, control);
    return {
      blob,
      mimeType: "image/png",
      extension: "png",
      report,
    };
  }

  // JPEG or WebP raster rendering
  const { width, height } = document;
  const canvas = createCanvas(width, height);
  try {
    const ctx = canvas.getContext("2d")!;

    if (options.format === "jpeg") {
      ctx.fillStyle = options.backgroundColor || "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    // Tiled strip rendering to avoid exceeding device GPU memory
    const rowBytes = width * 4;
    const rowsPerStrip = Math.max(
      1,
      Math.min(1024, Math.floor(4_000_000 / Math.max(1, rowBytes))),
    );
    for (let y = 0; y < height; y += rowsPerStrip) {
      checkExport(control);
      const rows = Math.min(rowsPerStrip, height - y);
      for (let x = 0; x < width; x += 2048) {
        const tileWidth = Math.min(2048, width - x);
        const tile = await renderer.render(document, assets, {
          region: { x, y, width: tileWidth, height: rows },
          cache: false,
          readback: true,
        });
        try {
          checkExport(control);
          ctx.drawImage(tile, x, y);
        } finally {
          release(tile);
        }
      }
      control?.onProgress?.({phase:"rendering",fraction:(y+rows)/height});
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }

    checkExport(control);
    control?.onProgress?.({phase:"encoding",fraction:null});
    const mimeType = options.format === "jpeg" ? "image/jpeg" : "image/webp";
    const quality = options.quality ?? (options.format === "jpeg" ? 0.92 : 0.9);
    const extension = options.format === "jpeg" ? "jpg" : "webp";

    let blob: Blob;
    if (typeof canvas.toBlob === "function") {
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(
                  new Error(`Failed to encode image to ${options.format}`),
                ),
          mimeType,
          quality,
        ),
      );
    } else {
      // Fallback for mock/test environments
      const imgData = ctx.getImageData(0, 0, width, height);
      const bytes = new Uint8Array(
        imgData.data.buffer,
        imgData.data.byteOffset,
        imgData.data.byteLength,
      );
      blob = await encodeRgbaPng(bytes, width, height);
    }

    checkExport(control);
    return {
      blob,
      mimeType,
      extension,
      report,
    };
  } finally {
    release(canvas);
  }
}
