import { rgbaThumbnail } from "./thumbnail";
/**
 * Staged Asset Repository.
 *
 * Manages transient candidate assets produced by AI inference in an isolated
 * staging shelf outside of the document snapshot and IndexedDB undo history.
 * Candidates can be previewed, accepted (promoted into AssetStore atomically),
 * rejected, or safely garbage-collected.
 */

import { id } from "../../core/model";
import type { AssetStore, ImageAsset } from "../../core/assets";
import { encodeRgbaPng } from "../../engine/png";
import { evaluateProtectedRegionInvariant } from "../diff/engine";
import type { ProtectedInvariantEvaluationOptions } from "../diff/types";
import type {
  GenerationCandidateResult,
  GenerationRequest,
} from "../providers/types";
import type {
  CandidateReviewState,
  CandidateValidation,
  GenerationCandidate,
} from "./types";

export class StagedAssetRepository {
  private candidates = new Map<string, GenerationCandidate>();
  private protection = new Map<
    string,
    Omit<ProtectedInvariantEvaluationOptions, "candidateBuffer">
  >();

  /** Re-evaluate actual pixels; provider reports are never verification evidence. */
  verifyProtection(
    candidateId: string,
    context?: Omit<ProtectedInvariantEvaluationOptions, "candidateBuffer">,
  ): boolean {
    const candidate = this.candidates.get(candidateId);
    if (!candidate)
      throw new Error("Candidate not found for protected verification.");
    const basis = context ?? this.protection.get(candidateId);
    if (!basis) return false;
    if (
      basis.width !== candidate.width ||
      basis.height !== candidate.height ||
      basis.referenceBuffer.length !== candidate.width * candidate.height * 4
    ) {
      throw new Error(
        "Protected reference dimensions must match the candidate exactly.",
      );
    }
    for (const mask of [basis.protectedMask, basis.editMask]) {
      if (mask && mask.length !== candidate.width * candidate.height)
        throw new Error(
          "Protected edit mask dimensions must match the candidate exactly.",
        );
    }
    let pixels = candidate.rawBuffer;
    if (!pixels) {
      if (typeof OffscreenCanvas === "undefined")
        throw new Error(
          "Cannot decode candidate pixels for protected verification.",
        );
      const canvas = new OffscreenCanvas(candidate.width, candidate.height);
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx)
          throw new Error(
            "Cannot read candidate pixels for protected verification.",
          );
        ctx.drawImage(candidate.asset.bitmap, 0, 0);
        pixels = new Uint8Array(
          ctx.getImageData(0, 0, candidate.width, candidate.height).data.buffer,
        );
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    candidate.diffReport = evaluateProtectedRegionInvariant({
      ...basis,
      candidateBuffer: pixels,
    });
    candidate.compositePreview = undefined;
    if (context) this.protection.set(candidateId, structuredClone(context));
    return true;
  }

  /** Bounded display preview of this candidate's immutable captured reference. */
  getReferenceThumbnail(candidateId: string): string | undefined {
    const reference = this.protection.get(candidateId);
    if (!reference || typeof document === "undefined") return undefined;
    return rgbaThumbnail(
      reference.referenceBuffer,
      reference.width,
      reference.height,
    );
  }

  /** Host-owned reference for final composite verification. Callers receive a copy. */
  getProtectionContext(
    candidateId: string,
  ): Omit<ProtectedInvariantEvaluationOptions, "candidateBuffer"> | undefined {
    const context = this.protection.get(candidateId);
    return context ? structuredClone(context) : undefined;
  }

  /**
   * Validates and stages an AI-generated candidate result into the staging shelf.
   */
  async stageCandidate(
    jobId: string,
    result: GenerationCandidateResult,
    request: GenerationRequest,
  ): Promise<GenerationCandidate> {
    request = structuredClone(request);
    const candidateId = result.id || id();
    const errors: string[] = [];

    // 1. Basic payload checks
    if (!result.imageData || result.imageData.byteLength === 0) {
      errors.push("Generation result image buffer is empty.");
    }
    if (
      !Number.isSafeInteger(result.width) ||
      !Number.isSafeInteger(result.height) ||
      result.width <= 0 ||
      result.height <= 0 ||
      !Number.isSafeInteger(result.width * result.height * 4)
    ) {
      errors.push(
        `Invalid image dimensions returned: ${result.width}x${result.height}`,
      );
    }

    if (
      result.width !== request.targetWidth ||
      result.height !== request.targetHeight
    ) {
      errors.push(
        `Returned dimensions (${result.width}×${result.height}) do not match requested dimensions (${request.targetWidth}×${request.targetHeight}).`,
      );
    }

    // 2. MIME type conformance
    const validMimes = ["image/png", "image/jpeg", "image/webp"];
    const mimeType = result.mimeType || "image/png";
    if (!validMimes.includes(mimeType)) {
      errors.push(`Unsupported generation result MIME type: "${mimeType}"`);
    }

    // 3. Byte-level format signature and payload validation
    const bytes = result.imageData || new Uint8Array(0);
    const rawBuffer: ArrayBuffer = result.imageData
      ? (result.imageData.buffer.slice(
          result.imageData.byteOffset,
          result.imageData.byteOffset + result.imageData.byteLength,
        ) as ArrayBuffer)
      : new ArrayBuffer(0);

    const isPng =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    const isJpeg =
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    const isWebp =
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    const isRawRgba =
      !isPng &&
      !isJpeg &&
      !isWebp &&
      bytes.byteLength === result.width * result.height * 4 &&
      errors.length === 0;

    if (mimeType === "image/png") {
      if (!isPng && !isRawRgba) {
        errors.push(
          "Invalid PNG payload: missing PNG signature (89 50 4E 47 0D 0A 1A 0A) or buffer truncated.",
        );
      } else if (isPng && bytes.length < 24) {
        errors.push("Invalid PNG payload: truncated PNG header (< 24 bytes).");
      } else if (isPng && bytes.length >= 24) {
        // Validate IHDR chunk and header dimensions
        const isIhdr =
          bytes[12] === 0x49 &&
          bytes[13] === 0x48 &&
          bytes[14] === 0x44 &&
          bytes[15] === 0x52;
        if (isIhdr) {
          const pngWidth =
            ((bytes[16] << 24) |
              (bytes[17] << 16) |
              (bytes[18] << 8) |
              bytes[19]) >>>
            0;
          const pngHeight =
            ((bytes[20] << 24) |
              (bytes[21] << 16) |
              (bytes[22] << 8) |
              bytes[23]) >>>
            0;
          if (pngWidth !== result.width || pngHeight !== result.height) {
            errors.push(
              `PNG header dimensions (${pngWidth}x${pngHeight}) do not match result metadata (${result.width}x${result.height}).`,
            );
          }
        }
      }
    } else if (mimeType === "image/jpeg") {
      if (!isJpeg && !isRawRgba) {
        errors.push(
          "Invalid JPEG payload: missing JPEG SOI marker (FF D8 FF).",
        );
      }
    } else if (mimeType === "image/webp") {
      if (!isWebp && !isRawRgba) {
        errors.push("Invalid WebP payload: missing RIFF/WEBP signature.");
      }
    }

    if (!isPng && !isJpeg && !isWebp && !isRawRgba && bytes.length > 0) {
      errors.push(
        "Unrecognized image data format: buffer does not match declared MIME type or raw RGBA dimensions.",
      );
    }

    // 4. Alpha channel verification if transparency requested
    let verifiedAlpha = false;
    if (isRawRgba) {
      let hasTransparentPixels = false;
      const totalPixels = result.width * result.height;
      for (let i = 0; i < totalPixels; i++) {
        if (bytes[i * 4 + 3] < 255) {
          hasTransparentPixels = true;
          break;
        }
      }
      verifiedAlpha = hasTransparentPixels;
    }

    if (isRawRgba && request.requireAlpha && !verifiedAlpha) {
      errors.push(
        "Requested alpha transparency, but candidate output is completely opaque.",
      );
    }

    // 5. Target dimension conformance check
    if (request.targetWidth > 0 && request.targetHeight > 0) {
      const targetAspect = request.targetWidth / request.targetHeight;
      const actualAspect = result.width / result.height;
      const aspectError = Math.abs(actualAspect - targetAspect) / targetAspect;
      if (aspectError > 0.15) {
        errors.push(
          `Candidate aspect ratio (${actualAspect.toFixed(2)}) deviates significantly from requested (${targetAspect.toFixed(2)})`,
        );
      }
    }

    // 6. Construct Blob and decode bitmap with strict error handling
    let blob: Blob;
    if (isRawRgba) {
      blob = await encodeRgbaPng(bytes, result.width, result.height);
    } else {
      blob = new Blob([rawBuffer], { type: mimeType });
    }

    let bitmap: ImageBitmap | undefined;
    let decodedWidth = 0;
    let decodedHeight = 0;

    if (typeof createImageBitmap !== "undefined") {
      try {
        if (isRawRgba && typeof ImageData !== "undefined") {
          const imgData = new ImageData(
            new Uint8ClampedArray(rawBuffer),
            result.width,
            result.height,
          );
          bitmap = await createImageBitmap(imgData);
        } else {
          bitmap = await createImageBitmap(blob);
        }
        decodedWidth = bitmap.width;
        decodedHeight = bitmap.height;
        if (decodedWidth !== result.width || decodedHeight !== result.height) {
          errors.push(
            `Decoded image dimensions (${decodedWidth}x${decodedHeight}) do not match claimed result dimensions (${result.width}x${result.height}).`,
          );
        }
      } catch (decodeErr: unknown) {
        const msg =
          decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
        errors.push(`Failed to decode candidate image: ${msg}`);
      }
    } else {
      // Raw RGBA can be validated without a decoder; encoded bytes cannot.
      if (!isRawRgba)
        errors.push(
          "An image decoder is required to validate encoded candidates.",
        );
      if (errors.length === 0) {
        decodedWidth = result.width;
        decodedHeight = result.height;
        bitmap = {
          width: result.width,
          height: result.height,
          close: () => {},
        } as unknown as ImageBitmap;
      }
    }

    if (bitmap && !isRawRgba && errors.length === 0) {
      try {
        const canvas =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(
                Math.min(1024, bitmap.width),
                Math.min(1024, bitmap.height),
              )
            : document.createElement("canvas");
        canvas.width = Math.min(1024, bitmap.width);
        canvas.height = Math.min(1024, bitmap.height);
        try {
          const ctx = canvas.getContext("2d") as
            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!ctx) throw new Error("Cannot read decoded alpha channel.");
          outer: for (let y = 0; y < bitmap.height; y += canvas.height) {
            for (let x = 0; x < bitmap.width; x += canvas.width) {
              const w = Math.min(canvas.width, bitmap.width - x);
              const h = Math.min(canvas.height, bitmap.height - y);
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(bitmap, -x, -y);
              const pixels = ctx.getImageData(0, 0, w, h).data;
              for (let i = 3; i < pixels.length; i += 4) {
                if (pixels[i] < 255) {
                  verifiedAlpha = true;
                  break outer;
                }
              }
            }
          }
        } finally {
          canvas.width = canvas.height = 0;
        }
        if (request.requireAlpha && !verifiedAlpha)
          errors.push(
            "Requested alpha transparency, but decoded output is completely opaque.",
          );
      } catch (error) {
        errors.push(`Failed to verify decoded alpha: ${String(error)}`);
      }
    }

    if (!bitmap) {
      bitmap = {
        width: decodedWidth,
        height: decodedHeight,
        close: () => {},
      } as unknown as ImageBitmap;
    }

    const validation: CandidateValidation = {
      valid: errors.length === 0,
      errors,
      decodedWidth: decodedWidth || (errors.length === 0 ? result.width : 0),
      decodedHeight: decodedHeight || (errors.length === 0 ? result.height : 0),
      hasAlpha: verifiedAlpha,
      byteLength: result.imageData ? result.imageData.byteLength : 0,
      mimeType,
    };

    let thumbnail = "data:image/png;base64,";
    if (
      typeof document !== "undefined" &&
      typeof document.createElement === "function"
    ) {
      try {
        const canvas = document.createElement("canvas");
        const factor = Math.min(1, 96 / bitmap.width, 96 / bitmap.height);
        canvas.width = Math.max(1, Math.round(bitmap.width * factor));
        canvas.height = Math.max(1, Math.round(bitmap.height * factor));
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          thumbnail = canvas.toDataURL();
        }
        canvas.width = canvas.height = 0;
      } catch {
        // Thumbnail generation fallback
      }
    }

    const asset: ImageAsset = {
      id: candidateId,
      name: `Candidate-${candidateId.slice(0, 8)}`,
      width: result.width,
      height: result.height,
      blob,
      bitmap,
      thumbnail,
    };

    const candidate: GenerationCandidate = {
      id: candidateId,
      jobId,
      asset,
      width: result.width,
      height: result.height,
      hasAlpha: verifiedAlpha,
      validation,
      reviewState: "staged",
      createdAt: new Date().toISOString(),
      revisedPrompt: result.revisedPrompt,
      warnings: result.warnings,
      diffReport: undefined,
      rawBuffer: isRawRgba ? new Uint8Array(rawBuffer) : undefined,
    };

    this.candidates.set(candidateId, candidate);
    if (request.modality === "masked-edit") {
      try {
        const reference = request.referenceImage;
        if (
          !reference ||
          reference.width !== result.width ||
          reference.height !== result.height
        ) {
          throw new Error(
            "Masked edits require a reference matching candidate dimensions.",
          );
        }
        for (const mask of [request.mask, request.protectedMask]) {
          if (
            mask &&
            (mask.width !== result.width || mask.height !== result.height)
          )
            throw new Error(
              "Masked edit coverage dimensions must match the candidate.",
            );
        }
        this.protection.set(
          candidateId,
          structuredClone({
            referenceBuffer: reference.data,
            width: result.width,
            height: result.height,
            protectedMask: request.protectedMask?.coverage,
            protectedRegions: request.protectedRegions,
            editMask: request.mask?.coverage,
            featherRadius: request.featherRadius,
            tolerance: 0,
          }),
        );
        if (candidate.validation.valid) this.verifyProtection(candidateId);
      } catch (error) {
        candidate.validation.valid = false;
        candidate.validation.errors.push(
          `Protected verification failed: ${String(error)}`,
        );
      }
    }
    return candidate;
  }

  getCandidate(candidateId: string): GenerationCandidate | undefined {
    return this.candidates.get(candidateId);
  }

  listCandidates(jobId?: string): GenerationCandidate[] {
    const all = Array.from(this.candidates.values());
    return jobId ? all.filter((c) => c.jobId === jobId) : all;
  }

  setReviewState(candidateId: string, state: CandidateReviewState): void {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      throw new Error(`Staged candidate "${candidateId}" not found.`);
    }
    candidate.reviewState = state;
  }

  /**
   * Promotes a staged candidate asset into the permanent project AssetStore.
   * Marks the candidate review state as "accepted".
   */
  async promote(
    candidateId: string,
    assetStore: AssetStore,
    name?: string,
  ): Promise<ImageAsset> {
    const assertLifetime = assetStore.captureLifetime();
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      throw new Error(
        `Staged candidate "${candidateId}" not found for promotion.`,
      );
    }

    if (!candidate.validation.valid) {
      throw new Error(
        `Cannot promote invalid candidate "${candidateId}": ${candidate.validation.errors.join("; ")}`,
      );
    }

    const assetName = name || candidate.asset.name;
    // Staging retains its own bitmap for review/retry. Project rollback or
    // disposal must not close that bitmap (and shelf disposal must not close ours).
    const bitmap =
      typeof createImageBitmap !== "undefined"
        ? await createImageBitmap(candidate.asset.bitmap)
        : ({ ...candidate.asset.bitmap, close: () => {} } as ImageBitmap);
    const promotedAsset: ImageAsset = {
      ...candidate.asset,
      id: id(),
      bitmap,
      name: assetName.slice(0, 240),
    };

    // Use install on the permanent asset store
    try {
      assertLifetime();
      if (
        this.candidates.get(candidateId) !== candidate ||
        candidate.reviewState === "discarded"
      ) {
        throw new Error("Candidate was discarded while preparing placement.");
      }
      assetStore.install(promotedAsset, true);
    } catch (error) {
      bitmap.close();
      throw error;
    }
    candidate.reviewState = "accepted";
    return promotedAsset;
  }

  /**
   * Explicitly discards a candidate, closing its bitmap and removing it from memory.
   */
  discard(candidateId: string): void {
    const candidate = this.candidates.get(candidateId);
    if (candidate) {
      candidate.reviewState = "discarded";
      try {
        candidate.asset.bitmap.close();
      } catch {
        // Bitmap might already be closed
      }
      this.candidates.delete(candidateId);
      this.protection.delete(candidateId);
    }
  }

  /**
   * Safely collects abandoned or rejected candidates older than the specified threshold.
   * Returns the count of reclaimed candidates.
   */
  collectAbandoned(olderThanMs: number = 3600000): number {
    const now = Date.now();
    let collected = 0;
    for (const [id, candidate] of this.candidates.entries()) {
      if (candidate.reviewState !== "accepted") {
        const age = now - new Date(candidate.createdAt).getTime();
        if (age > olderThanMs) {
          this.discard(id);
          collected++;
        }
      }
    }
    return collected;
  }

  /**
   * Disposes of all staged candidate assets.
   */
  dispose(): void {
    for (const candidate of this.candidates.values()) {
      try {
        candidate.asset.bitmap.close();
      } catch {
        // Ignore close error on disposal
      }
    }
    this.candidates.clear();
    this.protection.clear();
  }
}
