import { LocalSegmentationAdapter } from "./local-segmenter";
import { LocalTaggingAdapter } from "./local-tagger";
import type {
  AnalysisAdapter,
  AnalysisModality,
  ExecutionMode,
  OcrAdapter,
  SegmentationAdapter,
  TaggingAdapter,
} from "./types";

export class AnalysisAdapterRegistry {
  private adapters = new Map<string, AnalysisAdapter>();

  constructor() {
    this.register(new LocalTaggingAdapter());
    this.register(new LocalSegmentationAdapter());
  }

  register(adapter: AnalysisAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): AnalysisAdapter | undefined {
    return this.adapters.get(id);
  }

  list(modality?: AnalysisModality, mode?: ExecutionMode): AnalysisAdapter[] {
    return [...this.adapters.values()].filter((adapter) => {
      if (modality && !adapter.modalities.includes(modality)) return false;
      if (mode && adapter.executionMode !== mode) return false;
      return true;
    });
  }

  getOcrAdapter(mode: ExecutionMode = "local"): OcrAdapter {
    const found = this.list("ocr", mode)[0];
    if (!found) throw new Error(`No OCR adapter registered for mode: ${mode}`);
    return found as unknown as OcrAdapter;
  }

  getTaggingAdapter(mode: ExecutionMode = "local"): TaggingAdapter {
    const found = this.list("tagging", mode)[0];
    if (!found)
      throw new Error(`No tagging adapter registered for mode: ${mode}`);
    return found as unknown as TaggingAdapter;
  }

  getSegmentationAdapter(mode: ExecutionMode = "local"): SegmentationAdapter {
    const found = this.list("segmentation", mode)[0];
    if (!found)
      throw new Error(`No segmentation adapter registered for mode: ${mode}`);
    return found as unknown as SegmentationAdapter;
  }
}

export const defaultAnalysisRegistry = new AnalysisAdapterRegistry();
