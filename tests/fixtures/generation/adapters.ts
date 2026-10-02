/** Test-only procedural simulators. No model inference or provider measurements. */
import {
  FLUX1_PRO_PROFILE,
  LOCAL_DIFFUSION_BASELINE_PROFILE,
  SD35_LARGE_PROFILE,
} from "./profiles";
import type {
  AiProviderAdapter,
  GenerationCandidateResult,
  GenerationRequest,
  HumanApprovedBudget,
  ProviderCapabilities,
} from "../../../src/ai/providers/types";
import {
  BudgetExceededError,
  ConsentRequiredError,
  JobCancelledError,
} from "../../../src/ai/jobs/types";
import {
  compositeProtectedEdit,
  evaluateProtectedRegionInvariant,
  rasterizeProtectedRegions,
} from "../../../src/ai/diff";

/**
 * Generates an RGBA pixel buffer based on prompt, seed, dimensions, and alpha requirements.
 */
function synthesizePixels(
  width: number,
  height: number,
  requireAlpha: boolean,
  prompt: string,
  seed: number = 42,
): { data: Uint8Array; hasAlpha: boolean } {
  const pixelCount = width * height;
  const data = new Uint8Array(pixelCount * 4);

  // Hash prompt string to determine base hue/color components
  let hash = seed;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) - hash + prompt.charCodeAt(i)) | 0;
  }
  const baseR = (Math.abs(hash) % 200) + 30;
  const baseG = (Math.abs(hash >> 8) % 200) + 30;
  const baseB = (Math.abs(hash >> 16) % 200) + 30;

  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = width * 0.38;
  const radiusY = height * 0.38;

  let hasTransparentPixels = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      if (requireAlpha) {
        // Compute normalized distance from center for an oval cutout
        const dx = (x - centerX) / radiusX;
        const dy = (y - centerY) / radiusY;
        const distSq = dx * dx + dy * dy;

        if (distSq <= 1.0) {
          // Inside subject
          // Edge antialiasing in the 0.95 - 1.0 boundary
          let alpha = 255;
          if (distSq > 0.9) {
            const t = (1.0 - distSq) / 0.1;
            alpha = Math.max(0, Math.min(255, Math.round(t * 255)));
            hasTransparentPixels = true;
          }
          data[idx] = Math.min(255, baseR + Math.round((x / width) * 40));
          data[idx + 1] = Math.min(255, baseG + Math.round((y / height) * 40));
          data[idx + 2] = Math.min(
            255,
            baseB + Math.round(((x + y) / (width + height)) * 50),
          );
          data[idx + 3] = alpha;
        } else {
          // Transparent background
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
          hasTransparentPixels = true;
        }
      } else {
        // Opaque composite / background / texture
        data[idx] = Math.min(255, baseR + Math.round((x / width) * 55));
        data[idx + 1] = Math.min(255, baseG + Math.round((y / height) * 55));
        data[idx + 2] = Math.min(
          255,
          baseB + Math.round(Math.sin((x + y) * 0.05) * 30),
        );
        data[idx + 3] = 255;
      }
    }
  }

  return { data, hasAlpha: requireAlpha && hasTransparentPixels };
}

/**
 * Base Evaluated Provider Adapter.
 */
export class EvaluatedProviderAdapter implements AiProviderAdapter {
  readonly capabilities: ProviderCapabilities;
  private latencyScale: number;

  constructor(capabilities: ProviderCapabilities, latencyScale: number = 0.01) {
    this.capabilities = capabilities;
    this.latencyScale = latencyScale;
  }

  async generate(
    request: GenerationRequest,
    budget: HumanApprovedBudget,
    signal?: AbortSignal,
  ): Promise<GenerationCandidateResult> {
    if (signal?.aborted) {
      throw new JobCancelledError(
        "Generation was cancelled before execution started.",
      );
    }

    // 1. Consent verification
    if (!budget.consentGiven) {
      throw new ConsentRequiredError(
        "Explicit human consent required before generation.",
      );
    }

    // 2. Modality verification
    if (!this.capabilities.modalities.includes(request.modality)) {
      throw new Error(
        `Provider "${this.capabilities.id}" does not support modality "${request.modality}".`,
      );
    }

    // 3. Dimension conformance
    const width = request.targetWidth;
    const height = request.targetHeight;
    const dims = this.capabilities.dimensions;

    if (
      width < dims.minWidth ||
      width > dims.maxWidth ||
      height < dims.minHeight ||
      height > dims.maxHeight
    ) {
      throw new Error(
        `Requested dimensions (${width}x${height}) exceed provider bounds [${dims.minWidth}..${dims.maxWidth}] x [${dims.minHeight}..${dims.maxHeight}].`,
      );
    }

    // 4. Calculate cost
    const isHd = request.qualityTier === "hd";
    let baseCostCents =
      (isHd
        ? this.capabilities.pricing.costPerHdImageCents
        : this.capabilities.pricing.costPerStandardImageCents) ??
      this.capabilities.pricing.costPerStandardImageCents ??
      0;

    if (
      request.requireAlpha &&
      this.capabilities.alpha === "post-process-matting-required"
    ) {
      baseCostCents += this.capabilities.pricing.secondaryMattingCostCents ?? 0;
    }
    const costCents = Math.round(baseCostCents * 100) / 100;

    // 5. Budget ceiling verification
    const remainingCeiling =
      Math.round((budget.approvedCeilingCents - budget.spentSoFarCents) * 100) /
      100;
    if (costCents > remainingCeiling) {
      throw new BudgetExceededError(
        `Generation cost (${costCents}¢) exceeds remaining approved budget ceiling (${remainingCeiling}¢).`,
      );
    }

    // 6. Simulate async generation with cooperative cancellation
    const startTime = Date.now();
    const simulatedLatencyMs = Math.max(
      10,
      Math.round(this.capabilities.latency.p50Ms * this.latencyScale),
    );

    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | null = null;
      const timer = setTimeout(() => {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        resolve();
      }, simulatedLatencyMs);
      if (signal) {
        onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort!);
          reject(
            new JobCancelledError("Generation cancelled during execution."),
          );
        };
        signal.addEventListener("abort", onAbort);
      }
    });

    if (signal?.aborted) {
      throw new JobCancelledError("Generation cancelled after execution.");
    }

    // 7. Synthesize pixels
    const seed = request.seed ?? Math.floor(Math.random() * 1000000);
    const synth = synthesizePixels(
      width,
      height,
      !!request.requireAlpha,
      request.prompt,
      seed,
    );
    let candidateData = synth.data;
    let hasAlpha = synth.hasAlpha;
    const warnings: string[] = [];
    let diffReport = undefined;

    // Handle masked-edit localized inpainting with compositing guard & verification
    if (request.modality === "masked-edit" && request.referenceImage) {
      const refData = request.referenceImage.data;
      const editMask = request.mask?.coverage;
      const protectedMask = request.protectedMask?.coverage;
      const protectedRegions = request.protectedRegions;

      // Handle adversarial options for testing
      if (request.adversarialOptions?.leakIntoProtected) {
        // Compose generated content, but deliberately mutate protected pixels to simulate leaky model
        const safeComposite = compositeProtectedEdit({
          referenceBuffer: refData,
          candidateBuffer: candidateData,
          width,
          height,
          editMask,
          protectedMask,
          protectedRegions,
          featherRadius: request.featherRadius,
        });
        candidateData = safeComposite;
        const pMask =
          protectedMask ??
          (protectedRegions
            ? rasterizeProtectedRegions(protectedRegions, width, height)
            : null);
        const leakDelta = request.adversarialOptions.leakDelta ?? 50;
        if (pMask) {
          for (let i = 0; i < width * height; i++) {
            if (pMask[i] === 255) {
              const idx = i * 4;
              candidateData[idx] = (candidateData[idx] + leakDelta) % 256;
              break; // Alter at least one protected pixel
            }
          }
        }
      } else if (request.adversarialOptions?.modifyOutsideMask) {
        // Deliberately alter a pixel outside the edit mask
        const safeComposite = compositeProtectedEdit({
          referenceBuffer: refData,
          candidateBuffer: candidateData,
          width,
          height,
          editMask,
          protectedMask,
          protectedRegions,
          featherRadius: request.featherRadius,
        });
        candidateData = safeComposite;
        if (editMask) {
          for (let i = 0; i < width * height; i++) {
            if (editMask[i] === 0) {
              const idx = i * 4;
              candidateData[idx] = (candidateData[idx] + 60) % 256;
              break;
            }
          }
        }
      } else {
        // Standard safe compositing guard: strictly clamp generated edits to mask
        candidateData = compositeProtectedEdit({
          referenceBuffer: refData,
          candidateBuffer: candidateData,
          width,
          height,
          editMask,
          protectedMask,
          protectedRegions,
          featherRadius: request.featherRadius,
        });
      }

      // Check alpha status
      for (let i = 3; i < candidateData.length; i += 4) {
        if (candidateData[i] < 255) {
          hasAlpha = true;
          break;
        }
      }

      // Evaluate the protected invariant report
      diffReport = evaluateProtectedRegionInvariant({
        referenceBuffer: refData,
        candidateBuffer: candidateData,
        width,
        height,
        protectedMask,
        protectedRegions,
        editMask,
        featherRadius: request.featherRadius,
        tolerance: 0,
      });

      if (!diffReport.passed) {
        warnings.push(...diffReport.diagnosticErrors);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      id: `cand-${Math.random().toString(36).slice(2, 10)}`,
      providerId: this.capabilities.id,
      width,
      height,
      hasAlpha,
      imageData: candidateData,
      mimeType: "image/png",
      durationMs,
      costCents,
      revisedPrompt: request.prompt,
      warnings,
      diffReport,
    };
  }
}

/**
 * Evaluated FLUX.1 Pro Provider Adapter (Primary Recommended Provider).
 */
export class Flux1ProAdapter extends EvaluatedProviderAdapter {
  constructor(latencyScale: number = 0.01) {
    super(FLUX1_PRO_PROFILE, latencyScale);
  }
}

/**
 * Evaluated Stable Diffusion 3.5 Large Adapter.
 */
export class StableDiffusion35Adapter extends EvaluatedProviderAdapter {
  constructor(latencyScale: number = 0.01) {
    super(SD35_LARGE_PROFILE, latencyScale);
  }
}

/**
 * Evaluated Local On-Device Diffusion Adapter (Zero API cost).
 */
export class LocalDiffusionAdapter extends EvaluatedProviderAdapter {
  constructor(latencyScale: number = 0.01) {
    super(LOCAL_DIFFUSION_BASELINE_PROFILE, latencyScale);
  }
}

/**
 * Type alias explicitly identifying simulation test adapters.
 */
export const SimulatedProviderAdapter = EvaluatedProviderAdapter;

/**
 * Registers offline simulation test adapters into a ProviderRegistry.
 * Intended exclusively for test fixtures, bake-off harnesses, and CI environments.
 */
export function registerSimulationAdapters(registry: {
  registerAdapter(adapter: AiProviderAdapter): void;
}): void {
  registry.registerAdapter(new Flux1ProAdapter());
  registry.registerAdapter(new StableDiffusion35Adapter());
  registry.registerAdapter(new LocalDiffusionAdapter());
}
