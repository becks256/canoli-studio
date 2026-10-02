import { z } from "zod";
import { selectionSchema } from "../drawing";
import { patchRegionOptionsSchema } from "./patch-region";

const coordinate = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const unit = z.number().finite().min(0).max(1);
export const healSpotOptionsSchema = patchRegionOptionsSchema
  .omit({ direction: true, layerId: true })
  .extend({
    searchRadius: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    hardness: unit.optional(),
    opacity: unit.optional(),
    flow: unit.optional(),
    clipSelection: z.boolean().optional(),
  })
  .strict();
export type HealSpotOptions = z.infer<typeof healSpotOptionsSchema>;
export const healSpotRequestSchema = z
  .object({
    layerId: z.string().min(1).max(240),
    center: z.object({ x: coordinate, y: coordinate }).strict(),
    radius: z.number().finite().min(0.05).max(1024),
    selection: selectionSchema.nullable(),
    options: healSpotOptionsSchema,
  })
  .strict();
export type HealSpotRequest = z.infer<typeof healSpotRequestSchema>;
