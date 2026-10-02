import { z } from "zod";
import { tonalStrokeSchema } from "../adjustments";

/** Public operation envelope. BrushStroke supplies the canonical brush validation. */
export const tonalSculptOptionsSchema = z
  .object({
    name: z.string().min(1).max(240).optional(),
    size: z.number().finite().optional(),
    hardness: z.number().finite().optional(),
    opacity: z.number().finite().optional(),
    flow: z.number().finite().optional(),
    spacing: z.number().finite().optional(),
    pressureSize: z.boolean().optional(),
    pressureOpacity: z.boolean().optional(),
    protectTones: z.boolean().optional(),
    clipSelection: z.boolean().optional(),
  })
  .strict();
export type TonalSculptOptions = z.infer<typeof tonalSculptOptionsSchema>;
export const tonalSculptSchema = z
  .object({
    path: z
      .array(
        z
          .object({
            x: z.number().finite(),
            y: z.number().finite(),
            pressure: z.number().finite().min(0).max(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20000),
    mode: tonalStrokeSchema.shape.mode,
    range: tonalStrokeSchema.shape.range,
    exposure: tonalStrokeSchema.shape.exposure,
    options: tonalSculptOptionsSchema.optional(),
  })
  .strict();
