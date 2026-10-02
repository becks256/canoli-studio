/**
 * Color and precision types for F10 color management & ICC pipeline.
 */

export type StandardRgbSpaceId =
  "srgb" | "display-p3" | "adobe-rgb" | "linear-srgb";
export type ColorSpaceId = StandardRgbSpaceId | "cielab" | "xyz" | "cmyk";

export type RenderingIntent =
  | "perceptual"
  | "relative-colorimetric"
  | "absolute-colorimetric"
  | "saturation"
  | "unclipped";

export type Vector3 = [number, number, number];
export type Vector4 = [number, number, number, number];
export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export interface ChromaticityCoordinate {
  x: number;
  y: number;
}

export interface WhitePoint {
  x: number;
  y: number;
  X: number;
  Y: number;
  Z: number;
}

export interface ColorSpaceDefinition {
  id: ColorSpaceId;
  name: string;
  whitePoint: "D65" | "D50";
  gamma: number | "srgb";
  primaries?: {
    r: ChromaticityCoordinate;
    g: ChromaticityCoordinate;
    b: ChromaticityCoordinate;
  };
  toXyzMatrix?: Matrix3x3;
  fromXyzMatrix?: Matrix3x3;
}

export interface ColorProfileDescriptor {
  id: string;
  name: string;
  colorSpace: ColorSpaceId;
  description: string;
  copyright?: string;
  manufacturer?: string;
  model?: string;
  whitePoint: "D65" | "D50";
  iccBytes?: Uint8Array;
}

export interface IccHeader {
  profileSize: number;
  cmmType: string;
  version: string;
  deviceClass: string;
  colorSpace: string;
  connectionSpace: string;
  creationDateTime: Date;
  signature: string;
  primaryPlatform: string;
  renderingIntent: RenderingIntent;
  illuminant: Vector3;
  creator: string;
}

export interface IccTag {
  signature: string;
  offset: number;
  length: number;
  data?: unknown;
}

export interface IccProfileInfo {
  header: IccHeader;
  tags: Record<string, IccTag>;
  description: string;
  copyright?: string;
  whitePoint?: Vector3;
  redColorant?: Vector3;
  greenColorant?: Vector3;
  blueColorant?: Vector3;
  rawBytes: Uint8Array;
}

export interface GamutEvaluationResult {
  inGamut: boolean;
  maxExcursion: number;
  deltaE76: number;
  deltaE2000: number;
  clippedColor: Vector3;
}

export interface SoftProofOptions {
  proofSpace: StandardRgbSpaceId;
  intent: RenderingIntent;
  gamutWarning: boolean;
  warningColor?: [number, number, number, number]; // RGBA [0-255]
}
