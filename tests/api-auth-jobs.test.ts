import { LayerGroup, TextLayer } from "../src/dom";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { executeFixtureGeneration } from "./fixtures/generation/server-executor";
import { createApiServer } from "../server/app";

describe("authenticated REST assets and jobs API", () => {
  const AUTH_TOKEN = "test-bearer-token-12345";
  const server = createApiServer({
    authToken: AUTH_TOKEN,
    executeGeneration: executeFixtureGeneration,
  });
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function apiRequest(
    path: string,
    data?: unknown,
    method = data ? "POST" : "GET",
    token: string | null = AUTH_TOKEN,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(base + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    const isJson = response.headers
      .get("content-type")
      ?.includes("application/json");
    return {
      status: response.status,
      headers: response.headers,
      body: isJson ? await response.json() : await response.text(),
    };
  }

  it("enforces bearer token authentication on protected endpoints and allows health check", async () => {
    // Health endpoint is accessible without token
    const health = await apiRequest("/health", undefined, "GET", null);
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(health.body.authenticated).toBe(true);

    // Missing token returns 401 with WWW-Authenticate header
    const unauthorized = await apiRequest("/documents", undefined, "GET", null);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer");

    // Invalid token returns 401
    const forbidden = await apiRequest(
      "/documents",
      undefined,
      "GET",
      "bad-token",
    );
    expect(forbidden.status).toBe(401);

    // Valid Bearer token succeeds
    const authorized = await apiRequest(
      "/documents",
      undefined,
      "GET",
      AUTH_TOKEN,
    );
    expect(authorized.status).toBe(200);
    expect(Array.isArray(authorized.body.documents)).toBe(true);

    // X-API-Key header also succeeds
    const apiKeyRes = await fetch(base + "/documents", {
      headers: { "X-API-Key": AUTH_TOKEN },
    });
    expect(apiKeyRes.status).toBe(200);
  });

  it("uploads binary and base64 assets and serves raw and metadata endpoints", async () => {
    // 1. Create document
    const created = await apiRequest("/documents", {
      name: "Asset Test",
      width: 1200,
      height: 800,
    });
    expect(created.status).toBe(201);
    const docId = created.body.document.id;

    // 2. Upload asset via JSON base64
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const jsonUpload = await apiRequest(`/documents/${docId}/assets`, {
      name: "tiny-sample.png",
      data: tinyPngBase64,
      width: 1,
      height: 1,
      contentType: "image/png",
    });
    expect(jsonUpload.status).toBe(201);
    expect(jsonUpload.body.asset.id).toBeDefined();
    expect(jsonUpload.body.asset.name).toBe("tiny-sample.png");
    expect(jsonUpload.body.asset.width).toBe(1);
    expect(jsonUpload.body.asset.height).toBe(1);
    const jsonAssetId = jsonUpload.body.asset.id;

    // 3. Upload asset via raw binary
    const rawPngBuffer = Buffer.from(tinyPngBase64, "base64");
    const binaryRes = await fetch(`${base}/documents/${docId}/assets`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "X-Asset-Name": "binary-upload.png",
        "X-Asset-Width": "1",
        "X-Asset-Height": "1",
      },
      body: rawPngBuffer,
    });
    expect(binaryRes.status).toBe(201);
    const binaryData = (await binaryRes.json()) as any;
    expect(binaryData.asset.id).toBeDefined();
    expect(binaryData.asset.name).toBe("binary-upload.png");
    const binaryAssetId = binaryData.asset.id;

    // 4. List assets
    const listRes = await apiRequest(`/documents/${docId}/assets`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.assets).toHaveLength(2);

    // 5. Retrieve JSON metadata
    const metaRes = await apiRequest(
      `/documents/${docId}/assets/${jsonAssetId}`,
    );
    expect(metaRes.status).toBe(200);
    expect(metaRes.body.asset.id).toBe(jsonAssetId);

    // 6. Retrieve raw binary bytes
    const rawFetch = await fetch(
      `${base}/documents/${docId}/assets/${binaryAssetId}`,
      {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          Accept: "image/png",
        },
      },
    );
    expect(rawFetch.status).toBe(200);
    expect(rawFetch.headers.get("content-type")).toBe("image/png");
    const rawBytes = new Uint8Array(await rawFetch.arrayBuffer());
    expect(rawBytes.length).toBe(rawPngBuffer.length);
    expect(rawBytes[0]).toBe(137); // PNG signature byte 0
    expect(rawBytes[1]).toBe(80); // 'P'

    // 7. 404 for missing asset
    const missingRes = await apiRequest(
      `/documents/${docId}/assets/nonexistent-id`,
    );
    expect(missingRes.status).toBe(404);
  });

  it("submits async jobs with idempotency deduplication, polls status, and cancels", async () => {
    // 1. Create document
    const created = await apiRequest("/documents", {
      name: "Job Service Test",
      width: 800,
      height: 600,
    });
    const docId = created.body.document.id;

    // 2. Submit async generation job
    const jobSubmit = await apiRequest(`/documents/${docId}/jobs`, {
      kind: "generation",
      prompt: "A cinematic fantasy castle",
      targetWidth: 512,
      targetHeight: 512,
      idempotencyKey: "test-idempotency-key-001",
      expectedRevision: 0,
    });
    expect(jobSubmit.status).toBe(202);
    expect(jobSubmit.body.job).toBeDefined();
    expect(jobSubmit.body.job.id).toBeDefined();
    expect(jobSubmit.body.job.status).toBe("queued");
    const jobId = jobSubmit.body.job.id;

    // 3. Idempotency test: duplicate submission with same key returns existing job (no double billing)
    const duplicateSubmit = await apiRequest(`/documents/${docId}/jobs`, {
      kind: "generation",
      prompt: "A cinematic fantasy castle",
      targetWidth: 512,
      targetHeight: 512,
      idempotencyKey: "test-idempotency-key-001",
    });
    expect(duplicateSubmit.status).toBe(200);
    expect(duplicateSubmit.body.job.id).toBe(jobId);

    // 4. Revision conflict check on job submission
    const conflictSubmit = await apiRequest(`/documents/${docId}/jobs`, {
      prompt: "Conflict prompt",
      expectedRevision: 99,
    });
    expect(conflictSubmit.status).toBe(409);

    // 5. Poll status until completion
    let pollCount = 0;
    let jobInfo = jobSubmit.body.job;
    while (jobInfo.status !== "succeeded" && pollCount < 30) {
      await new Promise((r) => setTimeout(r, 20));
      const poll = await apiRequest(`/jobs/${jobId}`);
      expect(poll.status).toBe(200);
      jobInfo = poll.body.job;
      pollCount++;
    }

    expect(jobInfo.status).toBe("succeeded");
    expect(jobInfo.progress.percent).toBe(1.0);
    expect(jobInfo.candidate).toBeDefined();
    expect(jobInfo.candidate.id).toBeDefined();
    expect(jobInfo.candidate.width).toBe(512);
    expect(jobInfo.candidate.height).toBe(512);
    expect(jobInfo.candidate.reviewState).toBe("staged");

    // The delivered image must contain actual full-resolution pixels, not a patched header.
    const download = await fetch(
      `${base}/documents/${docId}/assets/${jobInfo.candidate.assetId}`,
      {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}`, Accept: "image/png" },
      },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await download.arrayBuffer());
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
        chunks.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const scanlines = inflateSync(Buffer.concat(chunks));
    expect(scanlines.length).toBe((512 * 4 + 1) * 512);
    expect(Array.from(scanlines.subarray(1, 5))).toEqual([255, 0, 0, 255]);

    // 6. Test cancellation on another job
    const jobToCancel = await apiRequest(`/documents/${docId}/jobs`, {
      prompt: "Job to cancel",
      targetWidth: 512,
      targetHeight: 512,
    });
    const cancelId = jobToCancel.body.job.id;
    const cancelRes = await apiRequest(`/jobs/${cancelId}/cancel`, {}, "POST");
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.job.status).toBe("cancelled");
  });

  it("applies staged candidate as RasterLayer with revision check and 1-step undo/redo", async () => {
    // 1. Create document
    const created = await apiRequest("/documents", {
      name: "Apply Candidate Test",
      width: 1000,
      height: 800,
    });
    const docId = created.body.document.id;
    expect(created.body.revision).toBe(0);

    // 2. Submit job and wait for candidate
    const jobSubmit = await apiRequest(`/documents/${docId}/jobs`, {
      prompt: "Majestic waterfall",
      targetWidth: 512,
      targetHeight: 512,
    });
    const jobId = jobSubmit.body.job.id;

    let candidateId = "";
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const poll = await apiRequest(`/jobs/${jobId}`);
      if (poll.body.job.status === "succeeded") {
        candidateId = poll.body.job.candidate.id;
        break;
      }
    }
    expect(candidateId).toBeTruthy();

    // 3. Revision conflict check when applying candidate
    const conflictApply = await apiRequest(
      `/documents/${docId}/apply-candidate`,
      {
        candidateId,
        expectedRevision: 99,
      },
    );
    expect(conflictApply.status).toBe(409);

    // 4. Apply candidate with matching expectedRevision: 0
    const applyRes = await apiRequest(`/documents/${docId}/apply-candidate`, {
      candidateId,
      expectedRevision: 0,
      layerName: "Hero Waterfall",
      opacity: 0.9,
    });
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.revision).toBe(1);
    expect(applyRes.body.canUndo).toBe(true);
    expect(applyRes.body.document.children).toHaveLength(1);
    const createdLayer = applyRes.body.document.children[0];
    expect(createdLayer.name).toBe("Hero Waterfall");
    expect(createdLayer.opacity).toBe(0.9);
    expect(createdLayer.width).toBe(512);
    expect(createdLayer.height).toBe(512);

    // 5. 1-step Undo via REST rolls back the applied layer
    const undoRes = await apiRequest(`/documents/${docId}/undo`, {
      expectedRevision: 1,
    });
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.document.children).toHaveLength(0);
    expect(undoRes.body.revision).toBe(2);
    expect(undoRes.body.canRedo).toBe(true);

    // 6. Redo restores the layer
    const redoRes = await apiRequest(`/documents/${docId}/redo`, {
      expectedRevision: 2,
    });
    expect(redoRes.status).toBe(200);
    expect(redoRes.body.document.children).toHaveLength(1);
    expect(redoRes.body.revision).toBe(3);

    // 7. Cross-document isolation: applying candidate to a different document returns 404
    const docB = await apiRequest("/documents", { name: "Document B" });
    const crossApply = await apiRequest(
      `/documents/${docB.body.document.id}/apply-candidate`,
      {
        candidateId,
        expectedRevision: 0,
      },
    );
    expect(crossApply.status).toBe(404);
    expect(crossApply.body.error).toContain("Candidate not found for document");
  });
  it("scopes REST idempotency to the document and rejects changed request content", async () => {
    const first = await apiRequest("/documents", { width: 16, height: 16 });
    const second = await apiRequest("/documents", { width: 16, height: 16 });
    const input = {
      prompt: "bound REST request",
      targetWidth: 16,
      targetHeight: 16,
      idempotencyKey: "document-scoped-key",
    };
    const firstJob = await apiRequest(
      `/documents/${first.body.document.id}/jobs`,
      input,
    );
    const conflict = await apiRequest(
      `/documents/${first.body.document.id}/jobs`,
      { ...input, prompt: "changed" },
    );
    expect(conflict.status).toBe(409);
    const secondJob = await apiRequest(
      `/documents/${second.body.document.id}/jobs`,
      input,
    );
    expect(secondJob.status).toBe(202);
    expect(secondJob.body.job.id).not.toBe(firstJob.body.job.id);
    expect(secondJob.body.job.documentId).toBe(second.body.document.id);
  });

  it("rejects invalid candidate placement atomically and respects inherited group locks", async () => {
    const created = await apiRequest("/documents", { width: 16, height: 16 });
    const path = `/documents/${created.body.document.id}`;
    const valid = new LayerGroup({ name: "Destination" });
    const locked = new LayerGroup({ name: "Locked ancestor" });
    const nested = new LayerGroup({ name: "Locked descendant" });
    locked.layers.add(nested);
    locked.locked = true;
    const text = new TextLayer({ text: "Not a group" });
    const setup = await apiRequest(path + "/commands", {
      expectedRevision: 0,
      commands: [valid, locked, text].map((layer) => ({
        type: "layer.add",
        layer: layer.toJSON(),
      })),
    });
    expect(setup.status).toBe(200);
    const submitted = await apiRequest(path + "/jobs", {
      prompt: "placement fixture",
      targetWidth: 16,
      targetHeight: 16,
    });
    let candidateId = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      const poll = await apiRequest(`/jobs/${submitted.body.job.id}`);
      if (poll.body.job.candidate) {
        candidateId = poll.body.job.candidate.id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(candidateId).not.toBe("");
    const before = (await apiRequest(path)).body;
    for (const patch of [
      { parentId: "missing" },
      { parentId: text.id },
      { parentId: nested.id },
      { opacity: 2 },
      { blendMode: "invalid-mode" },
      { parentID: valid.id },
    ]) {
      const rejected = await apiRequest(path + "/apply-candidate", {
        expectedRevision: 1,
        candidateId,
        ...patch,
      });
      expect(rejected.status).toBe(400);
      expect((await apiRequest(path)).body).toEqual(before);
      expect(
        (await apiRequest(`/jobs/${submitted.body.job.id}`)).body.job.candidate
          .reviewState,
      ).toBe("staged");
    }
    const applied = await apiRequest(path + "/apply-candidate", {
      expectedRevision: 1,
      candidateId,
      parentId: valid.id,
    });
    expect(applied.status).toBe(200);
    expect(applied.body.revision).toBe(2);
    expect(applied.body.document.children[0].children).toHaveLength(1);
    const undo = await apiRequest(path + "/undo", { expectedRevision: 2 });
    expect(undo.body.document).toEqual(before.document);
    const redo = await apiRequest(path + "/redo", { expectedRevision: 3 });
    expect(redo.body.document.children[0].children[0].id).toBe(
      applied.body.layerId,
    );
  });
});
