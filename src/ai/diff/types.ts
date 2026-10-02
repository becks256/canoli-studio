/**
 * Types and interfaces for protected masked edits, composite verification,
 * and the Result-Diff Inspector (Ticket T13 / A05/A06).
 */

export interface ProtectedRegionRect {
  shape?: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProtectedRegionEllipse {
  shape: "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ProtectedRegion = ProtectedRegionRect | ProtectedRegionEllipse;

export interface ProtectedInvariantEvaluationOptions {
  referenceBuffer: Uint8Array | Uint8ClampedArray; // Pre-edit reference RGBA
  candidateBuffer: Uint8Array | Uint8ClampedArray; // Generated candidate RGBA
  width: number;
  height: number;
  /** Coverage mask where 255 = fully protected, 0 = unprotected/writable */
  protectedMask?: Uint8Array;
  /** Geometric regions to protect */
  protectedRegions?: ProtectedRegion[];
  /** Optional edit mask where 255 = editable region, 0 = outside edit */
  editMask?: Uint8Array;
  /** Feather radius for boundary transition (default 0) */
  featherRadius?: number;
  /** Tolerance threshold for non-feathered protected pixels (default 0 for exact A06 invariant) */
  tolerance?: number;
  /** Whether to generate the RGBA difference heatmap buffer (default true) */
  generateHeatmap?: boolean;
}

export interface ProtectedInvariantReport {
  /** True if zero violations in protected region */
  passed: boolean;
  /** Count of pixels in protected region exceeding tolerance */
  violatedPixelCount: number;
  /** Total count of protected pixels evaluated */
  totalProtectedPixels: number;
  /** Maximum single channel difference (|R|, |G|, |B|, or |A|) in protected region */
  maxChannelDifference: number;
  /** Mean Squared Error across all protected pixels */
  meanSquaredError: number;
  /** Mean Squared Error inside the editable region (reflects generative change magnitude) */
  editRegionMeanSquaredError: number;
  /** Total altered pixels across the entire image */
  alteredPixelCount: number;
  /** Percentage of protected pixels strictly preserved (0.0 to 100.0) */
  preservedPercentage: number;
  /** Count of violations in feather transition zone exceeding feather threshold */
  featherViolationsCount: number;
  /** RGBA difference heatmap buffer visualizing edits (green) and protected violations (red) */
  heatmapBuffer?: Uint8Array;
  /** Diagnostic human-readable summary of the verification */
  summary: string;
  /** Actionable error messages if invariant failed */
  diagnosticErrors: string[];
}

export interface CompositeProtectedEditOptions {
  referenceBuffer: Uint8Array | Uint8ClampedArray;
  candidateBuffer: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** Edit region mask (255 = replace with candidate, 0 = keep reference) */
  editMask?: Uint8Array;
  /** Protected region mask (255 = strictly protect reference, 0 = unprotected) */
  protectedMask?: Uint8Array;
  /** Geometric regions to protect */
  protectedRegions?: ProtectedRegion[];
  /** Boundary feather radius in document pixels */
  featherRadius?: number;
}

export type DiffViewMode = "split" | "diff" | "protected" | "side-by-side";
