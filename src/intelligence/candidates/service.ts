import { readAnalysisImage } from "./image-input";
import { isLocked } from "../../core/model";
import { layerOrigin } from "../../core/spatial";
import { AnalysisAdapterRegistry } from "../adapters/registry";
import type { ImageAsset } from "../../core/assets";
import {
  Document,
  Layer,
  LayerMask,
  TextLayer,
  RasterLayer,
  VectorPath,
  VectorContour,
} from "../../dom";
import { MarqueeSelection } from "../../dom/values";
import { defaultAnalysisRegistry } from "../adapters/registry";
import type {
  AnalysisImageInput,
  AnalysisModality,
  ExecutionMode,
} from "../adapters/types";
import type {
  AnalysisCandidate,
  OcrCandidate,
  SegmentationCandidate,
  TagCandidate,
} from "./types";

export interface AnalysisState {
  running: boolean;
  error?: string;
}

/**
 * Service managing analysis jobs and the lifecycle of proposed/accepted/rejected candidates.
 * Staged candidates remain separate from document history until explicitly accepted.
 */
export class AnalysisService {
  constructor(
    private registry: AnalysisAdapterRegistry = defaultAnalysisRegistry,
    private readImage: (
      asset: ImageAsset,
    ) => AnalysisImageInput = readAnalysisImage,
  ) {}
  private contexts = new Map<
    string,
    { document: Document; width: number; height: number }
  >();
  private candidates = new Map<string, AnalysisCandidate[]>();
  private states = new Map<string, AnalysisState>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish() {
    this.listeners.forEach((listener) => listener());
  }

  private static readonly EMPTY_CANDIDATES: AnalysisCandidate[] = [];
  private static readonly IDLE_STATE: AnalysisState = { running: false };

  getCandidates(layerId?: string): AnalysisCandidate[] {
    if (layerId) {
      return this.candidates.get(layerId) ?? AnalysisService.EMPTY_CANDIDATES;
    }
    const all: AnalysisCandidate[] = [];
    for (const list of this.candidates.values()) {
      all.push(...list);
    }
    return all;
  }

  getState(layerId: string): AnalysisState {
    return this.states.get(layerId) ?? AnalysisService.IDLE_STATE;
  }

  async runAnalysis(
    layer: Layer,
    asset: ImageAsset,
    modality: AnalysisModality,
    mode: ExecutionMode = "local",
    options: Record<string, unknown> = {},
  ): Promise<AnalysisCandidate[]> {
    const layerId = layer.id;
    this.states.set(layerId, { running: true });
    this.publish();

    try {
      if (
        !(layer instanceof RasterLayer) ||
        layer.assetId !== asset.id ||
        !layer.document
      )
        throw new Error("Analysis requires an attached source image layer.");
      const owner = layer.document;
      const input = this.readImage(asset);

      const now = Date.now();
      const newCandidates: AnalysisCandidate[] = [];

      if (modality === "ocr") {
        const adapter = this.registry.getOcrAdapter(mode);
        const result = await adapter.analyzeOcr(input, {
          consentGiven: mode === "local" ? true : Boolean(options.consentGiven),
          ...options,
        });

        for (const block of result.blocks) {
          const candidate: OcrCandidate = {
            id: `cand-ocr-${Math.random().toString(36).slice(2, 9)}`,
            kind: "ocr",
            status: "proposed",
            layerId,
            assetId: asset.id,
            adapterId: adapter.id,
            origin: mode,
            confidence: block.confidence,
            timestamp: now,
            text: block.text,
            bounds: block.bounds,
            language: block.language,
          };
          newCandidates.push(candidate);
        }
      } else if (modality === "tagging") {
        const adapter = this.registry.getTaggingAdapter(mode);
        const result = await adapter.analyzeTags(input, {
          consentGiven: mode === "local" ? true : Boolean(options.consentGiven),
          ...options,
        });

        for (const item of result.tags) {
          const candidate: TagCandidate = {
            id: `cand-tag-${Math.random().toString(36).slice(2, 9)}`,
            kind: "tag",
            status: "proposed",
            layerId,
            assetId: asset.id,
            adapterId: adapter.id,
            origin: mode,
            confidence: item.confidence,
            timestamp: now,
            tag: item.tag,
            category: item.category,
          };
          newCandidates.push(candidate);
        }
      } else if (modality === "segmentation") {
        const adapter = this.registry.getSegmentationAdapter(mode);
        const result = await adapter.analyzeSegmentation(input, {
          consentGiven: mode === "local" ? true : Boolean(options.consentGiven),
          ...options,
        });

        for (const item of result.candidates) {
          const maskOptions = item.selectionData
            ? { selection: item.selectionData }
            : item.paths
              ? { paths: item.paths, fillRule: "evenodd" as const }
              : { base: item.baseCoverage ?? 1 };

          const candidate: SegmentationCandidate = {
            id: `cand-seg-${Math.random().toString(36).slice(2, 9)}`,
            kind: "segmentation",
            status: "proposed",
            layerId,
            assetId: asset.id,
            adapterId: adapter.id,
            origin: mode,
            confidence: item.confidence,
            timestamp: now,
            label: item.label,
            bounds: item.bounds,
            maskOptions,
          };
          newCandidates.push(candidate);
        }
      }

      if (
        layer.document !== owner ||
        !layer.isAttached ||
        layer.assetId !== asset.id
      )
        throw new Error("The source image changed during analysis.");
      for (const candidate of newCandidates)
        this.contexts.set(candidate.id, {
          document: owner,
          width: input.width,
          height: input.height,
        });
      const existing = this.candidates.get(layerId) ?? [];
      this.candidates.set(layerId, [...existing, ...newCandidates]);
      this.states.set(layerId, { running: false });
      this.publish();

      return newCandidates;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.states.set(layerId, { running: false, error: message });
      this.publish();
      throw err;
    }
  }

  acceptCandidate(
    document: Document,
    candidate: AnalysisCandidate,
    ocrTarget: "text-layer" | "selection" = "text-layer",
  ): void {
    candidate = this.proposed(candidate);
    const context = this.contexts.get(candidate.id)!;
    if (context.document !== document)
      throw new Error("This candidate belongs to another document.");
    const layer = document.getLayer(candidate.layerId);
    if (!layer) {
      throw new Error(`Target layer ${candidate.layerId} was removed.`);
    }
    if (!(layer instanceof RasterLayer) || layer.assetId !== candidate.assetId)
      throw new Error("The source image changed.");
    if (isLocked(document.toJSON(), layer.id)) {
      throw new Error("Unlock the layer before accepting analysis candidates.");
    }

    const sx = layer.width / context.width,
      sy = layer.height / context.height;
    const origin = layerOrigin(document.toJSON(), layer.id)!;
    const bounds =
      candidate.kind === "tag"
        ? null
        : {
            x: origin.x + candidate.bounds.x * sx,
            y: origin.y + candidate.bounds.y * sy,
            width: candidate.bounds.width * sx,
            height: candidate.bounds.height * sy,
          };
    if (candidate.kind === "tag") {
      document.transaction(`Accept tag: ${candidate.tag}`, () => {
        const existing = layer.metadata.keywords;
        if (!existing.includes(candidate.tag)) {
          layer.metadata.keywords = [...existing, candidate.tag];
        }
      });
    } else if (candidate.kind === "ocr") {
      if (ocrTarget === "text-layer") {
        document.transaction(`Create OCR Text Layer`, () => {
          const textLayer = new TextLayer({
            name: `OCR: ${candidate.text.slice(0, 16)}`,
            text: candidate.text,
            x: bounds!.x,
            y: bounds!.y,
            fontSize: Math.max(14, Math.round(bounds!.height * 0.75)),
          });
          document.layers.add(textLayer);
        });
      } else {
        document.transaction("Set OCR selection", () => {
          document.selection = new MarqueeSelection({
            ...bounds!,
            shape: "rectangle",
          });
        });
      }
    } else if (candidate.kind === "segmentation") {
      document.transaction(`Apply ${candidate.label}`, () => {
        const options = candidate.maskOptions;
        if (options.selection) {
          const data = options.selection.toJSON();
          layer.mask = new LayerMask({
            ...options,
            selection: new MarqueeSelection({
              ...data,
              regions: data.regions.map((r) => ({
                ...r,
                x: r.x * sx,
                y: r.y * sy,
                width: r.width * sx,
                height: r.height * sy,
              })),
            }),
          });
        } else if (options.paths) {
          const point = (p: { x: number; y: number }) => ({
            x: p.x * sx,
            y: p.y * sy,
          });
          layer.mask = new LayerMask({
            ...options,
            paths: options.paths.map(
              (path) =>
                new VectorPath({
                  closed: path.closed,
                  fillRule: path.fillRule,
                  subpaths: [...path.subpaths].map(contour => new VectorContour({ points: contour.points.map(p => ({ ...point(p), in: point(p.in), out: point(p.out) })) })),
                  points: path.points.map((p) => ({
                    ...point(p),
                    in: point(p.in),
                    out: point(p.out),
                  })),
                }),
            ),
          });
        } else layer.mask = new LayerMask(options);
      });
    }

    this.setStatus(candidate, "accepted");
  }

  private proposed(candidate: AnalysisCandidate) {
    const current = this.getCandidates(candidate.layerId).find(
      (c) => c.id === candidate.id,
    );
    if (!current || current.status !== "proposed")
      throw new Error("This candidate is no longer proposed.");
    return current;
  }
  private setStatus(
    candidate: AnalysisCandidate,
    status: "accepted" | "rejected",
  ) {
    this.candidates.set(
      candidate.layerId,
      this.getCandidates(candidate.layerId).map((c) =>
        c.id === candidate.id ? { ...c, status } : c,
      ),
    );
    this.publish();
  }

  rejectCandidate(candidate: AnalysisCandidate): void {
    this.setStatus(this.proposed(candidate), "rejected");
  }

  clearCandidates(layerId?: string): void {
    for (const candidate of this.getCandidates(layerId))
      this.contexts.delete(candidate.id);
    if (layerId) {
      this.candidates.delete(layerId);
      this.states.delete(layerId);
    } else {
      this.candidates.clear();
      this.states.clear();
    }
    this.publish();
  }
}
