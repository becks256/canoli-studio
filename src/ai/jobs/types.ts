/**
 * Types, interfaces, and error classes for the asynchronous generation job service,
 * budget controls, candidate staging lifecycle, and revision-safe application.
 *
 * Implements the architecture defined in docs/AI_FEATURE_SPECS.md for Ticket T11.
 */

import type { BlendMode } from "../../core/model";
import type { ImageAsset } from "../../core/assets";

export type JobLifecycleState =
  | "draft"
  | "estimating"
  | "awaiting_consent"
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export type CandidateReviewState =
  "staged" | "previewed" | "accepted" | "rejected" | "discarded";

export type TaskKind =
  "asset" | "texture" | "background" | "object" | "overlay";

/** Thrown when estimated job cost exceeds the remaining approved budget ceiling. */
export class BudgetExceededError extends Error {
  readonly name = "BudgetExceededError";
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when explicit user consent or authorized approver ID is missing. */
export class ConsentRequiredError extends Error {
  readonly name = "ConsentRequiredError";
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when applying a candidate detects that document revision changed while in flight. */
export class RevisionConflictError extends Error {
  readonly name = "RevisionConflictError";
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when applying a candidate that violates the protected region invariant without an explicit override. */
export class ProtectedRegionViolationError extends Error {
  readonly name = "ProtectedRegionViolationError";
  readonly report?: import("../diff/types").ProtectedInvariantReport;
  constructor(
    message: string,
    report?: import("../diff/types").ProtectedInvariantReport,
  ) {
    super(message);
    this.report = report;
  }
}

/** Thrown when a generation job is aborted/cancelled. */
export class JobCancelledError extends Error {
  readonly name = "JobCancelledError";
  constructor(message: string = "Generation job was cancelled.") {
    super(message);
  }
}

/** Thrown when a generation job exceeds its maximum configured timeout deadline. */
export class JobTimeoutError extends Error {
  readonly name = "JobTimeoutError";
  constructor(message: string = "Generation job exceeded execution deadline.") {
    super(message);
  }
}

export interface GenerationJobOptions {
  providerId?: string; // Default: "flux-1-pro"
  budgetId: string;
  baseRevision: number;
  sourceDocumentId?: string;
  idempotencyKey?: string;
  timeoutMs?: number; // Default: 60000 ms
  taskKind?: TaskKind;
  tags?: string[];
}

export interface JobProgress {
  phase: string;
  percent: number; // 0.0 to 1.0
  message: string;
  elapsedMs: number;
}

export interface CandidateValidation {
  valid: boolean;
  errors: string[];
  decodedWidth: number;
  decodedHeight: number;
  hasAlpha: boolean;
  byteLength: number;
  mimeType: string;
}

export interface GenerationCandidate {
  /** Restored candidates require explicit placement review before applying. */
  restored?: boolean;
  id: string;
  jobId: string;
  asset: ImageAsset;
  width: number;
  height: number;
  hasAlpha: boolean;
  validation: CandidateValidation;
  reviewState: CandidateReviewState;
  createdAt: string;
  revisedPrompt?: string;
  warnings?: string[];
  diffReport?: import("../diff/types").ProtectedInvariantReport;
  /** Display of the last verified placement; transient and bound to that document revision. */
  compositePreview?: {
    thumbnail: string;
    documentId: string;
    revision: number;
  };
  rawBuffer?: Uint8Array;
}

export interface GenerationRecord {
  id: string;
  jobId: string;
  providerId: string;
  providerName: string;
  modelVersion: string;
  taskKind: TaskKind;
  prompt: string;
  revisedPrompt?: string;
  targetWidth: number;
  targetHeight: number;
  hasAlpha: boolean;
  estimatedCostCents: number;
  actualCostCents: number;
  currency: string;
  sourceDocumentId?: string;
  baseRevision: number;
  createdAt: string;
  completedAt: string;
  durationMs: number;
  status: JobLifecycleState;
  provenanceVersion: number;
  // NOTE: In strict accordance with AGENTS.md, zero API keys, auth tokens,
  // or user-identifying credentials are stored in provenance records.
}

export interface ApplyCandidateOptions {
  expectedRevision?: number; // Validated against document revision
  allowStaleRevision?: boolean; // Explicit override if user manually approves re-placement
  layerName?: string;
  parentId?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  blendMode?: BlendMode;
  /** For masked edits: selection or mask to attach to the created layer */
  maskSelection?: import("../../core/drawing").SelectionData;
  /** For masked edits: feather radius for the layer mask */
  maskFeather?: number;
  /** Explicit override if candidate has invariant violations */
  allowViolationOverride?: boolean;
}
