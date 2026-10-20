/**
 * Specification-compliant binary PSD/PSB parser and capability reporter.
 */

import { ByteReader } from "./stream";
import { decodePackBits } from "./packbits";
import { unmattePreviewChannel } from "./composite";
import { decodePsdZip, type PsdZipRequest } from "./zip";
import { psdMaskIssue } from "./mask";
import { psdHierarchyIssue } from './groups';
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

type PsdParseOptions = { legacyStraightAlpha?: boolean };

/** Compatibility parser: synchronous callers receive explicit ZIP limitations. */
export function parsePsd(buffer: ArrayBuffer | Uint8Array, options: PsdParseOptions = {}): PsdParsedDocument {
  const parser = parsePsdSteps(buffer, options);
  let step = parser.next();
  while (!step.done) step = parser.next(undefined);
  return step.value;
}

/** Native ZIP decoding is asynchronous; all other parsing uses the same core. */
export async function parsePsdAsync(buffer: ArrayBuffer | Uint8Array, options: PsdParseOptions = {}): Promise<PsdParsedDocument> {
  const parser = parsePsdSteps(buffer, options);
  let step = parser.next();
  while (!step.done) step = parser.next(await decodePsdZip(step.value));
  return step.value;
}

function* parsePsdSteps(buffer: ArrayBuffer | Uint8Array, options: PsdParseOptions): Generator<PsdZipRequest, PsdParsedDocument, Uint8Array | undefined> {
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
  const maximum=version===2?300000:30000;
  if(width<1||height<1||width>maximum||height>maximum||channels<1||channels>56||![1,8,16,32].includes(depth))
    throw new Error('Invalid Photoshop file header geometry, channel count or depth.');

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
              if (reader.position + maskLen > extraEnd) throw new Error('Photoshop mask exceeds its layer record.');
              const maskBytes = reader.readBytes(maskLen), maskReader = new ByteReader(maskBytes);
              const mTop = maskReader.readInt32();
              const mLeft = maskReader.readInt32();
              const mBottom = maskReader.readInt32();
              const mRight = maskReader.readInt32();
              const defaultColor = maskReader.readUint8();
              const maskFlags = maskReader.readUint8();
              if (mBottom < mTop || mRight < mLeft || ![0,255].includes(defaultColor))
                throw new Error('Invalid Photoshop raster mask geometry or background.');
              const unsupportedFeatures: string[] = [];
              // Extended/combined masks have additional geometry and may bake
              // vector effects. Do not silently substitute the basic rectangle.
              if (maskLen >= 36) unsupportedFeatures.push('combined/extended Photoshop masks');
              if (maskFlags & 0xe8) unsupportedFeatures.push('rendered or unknown Photoshop mask flags');
              maskInfo = {
                top: mTop,
                left: mLeft,
                bottom: mBottom,
                right: mRight,
                defaultColor,
                disabled: (maskFlags & 0x02) !== 0,
                relativeToLayer: (maskFlags & 1) !== 0,
                inverted: (maskFlags & 4) !== 0,
                density: 1,
                feather: 0,
                unsupportedFeatures,
              };
              if ((maskFlags & 0x10) && maskLen < 36) {
                const parameters = maskReader.readUint8();
                if (parameters & 1) maskInfo.density = maskReader.readUint8() / 255;
                if (parameters & 2) {
                  const value = maskReader.readBytes(8);
                  maskInfo.feather = new DataView(value.buffer, value.byteOffset, 8).getFloat64(0, false);
                  if (!Number.isFinite(maskInfo.feather) || maskInfo.feather < 0)
                    throw new Error('Invalid Photoshop raster mask feather.');
                }
                if (parameters & 0xfc) unsupportedFeatures.push('vector or unknown Photoshop mask parameters');
              }
            } else if (maskLen > 0) {
              throw new Error('Truncated Photoshop raster mask record.');
            }
          }

          const unsupportedAppearance:string[]=[];
          // Layer Blending Ranges
          if (reader.position < extraEnd) {
            const blendRangesLen = reader.readUint32();
            const ranges=reader.readBytes(blendRangesLen);
            if(ranges.length%8!==0||ranges.some((value,i)=>value!==(i%4<2?0:255)))unsupportedAppearance.push('Photoshop Blend If ranges');
          }

          // Layer Name (Pascal string padded to 4 bytes)
          let layerName = "Layer";
          if (reader.position < extraEnd) {
            layerName = reader.readPascalString(4);
          }

          // Tagged Additional Information blocks
          let isGroup = false;
          let isGroupEnd = false;
          let hasVectorMask = false;
          let groupBlendModeKey:string|undefined,fillOpacity:number|undefined,protectedFlags=0;

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
              if(tagDataLen<4)throw new Error('Truncated Photoshop group divider.');
              const dividerType = reader.readUint32();
              if (dividerType === 1 || dividerType === 2) {
                isGroup = true;
              } else if (dividerType === 3) {
                isGroupEnd = true;
              }
              if(tagDataLen>=12){if(reader.readAscii(4)!=='8BIM')throw new Error('Invalid Photoshop group blend signature.');groupBlendModeKey=reader.readAscii(4).trim();}
            } else if (tagKey === 'vmsk' || tagKey === 'vsms') {
              hasVectorMask = true;
            } else if (tagKey === 'lspf' && tagDataLen>=4) {
              protectedFlags=reader.readUint32();
            } else if (tagKey === 'iOpa') {
              if(tagDataLen<1)throw new Error('Truncated Photoshop fill opacity.');
              fillOpacity=reader.readUint8();
            } else if (['lrFX','lfx2','lmfx','lfxs'].includes(tagKey)) {
              unsupportedAppearance.push('Photoshop layer effects');
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
            hasVectorMask,
            groupBlendModeKey,fillOpacity,protectedFlags,unsupportedAppearance,
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
            if(ch.length<2)throw new Error('Truncated Photoshop channel marker.');

            const chStart = reader.position;
            if(ch.id<-2){reader.skip(ch.length);continue;}
            const compression = reader.readUint16() as PsdCompression;

            let planeData: Uint8Array;
            const channelWidth=ch.id===-2&&record.mask?Math.max(0,record.mask.right-record.mask.left):lWidth;
            const channelHeight=ch.id===-2&&record.mask?Math.max(0,record.mask.bottom-record.mask.top):lHeight;
            const planeSize = channelWidth * channelHeight;

            if (compression === PsdCompression.Raw) {
              if(header.depth===8&&ch.length-2<planeSize)throw new Error('Truncated Photoshop raw layer channel.');
              planeData = reader.readBytes(Math.min(planeSize, ch.length - 2));
            } else if (compression === PsdCompression.Rle) {
              // PSD uses uint16 row lengths; PSB uses uint32.
              const scanlineLens: number[] = [];
              if(reader.position+channelHeight*(version===2?4:2)>chStart+ch.length)throw new Error('Truncated Photoshop channel row table.');
              for (let y = 0; y < channelHeight; y++) {
                scanlineLens.push(version===2?reader.readUint32():reader.readUint16());
              }
              // Decode each scanline with PackBits
              planeData = new Uint8Array(planeSize);
              let offset = 0;
              for (let y = 0; y < channelHeight; y++) {
                const sLen = scanlineLens[y];
                if(reader.position+sLen>chStart+ch.length)throw new Error('Photoshop scanline exceeds its channel extent.');
                const compBytes = reader.readBytes(sLen);
                const decomp = decodePackBits(compBytes, channelWidth,header.depth===8);
                planeData.set(decomp, offset);
                offset += channelWidth;
              }
            } else if (header.depth === 8 &&
                (compression === PsdCompression.Zip || compression === PsdCompression.ZipPrediction)) {
              const compressed = reader.readBytes(ch.length - 2);
              const decoded = yield {bytes: compressed, width: channelWidth, rows: channelHeight,
                prediction: compression === PsdCompression.ZipPrediction};
              planeData = decoded ?? new Uint8Array(0);
              if (!decoded) record.unsupportedCompression = true;
            } else {
              // Never present unimplemented ZIP data as invented black pixels.
              record.unsupportedCompression = true;
              planeData = new Uint8Array(0);
              reader.skip(Math.max(0, ch.length - 2));
            }

            decodedChannels.set(ch.id, planeData);
            // Ensure reader is at the end of channel info
            reader.seek(chStart + ch.length);
          }

          if (isPixelLayer&&!record.unsupportedCompression) {
            // Assemble RGBA ImageData
            // Channel 0: R, 1: G, 2: B, -1: Alpha
            const red = decodedChannels.get(0);
            const green = header.colorMode===PsdColorMode.Grayscale?red:decodedChannels.get(1);
            const blue = header.colorMode===PsdColorMode.Grayscale?red:decodedChannels.get(2);
            const alpha = decodedChannels.get(-1);
            if(header.depth===8&&header.colorMode===PsdColorMode.RGB&&(!red||!green||!blue))throw new Error('Missing Photoshop RGB layer channels.');

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
          if (record.mask && decodedChannels.has(-2)&&!record.unsupportedCompression) {
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
  let unsupportedCompositeCompression=false;
  if (reader.remaining() >= 2) {
    const compCompression = reader.readUint16() as PsdCompression;
    const planeSize = width * height;
    const numChannels = header.channels;

    const requiredChannels=header.colorMode===PsdColorMode.Grayscale?1:3;
    if (numChannels >= requiredChannels && planeSize > 0) {
      const planes: Uint8Array[] = [];

      const bytesPerSample =
        header.depth === 16 ? 2 : header.depth === 32 ? 4 : 1;
      const channelBytes = planeSize * bytesPerSample;

      if (compCompression === PsdCompression.Raw) {
        for (let c = 0; c < numChannels; c++) {
          if (reader.remaining() >= channelBytes) {
            planes.push(reader.readBytes(channelBytes));
          }else if(header.depth===8)throw new Error('Truncated Photoshop raw composite.');
        }
      } else if (compCompression === PsdCompression.Rle) {
        // PSB widens every merged-image RLE row length too.
        const totalScanlines = numChannels * height;
        if (reader.remaining() >= totalScanlines * (version===2?4:2)) {
          const scanlineLens: number[] = [];
          for (let i = 0; i < totalScanlines; i++) {
            scanlineLens.push(version===2?reader.readUint32():reader.readUint16());
          }

          let sIndex = 0;
          for (let c = 0; c < numChannels; c++) {
            const plane = new Uint8Array(planeSize);
            let pOffset = 0;
            for (let y = 0; y < height; y++) {
              const sLen = scanlineLens[sIndex++];
              if (reader.remaining() >= sLen) {
                const compBytes = reader.readBytes(sLen);
                const decomp = decodePackBits(compBytes, width,header.depth===8);
                plane.set(decomp, pOffset);
              }else if(header.depth===8)throw new Error('Truncated Photoshop RLE composite.');
              pOffset += width;
            }
            planes.push(plane);
          }
        }else if(header.depth===8)throw new Error('Truncated Photoshop RLE row table.');
      } else if (header.depth === 8 &&
          (compCompression === PsdCompression.Zip || compCompression === PsdCompression.ZipPrediction)) {
        const decoded = yield {bytes: reader.readBytes(reader.remaining()), width,
          rows: height * numChannels, prediction: compCompression === PsdCompression.ZipPrediction};
        if (decoded) {
          for (let c = 0; c < numChannels; c++)
            planes.push(decoded.subarray(c * planeSize, (c + 1) * planeSize));
        } else unsupportedCompositeCompression = true;
      } else {unsupportedCompositeCompression=true;}

      if (planes.length >= requiredChannels) {
        composite = new ImageData(width, height);
        const cData = composite.data;
        const red = planes[0];
        const green = header.colorMode===PsdColorMode.Grayscale?red:planes[1];
        const blue = header.colorMode===PsdColorMode.Grayscale?red:planes[2];
        // Extra alpha channels are not merged transparency. The earlier Canoli
        // writer used a positive count and straight RGBA; its ICC CMM identifies
        // that legacy output together with its missing global-mask field. A
        // resaved file can reuse the ICC profile without being a legacy file.
        const legacyCmm = iccProfile && iccProfile.length >= 8 && String.fromCharCode(...iccProfile.subarray(4, 8)) === "LUMA";
        const legacy = !mergedTransparency && (options.legacyStraightAlpha === true ||
          (options.legacyStraightAlpha === undefined && legacyLayout && legacyCmm));
        const alphaIndex=header.colorMode===PsdColorMode.Grayscale?1:header.colorMode===PsdColorMode.CMYK?4:3;
        const alpha = planes.length>alphaIndex && (mergedTransparency || legacy) ? planes[alphaIndex] : null;

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
    unsupportedCompositeCompression,
  };
}

/**
 * Generates an honest capability and compatibility report for a parsed PSD file.
 */
export function getPsdCapabilityReport(
  psd: PsdParsedDocument,
  options: {preserveMasks?: boolean} = {},
): PsdCapabilityReport {
  const supportedConstructs: string[] = [];
  const warnings: string[] = [];
  const degradedFeatures: string[] = [];
  const hierarchyIssue=psdHierarchyIssue(psd.layers);
  if(hierarchyIssue){warnings.push(hierarchyIssue);degradedFeatures.push('Unsupported Photoshop hierarchy');}
  if(psd.unsupportedCompositeCompression){warnings.push('The merged image uses ZIP or another unsupported compression and cannot be used for flattening.');degradedFeatures.push('Unsupported merged-image compression');}

  const colorModeName =
    PsdColorMode[psd.header.colorMode] ?? `Mode(${psd.header.colorMode})`;

  if (psd.header.colorMode === PsdColorMode.RGB) {
    supportedConstructs.push("RGB color mode");
  } else if (psd.header.colorMode === PsdColorMode.CMYK) {
    warnings.push(
      "CMYK color mode detected. Prototype channel interpretation is not a verified color-managed CMYK conversion; do not rely on it for color-critical delivery.",
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
    supportedConstructs.push("Embedded ICC color profile detected");
    warnings.push('The source ICC profile is inspected but not applied or retained in imported editing pixels. Color-managed fidelity remains unverified.');
    degradedFeatures.push('Original ICC conversion and retention');
  }

  if (psd.composite) {
    supportedConstructs.push("Merged composite image available for flattening");
  }

  let supportedLayerCount = 0;
  const unsupportedFill=(layer:PsdParsedLayer)=>(layer.fillOpacity??255)!==255&&(layer.isGroup||layer.blendModeKey!=='norm');
  for (const layer of psd.layers) {
    if(layer.unsupportedCompression){warnings.push(`Layer '${layer.name}': ZIP or another unsupported channel compression is not decoded. Use a supported merged composite or resave as Raw/RLE.`);degradedFeatures.push('Unsupported layer-channel compression');}
    if (layer.imageData) {
      supportedLayerCount++;
    }
    const blendKey=layer.isGroup?(layer.groupBlendModeKey??layer.blendModeKey):layer.blendModeKey;
    const blendMapped = PSD_BLEND_MODE_MAP[blendKey];
    if (!blendMapped && blendKey && !(layer.isGroup && blendKey==='pass') && !layer.isGroupEnd) {
      warnings.push(
        `Layer '${layer.name}': blend mode '${blendKey}' is unsupported; use the merged composite.`,
      );
      degradedFeatures.push('Unsupported Photoshop blend mode');
    }
    if(layer.unsupportedAppearance?.length||layer.clipping){warnings.push(`Layer '${layer.name}': ${[...(layer.unsupportedAppearance??[]),...(layer.clipping?['Photoshop clipping layers']:[])].join(', ')} requires the merged composite.`);degradedFeatures.push('Unsupported Photoshop appearance');}
    if(unsupportedFill(layer)){warnings.push(`Layer '${layer.name}': Photoshop group or non-Normal fill-opacity semantics require the merged composite.`);degradedFeatures.push('Unsupported Photoshop fill-opacity semantics');}
    if((layer.protectedFlags||layer.flags.transparencyProtected)&&!((layer.protectedFlags??0)&0x80000000)){warnings.push(`Layer '${layer.name}': partial Photoshop protection is retained as a full native lock.`);degradedFeatures.push('Photoshop partial lock granularity');}
    if (layer.mask || layer.hasVectorMask) {
      const issue = psdMaskIssue(layer);
      if (options.preserveMasks === false) {
        warnings.push(`Layer '${layer.name}': raster mask is omitted by preserveMasks:false.`);
        degradedFeatures.push('Omitted Photoshop raster mask');
      } else if (issue || psd.header.depth !== 8) {
        warnings.push(`Layer '${layer.name}': ${issue ?? 'higher-precision Photoshop raster mask'} is not preserved; use the merged composite.`);
        degradedFeatures.push('Unsupported Photoshop mask semantics');
      } else if(!hierarchyIssue) supportedConstructs.push(`Layer '${layer.name}': native pixel raster mask with bounds, background, inversion, density and disabled state`);
    }
    if(layer.isGroup&&!hierarchyIssue&&(blendMapped||blendKey==='pass')&&!layer.unsupportedAppearance?.length&&!layer.clipping&&!unsupportedFill(layer)) supportedConstructs.push(`Group '${layer.name}': nested hierarchy, opacity, visibility and ${blendKey==='pass'?'pass-through':blendKey} blending`);
  }

  if (supportedLayerCount > 0) {
    supportedConstructs.push(
      `${supportedLayerCount} raster layers with position, opacity, and blend modes`,
    );
  }

  const canImportAsLayers =
    (supportedLayerCount > 0 || (psd.layers.some(layer=>layer.isGroup)&&psd.layers.every(layer=>layer.isGroup||layer.isGroupEnd))) &&
    !hierarchyIssue &&
    !psd.layers.some(unsupportedFill) &&
    !psd.layers.some(layer=>layer.unsupportedCompression) &&
    !psd.layers.some(layer=>!layer.isGroupEnd&&(layer.clipping||layer.unsupportedAppearance?.length||(!(PSD_BLEND_MODE_MAP[layer.isGroup?(layer.groupBlendModeKey??layer.blendModeKey):layer.blendModeKey])&&!(layer.isGroup&&(layer.groupBlendModeKey??layer.blendModeKey)==='pass')))) &&
    (options.preserveMasks === false || !psd.layers.some(layer => (layer.mask || layer.hasVectorMask) && (psd.header.depth !== 8 || psdMaskIssue(layer)))) &&
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
