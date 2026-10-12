import { yieldTask } from "./task-yield";
import type { AssetStore } from "../core/assets";
import type { DocumentData, LayerData } from "../core/model";
import type { RetouchSamplingOptions } from "../core/retouch/types";
import type { DocumentRenderer, RenderRegion } from "./renderer";
import { release } from "./canvas";

/** Capture once; retain ancestor transforms, masks and compositing for the selected branch. */
export function retouchViewDocument(
  document: DocumentData,
  options: RetouchSamplingOptions,
): DocumentData {
  const snapshot = document;
  if (options.mode === "all-layers") return snapshot;
  if (options.mode !== "current-layer" && options.mode !== "current-and-below")
    throw new Error("Unknown retouch sampling mode.");
  if (!options.layerId)
    throw new Error("Retouch sampling requires a selected layer.");
  const prune = (nodes: LayerData[]): LayerData[] | undefined => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const preceding =
        options.mode === "current-and-below" ? nodes.slice(0, i) : [];
      if (node.id === options.layerId) return [...preceding, node];
      if (node.kind === "group") {
        const children = prune(node.children);
        if (children) return [...preceding, { ...node, children }];
      }
    }
    return undefined;
  };
  const children = prune(snapshot.children);
  if (!children) throw new Error("Retouch sampling layer was not found.");
  return { ...snapshot, children };
}

/** Detach only the requested branch, rather than first cloning unrelated artwork. */
export function retouchSampleDocument(document: DocumentData, options: RetouchSamplingOptions): DocumentData {
  return structuredClone(retouchViewDocument(document, options));
}

/** Bounded readback surfaces, native document pixels and no live-document writes. */
export async function sampleRetouchRegion(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  region: RenderRegion,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  const { x, y, width, height } = region;
  if (
    ![x, y, width, height, x + width, y + height, width * height * 4].every(
      Number.isSafeInteger,
    ) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Retouch sampling requires safe integer pixel geometry.");
  }
  signal?.throwIfAborted();
  // A single readback already owns a fresh native-resolution RGBA buffer.
  // Allocate assembly storage only when several tiles must be combined.
  const pixels = width <= 1024 && height <= 1024
    ? null : new Uint8ClampedArray(width * height * 4);
  let deadline = performance.now() + 4;
  for (let ty = 0; ty < height; ty += 1024)
    for (let tx = 0; tx < width; tx += 1024) {
      signal?.throwIfAborted();
      const w = Math.min(1024, width - tx),
        h = Math.min(1024, height - ty);
      const canvas = await renderer.render(document, assets, {
        region: { x: x + tx, y: y + ty, width: w, height: h },
        outputSize: { width: w, height: h },
        cache: false,
        readback: true,
      });
      try {
        signal?.throwIfAborted();
        if (canvas.width !== w || canvas.height !== h)
          throw new Error(
            "Retouch sampling requires native-resolution rendering.",
          );
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("Retouch sampling could not read image pixels.");
        const tile = context.getImageData(0, 0, w, h).data;
        if (!pixels) return tile;
        if (w === width) pixels.set(tile, ty * width * 4);
        else for (let row = 0; row < h; row++)
          pixels.set(
            tile.subarray(row * w * 4, (row + 1) * w * 4),
            ((ty + row) * width + tx) * 4,
          );
      } finally {
        release(canvas);
      }
      // Keep the exact native tile grid, but do not join every tile into one
      // long microtask chain that prevents pending input from being handled.
      if ((tx + w < width || ty + h < height) && performance.now() >= deadline) {
        await yieldTask();
        deadline = performance.now() + 4;
      }
    }
  return pixels!;
}

export interface RetouchPixelWindow {
  region: RenderRegion;
  pixels: Uint8ClampedArray;
}
/** Copy native pixels only when the captured window covers the complete request. */
export function extractRetouchRegion(
  window: RetouchPixelWindow,
  region: RenderRegion,
): Uint8ClampedArray | null {
  for (const r of [window.region, region]) {
    if (
      ![
        r.x,
        r.y,
        r.width,
        r.height,
        r.x + r.width,
        r.y + r.height,
        r.width * r.height * 4,
      ].every(Number.isSafeInteger) ||
      r.width <= 0 ||
      r.height <= 0
    )
      throw new Error(
        "Retouch extraction requires safe integer pixel geometry.",
      );
  }
  const source = window.region;
  if (window.pixels.length !== source.width * source.height * 4)
    throw new Error("Retouch window pixels do not match its geometry.");
  if (
    region.x < source.x ||
    region.y < source.y ||
    region.x + region.width > source.x + source.width ||
    region.y + region.height > source.y + source.height
  )
    return null;
  const result = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y++) {
    const start =
      ((region.y - source.y + y) * source.width + region.x - source.x) * 4;
    result.set(
      window.pixels.subarray(start, start + region.width * 4),
      y * region.width * 4,
    );
  }
  return result;
}
