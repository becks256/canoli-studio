import {gradientStopColor,type VectorGradientData} from '../core/vector-gradient';
import {applyTextStyle, measureStyledText,assertTextStyleSupport} from '../core/text-style';
import {vectorStrokeValues,zeroLengthStrokePoint,strokeDashAtOrigin} from '../core/vector-stroke';
import {strokeStamps,paintStampSize,paintStampAlpha} from '../core/paint-stamps';
import { checkRenderCurrent } from "./render-control";
import { yieldTask } from "./task-yield";
import { strokeIntersectsRegion } from "./stroke-region";
import type { ClonePreviewSource } from "./clone-preview";
import { AffineTransform } from "../core/affine";
import type { PixelProcessor } from "./processor";
import type { AssetStore } from "../core/assets";
import type {
  PaintLayerData,
  TextLayerData,
  VectorLayerData,
} from "../core/model";
import { pathBounds, pathContours, strokeBounds } from "../core/drawing";
import {layoutText, type TextLayout} from '../core/text-layout';
import type {
  BrushStrokeData,
  Rect,
  SelectionData,
  StrokePoint,
  VectorPathData,
} from "../core/drawing";
import { createCanvas, release, applyTransform } from "./canvas";
import type { RenderSpace } from "./canvas";
import type { CanvasCache } from "./cache";
import type { LayerMaskData } from "../core/masks";

export function overlaps(bounds: Rect, space: RenderSpace, x: number, y: number) {
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
  world = AffineTransform.translation(x, y),
): Promise<HTMLCanvasElement> {
  const inverse = world.inverse();
  const canvas = createCanvas(space.width, space.height),
    c = canvas.getContext("2d")!;
  try {
    for (let ty = 0; ty < space.height; ty += 1024)
      for (let tx = 0; tx < space.width; tx += 1024) {
        const width = Math.min(1024, space.width - tx),
          height = Math.min(1024, space.height - ty);
        const base = inverse.point({ x: space.x, y: space.y });
        const origin = {
          x: base.x + (inverse.a * tx) / space.sx + (inverse.c * ty) / space.sy,
          y: base.y + (inverse.b * tx) / space.sx + (inverse.d * ty) / space.sy,
        };
        const data = await processor.selection({
          selection,
          width,
          height,
          x: origin.x,
          y: origin.y,
          stepX: inverse.a / space.sx,
          stepY: inverse.d / space.sy,
          stepXY: inverse.c / space.sy,
          stepYX: inverse.b / space.sx,
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
  const size = paintStampSize(stroke, point);
  const radius = size / 2;
  const prevAlpha = context.globalAlpha;
  const alpha = paintStampAlpha(stroke, point, prevAlpha);
  if (alpha !== prevAlpha) {
    context.globalAlpha = alpha;
  }
  if (stroke.kind === "pencil") {
    const width = Math.max(1, Math.round(size));
    context.fillStyle = stroke.color;
    context.fillRect(
      Math.floor(point.x - width / 2),
      Math.floor(point.y - width / 2),
      width,
      width,
    );
    if (alpha !== prevAlpha) context.globalAlpha = prevAlpha;
    return;
  }
  const color =
    stroke.kind === "clone" || stroke.kind === "eraser"
      ? "#000000"
      : stroke.color;
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
  if (alpha !== prevAlpha) context.globalAlpha = prevAlpha;
}
export function visitStrokeStamps(
  visit: (point: StrokePoint) => void,
  stroke: BrushStrokeData,
  visible: Rect,
  from = 0,
) {
  for (const point of strokeStamps(stroke, visible, from)) visit(point);
}
function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: BrushStrokeData,
  visible: Rect,
  from = 0,
) {
  visitStrokeStamps(
    (point) => stamp(context, stroke, point),
    stroke,
    visible,
    from,
  );
}

function visibleLocalBounds(space: RenderSpace, world: AffineTransform): Rect {
  return world.inverse().bounds({
    x: space.x,
    y: space.y,
    width: space.width / space.sx,
    height: space.height / space.sy,
  });
}

/** One append-only gesture surface. Never apply clip/opacity to this surface:
 * doing so repeatedly would darken overlaps or erode antialiased mask edges. */
export class ActiveStrokeRaster {
  private canvas: HTMLCanvasElement | null = null;
  private signature = "";
  private points: StrokePoint[] = [];
  appendedPoints = 0;
  canRetain(space: RenderSpace) {
    return space.width * space.height * 4 <= 16 * 1024 * 1024;
  }
  clear() {
    if (this.canvas) release(this.canvas);
    this.canvas = null;
    this.points = [];
    this.signature = "";
  }
  draw(
    stroke: BrushStrokeData,
    target: HTMLCanvasElement,
    space: RenderSpace,
    x: number,
    y: number,
    world = AffineTransform.translation(x, y),
  ) {
    const { points, ...settings } = stroke;
    const signature = JSON.stringify([settings, space, world]);
    const reusable =
      signature === this.signature &&
      points.length >= this.points.length &&
      this.points.every(
        (p, i) =>
          p === points[i] ||
          (p.x === points[i].x &&
            p.y === points[i].y &&
            p.pressure === points[i].pressure),
      );
    if (!reusable) this.clear();
    // Oversized effect halos use the normal ephemeral path rather than retain
    // an unbounded canvas. The source/document is never resized or rejected.
    const retain = this.canRetain(space);
    const canvas = retain
      ? (this.canvas ??= createCanvas(space.width, space.height))
      : target;
    const c = canvas.getContext("2d")!;
    applyTransform(c, space, world);
    this.appendedPoints +=
      stroke.points.length - (retain ? this.points.length : 0);
    drawStroke(
      c,
      stroke,
      visibleLocalBounds(space, world),
      retain ? this.points.length : 0,
    );
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
  world: AffineTransform,
  processor: PixelProcessor,
  active?: ActiveStrokeRaster,
  masks?: CanvasCache,
  canCache: () => boolean = () => true,
  cloneSource?: ClonePreviewSource,
  isCancelled?: () => boolean,
) {
  const targetContext = target.getContext("2d")!;
  // Replay-local scratch keeps the sampling grid and per-stroke isolation.
  let scratch: HTMLCanvasElement | undefined;
  const replaySliceMs = 2;
  let deadline = performance.now() + replaySliceMs;
  try {
    for (const stroke of layer.strokes) {
      checkRenderCurrent(isCancelled);
      // Cold replays yield between strokes and stamp batches. Active previews
      // keep their fast path and no partially drawn layer is presented.
      if (performance.now() >= deadline) {
        await yieldTask();
        checkRenderCurrent(isCancelled);
        deadline = performance.now() + replaySliceMs;
      }
      if (!overlaps(world.bounds(strokeBounds(stroke)), space, 0, 0)) continue;
      const reusable = stroke.kind !== "clone" && !cloneSource;
      let surface = reusable && scratch ? scratch : createCanvas(space.width, space.height);
      if (reusable) scratch = surface;
      try {
        const context = surface.getContext("2d")!;
        if (reusable) {
          context.resetTransform();
          context.globalAlpha = 1;
          context.globalCompositeOperation = "source-over";
          context.clearRect(0,0,space.width,space.height);
        }
        applyTransform(context, space, world);
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
          active.draw(stroke, surface, space, 0, 0, world);
        } else {
          let stamps = 0;
          for (const point of strokeStamps(stroke, visibleLocalBounds(space, world))) {
            stamp(context, stroke, point);
            // Check in small batches without allocating a Promise per stamp.
            if (++stamps % 32 === 0 && performance.now() >= deadline) {
              await yieldTask();
              checkRenderCurrent(isCancelled);
              deadline = performance.now() + replaySliceMs;
            }
          }
        }
        checkRenderCurrent(isCancelled);
        context.resetTransform();
        if (stroke.kind === "clone" || cloneSource) {
          const clone = createCanvas(space.width, space.height);
          const c = clone.getContext("2d")!;
          applyTransform(c, space, world);
          if (cloneSource) {
            const visible=visibleLocalBounds(space,world), bounds=strokeBounds(stroke);
            const x=Math.max(visible.x,bounds.x),y=Math.max(visible.y,bounds.y);
            const right=Math.min(visible.x+visible.width,bounds.x+bounds.width),bottom=Math.min(visible.y+visible.height,bounds.y+bounds.height);
            // Include native interpolation and the local footprint of two output
            // pixels, even under rotation, shear or a strongly reduced view.
            const inverse = world.inverse();
            const margin = 2 + 2 * Math.max(
              Math.abs(inverse.a) / space.sx + Math.abs(inverse.c) / space.sy,
              Math.abs(inverse.b) / space.sx + Math.abs(inverse.d) / space.sy,
            );
            try { if(right>x&&bottom>y)await cloneSource.draw(c,bounds,visible,
              region => stroke.kind === "fill" || strokeIntersectsRegion(stroke, region, margin)); }
            catch(error){release(clone);throw error;}
          }
          else if(stroke.kind === "clone") for (const tile of stroke.tiles)
            if (overlaps(world.bounds(tile), space, 0, 0))
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
          const signature = JSON.stringify([stroke.clip, space, world]);
          let mask = createCanvas(space.width, space.height);
          try {
            if (!masks?.read("selection", signature, mask)) {
              release(mask);
              mask = await selectionMask(
                stroke.clip,
                space,
                0,
                0,
                processor,
                world,
              );
              if (canCache()) masks?.write("selection", signature, mask);
            }
            const c = surface.getContext("2d")!;
            c.globalCompositeOperation = "destination-in";
            c.drawImage(mask, 0, 0);
          } finally {
            release(mask);
          }
        }
        checkRenderCurrent(isCancelled);
        targetContext.save();
        targetContext.globalAlpha = stroke.opacity;
        targetContext.globalCompositeOperation =
          (stroke.kind === "fill" && stroke.erase) || stroke.kind === "eraser"
            ? "destination-out"
            : "source-over";
        targetContext.drawImage(surface, 0, 0);
        targetContext.restore();
      } finally {
        if (surface !== scratch) release(surface);
      }
    }
  } finally {
    if (scratch) release(scratch);
  }
}
export function tracePath(
  context: CanvasRenderingContext2D,
  path: Pick<VectorPathData, "points" | "closed" | "subpaths">,
  begin = true,
  nativeLines = false,
) {
  const first = path.points[0];
  if (begin) context.beginPath();
  context.moveTo(first.x, first.y);
  const count = path.points.length;
  for (let i = 1; i < count + (path.closed ? 1 : 0); i++) {
    const previous = path.points[i - 1],
      point = path.points[i % count];
    if(nativeLines&&previous.out.x===previous.x&&previous.out.y===previous.y&&point.in.x===point.x&&point.in.y===point.y)context.lineTo(point.x,point.y);
    else context.bezierCurveTo(
      previous.out.x,
      previous.out.y,
      point.in.x,
      point.in.y,
      point.x,
      point.y,
    );
  }
  if (path.closed) context.closePath();
  for (const contour of path.subpaths ?? []) tracePath(context, contour, false, nativeLines);
}
/** Compound Bézier coverage. Fill/stroke styling from source paths is irrelevant. */
export function vectorMask(
  mask: Extract<LayerMaskData, { kind: "vector" }>,
  space: RenderSpace,
  x: number,
  y: number,
  world = AffineTransform.translation(x, y),
): HTMLCanvasElement {
  // Rasterize on a fixed document-pixel grid. Canvas curve coverage can vary
  // with clipping bounds, so short export strips must crop the same tiles used
  // for viewport coverage rather than tessellate their own clipped curves.
  const canvas = createCanvas(space.width, space.height);
  const tileSize = 256,
    halo = 2;
  let tile: HTMLCanvasElement | undefined;
  try {
    tile = createCanvas(tileSize + halo * 2, tileSize + halo * 2, true);
    const output = canvas.getContext("2d")!;
    const context = tile.getContext("2d")!;
    const offset = (origin: number, scale: number) =>
      -Math.floor((((origin * scale) % tileSize) + tileSize) % tileSize);
    for (
      let dy = offset(space.y, space.sy);
      dy < space.height;
      dy += tileSize
    ) {
      for (
        let dx = offset(space.x, space.sx);
        dx < space.width;
        dx += tileSize
      ) {
        context.resetTransform();
        context.clearRect(0, 0, tile.width, tile.height);
        applyTransform(
          context,
          {
            ...space,
            x: space.x + (dx - halo) / space.sx,
            y: space.y + (dy - halo) / space.sy,
          },
          world,
        );
        context.beginPath();
        for (const path of mask.paths)
          tracePath(context, { points: path.points, closed: true }, false);
        context.fillStyle = "#ffffff";
        context.fill(mask.fillRule);
        output.drawImage(
          tile,
          halo,
          halo,
          tileSize,
          tileSize,
          dx,
          dy,
          tileSize,
          tileSize,
        );
      }
    }
    return canvas;
  } catch (error) {
    release(canvas);
    throw error;
  } finally {
    if (tile) release(tile);
  }
}
/** Gradient transforms affect paint coordinates without changing the path. */
function vectorFill(context:CanvasRenderingContext2D,value:VectorGradientData,rule:CanvasFillRule):void{
 context.save();
 try{
  const t=value.transform;if(t)context.transform(t.a,t.b,t.c,t.d,t.e,t.f);
  const a=value.start,b=value.end;
  const gradient=value.kind==='linear'?context.createLinearGradient(a.x,a.y,b.x,b.y):context.createRadialGradient(value.start.x,value.start.y,value.start.radius,value.end.x,value.end.y,value.end.radius);
  for(const stop of value.stops)gradient.addColorStop(stop.position,gradientStopColor(stop));
  context.fillStyle=gradient;context.fill(rule);
 }finally{context.restore();}
}
export function drawVectors(
  layer: VectorLayerData,
  target: HTMLCanvasElement,
  space: RenderSpace,
  world: AffineTransform,
) {
  const context = target.getContext("2d")!;
  context.save();
  applyTransform(context, space, world);
  for (const path of layer.paths) {
    if (!overlaps(world.bounds(pathBounds(path)), space, 0, 0)) continue;
    // Line commands have the same geometry but avoid cubic path-measure
    // sampling differences in dashed strokes. Mask tessellation stays stable.
    tracePath(context, path,true,true);
    if ((path.fillGradient||path.fill) && path.closed) {
      if(path.fillGradient)vectorFill(context,path.fillGradient,path.fillRule??'nonzero');
      else{context.fillStyle=path.fill!;context.fill(path.fillRule??'nonzero');}
    }
    if (path.stroke && path.strokeWidth > 0) {
      context.lineWidth = path.strokeWidth;
      const style=vectorStrokeValues(path);
      context.lineCap=style.strokeCap;
      context.lineJoin=style.strokeJoin;
      context.miterLimit=style.strokeMiterLimit;
      context.setLineDash(style.strokeDashArray);
      context.lineDashOffset=style.strokeDashOffset;
      context.strokeStyle = path.stroke;
      context.stroke();
      for (const contour of pathContours(path)) {
      const point=zeroLengthStrokePoint(contour);
      if(point){
        // Canvas prunes zero-length subpaths. Preserve the SVG/native cap
        // semantics explicitly without double-painting an existing stroke.
        if(style.strokeCap!=='butt'&&!(contour.closed&&style.strokeDashArray.some(length=>length>0))&&strokeDashAtOrigin(style.strokeDashArray,style.strokeDashOffset)){
          const r=path.strokeWidth/2;context.fillStyle=path.stroke;
          if(style.strokeCap==='square')context.fillRect(point.x-r,point.y-r,r*2,r*2);
          else{context.beginPath();context.arc(point.x,point.y,r,0,Math.PI*2);context.fill();}
        }
      }
      }
    }
  }
  context.restore();
}

function textInkBounds(context: CanvasRenderingContext2D, layer: TextLayerData, layout?: TextLayout) {
  const lines = (layout ?? layoutText(layer, (text,spacing) => measureStyledText(context,text,layer,spacing), layer.width)).lines;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const metrics = new Map<string, TextMetrics>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if ('wordSpacing' in context) context.wordSpacing = `${line.wordSpacing??layer.wordSpacing??0}px`;
    const key = `${line.wordSpacing??layer.wordSpacing??0}\0${line.text}`;
    let ink = metrics.get(key);
    if (!ink) { ink = context.measureText(line.text); metrics.set(key, ink); }
    const { actualBoundingBoxLeft: l, actualBoundingBoxRight: r,
      actualBoundingBoxAscent: a, actualBoundingBoxDescent: d } = ink;
    // Missing metrics must keep the full reference surface, including effects.
    if (![l, r, a, d].every(Number.isFinite)) return undefined;
    if (l + r > 0 && a + d > 0) {
      left = Math.min(left, line.x - l); right = Math.max(right, line.x + r);
      top = Math.min(top, line.y - a);
      bottom = Math.max(bottom, line.y + d);
    }
  }
  return left === Infinity ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: left, y: top, width: right - left, height: bottom - top };
}

let textInkContext: CanvasRenderingContext2D | undefined;
/** Fresh native metrics, never persisted across font loads or text edits. */
export function measureTextInk(layer: TextLayerData) {
  const context = textInkContext ??= createCanvas(1, 1).getContext("2d")!;
  assertTextStyleSupport(context, layer);
  context.save();
  try {
    applyTextStyle(context, layer);
    context.textAlign = layer.align;
    context.textBaseline = "top";
    return textInkBounds(context, layer);
  } finally { context.restore(); }
}

export function drawText(
  layer: TextLayerData,
  target: HTMLCanvasElement,
  space: RenderSpace,
  world: AffineTransform,
  measureInk = false,
) {
  const context = target.getContext("2d")!;
  assertTextStyleSupport(context, layer);
  context.save();
  try {
    applyTransform(context, space, world);
    applyTextStyle(context, layer);
    context.fillStyle = layer.color;
    context.textAlign = layer.align;
    context.textBaseline = "top";
    const layout = layoutText(layer, (text,spacing) => measureStyledText(context,text,layer,spacing), layer.width);
    for (const line of layout.lines) {
      if ('wordSpacing' in context) context.wordSpacing = `${line.wordSpacing??layer.wordSpacing??0}px`;
      context.fillText(line.text, line.x, line.y);
    }
    const ink = measureInk ? textInkBounds(context, layer, layout) : undefined;
    return ink;
  } finally {context.restore();}
}

/** Composite one mask stroke from an unmodified coverage surface. */
export async function drawMaskStroke(
  entry: Extract<LayerMaskData, { kind: "paint" }>["strokes"][number],
  output: HTMLCanvasElement,
  space: RenderSpace,
  x: number,
  y: number,
  processor: PixelProcessor,
  active?: ActiveStrokeRaster,
  world = AffineTransform.translation(x, y),
  scratch?: HTMLCanvasElement,
) {
  const { stroke, mode } = entry;
  if (!overlaps(world.bounds(strokeBounds(stroke)), space, 0, 0)) return;
  // The retained coverage stays unmodified. Without clipping it can be blended
  // directly, avoiding an intermediate full-tile surface and drawImage copy.
  // Oversized/non-retained strokes still need isolation for stroke opacity.
  if (active && !stroke.clip && active.canRetain(space)) {
    const target = output.getContext("2d")!;
    target.save();
    try {
      target.globalAlpha = stroke.opacity;
      target.globalCompositeOperation =
        mode === "hide" ? "destination-out" : "source-over";
      active.draw({ ...stroke, color: "#ffffff" }, output, space, x, y, world);
    } finally {
      target.restore();
    }
    return;
  }
  const surface = scratch ?? createCanvas(space.width, space.height);
  const context = surface.getContext("2d")!;
  context.save();
  try {
    context.resetTransform();
    context.clearRect(0, 0, surface.width, surface.height);
    const white = { ...stroke, color: "#ffffff" };
    if (active) active.draw(white, surface, space, x, y, world);
    else {
      applyTransform(context, space, world);
      drawStroke(context, white, visibleLocalBounds(space, world));
      context.resetTransform();
    }
    if (stroke.clip) {
      const clip = await selectionMask(
        stroke.clip,
        space,
        x,
        y,
        processor,
        world,
      );
      try {
        context.globalCompositeOperation = "destination-in";
        context.drawImage(clip, 0, 0);
      } finally {
        release(clip);
      }
    }
    const target = output.getContext("2d")!;
    target.save();
    target.globalAlpha = stroke.opacity;
    target.globalCompositeOperation =
      mode === "hide" ? "destination-out" : "source-over";
    target.drawImage(surface, 0, 0);
    target.restore();
  } finally {
    context.restore();
    if (!scratch) release(surface);
  }
}

export function bitmapMask(
  bitmap: ImageBitmap | HTMLCanvasElement,
  space: RenderSpace,
  x: number,
  y: number,
  world = AffineTransform.translation(x, y),
): HTMLCanvasElement {
  const canvas = createCanvas(space.width, space.height);
  const context = canvas.getContext("2d")!;
  applyTransform(context, space, world);
  context.drawImage(bitmap, 0, 0);
  context.resetTransform();
  return canvas;
}

/** Replay mask coverage, not artwork color. Opacity applies once per stroke. */
export async function paintedMask(
  mask: LayerMaskData,
  space: RenderSpace,
  x: number,
  y: number,
  processor: PixelProcessor,
  world = AffineTransform.translation(x, y),
  bitmap?: ImageBitmap | HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const output =
    mask.kind === "selection"
      ? await selectionMask(mask.selection, space, x, y, processor, world)
      : mask.kind === "vector"
        ? vectorMask(mask, space, x, y, world)
        : mask.kind === "bitmap" && bitmap
          ? bitmapMask(bitmap, space, x, y, world)
          : createCanvas(space.width, space.height);
  const scratch = mask.strokes?.length
    ? createCanvas(space.width, space.height)
    : undefined;
  try {
    const target = output.getContext("2d")!;
    if (mask.kind === "paint") {
      target.fillStyle = "#ffffff";
      target.globalAlpha = mask.base;
      target.fillRect(0, 0, space.width, space.height);
      target.globalAlpha = 1;
    }
    for (const entry of mask.strokes ?? [])
      await drawMaskStroke(
        entry,
        output,
        space,
        x,
        y,
        processor,
        undefined,
        world,
        scratch,
      );
    return output;
  } catch (error) {
    release(output);
    throw error;
  } finally {
    if (scratch) release(scratch);
  }
}
