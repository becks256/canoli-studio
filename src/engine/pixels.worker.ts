import {
  applyBlendIf,
  applyTone,
  instantiateKernel,
  renderSelection,
} from "./wasm";
import type { SelectionTile } from "./wasm";
import type { BlendIfData } from "../core/drawing";
import type { ToneEffectData } from "../core/model";

const kernel = fetch(`${import.meta.env.BASE_URL}wasm/pixels.wasm`)
  .then((response) => {
    if (!response.ok)
      throw new Error(
        "Could not load the WASM module. Run npm run build:wasm.",
      );
    return response.arrayBuffer();
  })
  .then(instantiateKernel);

kernel
  .then(() => self.postMessage({ type: "ready" }))
  .catch((error: Error) =>
    self.postMessage({ type: "fatal", error: error.message }),
  );

self.onmessage = async (
  event: MessageEvent<{
    id: number;
    pixels: Uint8ClampedArray;
    effects?: ToneEffectData[];
    underlying?: Uint8ClampedArray;
    blend?: BlendIfData;
    selection?: SelectionTile;
  }>,
) => {
  try {
    const data = event.data;
    const result = data.selection
      ? renderSelection(await kernel, data.selection)
      : data.blend && data.underlying
        ? applyBlendIf(await kernel, data.pixels, data.underlying, data.blend)
        : applyTone(await kernel, data.pixels, data.effects ?? []);
    self.postMessage(
      { id: event.data.id, pixels: result },
      { transfer: [result.buffer] },
    );
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error:
        error instanceof Error ? error.message : "Image processing failed.",
    });
  }
};
