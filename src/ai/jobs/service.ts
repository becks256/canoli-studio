import {
  validateGenerationRequest,
  validateProviderRequest,
} from "./validate-request";
/**
 * Asynchronous Generation Job Service and Lifecycle Controller.
 *
 * Implements the asynchronous job lifecycle, idempotency key deduplication,
 * cancellation tokens, timeout guards, budget reservation settlement,
 * and staging shelf coordination for Ticket T11.
 */

import { GenerationCandidateStorage } from "./candidate-storage";
import { GenerationJournal } from "./journal";
import type { GenerationJournalEntry } from "./journal";
import { generationFingerprint } from "./fingerprint";
import { id } from "../../core/model";
import type { AssetStore } from "../../core/assets";
import type { Document, RasterLayer } from "../../dom";
import type { AiProviderAdapter, GenerationRequest } from "../providers/types";
import type { ProviderRegistry } from "../providers/registry";
import {
  previewCandidatePlacement,
  applyCandidateToDocument,
  applyMaskedEditToDocument,
} from "./apply";
import type { ApplyMaskedEditOptions } from "./apply";
import { BudgetLedger } from "./ledger";
import type { BudgetReservation } from "./ledger";
import { StagedAssetRepository } from "./staging";
import type {
  ApplyCandidateOptions,
  GenerationCandidate,
  GenerationJobOptions,
  GenerationRecord,
  JobLifecycleState,
  JobProgress,
  TaskKind,
} from "./types";
import { JobCancelledError, JobTimeoutError } from "./types";

/** Settle host work even when an adapter does not implement AbortSignal. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new JobCancelledError("Job cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export class GenerationJob {
  readonly id: string;
  readonly #request: GenerationRequest;
  readonly #options: GenerationJobOptions;

  /** Detached snapshots: callers cannot change approved dispatch or provenance. */
  get request(): GenerationRequest {
    return structuredClone(this.#request);
  }
  get options(): GenerationJobOptions {
    return structuredClone(this.#options);
  }
  readonly baseRevision: number;
  readonly createdAt: string;

  state: JobLifecycleState = "queued";
  estimatedCostCents: number;
  actualCostCents?: number;
  billingState: "reserved" | "pending" | "settled" = "reserved";
  progress: JobProgress;
  candidate?: GenerationCandidate;
  record?: GenerationRecord;
  error?: Error;
  completedAt?: string;

  private listeners = new Set<(job: GenerationJob) => void>();
  private resolvePromise?: (candidate: GenerationCandidate) => void;
  private rejectPromise?: (error: Error) => void;
  private resultPromise: Promise<GenerationCandidate>;

  constructor(
    jobId: string,
    request: GenerationRequest,
    options: GenerationJobOptions,
    estimatedCostCents: number,
    createdAt?: string,
  ) {
    this.id = jobId;
    this.#request = structuredClone(request);
    this.#options = structuredClone(options);
    this.baseRevision = options.baseRevision;
    this.estimatedCostCents = estimatedCostCents;
    this.createdAt = createdAt ?? new Date().toISOString();
    this.progress = {
      phase: "queued",
      percent: 0,
      message: "Job queued for execution",
      elapsedMs: 0,
    };

    this.resultPromise = new Promise<GenerationCandidate>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    void this.resultPromise.catch(() => {});
  }

  subscribe(listener: (job: GenerationJob) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Awaits completion of the generation job.
   * Resolves with the staged candidate on success, or rejects if failed/cancelled/timed-out.
   */
  async result(): Promise<GenerationCandidate> {
    return this.resultPromise;
  }

  _setState(nextState: JobLifecycleState): void {
    this.state = nextState;
    this._notify();
  }

  _setProgress(progress: Partial<JobProgress>): void {
    this.progress = { ...this.progress, ...progress };
    this._notify();
  }

  _resolveResult(
    candidate: GenerationCandidate,
    record: GenerationRecord,
  ): void {
    this.state = "succeeded";
    this.candidate = candidate;
    this.record = record;
    this.actualCostCents = record.actualCostCents;
    this.completedAt = record.completedAt;
    this.progress = {
      phase: "completed",
      percent: 1.0,
      message: "Generation completed and candidate staged",
      elapsedMs: record.durationMs,
    };
    this._notify();
    this.resolvePromise?.(candidate);
  }

  _rejectResult(
    error: Error,
    terminalState: JobLifecycleState = "failed",
  ): void {
    this.state = terminalState;
    this.error = error;
    this.completedAt = new Date().toISOString();
    this.progress = {
      phase: terminalState,
      percent: 1.0,
      message: error.message,
      elapsedMs: this.progress.elapsedMs,
    };
    this._notify();
    this.rejectPromise?.(error);
  }

  private _notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch {
        // Prevent subscriber exceptions from disrupting job lifecycle
      }
    }
  }
}

export class GenerationJobService {
  readonly providerRegistry: ProviderRegistry;
  readonly budgetLedger: BudgetLedger;
  readonly staging: StagedAssetRepository;
  readonly ready: Promise<void>;
  private readonly journal?: GenerationJournal;
  private disposed = false;
  private readonly candidateStorage?: GenerationCandidateStorage;
  private restoringCandidates?: Promise<GenerationCandidate[]>;
  private discardedCandidateIds = new Set<string>();
  private recoveringJobs = new Map<string, Promise<GenerationJob>>();

  private jobs = new Map<string, GenerationJob>();
  private idempotencyMap = new Map<string, GenerationJob>();
  private idempotencyFingerprints = new Map<string, string>();
  private records = new Map<string, GenerationRecord>();
  private abortControllers = new Map<string, AbortController>();
  private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reservations = new Map<string, BudgetReservation>();

  constructor({
    providerRegistry,
    budgetLedger,
    staging,
    journal,
    candidateStorage,
  }: {
    providerRegistry: ProviderRegistry;
    budgetLedger: BudgetLedger;
    staging: StagedAssetRepository;
    journal?: GenerationJournal;
    candidateStorage?: GenerationCandidateStorage;
  }) {
    this.providerRegistry = providerRegistry;
    this.budgetLedger = budgetLedger;
    this.staging = staging;
    this.journal = journal;
    this.candidateStorage = candidateStorage;
    this.ready = journal
      ? this.refreshAccounting().then(() => {})
      : Promise.resolve();
    void this.ready.catch(() => {});
  }

  /** Restore verified saved pixels for explicit review; never calls a provider. */
  async restoreCandidates(): Promise<GenerationCandidate[]> {
    await this.ready;
    if (!this.candidateStorage) return this.staging.listCandidates();
    if (!this.restoringCandidates) {
      this.restoringCandidates = (async () => {
        const saved = await this.candidateStorage!.list();
        const added: string[] = [];
        try {
          for (const item of saved) {
            if (this.disposed)
              throw new Error("Generation service is disposed.");
            if (
              this.discardedCandidateIds.has(item.id) ||
              this.staging.getCandidate(item.id)
            )
              continue;
            const protection = item.protection;
            const candidate = await this.staging.stageCandidate(
              item.jobId,
              {
                id: item.id,
                providerId: item.record.providerId,
                width: item.width,
                height: item.height,
                hasAlpha: item.hasAlpha,
                imageData: new Uint8Array(await item.blob.arrayBuffer()),
                mimeType: item.blob.type,
                costCents: item.record.actualCostCents,
                durationMs: item.record.durationMs,
                revisedPrompt: item.record.revisedPrompt,
              },
              {
                prompt: item.record.prompt,
                modality: protection ? "masked-edit" : "text-to-image",
                targetWidth: item.width,
                targetHeight: item.height,
                requireAlpha: item.hasAlpha,
                referenceImage: protection
                  ? {
                      width: item.width,
                      height: item.height,
                      data: new Uint8Array(protection.referenceBuffer),
                      mimeType: "image/png",
                    }
                  : undefined,
                mask: protection?.editMask
                  ? {
                      width: item.width,
                      height: item.height,
                      coverage: protection.editMask,
                    }
                  : undefined,
                protectedMask: protection?.protectedMask
                  ? {
                      width: item.width,
                      height: item.height,
                      coverage: protection.protectedMask,
                    }
                  : undefined,
                protectedRegions: protection?.protectedRegions,
                featherRadius: protection?.featherRadius,
              },
            );
            if (this.discardedCandidateIds.has(candidate.id)) {
              this.staging.discard(candidate.id);
              continue;
            }
            added.push(candidate.id);
            if (!candidate.validation.valid)
              throw new Error(
                `Saved candidate could not be decoded: ${candidate.validation.errors.join("; ")}`,
              );
            if (protection)
              this.staging.verifyProtection(candidate.id, protection);
            candidate.createdAt = item.createdAt;
            candidate.restored = true;
            this.records.set(item.jobId, item.record);
          }
          if (this.disposed) throw new Error("Generation service is disposed.");
          return this.staging.listCandidates();
        } catch (error) {
          for (const candidateId of added) this.staging.discard(candidateId);
          throw error;
        }
      })().finally(() => {
        this.restoringCandidates = undefined;
      });
    }
    return this.restoringCandidates;
  }

  private async refreshAccounting(): Promise<GenerationJournalEntry[]> {
    if (!this.journal) return [];
    const snapshot = await this.journal.read();
    const current = this.budgetLedger.snapshot();
    const savedIds = new Set(
      snapshot.ledger.budgets.map((entry) => entry.budgetId),
    );
    snapshot.ledger.budgets.push(
      ...current.budgets.filter((entry) => !savedIds.has(entry.budgetId)),
    );
    this.budgetLedger.restore(snapshot.ledger);
    return snapshot.entries;
  }

  /** Host recovery inventory, including jobs whose page closed before completion. */
  async recoveredAccounting(): Promise<GenerationJournalEntry[]> {
    await this.ready;
    return this.refreshAccounting();
  }

  /** Cancel saved, undispatched work atomically; never releases pending provider charges. */
  async cancelRecoveredQueued(jobId: string): Promise<void> {
    await this.ready;
    if (!this.journal) {
      const job = this.jobs.get(jobId);
      if (!job || job.state !== "queued")
        throw new Error("No queued request is available for cancellation.");
      await this.cancel(jobId);
      return;
    }
    await this.journal.cancelQueued(jobId);
    await this.refreshAccounting();
    const job = this.jobs.get(jobId);
    if (job && job.billingState !== "settled") {
      this.abortControllers
        .get(jobId)
        ?.abort(
          new JobCancelledError("Queued request cancelled during recovery."),
        );
      this.cleanupJobHandles(jobId);
      this.reservations.delete(jobId);
      job.billingState = "settled";
      job.actualCostCents = 0;
      job._rejectResult(
        new JobCancelledError("Queued request cancelled during recovery."),
        "cancelled",
      );
    }
  }

  async setBudgetConsent(
    budgetId: string,
    consentGiven: boolean,
    approverId?: string,
  ): Promise<void> {
    await this.ready;
    if (this.journal) {
      await this.journal.setConsent(
        budgetId,
        consentGiven,
        approverId,
        this.budgetLedger.getBudget(budgetId),
      );
      await this.refreshAccounting();
    } else this.budgetLedger.setConsent(budgetId, consentGiven, approverId);
  }

  private async releaseUndispatched(
    job: GenerationJob,
    reservation: BudgetReservation,
  ): Promise<void> {
    if (this.journal) {
      if (job.billingState === "pending") await this.journal.settle(job.id, 0);
      else await this.journal.cancelQueued(job.id);
      await this.refreshAccounting();
    } else this.budgetLedger.release(reservation.reservationId, 0);
    this.reservations.delete(job.id);
    job.actualCostCents = 0;
    job.billingState = "settled";
  }

  private recoverSavedJob(
    entry: GenerationJournalEntry,
    request: GenerationRequest,
    options: GenerationJobOptions,
  ): Promise<GenerationJob> {
    const pending = this.recoveringJobs.get(entry.jobId);
    if (pending) return pending;
    const recovery = (async () => {
      const entries = await this.refreshAccounting();
      entry = entries.find((saved) => saved.jobId === entry.jobId) ?? entry;
      const existing = this.jobs.get(entry.jobId);
      if (
        existing &&
        (["queued", "running", "cancelling"].includes(existing.state) ||
          (existing.state === "succeeded" &&
            existing.candidate &&
            this.staging.getCandidate(existing.candidate.id)))
      ) {
        return existing;
      }
      let candidate: GenerationCandidate | undefined;
      if (entry.billingState === "settled" && this.candidateStorage) {
        candidate = (await this.restoreCandidates()).find(
          (item) => item.jobId === entry.jobId,
        );
      }
      const record = candidate ? this.records.get(entry.jobId) : undefined;
      if (
        record &&
        (record.actualCostCents !== entry.actualCostCents ||
          record.providerId !== entry.providerId)
      ) {
        throw new Error(
          "Recovered candidate provenance does not match saved accounting.",
        );
      }
      if (this.disposed) throw new Error("Generation service is disposed.");
      const recovered = new GenerationJob(
        entry.jobId,
        request,
        {
          ...options,
          baseRevision: record?.baseRevision ?? options.baseRevision,
          sourceDocumentId:
            record?.sourceDocumentId ?? options.sourceDocumentId,
        },
        entry.estimatedCostCents,
        record?.createdAt ?? entry.createdAt,
      );
      recovered.billingState = entry.billingState;
      recovered.actualCostCents = entry.actualCostCents;
      this.jobs.set(entry.jobId, recovered);
      const reservation = this.budgetLedger
        .listReservations()
        .find((item) => item.jobId === entry.jobId);
      if (reservation) this.reservations.set(entry.jobId, reservation);
      if (candidate && record) recovered._resolveResult(candidate, record);
      else
        recovered._rejectResult(
          new Error(
            `This request was already submitted (${entry.billingState} accounting). It was not dispatched again. No saved result is available; review recovered accounting before retrying with a new key.`,
          ),
        );
      return recovered;
    })().finally(() => {
      this.recoveringJobs.delete(entry.jobId);
    });
    this.recoveringJobs.set(entry.jobId, recovery);
    return recovery;
  }

  /**
   * Submits a new generation request.
   * Handles idempotency deduplication, budget reservation, timeout setup,
   * and asynchronous provider execution.
   */
  async submit(
    request: GenerationRequest,
    options: GenerationJobOptions,
  ): Promise<GenerationJob> {
    request = structuredClone(request);
    options = structuredClone(options);
    await this.ready;
    if (this.disposed) throw new Error("Generation service is disposed.");
    validateGenerationRequest(request);

    // Recover durable matches before requiring a provider or fresh approval.
    const providerId = options.providerId || "flux-1-pro";
    const fingerprint =
      this.journal || options.idempotencyKey?.trim()
        ? await generationFingerprint(request)
        : undefined;
    if (this.journal && options.idempotencyKey?.trim()) {
      const saved = await this.journal.findRequest(
        options.idempotencyKey,
        fingerprint!,
        providerId,
        options.budgetId,
      );
      if (saved) return this.recoverSavedJob(saved, request, options);
    }

    // 2. Idempotency deduplication
    if (
      !this.journal &&
      options.idempotencyKey &&
      options.idempotencyKey.trim() !== ""
    ) {
      const existing = this.idempotencyMap.get(options.idempotencyKey.trim());
      if (existing) {
        if (
          this.idempotencyFingerprints.get(options.idempotencyKey.trim()) !==
            fingerprint ||
          (existing.options.providerId || "flux-1-pro") !== providerId ||
          existing.options.budgetId !== options.budgetId
        ) {
          throw new Error(
            "Idempotency key already belongs to a different generation request.",
          );
        }
        return existing;
      }
    }

    // 3. Provider resolution and validation
    const provider = this.providerRegistry.getProvider(providerId);

    if (!provider.modalities.includes(request.modality)) {
      throw new Error(
        `Provider "${provider.name}" does not support modality "${request.modality}". Supported: ${provider.modalities.join(", ")}`,
      );
    }

    validateProviderRequest(request, provider);

    // 4. Estimate cost
    const estimatedCostCents = this.providerRegistry.estimateGenerationCost(
      providerId,
      request,
    );

    // Reserve in durable storage before creating any dispatch timer.
    const jobId = id();
    let reservation: BudgetReservation;
    if (this.journal) {
      const budget = this.budgetLedger.requireConsent(options.budgetId);
      let entry = await this.journal.reserve({
        jobId,
        budgetId: options.budgetId,
        providerId,
        requestFingerprint: fingerprint!,
        idempotencyKey: options.idempotencyKey,
        estimatedCostCents,
        initialBudget: budget,
      });
      const entries = await this.refreshAccounting();
      entry = entries.find((saved) => saved.jobId === entry.jobId) ?? entry;
      if (entry.jobId !== jobId)
        return this.recoverSavedJob(entry, request, options);
      reservation = this.budgetLedger
        .listReservations()
        .find((item) => item.jobId === jobId)!;
      if (!reservation)
        throw new Error("Durable generation reservation is missing.");
    } else
      reservation = this.budgetLedger.reserve(
        options.budgetId,
        jobId,
        estimatedCostCents,
      );
    this.reservations.set(jobId, reservation);
    const job = new GenerationJob(jobId, request, options, estimatedCostCents);
    this.jobs.set(jobId, job);
    if (!this.journal && options.idempotencyKey?.trim()) {
      this.idempotencyMap.set(options.idempotencyKey.trim(), job);
      this.idempotencyFingerprints.set(
        options.idempotencyKey.trim(),
        fingerprint!,
      );
    }
    if (this.disposed) {
      await this.releaseUndispatched(job, reservation);
      throw new Error(
        "Generation service was disposed while reserving its budget.",
      );
    }

    // 7. Setup AbortController and Timeout
    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    const timeoutMs = options.timeoutMs ?? 60000;
    const timer = setTimeout(() => {
      this.handleTimeout(jobId, timeoutMs);
    }, timeoutMs);
    this.timeoutTimers.set(jobId, timer);

    // 8. Dispatch execution asynchronously outside synchronous callers
    setTimeout(() => {
      this.executeJob(job, providerId, reservation, abortController.signal);
    }, 0);

    return job;
  }

  /**
   * Cancels a running or queued job.
   * Protects against race conditions if job has already succeeded.
   */
  async cancel(
    jobId: string,
    reason = "User requested cancellation",
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Terminal state protection: cannot cancel a succeeded or already failed job
    if (
      job.state === "succeeded" ||
      job.state === "failed" ||
      job.state === "cancelled" ||
      job.state === "expired"
    ) {
      return false;
    }

    // Clear timeout timer
    const timer = this.timeoutTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(jobId);
    }

    // Claim cancellation synchronously before yielding to durable storage.
    if (job.state === "queued") {
      job._setState("cancelling");
      this.abortControllers.get(jobId)?.abort(new JobCancelledError(reason));
      this.cleanupJobHandles(jobId);
      const reservation = this.reservations.get(jobId);
      try {
        if (reservation) await this.releaseUndispatched(job, reservation);
        job._rejectResult(new JobCancelledError(reason), "cancelled");
      } catch (error) {
        job._rejectResult(
          new Error(
            `Cancellation accounting could not be saved: ${String(error)}`,
          ),
          "cancelled",
        );
      }
      return true;
    }

    // If running, signal abort controller and transition to cancelling
    job._setState("cancelling");
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort(new JobCancelledError(reason));
    }

    return true;
  }

  /**
   * Internal job runner dispatching to the provider adapter.
   */
  private async executeJob(
    job: GenerationJob,
    providerId: string,
    reservation: BudgetReservation,
    signal: AbortSignal,
  ): Promise<void> {
    // The dispatch timer can run after queued cancellation or disposal.
    if (job.state !== "queued") return;
    const request = job.request;
    const options = job.options;
    const startTime = performance.now();
    let dispatched = false;
    let savingCandidateId: string | undefined;

    try {
      if (signal.aborted) {
        throw new JobCancelledError("Job cancelled before start.");
      }

      job._setState("running");
      job._setProgress({
        phase: "dispatching",
        percent: 0.1,
        message: "Connecting to provider...",
      });

      // Resolve an explicitly configured adapter.
      const adapter = this.resolveAdapter(providerId);

      job._setProgress({
        phase: "generating",
        percent: 0.4,
        message: "Generating candidate asset...",
      });

      // Subscribers can revoke consent or cancel during progress notifications.
      // Recheck after those callbacks, immediately before the external call.
      if (signal.aborted)
        throw (
          signal.reason ??
          new JobCancelledError("Job cancelled before dispatch.")
        );
      const budget = this.budgetLedger.requireConsent(options.budgetId);

      // Persist dispatch intent before crossing the provider boundary.
      if (this.journal) await this.journal.beginDispatch(job.id);
      job.billingState = "pending";
      if (signal.aborted)
        throw (
          signal.reason ??
          new JobCancelledError("Job cancelled before dispatch.")
        );
      this.budgetLedger.requireConsent(options.budgetId);
      dispatched = true;
      const providerWork = Promise.resolve(
        adapter.generate(structuredClone(request), budget, signal),
      ).then(async (result) => {
        await this.reconcileBilling(job.id, result.costCents);
        return result;
      });
      const result = await abortable(providerWork, signal);

      if (signal.aborted) {
        throw new JobCancelledError("Job cancelled during generation.");
      }

      job._setProgress({
        phase: "validating",
        percent: 0.8,
        message: "Validating candidate output...",
      });

      // Stage the generated candidate
      const staged = this.staging
        .stageCandidate(job.id, { ...result, id: id() }, request)
        .then((candidate) => {
          if (signal.aborted) {
            this.staging.discard(candidate.id);
            throw (
              signal.reason ??
              new JobCancelledError("Job cancelled during validation.")
            );
          }
          return candidate;
        });
      const candidate = await abortable(staged, signal);

      if (!candidate.validation.valid) {
        this.staging.discard(candidate.id);
        throw new Error(
          `Candidate validation failed: ${candidate.validation.errors.join("; ")}`,
        );
      }

      const durationMs = Math.round(performance.now() - startTime);

      // Create permanent GenerationRecord (provenance, strictly NO secrets or API keys)
      const taskKind: TaskKind = options.taskKind || "asset";
      const record: GenerationRecord = {
        id: id(),
        jobId: job.id,
        providerId,
        providerName: adapter.capabilities.name,
        modelVersion: adapter.capabilities.version,
        taskKind,
        prompt: request.prompt,
        revisedPrompt: result.revisedPrompt,
        targetWidth: request.targetWidth,
        targetHeight: request.targetHeight,
        hasAlpha: candidate.hasAlpha,
        estimatedCostCents: job.estimatedCostCents,
        actualCostCents: result.costCents,
        currency: adapter.capabilities.pricing.currency,
        baseRevision: job.baseRevision,
        sourceDocumentId: options.sourceDocumentId,
        createdAt: job.createdAt,
        completedAt: new Date().toISOString(),
        durationMs,
        status: "succeeded",
        provenanceVersion: 1,
      };

      this.records.set(job.id, record);
      if (this.candidateStorage) {
        savingCandidateId = candidate.id;
        try {
          await this.candidateStorage.save(
            candidate,
            record,
            this.staging.getProtectionContext(candidate.id),
            signal,
          );
        } catch (error) {
          if (signal.aborted) throw error;
          throw new Error(
            `The generated image is available only in this session because recovery storage failed: ${String(error)}`,
          );
        }
        if (signal.aborted || this.disposed) {
          await this.candidateStorage.remove(candidate.id);
          this.staging.discard(candidate.id);
          throw (
            signal.reason ??
            new JobCancelledError(
              "Generation service disposed while saving candidate.",
            )
          );
        }
      }

      // Clean up timer and controllers
      this.cleanupJobHandles(job.id);

      // Complete job
      job._resolveResult(candidate, record);
    } catch (err: unknown) {
      let error = err instanceof Error ? err : new Error(String(err));
      if (savingCandidateId && (signal.aborted || this.disposed)) {
        this.staging.discard(savingCandidateId);
        try {
          await this.candidateStorage?.remove(savingCandidateId);
        } catch (cleanupError) {
          error = new Error(
            `${error.message}; saved candidate cleanup failed: ${String(cleanupError)}`,
          );
        }
      }
      const durationMs = Math.round(performance.now() - startTime);
      job._setProgress({ elapsedMs: durationMs });

      // Clean up timer and controllers
      this.cleanupJobHandles(job.id);

      const isTimeout =
        error instanceof JobTimeoutError ||
        signal.reason instanceof JobTimeoutError ||
        (signal.aborted &&
          (signal.reason as Error)?.name === "JobTimeoutError");

      if (!dispatched) {
        try {
          await this.releaseUndispatched(job, reservation);
        } catch (accountingError) {
          error = new Error(
            `${error.message}; accounting recovery required: ${String(accountingError)}`,
          );
        }
      }
      if (isTimeout) {
        job._rejectResult(
          error instanceof JobTimeoutError
            ? error
            : new JobTimeoutError(error.message),
          "failed",
        );
      } else if (
        signal.aborted ||
        error instanceof JobCancelledError ||
        error.name === "AbortError"
      ) {
        job._rejectResult(
          new JobCancelledError("Generation job was cancelled."),
          "cancelled",
        );
      } else {
        job._rejectResult(error, "failed");
      }
    }
  }

  /** Host-only settlement using a provider-confirmed final charge, including zero. */
  async reconcileBilling(
    jobId: string,
    actualCostCents: number,
  ): Promise<void> {
    if (!Number.isFinite(actualCostCents) || actualCostCents < 0)
      throw new Error("Actual cost must be non-negative and finite.");
    const job = this.jobs.get(jobId);
    if (this.journal) {
      // The journal, not a possibly stale tab's job object, owns billing state.
      await this.ready;
      await this.journal.settle(jobId, actualCostCents);
      await this.refreshAccounting();
    } else {
      if (!job) throw new Error("Unknown job for billing reconciliation.");
      if (job.billingState === "settled") {
        if (job.actualCostCents !== actualCostCents)
          throw new Error("Conflicting final charge for settled job.");
        return;
      }
      if (job.billingState !== "pending")
        throw new Error("Job has not been dispatched.");
      const reservation = this.reservations.get(jobId);
      if (!reservation) throw new Error("Missing billing reservation.");
      this.budgetLedger.commit(reservation.reservationId, actualCostCents);
    }
    this.reservations.delete(jobId);
    if (job) {
      job.actualCostCents = actualCostCents;
      job.billingState = "settled";
      job._setProgress({});
    }
  }

  private handleTimeout(jobId: string, timeoutMs: number): void {
    const job = this.jobs.get(jobId);
    if (
      !job ||
      job.state === "succeeded" ||
      job.state === "failed" ||
      job.state === "cancelled"
    ) {
      return;
    }

    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort(
        new JobTimeoutError(
          `Job exceeded execution deadline of ${timeoutMs}ms`,
        ),
      );
    }
  }

  private cleanupJobHandles(jobId: string): void {
    const timer = this.timeoutTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(jobId);
    }
    this.abortControllers.delete(jobId);
  }

  private resolveAdapter(providerId: string): AiProviderAdapter {
    return this.providerRegistry.getAdapter(providerId);
  }

  /**
   * Applies an accepted candidate to a document within an atomic transaction.
   * Enforces revision concurrency checking to protect against stale commits.
   */
  async previewCandidate(
    candidateId: string,
    options: ApplyCandidateOptions & {
      document: Document;
      assetStore: AssetStore;
    },
  ): Promise<void> {
    await previewCandidatePlacement({
      candidateId,
      document: options.document,
      assetStore: options.assetStore,
      staging: this.staging,
      records: this.records,
      options,
    });
  }

  async applyCandidate(
    candidateId: string,
    options: ApplyCandidateOptions & {
      document: Document;
      assetStore: AssetStore;
    },
  ): Promise<RasterLayer> {
    return applyCandidateToDocument({
      candidateId,
      document: options.document,
      assetStore: options.assetStore,
      staging: this.staging,
      records: this.records,
      options,
    });
  }

  /**
   * Applies an accepted masked-edit candidate to a document, verifying the protected
   * invariant and optionally attaching a LayerMask for non-destructive containment.
   */
  async applyMaskedEdit(
    candidateId: string,
    options: ApplyMaskedEditOptions & {
      document: Document;
      assetStore: AssetStore;
    },
  ): Promise<RasterLayer> {
    return applyMaskedEditToDocument({
      candidateId,
      document: options.document,
      assetStore: options.assetStore,
      staging: this.staging,
      records: this.records,
      options,
    });
  }

  getJob(jobId: string): GenerationJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(): GenerationJob[] {
    return Array.from(this.jobs.values());
  }

  getRecord(recordId: string): GenerationRecord | undefined {
    return this.records.get(recordId);
  }

  listRecords(): GenerationRecord[] {
    return Array.from(this.records.values());
  }

  async discardCandidate(candidateId: string): Promise<void> {
    if (this.candidateStorage) await this.candidateStorage.remove(candidateId);
    this.discardedCandidateIds.add(candidateId);
    this.staging.discard(candidateId);
  }

  /**
   * Clears historical completed, failed, or cancelled jobs beyond maxRetained to prevent memory growth.
   */
  clearCompletedJobs(maxRetained: number = 50): void {
    const terminalStates = new Set([
      "succeeded",
      "failed",
      "cancelled",
      "expired",
    ]);
    const terminalJobs = Array.from(this.jobs.entries()).filter(
      ([_, job]) =>
        terminalStates.has(job.state) &&
        job.billingState === "settled" &&
        (this.journal || !job.options.idempotencyKey?.trim()),
    );
    if (terminalJobs.length > maxRetained) {
      const toRemove = terminalJobs.slice(0, terminalJobs.length - maxRetained);
      for (const [id, job] of toRemove) {
        this.jobs.delete(id);
        if (job.candidate && job.candidate.reviewState !== "accepted") {
          this.staging.discard(job.candidate.id);
        }
      }
    }
  }

  /**
   * Cleans up all pending timers, aborts active requests, and disposes staging storage.
   */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();
    for (const controller of this.abortControllers.values()) {
      controller.abort(new JobCancelledError("GenerationJobService disposed."));
    }
    this.abortControllers.clear();
    this.staging.dispose();
  }
}
