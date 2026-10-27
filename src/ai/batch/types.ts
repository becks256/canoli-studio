/**
 * Types, interfaces, and contracts for the Resumable Batch Runner
 * and Delivery Manifest System (Ticket T15, Milestone W02/W03).
 *
 * Enforces:
 * - Safe retry/resumption without duplicate job submissions or export overwrites
 * - Clear per-item cost, failure, and human review states
 * - SHA-256 verifiable delivery manifests and variant exports
 * - Complete isolation from document undo history
 */

import type { Recipe } from "../recipes/types";
import type { DocumentData } from "../../core/model";

export type BatchItemStatus =
  "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export type BatchItemReviewState =
  "unreviewed" | "approved" | "rejected" | "flagged";

export type BatchRunStatus =
  "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface DeliveryVariantSpec {
  id: string;
  name: string;
  targetWidth: number;
  targetHeight: number;
  format: "png" | "jpeg" | "webp" | "avif" | "tiff" | "pdf";
  color?:import('../../core/color/output-record').ColorOutputSource;
  tiffVariant?:import('../../core/tiff').TiffVariant;
  pdfDpi?:number;
  quality?:number;
  avifLossless?:boolean;
  avifSpeed?:number;
  fit: "cover" | "contain" | "fill";
  nameTemplate?: string; // e.g. "{name}_{variant}_{width}x{height}"
}

export interface DeliveryDeliverable {
  id: string;
  itemId: string;
  variantId: string;
  variantName: string;
  settingsSha256?:string;
  color?:import('../../core/color/output-record').ColorOutputReceipt;
  format: "png" | "jpeg" | "webp" | "avif" | "tiff" | "pdf";
  width: number;
  height: number;
  aspectRatio: string;
  fileName: string;
  byteLength: number;
  sha256: string;
  blob?: Blob;
  dataUrl?: string;
  createdAt: string;
}

/** A source queued with optional recipe overrides; persisted separately on BatchItem. */
export interface BatchSourceInput extends BatchSourceImage {
  parameters?: Record<string, unknown>;
}

export interface BatchPreparation {
  version:1;
  sha256:string;
  byteLength:number;
  inputsSha256:string;
}

export interface BatchSourceImage {
  id: string;
  name: string;
  width: number;
  height: number;
  mimeType: string;
  byteLength: number;
  sha256?: string;
  assetId?: string;
  dataUrl?: string;
  blob?: Blob;
  raw?:import('./raw').BatchRawSource;
}

export interface BatchItem {
  id: string;
  name: string;
  source: BatchSourceImage;
  parameters?: Record<string, unknown>;
  status: BatchItemStatus;
  reviewState: BatchItemReviewState;
  reviewNotes?: string;
  jobId?: string;
  error?: string;
  estimatedCostCents: number;
  actualCostCents: number;
  checkpoint?: DocumentData;
  preparation?:BatchPreparation;
  deliverables: DeliveryDeliverable[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
}

export interface BatchConfig {
  id: string;
  name: string;
  recipeId?: string;
  recipeSnapshot?: Recipe;
  recipePackageId?: string;
  recipePackageSnapshot?: Blob;
  recipeParams?: Record<string, unknown>;
  variants: DeliveryVariantSpec[];
  concurrency: number; // 1 to 8
  budgetCeilingCents: number;
  budgetId: string;
  stopOnFirstFailure: boolean;
  outputNamingTemplate: string;
}

export interface BatchRunSummary {
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: number;
  totalEstimatedCostCents: number;
  totalActualCostCents: number;
  approvedCount: number;
  rejectedCount: number;
  flaggedCount: number;
}

export interface DeliveryManifestDeliverable {
  deliverableId: string;
  itemId: string;
  itemName: string;
  sourceHash: string;
  settingsSha256?:string;
  color?:import('../../core/color/output-record').ColorOutputReceipt;
  variantName: string;
  filePath: string;
  format: string;
  width: number;
  height: number;
  aspectRatio: string;
  byteLength: number;
  sha256: string;
  reviewState: BatchItemReviewState;
  actualCostCents: number;
}

export interface DeliveryManifest {
  schemaVersion: 2|3;
  manifestId: string;
  batchId: string;
  batchName: string;
  generatedAt: string;
  generator: string;
  summary: {
    totalItems: number;
    totalDeliverables: number;
    totalCostCents: number;
    approvedCount: number;
    rejectedCount: number;
    flaggedCount: number;
  };
  deliverables: DeliveryManifestDeliverable[];
  integrity: {
    manifestHash: string;
  };
}

export interface BatchRun {
  id: string;
  config: BatchConfig;
  status: BatchRunStatus;
  items: BatchItem[];
  summary: BatchRunSummary;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deliveryManifest?: DeliveryManifest;
  /** Derived read-time failure; preserves access to legacy runs without certifying them. */
  deliveryManifestError?: string;
}

export const DEFAULT_DELIVERY_VARIANTS: DeliveryVariantSpec[] = [
  {
    id: "var-1x1",
    name: "Square (1:1)",
    targetWidth: 1080,
    targetHeight: 1080,
    format: "png",
    fit: "cover",
    nameTemplate: "{name}_1x1",
  },
  {
    id: "var-9x16",
    name: "Story / Reel (9:16)",
    targetWidth: 1080,
    targetHeight: 1920,
    format: "png",
    fit: "cover",
    nameTemplate: "{name}_9x16",
  },
  {
    id: "var-16x9",
    name: "Landscape (16:9)",
    targetWidth: 1920,
    targetHeight: 1080,
    format: "png",
    fit: "cover",
    nameTemplate: "{name}_16x9",
  },
  {
    id: "var-4x5",
    name: "Social Feed (4:5)",
    targetWidth: 1080,
    targetHeight: 1350,
    format: "png",
    fit: "cover",
    nameTemplate: "{name}_4x5",
  },
];
