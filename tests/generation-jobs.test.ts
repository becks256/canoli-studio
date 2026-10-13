/**
 * Unit & Integration Test Suite for Ticket T11:
 * Asynchronous Generation Job Service, Budget/Consent Controls, and Staging Lifecycle.
 *
 * Verifies:
 * - Budget ceiling reservation, explicit consent enforcement, and cancellation reconciliation.
 * - Staging repository lifecycle, candidate validation, promotion, and abandoned cleanup.
 * - Asynchronous job state machine (draft -> queued -> running -> succeeded/failed/cancelled).
 * - Idempotency key deduplication and double-billing protection.
 * - Cancellation tokens, AbortSignal propagation, and race condition immunity.
 * - Timeout handling and automatic deadline aborts.
 * - Document revision concurrency checking (stale results cannot auto-commit).
 * - Atomic transaction application, layer provenance metadata, and undo decoupling.
 * - Strict credential isolation (zero keys or secrets stored in records or metadata).
 */

import { describe, expect, it, vi } from "vitest";
import { Document, LayerGroup, RasterLayer } from "../src/dom";
import { AssetStore } from "../src/core/assets";
import { EditorApplication } from "../src/editor";
import { ProviderRegistry } from "../src/ai/providers/registry";

// Ensure Node test environment has Worker stub for EditorApplication's PixelProcessor
if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}
import type {
  AiProviderAdapter,
  GenerationCandidateResult,
  GenerationRequest,
  HumanApprovedBudget,
} from "../src/ai/providers/types";
import {
  BudgetExceededError,
  BudgetLedger,
  ConsentRequiredError,
  GenerationJobService,
  JobCancelledError,
  JobTimeoutError,
  RevisionConflictError,
  StagedAssetRepository,
} from "../src/ai/jobs";

function createMockAdapter(
  overrides?: Partial<AiProviderAdapter>,
): AiProviderAdapter {
  const capabilities = {
    id: "test-flux",
    name: "FLUX.1 Pro Test",
    version: "1.0.0",
    description: "Test adapter double",
    modalities: ["text-to-image" as const, "image-to-image" as const],
    dimensions: {
      minWidth: 1,
      maxWidth: 2048,
      minHeight: 1,
      maxHeight: 2048,
      maxMegapixels: 4.0,
      supportedAspectRatios: ["1:1", "16:9", "9:16"],
    },
    alpha: "native-rgba" as const,
    pricing: {
      currency: "USD",
      costPerStandardImageCents: 4.0,
      secondaryMattingCostCents: 0,
      chargeOnCancellation: false,
    },
    terms: {
      providerId: "bfl",
      providerName: "Black Forest Labs",
      termsUrl: "https://example.com/terms",
      auditDate: "2026-09-27",
      retentionPolicy: "zero-retention-ephemeral" as const,
      customerDataUsedForTraining: false,
      optOutAvailable: true,
      optOutByDefault: true,
      ipIndemnification: false,
      commercialUsePermitted: true,
      contentModeration: {
        enforced: true,
        filtersPrompts: true,
        filtersOutputs: false,
        estimatedFalsePositiveRate: 0.012,
      },
      geographicRouting: "us" as const,
    },
    latency: {
      p50Ms: 25,
      p90Ms: 50,
      p99Ms: 100,
    },
  };

  return {
    capabilities,
    generate: async (
      request: GenerationRequest,
      _budget: HumanApprovedBudget,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) throw new JobCancelledError("Aborted before start");

      // Check signal during execution
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 15);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new JobCancelledError("Aborted during generation"));
          });
        }
      });

      const width = request.targetWidth;
      const height = request.targetHeight;
      const buffer = new Uint8Array(width * height * 4);

      // Populate valid test pixel pattern with semi-transparency if alpha requested
      const hasAlpha = Boolean(request.requireAlpha);
      for (let i = 0; i < width * height; i++) {
        buffer[i * 4 + 0] = 200;
        buffer[i * 4 + 1] = 100;
        buffer[i * 4 + 2] = 50;
        buffer[i * 4 + 3] = hasAlpha ? (i % 2 === 0 ? 0 : 255) : 255;
      }

      return {
        id: `cand-${Math.random().toString(36).slice(2, 10)}`,
        providerId: "test-flux",
        width,
        height,
        hasAlpha,
        imageData: buffer,
        mimeType: "image/png",
        durationMs: 20,
        costCents: 4.0,
        revisedPrompt: request.prompt,
      };
    },
    ...overrides,
  };
}

it.each([true, false])(
  "records validated transparency (%s) despite a conflicting provider claim",
  async (transparent) => {
    const editor = new EditorApplication();
    try {
      const original = createMockAdapter();
      editor.ai.providerRegistry.registerAdapter(
        createMockAdapter({
          generate: async (...args) => ({
            ...(await original.generate(...args)),
            hasAlpha: !transparent,
          }),
        }),
      );
      editor.ai.budgetLedger.createBudget({
        budgetId: "alpha-review",
        approverId: "artist",
        approvedCeilingCents: 100,
        consentGiven: true,
      });
      const job = await editor.ai.submit(
        {
          prompt: "artwork",
          modality: "text-to-image",
          targetWidth: 256,
          targetHeight: 256,
          requireAlpha: transparent,
        },
        { providerId: "test-flux", budgetId: "alpha-review", baseRevision: 0 },
      );
      const candidate = await job.result();
      expect(candidate.hasAlpha).toBe(transparent);
      expect(editor.ai.getRecord(job.id)?.hasAlpha).toBe(transparent);
    } finally {
      editor.dispose();
    }
  },
);

describe("T11: Budget Reservation Ledger & Consent Controls", () => {
  it("enforces explicit human consent and authorized approver ID", () => {
    const ledger = new BudgetLedger();

    // 1. Missing approverId
    expect(() =>
      ledger.createBudget({
        approverId: "",
        approvedCeilingCents: 100,
      }),
    ).toThrow(ConsentRequiredError);

    // 2. Non-positive ceiling
    expect(() =>
      ledger.createBudget({
        approverId: "user-123",
        approvedCeilingCents: 0,
      }),
    ).toThrow(BudgetExceededError);

    // 3. Valid creation with consent = false
    const budget = ledger.createBudget({
      budgetId: "b-1",
      approverId: "user-123",
      approvedCeilingCents: 50,
      consentGiven: false,
    });

    expect(budget.spentSoFarCents).toBe(0);
    expect(ledger.getAvailableCeiling("b-1")).toBe(50);

    // Attempting reservation without consent throws
    expect(() => ledger.reserve("b-1", "job-1", 4.0)).toThrow(
      ConsentRequiredError,
    );

    // Granting consent allows reservation
    ledger.setConsent("b-1", true);
    const reservation = ledger.reserve("b-1", "job-1", 4.0);
    expect(reservation.amountCents).toBe(4.0);
    expect(ledger.getTotalReserved("b-1")).toBe(4.0);
    expect(ledger.getAvailableCeiling("b-1")).toBe(46.0);
  });

  it("enforces ceiling limits, reservation commitments, and cancellation charges", () => {
    const ledger = new BudgetLedger();
    ledger.createBudget({
      budgetId: "b-limit",
      approverId: "lead-designer",
      approvedCeilingCents: 10.0,
      consentGiven: true,
    });

    // Reserve 8.0 cents (2.0 remaining)
    const res1 = ledger.reserve("b-limit", "job-1", 8.0);
    expect(ledger.getAvailableCeiling("b-limit")).toBe(2.0);

    // Attempting to reserve 3.0 cents exceeds remaining ceiling
    expect(() => ledger.reserve("b-limit", "job-2", 3.0)).toThrow(
      BudgetExceededError,
    );

    // Committing res1 with actual 7.5 cents spend
    ledger.commit(res1.reservationId, 7.5);
    const b = ledger.getBudget("b-limit")!;
    expect(b.spentSoFarCents).toBe(7.5);
    expect(ledger.getTotalReserved("b-limit")).toBe(0);
    expect(ledger.getAvailableCeiling("b-limit")).toBe(2.5);

    // Reserve second job for 2.0 cents
    const res2 = ledger.reserve("b-limit", "job-2", 2.0);
    expect(ledger.getAvailableCeiling("b-limit")).toBe(0.5);

    // Cancelling with 1.0 cent cancellation fee
    ledger.release(res2.reservationId, 1.0);
    expect(ledger.getBudget("b-limit")!.spentSoFarCents).toBe(8.5);
    expect(b.spentSoFarCents).toBe(7.5); // Previously returned snapshots remain unchanged.
    expect(ledger.getTotalReserved("b-limit")).toBe(0);
    expect(ledger.getAvailableCeiling("b-limit")).toBe(1.5);
  });
});

describe("T11: Staged Asset Repository Lifecycle", () => {
  it("stages candidates outside document history and validates output bounds", async () => {
    const staging = new StagedAssetRepository();

    const request: GenerationRequest = {
      prompt: "Transparent leaf cutout",
      modality: "text-to-image",
      targetWidth: 512,
      targetHeight: 512,
      requireAlpha: true,
    };

    const pixelData = new Uint8Array(512 * 512 * 4);
    // Fill transparent pixels
    for (let i = 0; i < 512 * 512; i++) {
      pixelData[i * 4 + 3] = i % 2 === 0 ? 0 : 255;
    }

    const candidateResult: GenerationCandidateResult = {
      id: "cand-leaf",
      providerId: "test-flux",
      width: 512,
      height: 512,
      hasAlpha: true,
      imageData: pixelData,
      mimeType: "image/png",
      durationMs: 120,
      costCents: 4.0,
      revisedPrompt: "A transparent green leaf cutout, photorealistic",
    };

    const candidate = await staging.stageCandidate(
      "job-42",
      candidateResult,
      request,
    );
    expect(candidate.id).toBe("cand-leaf");
    expect(candidate.reviewState).toBe("staged");
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.validation.hasAlpha).toBe(true);

    // Asset lives in staging and is retrievable
    expect(staging.getCandidate("cand-leaf")).toBe(candidate);
    expect(staging.listCandidates("job-42")).toHaveLength(1);

    // Promotes atomically to permanent store
    const assetStore = new AssetStore();
    const promoted = await staging.promote(
      "cand-leaf",
      assetStore,
      "Final Leaf",
    );
    expect(promoted.id).not.toBe(candidate.asset.id);
    expect(promoted.name).toBe("Final Leaf");
    expect(assetStore.get(promoted.id)).toBe(promoted);
    expect(candidate.reviewState).toBe("accepted");

    // Discarding cleans up memory
    staging.discard("cand-leaf");
    expect(staging.getCandidate("cand-leaf")).toBeUndefined();
  });

  it("detects validation failures for invalid payloads and cleans up abandoned candidates", async () => {
    const staging = new StagedAssetRepository();
    const request: GenerationRequest = {
      prompt: "Texture",
      modality: "text-to-image",
      targetWidth: 512,
      targetHeight: 512,
      requireAlpha: true,
    };

    // Candidate fails alpha requirement (completely opaque)
    const opaqueData = new Uint8Array(512 * 512 * 4);
    opaqueData.fill(255);

    const badResult: GenerationCandidateResult = {
      id: "bad-cand",
      providerId: "test-flux",
      width: 512,
      height: 512,
      hasAlpha: false,
      imageData: opaqueData,
      mimeType: "image/png",
      durationMs: 10,
      costCents: 4.0,
    };

    const staged = await staging.stageCandidate("job-bad", badResult, request);
    expect(staged.validation.valid).toBe(false);
    expect(
      staged.validation.errors.some((e) => e.includes("alpha transparency")),
    ).toBe(true);

    // Test collectAbandoned cleans up unaccepted candidates
    staged.createdAt = new Date(Date.now() - 5000).toISOString();
    const collectedCount = staging.collectAbandoned(1000);
    expect(collectedCount).toBe(1);
    expect(staging.getCandidate("bad-cand")).toBeUndefined();
  });

  it("strictly rejects 3-byte truncated payload claiming to be PNG and blocks promotion", async () => {
    const staging = new StagedAssetRepository();
    const probeResult: GenerationCandidateResult = {
      id: "probe-3byte",
      providerId: "test-flux",
      width: 16,
      height: 16,
      hasAlpha: true,
      imageData: new Uint8Array([1, 2, 3]), // 3-byte payload
      mimeType: "image/png",
      durationMs: 5,
      costCents: 1.0,
    };

    const request: GenerationRequest = {
      prompt: "Malicious 3-byte probe",
      modality: "text-to-image",
      targetWidth: 16,
      targetHeight: 16,
      requireAlpha: true,
    };

    const staged = await staging.stageCandidate(
      "job-probe",
      probeResult,
      request,
    );
    expect(staged.validation.valid).toBe(false);
    expect(
      staged.validation.errors.some(
        (e) => e.includes("PNG signature") || e.includes("truncated"),
      ),
    ).toBe(true);

    // Promoting an invalid candidate must throw
    const mockStore = new AssetStore();
    await expect(staging.promote(staged.id, mockStore)).rejects.toThrow(
      "Cannot promote invalid candidate",
    );
  });
});

describe("T11: Asynchronous Generation Job Service & State Machine", () => {
  function setupService() {
    const providerRegistry = new ProviderRegistry();
    const adapter = createMockAdapter();
    providerRegistry.registerAdapter(adapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-main",
      approverId: "art-director",
      approvedCeilingCents: 100.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    return { service, adapter, budgetLedger, staging };
  }

  it("keeps approved request, pixel input and job options detached from caller mutations", async () => {
    const { service, adapter, budgetLedger } = setupService();
    adapter.capabilities.pricing.costPerHdImageCents = 200;
    const generate = vi.spyOn(adapter, "generate");
    const request: GenerationRequest = {
      prompt: "Approved",
      modality: "image-to-image",
      targetWidth: 2,
      targetHeight: 2,
      qualityTier: "standard",
      referenceImage: {
        width: 2,
        height: 2,
        data: new Uint8Array(16).fill(42),
        mimeType: "image/png",
      },
    };
    const job = await service.submit(request, {
      providerId: "test-flux",
      budgetId: "b-main",
      baseRevision: 7,
      sourceDocumentId: "approved-document",
      idempotencyKey: "immutable-request",
    });
    job.request.qualityTier = "hd";
    job.request.prompt = "Not approved";
    job.request.referenceImage!.data.fill(0);
    job.options.budgetId = "missing-budget";
    job.options.sourceDocumentId = "other-document";
    job.subscribe((current) => {
      current.request.prompt = "Subscriber mutation";
    });
    try {
      await job.result();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][0]).toEqual(request);
      expect(job.record).toMatchObject({
        prompt: "Approved",
        sourceDocumentId: "approved-document",
        baseRevision: 7,
      });
      expect(job.estimatedCostCents).toBe(4);
      expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4);
      expect(
        await service.submit(request, {
          providerId: "test-flux",
          budgetId: "b-main",
          baseRevision: 7,
          idempotencyKey: "immutable-request",
        }),
      ).toBe(job);
    } finally {
      service.dispose();
    }
  });

  it("rejects wrong-sized provider output while retaining the reported charge", async () => {
    const { service, adapter, budgetLedger, staging } = setupService();
    vi.spyOn(adapter, "generate").mockResolvedValue({
      id: "wrong-size",
      providerId: "test-flux",
      width: 1,
      height: 1,
      hasAlpha: false,
      imageData: new Uint8Array([255, 0, 0, 255]),
      mimeType: "image/png",
      durationMs: 1,
      costCents: 4,
    });
    const job = await service.submit(
      {
        prompt: "Full resolution",
        modality: "text-to-image",
        targetWidth: 1024,
        targetHeight: 1024,
      },
      { providerId: "test-flux", budgetId: "b-main", baseRevision: 0 },
    );
    try {
      await expect(job.result()).rejects.toThrow(
        "do not match requested dimensions",
      );
      expect(job.state).toBe("failed");
      expect(staging.listCandidates()).toHaveLength(0);
      expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4);
    } finally {
      service.dispose();
    }
  });

  it.each([
    { targetWidth: NaN },
    { targetHeight: Infinity },
    { targetWidth: 1.5 },
    { targetWidth: Number.MAX_SAFE_INTEGER },
    { mask: { width: 16, height: 16, coverage: new Uint8Array(1) } },
    {
      referenceImage: {
        width: 16,
        height: 16,
        data: new Uint8Array(4),
        mimeType: "image/png",
      },
    },
    { featherRadius: -1 },
    { protectedRegions: [{ x: NaN, y: 0, width: 1, height: 1 }] },
  ])(
    "rejects malformed geometry before provider or accounting activity: %j",
    async (patch) => {
      const { service, adapter, budgetLedger } = setupService();
      const generate = vi.spyOn(adapter, "generate");
      const before = budgetLedger.snapshot();
      await expect(
        service.submit(
          {
            prompt: "Invalid input",
            modality: "text-to-image",
            targetWidth: 16,
            targetHeight: 16,
            ...patch,
          } as GenerationRequest,
          { providerId: "test-flux", budgetId: "b-main", baseRevision: 0 },
        ),
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
      expect(budgetLedger.snapshot()).toEqual(before);
      service.dispose();
    },
  );

  it.each(["queued revocation", "dispatch revocation", "expiry"])(
    "does not call the provider after %s",
    async (scenario) => {
      const { service, adapter, budgetLedger } = setupService();
      const generate = vi.spyOn(adapter, "generate");
      const job = await service.submit(
        {
          prompt: "approval",
          modality: "text-to-image",
          targetWidth: 16,
          targetHeight: 16,
        },
        { providerId: "test-flux", budgetId: "b-main", baseRevision: 0 },
      );
      if (scenario === "queued revocation")
        budgetLedger.setConsent("b-main", false);
      else
        job.subscribe((current) => {
          if (current.progress.phase !== "generating") return;
          if (scenario === "dispatch revocation")
            budgetLedger.setConsent("b-main", false);
          else {
            const snapshot = budgetLedger.snapshot();
            snapshot.budgets.find(
              (entry) => entry.budgetId === "b-main",
            )!.budget.expiresAt = new Date(Date.now() - 1).toISOString();
            budgetLedger.restore(snapshot);
          }
        });
      try {
        await expect(job.result()).rejects.toThrow(ConsentRequiredError);
        expect(generate).not.toHaveBeenCalled();
        expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
        expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(0);
      } finally {
        service.dispose();
      }
    },
  );

  it("rejects invalid approval expiry before reserving or dispatching", async () => {
    const { service, adapter, budgetLedger } = setupService();
    const generate = vi.spyOn(adapter, "generate");
    budgetLedger.createBudget({
      budgetId: "invalid-expiry",
      approverId: "owner",
      approvedCeilingCents: 100,
      expiresAt: "invalid-date",
    });
    try {
      await expect(
        service.submit(
          {
            prompt: "approval",
            modality: "text-to-image",
            targetWidth: 16,
            targetHeight: 16,
          },
          {
            providerId: "test-flux",
            budgetId: "invalid-expiry",
            baseRevision: 0,
          },
        ),
      ).rejects.toThrow(ConsentRequiredError);
      expect(generate).not.toHaveBeenCalled();
      expect(budgetLedger.getTotalReserved("invalid-expiry")).toBe(0);
    } finally {
      service.dispose();
    }
  });

  it.each(["invalid pixels", "decoder failure", "validation cancellation"])(
    "retains the reported charge after %s",
    async (scenario) => {
      const { service, adapter, budgetLedger, staging } = setupService();
      adapter.generate = async () => ({
        id: "charged-output",
        providerId: "test-flux",
        width: 1,
        height: 1,
        hasAlpha: false,
        imageData: new Uint8Array(),
        mimeType: "image/png",
        durationMs: 1,
        costCents: 4,
      });
      if (scenario === "decoder failure")
        vi.spyOn(staging, "stageCandidate").mockRejectedValue(
          new Error("Decode failed"),
        );
      const job = await service.submit(
        {
          prompt: "charged",
          modality: "text-to-image",
          targetWidth: 1,
          targetHeight: 1,
        },
        { providerId: "test-flux", budgetId: "b-main", baseRevision: 0 },
      );
      if (scenario === "validation cancellation")
        job.subscribe((current) => {
          if (
            current.state === "running" &&
            current.progress.phase === "validating"
          )
            void service.cancel(job.id);
        });
      try {
        await expect(job.result()).rejects.toThrow();
        expect(job.actualCostCents).toBe(4);
        expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4);
        expect(budgetLedger.getAvailableCeiling("b-main")).toBe(96);
        expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
        expect(staging.listCandidates()).toHaveLength(0);
      } finally {
        service.dispose();
      }
    },
  );

  it("never dispatches a job cancelled while queued", async () => {
    const { service, adapter, budgetLedger, staging } = setupService();
    const generate = vi.spyOn(adapter, "generate");
    const job = await service.submit(
      {
        prompt: "cancel",
        modality: "text-to-image",
        targetWidth: 16,
        targetHeight: 16,
      },
      { providerId: "test-flux", budgetId: "b-main", baseRevision: 0 },
    );
    const rejection = expect(job.result()).rejects.toThrow(JobCancelledError);
    await service.cancel(job.id);
    await rejection;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(generate).not.toHaveBeenCalled();
    expect(job.state).toBe("cancelled");
    expect(staging.listCandidates()).toHaveLength(0);
    expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
    service.dispose();
  });

  it("settles a deadline independently of adapter cooperation and ignores late results", async () => {
    const { service, adapter, budgetLedger, staging } = setupService();
    let finish!: (value: GenerationCandidateResult) => void;
    adapter.generate = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const job = await service.submit(
      {
        prompt: "deadline",
        modality: "text-to-image",
        targetWidth: 1,
        targetHeight: 1,
      },
      {
        providerId: "test-flux",
        budgetId: "b-main",
        baseRevision: 0,
        timeoutMs: 20,
      },
    );
    await expect(job.result()).rejects.toThrow(JobTimeoutError);
    expect(job.state).toBe("failed");
    expect(budgetLedger.getTotalReserved("b-main")).toBe(4);
    finish({
      id: "late",
      providerId: "test-flux",
      width: 1,
      height: 1,
      hasAlpha: false,
      imageData: new Uint8Array([255, 0, 0, 255]),
      mimeType: "image/png",
      durationMs: 25,
      costCents: 4,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staging.listCandidates()).toHaveLength(0);
    expect(job.state).toBe("failed");
    expect(job.billingState).toBe("settled");
    expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
    expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4);
    await service.reconcileBilling(job.id, 4);
    expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4);
    await expect(service.reconcileBilling(job.id, 5)).rejects.toThrow(
      "Conflicting",
    );
    service.dispose();
  });

  it("runs full asynchronous job lifecycle from queued to succeeded with provenance", async () => {
    const { service, budgetLedger } = setupService();

    const request: GenerationRequest = {
      prompt: "Cyberpunk neon sign",
      modality: "text-to-image",
      targetWidth: 512,
      targetHeight: 512,
    };

    const job = await service.submit(request, {
      budgetId: "b-main",
      baseRevision: 3,
      providerId: "test-flux",
      taskKind: "asset",
    });

    expect(job.state).toBe("queued");
    expect(budgetLedger.getTotalReserved("b-main")).toBe(4.0);

    // Await execution
    const candidate = await job.result();
    expect(job.state).toBe("succeeded");
    expect(candidate.validation.valid).toBe(true);
    expect(job.record).toBeDefined();

    // Verify record provenance and strict credential isolation
    const record = job.record!;
    expect(record.providerId).toBe("test-flux");
    expect(record.prompt).toBe("Cyberpunk neon sign");
    expect(record.baseRevision).toBe(3);
    expect(record.actualCostCents).toBe(4.0);
    expect(record.status).toBe("succeeded");

    // Zero secret guarantee
    const recordJson = JSON.stringify(record);
    expect(recordJson).not.toMatch(/api[_-]?key|secret|token|password|bearer/i);

    // Spend committed in budget ledger
    expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
    expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4.0);
  });

  it("handles idempotency key deduplication without duplicate billing or execution", async () => {
    const { service, budgetLedger } = setupService();

    const request: GenerationRequest = {
      prompt: "Golden chalice",
      modality: "text-to-image",
      targetWidth: 512,
      targetHeight: 512,
    };

    const job1 = await service.submit(request, {
      budgetId: "b-main",
      baseRevision: 1,
      idempotencyKey: "idemp-unique-123",
      providerId: "test-flux",
    });

    // Immediate duplicate submission returns the exact same job instance
    const job2 = await service.submit(request, {
      budgetId: "b-main",
      baseRevision: 1,
      idempotencyKey: "idemp-unique-123",
      providerId: "test-flux",
    });

    expect(job1).toBe(job2);
    expect(job1.id).toBe(job2.id);

    // Wait for completion
    const cand1 = await job1.result();
    const cand2 = await job2.result();
    expect(cand1).toBe(cand2);

    // Only billed once
    expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(4.0);
  });

  it("rejects headless key reuse for different inputs, providers or budgets", async () => {
    const { service } = setupService();
    const request: GenerationRequest = {
      prompt: "bound request",
      modality: "text-to-image",
      targetWidth: 16,
      targetHeight: 16,
    };
    const options = {
      providerId: "test-flux",
      budgetId: "b-main",
      baseRevision: 0,
      idempotencyKey: "bound-key",
    };
    const job = await service.submit(request, options);
    for (const [changedRequest, changedOptions] of [
      [{ ...request, prompt: "different" }, options],
      [{ ...request, targetWidth: 32 }, options],
      [request, { ...options, providerId: "another-provider" }],
      [request, { ...options, budgetId: "another-budget" }],
    ] as const) {
      await expect(
        service.submit(changedRequest, changedOptions),
      ).rejects.toThrow("different generation request");
    }
    await job.result();
    service.dispose();
  });

  it("does not repeat a paid failed request under the same headless idempotency key", async () => {
    const { service, adapter, budgetLedger } = setupService();
    const generate = vi.spyOn(adapter, "generate").mockResolvedValue({
      id: "invalid-paid",
      providerId: "test-flux",
      width: 16,
      height: 16,
      hasAlpha: false,
      imageData: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      costCents: 4,
      durationMs: 1,
    });
    const request: GenerationRequest = {
      prompt: "paid failure",
      modality: "text-to-image",
      targetWidth: 16,
      targetHeight: 16,
    };
    const options = {
      providerId: "test-flux",
      budgetId: "b-main",
      baseRevision: 0,
      idempotencyKey: "paid-key",
    };
    const job = await service.submit(request, options);
    await expect(job.result()).rejects.toThrow("validation failed");
    service.clearCompletedJobs(0);
    expect(service.getJob(job.id)).toBe(job);
    const repeat = await service.submit(request, options);
    expect(repeat).toBe(job);
    await expect(repeat.result()).rejects.toThrow("validation failed");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(budgetLedger.getBudget("b-main")?.spentSoFarCents).toBe(4);
    service.dispose();
  });

  it("handles user cancellation and AbortSignal propagation cleanly", async () => {
    const { service, budgetLedger } = setupService();

    const request: GenerationRequest = {
      prompt: "Slow render scene",
      modality: "text-to-image",
      targetWidth: 512,
      targetHeight: 512,
    };

    const job = await service.submit(request, {
      budgetId: "b-main",
      providerId: "test-flux",
      baseRevision: 1,
    });

    // Cancel while queued or running
    const cancelled = await service.cancel(job.id, "User changed mind");
    expect(cancelled).toBe(true);

    // Job promise rejects with JobCancelledError
    await expect(job.result()).rejects.toThrow(JobCancelledError);
    expect(job.state).toBe("cancelled");

    // Reservation was released and not charged (since chargeOnCancellation = false)
    expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
    expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(0);

    // Cannot cancel already cancelled job
    expect(await service.cancel(job.id)).toBe(false);
  });

  it("fails a profile-only provider instead of synthesizing an image", async () => {
    const { service, budgetLedger } = setupService();
    service.providerRegistry.registerProvider({
      ...createMockAdapter().capabilities,
      id: "unconfigured",
    });
    const job = await service.submit(
      {
        prompt: "No fake output",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      {
        budgetId: "b-main",
        baseRevision: 0,
        providerId: "unconfigured",
      },
    );
    await expect(job.result()).rejects.toThrow("unconfigured");
    expect(job.state).toBe("failed");
    expect(service.staging.listCandidates(job.id)).toHaveLength(0);
    expect(budgetLedger.getTotalReserved("b-main")).toBe(0);
    expect(budgetLedger.getBudget("b-main")!.spentSoFarCents).toBe(0);
  });

  it("protects against race condition: succeeded job cannot transition to cancelled", async () => {
    const { service } = setupService();

    const request: GenerationRequest = {
      prompt: "Instant completion",
      modality: "text-to-image",
      targetWidth: 256,
      targetHeight: 256,
    };

    const job = await service.submit(request, {
      budgetId: "b-main",
      providerId: "test-flux",
      baseRevision: 0,
    });

    // Wait for success
    await job.result();
    expect(job.state).toBe("succeeded");

    // Post-facto cancellation attempt must fail
    const cancelResult = await service.cancel(job.id);
    expect(cancelResult).toBe(false);
    expect(job.state).toBe("succeeded");
  });

  it("aborts and fails job if provider exceeds timeout deadline", async () => {
    const providerRegistry = new ProviderRegistry();
    // Adapter that stalls for 200ms
    const stallingAdapter = createMockAdapter({
      generate: async (_req, _b, signal) => {
        return new Promise<GenerationCandidateResult>((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("Should have timed out earlier"));
          }, 200);
          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(signal.reason || new JobTimeoutError());
            });
          }
        });
      },
    });
    providerRegistry.registerAdapter(stallingAdapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-timeout",
      approverId: "art-director",
      approvedCeilingCents: 50.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    const job = await service.submit(
      {
        prompt: "Stalled generation",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      {
        budgetId: "b-timeout",
        baseRevision: 0,
        providerId: "test-flux",
        timeoutMs: 30, // 30ms timeout
      },
    );

    await expect(job.result()).rejects.toThrow(JobTimeoutError);
    expect(job.state).toBe("failed");
    expect(budgetLedger.getTotalReserved("b-timeout")).toBe(4);
    expect(budgetLedger.getBudget("b-timeout")!.spentSoFarCents).toBe(0);
  });
});

describe("T11: Revision Concurrency & Atomic Candidate Application", () => {
  function setupEditorEnv() {
    const document = new Document({
      name: "Test Doc",
      width: 1000,
      height: 800,
    });
    const assetStore = new AssetStore();
    const providerRegistry = new ProviderRegistry();
    const adapter = createMockAdapter();
    providerRegistry.registerAdapter(adapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-editor",
      approverId: "lead-artist",
      approvedCeilingCents: 50.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    return { document, assetStore, service, budgetLedger, staging };
  }

  it("rejects edits made during promotion and preserves the candidate for retry", async () => {
    const { document, assetStore, service } = setupEditorEnv();
    const job = await service.submit(
      {
        prompt: "race",
        modality: "text-to-image",
        targetWidth: 16,
        targetHeight: 16,
      },
      { providerId: "test-flux", budgetId: "b-editor", baseRevision: 0 },
    );
    const candidate = await job.result();
    const bitmapClosed = vi.spyOn(candidate.asset.bitmap, "close");
    const applying = service.applyCandidate(candidate.id, {
      document,
      assetStore,
      expectedRevision: document.getSnapshot().revision,
    });
    document.name = "Intervening edit";
    await expect(applying).rejects.toThrow(RevisionConflictError);
    expect(document.toJSON().children).toHaveLength(0);
    expect(document.name).toBe("Intervening edit");
    expect(assetStore.has(candidate.id)).toBe(false);
    expect(candidate.reviewState).toBe("staged");
    expect(bitmapClosed).not.toHaveBeenCalled();
    await service.applyCandidate(candidate.id, {
      document,
      assetStore,
      expectedRevision: document.getSnapshot().revision,
    });
    expect(document.toJSON().children).toHaveLength(1);
    service.dispose();
    assetStore.dispose();
  });

  it("blocks auto-commit with RevisionConflictError when document changed in flight", async () => {
    const { document, assetStore, service } = setupEditorEnv();

    const baseRevision = document.getSnapshot().revision; // Revision 0

    const job = await service.submit(
      {
        prompt: "Futuristic spaceship",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
      },
      {
        budgetId: "b-editor",
        baseRevision,
        providerId: "test-flux",
      },
    );

    const candidate = await job.result();
    expect(job.state).toBe("succeeded");

    // Intervening user edit occurs while reviewing candidate!
    // Adding a blank layer advances document revision to 1
    const dummyLayer = new RasterLayer({
      assetId: "orig",
      width: 100,
      height: 100,
    });
    document.layers.add(dummyLayer);
    expect(document.getSnapshot().revision).toBeGreaterThan(baseRevision);

    // Stale result application with original baseRevision MUST be rejected!
    await expect(
      service.applyCandidate(candidate.id, {
        document,
        assetStore,
        expectedRevision: baseRevision,
      }),
    ).rejects.toThrow(RevisionConflictError);

    // Candidate remains safely preserved in staging shelf!
    expect(service.staging.getCandidate(candidate.id)).toBeDefined();
    expect(candidate.reviewState).toBe("staged");

    // User can explicitly confirm re-placement by providing current revision
    const currentRevision = document.getSnapshot().revision;
    const appliedLayer = await service.applyCandidate(candidate.id, {
      document,
      assetStore,
      expectedRevision: currentRevision,
      layerName: "Spaceship Layer",
    });

    expect(appliedLayer).toBeInstanceOf(RasterLayer);
    expect(appliedLayer.name).toBe("Spaceship Layer");
    expect(document.selectedLayer).toBe(appliedLayer);
    expect(candidate.reviewState).toBe("accepted");
  });

  it("commits candidate atomically in Document.transaction with provenance metadata", async () => {
    const { document, assetStore, service, budgetLedger } = setupEditorEnv();

    const job = await service.submit(
      {
        prompt: "Victorian street lamp",
        modality: "text-to-image",
        targetWidth: 400,
        targetHeight: 600,
        requireAlpha: true,
      },
      {
        budgetId: "b-editor",
        baseRevision: document.getSnapshot().revision,
        providerId: "test-flux",
        taskKind: "object",
      },
    );

    const candidate = await job.result();
    const initialRevision = document.getSnapshot().revision;

    const layer = await service.applyCandidate(candidate.id, {
      document,
      assetStore,
      expectedRevision: initialRevision,
    });

    // Single atomic transaction advanced revision by 1
    expect(document.getSnapshot().revision).toBe(initialRevision + 1);
    expect(document.layers.length).toBe(1);
    expect(document.layers.at(0)).toBe(layer);

    // Layer metadata contains provenance without secrets
    expect(layer.metadata).toBeDefined();
    expect(layer.metadata!.title).toBe("Victorian street lamp");
    expect(layer.metadata!.creator).toBe("Canoli Studio AI / FLUX.1 Pro Test");
    expect(layer.metadata!.keywords).toContain("ai-generated");
    expect(layer.metadata!.keywords).toContain("object");

    // Undo removes the layer atomically
    document.undo();
    expect(document.layers.length).toBe(0);

    // Redo restores the layer without calling the provider or creating duplicate asset
    document.redo();
    expect(document.layers.length).toBe(1);
    expect(document.layers.at(0)).toBe(layer);

    // Undoing does NOT refund the budget ledger! Paid inference is permanent
    expect(budgetLedger.getBudget("b-editor")!.spentSoFarCents).toBe(4.0);
  });

  it("attaches generated layer into specified parent LayerGroup", async () => {
    const { document, assetStore, service } = setupEditorEnv();

    const group = new LayerGroup();
    group.name = "Background Assets";
    document.layers.add(group);

    const job = await service.submit(
      {
        prompt: "Pine forest backdrop",
        modality: "text-to-image",
        targetWidth: 800,
        targetHeight: 600,
      },
      {
        budgetId: "b-editor",
        baseRevision: document.getSnapshot().revision,
        providerId: "test-flux",
        taskKind: "background",
      },
    );

    const candidate = await job.result();
    const layer = await service.applyCandidate(candidate.id, {
      document,
      assetStore,
      parentId: group.id,
      expectedRevision: document.getSnapshot().revision,
    });

    expect(group.layers.length).toBe(1);
    expect(group.layers.at(0)).toBe(layer);
    expect(group.layers.get(layer.id)).toBe(layer);
  });

  it("integrates end-to-end via EditorApplication.applyGeneratedCandidate", async () => {
    const editor = new EditorApplication();
    const adapter = createMockAdapter();
    editor.ai.providerRegistry.registerAdapter(adapter);
    editor.ai.budgetLedger.createBudget({
      budgetId: "b-app",
      approverId: "lead-artist",
      approvedCeilingCents: 50.0,
      consentGiven: true,
    });

    const job = await editor.ai.submit(
      {
        prompt: "Watercolor mountains",
        modality: "text-to-image",
        targetWidth: 600,
        targetHeight: 400,
      },
      {
        budgetId: "b-app",
        baseRevision: editor.document.getSnapshot().revision,
        providerId: "test-flux",
      },
    );

    const candidate = await job.result();
    const layer = await editor.applyGeneratedCandidate(candidate.id, {
      layerName: "Watercolor Mountains",
    });

    expect(layer).toBeInstanceOf(RasterLayer);
    expect(editor.document.layers.length).toBe(1);
    expect(editor.document.selectedLayer).toBe(layer);
    expect(editor.assetStore.get(layer.assetId)).toBeDefined();

    // Test undo/redo
    editor.document.undo();
    expect(editor.document.layers.length).toBe(0);
    editor.document.redo();
    expect(editor.document.layers.length).toBe(1);
    expect(editor.document.layers.at(0)).toBe(layer);
  });

  it("retains an unresolved reservation after provider failure", async () => {
    const providerRegistry = new ProviderRegistry();
    const failingAdapter = createMockAdapter({
      generate: async () => {
        throw new Error("Provider 500: Inference cluster capacity exceeded");
      },
    });
    providerRegistry.registerAdapter(failingAdapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-fail",
      approverId: "tester",
      approvedCeilingCents: 20.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    const job = await service.submit(
      {
        prompt: "Doomed request",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
      },
      {
        budgetId: "b-fail",
        baseRevision: 0,
        providerId: "test-flux",
      },
    );

    await expect(job.result()).rejects.toThrow(
      /Inference cluster capacity exceeded/,
    );
    expect(job.state).toBe("failed");
    expect(job.error?.message).toContain("Inference cluster capacity exceeded");
    expect(budgetLedger.getTotalReserved("b-fail")).toBe(4);
    expect(budgetLedger.getBudget("b-fail")!.spentSoFarCents).toBe(0);
  });

  it("keeps cancellation billing pending until a confirmed charge arrives", async () => {
    const providerRegistry = new ProviderRegistry();
    const feeAdapter = createMockAdapter({
      capabilities: {
        ...createMockAdapter().capabilities,
        pricing: {
          currency: "USD",
          costPerStandardImageCents: 10.0,
          secondaryMattingCostCents: 0,
          chargeOnCancellation: true,
        },
      },
      generate: async (_req, _b, signal) => {
        return new Promise<GenerationCandidateResult>((_resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new JobCancelledError());
            });
          }
        });
      },
    });
    providerRegistry.registerAdapter(feeAdapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-fee",
      approverId: "producer",
      approvedCeilingCents: 50.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    const job = await service.submit(
      {
        prompt: "Cancelled heavy scene",
        modality: "text-to-image",
        targetWidth: 512,
        targetHeight: 512,
      },
      {
        budgetId: "b-fee",
        baseRevision: 0,
        providerId: "test-flux",
      },
    );

    // Wait for job to start running then cancel
    await new Promise((r) => setTimeout(r, 5));
    const cancelled = await service.cancel(job.id);
    expect(cancelled).toBe(true);

    await expect(job.result()).rejects.toThrow(JobCancelledError);
    expect(job.state).toBe("cancelled");

    expect(job.billingState).toBe("pending");
    expect(budgetLedger.getTotalReserved("b-fee")).toBe(10);
    expect(budgetLedger.getBudget("b-fee")!.spentSoFarCents).toBe(0);
    service.clearCompletedJobs(0);
    expect(service.getJob(job.id)).toBe(job);
    await service.reconcileBilling(job.id, 7);
    expect(job.billingState).toBe("settled");
    expect(budgetLedger.getTotalReserved("b-fee")).toBe(0);
    expect(budgetLedger.getBudget("b-fee")!.spentSoFarCents).toBe(7);
  });

  it("rejects unsupported modality before reserving budget", async () => {
    const providerRegistry = new ProviderRegistry();
    const adapter = createMockAdapter();
    providerRegistry.registerAdapter(adapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-modality",
      approverId: "tester",
      approvedCeilingCents: 50.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    await expect(
      service.submit(
        {
          prompt: "Expand scene",
          modality: "outpainting", // not supported by test-flux
          targetWidth: 512,
          targetHeight: 512,
        },
        {
          budgetId: "b-modality",
          baseRevision: 0,
          providerId: "test-flux",
        },
      ),
    ).rejects.toThrow(/does not support modality "outpainting"/);

    expect(budgetLedger.getTotalReserved("b-modality")).toBe(0);
  });

  it("executes multiple concurrent jobs independently without cross-talk", async () => {
    const providerRegistry = new ProviderRegistry();
    const adapter = createMockAdapter();
    providerRegistry.registerAdapter(adapter);

    const budgetLedger = new BudgetLedger();
    budgetLedger.createBudget({
      budgetId: "b-concurrent",
      approverId: "batch-operator",
      approvedCeilingCents: 100.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry,
      budgetLedger,
      staging,
    });

    const jobs = await Promise.all([
      service.submit(
        {
          prompt: "Batch item 1",
          modality: "text-to-image",
          targetWidth: 256,
          targetHeight: 256,
        },
        { budgetId: "b-concurrent", baseRevision: 0, providerId: "test-flux" },
      ),
      service.submit(
        {
          prompt: "Batch item 2",
          modality: "text-to-image",
          targetWidth: 256,
          targetHeight: 256,
        },
        { budgetId: "b-concurrent", baseRevision: 0, providerId: "test-flux" },
      ),
      service.submit(
        {
          prompt: "Batch item 3",
          modality: "text-to-image",
          targetWidth: 256,
          targetHeight: 256,
        },
        { budgetId: "b-concurrent", baseRevision: 0, providerId: "test-flux" },
      ),
    ]);

    expect(budgetLedger.getTotalReserved("b-concurrent")).toBe(12.0); // 3 * 4.0

    const candidates = await Promise.all(jobs.map((j) => j.result()));
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(3);

    for (const job of jobs) {
      expect(job.state).toBe("succeeded");
    }

    expect(budgetLedger.getTotalReserved("b-concurrent")).toBe(0);
    expect(budgetLedger.getBudget("b-concurrent")!.spentSoFarCents).toBe(12.0);
  });

  it("rolls back candidate review state and removes asset from AssetStore if document transaction throws", async () => {
    const registry = new ProviderRegistry();
    registry.registerAdapter(createMockAdapter());

    const ledger = new BudgetLedger();
    ledger.createBudget({
      budgetId: "b-rollback",
      approverId: "tester",
      approvedCeilingCents: 10.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry: registry,
      budgetLedger: ledger,
      staging,
    });

    const job = await service.submit(
      {
        prompt: "Rollback test asset",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      { budgetId: "b-rollback", baseRevision: 0, providerId: "test-flux" },
    );

    const candidate = await job.result();
    expect(candidate.reviewState).toBe("staged");

    const assetStore = new AssetStore();
    const document = new Document({
      name: "Rollback Test Doc",
      width: 800,
      height: 600,
    });

    // Intentionally pass an invalid parentId to cause the transaction to throw
    await expect(
      service.applyCandidate(candidate.id, {
        document,
        assetStore,
        expectedRevision: 0,
        parentId: "non-existent-parent-group-id",
      }),
    ).rejects.toThrow(
      /Target parent group "non-existent-parent-group-id" does not exist/,
    );

    // Verify candidate was rolled back to "staged"
    expect(candidate.reviewState).toBe("staged");
    // Verify asset was cleaned up from assetStore
    expect(assetStore.values()).toHaveLength(0);
    expect(assetStore.has(candidate.asset.id)).toBe(false);
    // Verify document layers were untouched
    expect(document.layers.length).toBe(0);
  });

  it("enforces budget expiration and rejects non-finite NaN ceilings", async () => {
    const ledger = new BudgetLedger();

    // Rejects NaN ceiling
    expect(() => {
      ledger.createBudget({
        budgetId: "b-nan",
        approverId: "tester",
        approvedCeilingCents: NaN,
        consentGiven: true,
      });
    }).toThrow(BudgetExceededError);

    // Creates expired budget
    const expiredTimestamp = new Date(Date.now() - 60000).toISOString();
    ledger.createBudget({
      budgetId: "b-expired",
      approverId: "tester",
      approvedCeilingCents: 50.0,
      consentGiven: true,
      expiresAt: expiredTimestamp,
    });

    expect(() => {
      ledger.reserve("b-expired", "j-1", 5.0);
    }).toThrow(ConsentRequiredError);
  });

  it("GenerationJobService.clearCompletedJobs bounds retained jobs and dispose releases resources", async () => {
    const registry = new ProviderRegistry();
    registry.registerAdapter(createMockAdapter());

    const ledger = new BudgetLedger();
    ledger.createBudget({
      budgetId: "b-cleanup",
      approverId: "tester",
      approvedCeilingCents: 100.0,
      consentGiven: true,
    });

    const staging = new StagedAssetRepository();
    const service = new GenerationJobService({
      providerRegistry: registry,
      budgetLedger: ledger,
      staging,
    });

    const job1 = await service.submit(
      {
        prompt: "Item 1",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      { budgetId: "b-cleanup", baseRevision: 0, providerId: "test-flux" },
    );
    const job2 = await service.submit(
      {
        prompt: "Item 2",
        modality: "text-to-image",
        targetWidth: 256,
        targetHeight: 256,
      },
      { budgetId: "b-cleanup", baseRevision: 0, providerId: "test-flux" },
    );

    await Promise.all([job1.result(), job2.result()]);
    expect(service.listJobs()).toHaveLength(2);

    // Clear keeping only 1 job
    service.clearCompletedJobs(1);
    expect(service.listJobs()).toHaveLength(1);

    // Dispose cleans up all resources
    service.dispose();
  });
});

it("rejects unsupported provider outputs before reserving or dispatching", async () => {
  const adapter = createMockAdapter();
  adapter.capabilities.dimensions = {
    minWidth: 16,
    maxWidth: 64,
    minHeight: 16,
    maxHeight: 64,
    maxMegapixels: 0.003,
    supportedAspectRatios: [],
    stepSize: 8,
  };
  adapter.capabilities.alpha = "unsupported";
  const generate = vi.spyOn(adapter, "generate");
  const registry = new ProviderRegistry();
  registry.registerAdapter(adapter);
  const ledger = new BudgetLedger();
  ledger.createBudget({
    budgetId: "capabilities",
    approverId: "reviewer",
    approvedCeilingCents: 100,
  });
  const service = new GenerationJobService({
    providerRegistry: registry,
    budgetLedger: ledger,
    staging: new StagedAssetRepository(),
  });
  const request: GenerationRequest = {
    prompt: "image",
    modality: "text-to-image",
    targetWidth: 32,
    targetHeight: 32,
  };
  const options = {
    providerId: adapter.capabilities.id,
    budgetId: "capabilities",
    baseRevision: 0,
  };
  try {
    for (const patch of [
      { targetWidth: 8 },
      { targetHeight: 72 },
      { targetWidth: 33 },
      { targetWidth: 64, targetHeight: 64 },
      { requireAlpha: true },
    ]) {
      await expect(
        service.submit({ ...request, ...patch }, options),
      ).rejects.toThrow(/does not support/);
      expect(ledger.getTotalReserved("capabilities")).toBe(0);
      expect(ledger.getBudget("capabilities")!.spentSoFarCents).toBe(0);
    }
    adapter.capabilities.dimensions.discreteSizes = [{ width: 16, height: 32 }];
    await expect(service.submit(request, options)).rejects.toThrow(
      /dimensions/,
    );
    expect(generate).not.toHaveBeenCalled();
    const job = await service.submit({ ...request, targetWidth: 16 }, options);
    await job.result();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(ledger.getTotalReserved("capabilities")).toBe(0);
  } finally {
    service.dispose();
  }
});
