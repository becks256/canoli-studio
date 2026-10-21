import { z } from 'zod';

/** Effect support in native master pixels; independent of image/import dimensions. */
export const medianRadiusSchema = z.number().int().min(0).max(32);
export const medianFilterSchema = z.object({
  id: z.string().min(1).max(240),
  enabled: z.boolean(),
  kind: z.literal('median'),
  radius: medianRadiusSchema,
}).strict();
