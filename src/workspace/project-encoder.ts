import {ownRawSource} from "../core/interchange/raw/source";
import { sendGraph, type GraphChunk } from "./graph-transfer";
import { isImmutable } from "../core/immutable";
import type { DocumentData } from "../core/model";
import { referencedAssets } from "../core/model";
import { retainedDocuments, type RetainedHistory } from "../core/history";
import { serializeProject, type ProjectAssetSource } from "../core/project";
import {captureProjectFonts} from '../core/font-project';
import type {FontResourceInput} from '../fonts/resources';

export interface ProjectEncodingRequest {
  id: number;
  document: DocumentData;
  history: RetainedHistory;
  assets: ReturnType<ProjectAssetSource["get"]>[];
  fonts:FontResourceInput[];
}

export type ProjectEncodingMessage =
  | { id: number; type: "chunk"; chunk: GraphChunk }
  | { id: number; type: "finish"; assets: ProjectEncodingRequest["assets"];fonts:FontResourceInput[] }
  | { id: number; type: "abort" };

/** Autosave validation and JSON encoding must not monopolize the UI thread. */
export class ProjectEncoder {
  private worker?: Worker;
  private nextId = 0;
  private disposed = false;
  private pending = new Map<number, { resolve(value: Blob): void; reject(error: Error): void }>();
  encode(document: DocumentData, assets: ProjectAssetSource, history: RetainedHistory): Promise<Blob> {
    if (this.disposed) return Promise.reject(new Error("Project encoder was disposed."));
    if (typeof Worker === "undefined") return serializeProject(document, assets, history);
    if (!this.worker) {
      this.worker = new Worker(new URL("./project-encoder.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        if (data.blob instanceof Blob) entry.resolve(data.blob);
        else entry.reject(new Error(data.error ?? "Workspace encoding failed."));
      };
      this.worker.onerror = () => this.fail(new Error("Workspace encoding worker failed."));
    }
    const ids = new Set(retainedDocuments(document, history).flatMap(value => [...referencedAssets(value)]));
    const sources = [...ids].map(id => {
      const asset = assets.get(id);
      return { id: asset.id, name: asset.name, width: asset.width, height: asset.height, blob: asset.blob, ...(asset.tiff?{tiff:{...asset.tiff}}:{}),...(asset.avif?{avif:{...asset.avif}}:{}),...(asset.raw?{raw:ownRawSource(asset.raw)}:{}) };
    });
    const fonts=captureProjectFonts(retainedDocuments(document,history),assets.fonts);
    // Capture caller-owned inputs before the first asynchronous transport break.
    const snapshot = isImmutable(document) && isImmutable(history)
      ? { document, history }
      : structuredClone({ document, history });
    const worker = this.worker;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void sendGraph(snapshot, chunk => {
        if (this.worker !== worker || !this.pending.has(id)) throw new Error("Project encoding was cancelled.");
        worker.postMessage({ id, type: "chunk", chunk } satisfies ProjectEncodingMessage);
      }).then(() => {
        if (this.worker !== worker || !this.pending.has(id)) return;
        worker.postMessage({ id, type: "finish", assets: sources,fonts } satisfies ProjectEncodingMessage);
      }).catch(error => {
        if (this.worker === worker) {
          try { worker.postMessage({ id, type: "abort" } satisfies ProjectEncodingMessage); } catch { /* The original send failure is authoritative. */ }
        }
        this.pending.delete(id); reject(error);
      });
    });
  }
  private fail(error: Error) {
    this.worker?.terminate();
    this.worker = undefined;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
  dispose() {
    this.disposed = true;
    this.fail(new Error("Project encoder was disposed."));
  }
}
