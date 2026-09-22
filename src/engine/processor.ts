import type { BlendIfData } from "../core/drawing";
import type { ToneEffectData } from "../core/model";
import type { SelectionTile } from "./wasm";

export class PixelProcessor {
  private worker = new Worker(new URL("./pixels.worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve(value: Uint8ClampedArray): void; reject(error: Error): void }
  >();
  readonly ready: Promise<void>;
  private failure: Error | null = null;

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        this.failure = error;
        reject(error);
        this.pending.forEach((request) => request.reject(error));
        this.pending.clear();
      };
      this.worker.onerror = () =>
        fail(new Error("Image worker failed. Reload to restart it."));
      this.worker.onmessage = (event) => {
        if (event.data.type === "ready") {
          resolve();
          return;
        }
        if (event.data.type === "fatal") {
          fail(new Error(event.data.error));
          return;
        }
        const request = this.pending.get(event.data.id);
        if (!request) return;
        this.pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.pixels);
      };
    });
  }

  process(
    pixels: Uint8ClampedArray,
    effects: ToneEffectData[],
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels, { effects });
  }
  blendIf(
    pixels: Uint8ClampedArray,
    underlying: Uint8ClampedArray,
    blend: BlendIfData,
  ): Promise<Uint8ClampedArray> {
    return this.request(pixels, { underlying, blend });
  }
  selection(tile: SelectionTile): Promise<Uint8ClampedArray> {
    return this.request(new Uint8ClampedArray(0), { selection: tile });
  }
  private async request(
    pixels: Uint8ClampedArray,
    payload: {
      effects?: ToneEffectData[];
      underlying?: Uint8ClampedArray;
      blend?: BlendIfData;
      selection?: SelectionTile;
    },
  ): Promise<Uint8ClampedArray> {
    await this.ready;
    if (this.failure) throw this.failure;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(
        { id, pixels, ...payload },
        payload.underlying
          ? [pixels.buffer, payload.underlying.buffer]
          : [pixels.buffer],
      );
    });
  }

  dispose() {
    this.failure = new Error("Image worker closed.");
    this.worker.terminate();
    this.pending.forEach((request) => request.reject(this.failure!));
    this.pending.clear();
  }
}
