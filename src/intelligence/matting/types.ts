/**
 * Types and interfaces for object selection, background removal, and interactive matting (T19 / A04).
 */

export type { SelectionData } from "../../core/drawing";

export const TRIMAP_BACKGROUND = 0;
export const TRIMAP_UNKNOWN = 128;
export const TRIMAP_FOREGROUND = 255;

export type TrimapValue =
  typeof TRIMAP_BACKGROUND | typeof TRIMAP_UNKNOWN | typeof TRIMAP_FOREGROUND;

export interface TrimapBuffer {
  width: number;
  height: number;
  /** Uint8Array of size width * height containing 0 (bg), 128 (unknown), 255 (fg) */
  data: Uint8Array;
}

export interface MattingOptions {
  /**
   * Radius of unknown transition band expansion in pixels (default 10).
   */
  radius?: number;
  /**
   * Whether to decontaminate color bleeding from the backdrop (default true).
   */
  decontaminate?: boolean;
  /**
   * Strength of color decontamination from 0.0 (none) to 1.0 (full, default 1.0).
   */
  decontaminateAmount?: number;
  /**
   * Sub-pixel edge feathering / smoothing radius (default 0).
   */
  edgeFeather?: number;
  /**
   * Contrast curve adjustment for alpha transition (-100 to +100, default 0).
   */
  contrast?: number;
  /**
   * Spatial regularization / smoothness factor (0 to 100, default 10).
   */
  smoothness?: number;
  smooth?: number;
  feather?: number;
  shiftEdge?: number;
  /**
   * Pre-computed or custom trimap buffer (overrides radius dilation if provided).
   */
  trimap?: Uint8Array;
}

export interface MattingResult {
  /**
   * Continuous alpha matte with values in [0, 255] (size width * height).
   */
  alpha: Uint8Array;
  width: number;
  height: number;
  /**
   * Color-decontaminated foreground RGBA buffer (size width * height * 4).
   */
  foregroundRgba?: Uint8Array;
  /**
   * The trimap used during matting evaluation (size width * height).
   */
  trimap: Uint8Array;
  /**
   * Confidence score from 0.0 to 1.0 based on foreground/background separability.
   */
  confidence: number;
}

export interface SegmentationCandidate {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /**
   * Binary or soft subject mask of size width * height (255 = subject).
   */
  mask: Uint8Array;
  width: number;
  height: number;
  confidence: number;
  label: string;
}

export interface EdgeRefinementKernel {
  knnNeighbors?: number;
  spatialWeight?: number;
  colorWeight?: number;
  regularizationEpsilon?: number;
}

export interface SelectSubjectOptions {
  /**
   * Optional layer ID to segment. Defaults to the active/selected raster layer.
   */
  targetLayerId?: string;
  /**
   * Saliency sensitivity threshold (0.0 to 1.0, default 0.35).
   */
  threshold?: number;
  /**
   * Expansion / padding radius for the resulting selection in pixels (default 0).
   */
  expandRadius?: number;
}

export type RefineEdgePreviewMode =
  "marching-ants" | "overlay" | "on-black" | "on-white" | "on-transparency";

export type MattingViewMode = RefineEdgePreviewMode;

export interface RefineEdgeOptions extends MattingOptions {
  previewMode?: RefineEdgePreviewMode;
  viewMode?: RefineEdgePreviewMode;
  smooth?: number;
  feather?: number;
  shiftEdge?: number;
  outputTo?: "mask" | "new-layer";
}
