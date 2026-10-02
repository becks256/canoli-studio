/**
 * Types and interfaces for AI generation providers, capabilities,
 * pricing schedules, data retention terms, and bake-off evaluation.
 *
 * Implements the architecture defined in docs/AI_FEATURE_SPECS.md
 * and fulfills the T10 provider capability and bake-off specification.
 */

export type GenerationModality =
  "text-to-image" | "image-to-image" | "masked-edit" | "outpainting";

export type AlphaCapability =
  | "native-rgba" // Provider natively generates 32-bit RGBA with alpha channel
  | "post-process-matting-required" // Provider generates opaque RGB; secondary segmentation/matting pass required
  | "unsupported"; // Opaque only; cannot produce transparency

export type DataRetentionPolicy =
  | "zero-retention-ephemeral" // Request and output bytes discarded immediately after transmission
  | "30-day-abuse-monitoring" // Retained up to 30 days for safety/abuse inspection, not for training
  | "persistent-storage" // Retained indefinitely on provider servers unless deleted
  | "model-training-retained"; // Retained and used for future model training

export interface SupportedDimensions {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  maxMegapixels: number;
  supportedAspectRatios: string[]; // e.g. ["1:1", "16:9", "9:16", "4:3", "3:4"]
  discreteSizes?: Array<{ width: number; height: number }>;
  stepSize?: number; // e.g. 64 or 8
}

export interface ProviderPricingSchedule {
  currency: string;
  costPerStandardImageCents: number; // e.g. 1024x1024 standard quality
  costPerHdImageCents?: number; // e.g. high-detail or higher resolution tier
  costPerMegapixelCents?: number; // usage-based scaling per megapixel
  secondaryMattingCostCents: number; // added cost if secondary background cutout pass is required
  batchDiscountPercent?: number; // volume discount if applicable
  chargeOnCancellation: boolean; // whether provider bills jobs cancelled after queueing
}

export interface ProviderTerms {
  providerId: string;
  providerName: string;
  termsUrl: string;
  auditDate: string; // ISO date of last terms review
  retentionPolicy: DataRetentionPolicy;
  customerDataUsedForTraining: boolean;
  optOutAvailable: boolean;
  optOutByDefault: boolean;
  ipIndemnification: boolean; // Whether provider indemnifies against copyright/IP claims
  commercialUsePermitted: boolean;
  contentModeration: {
    enforced: boolean;
    filtersPrompts: boolean;
    filtersOutputs: boolean;
    estimatedFalsePositiveRate: number; // 0.0 to 1.0
  };
  geographicRouting: "us" | "eu" | "global" | "user-selected";
}

export interface ProviderLatencyProfile {
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  coldStartPenaltyMs?: number;
}

export interface ProviderCapabilities {
  id: string;
  name: string;
  version: string;
  description: string;
  modalities: GenerationModality[];
  dimensions: SupportedDimensions;
  alpha: AlphaCapability;
  pricing: ProviderPricingSchedule;
  terms: ProviderTerms;
  latency: ProviderLatencyProfile;
}

import type { ProtectedInvariantReport, ProtectedRegion } from "../diff/types";

export interface GenerationRequest {
  prompt: string;
  negativePrompt?: string;
  modality: GenerationModality;
  targetWidth: number;
  targetHeight: number;
  aspectRatio?: string;
  requireAlpha?: boolean;
  qualityTier?: "standard" | "hd";
  referenceImage?: {
    width: number;
    height: number;
    data: Uint8Array; // RGBA
    mimeType: string;
  };
  mask?: {
    width: number;
    height: number;
    coverage: Uint8Array; // Alpha / coverage mask (255 = edit region)
  };
  protectedRegions?: ProtectedRegion[];
  protectedMask?: {
    width: number;
    height: number;
    coverage: Uint8Array; // 255 = protected
  };
  featherRadius?: number;
  seed?: number;
  /** Adversarial test options to simulate model violations in tests */
  adversarialOptions?: {
    leakIntoProtected?: boolean;
    modifyOutsideMask?: boolean;
    leakDelta?: number;
  };
}

export interface GenerationCandidateResult {
  id: string;
  providerId: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  imageData: Uint8Array; // RGBA buffer
  mimeType: string;
  durationMs: number;
  costCents: number;
  revisedPrompt?: string;
  warnings?: string[];
  diffReport?: ProtectedInvariantReport;
}

export interface HumanApprovedBudget {
  approvedCeilingCents: number;
  consentGiven: boolean;
  approverId: string;
  approvalTimestamp: string;
  spentSoFarCents: number;
  expiresAt?: string;
}

export interface AiProviderAdapter {
  readonly capabilities: ProviderCapabilities;

  /**
   * Generates an image candidate.
   * Throws if budget constraint is violated or explicit consent is missing.
   */
  generate(
    request: GenerationRequest,
    budget: HumanApprovedBudget,
    signal?: AbortSignal,
  ): Promise<GenerationCandidateResult>;
}
