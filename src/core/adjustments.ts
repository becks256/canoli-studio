import { maskStrokeSchema } from "./masks";
import type { BrushStrokeData } from "./drawing";
import type { DodgeBurnOptions } from "./retouch/types";
import { z } from "zod";
import { lutAdjustmentSchema, type LutAdjustmentData } from "./lut";
export { lutAdjustmentSchema, defaultLutAdjustment } from "./lut";
export type { LutAdjustmentData } from "./lut";
import { whiteBalanceAdjustmentSchema, type WhiteBalanceAdjustmentData } from "./white-balance";
export { whiteBalanceAdjustmentSchema, defaultWhiteBalanceAdjustment } from "./white-balance";
export type { WhiteBalanceAdjustmentData } from "./white-balance";
import { gradientMapAdjustmentSchema, type GradientMapAdjustmentData } from "./gradient-map";
export { gradientMapAdjustmentSchema, defaultGradientMapAdjustment } from "./gradient-map";
export type { GradientMapAdjustmentData, GradientStop } from "./gradient-map";

export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurvesAdjustmentData {
  kind: "curves";
  rgb: CurvePoint[];
  red?: CurvePoint[];
  green?: CurvePoint[];
  blue?: CurvePoint[];
}

export interface LevelChannelData {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

export interface LevelsAdjustmentData {
  kind: "levels";
  rgb: LevelChannelData;
  red?: LevelChannelData;
  green?: LevelChannelData;
  blue?: LevelChannelData;
}

export interface ToneAdjustmentData {
  kind: "tone";
  exposure: number;
  contrast: number;
  saturation: number;
}

export interface TonalStrokeData extends Omit<DodgeBurnOptions, "flow"> {
  brush: BrushStrokeData;
}
export interface TonalAdjustmentData {
  kind: "tonal";
  strokes: TonalStrokeData[];
}
/** Snapshot corrected RGB; source alpha is per-pixel patch coverage, not backdrop alpha. */
export interface PatchAdjustmentData {
  kind: "patch";
  assetId: string;
  width: number;
  height: number;
}
export const patchAdjustmentSchema = z
  .object({
    kind: z.literal("patch"),
    assetId: z.string().min(1),
    width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const tonalStrokeSchema = z
  .object({
    brush: maskStrokeSchema.shape.stroke,
    mode: z.enum(["dodge", "burn"]),
    range: z.enum(["shadows", "midtones", "highlights"]),
    exposure: z.number().finite().min(0).max(1),
    protectTones: z.boolean().optional(),
  })
  .strict();
export const tonalAdjustmentSchema = z
  .object({ kind: z.literal("tonal"), strokes: z.array(tonalStrokeSchema) })
  .strict();

export interface HslAdjustmentData {
  kind: "hsl";
  hue: number;
  saturation: number;
  lightness: number;
}
export const hslAdjustmentSchema = z
  .object({
    kind: z.literal("hsl"),
    hue: z.number().finite().min(-180).max(180),
    saturation: z.number().finite().min(-100).max(100),
    lightness: z.number().finite().min(-100).max(100),
  })
  .strict();
export function defaultHslAdjustment(): HslAdjustmentData {
  return { kind: "hsl", hue: 0, saturation: 0, lightness: 0 };
}

export interface BalanceChannels { red: number; green: number; blue: number }
export interface ColorBalanceAdjustmentData {
  kind: "color-balance";
  shadows: BalanceChannels;
  midtones: BalanceChannels;
  highlights: BalanceChannels;
  preserveLuminosity: boolean;
}
export interface VibranceAdjustmentData { kind: "vibrance"; vibrance: number; saturation: number }
const balanceChannelsSchema = z.object({
  red: z.number().finite().min(-100).max(100),
  green: z.number().finite().min(-100).max(100),
  blue: z.number().finite().min(-100).max(100),
}).strict();
export const colorBalanceAdjustmentSchema = z.object({
  kind: z.literal("color-balance"), shadows: balanceChannelsSchema,
  midtones: balanceChannelsSchema, highlights: balanceChannelsSchema,
  preserveLuminosity: z.boolean(),
}).strict();
export const vibranceAdjustmentSchema = z.object({
  kind: z.literal("vibrance"), vibrance: z.number().finite().min(-100).max(100),
  saturation: z.number().finite().min(-100).max(100),
}).strict();
export const chromaticAdjustmentSchema = z.discriminatedUnion("kind", [colorBalanceAdjustmentSchema,vibranceAdjustmentSchema]);
export type ChromaticAdjustmentData = ColorBalanceAdjustmentData | VibranceAdjustmentData;
export function defaultColorBalanceAdjustment(): ColorBalanceAdjustmentData {
  return {kind:"color-balance",shadows:{red:0,green:0,blue:0},midtones:{red:0,green:0,blue:0},highlights:{red:0,green:0,blue:0},preserveLuminosity:true};
}
export function defaultVibranceAdjustment(): VibranceAdjustmentData { return {kind:"vibrance",vibrance:0,saturation:0}; }

export type AdjustmentData =
  | LutAdjustmentData
  | WhiteBalanceAdjustmentData
  | GradientMapAdjustmentData
  | ColorBalanceAdjustmentData
  | VibranceAdjustmentData
  | HslAdjustmentData
  | CurvesAdjustmentData
  | LevelsAdjustmentData
  | ToneAdjustmentData
  | TonalAdjustmentData
  | PatchAdjustmentData;

// --- Zod Validation Schemas ---

export const curvePointSchema = z
  .object({
    x: z.number().finite().min(0).max(255),
    y: z.number().finite().min(0).max(255),
  })
  .strict();

export const curvePointsSchema = z
  .array(curvePointSchema)
  .min(2)
  .max(32)
  .refine(
    (points) => {
      for (let i = 0; i < points.length - 1; i++) {
        if (points[i].x >= points[i + 1].x) return false;
      }
      return true;
    },
    { message: "Curve points must be strictly increasing in X coordinate." },
  );

export const curvesAdjustmentSchema = z
  .object({
    kind: z.literal("curves"),
    rgb: curvePointsSchema,
    red: curvePointsSchema.optional(),
    green: curvePointsSchema.optional(),
    blue: curvePointsSchema.optional(),
  })
  .strict();

export const levelChannelSchema = z
  .object({
    inputBlack: z.number().finite().min(0).max(254),
    inputWhite: z.number().finite().min(1).max(255),
    gamma: z.number().finite().min(0.05).max(10),
    outputBlack: z.number().finite().min(0).max(255),
    outputWhite: z.number().finite().min(0).max(255),
  })
  .strict()
  .refine((data) => data.inputWhite > data.inputBlack, {
    message: "inputWhite must be strictly greater than inputBlack.",
  });

export const levelsAdjustmentSchema = z
  .object({
    kind: z.literal("levels"),
    rgb: levelChannelSchema,
    red: levelChannelSchema.optional(),
    green: levelChannelSchema.optional(),
    blue: levelChannelSchema.optional(),
  })
  .strict();

export const toneAdjustmentSchema = z
  .object({
    kind: z.literal("tone"),
    exposure: z.number().finite().min(-3).max(3),
    contrast: z.number().finite().min(-100).max(100),
    saturation: z.number().finite().min(-100).max(100),
  })
  .strict();

export const adjustmentSchema = z.discriminatedUnion("kind", [
  lutAdjustmentSchema,
  whiteBalanceAdjustmentSchema,
  gradientMapAdjustmentSchema,
  colorBalanceAdjustmentSchema,
  vibranceAdjustmentSchema,
  hslAdjustmentSchema,
  curvesAdjustmentSchema,
  levelsAdjustmentSchema,
  toneAdjustmentSchema,
  tonalAdjustmentSchema,
  patchAdjustmentSchema,
]);

// --- Default Constructors ---

export function defaultCurvePoints(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ];
}

export function defaultCurvesAdjustment(): CurvesAdjustmentData {
  return {
    kind: "curves",
    rgb: defaultCurvePoints(),
  };
}

export function defaultLevelChannel(): LevelChannelData {
  return {
    inputBlack: 0,
    inputWhite: 255,
    gamma: 1.0,
    outputBlack: 0,
    outputWhite: 255,
  };
}

export function defaultLevelsAdjustment(): LevelsAdjustmentData {
  return {
    kind: "levels",
    rgb: defaultLevelChannel(),
  };
}

export function defaultToneAdjustment(): ToneAdjustmentData {
  return {
    kind: "tone",
    exposure: 0,
    contrast: 0,
    saturation: 0,
  };
}

// --- Fritsch-Carlson Monotone Cubic Spline Interpolation ---

export function evaluateMonotoneCubicSpline(points: CurvePoint[]): Uint8Array {
  const n = points.length;
  const lut = new Uint8Array(256);
  if (n === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (n === 1) {
    const val = Math.round(Math.max(0, Math.min(255, points[0].y)));
    lut.fill(val);
    return lut;
  }

  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const slopes: number[] = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
    slopes[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];

  for (let i = 1; i < n - 1; i++) {
    tangents[i] = (slopes[i - 1] + slopes[i]) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / slopes[i];
      const beta = tangents[i + 1] / slopes[i];
      if (alpha < 0) tangents[i] = 0;
      if (beta < 0) tangents[i + 1] = 0;
      const distSq = alpha * alpha + beta * beta;
      if (distSq > 9) {
        const tau = 3 / Math.sqrt(distSq);
        tangents[i] = tau * alpha * slopes[i];
        tangents[i + 1] = tau * beta * slopes[i];
      }
    }
  }

  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= points[0].x) {
      lut[x] = Math.round(Math.max(0, Math.min(255, points[0].y)));
      continue;
    }
    if (x >= points[n - 1].x) {
      lut[x] = Math.round(Math.max(0, Math.min(255, points[n - 1].y)));
      continue;
    }

    while (seg < n - 2 && points[seg + 1].x < x) {
      seg++;
    }

    const h = dx[seg];
    const t = h === 0 ? 0 : (x - points[seg].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const y =
      h00 * points[seg].y +
      h10 * h * tangents[seg] +
      h01 * points[seg + 1].y +
      h11 * h * tangents[seg + 1];

    lut[x] = Math.round(Math.max(0, Math.min(255, y)));
  }

  return lut;
}

// --- Levels Transfer Function ---

export function evaluateLevelsLut(channel: LevelChannelData): Uint8Array {
  const lut = new Uint8Array(256);
  const { inputBlack, inputWhite, gamma, outputBlack, outputWhite } = channel;
  const inRange = Math.max(1, inputWhite - inputBlack);
  const outRange = outputWhite - outputBlack;
  const invGamma = 1.0 / Math.max(0.01, gamma);

  for (let x = 0; x < 256; x++) {
    let normalized = (x - inputBlack) / inRange;
    normalized = Math.max(0, Math.min(1, normalized));
    const corrected = Math.pow(normalized, invGamma);
    const out = outputBlack + corrected * outRange;
    lut[x] = Math.round(Math.max(0, Math.min(255, out)));
  }

  return lut;
}

// --- Composite Adjustment LUT Calculation ---

export interface AdjustmentLuts {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  combined: Uint8Array; // 768 bytes: R (0..255), G (256..511), B (512..767)
}

export function computeAdjustmentLuts(
  adjustment: AdjustmentData,
): AdjustmentLuts {
  if (adjustment.kind === "lut")
    throw new Error("Imported LUTs require domain-aware table processing, not a channel lookup table.");
  if (adjustment.kind === "white-balance")
    throw new Error("White balance requires linear cross-channel pixel processing, not a channel lookup table.");
  if (adjustment.kind === "gradient-map")
    throw new Error("Gradient maps require cross-channel pixel processing, not a channel lookup table.");
  if (adjustment.kind === "color-balance" || adjustment.kind === "vibrance")
    throw new Error("Chromatic adjustments require cross-channel pixel processing, not a lookup table.");
  if (adjustment.kind === "hsl")
    throw new Error(
      "HSL requires cross-channel pixel processing, not a lookup table.",
    );
  if (adjustment.kind === "patch")
    throw new Error(
      "Patch adjustments require spatial rendering, not a lookup table.",
    );
  if (adjustment.kind === "tonal")
    throw new Error(
      "Tonal strokes require spatial rendering, not a lookup table.",
    );
  const combined = new Uint8Array(768);
  const r = combined.subarray(0, 256);
  const g = combined.subarray(256, 512);
  const b = combined.subarray(512, 768);

  if (adjustment.kind === "curves") {
    const masterLut = evaluateMonotoneCubicSpline(adjustment.rgb);
    const rLut = adjustment.red
      ? evaluateMonotoneCubicSpline(adjustment.red)
      : null;
    const gLut = adjustment.green
      ? evaluateMonotoneCubicSpline(adjustment.green)
      : null;
    const bLut = adjustment.blue
      ? evaluateMonotoneCubicSpline(adjustment.blue)
      : null;

    for (let i = 0; i < 256; i++) {
      const masterVal = masterLut[i];
      r[i] = rLut ? rLut[masterVal] : masterVal;
      g[i] = gLut ? gLut[masterVal] : masterVal;
      b[i] = bLut ? bLut[masterVal] : masterVal;
    }
  } else if (adjustment.kind === "levels") {
    const masterLut = evaluateLevelsLut(adjustment.rgb);
    const rLut = adjustment.red ? evaluateLevelsLut(adjustment.red) : null;
    const gLut = adjustment.green ? evaluateLevelsLut(adjustment.green) : null;
    const bLut = adjustment.blue ? evaluateLevelsLut(adjustment.blue) : null;

    for (let i = 0; i < 256; i++) {
      const masterVal = masterLut[i];
      r[i] = rLut ? rLut[masterVal] : masterVal;
      g[i] = gLut ? gLut[masterVal] : masterVal;
      b[i] = bLut ? bLut[masterVal] : masterVal;
    }
  } else if (adjustment.kind === "tone") {
    // When saturation is 0, tone can be expressed as a pure LUT.
    // If saturation != 0, per-pixel luminance weighting is needed in the kernel,
    // but we can initialize identity or exposure/contrast LUT here.
    const gain = Math.pow(2.0, adjustment.exposure);
    const contrastGain = Math.pow(2.0, adjustment.contrast / 100.0);
    for (let i = 0; i < 256; i++) {
      const val = Math.round(
        Math.max(0, Math.min(255, (i * gain - 127.5) * contrastGain + 127.5)),
      );
      r[i] = val;
      g[i] = val;
      b[i] = val;
    }
  }

  return { r, g, b, combined };
}
