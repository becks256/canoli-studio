import { HELD_OUT_SEGMENTATION_FIXTURES } from "../../../tests/fixtures/analysis/fixtures";
import { LocalSegmentationAdapter } from "../adapters/local-segmenter";
import { computeBoxIou } from "./metrics";

/** Synthetic regression measurements only. This does not satisfy the T09 held-out gate. */
export async function runHeldOutBenchmark() {
  const adapter = new LocalSegmentationAdapter();
  const samples: { id: string; boxIou: number; latencyMs: number }[] = [];
  for (const fixture of HELD_OUT_SEGMENTATION_FIXTURES) {
    if (!fixture.pixelGenerator) continue;
    const result = await adapter.analyzeSegmentation({
      width: fixture.width,
      height: fixture.height,
      buffer: fixture.pixelGenerator(fixture.width, fixture.height),
    });
    samples.push({
      id: fixture.id,
      boxIou: result.candidates[0]
        ? computeBoxIou(fixture.groundTruthBounds, result.candidates[0].bounds)
        : 0,
      latencyMs: result.durationMs,
    });
  }
  return {
    status: "incomplete" as const,
    corpus: "synthetic-regression" as const,
    timestamp: new Date().toISOString(),
    totalFixtures: samples.length,
    results: [
      {
        adapterId: adapter.id,
        modality: "segmentation" as const,
        executionMode: "local" as const,
        samples,
      },
    ],
    unmeasured: [
      "OCR quality",
      "semantic tagging quality",
      "remote quality and latency",
      "held-out real-image quality",
      "human correction time",
      "peak memory",
      "third-party model licenses and retention policies",
    ],
  };
}
