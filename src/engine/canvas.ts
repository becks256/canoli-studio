import { AffineTransform } from "../core/affine";

export interface RenderSpace {
  x: number;
  y: number;
  width: number;
  height: number;
  sx: number;
  sy: number;
}
export function createCanvas(
  width: number,
  height: number,
  readback = false,
): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  const context = result.getContext("2d", { willReadFrequently: readback });
  try {
    if (!context || result.width !== width || result.height !== height)
      throw new Error();
    // Pixel probes on drawing surfaces force an unnecessary GPU readback.
    // Keep the allocation probe on buffers explicitly intended for CPU reads.
    if (readback) {
      context.fillRect(width - 1, height - 1, 1, 1);
      if (context.getImageData(width - 1, height - 1, 1, 1).data[3] !== 255)
        throw new Error();
      context.clearRect(width - 1, height - 1, 1, 1);
    }
  } catch {
    release(result);
    throw new Error(
      "The browser could not allocate an image working buffer. Free device memory and retry.",
    );
  }
  return result;
}
export function release(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 0;
}
export function transform(
  context: CanvasRenderingContext2D,
  space: RenderSpace,
  x = 0,
  y = 0,
) {
  applyTransform(context, space, AffineTransform.translation(x, y));
}

/** Rebase in double precision before scaling or passing coordinates to Canvas/GPU. */
export function renderTransform(
  space: RenderSpace,
  world: AffineTransform,
): AffineTransform {
  return new AffineTransform(
    space.sx * world.a,
    space.sy * world.b,
    space.sx * world.c,
    space.sy * world.d,
    (world.e - space.x) * space.sx,
    (world.f - space.y) * space.sy,
  );
}

export function applyTransform(
  context: CanvasRenderingContext2D,
  space: RenderSpace,
  world: AffineTransform,
) {
  const matrix = renderTransform(space, world);
  context.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e,
    matrix.f,
  );
}
