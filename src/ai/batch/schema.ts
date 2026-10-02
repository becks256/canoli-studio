/**
 * Zod validation schemas for Batch Runner and Delivery Manifests.
 */

import { z } from "zod";
import { recipeSchema } from "../recipes/schema";
import type { BatchConfig, BatchItem, DeliveryManifest } from "./types";

export const deliveryVariantSpecSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  targetWidth: z.number().int().min(16).max(16384),
  targetHeight: z.number().int().min(16).max(16384),
  format: z.enum(["png", "jpeg", "webp"]),
  fit: z.enum(["cover", "contain", "fill"]),
  nameTemplate: z.string().min(1).max(240).optional(),
});

export const batchSourceImageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(240),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  mimeType: z.string().min(1).max(64),
  byteLength: z.number().int().min(0),
  sha256: z.string().max(128).optional(),
  assetId: z.string().max(64).optional(),
  dataUrl: z.string().optional(),
});

export const deliveryDeliverableSchema = z.object({
  id: z.string().min(1).max(129),
  itemId: z.string().min(1).max(64),
  variantId: z.string().min(1).max(64),
  variantName: z.string().min(1).max(120),
  format: z.enum(["png", "jpeg", "webp"]),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  aspectRatio: z.string().min(1).max(32),
  fileName: z.string().min(1).max(240),
  byteLength: z.number().int().min(0),
  sha256: z.string().length(64),
  dataUrl: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }).or(z.string().min(10)),
});

export const batchConfigSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  recipeId: z.string().min(1).max(120).optional(),
  recipeSnapshot: recipeSchema.optional(),
  recipePackageId: z.string().min(1).max(120).optional(),
  recipePackageSnapshot: z.instanceof(Blob).optional(),
  recipeParams: z.record(z.string(), z.unknown()).optional(),
  variants: z
    .array(deliveryVariantSpecSchema)
    .min(1, "At least one delivery variant is required")
    .refine(
      (variants) =>
        new Set(variants.map((variant) => variant.id)).size === variants.length,
      "Delivery variant IDs must be unique",
    ),
  concurrency: z.number().int().min(1).max(8).default(2),
  budgetCeilingCents: z.number().min(0),
  budgetId: z.string().min(1).max(64),
  stopOnFirstFailure: z.boolean().default(false),
  outputNamingTemplate: z.string().min(1).max(240).default("{name}_{variant}"),
});

export const batchItemSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(240),
  source: batchSourceImageSchema,
  parameters: z.record(z.string(), z.unknown()).optional(),
  status: z.enum([
    "pending",
    "running",
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
  ]),
  reviewState: z.enum(["unreviewed", "approved", "rejected", "flagged"]),
  reviewNotes: z.string().max(1000).optional(),
  jobId: z.string().max(64).optional(),
  error: z.string().optional(),
  estimatedCostCents: z.number().min(0),
  actualCostCents: z.number().min(0),
  deliverables: z.array(deliveryDeliverableSchema),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().min(0).optional(),
  retryCount: z.number().int().min(0).default(0),
});

export const deliveryManifestDeliverableSchema = z
  .object({
    deliverableId: z.string().min(1).max(129),
    itemId: z.string().min(1).max(64),
    itemName: z.string().min(1).max(240),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    variantName: z.string().min(1).max(120),
    filePath: z.string().min(1).max(260),
    format: z.string().min(1).max(16),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    aspectRatio: z.string().min(1).max(32),
    byteLength: z.number().int().min(0),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewState: z.enum(["unreviewed", "approved", "rejected", "flagged"]),
    actualCostCents: z.number().min(0),
  })
  .strict();

export const deliveryManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    manifestId: z.string().min(1).max(64),
    batchId: z.string().min(1).max(64),
    batchName: z.string().min(1).max(120),
    generatedAt: z.string().min(10),
    generator: z.string().min(1).max(120),
    summary: z
      .object({
        totalItems: z.number().int().min(0),
        totalDeliverables: z.number().int().min(0),
        totalCostCents: z.number().min(0),
        approvedCount: z.number().int().min(0),
        rejectedCount: z.number().int().min(0),
        flaggedCount: z.number().int().min(0),
      })
      .strict(),
    deliverables: z.array(deliveryManifestDeliverableSchema),
    integrity: z
      .object({
        manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();

export function validateBatchConfig(input: unknown): {
  valid: boolean;
  data?: BatchConfig;
  errors: string[];
} {
  const result = batchConfigSchema.safeParse(input);
  if (result.success) {
    return { valid: true, data: result.data as BatchConfig, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

export function validateBatchItem(input: unknown): {
  valid: boolean;
  data?: BatchItem;
  errors: string[];
} {
  const result = batchItemSchema.safeParse(input);
  if (result.success) {
    return { valid: true, data: result.data as BatchItem, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

export function validateDeliveryManifest(input: unknown): {
  valid: boolean;
  data?: DeliveryManifest;
  errors: string[];
} {
  const result = deliveryManifestSchema.safeParse(input);
  if (result.success) {
    return { valid: true, data: result.data as DeliveryManifest, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
