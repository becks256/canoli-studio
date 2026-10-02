import type { LayerMaskOptions } from "../../dom/masks";
import type { ExecutionMode } from "../adapters/types";

export type CandidateStatus =
  "proposed" | "accepted" | "rejected" | "superseded";

export interface BaseCandidate {
  id: string;
  status: CandidateStatus;
  layerId: string;
  assetId: string;
  adapterId: string;
  origin: ExecutionMode;
  confidence: number;
  timestamp: number;
}

export interface OcrCandidate extends BaseCandidate {
  kind: "ocr";
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  language?: string;
}

export interface TagCandidate extends BaseCandidate {
  kind: "tag";
  tag: string;
  category?: string;
}

export interface SegmentationCandidate extends BaseCandidate {
  kind: "segmentation";
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  maskOptions: LayerMaskOptions;
}

export type AnalysisCandidate =
  OcrCandidate | TagCandidate | SegmentationCandidate;
