/** Unverified profile values for testing capability filters and accounting only. */
import type { ProviderCapabilities } from "../../../src/ai/providers/types";

export const DALLE3_PROFILE: ProviderCapabilities = {
  id: "dalle-3",
  name: "OpenAI DALL-E 3",
  version: "3.0",
  description:
    "Proprietary generative model with strong prompt adherence and detail.",
  modalities: ["text-to-image", "masked-edit"],
  dimensions: {
    minWidth: 1024,
    maxWidth: 1792,
    minHeight: 1024,
    maxHeight: 1792,
    maxMegapixels: 1.83,
    supportedAspectRatios: ["1:1", "16:9", "9:16"],
    discreteSizes: [
      { width: 1024, height: 1024 },
      { width: 1024, height: 1792 },
      { width: 1792, height: 1024 },
    ],
  },
  alpha: "post-process-matting-required",
  pricing: {
    currency: "USD",
    costPerStandardImageCents: 4.0, // $0.040 for 1024x1024 standard
    costPerHdImageCents: 8.0, // $0.080 for 1024x1024 HD; $0.120 for 1024x1792 HD
    secondaryMattingCostCents: 0.5, // Estimated secondary worker/segmentation cost
    chargeOnCancellation: true, // OpenAI charges once generation job is dispatched
  },
  terms: {
    providerId: "dalle-3",
    providerName: "OpenAI LLC",
    termsUrl: "https://openai.com/policies/terms-of-use",
    auditDate: "2026-09-20",
    retentionPolicy: "30-day-abuse-monitoring",
    customerDataUsedForTraining: false, // API data is excluded from training by default
    optOutAvailable: true,
    optOutByDefault: true,
    ipIndemnification: true, // Enterprise copyright shield provided
    commercialUsePermitted: true,
    contentModeration: {
      enforced: true,
      filtersPrompts: true,
      filtersOutputs: true,
      estimatedFalsePositiveRate: 0.038, // ~3.8% rejection on creative/artistic prompts
    },
    geographicRouting: "global",
  },
  latency: {
    p50Ms: 11200,
    p90Ms: 18500,
    p99Ms: 26000,
    coldStartPenaltyMs: 0,
  },
};

export const FLUX1_PRO_PROFILE: ProviderCapabilities = {
  id: "flux-1-pro",
  name: "Black Forest Labs FLUX.1 Pro",
  version: "1.0",
  description:
    "State-of-the-art open/commercial weights architecture optimized for typography and composition.",
  modalities: ["text-to-image", "image-to-image", "masked-edit"],
  dimensions: {
    minWidth: 256,
    maxWidth: 2048,
    minHeight: 256,
    maxHeight: 2048,
    maxMegapixels: 2.09,
    supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    stepSize: 16,
  },
  alpha: "post-process-matting-required",
  pricing: {
    currency: "USD",
    costPerStandardImageCents: 3.5, // $0.035 average on dedicated commercial endpoints
    costPerHdImageCents: 5.0,
    costPerMegapixelCents: 1.75,
    secondaryMattingCostCents: 0.5,
    batchDiscountPercent: 10,
    chargeOnCancellation: false, // Unstarted jobs cancelled in queue are not billed
  },
  terms: {
    providerId: "flux-1-pro",
    providerName: "Black Forest Labs Inc.",
    termsUrl: "https://blackforestlabs.ai/terms",
    auditDate: "2026-09-21",
    retentionPolicy: "zero-retention-ephemeral",
    customerDataUsedForTraining: false,
    optOutAvailable: true,
    optOutByDefault: true,
    ipIndemnification: false, // Standard commercial warranty without full patent/IP indemnification
    commercialUsePermitted: true,
    contentModeration: {
      enforced: true,
      filtersPrompts: true,
      filtersOutputs: false,
      estimatedFalsePositiveRate: 0.012, // Lower false positive rate
    },
    geographicRouting: "user-selected",
  },
  latency: {
    p50Ms: 4200,
    p90Ms: 7800,
    p99Ms: 12000,
    coldStartPenaltyMs: 800,
  },
};

export const SD35_LARGE_PROFILE: ProviderCapabilities = {
  id: "sd-3.5-large",
  name: "Stability AI Stable Diffusion 3.5 Large",
  version: "3.5",
  description:
    "Multi-modal diffusion transformer with native aspect-ratio flexibility and inpainting.",
  modalities: ["text-to-image", "image-to-image", "masked-edit", "outpainting"],
  dimensions: {
    minWidth: 512,
    maxWidth: 1536,
    minHeight: 512,
    maxHeight: 1536,
    maxMegapixels: 1.57,
    supportedAspectRatios: [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "21:9",
      "9:21",
    ],
    stepSize: 64,
  },
  alpha: "post-process-matting-required",
  pricing: {
    currency: "USD",
    costPerStandardImageCents: 6.5, // 6.5 API credits ≈ $0.065
    costPerHdImageCents: 8.0,
    secondaryMattingCostCents: 2.0, // Official Stability Cutout endpoint cost is 2 credits
    chargeOnCancellation: true,
  },
  terms: {
    providerId: "sd-3.5-large",
    providerName: "Stability AI Ltd.",
    termsUrl: "https://stability.ai/terms-of-use",
    auditDate: "2026-09-22",
    retentionPolicy: "zero-retention-ephemeral",
    customerDataUsedForTraining: false,
    optOutAvailable: true,
    optOutByDefault: true,
    ipIndemnification: true, // Enterprise tiers include commercial IP indemnity
    commercialUsePermitted: true,
    contentModeration: {
      enforced: true,
      filtersPrompts: true,
      filtersOutputs: true,
      estimatedFalsePositiveRate: 0.024,
    },
    geographicRouting: "global",
  },
  latency: {
    p50Ms: 6800,
    p90Ms: 12400,
    p99Ms: 18000,
    coldStartPenaltyMs: 1200,
  },
};

export const LOCAL_DIFFUSION_BASELINE_PROFILE: ProviderCapabilities = {
  id: "local-diffusion-baseline",
  name: "Local On-Device Diffusion Baseline",
  version: "1.0",
  description:
    "WebGPU/Wasm or local container baseline for on-device inference without cloud dependencies.",
  modalities: ["text-to-image", "image-to-image", "masked-edit"],
  dimensions: {
    minWidth: 256,
    maxWidth: 1024,
    minHeight: 256,
    maxHeight: 1024,
    maxMegapixels: 1.05,
    supportedAspectRatios: ["1:1", "4:3", "3:4"],
    stepSize: 64,
  },
  alpha: "post-process-matting-required",
  pricing: {
    currency: "USD",
    costPerStandardImageCents: 0.0, // Zero variable API cost
    costPerHdImageCents: 0.0,
    secondaryMattingCostCents: 0.0, // Local WASM segmentation
    chargeOnCancellation: false,
  },
  terms: {
    providerId: "local-diffusion-baseline",
    providerName: "On-Device Runtime (Open Source Weights)",
    termsUrl: "https://opensource.org/licenses/Apache-2.0",
    auditDate: "2026-09-22",
    retentionPolicy: "zero-retention-ephemeral",
    customerDataUsedForTraining: false,
    optOutAvailable: true,
    optOutByDefault: true,
    ipIndemnification: false,
    commercialUsePermitted: true,
    contentModeration: {
      enforced: false,
      filtersPrompts: false,
      filtersOutputs: false,
      estimatedFalsePositiveRate: 0.0,
    },
    geographicRouting: "user-selected",
  },
  latency: {
    p50Ms: 18500, // Client GPU dependent
    p90Ms: 34000,
    p99Ms: 60000,
    coldStartPenaltyMs: 15000, // Initial model weight download & compile time
  },
};

export const CANDIDATE_PROFILES: ProviderCapabilities[] = [
  DALLE3_PROFILE,
  FLUX1_PRO_PROFILE,
  SD35_LARGE_PROFILE,
  LOCAL_DIFFUSION_BASELINE_PROFILE,
];
