import type { MarqueeSelection } from "../../dom/values";
import type { VectorPath } from "../../dom";

export type AnalysisModality = "ocr" | "tagging" | "segmentation";

export type ExecutionMode = "local" | "remote";

export interface ResourceProfile {
  /** Download footprint in bytes (0 for built-in/local heuristics or cloud). */
  downloadBytes: number;
  /** Estimated working memory heap/buffer footprint in bytes. */
  memoryBytes: number;
  /** Typical execution latency in milliseconds. */
  latencyMs: number;
  /** Whether the adapter requires WebGPU hardware acceleration. */
  requiresGpu: boolean;
}

export interface AdapterLicense {
  /** SPDX license identifier, e.g. "Apache-2.0", "MIT", "Proprietary". */
  spdx: string;
  /** Whether the license is safe for unrestricted commercial distribution. */
  commercialSafe: boolean;
  /** Whether there is a viral/copyleft condition (e.g. GPL). */
  copyleftRisk: boolean;
  /** Summary of licensing constraints or attribution requirements. */
  summary: string;
  /** Optional link to upstream license terms. */
  termsUrl?: string;
}

export interface PrivacyProfile {
  /** Guarantees no data leaves the browser environment. */
  localOnly: boolean;
  /** Whether EXIF/GPS/private metadata is stripped prior to processing. */
  stripsExif: boolean;
  /** Data retention policy of the engine/provider. */
  dataRetentionPolicy:
    "none" | "stateless-ephemeral" | "retained" | "training-consent-required";
  /** Whether telemetry or image payloads are shared with third parties. */
  thirdPartySharing: boolean;
}

export interface AnalysisImageInput {
  assetId?: string;
  blob?: Blob;
  bitmap?: ImageBitmap;
  buffer?: Uint8Array;
  width: number;
  height: number;
  name?: string;
  mimeType?: string;
}

export interface OcrOptions {
  language?: string;
  detectOrientation?: boolean;
  region?: { x: number; y: number; width: number; height: number };
}

export interface TaggingOptions {
  maxTags?: number;
  minConfidence?: number;
  categoryHint?: string;
}

export interface SegmentationOptions {
  target?: "subject" | "foreground" | "all";
  pointPrompt?: { x: number; y: number };
  boxPrompt?: { x: number; y: number; width: number; height: number };
  outputKind?: "selection" | "paint" | "vector";
}

export interface RemoteRequestOptions {
  /** Explicit user consent required before transmitting any payload to cloud. */
  consentGiven: boolean;
  /** Maximum allowable spend ceiling in cents. */
  spendCeilingCents?: number;
  /** Network timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface OcrBlock {
  id: string;
  text: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  language?: string;
}

export interface OcrAnalysisResult {
  adapterId: string;
  executionMode: ExecutionMode;
  blocks: OcrBlock[];
  fullText: string;
  durationMs: number;
}

export interface TagItem {
  tag: string;
  confidence: number;
  category?: string;
}

export interface TaggingAnalysisResult {
  adapterId: string;
  executionMode: ExecutionMode;
  tags: TagItem[];
  durationMs: number;
}

export interface SegmentationMaskCandidate {
  id: string;
  label: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
  kind: "selection" | "paint" | "vector";
  selectionData?: MarqueeSelection;
  paths?: VectorPath[];
  baseCoverage?: number;
}

export interface SegmentationAnalysisResult {
  adapterId: string;
  executionMode: ExecutionMode;
  candidates: SegmentationMaskCandidate[];
  durationMs: number;
}

export interface AnalysisAdapter {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly executionMode: ExecutionMode;
  readonly modalities: AnalysisModality[];
  readonly resourceProfile: ResourceProfile;
  readonly license: AdapterLicense;
  readonly privacy: PrivacyProfile;
}

export interface OcrAdapter extends AnalysisAdapter {
  analyzeOcr(
    input: AnalysisImageInput,
    options?: OcrOptions & RemoteRequestOptions,
  ): Promise<OcrAnalysisResult>;
}

export interface TaggingAdapter extends AnalysisAdapter {
  analyzeTags(
    input: AnalysisImageInput,
    options?: TaggingOptions & RemoteRequestOptions,
  ): Promise<TaggingAnalysisResult>;
}

export interface SegmentationAdapter extends AnalysisAdapter {
  analyzeSegmentation(
    input: AnalysisImageInput,
    options?: SegmentationOptions & RemoteRequestOptions,
  ): Promise<SegmentationAnalysisResult>;
}
