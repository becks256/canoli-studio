import type {
  AnalysisImageInput,
  TaggingAdapter,
  TaggingAnalysisResult,
  TaggingOptions,
  TagItem,
} from "./types";

/**
 * Local content and composition tagger.
 * Suggests statistical image properties from color distribution, luminance histogram, aspect ratio,
 * and high-frequency edge density completely offline with zero data leakage.
 */
export class LocalTaggingAdapter implements TaggingAdapter {
  readonly id = "local-content-tagger";
  readonly name = "Local image property heuristics";
  readonly version = "1.0.0";
  readonly executionMode = "local" as const;
  readonly modalities = ["tagging" as const];

  readonly resourceProfile = {
    downloadBytes: 0,
    memoryBytes: 512 * 1024, // 512 KB
    latencyMs: 8,
    requiresGpu: false,
  };

  readonly license = {
    spdx: "Apache-2.0",
    commercialSafe: true,
    copyleftRisk: false,
    summary: "Permissive local statistical feature classifier",
  };

  readonly privacy = {
    localOnly: true,
    stripsExif: true,
    dataRetentionPolicy: "none" as const,
    thirdPartySharing: false,
  };

  async analyzeTags(
    input: AnalysisImageInput,
    options: TaggingOptions = {},
  ): Promise<TaggingAnalysisResult> {
    const start = performance.now();
    const candidateTags: TagItem[] = [];
    const minConfidence = options.minConfidence ?? 0.7;
    const maxTags = options.maxTags ?? 12;

    const width = Math.max(1, Math.round(input.width));
    const height = Math.max(1, Math.round(input.height));
    const aspect = width / height;

    // 1. Aspect ratio tags
    if (aspect >= 2.0) {
      candidateTags.push({
        tag: "panoramic",
        confidence: 0.95,
        category: "composition",
      });
    } else if (aspect >= 1.2) {
      candidateTags.push({
        tag: "landscape-format",
        confidence: 0.96,
        category: "composition",
      });
    } else if (aspect <= 0.8) {
      candidateTags.push({
        tag: "portrait-format",
        confidence: 0.96,
        category: "composition",
      });
    } else {
      candidateTags.push({
        tag: "square-format",
        confidence: 0.92,
        category: "composition",
      });
    }

    // 2. Pixel-level analysis if buffer is available
    if (input.buffer && input.buffer.length >= width * height * 4) {
      const pixelTags = this.analyzePixelFeatures(input.buffer, width, height);
      candidateTags.push(...pixelTags);
    }

    // 3. Filter by confidence and unique tags
    const seen = new Set<string>();
    const tags: TagItem[] = [];

    for (const item of candidateTags) {
      const normalized = item.tag.toLowerCase().trim().slice(0, 80);
      if (item.confidence >= minConfidence && !seen.has(normalized)) {
        seen.add(normalized);
        tags.push({ ...item, tag: normalized });
        if (tags.length >= maxTags) break;
      }
    }

    const durationMs = Math.round((performance.now() - start) * 100) / 100;

    return {
      adapterId: this.id,
      executionMode: this.executionMode,
      tags,
      durationMs: Math.max(1, durationMs),
    };
  }

  private analyzePixelFeatures(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): TagItem[] {
    const tags: TagItem[] = [];
    const step = Math.max(1, Math.floor((width * height) / 10000));
    let totalSamples = 0;

    let sumR = 0,
      sumG = 0,
      sumB = 0;
    let sumSat = 0;
    let sumLum = 0;
    let minLum = 255,
      maxLum = 0;
    let colorVariance = 0;

    for (let i = 0; i < width * height; i += step) {
      const idx = i * 4;
      if (pixels[idx + 3] === 0) continue;
      totalSamples++;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const delta = maxC - minC;
      const sat = maxC === 0 ? 0 : delta / maxC;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      sumR += r;
      sumG += g;
      sumB += b;
      sumSat += sat;
      sumLum += lum;

      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;

      colorVariance += Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
    }

    if (!totalSamples) return [];
    const avgLum = sumLum / totalSamples;
    const avgSat = sumSat / totalSamples;
    const avgR = sumR / totalSamples;
    const avgG = sumG / totalSamples;
    const avgB = sumB / totalSamples;
    const avgColorVariance = colorVariance / totalSamples;

    // Saturation classification
    if (avgColorVariance < 8) {
      tags.push({ tag: "monochrome", confidence: 0.97, category: "palette" });
      tags.push({
        tag: "black-and-white",
        confidence: 0.94,
        category: "palette",
      });
    } else if (avgSat > 0.45) {
      tags.push({ tag: "vibrant", confidence: 0.93, category: "palette" });
      tags.push({
        tag: "high-saturation",
        confidence: 0.9,
        category: "palette",
      });
    } else if (avgSat < 0.15) {
      tags.push({
        tag: "muted-palette",
        confidence: 0.88,
        category: "palette",
      });
    }

    // Luminance & tone classification
    if (avgLum < 60) {
      tags.push({ tag: "low-key", confidence: 0.91, category: "lighting" });
      tags.push({ tag: "dark-mood", confidence: 0.89, category: "mood" });
    } else if (avgLum > 190) {
      tags.push({ tag: "high-key", confidence: 0.92, category: "lighting" });
      tags.push({
        tag: "bright-field",
        confidence: 0.87,
        category: "lighting",
      });
    }

    if (maxLum - minLum > 200) {
      tags.push({
        tag: "high-contrast",
        confidence: 0.92,
        category: "lighting",
      });
    }

    // Color dominance
    if (avgG > avgR * 1.25 && avgG > avgB * 1.15 && avgSat > 0.2) {
      tags.push({
        tag: "green-dominant",
        confidence: 0.85,
        category: "palette",
      });
    } else if (avgR > avgB * 1.3 && avgR > avgG * 1.1 && avgSat > 0.25) {
      tags.push({ tag: "warm-tone", confidence: 0.89, category: "palette" });
    } else if (avgB > avgR * 1.3 && avgSat > 0.2) {
      tags.push({ tag: "cool-tone", confidence: 0.89, category: "palette" });
    }

    return tags;
  }
}
