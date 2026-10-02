/**
 * Quantitative evaluation metrics for AI provider bake-off:
 * - Alpha scoring (matte IoU, MSE, fringe detection, smoothness)
 * - Target size & aspect ratio conformance (scaling, distortion, affine remapping)
 * - Reference drift (structural similarity, histogram distance, protected region invariants)
 * - Latency distribution profiling (p50, p90, p99)
 * - Accepted-output cost modeling & subscription margin analysis
 */

export interface AlphaScoreResult {
  matteIou: number; // Intersection over Union of non-zero alpha (0.0 to 1.0)
  alphaMse: number; // Mean squared error across alpha values (0.0 to 1.0)
  colorFringeScore: number; // 0.0 (clean edge, no fringe) to 1.0 (severe fringe/halo)
  edgeSmoothness: number; // Gradient smoothness score (0.0 to 1.0)
  compositeAlphaScore: number; // Weighted composite score in [0.0, 1.0]
}

export interface TargetSizeConformanceResult {
  exactMatch: boolean;
  aspectRatioRequested: number;
  aspectRatioActual: number;
  aspectRatioError: number; // Absolute relative error |AR_act - AR_req| / AR_req
  areaScaleFactor: number; // Actual area / requested area
  conformanceScore: number; // 0.0 to 1.0
  remappingTransform: {
    scaleX: number;
    scaleY: number;
    translateX: number;
    translateY: number;
  };
}

export interface ReferenceDriftResult {
  structuralSimilarity: number; // SSIM approximation in [-1.0, 1.0]
  histogramDistance: number; // Normalized Earth Mover's Distance in [0.0, 1.0]
  referenceDriftScore: number; // 0.0 (identical) to 1.0 (completely drifted)
  protectedRegionViolations: {
    alteredPixelCount: number;
    maxChannelDifference: number;
    isViolated: boolean;
  };
}

export interface LatencyAnalysisResult {
  sampleCount: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p90Ms: number;
  p99Ms: number;
  standardDeviationMs: number;
  meetsInteractiveTarget: boolean; // p90 <= 5000ms
}

export interface CostModelParameters {
  baseCostPerImageCents: number;
  requiresSecondaryMatting: boolean;
  secondaryMattingCostCents: number;
  acceptanceRate: number; // e.g. 0.35 (35% accepted)
  candidatesPerPrompt: number; // e.g. 2 or 4
  retryRate: number; // e.g. 0.25 (25% need a retry)
  infraCostPerCandidateCents?: number; // transfer, storage, thumbnail caching
}

export interface AcceptedOutputCostResult {
  attemptsPerAcceptedOutput: number;
  costPerAttemptCents: number;
  costPerAcceptedOutputCents: number;
  costPerAcceptedOutputDollars: number;
  variableCostRatio: {
    tier30Dollars: number; // $30/mo tier (assuming 15 accepted assets/mo)
    tier60Dollars: number; // $60/mo tier (assuming 35 accepted assets/mo)
    tier150Dollars: number; // $150/mo tier (assuming 100 accepted assets/mo)
  };
  meetsVariableCostCeiling: boolean; // Variable cost <= 20% of revenue across standard tiers
}

/**
 * Evaluates alpha matte quality against ground-truth alpha channel.
 * Measures boundary IoU, transition MSE, edge halo fringe, and antialiasing smoothness.
 */
export function computeAlphaScore(
  candidateRgba: Uint8Array,
  groundTruthRgba: Uint8Array,
  width: number,
  height: number,
): AlphaScoreResult {
  if (
    candidateRgba.length !== width * height * 4 ||
    groundTruthRgba.length !== width * height * 4
  ) {
    throw new Error("Buffer length must match width * height * 4");
  }

  const totalPixels = width * height;
  let intersectionCount = 0;
  let unionCount = 0;
  let alphaSquaredErrorSum = 0;
  let fringePixelCount = 0;
  let fringeDistSum = 0;
  let gradientVarianceSum = 0;
  let boundaryPixelCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const candA = candidateRgba[idx + 3];
    const gtA = groundTruthRgba[idx + 3];

    // IoU calculation (active foreground alpha > 10)
    const candActive = candA > 10;
    const gtActive = gtA > 10;
    if (candActive && gtActive) intersectionCount++;
    if (candActive || gtActive) unionCount++;

    // Mean Squared Error normalized to [0, 1]
    const diff = (candA - gtA) / 255;
    alphaSquaredErrorSum += diff * diff;

    // Transition boundary analysis (pixels with partial transparency: 10 < alpha < 245)
    if (gtA > 10 && gtA < 245) {
      boundaryPixelCount++;
      // Color fringe: measure RGB deviation between candidate and ground truth at boundary
      const candR = candidateRgba[idx];
      const candG = candidateRgba[idx + 1];
      const candB = candidateRgba[idx + 2];
      const gtR = groundTruthRgba[idx];
      const gtG = groundTruthRgba[idx + 1];
      const gtB = groundTruthRgba[idx + 2];

      const colorDist =
        Math.sqrt(
          (candR - gtR) ** 2 + (candG - gtG) ** 2 + (candB - gtB) ** 2,
        ) /
        (Math.sqrt(3) * 255);
      fringeDistSum += colorDist;
      fringePixelCount++;

      // Gradient variance estimation
      const x = i % width;
      const y = Math.floor(i / width);
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const leftA = candidateRgba[(y * width + (x - 1)) * 4 + 3];
        const rightA = candidateRgba[(y * width + (x + 1)) * 4 + 3];
        const topA = candidateRgba[((y - 1) * width + x) * 4 + 3];
        const bottomA = candidateRgba[((y + 1) * width + x) * 4 + 3];

        const gx = (rightA - leftA) / 255;
        const gy = (bottomA - topA) / 255;
        const gradMag = Math.sqrt(gx * gx + gy * gy);
        // Desirable antialiasing has continuous, moderate gradients
        gradientVarianceSum += Math.abs(gradMag - 0.5);
      }
    }
  }

  const matteIou = unionCount > 0 ? intersectionCount / unionCount : 1.0;
  const alphaMse = totalPixels > 0 ? alphaSquaredErrorSum / totalPixels : 0.0;
  const colorFringeScore =
    fringePixelCount > 0
      ? Math.min(1.0, fringeDistSum / fringePixelCount)
      : 0.0;
  const avgGradDeviation =
    boundaryPixelCount > 0 ? gradientVarianceSum / boundaryPixelCount : 0.0;
  const edgeSmoothness = Math.max(0.0, 1.0 - Math.min(1.0, avgGradDeviation));

  // Composite Alpha Quality Score: weighted combination
  const compositeAlphaScore = Math.max(
    0.0,
    Math.min(
      1.0,
      0.45 * matteIou +
        0.35 * Math.max(0.0, 1.0 - Math.sqrt(alphaMse) * 2.0) +
        0.1 * (1.0 - colorFringeScore) +
        0.1 * edgeSmoothness,
    ),
  );

  return {
    matteIou: Math.round(matteIou * 10000) / 10000,
    alphaMse: Math.round(alphaMse * 10000) / 10000,
    colorFringeScore: Math.round(colorFringeScore * 10000) / 10000,
    edgeSmoothness: Math.round(edgeSmoothness * 10000) / 10000,
    compositeAlphaScore: Math.round(compositeAlphaScore * 10000) / 10000,
  };
}

/**
 * Evaluates target size and aspect ratio conformance.
 * Calculates distortion error and the affine transformation matrix to place
 * the candidate image onto the target canvas rectangle without distortion.
 */
export function evaluateTargetSizeConformance(
  requestedWidth: number,
  requestedHeight: number,
  actualWidth: number,
  actualHeight: number,
): TargetSizeConformanceResult {
  if (
    !Number.isFinite(requestedWidth) ||
    requestedWidth <= 0 ||
    !Number.isFinite(requestedHeight) ||
    requestedHeight <= 0 ||
    !Number.isFinite(actualWidth) ||
    actualWidth <= 0 ||
    !Number.isFinite(actualHeight) ||
    actualHeight <= 0
  ) {
    throw new Error(
      "Dimensions must be positive finite numbers greater than zero",
    );
  }

  const exactMatch =
    requestedWidth === actualWidth && requestedHeight === actualHeight;
  const aspectRatioRequested = requestedWidth / requestedHeight;
  const aspectRatioActual = actualWidth / actualHeight;

  const aspectRatioError =
    Math.abs(aspectRatioActual - aspectRatioRequested) / aspectRatioRequested;
  const areaRequested = requestedWidth * requestedHeight;
  const areaActual = actualWidth * actualHeight;
  const areaScaleFactor = areaActual / areaRequested;

  // Affine remapping: scale to cover requested bounds, center alignment
  const scale = Math.max(
    requestedWidth / actualWidth,
    requestedHeight / actualHeight,
  );
  const remappingTransform = {
    scaleX: scale,
    scaleY: scale,
    translateX: (requestedWidth - actualWidth * scale) / 2,
    translateY: (requestedHeight - actualHeight * scale) / 2,
  };

  // Conformance score penalizes aspect ratio deviation and severe downscaling
  const arPenalty = Math.min(1.0, aspectRatioError * 2.0);
  const areaPenalty =
    areaScaleFactor < 1.0
      ? Math.min(1.0, (1.0 - areaScaleFactor) * 0.8)
      : Math.min(0.2, (areaScaleFactor - 1.0) * 0.05);

  const conformanceScore = Math.max(0.0, 1.0 - arPenalty - areaPenalty);

  return {
    exactMatch,
    aspectRatioRequested: Math.round(aspectRatioRequested * 1000) / 1000,
    aspectRatioActual: Math.round(aspectRatioActual * 1000) / 1000,
    aspectRatioError: Math.round(aspectRatioError * 10000) / 10000,
    areaScaleFactor: Math.round(areaScaleFactor * 1000) / 1000,
    conformanceScore: Math.round(conformanceScore * 10000) / 10000,
    remappingTransform,
  };
}

/**
 * Computes structural similarity (SSIM approximation) and color histogram drift.
 * Also verifies that protected regions (where mask coverage = 0) have not been modified.
 */
export function computeReferenceDrift(
  referenceRgba: Uint8Array,
  candidateRgba: Uint8Array,
  width: number,
  height: number,
  protectedMask?: Uint8Array, // Optional mask where 0 = protected, 255 = writable
): ReferenceDriftResult {
  const totalPixels = width * height;
  if (
    referenceRgba.length !== totalPixels * 4 ||
    candidateRgba.length !== totalPixels * 4
  ) {
    throw new Error("Buffer lengths must match width * height * 4");
  }

  let meanRefL = 0;
  let meanCandL = 0;
  const refLuminance = new Float32Array(totalPixels);
  const candLuminance = new Float32Array(totalPixels);

  // 64-bin color histogram (16 bins per channel R, G, B, plus total)
  const refHist = new Float32Array(48);
  const candHist = new Float32Array(48);

  let alteredPixelCount = 0;
  let maxChannelDifference = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const rR = referenceRgba[idx];
    const rG = referenceRgba[idx + 1];
    const rB = referenceRgba[idx + 2];
    const cR = candidateRgba[idx];
    const cG = candidateRgba[idx + 1];
    const cB = candidateRgba[idx + 2];

    // Luminance formula: 0.2126R + 0.7152G + 0.0722B
    const lumR = (0.2126 * rR + 0.7152 * rG + 0.0722 * rB) / 255;
    const lumC = (0.2126 * cR + 0.7152 * cG + 0.0722 * cB) / 255;
    refLuminance[i] = lumR;
    candLuminance[i] = lumC;
    meanRefL += lumR;
    meanCandL += lumC;

    // Histogram bins (16 bins per R, G, B)
    refHist[Math.min(15, Math.floor(rR / 16))]++;
    refHist[16 + Math.min(15, Math.floor(rG / 16))]++;
    refHist[32 + Math.min(15, Math.floor(rB / 16))]++;

    candHist[Math.min(15, Math.floor(cR / 16))]++;
    candHist[16 + Math.min(15, Math.floor(cG / 16))]++;
    candHist[32 + Math.min(15, Math.floor(cB / 16))]++;

    // Protected region invariant check (if mask pixel is 0, pixel must not change)
    if (protectedMask && protectedMask[i] === 0) {
      const dR = Math.abs(rR - cR);
      const dG = Math.abs(rG - cG);
      const dB = Math.abs(rB - cB);
      const dA = Math.abs(referenceRgba[idx + 3] - candidateRgba[idx + 3]);
      const maxDiff = Math.max(dR, dG, dB, dA);
      if (maxDiff > 0) {
        alteredPixelCount++;
        if (maxDiff > maxChannelDifference) maxChannelDifference = maxDiff;
      }
    }
  }

  meanRefL /= totalPixels;
  meanCandL /= totalPixels;

  let varRef = 0;
  let varCand = 0;
  let covar = 0;

  for (let i = 0; i < totalPixels; i++) {
    const dR = refLuminance[i] - meanRefL;
    const dC = candLuminance[i] - meanCandL;
    varRef += dR * dR;
    varCand += dC * dC;
    covar += dR * dC;
  }

  varRef /= totalPixels;
  varCand /= totalPixels;
  covar /= totalPixels;

  // SSIM standard constants
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  const ssim =
    ((2 * meanRefL * meanCandL + c1) * (2 * covar + c2)) /
    ((meanRefL * meanRefL + meanCandL * meanCandL + c1) *
      (varRef + varCand + c2));

  // Earth Mover's Distance / Wasserstein on normalized histograms
  let histDistSum = 0;
  for (let ch = 0; ch < 3; ch++) {
    let cumRef = 0;
    let cumCand = 0;
    for (let b = 0; b < 16; b++) {
      const idx = ch * 16 + b;
      cumRef += refHist[idx] / totalPixels;
      cumCand += candHist[idx] / totalPixels;
      histDistSum += Math.abs(cumRef - cumCand);
    }
  }
  // Maximum theoretical 1D Wasserstein distance across 3 channels on 16 bins is 3 * (16 - 1) = 45.0
  const normalizedHistDist = Math.min(1.0, histDistSum / (3.0 * 15.0));

  // Reference drift score: 0 = identical, 1 = completely drifted
  const referenceDriftScore = Math.min(
    1.0,
    Math.max(
      0.0,
      0.65 * (1.0 - Math.max(0.0, ssim)) + 0.35 * normalizedHistDist,
    ),
  );

  return {
    structuralSimilarity: Math.round(ssim * 10000) / 10000,
    histogramDistance: Math.round(normalizedHistDist * 10000) / 10000,
    referenceDriftScore: Math.round(referenceDriftScore * 10000) / 10000,
    protectedRegionViolations: {
      alteredPixelCount,
      maxChannelDifference,
      isViolated: alteredPixelCount > 0,
    },
  };
}

/**
 * Analyzes latency distributions from benchmark samples.
 */
export function analyzeLatencyDistribution(
  samplesMs: number[],
): LatencyAnalysisResult {
  if (samplesMs.length === 0) {
    throw new Error("Must provide at least one latency sample");
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const minMs = sorted[0];
  const maxMs = sorted[n - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const meanMs = sum / n;

  const medianMs =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

  const p90Idx = Math.min(n - 1, Math.floor(n * 0.9));
  const p99Idx = Math.min(n - 1, Math.floor(n * 0.99));
  const p90Ms = sorted[p90Idx];
  const p99Ms = sorted[p99Idx];

  const variance = sorted.reduce((acc, v) => acc + (v - meanMs) ** 2, 0) / n;
  const standardDeviationMs = Math.sqrt(variance);

  return {
    sampleCount: n,
    minMs: Math.round(minMs),
    maxMs: Math.round(maxMs),
    meanMs: Math.round(meanMs),
    medianMs: Math.round(medianMs),
    p90Ms: Math.round(p90Ms),
    p99Ms: Math.round(p99Ms),
    standardDeviationMs: Math.round(standardDeviationMs),
    meetsInteractiveTarget: p90Ms <= 5000,
  };
}

/**
 * Models accepted-output cost and subscription gross margins:
 * Cost per accepted output = (total inference spend across all attempts) / (accepted outputs)
 */
export function calculateAcceptedOutputCost(
  params: CostModelParameters,
): AcceptedOutputCostResult {
  const {
    baseCostPerImageCents,
    requiresSecondaryMatting,
    secondaryMattingCostCents,
    acceptanceRate,
    candidatesPerPrompt,
    retryRate,
    infraCostPerCandidateCents = 0.05,
  } = params;

  if (acceptanceRate <= 0 || acceptanceRate > 1.0) {
    throw new Error("Acceptance rate must be between 0 and 1.0");
  }

  // Cost per candidate attempt
  const candidateCostCents =
    baseCostPerImageCents +
    (requiresSecondaryMatting ? secondaryMattingCostCents : 0) +
    infraCostPerCandidateCents;

  // Candidates generated per user prompt
  const costPerPromptAttemptCents = candidateCostCents * candidatesPerPrompt;

  // Number of prompt attempts needed on average to get 1 accepted output
  // e.g. If acceptanceRate is 35% and retryRate is 25%, attempts = (1 + 0.25) / 0.35
  const promptAttemptsPerAcceptance = (1.0 + retryRate) / acceptanceRate;
  const totalCandidatesPerAcceptedOutput =
    promptAttemptsPerAcceptance * candidatesPerPrompt;

  const costPerAcceptedOutputCents =
    totalCandidatesPerAcceptedOutput * candidateCostCents;
  const costPerAcceptedOutputDollars = costPerAcceptedOutputCents / 100;

  // Margin analysis against subscription tiers from docs/IMPLEMENTATION_ROADMAP.md line 86:
  // Base subscription allowances targeting <= 20% variable cost per docs/AI_FEATURE_SPECS.md:
  // - $30/month tier: standard allowance of 15 accepted outputs/month (<= $6.00 variable budget)
  // - $60/month tier: standard allowance of 35 accepted outputs/month (<= $12.00 variable budget)
  // - $150/month tier: standard allowance of 100 accepted outputs/month (<= $30.00 variable budget)
  const monthlyCostTier30 = costPerAcceptedOutputDollars * 15;
  const monthlyCostTier60 = costPerAcceptedOutputDollars * 35;
  const monthlyCostTier150 = costPerAcceptedOutputDollars * 100;

  const ratioTier30 = monthlyCostTier30 / 30;
  const ratioTier60 = monthlyCostTier60 / 60;
  const ratioTier150 = monthlyCostTier150 / 150;

  // Target from docs/AI_FEATURE_SPECS.md line 153: variable cost below 20% of revenue
  const meetsVariableCostCeiling = ratioTier30 <= 0.2 && ratioTier60 <= 0.2;

  return {
    attemptsPerAcceptedOutput:
      Math.round(totalCandidatesPerAcceptedOutput * 100) / 100,
    costPerAttemptCents: Math.round(costPerPromptAttemptCents * 100) / 100,
    costPerAcceptedOutputCents:
      Math.round(costPerAcceptedOutputCents * 100) / 100,
    costPerAcceptedOutputDollars:
      Math.round(costPerAcceptedOutputDollars * 1000) / 1000,
    variableCostRatio: {
      tier30Dollars: Math.round(ratioTier30 * 1000) / 1000,
      tier60Dollars: Math.round(ratioTier60 * 1000) / 1000,
      tier150Dollars: Math.round(ratioTier150 * 1000) / 1000,
    },
    meetsVariableCostCeiling,
  };
}
