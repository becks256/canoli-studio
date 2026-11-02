import type { VectorPathData } from "../core/drawing";
import { pathBounds } from "../core/drawing";
import type { VectorLayerData } from "../core/model";
import { AffineTransform } from "../core/affine";
import {
  compileFloatVectorGradient,
  linearVectorColor,
} from "../core/float-vector-gradient";
import {
  validateWindow,
  type FloatSourceWindow,
} from "../core/float-source/types";
import { yieldTask } from "../core/task-yield";
import { validateFloatAlpha } from "../core/float-shadow";
import { drawVectorsNative } from "./drawing";
import { createCanvas, release } from "./canvas";
import type { PixelProcessor } from "./processor";
import { validateFloatWorkerWindow } from "./float-pixels";

type Phase = "fill" | "stroke";
export type FloatVectorCoverage = (
  path: VectorPathData,
  phase: Phase,
  area: FloatSourceWindow,
  world: AffineTransform,
  check: () => void,
) => Promise<Float32Array>;

/** Fixed world-lattice cells make native antialias coverage independent of
 * viewport crops/export strips. Canvas carries white alpha only. */
export const renderFloatVectorCoverage: FloatVectorCoverage = async (
  path,
  phase,
  input,
  world,
  check,
) => {
  check();
  const area = validateWindow(input),
    output = new Float32Array(area.width * area.height),
    cell = 256,
    gutter = 2;
  const neutral = {
    ...path,
    fillGradient: null,
    fill: phase === "fill" ? "#ffffff" : null,
    stroke: phase === "stroke" ? "#ffffff" : null,
  };
  const bounds = world.bounds(pathBounds(neutral));
  for (
    let y = Math.floor(area.y / cell) * cell;
    y < area.y + area.height;
    y += cell
  )
    for (
      let x = Math.floor(area.x / cell) * cell;
      x < area.x + area.width;
      x += cell
    ) {
      check();
      if (
        bounds.x >= x + cell + gutter ||
        bounds.y >= y + cell + gutter ||
        bounds.x + bounds.width <= x - gutter ||
        bounds.y + bounds.height <= y - gutter
      )
        continue;
      const canvas = createCanvas(cell + 2 * gutter, cell + 2 * gutter, true);
      try {
        drawVectorsNative(
          { paths: [neutral] },
          canvas,
          {
            x: x - gutter,
            y: y - gutter,
            width: canvas.width,
            height: canvas.height,
            sx: 1,
            sy: 1,
          },
          world,
        );
        check();
        const left = Math.max(x, area.x),
          top = Math.max(y, area.y),
          width = Math.min(x + cell, area.x + area.width) - left,
          height = Math.min(y + cell, area.y + area.height) - top;
        const bytes = canvas
          .getContext("2d")!
          .getImageData(
            left - x + gutter,
            top - y + gutter,
            width,
            height,
          ).data;
        for (let row = 0; row < height; row++)
          for (let column = 0; column < width; column++)
            output[(top - area.y + row) * area.width + left - area.x + column] =
              bytes[(row * width + column) * 4 + 3] / 255;
      } finally {
        release(canvas);
      }
      await yieldTask();
      check();
    }
  check();
  return output;
};

/** Keep authored path/fill/stroke order. Only geometry coverage is byte based;
 * stop colors, alpha, overlap, layer Fill and styles remain native float. */
export async function renderFloatVector(
  layer: Pick<VectorLayerData, "paths">,
  input: FloatSourceWindow,
  world: AffineTransform,
  processor: Pick<PixelProcessor, "floatComposite">,
  check: () => void,
  coverage: FloatVectorCoverage = renderFloatVectorCoverage,
): Promise<Float32Array> {
  check();
  const area = validateWindow(input);
  let output: Float32Array = new Float32Array(area.width * area.height * 4);
  for (const path of layer.paths)
    for (const phase of ["fill", "stroke"] as const) {
      check();
      if (
        phase === "fill"
          ? !(path.closed && (path.fillGradient || path.fill))
          : !(path.stroke && path.strokeWidth > 0)
      )
        continue;
      const sample =
          phase === "fill" && path.fillGradient
            ? compileFloatVectorGradient(path.fillGradient, world)
            : null,
        color = sample
          ? null
          : linearVectorColor((phase === "fill" ? path.fill : path.stroke)!);
      const mask = await coverage(path, phase, area, world, check);
      check();
      validateFloatAlpha(mask, area.width * area.height);
      const source = new Float32Array(output.length);
      let deadline = performance.now() + 2;
      for (let y = 0; y < area.height; y++)
        for (let x = 0; x < area.width; x++) {
          const i = y * area.width + x;
          if (mask[i] !== 0) {
            const gx = area.x + x,
              gy = area.y + y,
              cx = Math.floor(gx / 256) * 256,
              cy = Math.floor(gy / 256) * 256,
              rgba = sample
                ? sample(gx - cx + 0.5, gy - cy + 0.5, cx, cy)
                : color!,
              p = i * 4;
            source[p] = rgba[0];
            source[p + 1] = rgba[1];
            source[p + 2] = rgba[2];
            source[p + 3] = rgba[3] * mask[i];
          }
          if ((i & 511) === 0 && performance.now() >= deadline) {
            check();
            await yieldTask();
            check();
            deadline = performance.now() + 2;
          }
        }
      check();
      const next = await processor.floatComposite(source, output, {
        mode: "normal",
      });
      check();
      validateFloatWorkerWindow(next);
      if (next.length !== output.length)
        throw new Error(
          "Float vector composition returned the wrong geometry.",
        );
      output = next;
    }
  check();
  return output;
}
