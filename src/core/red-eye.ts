import { z } from "zod";

export interface RedEyeAdjustmentData {
  kind: "red-eye";
  /** Minimum red excess over max(green, blue), in encoded RGB8 levels. */
  threshold: number;
  strength: number;
}

export const redEyeAdjustmentSchema = z.object({
  kind: z.literal("red-eye"),
  threshold: z.number().finite().min(0).max(255),
  strength: z.number().finite().min(0).max(100),
}).strict();

export function defaultRedEyeAdjustment(): RedEyeAdjustmentData {
  return { kind: "red-eye", threshold: 32, strength: 100 };
}

export const redEyeOptionsSchema = redEyeAdjustmentSchema.omit({ kind: true }).partial();
