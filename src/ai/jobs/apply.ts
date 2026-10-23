import type {HistoryOrigin} from '../../core/history-provenance';
import {captureRetainedHistory,retainedDocuments} from '../../core/history';
import {referencedAssets} from '../../core/model';
import { rgbaThumbnail } from "./thumbnail";
/**
 * Revision-Safe Candidate Application.
 *
 * Atomically commits an accepted staged candidate into the document
 * as a standard RasterLayer within a single Document.transaction.
 * Enforces revision concurrency checking to ensure stale results from
 * in-flight jobs cannot silently overwrite intervening user edits.
 */

import { CanvasRenderer } from "../../engine/renderer";
import type { DocumentRenderer } from "../../engine/renderer";
import { evaluateProtectedRegionInvariant } from "../diff/engine";
import type { AssetStore } from "../../core/assets";
import {
  Document,
  LayerGroup,
  LayerMask,
  LayerMetadata,
  MarqueeSelection,
  RasterLayer,
} from "../../dom";
import type { StagedAssetRepository } from "./staging";
import type { ApplyCandidateOptions, GenerationRecord } from "./types";
import { ProtectedRegionViolationError, RevisionConflictError } from "./types";
import type { ProtectedRegion } from "../diff/types";

interface CandidatePlacementInput {
  candidateId: string;
  document: Document;
  assetStore: AssetStore;
  staging: StagedAssetRepository;
  records: Map<string, GenerationRecord>;
  options: ApplyCandidateOptions;
  renderer?: DocumentRenderer;
  historyOrigin?:HistoryOrigin;
  assertCanCommit?:()=>void;
}

export function applyCandidateToDocument(
  input: CandidatePlacementInput,
): Promise<RasterLayer> {
  return placeCandidate(input);
}

export async function previewCandidatePlacement(
  input: CandidatePlacementInput,
): Promise<void> {
  if (!input.staging.getProtectionContext(input.candidateId))
    throw new Error("Placement verification requires a protected candidate.");
  await placeCandidate({ ...input, previewOnly: true });
}

async function placeCandidate({
  candidateId,
  document,
  assetStore,
  staging,
  records,
  options,
  renderer,
  previewOnly = false,
  historyOrigin = document._getHistoryOrigin(),
  assertCanCommit,
}: CandidatePlacementInput & { previewOnly?: boolean }): Promise<RasterLayer> {
  options = {
    ...options,
    maskSelection: options.maskSelection
      ? structuredClone(options.maskSelection)
      : undefined,
  };
  // 1. Revision concurrency guard: check if document moved while generation was in-flight
  const currentRevision = document.getSnapshot().revision;
  if (
    !options.allowStaleRevision &&
    options.expectedRevision !== undefined &&
    currentRevision !== options.expectedRevision
  ) {
    throw new RevisionConflictError(
      `Document revision changed from ${options.expectedRevision} to ${currentRevision} while job was in flight. Stale results cannot auto-commit.`,
    );
  }

  // 2. Fetch candidate from staging
  const candidate = staging.getCandidate(candidateId);
  if (!candidate) {
    throw new Error(`Staged generation candidate "${candidateId}" not found.`);
  }

  const hasProtection = staging.verifyProtection(candidateId);
  const protection = staging.getProtectionContext(candidateId);
  const assertLifetime = assetStore.captureLifetime();
  const assertCandidateAvailable = () => {
    assertLifetime();
    if (
      staging.getCandidate(candidateId) !== candidate ||
      candidate.reviewState === "discarded"
    ) {
      throw new Error("Candidate was discarded while preparing placement.");
    }
  };

  // 3. Protected region invariant guard: transparent failure if invariant violated without explicit override
  if (
    !hasProtection &&
    candidate.diffReport &&
    !candidate.diffReport.passed &&
    !options.allowViolationOverride &&
    !previewOnly
  ) {
    throw new ProtectedRegionViolationError(
      `Candidate violates protected region invariant: ${candidate.diffReport.violatedPixelCount} pixels altered inside protected region. Explicit user override required to apply.`,
      candidate.diffReport,
    );
  }

  const previousReviewState = candidate.reviewState;
  const record = records.get(candidate.jobId);
  if (
    !options.allowStaleRevision &&
    (candidate.restored ||
      (record?.sourceDocumentId && record.sourceDocumentId !== document.id))
  ) {
    throw new RevisionConflictError(
      "This candidate must be reviewed for the current document before placement. Explicit placement approval is required.",
    );
  }
  const defaultName = record
    ? `${record.prompt.slice(0, 32)} (AI)`
    : `Generated ${candidate.id.slice(0, 8)}`;
  const layerName = options.layerName || defaultName;

  // 4. Atomically promote staged asset into permanent AssetStore
  const promotedAsset = await staging.promote(
    candidateId,
    assetStore,
    layerName,
  );

  // 5. Create and attach the RasterLayer within a single synchronous Document.transaction
  let createdLayer: RasterLayer | null = null;

  const insert = (target: Document) => {
    const docWidth = target.width;
    const docHeight = target.height;

    // Dimension and position calculation (center if unspecified)
    const targetW = options.width ?? candidate.width;
    const targetH = options.height ?? candidate.height;
    const x = options.x ?? Math.round((docWidth - targetW) / 2);
    const y = options.y ?? Math.round((docHeight - targetH) / 2);

    createdLayer = new RasterLayer({
      name: layerName,
      assetId: promotedAsset.id,
      width: targetW,
      height: targetH,
      x,
      y,
      opacity: options.opacity ?? 1,
      blendMode: options.blendMode ?? "normal",
    });

    // Attach layer mask if masked edit selection provided
    if (options.maskSelection) {
      createdLayer.mask = new LayerMask({
        selection: new MarqueeSelection(options.maskSelection),
        feather: options.maskFeather ?? 0,
      });
    }

    // Attach provenance metadata (excluding any credentials/secrets)
    if (record) {
      const diffStatus = candidate.diffReport
        ? candidate.diffReport.passed
          ? " (Protected invariant: Verified Δ=0)"
          : " (Protected invariant: Override)"
        : "";

      createdLayer.metadata = new LayerMetadata({
        title: record.prompt.slice(0, 240),
        description: `Generated via ${record.providerName} (${record.modelVersion}) with prompt: "${record.prompt}"${diffStatus}`,
        altText: `AI-generated ${record.taskKind}: ${record.prompt.slice(0, 200)}`,
        creator: `Canoli Studio AI / ${record.providerName}`,
        copyright: "All rights reserved by creator",
        license: `Generated Asset (Record ID: ${record.id})`,
        keywords: [
          "ai-generated",
          record.taskKind,
          record.providerId,
          record.hasAlpha ? "transparent" : "opaque",
          ...(candidate.diffReport?.passed
            ? ["protected-invariant-verified"]
            : []),
          ...(candidate.diffReport && !candidate.diffReport.passed
            ? ["protected-invariant-override"]
            : []),
        ],
      });
    }

    // 6. Insertion into target group or root layers
    if (options.parentId) {
      const parent = target.getLayer(options.parentId);
      if (!parent) {
        throw new Error(
          `Target parent group "${options.parentId}" does not exist in current document.`,
        );
      }
      if (!(parent instanceof LayerGroup)) {
        throw new Error(
          `Target parent "${options.parentId}" is not a LayerGroup.`,
        );
      }
      if (parent.locked) {
        throw new Error(
          `Cannot add generated layer into locked group "${parent.name}".`,
        );
      }
      parent.layers.add(createdLayer);
    } else {
      target.layers.add(createdLayer);
    }
  };

  try {
    assertCandidateAvailable();
    const verificationRevision = document.getSnapshot().revision;
    if (protection) {
      if (
        document.width !== protection.width ||
        document.height !== protection.height
      ) {
        throw new Error(
          "Protected reference dimensions must match the target document.",
        );
      }
      const proposed = Document.fromJSON(document.toJSON());
      insert(proposed);
      const snapshot = proposed.toJSON();
      const pixels = new Uint8Array(snapshot.width * snapshot.height * 4);
      const compositor = renderer ?? new CanvasRenderer();
      try {
        // Bounded rendering surfaces preserve native document resolution.
        for (let y = 0; y < snapshot.height; y += 1024) {
          for (let x = 0; x < snapshot.width; x += 1024) {
            const width = Math.min(1024, snapshot.width - x);
            const height = Math.min(1024, snapshot.height - y);
            const canvas = await compositor.render(snapshot, assetStore, {
              region: { x, y, width, height },
              cache: false,
              readback: true,
              outputSize: { width, height },
            });
            try {
              assertCandidateAvailable();
              if (canvas.width !== width || canvas.height !== height)
                throw new Error(
                  "Protected verification requires native-resolution rendering.",
                );
              const context = canvas.getContext("2d");
              if (!context)
                throw new Error("Cannot read the protected edit composite.");
              const tile = context.getImageData(0, 0, width, height).data;
              for (let row = 0; row < height; row++) {
                pixels.set(
                  tile.subarray(row * width * 4, (row + 1) * width * 4),
                  ((y + row) * snapshot.width + x) * 4,
                );
              }
            } finally {
              canvas.width = canvas.height = 0;
            }
          }
        }
      } finally {
        if (!renderer) compositor.dispose();
      }
      if (protection.editMask) {
        const protectedMask = new Uint8Array(protection.editMask.length);
        for (let i = 0; i < protectedMask.length; i++) {
          protectedMask[i] = Math.max(
            protection.protectedMask?.[i] ?? 0,
            255 - protection.editMask[i],
          );
        }
        protection.protectedMask = protectedMask;
      }
      candidate.diffReport = evaluateProtectedRegionInvariant({
        ...protection,
        candidateBuffer: pixels,
      });
      const thumbnail = rgbaThumbnail(pixels, snapshot.width, snapshot.height);
      candidate.compositePreview = thumbnail
        ? { thumbnail, documentId: document.id, revision: verificationRevision }
        : undefined;
      if (
        !candidate.diffReport.passed &&
        !options.allowViolationOverride &&
        !previewOnly
      ) {
        throw new ProtectedRegionViolationError(
          "The rendered edit changes protected pixels. Review the composite difference or explicitly authorize an override.",
          candidate.diffReport,
        );
      }
    }
    if (previewOnly) {
      assertCandidateAvailable();
      assertCanCommit?.();
      if (document.getSnapshot().revision !== verificationRevision) {
        staging.verifyProtection(candidateId);
        throw new RevisionConflictError(
          "Document changed during placement preview. Check placement again.",
        );
      }
      const state=document.getSnapshot();if(!retainedDocuments(state.document,captureRetainedHistory(state)).some(value=>referencedAssets(value).has(promotedAsset.id)))assetStore.remove(promotedAsset.id);
      candidate.reviewState = previousReviewState;
      return createdLayer!;
    }
    document._withHistoryOrigin({...historyOrigin,candidate:{id:candidate.id,jobId:candidate.jobId,...(record?.providerId?{providerId:record.providerId}:{}),...(record?.modelVersion?{modelVersion:record.modelVersion}:{})}},()=>document.transaction("Apply generated layer", () => {
      assertCandidateAvailable();
      assertCanCommit?.();
      if (
        (protection &&
          document.getSnapshot().revision !== verificationRevision) ||
        (!options.allowStaleRevision &&
          options.expectedRevision !== undefined &&
          document.getSnapshot().revision !== options.expectedRevision)
      ) {
        throw new RevisionConflictError(
          "Document changed while verifying the generated composite. Review it again before applying.",
        );
      }
      insert(document);
    }));

    if (!createdLayer) {
      throw new Error(
        "Failed to create and attach generated layer during transaction.",
      );
    }
  } catch (error) {
    const state=document.getSnapshot(),retained=retainedDocuments(state.document,captureRetainedHistory(state)).some(value=>referencedAssets(value).has(promotedAsset.id)),accepted=state.revision!==currentRevision&&!!document.getLayer((createdLayer as RasterLayer|null)?.id??null);
    if(accepted){candidate.reviewState='accepted';throw new Error('Generated layer accepted, but an observer failed. Inspect the document before retrying.',{cause:error});}
    // Revert candidate review state to staged and remove orphaned asset from AssetStore on rollback
    if (staging.getCandidate(candidateId) === candidate) {
      candidate.reviewState = previousReviewState;
    }
    if(!retained)assetStore.remove(promotedAsset.id);
    throw error;
  }

  // Select the newly committed layer after transaction commits to store
  document.selectedLayer = createdLayer;

  return createdLayer;
}

export interface ApplyMaskedEditOptions extends ApplyCandidateOptions {
  referenceBuffer?: Uint8Array;
  protectedMask?: Uint8Array;
  protectedRegions?: ProtectedRegion[];
  editMask?: Uint8Array;
  tolerance?: number;
  featherRadius?: number;
}

export async function applyMaskedEditToDocument({
  candidateId,
  document,
  assetStore,
  staging,
  records,
  options,
  renderer,
}: {
  candidateId: string;
  document: Document;
  assetStore: AssetStore;
  staging: StagedAssetRepository;
  records: Map<string, GenerationRecord>;
  options: ApplyMaskedEditOptions;
  renderer?: DocumentRenderer;
}): Promise<RasterLayer> {
  const candidate = staging.getCandidate(candidateId);
  if (!candidate) throw new Error("Staged candidate not found.");
  const verified = staging.verifyProtection(
    candidateId,
    options.referenceBuffer
      ? {
          referenceBuffer: options.referenceBuffer,
          width: candidate.width,
          height: candidate.height,
          protectedMask: options.protectedMask,
          protectedRegions: options.protectedRegions,
          editMask: options.editMask,
          featherRadius: options.featherRadius,
          tolerance: options.tolerance ?? 0,
        }
      : undefined,
  );
  if (!verified)
    throw new Error(
      "Masked edits require a reference and host pixel verification before applying.",
    );

  return applyCandidateToDocument({
    candidateId,
    document,
    assetStore,
    staging,
    records,
    renderer,
    options: {
      x: options.x ?? 0,
      y: options.y ?? 0,
      ...options,
    },
  });
}
