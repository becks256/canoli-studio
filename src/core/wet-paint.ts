import { z } from 'zod';

// Shared simulation settings. Authored wet records retain these as metadata;
// prepared replacement pixels remain authoritative. No new scripting privilege.
const unit = z.number().finite().min(0).max(1);
export const wetPaintLoadSchema = z.object({
  color: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).default([0, 0, 0, 255]),
  load: unit.default(0),
}).strict();
export type WetPaintLoadOptions = z.input<typeof wetPaintLoadSchema>;
export type WetPaintLoadSettings = z.output<typeof wetPaintLoadSchema>;

export const wetPaintMixSchema = z.object({
  flow: unit.default(1),
  wetness: unit.default(0),
  pickup: unit.default(0.5),
}).strict();
export type WetPaintMixOptions = z.input<typeof wetPaintMixSchema>;
export type WetPaintMixSettings = z.output<typeof wetPaintMixSchema>;

export interface WetPaintResult {
  pixels: Uint8ClampedArray;
  /** Encoded-sRGB, premultiplied normalized RGBA, including fractional alpha. */
  carried: Float32Array;
}
