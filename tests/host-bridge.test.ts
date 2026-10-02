import { describe, expect, it } from "vitest";
import { Document } from "../src/dom";
import { AssetStore } from "../src/core/assets";
import { GenerationJobService } from "../src/ai/jobs/service";
import { BudgetLedger } from "../src/ai/jobs/ledger";
import { StagedAssetRepository } from "../src/ai/jobs/staging";
import { ProviderRegistry } from "../src/ai/providers/registry";
import { registerSimulationAdapters } from "./fixtures/generation/adapters";
import { HostBridge } from "../src/scripting/bridge";

// Ensure Node test environment has stubs for Worker and createImageBitmap
if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}
if (typeof globalThis.createImageBitmap === "undefined") {
  globalThis.createImageBitmap = (async (source: any) => {
    let width = 512;
    let height = 512;
    if (source instanceof Blob) {
      const buf = await source.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (
        bytes.length >= 24 &&
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
      ) {
        const view = new DataView(buf);
        width = view.getUint32(16);
        height = view.getUint32(20);
      }
    }
    return {
      width,
      height,
      close: () => {},
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}

describe("versioned host scripting bridge", () => {
  function setup() {
    const document = new Document({
      name: "Bridge Test",
      width: 800,
      height: 600,
    });
    const assets = new AssetStore();
    const registry = new ProviderRegistry();
    registerSimulationAdapters(registry);
    const ledger = new BudgetLedger();
    ledger.createBudget({
      budgetId: "default-budget",
      approvedCeilingCents: 100.0,
      approverId: "artist",
      consentGiven: true,
    });
    const staging = new StagedAssetRepository();
    const ai = new GenerationJobService({
      providerRegistry: registry,
      budgetLedger: ledger,
      staging,
    });
    return { document, assets, ai, ledger, staging };
  }

  it("dispatches jobs asynchronously returning immediate ticket without credentials", async () => {
    const { document, assets, ai } = setup();
    const bridge = new HostBridge({
      document,
      assets,
      ai,
      isTrustedScript: true,
    });

    const ticket = (await bridge.dispatch("jobs", "submit", [
      {
        prompt: "A neon forest at dusk",
        taskKind: "asset",
        output: { width: 512, height: 512, alpha: true },
      },
    ])) as { id: string; kind: string; status: string; createdAt: string };

    expect(ticket).toBeDefined();
    expect(typeof ticket.id).toBe("string");
    expect(ticket.id.length).toBeGreaterThan(10);
    expect(ticket.status).toBe("queued");
    expect(ticket.kind).toBe("asset");

    // Invariant: Zero credentials or private keys in the ticket
    expect(JSON.stringify(ticket)).not.toContain("key");
    expect(JSON.stringify(ticket)).not.toContain("token");
    expect(JSON.stringify(ticket)).not.toContain("secret");

    // Inspect status through bridge
    const info = (await bridge.dispatch("jobs", "get", [ticket.id])) as {
      id: string;
      status: string;
      candidate?: { id: string; assetId: string } | null;
    };
    expect(info.id).toBe(ticket.id);
    expect(["queued", "running", "succeeded"]).toContain(info.status);
    expect(JSON.stringify(info)).not.toContain("key");
    expect(JSON.stringify(info)).not.toContain("token");

    // Wait for the host job to complete (running on host independently of script)
    const job = ai.getJob(ticket.id)!;
    const candidate = await job.result();
    expect(job.state).toBe("succeeded");
    expect(job.candidate?.id).toBe(candidate.id);

    // Re-inspect through bridge
    const completedInfo = (await bridge.dispatch("jobs", "get", [
      ticket.id,
    ])) as {
      id: string;
      status: string;
      candidate?: {
        id: string;
        assetId: string;
        width: number;
        height: number;
      };
    };
    expect(completedInfo.status).toBe("succeeded");
    expect(completedInfo.candidate?.id).toBe(candidate.id);
    expect(completedInfo.candidate?.width).toBe(512);
    expect(completedInfo.candidate?.height).toBe(512);
  });

  it("enforces plugin permissions and blocks ungranted or revoked job dispatch", async () => {
    const { document, assets, ai } = setup();

    // Plugin with document:read only (no jobs:run)
    const restrictedBridge = new HostBridge({
      document,
      assets,
      ai,
      permissions: ["document:read"],
      pluginId: "restricted.plugin",
      isTrustedScript: false,
    });

    await expect(
      restrictedBridge.dispatch("jobs", "submit", [
        { prompt: "Forbidden generation" },
      ]),
    ).rejects.toThrow(/Permission denied: 'jobs:run'/);

    await expect(
      restrictedBridge.dispatch("jobs", "get", ["gen-123"]),
    ).rejects.toThrow(/Permission denied: 'jobs:run'/);

    // Plugin with jobs:run granted
    const authorizedBridge = new HostBridge({
      document,
      assets,
      ai,
      permissions: ["document:read", "jobs:run"],
      pluginId: "authorized.plugin",
      isTrustedScript: false,
    });

    const ticket = (await authorizedBridge.dispatch("jobs", "submit", [
      { prompt: "Authorized generation" },
    ])) as { id: string };
    expect(ticket.id).toBeDefined();

    // If permission is revoked, a new bridge instance created by editor reflects revoked permission
    const revokedBridge = new HostBridge({
      document,
      assets,
      ai,
      permissions: ["document:read"], // jobs:run was revoked by user
      pluginId: "authorized.plugin",
      isTrustedScript: false,
    });

    await expect(
      revokedBridge.dispatch("jobs", "submit", [
        { prompt: "Attempt after revocation" },
      ]),
    ).rejects.toThrow(/Permission denied: 'jobs:run'/);
  });

  it("enforces document:write and assets:read permissions", async () => {
    const { document, assets, ai } = setup();

    const noWriteBridge = new HostBridge({
      document,
      assets,
      ai,
      permissions: ["document:read", "jobs:run"],
      pluginId: "read.only.plugin",
      isTrustedScript: false,
    });

    await expect(
      noWriteBridge.dispatch("jobs", "applyCandidate", ["cand-123", {}]),
    ).rejects.toThrow(/Permission denied: 'document:write'/);

    await expect(
      noWriteBridge.dispatch("assets", "get", ["asset-123"]),
    ).rejects.toThrow(/Permission denied: 'assets:read'/);

    const assetBridge = new HostBridge({
      document,
      assets,
      ai,
      permissions: ["document:read", "assets:read"],
      pluginId: "asset.plugin",
      isTrustedScript: false,
    });

    const list = (await assetBridge.dispatch(
      "assets",
      "list",
      [],
    )) as unknown[];
    expect(Array.isArray(list)).toBe(true);
  });

  it("supports job cancellation through bridge", async () => {
    const { document, assets, ai } = setup();
    const bridge = new HostBridge({
      document,
      assets,
      ai,
      isTrustedScript: true,
    });

    const ticket = (await bridge.dispatch("jobs", "submit", [
      { prompt: "Long job to cancel" },
    ])) as { id: string };

    const job = ai.getJob(ticket.id)!;
    job.result().catch(() => {});

    const cancelled = await bridge.dispatch("jobs", "cancel", [ticket.id]);
    expect(cancelled).toBe(true);

    const info = (await bridge.dispatch("jobs", "get", [ticket.id])) as {
      status: string;
    };
    expect(["cancelling", "cancelled"]).toContain(info.status);
  });

  it("applies completed candidate to document with 1-step undo", async () => {
    const { document, assets, ai } = setup();
    const bridge = new HostBridge({
      document,
      assets,
      ai,
      isTrustedScript: true,
    });

    const ticket = (await bridge.dispatch("jobs", "submit", [
      { prompt: "Background layer", output: { width: 512, height: 512 } },
    ])) as { id: string };

    const job = ai.getJob(ticket.id)!;
    const candidate = await job.result();

    const initialRev = document.getSnapshot().revision;
    const applied = (await bridge.dispatch("jobs", "applyCandidate", [
      candidate.id,
      { layerName: "AI Mountain View" },
    ])) as { layerId: string };

    expect(applied.layerId).toBeDefined();
    expect(document.getSnapshot().revision).toBe(initialRev + 1);
    expect(bridge.inBandRevisions).toBe(1);
    expect(document.layers.length).toBe(1);
    expect(document.getLayer(applied.layerId)?.name).toBe("AI Mountain View");

    // 1-step undo
    document.undo();
    expect(document.layers.length).toBe(0);
    expect(document.getSnapshot().revision).toBe(initialRev + 2);
  });

  it("restricts plugin caller from accessing or cancelling jobs submitted by others", async () => {
    const { document, assets, ai } = setup();
    const bridge1 = new HostBridge({
      document,
      assets,
      ai,
      pluginId: "plugin.first",
      isTrustedScript: false,
      permissions: ["jobs:run"],
    });
    const bridge2 = new HostBridge({
      document,
      assets,
      ai,
      pluginId: "plugin.second",
      isTrustedScript: false,
      permissions: ["jobs:run"],
    });

    const ticket = (await bridge1.dispatch("jobs", "submit", [
      { prompt: "First plugin job" },
    ])) as { id: string };

    // bridge1 can see its job
    const info1 = await bridge1.dispatch("jobs", "get", [ticket.id]);
    expect(info1).not.toBeNull();

    // bridge2 cannot see or cancel bridge1's job
    const info2 = await bridge2.dispatch("jobs", "get", [ticket.id]);
    expect(info2).toBeNull();

    await expect(
      bridge2.dispatch("jobs", "cancel", [ticket.id]),
    ).rejects.toThrow(/Job not found or access denied/);
  });

  it("clamps and bounds output dimensions safely", async () => {
    const { document, assets, ai } = setup();
    const bridge = new HostBridge({
      document,
      assets,
      ai,
      isTrustedScript: true,
    });
    const ticket = (await bridge.dispatch("jobs", "submit", [
      { prompt: "Huge request", output: { width: 999999, height: -50 } },
    ])) as { id: string };
    const job = ai.getJob(ticket.id)!;
    expect(job.request.targetWidth).toBe(2048);
    expect(job.request.targetHeight).toBe(256);
  });
});
