import { z } from "zod";
export const guideSchema = z
  .object({
    id: z.string().min(1).max(240),
    orientation: z.enum(["horizontal", "vertical"]),
    position: z
      .number()
      .finite()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const guidesSchema = z
  .array(guideSchema)
  .refine(
    (guides) => new Set(guides.map((guide) => guide.id)).size === guides.length,
    "Guide IDs must be unique.",
  );
export type GuideData = z.infer<typeof guideSchema>;
