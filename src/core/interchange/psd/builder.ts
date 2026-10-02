/**
 * Binary PSD builder: serializes Luma document and layer pixels into a valid,
 * specification-compliant Adobe Photoshop (8BPS) file.
 */

import type { DocumentData, LayerData } from "../../model";
import { ByteWriter } from "./stream";
import { encodePackBits } from "./packbits";
import {
  LUMA_TO_PSD_BLEND_MAP,
  PsdColorMode,
  PsdCompression,
  type PsdExportOptions,
} from "./types";
import { STANDARD_PROFILES } from "../../color/icc";

export interface LayerPixelSource {
  layer: LayerData;
  imageData: ImageData;
}

export async function buildPsd(
  document: DocumentData,
  layersWithPixels: LayerPixelSource[],
  options: PsdExportOptions = {},
): Promise<Uint8Array> {
  const writer = new ByteWriter();
  const width = document.width;
  const height = document.height;

  // 1. Header (26 bytes)
  writer.writeAscii("8BPS");
  writer.writeUint16(1); // Version 1
  for (let i = 0; i < 6; i++) writer.writeUint8(0); // Reserved
  writer.writeUint16(4); // 4 channels (RGBA)
  writer.writeUint32(height);
  writer.writeUint32(width);
  writer.writeUint16(8); // 8-bit depth
  writer.writeUint16(PsdColorMode.RGB); // RGB mode

  // 2. Color Mode Data Section (empty for RGB)
  writer.writeUint32(0);

  // 3. Image Resources Section
  const resWriter = new ByteWriter();

  // Resource: ResolutionInfo (0x03ED = 1005)
  resWriter.writeAscii("8BIM");
  resWriter.writeUint16(0x03ed);
  resWriter.writePascalString("", 2);
  resWriter.writeUint32(16);
  resWriter.writeUint32(72 * 65536); // 72 DPI in 16.16
  resWriter.writeUint16(1); // 1 = pixels per inch
  resWriter.writeUint16(1);
  resWriter.writeUint32(72 * 65536);
  resWriter.writeUint16(1);
  resWriter.writeUint16(1);

  // Resource: ICC Profile (0x040F = 1039)
  if (options.embedIcc !== false) {
    const iccBytes = STANDARD_PROFILES.srgb.iccBytes ?? new Uint8Array(0);
    if (iccBytes.length > 0) {
      resWriter.writeAscii("8BIM");
      resWriter.writeUint16(0x040f);
      resWriter.writePascalString("", 2);
      resWriter.writeUint32(iccBytes.length);
      resWriter.writeBytes(iccBytes);
      if (iccBytes.length % 2 !== 0) {
        resWriter.writeUint8(0); // Pad to even length
      }
    }
  }

  const resBuffer = resWriter.getBuffer();
  writer.writeUint32(resBuffer.length);
  writer.writeBytes(resBuffer);

  // 4. Layer and Mask Information Section
  const layerMaskWriter = new ByteWriter();
  const layerInfoWriter = new ByteWriter();

  const layerCount = layersWithPixels.length;
  // Positive layer count = normal layers
  layerInfoWriter.writeInt16(layerCount);

  // Pre-encode channels for all layers to calculate channel lengths
  interface EncodedChannel {
    id: number;
    data: Uint8Array;
  }

  interface EncodedLayerData {
    channels: EncodedChannel[];
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  }

  const encodedLayers: EncodedLayerData[] = [];

  for (const item of layersWithPixels) {
    const l = item.layer;
    const img = item.imageData;
    const lWidth = img.width;
    const lHeight = img.height;
    const top = l.y;
    const left = l.x;
    const bottom = l.y + lHeight;
    const right = l.x + lWidth;

    const data = img.data;

    // Split RGBA into 4 planes: R (0), G (1), B (2), A (-1)
    const channelIds = [0, 1, 2, -1];
    const encodedChannels: EncodedChannel[] = [];

    for (let c = 0; c < 4; c++) {
      const chId = channelIds[c];
      const chWriter = new ByteWriter();

      if (options.compression === "raw") {
        chWriter.writeUint16(PsdCompression.Raw);
        const plane = new Uint8Array(lWidth * lHeight);
        let p = 0;
        const offset = c === 3 ? 3 : c;
        for (let i = 0; i < data.length; i += 4) {
          plane[p++] = data[i + offset];
        }
        chWriter.writeBytes(plane);
      } else {
        // PackBits RLE compression
        chWriter.writeUint16(PsdCompression.Rle);

        const scanlines: Uint8Array[] = [];
        const scanlineLens: number[] = [];
        const offset = c === 3 ? 3 : c;

        for (let y = 0; y < lHeight; y++) {
          const row = new Uint8Array(lWidth);
          const rowStart = y * lWidth * 4;
          for (let x = 0; x < lWidth; x++) {
            row[x] = data[rowStart + x * 4 + offset];
          }
          const compressed = encodePackBits(row);
          scanlines.push(compressed);
          scanlineLens.push(compressed.length);
        }

        // Write scanline length table (height * 2 bytes)
        for (let y = 0; y < lHeight; y++) {
          chWriter.writeUint16(scanlineLens[y]);
        }
        // Write compressed scanlines
        for (let y = 0; y < lHeight; y++) {
          chWriter.writeBytes(scanlines[y]);
        }
      }

      encodedChannels.push({ id: chId, data: chWriter.getBuffer() });
    }

    encodedLayers.push({
      channels: encodedChannels,
      top,
      left,
      bottom,
      right,
      width: lWidth,
      height: lHeight,
    });
  }

  // Write Layer Records
  for (let i = 0; i < layerCount; i++) {
    const item = layersWithPixels[i];
    const enc = encodedLayers[i];
    const l = item.layer;

    layerInfoWriter.writeInt32(enc.top);
    layerInfoWriter.writeInt32(enc.left);
    layerInfoWriter.writeInt32(enc.bottom);
    layerInfoWriter.writeInt32(enc.right);

    layerInfoWriter.writeUint16(4); // 4 channels

    for (const ch of enc.channels) {
      layerInfoWriter.writeInt16(ch.id);
      layerInfoWriter.writeUint32(ch.data.length);
    }

    // Blend mode signature & key
    layerInfoWriter.writeAscii("8BIM");
    const blendKey = LUMA_TO_PSD_BLEND_MAP[l.blendMode] ?? "norm";
    layerInfoWriter.writeAscii(blendKey, 4);

    // Opacity
    layerInfoWriter.writeUint8(
      Math.round(Math.max(0, Math.min(1, l.opacity)) * 255),
    );
    // Clipping
    layerInfoWriter.writeUint8(0);
    // Flags
    let flags = 0;
    if (!l.visible) flags |= 0x02; // Bit 1: invisible
    layerInfoWriter.writeUint8(flags);
    layerInfoWriter.writeUint8(0); // Filler

    // Extra Data Block
    const extraWriter = new ByteWriter();
    // 1. Layer mask data: size 0
    extraWriter.writeUint32(0);
    // 2. Layer blending ranges: size 0
    extraWriter.writeUint32(0);
    // 3. Layer name (Pascal string padded to 4 bytes)
    extraWriter.writePascalString(l.name, 4);

    // 4. Additional tagged information: luni (Unicode Layer Name)
    extraWriter.writeAscii("8BIM");
    extraWriter.writeAscii("luni");
    const uniWriter = new ByteWriter();
    uniWriter.writeUnicodeString(l.name);
    const uniBuf = uniWriter.getBuffer();
    extraWriter.writeUint32(uniBuf.length);
    extraWriter.writeBytes(uniBuf);

    const extraBuf = extraWriter.getBuffer();
    layerInfoWriter.writeUint32(extraBuf.length);
    layerInfoWriter.writeBytes(extraBuf);
  }

  // Write Channel Image Data for all layers
  for (const enc of encodedLayers) {
    for (const ch of enc.channels) {
      layerInfoWriter.writeBytes(ch.data);
    }
  }

  const layerInfoBuf = layerInfoWriter.getBuffer();
  // Pad layerInfo to even 4 bytes
  layerMaskWriter.writeUint32(layerInfoBuf.length);
  layerMaskWriter.writeBytes(layerInfoBuf);

  const layerMaskBuf = layerMaskWriter.getBuffer();
  writer.writeUint32(layerMaskBuf.length);
  writer.writeBytes(layerMaskBuf);

  // 5. Composite Image Data Section
  // Build flattened composite from layers
  const compPixels = new Uint8ClampedArray(width * height * 4);

  // Simple bottom-to-top painter's compositing
  for (const item of layersWithPixels) {
    if (!item.layer.visible) continue;
    const l = item.layer;
    const img = item.imageData;
    const lWidth = img.width;
    const lHeight = img.height;
    const lData = img.data;
    const alphaFactor = l.opacity;

    for (let ly = 0; ly < lHeight; ly++) {
      const cy = l.y + ly;
      if (cy < 0 || cy >= height) continue;

      for (let lx = 0; lx < lWidth; lx++) {
        const cx = l.x + lx;
        if (cx < 0 || cx >= width) continue;

        const srcIdx = (ly * lWidth + lx) * 4;
        const dstIdx = (cy * width + cx) * 4;

        const srcA = (lData[srcIdx + 3] / 255) * alphaFactor;
        if (srcA <= 0) continue;

        const dstA = compPixels[dstIdx + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);

        if (outA > 0) {
          compPixels[dstIdx] = Math.round(
            (lData[srcIdx] * srcA + compPixels[dstIdx] * dstA * (1 - srcA)) /
              outA,
          );
          compPixels[dstIdx + 1] = Math.round(
            (lData[srcIdx + 1] * srcA +
              compPixels[dstIdx + 1] * dstA * (1 - srcA)) /
              outA,
          );
          compPixels[dstIdx + 2] = Math.round(
            (lData[srcIdx + 2] * srcA +
              compPixels[dstIdx + 2] * dstA * (1 - srcA)) /
              outA,
          );
          compPixels[dstIdx + 3] = Math.round(outA * 255);
        }
      }
    }
  }

  // Encode composite channels with PackBits
  writer.writeUint16(PsdCompression.Rle);

  const compScanlines: Uint8Array[] = [];
  const compScanlineLens: number[] = [];

  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < height; y++) {
      const row = new Uint8Array(width);
      const rowStart = y * width * 4;
      for (let x = 0; x < width; x++) {
        row[x] = compPixels[rowStart + x * 4 + c];
      }
      const comp = encodePackBits(row);
      compScanlines.push(comp);
      compScanlineLens.push(comp.length);
    }
  }

  // Write scanline length table: 4 channels * height * 2 bytes
  for (let i = 0; i < compScanlineLens.length; i++) {
    writer.writeUint16(compScanlineLens[i]);
  }
  // Write compressed scanlines
  for (let i = 0; i < compScanlines.length; i++) {
    writer.writeBytes(compScanlines[i]);
  }

  return writer.getBuffer();
}
