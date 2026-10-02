import { describe, expect, it } from "vitest";
import {
  computeBoxIou,
  computeCer,
  computeCorrectionBurden,
  computeLevenshteinDistance,
  computeMaskIou,
  computeTagMetrics,
  computeWer,
} from "../src/intelligence/evaluation/metrics";
import { runHeldOutBenchmark } from "../src/intelligence/evaluation/benchmark";

describe("Evaluation Metrics", () => {
  describe("computeLevenshteinDistance", () => {
    it("computes exact edit distance", () => {
      expect(computeLevenshteinDistance("", "")).toBe(0);
      expect(computeLevenshteinDistance("hello", "hello")).toBe(0);
      expect(computeLevenshteinDistance("kitten", "sitting")).toBe(3);
      expect(computeLevenshteinDistance("abc", "")).toBe(3);
      expect(computeLevenshteinDistance("", "abc")).toBe(3);
    });
  });

  describe("computeCer and computeWer", () => {
    it("computes character error rate", () => {
      expect(computeCer("LUMA", "LUMA")).toBe(0);
      expect(computeCer("LUMA", "LUMX")).toBe(0.25);
      expect(computeCer("LUMA", "XXXX")).toBe(1);
    });

    it("computes word error rate", () => {
      expect(computeWer("Creative Studio", "Creative Studio")).toBe(0);
      expect(computeWer("Creative Studio", "Creative Lab")).toBe(0.5);
      expect(computeWer("Creative Studio", "Nothing Matching")).toBe(1);
    });
  });

  describe("computeBoxIou", () => {
    it("computes intersection over union for rectangles", () => {
      const boxA = { x: 0, y: 0, width: 100, height: 100 };
      const boxB = { x: 0, y: 0, width: 100, height: 100 };
      expect(computeBoxIou(boxA, boxB)).toBe(1);

      const disjoint = { x: 200, y: 200, width: 50, height: 50 };
      expect(computeBoxIou(boxA, disjoint)).toBe(0);

      const halfOverlap = { x: 50, y: 0, width: 100, height: 100 };
      // Intersection = 50 * 100 = 5000. Area A = 10000, Area B = 10000. Union = 15000. IoU = 5000 / 15000 = 0.333
      expect(computeBoxIou(boxA, halfOverlap)).toBeCloseTo(0.333, 2);
    });
  });

  describe("computeTagMetrics", () => {
    it("computes precision, recall, and F1 score", () => {
      const gt = ["botanical", "nature", "leaf"];
      const pred = ["botanical", "nature", "urban"];

      const metrics = computeTagMetrics(gt, pred);
      expect(metrics.truePositives).toEqual(["botanical", "nature"]);
      expect(metrics.falsePositives).toEqual(["urban"]);
      expect(metrics.falseNegatives).toEqual(["leaf"]);

      expect(metrics.precision).toBeCloseTo(2 / 3, 2);
      expect(metrics.recall).toBeCloseTo(2 / 3, 2);
      expect(metrics.f1).toBeCloseTo(2 / 3, 2);
    });
  });

  describe("computeMaskIou", () => {
    it("computes Jaccard index and Dice coefficient on bitmask arrays", () => {
      const gt = new Uint8Array([255, 255, 0, 0]);
      const pred = new Uint8Array([255, 0, 255, 0]);

      const res = computeMaskIou(gt, pred);
      // Intersection = 1 (pixel 0). Union = 3 (pixels 0, 1, 2). IoU = 1/3 = 0.333
      expect(res.iou).toBe(0.333);
      // Dice = 2 * 1 / (2 + 2) = 0.5
      expect(res.dice).toBe(0.5);
    });
  });

  describe("computeCorrectionBurden", () => {
    it("computes human operational efficiency gains", () => {
      // 1. OCR: 20-character text with 2 errors saves ~85% of keystrokes
      const ocrBurden = computeCorrectionBurden(
        "ocr",
        "Luma Creative Studio",
        "Luma Craetive Studio",
      );
      expect(ocrBurden.efficiencyGainPercent).toBeGreaterThan(80);

      // 2. Tag: 4 ground truth tags with 3 correct predictions
      const tagBurden = computeCorrectionBurden(
        "tag",
        ["botanical", "nature", "leaf", "plant"],
        ["botanical", "nature", "leaf"],
      );
      expect(tagBurden.efficiencyGainPercent).toBeGreaterThan(60);

      // 3. Segmentation: 90% IoU mask
      const segBurden = computeCorrectionBurden(
        "segmentation",
        { iou: 1 },
        { iou: 0.9 },
      );
      expect(segBurden.efficiencyGainPercent).toBeGreaterThanOrEqual(80);
    });
  });
});

describe("Synthetic regression report", () => {
  it("reports only executed samples and does not invent model measurements", async () => {
    const report = await runHeldOutBenchmark();
    expect(report.status).toBe("incomplete");
    expect(report.corpus).toBe("synthetic-regression");
    expect(report.results).toHaveLength(1);
    expect(report.totalFixtures).toBe(report.results[0].samples.length);
    expect(report.totalFixtures).toBeGreaterThan(0);
    expect(report.unmeasured).toContain("human correction time");
    expect(
      report.results.some((r) => (r.executionMode as string) === "remote"),
    ).toBe(false);
    for (const sample of report.results[0].samples) {
      expect(sample.boxIou).toBeGreaterThanOrEqual(0);
      expect(sample.boxIou).toBeLessThanOrEqual(1);
      expect(sample.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
