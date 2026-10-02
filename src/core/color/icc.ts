/**
 * Binary ICC.1:2010 profile parser and synthetic profile generator.
 */

import type {
  ColorProfileDescriptor,
  IccHeader,
  IccProfileInfo,
  IccTag,
  RenderingIntent,
  StandardRgbSpaceId,
  Vector3,
} from "./types";
import {
  ADOBE_RGB_TO_XYZ_D65,
  DISPLAY_P3_TO_XYZ_D65,
  SRGB_TO_XYZ_D65,
  WHITE_POINT_D50,
  xyzD65ToD50,
} from "./spaces";

function readAscii(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function readS15Fixed16(view: DataView, offset: number): number {
  return view.getInt32(offset, false) / 65536.0;
}

function writeS15Fixed16(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, Math.round(value * 65536.0), false);
}

function writeAscii(
  view: DataView,
  offset: number,
  text: string,
  length?: number,
): void {
  const len = length ?? text.length;
  for (let i = 0; i < len; i++) {
    view.setUint8(offset + i, i < text.length ? text.charCodeAt(i) : 0);
  }
}

/**
 * Parses an ICC profile from a raw byte buffer.
 */
export function parseIccProfile(bytes: Uint8Array): IccProfileInfo {
  if (bytes.length < 128) {
    throw new Error("Invalid ICC profile: buffer too small (< 128 bytes).");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const profileSize = view.getUint32(0, false);
  const signature = readAscii(view, 36, 4);

  if (signature !== "acsp") {
    throw new Error(
      `Invalid ICC profile: missing 'acsp' signature (got '${signature}').`,
    );
  }

  const cmmType = readAscii(view, 4, 4);
  const majorVer = view.getUint8(8);
  const minorVer = (view.getUint8(9) >> 4) & 0x0f;
  const version = `${majorVer}.${minorVer}`;

  const deviceClass = readAscii(view, 12, 4);
  const colorSpace = readAscii(view, 16, 4);
  const connectionSpace = readAscii(view, 20, 4);

  const year = view.getUint16(24, false);
  const month = view.getUint16(26, false);
  const day = view.getUint16(28, false);
  const hours = view.getUint16(30, false);
  const minutes = view.getUint16(32, false);
  const seconds = view.getUint16(34, false);
  const creationDateTime = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, seconds),
  );

  const primaryPlatform = readAscii(view, 40, 4);

  const renderingIntentCode = view.getUint32(64, false) & 0x03;
  let renderingIntent: RenderingIntent = "perceptual";
  if (renderingIntentCode === 1) renderingIntent = "relative-colorimetric";
  else if (renderingIntentCode === 2) renderingIntent = "saturation";
  else if (renderingIntentCode === 3) renderingIntent = "absolute-colorimetric";

  const illuminant: Vector3 = [
    readS15Fixed16(view, 68),
    readS15Fixed16(view, 72),
    readS15Fixed16(view, 76),
  ];

  const creator = readAscii(view, 80, 4);

  const header: IccHeader = {
    profileSize,
    cmmType,
    version,
    deviceClass,
    colorSpace,
    connectionSpace,
    creationDateTime,
    signature,
    primaryPlatform,
    renderingIntent,
    illuminant,
    creator,
  };

  // Tag Directory
  const tagCount = view.getUint32(128, false);
  const tags: Record<string, IccTag> = {};

  let description = "Custom ICC Profile";
  let copyright: string | undefined;
  let whitePoint: Vector3 | undefined;
  let redColorant: Vector3 | undefined;
  let greenColorant: Vector3 | undefined;
  let blueColorant: Vector3 | undefined;

  for (let i = 0; i < tagCount; i++) {
    const entryOffset = 132 + i * 12;
    if (entryOffset + 12 > bytes.length) break;

    const tagSig = readAscii(view, entryOffset, 4);
    const tagOffset = view.getUint32(entryOffset + 4, false);
    const tagLength = view.getUint32(entryOffset + 8, false);

    tags[tagSig] = {
      signature: tagSig,
      offset: tagOffset,
      length: tagLength,
    };

    if (tagOffset + tagLength <= bytes.length) {
      const typeSig = readAscii(view, tagOffset, 4);

      if (tagSig === "desc") {
        if (typeSig === "desc") {
          const rawLen = view.getUint32(tagOffset + 8, false);
          const strLen = Math.min(rawLen, Math.max(0, tagLength - 12));
          description = readAscii(view, tagOffset + 12, strLen).trim();
        } else if (typeSig === "mluc") {
          // multiLocalizedUnicodeType
          const recordCount = view.getUint32(tagOffset + 8, false);
          if (recordCount > 0) {
            const rawLen = view.getUint32(tagOffset + 20, false);
            const strOffset = view.getUint32(tagOffset + 24, false);
            const strLen = Math.min(rawLen, Math.max(0, tagLength - strOffset));
            // UTF-16BE
            let str = "";
            for (let j = 0; j < strLen; j += 2) {
              const code = view.getUint16(tagOffset + strOffset + j, false);
              if (code !== 0) str += String.fromCharCode(code);
            }
            if (str.length > 0) description = str.trim();
          }
        }
      } else if (tagSig === "cprt") {
        if (typeSig === "text") {
          copyright = readAscii(view, tagOffset + 8, tagLength - 8).trim();
        }
      } else if (tagSig === "wtpt" && typeSig === "XYZ ") {
        whitePoint = [
          readS15Fixed16(view, tagOffset + 8),
          readS15Fixed16(view, tagOffset + 12),
          readS15Fixed16(view, tagOffset + 16),
        ];
      } else if (tagSig === "rXYZ" && typeSig === "XYZ ") {
        redColorant = [
          readS15Fixed16(view, tagOffset + 8),
          readS15Fixed16(view, tagOffset + 12),
          readS15Fixed16(view, tagOffset + 16),
        ];
      } else if (tagSig === "gXYZ" && typeSig === "XYZ ") {
        greenColorant = [
          readS15Fixed16(view, tagOffset + 8),
          readS15Fixed16(view, tagOffset + 12),
          readS15Fixed16(view, tagOffset + 16),
        ];
      } else if (tagSig === "bXYZ" && typeSig === "XYZ ") {
        blueColorant = [
          readS15Fixed16(view, tagOffset + 8),
          readS15Fixed16(view, tagOffset + 12),
          readS15Fixed16(view, tagOffset + 16),
        ];
      }
    }
  }

  return {
    header,
    tags,
    description,
    copyright,
    whitePoint,
    redColorant,
    greenColorant,
    blueColorant,
    rawBytes: bytes,
  };
}

/**
 * Builds a specification-compliant, binary ICC v2.4 RGB display profile.
 */
export function buildStandardIccProfile(
  space: StandardRgbSpaceId,
  profileName: string,
): Uint8Array {
  // Setup matrix adapted to D50 PCS
  let toXyzMatrix = SRGB_TO_XYZ_D65;
  if (space === "display-p3") {
    toXyzMatrix = DISPLAY_P3_TO_XYZ_D65;
  } else if (space === "adobe-rgb") {
    toXyzMatrix = ADOBE_RGB_TO_XYZ_D65;
  }

  const rD50 = xyzD65ToD50([
    toXyzMatrix[0][0],
    toXyzMatrix[1][0],
    toXyzMatrix[2][0],
  ]);
  const gD50 = xyzD65ToD50([
    toXyzMatrix[0][1],
    toXyzMatrix[1][1],
    toXyzMatrix[2][1],
  ]);
  const bD50 = xyzD65ToD50([
    toXyzMatrix[0][2],
    toXyzMatrix[1][2],
    toXyzMatrix[2][2],
  ]);

  // Pre-calculate tag payloads
  // 1. 'desc' (textDescriptionType: 4 bytes sig, 4 bytes reserved, 4 bytes count, N bytes string, 1 byte null)
  const descBytes = new TextEncoder().encode(profileName);
  const descTagLen = 12 + descBytes.length + 1 + 11; // 12 header + string + null + padding
  const descBuf = new Uint8Array(descTagLen);
  const descView = new DataView(descBuf.buffer);
  writeAscii(descView, 0, "desc");
  descView.setUint32(8, descBytes.length + 1, false);
  descBuf.set(descBytes, 12);

  // 2. 'cprt' (textType)
  const cprtStr = "Luma Color Engine";
  const cprtTagLen = 8 + cprtStr.length + 1;
  const cprtBuf = new Uint8Array(cprtTagLen);
  const cprtView = new DataView(cprtBuf.buffer);
  writeAscii(cprtView, 0, "text");
  writeAscii(cprtView, 8, cprtStr);

  // 3. 'wtpt' (XYZType: 4 bytes sig, 4 bytes reserved, 12 bytes XYZ)
  const wtptBuf = new Uint8Array(20);
  const wtptView = new DataView(wtptBuf.buffer);
  writeAscii(wtptView, 0, "XYZ ");
  writeS15Fixed16(wtptView, 8, WHITE_POINT_D50.X);
  writeS15Fixed16(wtptView, 12, WHITE_POINT_D50.Y);
  writeS15Fixed16(wtptView, 16, WHITE_POINT_D50.Z);

  // 4, 5, 6: rXYZ, gXYZ, bXYZ
  const makeXyzTag = (v: Vector3) => {
    const buf = new Uint8Array(20);
    const dv = new DataView(buf.buffer);
    writeAscii(dv, 0, "XYZ ");
    writeS15Fixed16(dv, 8, v[0]);
    writeS15Fixed16(dv, 12, v[1]);
    writeS15Fixed16(dv, 16, v[2]);
    return buf;
  };
  const rXyzBuf = makeXyzTag(rD50);
  const gXyzBuf = makeXyzTag(gD50);
  const bXyzBuf = makeXyzTag(bD50);

  // 7, 8, 9: rTRC, gTRC, bTRC (curveType with 1 entry = pure gamma, or 0 entries = identity)
  const gamma =
    space === "adobe-rgb" ? 2.19921875 : space === "linear-srgb" ? 1.0 : 2.2;
  const trcBuf = new Uint8Array(14);
  const trcView = new DataView(trcBuf.buffer);
  writeAscii(trcView, 0, "curv");
  trcView.setUint32(8, 1, false); // 1 entry: gamma in u8.8
  trcView.setUint16(12, Math.round(gamma * 256.0), false);

  const tagList = [
    { sig: "desc", data: descBuf },
    { sig: "cprt", data: cprtBuf },
    { sig: "wtpt", data: wtptBuf },
    { sig: "rXYZ", data: rXyzBuf },
    { sig: "gXYZ", data: gXyzBuf },
    { sig: "bXYZ", data: bXyzBuf },
    { sig: "rTRC", data: trcBuf },
    { sig: "gTRC", data: trcBuf },
    { sig: "bTRC", data: trcBuf },
  ];

  // Calculate offsets
  const headerLen = 128;
  const tagTableLen = 4 + tagList.length * 12;
  let currentOffset = headerLen + tagTableLen;

  // Align tag offsets to 4-byte boundaries
  const resolvedTags: Array<{
    sig: string;
    offset: number;
    length: number;
    data: Uint8Array;
  }> = [];
  for (const t of tagList) {
    const pad = (4 - (currentOffset % 4)) % 4;
    currentOffset += pad;
    resolvedTags.push({
      sig: t.sig,
      offset: currentOffset,
      length: t.data.length,
      data: t.data,
    });
    currentOffset += t.data.length;
  }

  const totalLength = currentOffset;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);

  // Write Header
  view.setUint32(0, totalLength, false);
  writeAscii(view, 4, "LUMA"); // CMM
  view.setUint8(8, 2); // Version 2.4.0
  view.setUint8(9, 0x40);
  writeAscii(view, 12, "mntr"); // Display device
  writeAscii(view, 16, "RGB "); // Color space
  writeAscii(view, 20, "XYZ "); // Connection space
  view.setUint16(24, 2026, false); // Date
  view.setUint16(26, 1, false);
  view.setUint16(28, 1, false);
  writeAscii(view, 36, "acsp"); // Magic
  writeAscii(view, 40, "APPL"); // Platform
  writeS15Fixed16(view, 68, WHITE_POINT_D50.X); // Illuminant
  writeS15Fixed16(view, 72, WHITE_POINT_D50.Y);
  writeS15Fixed16(view, 76, WHITE_POINT_D50.Z);
  writeAscii(view, 80, "LUMA"); // Creator

  // Write Tag Table
  view.setUint32(128, resolvedTags.length, false);
  for (let i = 0; i < resolvedTags.length; i++) {
    const entryOffset = 132 + i * 12;
    const t = resolvedTags[i];
    writeAscii(view, entryOffset, t.sig);
    view.setUint32(entryOffset + 4, t.offset, false);
    view.setUint32(entryOffset + 8, t.length, false);
  }

  // Write Tag Data
  for (const t of resolvedTags) {
    output.set(t.data, t.offset);
  }

  return output;
}

export const STANDARD_PROFILES: Record<
  StandardRgbSpaceId,
  ColorProfileDescriptor
> = {
  srgb: {
    id: "srgb",
    name: "sRGB IEC61966-2.1",
    colorSpace: "srgb",
    description:
      "Standard web and consumer display color space (IEC 61966-2.1)",
    whitePoint: "D65",
    iccBytes: buildStandardIccProfile("srgb", "sRGB IEC61966-2.1"),
  },
  "display-p3": {
    id: "display-p3",
    name: "Display P3",
    colorSpace: "display-p3",
    description:
      "Wide gamut cinema color space standard on modern Apple and high-end displays",
    whitePoint: "D65",
    iccBytes: buildStandardIccProfile("display-p3", "Display P3"),
  },
  "adobe-rgb": {
    id: "adobe-rgb",
    name: "Adobe RGB (1998)",
    colorSpace: "adobe-rgb",
    description:
      "Wide gamut color space covering cyan and green print gamuts (CMYK prepress)",
    whitePoint: "D65",
    iccBytes: buildStandardIccProfile("adobe-rgb", "Adobe RGB (1998)"),
  },
  "linear-srgb": {
    id: "linear-srgb",
    name: "Linear sRGB",
    colorSpace: "linear-srgb",
    description:
      "Physically accurate linear-light compositing and 3D rendering color space",
    whitePoint: "D65",
    iccBytes: buildStandardIccProfile("linear-srgb", "Linear sRGB"),
  },
};
