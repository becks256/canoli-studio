import { z } from "zod";
import { computeSha256 } from "../batch/manifest";
import type { GenerationCandidate, GenerationRecord } from "./types";
import type { ProtectedInvariantEvaluationOptions } from "../diff/types";

const positive = z.number().int().positive();
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const recordSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    providerId: z.string().min(1),
    providerName: z.string(),
    modelVersion: z.string(),
    taskKind: z.enum(["asset", "texture", "background", "object", "overlay"]),
    prompt: z.string(),
    revisedPrompt: z.string().optional(),
    targetWidth: positive,
    targetHeight: positive,
    hasAlpha: z.boolean(),
    estimatedCostCents: z.number().nonnegative(),
    actualCostCents: z.number().nonnegative(),
    currency: z.string(),
    sourceDocumentId: z.string().optional(),
    baseRevision: z.number().int().nonnegative(),
    createdAt: date,
    completedAt: date,
    durationMs: z.number().nonnegative(),
    status: z.literal("succeeded"),
    provenanceVersion: z.literal(1),
  })
  .strict();
const protectionSchema = z
  .object({
    referenceBuffer: z.union([
      z.instanceof(Uint8Array),
      z.instanceof(Uint8ClampedArray),
    ]),
    width: positive,
    height: positive,
    protectedMask: z.instanceof(Uint8Array).optional(),
    editMask: z.instanceof(Uint8Array).optional(),
    protectedRegions: z
      .array(
        z
          .object({
            shape: z.enum(["rectangle", "ellipse"]).optional(),
            x: z.number(),
            y: z.number(),
            width: z.number().nonnegative(),
            height: z.number().nonnegative(),
          })
          .strict(),
      )
      .optional(),
    featherRadius: z.number().nonnegative().optional(),
    tolerance: z.number().nonnegative().optional(),
    generateHeatmap: z.boolean().optional(),
  })
  .strict();
const payloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    jobId: z.string().min(1),
    width: positive,
    height: positive,
    hasAlpha: z.boolean(),
    createdAt: date,
    blob: z.instanceof(Blob),
    record: recordSchema,
    protection: protectionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.jobId !== value.record.jobId)
      ctx.addIssue({
        code: "custom",
        message: "Candidate record job does not match.",
      });
    const protection = value.protection;
    if (
      protection &&
      (protection.width !== value.width ||
        protection.height !== value.height ||
        protection.referenceBuffer.length !== value.width * value.height * 4 ||
        [protection.editMask, protection.protectedMask].some(
          (mask) => mask && mask.length !== value.width * value.height,
        ))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Candidate protection dimensions do not match.",
      });
    }
  });
export type SavedGenerationCandidate = z.infer<typeof payloadSchema>;
const envelopeSchema = z
  .object({
    payload: payloadSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

async function checksum(payload: SavedGenerationCandidate): Promise<string> {
  const { blob, protection, ...metadata } = payload;
  return computeSha256(
    JSON.stringify({
      ...metadata,
      blobType: blob.type,
      blobHash: await computeSha256(await blob.arrayBuffer()),
      protection: protection
        ? {
            ...protection,
            referenceBuffer: await computeSha256(
              new Uint8Array(protection.referenceBuffer),
            ),
            protectedMask: protection.protectedMask
              ? await computeSha256(protection.protectedMask)
              : undefined,
            editMask: protection.editMask
              ? await computeSha256(protection.editMask)
              : undefined,
          }
        : undefined,
    }),
  );
}

/** Encoded candidate pixels, provenance and protected references stored atomically. */
export class GenerationCandidateStorage {
  private database?: Promise<IDBDatabase>;
  private async open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined")
      throw new Error("Candidate recovery storage is unavailable.");
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("luma-generation-candidates", 1);
        let blocked = false;
        request.onupgradeneeded = () =>
          request.result.createObjectStore("candidates");
        request.onerror = () =>
          reject(request.error ?? new Error("Cannot open candidate storage."));
        request.onblocked = () => {
          blocked = true;
          reject(new Error("Candidate storage upgrade is blocked."));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            this.database = undefined;
          };
          resolve(db);
        };
      }).catch((error) => {
        this.database = undefined;
        throw error;
      });
    }
    return this.database;
  }

  async save(
    candidate: GenerationCandidate,
    record: GenerationRecord,
    protection?: Omit<ProtectedInvariantEvaluationOptions, "candidateBuffer">,
    signal?: AbortSignal,
  ): Promise<void> {
    const payload = payloadSchema.parse(
      structuredClone({
        schemaVersion: 1,
        id: candidate.id,
        jobId: candidate.jobId,
        width: candidate.width,
        height: candidate.height,
        hasAlpha: candidate.hasAlpha,
        createdAt: candidate.createdAt,
        blob: candidate.asset.blob,
        record,
        protection,
      }),
    );
    const envelope = { payload, checksum: await checksum(payload) };
    const db = await this.open();
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("candidates", "readwrite", {
        durability: "strict",
      });
      let failure: unknown;
      const abort = () => {
        failure = signal?.reason;
        try {
          tx.abort();
        } catch {}
      };
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        cleanup();
        resolve();
      };
      tx.onabort = () => {
        cleanup();
        reject(failure ?? tx.error ?? new Error("Candidate save aborted."));
      };
      tx.onerror = () => {
        failure ??= tx.error;
      };
      const store = tx.objectStore("candidates");
      const existing = store.get(payload.id);
      existing.onsuccess = () => {
        try {
          if (
            existing.result &&
            existing.result.payload?.jobId !== payload.jobId
          )
            throw new Error("Candidate identity belongs to another job.");
          signal?.throwIfAborted();
          store.put(envelope, payload.id);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }

  async list(): Promise<SavedGenerationCandidate[]> {
    const db = await this.open();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction("candidates", "readonly");
      const request = tx.objectStore("candidates").getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Cannot read saved candidates."));
    });
    const candidates: SavedGenerationCandidate[] = [];
    for (const row of rows) {
      const envelope = envelopeSchema.parse(row);
      if ((await checksum(envelope.payload)) !== envelope.checksum)
        throw new Error("Saved candidate integrity verification failed.");
      candidates.push(envelope.payload);
    }
    return candidates;
  }

  async remove(candidateId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("candidates", "readwrite", {
        durability: "strict",
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("Candidate removal aborted."));
      tx.objectStore("candidates").delete(candidateId);
    });
  }
}
