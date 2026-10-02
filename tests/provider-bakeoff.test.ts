import { CANDIDATE_PROFILES } from "./fixtures/generation/profiles";
import { describe, expect, it } from "vitest";
import { runProviderBakeoff } from "../src/ai/evaluation/bakeoff";
import {
  analyzeLatencyDistribution,
  calculateAcceptedOutputCost,
  computeAlphaScore,
  computeReferenceDrift,
  evaluateTargetSizeConformance,
} from "../src/ai/evaluation/metrics";
import { ProviderRegistry } from "../src/ai/providers/registry";
import type { HumanApprovedBudget } from "../src/ai/providers/types";
import { BAKEOFF_REFERENCE_CORPUS } from "./fixtures/bakeoff/corpus";

describe("T10 Provider Bake-off & Capability Framework", () => {
  describe("Alpha Scoring Metrics", () => {
    it("returns perfect score for identical alpha channels without fringe", () => {
      const width = 64;
      const height = 64;
      const buf = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        buf[idx] = 100;
        buf[idx + 1] = 150;
        buf[idx + 2] = 200;
        buf[idx + 3] = i % 2 === 0 ? 255 : 0;
      }

      const result = computeAlphaScore(buf, buf, width, height);
      expect(result.matteIou).toBe(1.0);
      expect(result.alphaMse).toBe(0.0);
      expect(result.colorFringeScore).toBe(0.0);
      expect(result.compositeAlphaScore).toBeGreaterThanOrEqual(0.95);
    });

    it("penalizes blurred boundaries, color fringe, and mask mismatches", () => {
      const width = 64;
      const height = 64;
      const gt = new Uint8Array(width * height * 4);
      const cand = new Uint8Array(width * height * 4);

      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        // Ground truth has crisp subject in center
        const inCenter = i > 1000 && i < 3000;
        gt[idx] = 50;
        gt[idx + 1] = 50;
        gt[idx + 2] = 50;
        gt[idx + 3] = inCenter ? 255 : 0;

        // Candidate has noisy/dilated mask and color fringe bleeding
        cand[idx] = inCenter ? 50 : 220; // Bleeding bright background color
        cand[idx + 1] = inCenter ? 50 : 220;
        cand[idx + 2] = inCenter ? 50 : 220;
        cand[idx + 3] = inCenter ? 180 : 80; // Incomplete opacity and bleeding halo
      }

      const result = computeAlphaScore(cand, gt, width, height);
      expect(result.matteIou).toBeLessThan(1.0);
      expect(result.alphaMse).toBeGreaterThan(0.0);
      expect(result.compositeAlphaScore).toBeLessThan(0.7);
    });

    it("validates buffer dimensions match width * height * 4", () => {
      const invalid = new Uint8Array(10);
      expect(() => computeAlphaScore(invalid, invalid, 10, 10)).toThrow(
        "Buffer length must match",
      );
    });
  });

  describe("Target Size Conformance Metrics", () => {
    it("detects exact matches with zero aspect ratio error", () => {
      const conf = evaluateTargetSizeConformance(1024, 768, 1024, 768);
      expect(conf.exactMatch).toBe(true);
      expect(conf.aspectRatioError).toBe(0);
      expect(conf.conformanceScore).toBe(1.0);
      expect(conf.remappingTransform.scaleX).toBe(1.0);
      expect(conf.remappingTransform.translateX).toBe(0);
    });

    it("calculates affine remapping transform for mismatched aspect ratios", () => {
      // User requested 16:9 (1344x768), but provider returned 1:1 (1024x1024)
      const conf = evaluateTargetSizeConformance(1344, 768, 1024, 1024);
      expect(conf.exactMatch).toBe(false);
      expect(conf.aspectRatioError).toBeGreaterThan(0.4);
      expect(conf.conformanceScore).toBeLessThan(0.6);
      expect(conf.remappingTransform.scaleX).toBeCloseTo(1344 / 1024, 2);
      expect(conf.remappingTransform.translateY).toBeLessThan(0); // Centered offset
    });

    it("rejects non-positive or non-finite dimensions defensively", () => {
      expect(() => evaluateTargetSizeConformance(0, 1024, 1024, 1024)).toThrow(
        "Dimensions must be positive finite numbers",
      );
      expect(() =>
        evaluateTargetSizeConformance(1024, -100, 1024, 1024),
      ).toThrow("Dimensions must be positive finite numbers");
      expect(() =>
        evaluateTargetSizeConformance(1024, 1024, NaN, 1024),
      ).toThrow("Dimensions must be positive finite numbers");
    });
  });

  describe("Reference Drift & Protected Region Invariants", () => {
    it("reports zero drift for identical images", () => {
      const width = 32;
      const height = 32;
      const buf = new Uint8Array(width * height * 4);
      buf.fill(128);

      const drift = computeReferenceDrift(buf, buf, width, height);
      expect(drift.structuralSimilarity).toBe(1.0);
      expect(drift.histogramDistance).toBe(0.0);
      expect(drift.referenceDriftScore).toBe(0.0);
      expect(drift.protectedRegionViolations.isViolated).toBe(false);
    });

    it("flags violations when protected regions are modified", () => {
      const width = 32;
      const height = 32;
      const ref = new Uint8Array(width * height * 4);
      const cand = new Uint8Array(width * height * 4);
      ref.fill(100);
      cand.fill(100);

      // Mask where top half is protected (0), bottom half is writable (255)
      const mask = new Uint8Array(width * height);
      mask.fill(0, 0, (width * height) / 2);
      mask.fill(255, (width * height) / 2);

      // Mutate pixel in protected top half
      cand[10 * 4] = 200;

      const drift = computeReferenceDrift(ref, cand, width, height, mask);
      expect(drift.protectedRegionViolations.isViolated).toBe(true);
      expect(drift.protectedRegionViolations.alteredPixelCount).toBe(1);
      expect(drift.protectedRegionViolations.maxChannelDifference).toBe(100);
    });
  });

  describe("Latency Distribution Profiling", () => {
    it("computes accurate statistical percentiles and interactive status", () => {
      const samples = [
        1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 4200, 4500, 4800,
        5200, 6000, 8500,
      ];
      const stats = analyzeLatencyDistribution(samples);
      expect(stats.sampleCount).toBe(15);
      expect(stats.minMs).toBe(1200);
      expect(stats.maxMs).toBe(8500);
      expect(stats.medianMs).toBe(3300);
      expect(stats.p90Ms).toBe(6000);
      expect(stats.meetsInteractiveTarget).toBe(false); // p90 > 5000ms
    });

    it("flags fast interactive models accurately", () => {
      const fastSamples = [
        1000, 1200, 1500, 1800, 2000, 2200, 2500, 2900, 3200, 3500,
      ];
      const stats = analyzeLatencyDistribution(fastSamples);
      expect(stats.p90Ms).toBeLessThanOrEqual(5000);
      expect(stats.meetsInteractiveTarget).toBe(true);
    });
  });

  describe("Accepted-Output Cost Modeling", () => {
    it("calculates cost per accepted output across realistic retry and candidate rates", () => {
      // 3.5¢ base cost, 0.5¢ matting, 35% acceptance rate, 2 candidates per prompt, 25% retry
      const costResult = calculateAcceptedOutputCost({
        baseCostPerImageCents: 3.5,
        requiresSecondaryMatting: true,
        secondaryMattingCostCents: 0.5,
        acceptanceRate: 0.35,
        candidatesPerPrompt: 2,
        retryRate: 0.25,
      });

      // (1 + 0.25) / 0.35 * 2 = 7.14 candidates per accepted output
      expect(costResult.attemptsPerAcceptedOutput).toBeCloseTo(7.14, 1);
      // 7.14 * (3.5 + 0.5 + 0.05)¢ ≈ 28.9¢ per accepted asset
      expect(costResult.costPerAcceptedOutputDollars).toBeCloseTo(0.289, 2);

      // Verify margin against subscription tiers with standard 15-asset allowance
      // 15 assets on $30/mo tier = $4.34 -> 14.5% of revenue (meets 20% limit)
      expect(costResult.variableCostRatio.tier30Dollars).toBeLessThanOrEqual(
        0.2,
      );
      expect(costResult.meetsVariableCostCeiling).toBe(true);
    });

    it("verifies economical providers meet variable cost ceiling under managed caps", () => {
      // 0.3¢ fast/schnell provider, 50% acceptance rate, 1 candidate per prompt, 10% retry
      const costResult = calculateAcceptedOutputCost({
        baseCostPerImageCents: 0.3,
        requiresSecondaryMatting: false,
        secondaryMattingCostCents: 0.0,
        acceptanceRate: 0.5,
        candidatesPerPrompt: 1,
        retryRate: 0.1,
      });

      expect(costResult.costPerAcceptedOutputDollars).toBeLessThan(0.01);
      expect(costResult.meetsVariableCostCeiling).toBe(true);
    });
  });

  describe("Provider Registry & Human-Approved Budget Governance", () => {
    it("filters explicitly supplied fixture profiles", () => {
      const registry = new ProviderRegistry(CANDIDATE_PROFILES);
      const providers = registry.listProviders();
      expect(providers.length).toBe(4);
      expect(providers.map((p) => p.id)).toContain("flux-1-pro");
      expect(providers.map((p) => p.id)).toContain("dalle-3");
      expect(providers.map((p) => p.id)).toContain("sd-3.5-large");
      expect(providers.map((p) => p.id)).toContain("local-diffusion-baseline");
    });

    it("filters providers by capability criteria", () => {
      const registry = new ProviderRegistry(CANDIDATE_PROFILES);

      // Query zero-retention providers
      const zeroRetention = registry.findMatchingProviders({
        requiresZeroRetention: true,
      });
      expect(zeroRetention.map((p) => p.id)).toContain("flux-1-pro");
      expect(zeroRetention.map((p) => p.id)).not.toContain("dalle-3"); // DALL-E 3 has 30-day retention

      // Query fast latency providers (p90 <= 10000ms)
      const fast = registry.findMatchingProviders({ maxLatencyP90Ms: 10000 });
      expect(fast.map((p) => p.id)).toContain("flux-1-pro");
      expect(fast.map((p) => p.id)).not.toContain("dalle-3");
    });

    it("estimates generation cost with HD and alpha adjustments", () => {
      const registry = new ProviderRegistry(CANDIDATE_PROFILES);

      const standardReq = {
        prompt: "A coffee cup",
        modality: "text-to-image" as const,
        targetWidth: 1024,
        targetHeight: 1024,
      };

      const alphaReq = {
        ...standardReq,
        requireAlpha: true,
      };

      const dalleStandard = registry.estimateGenerationCost(
        "dalle-3",
        standardReq,
      );
      expect(dalleStandard).toBe(4.0);

      const dalleAlpha = registry.estimateGenerationCost("dalle-3", alphaReq);
      // 4.0 base + 0.5 secondary matting = 4.5
      expect(dalleAlpha).toBe(4.5);

      const fluxStandard = registry.estimateGenerationCost(
        "flux-1-pro",
        standardReq,
      );
      expect(fluxStandard).toBe(3.5);
    });

    it("strictly blocks generation when human consent or budget is missing/exceeded", () => {
      const registry = new ProviderRegistry(CANDIDATE_PROFILES);

      const validBudget: HumanApprovedBudget = {
        approvedCeilingCents: 500,
        consentGiven: true,
        approverId: "user-founder-1",
        approvalTimestamp: "2026-09-27T10:00:00Z",
        spentSoFarCents: 100,
      };

      // Valid: 100 + 4 <= 500
      expect(() =>
        registry.validateBudgetConsent(validBudget, 4),
      ).not.toThrow();

      // Invalid: missing consent
      const noConsentBudget = { ...validBudget, consentGiven: false };
      expect(() => registry.validateBudgetConsent(noConsentBudget, 4)).toThrow(
        "Explicit human consent required",
      );

      // Invalid: missing approver ID
      const noApproverBudget = { ...validBudget, approverId: "" };
      expect(() => registry.validateBudgetConsent(noApproverBudget, 4)).toThrow(
        "Budget must be explicitly approved by an authorized user ID",
      );

      // Invalid: budget ceiling exceeded
      expect(() => registry.validateBudgetConsent(validBudget, 450)).toThrow(
        "exceeds remaining approved budget ceiling",
      );
    });
  });

  describe("Reference Corpus & Full Bake-off Execution", () => {
    it("contains 55 categorized evaluation items across 5 distinct domains", () => {
      expect(BAKEOFF_REFERENCE_CORPUS.length).toBe(55);

      const categories = new Set(
        BAKEOFF_REFERENCE_CORPUS.map((i) => i.category),
      );
      expect(categories.has("cutout-asset")).toBe(true);
      expect(categories.has("background-texture")).toBe(true);
      expect(categories.has("visual-overlay")).toBe(true);
      expect(categories.has("reference-conditioned")).toBe(true);
      expect(categories.has("aspect-ratio-adversarial")).toBe(true);
    });

    it("does not turn synthetic fixtures into provider evaluation evidence", () => {
      const report = runProviderBakeoff();
      expect(report.status).toBe("incomplete");
      expect(report.providerCount).toBe(0);
      expect(report.primaryRecommendation).toBeNull();
      expect(report.scorecards).toEqual({});
      expect(report.unmeasured).toHaveLength(6);
      expect(new ProviderRegistry().listAdapters()).toEqual([]);
    });
  });
});
