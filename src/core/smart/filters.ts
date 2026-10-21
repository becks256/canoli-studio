import { z } from "zod";
import { TONE_LIMITS } from "../tone";
import { medianFilterSchema } from './median-filter';
const common = { id: z.string().min(1).max(240), enabled: z.boolean() };
// Authored sigma is in master pixels; the worker halo limit is independent of document geometry.
const sigma = z
  .number()
  .finite()
  .min(0)
  .max(4096 / 3);
export const frequencyBandFilterSchema = z.object({ ...common, kind: z.literal("frequency-band"), sigma, band: z.enum(["low", "high", "correction"]) }).strict();
export const nativeCompositionFilterSchema=z.object({...common,kind:z.literal("native-composition")}).strict();
export const documentToneFilterSchema=z.object({...common,kind:z.literal("document-tone"),
  exposure:z.number().finite().min(TONE_LIMITS.exposure.min).max(TONE_LIMITS.exposure.max),
  contrast:z.number().finite().min(TONE_LIMITS.contrast.min).max(TONE_LIMITS.contrast.max),
  saturation:z.number().finite().min(TONE_LIMITS.saturation.min).max(TONE_LIMITS.saturation.max)}).strict();
export const smartFilterSchema = z.discriminatedUnion("kind", [
  medianFilterSchema,
  z.object({ ...common, kind: z.literal("gaussian-blur"), sigma }).strict(),
  frequencyBandFilterSchema,
  nativeCompositionFilterSchema,
  documentToneFilterSchema,
  z
    .object({
      ...common,
      kind: z.literal("unsharp-mask"),
      sigma,
      amount: z.number().min(0).max(5),
      threshold: z.number().min(0).max(255),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("tone"),
      exposure: z
        .number()
        .min(TONE_LIMITS.exposure.min)
        .max(TONE_LIMITS.exposure.max),
      contrast: z
        .number()
        .min(TONE_LIMITS.contrast.min)
        .max(TONE_LIMITS.contrast.max),
      saturation: z
        .number()
        .min(TONE_LIMITS.saturation.min)
        .max(TONE_LIMITS.saturation.max),
    })
    .strict(),
]);
export const smartFiltersSchema = z
  .array(smartFilterSchema)
  .max(32)
  .refine(
    (filters) =>
      new Set(filters.map((filter) => filter.id)).size === filters.length,
    "Smart-filter IDs must be unique within the instance.",
  ).refine(filters=>{let documentPhase=false;return filters.every(filter=>{if(filter.kind==='document-tone')documentPhase=true;return !documentPhase||filter.kind==='document-tone';});},'Document tone must follow all native filters.');
export type SmartFilterData = z.infer<typeof smartFilterSchema>;
/** Zero-radius median must also bypass native resampling and SVG rasterization. */
export function isActiveSmartFilter(filter: SmartFilterData): boolean {
  return filter.enabled && !(filter.kind === 'median' && filter.radius === 0);
}
export function smartFilterHalo(filters: readonly SmartFilterData[]): number {
  return filters.reduce(
    (sum, filter) =>
      sum +
      (filter.enabled &&
      filter.kind !== "tone" && filter.kind !== "native-composition" && filter.kind !== "document-tone" &&
      !(filter.kind === "unsharp-mask" && filter.amount === 0)
        ? filter.kind === 'median' ? filter.radius : Math.ceil(3 * filter.sigma)
        : 0),
    0,
  );
}
