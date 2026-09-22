import type { PixelProcessor } from "./processor";
import type { AssetStore } from "../core/assets";
import type {
  PaintLayerData,
  TextLayerData,
  VectorLayerData,
} from "../core/model";
import { pathBounds, strokeBounds } from "../core/drawing";
import type {
  BrushStrokeData,
  Rect,
  SelectionData,
  StrokePoint,
  VectorPathData,
} from "../core/drawing";
import { createCanvas, release, transform } from "./canvas";
import type { RenderSpace } from "./canvas";
import type { CanvasCache } from "./cache";

function overlaps(bounds: Rect, space: RenderSpace, x: number, y: number) {
  return (
    bounds.x + x < space.x + space.width / space.sx &&
    bounds.x + bounds.width + x > space.x &&
    bounds.y + y < space.y + space.height / space.sy &&
    bounds.y + bounds.height + y > space.y
  );
}
export async function selectionMask(
  selection: SelectionData,
  space: RenderSpace,
  x: number,
  y: number,
  processor: PixelProcessor,
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(space.width, space.height),
    c = canvas.getContext("2d")!;
  try {
    for (let ty = 0; ty < space.height; ty += 1024)
      for (let tx = 0; tx < space.width; tx += 1024) {
        const width = Math.min(1024, space.width - tx),
          height = Math.min(1024, space.height - ty);
        const data = await processor.selection({
          selection,
          width,
          height,
          x: space.x - x + tx / space.sx,
          y: space.y - y + ty / space.sy,
          stepX: 1 / space.sx,
          stepY: 1 / space.sy,
        });
        const tile = c.createImageData(width, height);
        tile.data.set(data);
        c.putImageData(tile, tx, ty);
      }
    return canvas;
  } catch (error) {
    release(canvas);
    throw error;
  }
}
function stamp(
  context: CanvasRenderingContext2D,
  stroke: BrushStrokeData,
  point: StrokePoint,
) {
  const size = stroke.size * Math.max(0.05, point.pressure),
    radius = size / 2;
  if (stroke.kind === "pencil") {
    const width = Math.max(1, Math.round(size));
    context.fillStyle = stroke.color;
    context.fillRect(
      Math.floor(point.x - width / 2),
      Math.floor(point.y - width / 2),
      width,
      width,
    );
    return;
  }
  const color = stroke.kind === "clone" ? "#ffffff" : stroke.color;
  if (stroke.hardness >= 0.999) context.fillStyle = color;
  else {
    const gradient = context.createRadialGradient(
      point.x,
      point.y,
      radius * stroke.hardness,
      point.x,
      point.y,
      radius,
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, `${color}00`);
    context.fillStyle = gradient;
  }
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}
export function visitStrokeStamps(
  visit: (point: StrokePoint) => void,
  stroke: BrushStrokeData,
  visible: Rect,
  from = 0,
) {
  const padding = stroke.size / 2 + 2;
  const inView = (p: StrokePoint) =>
    p.x >= visible.x - padding &&
    p.x <= visible.x + visible.width + padding &&
    p.y >= visible.y - padding &&
    p.y <= visible.y + visible.height + padding;
  if (from === 0 && inView(stroke.points[0])) visit(stroke.points[0]);
  for (let i = Math.max(1, from); i < stroke.points.length; i++) {
    const a = stroke.points[i - 1],
      b = stroke.points[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length =
      stroke.kind === "pencil"
        ? Math.max(Math.abs(dx), Math.abs(dy))
        : Math.hypot(dx, dy);
    const spacing =
      stroke.kind === "pencil"
        ? 1
        : Math.max(
            0.5,
            stroke.size *
              0.12 *
              Math.max(0.05, Math.min(a.pressure, b.pressure)),
          );
    const count = Math.max(1, Math.ceil(length / spacing));
    // Clip the parameter interval before stepping, retaining the same stamp grid
    // on every viewport/export tile to avoid seams.
    let low = 0,
      high = 1;
    for (const [start, delta, min, max] of [
      [a.x, dx, visible.x - padding, visible.x + visible.width + padding],
      [a.y, dy, visible.y - padding, visible.y + visible.height + padding],
    ]) {
      if (delta === 0) {
        if (start < min || start > max) {
          high = -1;
          break;
        }
      } else {
        const t0 = (min - start) / delta,
          t1 = (max - start) / delta;
        low = Math.max(low, Math.min(t0, t1));
        high = Math.min(high, Math.max(t0, t1));
      }
    }
    for (
      let step = Math.max(1, Math.ceil(low * count));
      step <= Math.min(count, Math.floor(high * count));
      step++
    ) {
      const t = step / count;
      visit({
        x: a.x + dx * t,
        y: a.y + dy * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      });
    }
  }
}
function drawStroke(context: CanvasRenderingContext2D, stroke: BrushStrokeData, visible: Rect, from = 0) {
  visitStrokeStamps((point) => stamp(context, stroke, point), stroke, visible, from);
}

/** One append-only gesture surface. Never apply clip/opacity to this surface:
 * doing so repeatedly would darken overlaps or erode antialiased mask edges. */
export class ActiveStrokeRaster {
  private canvas: HTMLCanvasElement | null = null;
  private signature = "";
  private points: StrokePoint[] = [];
  clear() {
    if (this.canvas) release(this.canvas);
    this.canvas = null;
    this.points = [];
    this.signature = "";
  }
  draw(stroke: BrushStrokeData, target: HTMLCanvasElement, space: RenderSpace, x: number, y: number) {
    const { points, ...settings } = stroke;
    const signature = JSON.stringify([settings, space, x, y]);
    const reusable = signature === this.signature && points.length >= this.points.length &&
      this.points.every((p, i) => p === points[i] ||
        (p.x === points[i].x && p.y === points[i].y && p.pressure === points[i].pressure));
    if (!reusable) this.clear();
    // Oversized effect halos use the normal ephemeral path rather than retain
    // an unbounded canvas. The source/document is never resized or rejected.
    const retain = space.width * space.height * 4 <= 16 * 1024 * 1024;
    const canvas = retain ? (this.canvas ??= createCanvas(space.width, space.height)) : target;
    const c = canvas.getContext("2d")!;
    transform(c, space, x, y);
    drawStroke(c, stroke, {
      x: space.x - x, y: space.y - y,
      width: space.width / space.sx, height: space.height / space.sy,
    }, retain ? this.points.length : 0);
    c.resetTransform();
    if (retain) {
      this.signature = signature;
      this.points = points;
      target.getContext("2d")!.drawImage(canvas, 0, 0);
    }
  }
}

export async function drawPaint(
  layer: PaintLayerData,
  assets: AssetStore,
  target: HTMLCanvasElement,
  space: RenderSpace,
  x: number,
  y: number,
  processor: PixelProcessor,
  active?: ActiveStrokeRaster,
  masks?: CanvasCache,
  canCache: () => boolean = () => true,
) {
  const targetContext = target.getContext("2d")!;
  for (const stroke of layer.strokes) {
    if (!overlaps(strokeBounds(stroke), space, x, y)) continue;
    let surface = createCanvas(space.width, space.height);
    try {
      const context = surface.getContext("2d")!;
      transform(context, space, x, y);
      if (stroke.kind === "fill") {
        context.fillStyle = stroke.color;
        context.fillRect(
          stroke.bounds.x,
          stroke.bounds.y,
          stroke.bounds.width,
          stroke.bounds.height,
        );
      } else if (active && stroke.kind !== "clone") {
        context.resetTransform();
        active.draw(stroke, surface, space, x, y);
      } else
        drawStroke(context, stroke, {
          x: space.x - x,
          y: space.y - y,
          width: space.width / space.sx,
          height: space.height / space.sy,
        });
      context.resetTransform();
      if (stroke.kind === "clone") {
        const clone = createCanvas(space.width, space.height);
        const c = clone.getContext("2d")!;
        transform(c, space, x, y);
        for (const tile of stroke.tiles)
          if (overlaps(tile, space, x, y))
            c.drawImage(
              assets.get(tile.assetId).bitmap,
              tile.x,
              tile.y,
              tile.width,
              tile.height,
            );
        c.resetTransform();
        c.globalCompositeOperation = "destination-in";
        c.drawImage(surface, 0, 0);
        release(surface);
        surface = clone;
      }
      if (stroke.clip) {
        const signature = JSON.stringify([stroke.clip, space, x, y]);
        let mask = createCanvas(space.width, space.height);
        try {
          if (!masks?.read("selection", signature, mask)) {
            release(mask);
            mask = await selectionMask(stroke.clip, space, x, y, processor);
            if (canCache()) masks?.write("selection", signature, mask);
          }
          const c = surface.getContext("2d")!;
          c.globalCompositeOperation = "destination-in";
          c.drawImage(mask, 0, 0);
        } finally { release(mask); }
      }
      targetContext.save();
      targetContext.globalAlpha = stroke.opacity;
      targetContext.globalCompositeOperation =
        stroke.kind === "fill" && stroke.erase
          ? "destination-out"
          : "source-over";
      targetContext.drawImage(surface, 0, 0);
      targetContext.restore();
    } finally {
      release(surface);
    }
  }
}
export function tracePath(
  context: CanvasRenderingContext2D,
  path: VectorPathData,
) {
  const first = path.points[0];
  context.beginPath();
  context.moveTo(first.x, first.y);
  const count = path.points.length;
  for (let i = 1; i < count + (path.closed ? 1 : 0); i++) {
    const previous = path.points[i - 1],
      point = path.points[i % count];
    context.bezierCurveTo(
      previous.out.x,
      previous.out.y,
      point.in.x,
      point.in.y,
      point.x,
      point.y,
    );
  }
  if (path.closed) context.closePath();
}
export function drawVectors(
  layer: VectorLayerData,
  target: HTMLCanvasElement,
  space: RenderSpace,
  x: number,
  y: number,
) {
  const context = target.getContext("2d")!;
  context.save();
  transform(context, space, x, y);
  for (const path of layer.paths) {
    if (!overlaps(pathBounds(path), space, x, y)) continue;
    tracePath(context, path);
    if (path.fill && path.closed) {
      context.fillStyle = path.fill;
      context.fill();
    }
    if (path.stroke && path.strokeWidth > 0) {
      context.lineWidth = path.strokeWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = path.stroke;
      context.stroke();
    }
  }
  context.restore();
}

export function drawText(
  layer: TextLayerData,
  target: HTMLCanvasElement,
  space: RenderSpace,
  x: number,
  y: number,
) {
  const context = target.getContext("2d")!;
  context.save();
  transform(context, space, x, y);
  context.font = `${layer.fontSize}px ${layer.fontFamily}`;
  context.fillStyle = layer.color;
  context.textAlign = layer.align;
  context.textBaseline = "top";
  const lines = layer.text.split("\n");
  const lineHeightPx = layer.fontSize * layer.lineHeight;
  for (let i = 0; i < lines.length; i++) {
    let lineX = 0;
    if (layer.align === "center") {
      lineX = layer.width / 2;
    } else if (layer.align === "right") {
      lineX = layer.width;
    }
    context.fillText(lines[i], lineX, i * lineHeightPx);
  }
  context.restore();
}
