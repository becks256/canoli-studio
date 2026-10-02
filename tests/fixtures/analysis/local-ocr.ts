/** TEST SIMULATOR ONLY: produces synthetic outputs, not image recognition or a cloud service. */
import type {
  AnalysisImageInput,
  OcrAdapter,
  OcrAnalysisResult,
  OcrBlock,
  OcrOptions,
} from "../../../src/intelligence/adapters/types";

/**
 * Local deterministic OCR engine.
 * Runs completely client-side with 0 download cost, zero data egress, and offline execution.
 * Sanitizes all output to ensure extracted text is treated as inert content, never code or instructions.
 */
export class LocalOcrAdapter implements OcrAdapter {
  readonly id = "local-ocr-deterministic";
  readonly name = "Local Deterministic OCR";
  readonly version = "1.0.0";
  readonly executionMode = "local" as const;
  readonly modalities = ["ocr" as const];

  readonly resourceProfile = {
    downloadBytes: 0,
    memoryBytes: 1024 * 1024, // 1 MB
    latencyMs: 12,
    requiresGpu: false,
  };

  readonly license = {
    spdx: "Apache-2.0",
    commercialSafe: true,
    copyleftRisk: false,
    summary: "Permissive local rule-based text region detection",
  };

  readonly privacy = {
    localOnly: true,
    stripsExif: true,
    dataRetentionPolicy: "none" as const,
    thirdPartySharing: false,
  };

  async analyzeOcr(
    input: AnalysisImageInput,
    options: OcrOptions = {},
  ): Promise<OcrAnalysisResult> {
    const start = performance.now();
    const blocks: OcrBlock[] = [];
    const width = Math.max(1, Math.round(input.width));
    const height = Math.max(1, Math.round(input.height));

    // When pixel buffer is provided, detect text regions via horizontal/vertical projection
    if (input.buffer && input.buffer.length >= width * height * 4) {
      const detected = this.detectTextFromPixels(
        input.buffer,
        width,
        height,
        options,
      );
      blocks.push(...detected);
    } else {
      // Heuristic text region detection from image dimensions and metadata hints
      const defaultBlockHeight = Math.max(
        16,
        Math.min(48, Math.round(height * 0.08)),
      );
      const defaultBlockWidth = Math.max(
        64,
        Math.min(width - 32, Math.round(width * 0.6)),
      );
      const x = Math.max(8, Math.round((width - defaultBlockWidth) / 2));
      const y = Math.max(8, Math.round(height * 0.15));

      const detectedText = input.name
        ? this.sanitizeText(
            input.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
          )
        : "Document Heading";

      blocks.push({
        id: `ocr-block-1`,
        text: detectedText,
        confidence: 0.94,
        bounds: {
          x,
          y,
          width: defaultBlockWidth,
          height: defaultBlockHeight,
        },
        language: options.language || "en",
      });
    }

    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    const fullText = blocks.map((b) => b.text).join("\n");

    return {
      adapterId: this.id,
      executionMode: this.executionMode,
      blocks,
      fullText,
      durationMs: Math.max(1, durationMs),
    };
  }

  private detectTextFromPixels(
    pixels: Uint8Array,
    width: number,
    height: number,
    options: OcrOptions,
  ): OcrBlock[] {
    const blocks: OcrBlock[] = [];
    // Compute row luminance profile to find text lines
    const rowDensity = new Float32Array(height);
    const rowStep = Math.max(1, Math.floor(height / 200));
    const colStep = Math.max(1, Math.floor(width / 200));

    for (let y = 0; y < height; y += rowStep) {
      let highContrastTransitions = 0;
      let prevLum = 0;
      for (let x = 0; x < width; x += colStep) {
        const idx = (y * width + x) * 4;
        const lum =
          (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) /
          1000;
        if (x > 0 && Math.abs(lum - prevLum) > 40) {
          highContrastTransitions++;
        }
        prevLum = lum;
      }
      rowDensity[y] = highContrastTransitions / (width / colStep);
    }

    // Segment active bands
    let inBand = false;
    let bandStart = 0;
    const bands: { start: number; end: number }[] = [];

    for (let y = 0; y < height; y++) {
      const active = rowDensity[y] > 0.15;
      if (active && !inBand) {
        inBand = true;
        bandStart = y;
      } else if (!active && inBand) {
        inBand = false;
        if (y - bandStart >= 8) {
          bands.push({ start: bandStart, end: y });
        }
      }
    }
    if (inBand && height - bandStart >= 8) {
      bands.push({ start: bandStart, end: height });
    }

    if (bands.length > 0) {
      bands.slice(0, 5).forEach((band, idx) => {
        const bHeight = band.end - band.start;
        const bWidth = Math.min(
          width - 16,
          Math.max(64, Math.round(width * 0.75)),
        );
        const bX = Math.round((width - bWidth) / 2);
        blocks.push({
          id: `ocr-block-${idx + 1}`,
          text: `Detected Text Line ${idx + 1}`,
          confidence: 0.88,
          bounds: {
            x: Math.max(0, bX),
            y: Math.max(0, band.start),
            width: bWidth,
            height: bHeight,
          },
          language: options.language || "en",
        });
      });
    }

    return blocks;
  }

  private sanitizeText(raw: string): string {
    // Strip control characters, keep printable text inert
    return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
  }
}
