/** TEST SIMULATOR ONLY: produces synthetic outputs, not image recognition or a cloud service. */
import { MarqueeSelection } from "../../../src/dom/values";
import type {
  AnalysisImageInput,
  OcrAdapter,
  OcrAnalysisResult,
  OcrBlock,
  OcrOptions,
  RemoteRequestOptions,
  SegmentationAdapter,
  SegmentationAnalysisResult,
  SegmentationMaskCandidate,
  SegmentationOptions,
  TaggingAdapter,
  TaggingAnalysisResult,
  TaggingOptions,
  TagItem,
} from "../../../src/intelligence/adapters/types";

/**
 * Remote cloud analysis adapter.
 * Enforces explicit privacy consent, EXIF stripping, spend ceilings, and timeout containment.
 * Includes offline evaluation mode for reproducible benchmarking without paid API credentials.
 */
export class RemoteAnalysisAdapter
  implements OcrAdapter, TaggingAdapter, SegmentationAdapter
{
  readonly id = "remote-cloud-adapter";
  readonly name = "Remote Cloud Analysis Service";
  readonly version = "1.0.0";
  readonly executionMode = "remote" as const;
  readonly modalities = [
    "ocr" as const,
    "tagging" as const,
    "segmentation" as const,
  ];

  readonly resourceProfile = {
    downloadBytes: 0,
    memoryBytes: 256 * 1024, // 256 KB client side
    latencyMs: 380,
    requiresGpu: false,
  };

  readonly license = {
    spdx: "Proprietary",
    commercialSafe: true,
    copyleftRisk: false,
    summary: "Commercial cloud service agreement with enterprise privacy SLA",
    termsUrl: "https://luma.internal/terms/cloud-analysis",
  };

  readonly privacy = {
    localOnly: false,
    stripsExif: true,
    dataRetentionPolicy: "stateless-ephemeral" as const,
    thirdPartySharing: false,
  };

  private simulatedDelayMs: number;

  constructor(simulatedDelayMs = 15) {
    this.simulatedDelayMs = simulatedDelayMs;
  }

  private validateRequest(
    options?: RemoteRequestOptions,
    estimatedCostCents = 2,
  ) {
    if (!options?.consentGiven) {
      throw new Error(
        "Cloud analysis requires explicit user consent before transmitting image data.",
      );
    }
    if (
      options.spendCeilingCents !== undefined &&
      estimatedCostCents > options.spendCeilingCents
    ) {
      throw new Error(
        `Estimated analysis cost (${estimatedCostCents}¢) exceeds user spend ceiling (${options.spendCeilingCents}¢).`,
      );
    }
    if (options.signal?.aborted) {
      throw new Error("Analysis request aborted by user.");
    }
  }

  async analyzeOcr(
    input: AnalysisImageInput,
    options?: OcrOptions & RemoteRequestOptions,
  ): Promise<OcrAnalysisResult> {
    this.validateRequest(options, 3);
    const start = performance.now();

    // Check timeout / abort
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.simulatedDelayMs);
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Analysis request aborted by user."));
          });
        }
      });
    }

    const width = Math.max(1, Math.round(input.width));
    const height = Math.max(1, Math.round(input.height));

    const text = input.name
      ? input.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ")
      : "Remote Analyzed Text";

    const blocks: OcrBlock[] = [
      {
        id: "remote-ocr-block-1",
        text,
        confidence: 0.98,
        bounds: {
          x: Math.round(width * 0.1),
          y: Math.round(height * 0.1),
          width: Math.round(width * 0.8),
          height: Math.round(height * 0.2),
        },
        language: options?.language || "en",
      },
    ];

    const durationMs = Math.round((performance.now() - start) * 100) / 100;

    return {
      adapterId: this.id,
      executionMode: this.executionMode,
      blocks,
      fullText: text,
      durationMs: Math.max(1, durationMs),
    };
  }

  async analyzeTags(
    input: AnalysisImageInput,
    options?: TaggingOptions & RemoteRequestOptions,
  ): Promise<TaggingAnalysisResult> {
    this.validateRequest(options, 2);
    const start = performance.now();

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.simulatedDelayMs),
      );
    }

    const tags: TagItem[] = [
      { tag: "commercial-asset", confidence: 0.96, category: "concept" },
      { tag: "studio-composition", confidence: 0.93, category: "composition" },
      { tag: "high-resolution", confidence: 0.95, category: "quality" },
    ];

    if (input.name) {
      const lower = input.name.toLowerCase();
      if (
        lower.includes("nature") ||
        lower.includes("plant") ||
        lower.includes("leaf") ||
        lower.includes("botanical")
      ) {
        tags.push({ tag: "botanical", confidence: 0.97, category: "subject" });
      }
      if (lower.includes("portrait") || lower.includes("person")) {
        tags.push({ tag: "portrait", confidence: 0.96, category: "subject" });
      }
    }

    const durationMs = Math.round((performance.now() - start) * 100) / 100;

    return {
      adapterId: this.id,
      executionMode: this.executionMode,
      tags: tags.slice(0, options?.maxTags ?? 10),
      durationMs: Math.max(1, durationMs),
    };
  }

  async analyzeSegmentation(
    input: AnalysisImageInput,
    options?: SegmentationOptions & RemoteRequestOptions,
  ): Promise<SegmentationAnalysisResult> {
    this.validateRequest(options, 5);
    const start = performance.now();

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.simulatedDelayMs),
      );
    }

    const width = Math.max(1, Math.round(input.width));
    const height = Math.max(1, Math.round(input.height));

    const bounds = {
      x: Math.round(width * 0.12),
      y: Math.round(height * 0.12),
      width: Math.round(width * 0.76),
      height: Math.round(height * 0.76),
    };

    const candidates: SegmentationMaskCandidate[] = [
      {
        id: "remote-seg-subject",
        label: "Remote Deep Subject Mask",
        confidence: 0.97,
        bounds,
        kind: "selection",
        selectionData: new MarqueeSelection({ ...bounds, shape: "rectangle" }),
      },
    ];

    const durationMs = Math.round((performance.now() - start) * 100) / 100;

    return {
      adapterId: this.id,
      executionMode: this.executionMode,
      candidates,
      durationMs: Math.max(1, durationMs),
    };
  }
}
