import { z } from "zod";
import { selectionSchema } from "../drawing";

export const patchRegionOptionsSchema = z
  .object({
    direction: z.enum(["source", "destination"]).optional(),
    mode: z.enum(["source", "mixed"]).optional(),
    tolerance: z.number().finite().positive().optional(),
    maxIterations: z.number().int().positive().optional(),
    sampling: z
      .enum(["all-layers", "current-layer", "current-and-below"])
      .optional(),
    layerId: z.string().min(1).max(240).optional(),
  })
  .strict();
export type PatchRegionOptions = z.infer<typeof patchRegionOptionsSchema>;
export const patchRegionRequestSchema = z
  .object({
    selection: selectionSchema,
    offset: z
      .object({
        x: z
          .number()
          .int()
          .min(-Number.MAX_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER),
        y: z
          .number()
          .int()
          .min(-Number.MAX_SAFE_INTEGER)
          .max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    options: patchRegionOptionsSchema,
  })
  .strict();
export type PatchRegionRequest = z.infer<typeof patchRegionRequestSchema>;
