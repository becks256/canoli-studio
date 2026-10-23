import type {HistoryOrigin} from '../core/history-provenance';
/**
 * Versioned Host Scripting Bridge
 *
 * Connects the isolated script sandbox to host async services (jobs, assets)
 * without exposing host secrets/credentials, without blocking the script worker,
 * and with strict host-commit permission enforcement.
 *
 * Implements Ticket T18 requirements from docs/IMPLEMENTATION_ROADMAP.md
 * and docs/AI_FEATURE_SPECS.md.
 */

import type { GenerationJobService } from "../ai/jobs/service";
import type { AssetStore } from "../core/assets";
import type { Document } from "../dom";
import type { PluginPermission } from "../plugins";

export interface HostJobRequest {
  kind?: "generation" | "analysis" | "asset";
  prompt?: string;
  output?: { width?: number; height?: number; alpha?: boolean };
  taskKind?: "asset" | "texture" | "background" | "object" | "overlay";
  providerId?: string;
  budgetId?: string;
  idempotencyKey?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface HostJobTicket {
  id: string;
  kind: string;
  status: "queued" | "running";
  createdAt: string;
}

export interface HostJobCandidateSummary {
  id: string;
  assetId: string;
  width: number;
  height: number;
  reviewState: string;
  hasAlpha: boolean;
}

export interface HostJobInfo {
  id: string;
  status: string;
  progress: { phase: string; percent: number; message: string };
  candidate?: HostJobCandidateSummary | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface HostBridgeOptions {
  ai?: GenerationJobService;
  assets?: AssetStore;
  document?: Document;
  permissions?: readonly PluginPermission[];
  pluginId?: string;
  isTrustedScript?: boolean;
  historyOrigin?:HistoryOrigin;
  assertCanCommit?:()=>void;
}

export interface HostCallMessage {
  id: number;
  service: string;
  method: string;
  args: unknown[];
}

export interface HostCallResponse {
  type: "host:call:result" | "host:call:error";
  id: number;
  result?: unknown;
  error?: string;
}

export class HostBridge {
  private ai?: GenerationJobService;
  private assets?: AssetStore;
  private document?: Document;
  private permissions: readonly PluginPermission[];
  private pluginId?: string;
  private isTrustedScript: boolean;
  private inBandRevisionsCount = 0;
  private historyOrigin?:HistoryOrigin;
  private assertCanCommit?:()=>void;
  private submittedJobIds = new Set<string>();

  get callerPluginId(): string | undefined {
    return this.pluginId;
  }

  get inBandRevisions(): number {
    return this.inBandRevisionsCount;
  }

  constructor(options: HostBridgeOptions = {}) {
    this.ai = options.ai;
    this.historyOrigin=options.historyOrigin;this.assertCanCommit=options.assertCanCommit;
    this.assets = options.assets;
    this.document = options.document;
    this.permissions = options.permissions ?? [];
    this.pluginId = options.pluginId;
    this.isTrustedScript = options.isTrustedScript ?? !options.pluginId;
  }

  private checkPermission(
    permission: PluginPermission,
    actionDescription: string,
  ): void {
    if (this.isTrustedScript) return; // User scripts have full host capabilities
    if (!this.permissions.includes(permission)) {
      throw new Error(
        `Permission denied: '${permission}' is required to ${actionDescription}.`,
      );
    }
  }

  async dispatch(
    service: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    if (service === "jobs") {
      return this.dispatchJobs(method, args);
    }
    if (service === "assets") {
      return this.dispatchAssets(method, args);
    }
    throw new Error(`Unknown host service: ${service}`);
  }

  private async dispatchJobs(
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    if (method === "submit") {
      this.checkPermission("jobs:run", "submit host jobs");
      const request = (args[0] ?? {}) as HostJobRequest;
      return this.submitJob(request);
    }
    if (method === "get") {
      // Inspecting status is allowed if jobs:run is granted or for trusted scripts
      if (!this.isTrustedScript && !this.permissions.includes("jobs:run")) {
        this.checkPermission("jobs:run", "inspect host jobs");
      }
      const jobId = String(args[0] ?? "");
      return this.getJob(jobId);
    }
    if (method === "cancel") {
      this.checkPermission("jobs:run", "cancel host jobs");
      const jobId = String(args[0] ?? "");
      return this.cancelJob(jobId);
    }
    if (method === "list") {
      if (!this.isTrustedScript && !this.permissions.includes("jobs:run")) {
        this.checkPermission("jobs:run", "list host jobs");
      }
      return this.listJobs();
    }
    if (method === "applyCandidate") {
      this.checkPermission(
        "document:write",
        "apply generated candidate to document",
      );
      const candidateId = String(args[0] ?? "");
      const options = (args[1] ?? {}) as Record<string, unknown>;
      return this.applyCandidate(candidateId, options);
    }
    throw new Error(`Unknown jobs method: ${method}`);
  }

  private async dispatchAssets(
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    if (method === "get") {
      this.checkPermission("assets:read", "inspect asset metadata");
      const assetId = String(args[0] ?? "");
      if (!this.assets) throw new Error("Asset store not available.");
      const asset = this.assets.get(assetId);
      return {
        id: asset.id,
        name: asset.name,
        width: asset.width,
        height: asset.height,
      };
    }
    if (method === "list") {
      this.checkPermission("assets:read", "list asset references");
      if (!this.assets) return [];
      return this.assets.values().map((a) => ({
        id: a.id,
        name: a.name,
        width: a.width,
        height: a.height,
      }));
    }
    throw new Error(`Unknown assets method: ${method}`);
  }

  private async submitJob(request: HostJobRequest): Promise<HostJobTicket> {
    if (!this.ai) {
      throw new Error("Host AI generation service is not available.");
    }

    const baseRevision = this.document
      ? this.document.getSnapshot().revision
      : 0;
    const taskKind = request.taskKind ?? "asset";
    const prompt =
      typeof request.prompt === "string"
        ? request.prompt.slice(0, 1000)
        : "Untitled generation";
    const output = request.output ?? { width: 512, height: 512, alpha: true };
    const rawWidth =
      typeof output.width === "number" && Number.isFinite(output.width)
        ? Math.floor(output.width)
        : 512;
    const rawHeight =
      typeof output.height === "number" && Number.isFinite(output.height)
        ? Math.floor(output.height)
        : 512;
    const targetWidth = Math.max(256, Math.min(2048, rawWidth));
    const targetHeight = Math.max(256, Math.min(2048, rawHeight));

    const job = await this.ai.submit(
      {
        prompt,
        modality: "text-to-image",
        targetWidth,
        targetHeight,
        requireAlpha: Boolean(output.alpha ?? true),
      },
      {
        providerId: request.providerId ?? "flux-1-pro",
        budgetId: request.budgetId ?? "default-budget",
        baseRevision,
        idempotencyKey: request.idempotencyKey,
        taskKind,
        tags: Array.isArray(request.tags)
          ? request.tags.map(String)
          : undefined,
      },
    );

    this.submittedJobIds.add(job.id);

    // Return an immediate ticket without blocking the script sandbox.
    // The job executes asynchronously on the host independently of the 5s script timeout.
    return {
      id: job.id,
      kind: taskKind,
      status: "queued",
      createdAt: job.createdAt,
    };
  }

  private async getJob(jobId: string): Promise<HostJobInfo | null> {
    if (!this.ai)
      throw new Error("Host AI generation service is not available.");
    if (!this.isTrustedScript && !this.submittedJobIds.has(jobId)) {
      return null;
    }
    const job = this.ai.getJob(jobId);
    if (!job) return null;

    const progress = job.progress;
    let candidateSummary: HostJobCandidateSummary | null = null;
    if (job.candidate) {
      candidateSummary = {
        id: job.candidate.id,
        assetId: job.candidate.asset.id,
        width: job.candidate.width,
        height: job.candidate.height,
        reviewState: job.candidate.reviewState,
        hasAlpha: job.candidate.hasAlpha,
      };
    }

    // Strictly ensure zero sandbox credentials or provider API keys are returned
    return {
      id: job.id,
      status: job.state,
      progress: {
        phase: progress?.phase ?? job.state,
        percent: progress?.percent ?? (job.state === "succeeded" ? 1.0 : 0),
        message: progress?.message ?? "",
      },
      candidate: candidateSummary,
      error: job.error?.message ?? null,
      createdAt: job.createdAt,
      completedAt: job.completedAt ?? null,
    };
  }

  private async cancelJob(jobId: string): Promise<boolean> {
    if (!this.ai)
      throw new Error("Host AI generation service is not available.");
    if (!this.isTrustedScript && !this.submittedJobIds.has(jobId)) {
      throw new Error(`Job not found or access denied: ${jobId}`);
    }
    return this.ai.cancel(jobId);
  }

  private async listJobs(): Promise<HostJobInfo[]> {
    if (!this.ai) return [];
    const jobs = this.ai.listJobs();
    const result: HostJobInfo[] = [];
    for (const job of jobs) {
      if (!this.isTrustedScript && !this.submittedJobIds.has(job.id)) continue;
      const info = await this.getJob(job.id);
      if (info) result.push(info);
    }
    return result;
  }

  private async applyCandidate(
    candidateId: string,
    options: Record<string, unknown>,
  ): Promise<{ layerId: string }> {
    if (!this.ai || !this.document || !this.assets) {
      throw new Error("Application services not available to apply candidate.");
    }
    const before=this.document.getSnapshot().revision,origin={...(this.historyOrigin??this.document._getHistoryOrigin()),requestId:crypto.randomUUID()};
    try {
      const layer = await this.ai.applyCandidate(candidateId, {
        ...options,document:this.document,assetStore:this.assets,expectedRevision:before,
      },origin,this.assertCanCommit);
      return {layerId:layer.id};
    }finally{const point=this.document.getSnapshot().provenance.current;if(point?.origin.requestId===origin.requestId&&point.acceptedRevision>before)this.inBandRevisionsCount++;}

  }
}
