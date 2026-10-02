export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TagEvaluationResult {
  precision: number;
  recall: number;
  f1: number;
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
}

export interface MaskEvaluationResult {
  iou: number;
  dice: number;
  intersectionPixels: number;
  unionPixels: number;
}

export interface CorrectionBurdenResult {
  task: "ocr" | "tag" | "segmentation";
  candidateEditsRequired: number;
  manualBaselineEdits: number;
  efficiencyGainPercent: number;
}

/**
 * Standard Wagner-Fischer dynamic programming algorithm for Levenshtein distance.
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

/**
 * Character Error Rate (CER) = Levenshtein(reference, hypothesis) / max(1, reference.length).
 */
export function computeCer(reference: string, hypothesis: string): number {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  const distance = computeLevenshteinDistance(reference, hypothesis);
  return Math.min(1, distance / reference.length);
}

/**
 * Word Error Rate (WER) using word-level token edit distance.
 */
export function computeWer(reference: string, hypothesis: string): number {
  const refWords = reference.trim().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.trim().split(/\s+/).filter(Boolean);

  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;
  if (hypWords.length === 0) return 1;

  const m = refWords.length;
  const n = hypWords.length;

  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const rWord = refWords[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = rWord === hypWords[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return Math.min(1, prev[n] / m);
}

/**
 * Intersection over Union (IoU) for bounding boxes.
 */
export function computeBoxIou(a: Box, b: Box): number {
  const xLeft = Math.max(a.x, b.x);
  const yTop = Math.max(a.y, b.y);
  const xRight = Math.min(a.x + a.width, b.x + b.width);
  const yBottom = Math.min(a.y + a.height, b.y + b.height);

  if (xRight <= xLeft || yBottom <= yTop) return 0;

  const intersection = (xRight - xLeft) * (yBottom - yTop);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;

  return union <= 0 ? 0 : Math.round((intersection / union) * 1000) / 1000;
}

/**
 * Tag precision, recall, and F1 score against ground truth keywords.
 */
export function computeTagMetrics(
  groundTruth: string[],
  predicted: string[],
): TagEvaluationResult {
  const normGt = new Set(groundTruth.map((t) => t.toLowerCase().trim()));
  const normPred = new Set(predicted.map((t) => t.toLowerCase().trim()));

  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];

  for (const p of normPred) {
    if (normGt.has(p)) {
      truePositives.push(p);
    } else {
      falsePositives.push(p);
    }
  }

  for (const g of normGt) {
    if (!normPred.has(g)) {
      falseNegatives.push(g);
    }
  }

  const precision =
    normPred.size === 0 ? 1 : truePositives.length / normPred.size;
  const recall = normGt.size === 0 ? 1 : truePositives.length / normGt.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    truePositives,
    falsePositives,
    falseNegatives,
  };
}

/**
 * Mask Jaccard index (IoU) and Dice coefficient for 1-bit or 8-bit coverage arrays.
 */
export function computeMaskIou(
  groundTruth: Uint8Array,
  predicted: Uint8Array,
): MaskEvaluationResult {
  const len = Math.min(groundTruth.length, predicted.length);
  let intersection = 0;
  let union = 0;
  let countA = 0;
  let countB = 0;

  for (let i = 0; i < len; i++) {
    const a = groundTruth[i] > 128 ? 1 : 0;
    const b = predicted[i] > 128 ? 1 : 0;

    if (a && b) intersection++;
    if (a || b) union++;
    if (a) countA++;
    if (b) countB++;
  }

  const iou = union === 0 ? 1 : intersection / union;
  const dice =
    countA + countB === 0 ? 1 : (2 * intersection) / (countA + countB);

  return {
    iou: Math.round(iou * 1000) / 1000,
    dice: Math.round(dice * 1000) / 1000,
    intersectionPixels: intersection,
    unionPixels: union,
  };
}

/**
 * Correction burden: measures the operational and cognitive effort required by a human user
 * to accept and correct candidate suggestions vs creating them manually from scratch.
 */
export function computeCorrectionBurden(
  task: "ocr" | "tag" | "segmentation",
  reference: string | string[] | { iou: number },
  hypothesis: string | string[] | { iou: number },
): CorrectionBurdenResult {
  if (task === "ocr") {
    const ref = String(reference);
    const hyp = String(hypothesis);
    // Baseline: user types the entire text string from scratch (1 key per character)
    const baseline = Math.max(1, ref.length);
    // Candidate edits: Levenshtein distance (keystrokes to fix mistakes) + 1 review click
    const dist = computeLevenshteinDistance(ref, hyp);
    const editsRequired = dist + (hyp.length > 0 ? 1 : 0);
    const gain = Math.max(
      0,
      Math.round(((baseline - editsRequired) / baseline) * 100),
    );

    return {
      task: "ocr",
      candidateEditsRequired: editsRequired,
      manualBaselineEdits: baseline,
      efficiencyGainPercent: gain,
    };
  }

  if (task === "tag") {
    const refTags = Array.isArray(reference) ? reference : [];
    const hypTags = Array.isArray(hypothesis) ? hypothesis : [];
    const metrics = computeTagMetrics(refTags, hypTags);

    // Baseline: user authors all ground truth tags manually (average 10 chars per tag)
    const baseline = refTags.length * 10;
    // Edits: 1 click per accepted tag (true positives), 1 click to delete false positive,
    // plus manual authoring for missing tags (false negatives)
    const editsRequired =
      metrics.truePositives.length * 1 +
      metrics.falsePositives.length * 1 +
      metrics.falseNegatives.length * 10;

    const gain =
      baseline <= 0
        ? 0
        : Math.max(
            0,
            Math.round(((baseline - editsRequired) / baseline) * 100),
          );

    return {
      task: "tag",
      candidateEditsRequired: editsRequired,
      manualBaselineEdits: baseline,
      efficiencyGainPercent: gain,
    };
  }

  // Segmentation
  const iou =
    typeof hypothesis === "object" && "iou" in hypothesis
      ? hypothesis.iou
      : 0.85;
  // Baseline: user manually draws 16 anchor points or brush strokes around subject
  const baseline = 20;
  // Edits: repair brush strokes proportional to residual unmasked error (1 - iou) * baseline
  const editsRequired = Math.max(1, Math.round((1 - iou) * baseline) + 1);
  const gain = Math.max(
    0,
    Math.round(((baseline - editsRequired) / baseline) * 100),
  );

  return {
    task: "segmentation",
    candidateEditsRequired: editsRequired,
    manualBaselineEdits: baseline,
    efficiencyGainPercent: gain,
  };
}
