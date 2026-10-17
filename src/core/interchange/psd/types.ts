/**
 * Types and interfaces for PSD/PSB file format interchange (F11).
 * Compliant with the Adobe Photoshop File Format Specification.
 */

import type { BlendMode } from "../../model";

export enum PsdColorMode {
  Bitmap = 0,
  Grayscale = 1,
  Indexed = 2,
  RGB = 3,
  CMYK = 4,
  Multichannel = 7,
  Duotone = 8,
  Lab = 9,
}

export enum PsdCompression {
  Raw = 0,
  Rle = 1,
  Zip = 2,
  ZipPrediction = 3,
}

export const PSD_BLEND_MODE_MAP: Record<string, BlendMode> = {
  norm: "normal",
  dark: "darken",
  lite: "lighten",
  hue: "hue",
  sat: "saturation",
  colr: "color",
  lum: "luminosity",
  mul: "multiply",
  scrn: "screen",
  over: "overlay",
  hLit: "hard-light",
  sLit: "soft-light",
  diff: "difference",
  smud: "exclusion",
  div: "color-dodge",
  idiv: "color-burn",
};

export const LUMA_TO_PSD_BLEND_MAP: Record<BlendMode, string> = {
  normal: "norm",
  darken: "dark",
  lighten: "lite",
  multiply: "mul ",
  screen: "scrn",
  overlay: "over",
  "hard-light": "hLit",
  "soft-light": "sLit",
  difference: "diff",
  exclusion: "smud",
  "color-dodge": "div ",
  "color-burn": "idiv",
  hue: "hue ",
  saturation: "sat ",
  color: "colr",
  luminosity: "lum ",
};

export interface PsdHeader {
  signature: "8BPS";
  version: 1 | 2; // 1 = PSD, 2 = PSB
  channels: number; // 1 to 56
  height: number;
  width: number;
  depth: 1 | 8 | 16 | 32; // Bits per channel
  colorMode: PsdColorMode;
}

export interface PsdImageResource {
  id: number;
  name: string;
  data: Uint8Array;
}

export interface PsdChannelInfo {
  id: number; // 0=R, 1=G, 2=B, -1=transparency, -2=user mask
  length: number;
}

export interface PsdLayerRecord {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  channelCount: number;
  channelInfo: PsdChannelInfo[];
  blendModeSig: string; // '8BIM'
  blendModeKey: string; // 'norm', 'mul ', etc.
  opacity: number; // 0 - 255
  clipping: number;
  flags: {
    transparencyProtected: boolean;
    visible: boolean;
    pixelDataIrrelevant: boolean;
  };
  name: string;
  isGroup?: boolean;
  isGroupEnd?: boolean;
  mask?: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    defaultColor: number;
    disabled: boolean;
  };
}

export interface PsdParsedLayer extends PsdLayerRecord {
  imageData?: ImageData;
  maskData?: ImageData;
}

export interface PsdParsedDocument {
  header: PsdHeader;
  resources: Map<number, PsdImageResource>;
  layers: PsdParsedLayer[];
  composite?: ImageData;
  iccProfile?: Uint8Array;
  resolution?: {
    hRes: number;
    vRes: number;
  };
}

export interface PsdCapabilityReport {
  supportedConstructs: string[];
  warnings: string[];
  degradedFeatures: string[];
  layerCount: number;
  colorMode: string;
  bitDepth: number;
  hasComposite: boolean;
  hasIccProfile: boolean;
  canImportAsLayers: boolean;
}

export interface PsdImportOptions {
  /** Earlier unmarked Canoli files used straight RGBA without the merged-alpha flag. */
  legacyStraightAlpha?: boolean;
  mode?: "layered" | "flatten";
  convertCmyk?: boolean;
  preserveMasks?: boolean;
}

export interface PsdExportOptions {
  embedIcc?: boolean;
  includeComposite?: boolean;
  compression?: "rle" | "raw";
}
