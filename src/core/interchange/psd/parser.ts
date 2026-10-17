/**
 * Specification-compliant binary PSD/PSB parser and capability reporter.
 */

import { ByteReader } from "./stream";
import { decodePackBits } from "./packbits";
import { unmattePreviewChannel } from "./composite";
import {
  PSD_BLEND_MODE_MAP,
  PsdColorMode,
  PsdCompression,
  type PsdCapabilityReport,
  type PsdChannelInfo,
  type PsdHeader,
  type PsdImageResource,
  type PsdParsedDocument,
  type PsdParsedLayer,
} from "./types";

export function parsePsd(buffer: ArrayBuffer | Uint8Array, options: { legacyStraightAlpha?: boolean } = {}): PsdParsedDocument {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const reader = new ByteReader(bytes);

  // 1. Header (26 bytes)
  const sig = reader.readAscii(4);
  if (sig !== "8BPS") {
    throw new Error(`Invalid PSD signature: expected '8BPS', got '${sig}'`);
  }

  const version = reader.readUint16() as 1 | 2;
  if (version !== 1 && version !== 2) {
    throw new Error(
      `Unsupported PSD version: ${version} (expected 1 for PSD or 2 for PSB)`,
    );
  }

  reader.skip(6); // 6 reserved bytes (must be zero)

  const channels = reader.readUint16();
  const height = reader.readUint32();
  const width = reader.readUint32();
  const depth = reader.readUint16() as 1 | 8 | 16 | 32;
  const colorMode = reader.readUint16() as PsdColorMode;

  const header: PsdHeader = {
    signature: "8BPS",
    version,
    channels,
    height,
    width,
    depth,
    colorMode,
  };

  // 2. Color Mode Data Section
  const colorModeDataLen = reader.readUint32();
  if (colorModeDataLen > 0) {
    reader.skip(colorModeDataLen);
  }

  // 3. Image Resources Section
  const resourcesLen = reader.readUint32();
  const resourcesEnd = reader.position + resourcesLen;
  const resources = new Map<number, PsdImageResource>();
  let iccProfile: Uint8Array | undefined;
  let resolution: { hRes: number; vRes: number } | undefined;

  while (reader.position < resourcesEnd) {
    const resSig = reader.readAscii(4);
    if (resSig !== "8BIM" && resSig !== "MeSa") {
      // Misaligned or end of resources
      break;
    }
    const resId = reader.readUint16();
    const resName = reader.readPascalString(2); // Padded to even length
    const resDataLen = reader.readUint32();
    const resData = reader.readBytes(resDataLen);
    if (resDataLen % 2 !== 0 && reader.remaining() > 0) {
      reader.skip(1); // Padding byte
    }

    resources.set(resId, { id: resId, name: resName, data: resData });

    if (resId === 0x040f) {
      // ICC Profile
      iccProfile = resData;
    } else if (resId === 0x03ed && resData.length >= 16) {
      // ResolutionInfo (hRes, vRes in fixed 16.16)
      const resView = new DataView(
        resData.buffer,
        resData.byteOffset,
        resData.byteLength,
      );
      resolution = {
        hRes: resView.getInt32(0, false) / 65536.0,
        vRes: resView.getInt32(8, false) / 65536.0,
      };
    }
  }

  reader.seek(resourcesEnd);

  // 4. Layer and Mask Information Section
  const layers: PsdParsedLayer[] = [];
  let mergedTransparency = false;
  let legacyLayout = false;
  if (reader.remaining() >= 4) {
    const layerMaskSectionLen =
      version === 1 ? reader.readUint32() : reader.readUint64(); // In PSB, 64-bit
    const layerMaskSectionEnd = reader.position + layerMaskSectionLen;

    if (layerMaskSectionLen > 0 && reader.remaining() >= 4) {
      const layerInfoLen =
        version === 1 ? reader.readUint32() : reader.readUint64();
      legacyLayout = version === 1 && layerMaskSectionLen === 4 + layerInfoLen;

      if (layerInfoLen > 0 && reader.remaining() >= 2) {
        const rawLayerCount = reader.readInt16();
        mergedTransparency = rawLayerCount < 0;
        const layerCount = Math.abs(rawLayerCount);

        // Read Layer Records
        const records: PsdParsedLayer[] = [];

        for (let i = 0; i < layerCount; i++) {
          const top = reader.readInt32();
          const left = reader.readInt32();
          const bottom = reader.readInt32();
          const right = reader.readInt32();
          const lWidth = Math.max(0, right - left);
          const lHeight = Math.max(0, bottom - top);

          const channelCount = reader.readUint16();
          const channelInfo: PsdChannelInfo[] = [];
          for (let c = 0; c < channelCount; c++) {
            const chId = reader.readInt16();
            const chLen =
              version === 1 ? reader.readUint32() : reader.readUint64();
            channelInfo.push({ id: chId, length: chLen });
          }

          const blendModeSig = reader.readAscii(4);
          const blendModeKey = reader.readAscii(4).trim();
          const opacity = reader.readUint8();
          const clipping = reader.readUint8();
          const flagsByte = reader.readUint8();
          reader.skip(1); // Filler zero

          const flags = {
            transparencyProtected: (flagsByte & 0x01) !== 0,
            visible: (flagsByte & 0x02) === 0, // 0 = visible, 1 = invisible
            pixelDataIrrelevant: (flagsByte & 0x10) !== 0,
          };

          const extraLen = reader.readUint32();
          const extraEnd = reader.position + extraLen;

          // Layer Mask Data
          let maskInfo: PsdParsedLayer["mask"] | undefined;
          if (extraLen > 0 && reader.position < extraEnd) {
            const maskLen = reader.readUint32();
            if (maskLen >= 20) {
              const mTop = reader.readInt32();
              const mLeft = reader.readInt32();
              const mBottom = reader.readInt32();
              const mRight = reader.readInt32();
              const defaultColor = reader.readUint8();
              const maskFlags = reader.readUint8();
              maskInfo = {
                top: mTop,
                left: mLeft,
                bottom: mBottom,
                right: mRight,
                defaultColor,
                disabled: (maskFlags & 0x02) !== 0,
              };
              if (maskLen > 18) reader.skip(maskLen - 18);
            } else if (maskLen > 0) {
              reader.skip(maskLen);
            }
          }

          // Layer Blending Ranges
          if (reader.position < extraEnd) {
            const blendRangesLen = reader.readUint32();
            reader.skip(blendRangesLen);
          }

          // Layer Name (Pascal string padded to 4 bytes)
          let layerName = "Layer";
          if (reader.position < extraEnd) {
            layerName = reader.readPascalString(4);
          }

          // Tagged Additional Information blocks
          let isGroup = false;
          let isGroupEnd = false;

          while (reader.position + 12 <= extraEnd) {
            const tagSig = reader.readAscii(4);
            if (tagSig !== "8BIM" && tagSig !== "8B64") {
              reader.skip(1);
              continue;
            }
            const tagKey = reader.readAscii(4);
            const tagDataLen = reader.readUint32();
            const paddedTagLen = (tagDataLen + 1) & ~1;
            const tagDataEnd = reader.position + paddedTagLen;

            if (tagKey === "lsct" || tagKey === "lsdk") {
              // Section divider setting (folders / groups)
              const dividerType = reader.readUint32();
              if (dividerType === 1 || dividerType === 2) {
                isGroup = true;
              } else if (dividerType === 3) {
                isGroupEnd = true;
              }
            } else if (tagKey === "luni" && tagDataLen >= 4) {
              // Unicode layer name
              const uniName = reader.readUnicodeString();
              if (uniName.length > 0) layerName = uniName;
            }

            reader.seek(Math.min(extraEnd, tagDataEnd));
          }

          reader.seek(extraEnd);

          records.push({
            top,
            left,
            bottom,
            right,
            width: lWidth,
            height: lHeight,
            channelCount,
            channelInfo,
            blendModeSig,
            blendModeKey,
            opacity,
            clipping,
            flags,
            name: layerName,
            isGroup,
            isGroupEnd,
            mask: maskInfo,
          });
        }

        // Read Channel Image Data for each layer
        for (const record of records) {
          const lWidth = record.width;
          const lHeight = record.height;
          const isPixelLayer =
            lWidth > 0 && lHeight > 0 && !record.isGroup && !record.isGroupEnd;

          // Channels map: channelId -> decoded Uint8Array
          const decodedChannels = new Map<number, Uint8Array>();

          for (const ch of record.channelInfo) {
            if (ch.length <= 0) continue;

            const chStart = reader.position;
            const compression = reader.readUint16() as PsdCompression;

            let planeData: Uint8Array;
            const planeSize = lWidth * lHeight;

            if (compression === PsdCompression.Raw) {
              planeData = reader.readBytes(Math.min(planeSize, ch.length - 2));
            } else if (compression === PsdCompression.Rle) {
              // Read scanline lengths: height * 2 bytes
              const scanlineLens: number[] = [];
              for (let y = 0; y < lHeight; y++) {
                scanlineLens.push(reader.readUint16());
              }
              // Decode each scanline with PackBits
              planeData = new Uint8Array(planeSize);
              let offset = 0;
              for (let y = 0; y < lHeight; y++) {
                const sLen = scanlineLens[y];
                const compBytes = reader.readBytes(sLen);
                const decomp = decodePackBits(compBytes, lWidth);
                planeData.set(decomp, offset);
                offset += lWidth;
              }
            } else {
              // Zip or unhandled compression
              planeData = new Uint8Array(planeSize);
              reader.skip(Math.max(0, ch.length - 2));
            }

            decodedChannels.set(ch.id, planeData);
            // Ensure reader is at the end of channel info
            reader.seek(chStart + ch.length);
          }

          if (isPixelLayer) {
            // Assemble RGBA ImageData
            // Channel 0: R, 1: G, 2: B, -1: Alpha
            const red = decodedChannels.get(0);
            const green = decodedChannels.get(1);
            const blue = decodedChannels.get(2);
            const alpha = decodedChannels.get(-1);

            const img = new ImageData(lWidth, lHeight);
            const data = img.data;
            const pixelCount = lWidth * lHeight;

            for (let p = 0; p < pixelCount; p++) {
              const idx = p * 4;
              data[idx] = red ? red[p] : 0;
              data[idx + 1] = green ? green[p] : 0;
              data[idx + 2] = blue ? blue[p] : 0;
              data[idx + 3] = alpha ? alpha[p] : 255;
            }

            record.imageData = img;
          }

          // Check for user layer mask channel (-2)
          if (record.mask && decodedChannels.has(-2)) {
            const mWidth = record.mask.right - record.mask.left;
            const mHeight = record.mask.bottom - record.mask.top;
            if (mWidth > 0 && mHeight > 0) {
              const maskPlane = decodedChannels.get(-2);
              if (maskPlane) {
                const maskImg = new ImageData(mWidth, mHeight);
                const mData = maskImg.data;
                const mPixels = mWidth * mHeight;
                for (let p = 0; p < mPixels; p++) {
                  const val = maskPlane[p];
                  mData[p * 4] = val;
                  mData[p * 4 + 1] = val;
                  mData[p * 4 + 2] = val;
                  mData[p * 4 + 3] = val;
                }
                record.maskData = maskImg;
              }
            }
          }

          layers.push(record);
        }
      }
    }

    reader.seek(layerMaskSectionEnd);
  }

  // 5. Composite Image Data Section (Merged image)
  let composite: ImageData | undefined;
  if (reader.remaining() >= 2) {
    const compCompression = reader.readUint16() as PsdCompression;
    const planeSize = width * height;
    const numChannels = header.channels;

    if (numChannels >= 3 && planeSize > 0) {
      const planes: Uint8Array[] = [];

      const bytesPerSample =
        header.depth === 16 ? 2 : header.depth === 32 ? 4 : 1;
      const channelBytes = planeSize * bytesPerSample;

      if (compCompression === PsdCompression.Raw) {
        for (let c = 0; c < numChannels; c++) {
          if (reader.remaining() >= channelBytes) {
            planes.push(reader.readBytes(channelBytes));
          }
        }
      } else if (compCompression === PsdCompression.Rle) {
        // Scanline lengths table: numChannels * height * 2 bytes
        const totalScanlines = numChannels * height;
        if (reader.remaining() >= totalScanlines * 2) {
          const scanlineLens: number[] = [];
          for (let i = 0; i < totalScanlines; i++) {
            scanlineLens.push(reader.readUint16());
          }

          let sIndex = 0;
          for (let c = 0; c < numChannels; c++) {
            const plane = new Uint8Array(planeSize);
            let pOffset = 0;
            for (let y = 0; y < height; y++) {
              const sLen = scanlineLens[sIndex++];
              if (reader.remaining() >= sLen) {
                const compBytes = reader.readBytes(sLen);
                const decomp = decodePackBits(compBytes, width);
                plane.set(decomp, pOffset);
              }
              pOffset += width;
            }
            planes.push(plane);
          }
        }
      }

      if (planes.length >= 3) {
        composite = new ImageData(width, height);
        const cData = composite.data;
        const red = planes[0];
        const green = planes[1];
        const blue = planes[2];
        // Extra alpha channels are not merged transparency. The earlier Canoli
        // writer used a positive count and straight RGBA; its ICC CMM identifies
        // that legacy output together with its missing global-mask field. A
        // resaved file can reuse the ICC profile without being a legacy file.
        const legacyCmm = iccProfile && iccProfile.length >= 8 && String.fromCharCode(...iccProfile.subarray(4, 8)) === "LUMA";
        const legacy = !mergedTransparency && (options.legacyStraightAlpha === true ||
          (options.legacyStraightAlpha === undefined && legacyLayout && legacyCmm));
        const alpha = planes.length >= 4 && (mergedTransparency || legacy) ? planes[3] : null;

        for (let p = 0; p < planeSize; p++) {
          const idx = p * 4;
          const sampleOffset = p * bytesPerSample;
          const a = alpha ? alpha[sampleOffset] : 255;
          cData[idx] = mergedTransparency ? unmattePreviewChannel(red[sampleOffset], a) : red[sampleOffset];
          cData[idx + 1] = mergedTransparency ? unmattePreviewChannel(green[sampleOffset], a) : green[sampleOffset];
          cData[idx + 2] = mergedTransparency ? unmattePreviewChannel(blue[sampleOffset], a) : blue[sampleOffset];
          cData[idx + 3] = a;
        }
      }
    }
  }

  return {
    header,
    resources,
    layers,
    composite,
    iccProfile,
    resolution,
  };
}

/**
 * Generates an honest capability and compatibility report for a parsed PSD file.
 */
export function getPsdCapabilityReport(
  psd: PsdParsedDocument,
): PsdCapabilityReport {
  const supportedConstructs: string[] = [];
  const warnings: string[] = [];
  const degradedFeatures: string[] = [];

  const colorModeName =
    PsdColorMode[psd.header.colorMode] ?? `Mode(${psd.header.colorMode})`;

  if (psd.header.colorMode === PsdColorMode.RGB) {
    supportedConstructs.push("RGB color mode");
  } else if (psd.header.colorMode === PsdColorMode.CMYK) {
    warnings.push(
      "CMYK color mode detected; channels will be converted to RGB with standard GCR estimation.",
    );
    degradedFeatures.push("CMYK to RGB conversion");
  } else if (psd.header.colorMode === PsdColorMode.Grayscale) {
    supportedConstructs.push("Grayscale color mode (expanded to RGB)");
  } else {
    warnings.push(
      `Color mode '${colorModeName}' is unsupported; image will fall back to composite.`,
    );
    degradedFeatures.push(`Unsupported color mode: ${colorModeName}`);
  }

  if (psd.header.depth === 8) {
    supportedConstructs.push("8-bit standard precision per channel");
  } else {
    warnings.push(
      `${psd.header.depth}-bit depth detected; precision will be quantized to 8-bit.`,
    );
    degradedFeatures.push(`${psd.header.depth}-bit channel quantization`);
  }

  if (psd.iccProfile) {
    supportedConstructs.push("Embedded ICC color profile preserved");
  }

  if (psd.composite) {
    supportedConstructs.push("Merged composite image available for flattening");
  }

  let supportedLayerCount = 0;
  for (const layer of psd.layers) {
    if (layer.imageData) {
      supportedLayerCount++;
    }
    const blendMapped = PSD_BLEND_MODE_MAP[layer.blendModeKey];
    if (!blendMapped && layer.blendModeKey) {
      warnings.push(
        `Layer '${layer.name}': blend mode '${layer.blendModeKey}' will fall back to 'normal'.`,
      );
    }
    if (layer.maskData) {
      supportedConstructs.push(
        `Layer '${layer.name}': raster layer mask preserved`,
      );
    }
  }

  if (supportedLayerCount > 0) {
    supportedConstructs.push(
      `${supportedLayerCount} raster layers with position, opacity, and blend modes`,
    );
  }

  const canImportAsLayers =
    supportedLayerCount > 0 &&
    (psd.header.colorMode === PsdColorMode.RGB ||
      psd.header.colorMode === PsdColorMode.Grayscale);

  return {
    supportedConstructs,
    warnings,
    degradedFeatures,
    layerCount: psd.layers.length,
    colorMode: colorModeName,
    bitDepth: psd.header.depth,
    hasComposite: Boolean(psd.composite),
    hasIccProfile: Boolean(psd.iccProfile),
    canImportAsLayers,
  };
}
