import {nativeVectorFootprint} from './native-vector-footprint';
import {drawProjectedBitmap,bitmapProjectionRequiresPrecision} from './bitmap-projection';
import {NativeCanvasGrid} from './native-canvas-grid';
import {RawStrokeCoverage} from './paint-coverage';
import {isImmutable} from '../core/immutable';
import {hasWetMask,nativeWetMask} from './wet-mask';
import type {PaintStampPoint} from '../core/paint-stamps';
import { compositeWetPaint } from './wet-composite';
import { drawNativeWetContent, hasWetContent } from './wet-native';
import {TexturedStrokeRaster} from './textured-stroke';
import type {BrushTextureSampler} from './brush-texture';
import {gradientStopColor,type VectorGradientData} from '../core/vector-gradient';
import {applyTextStyle, measureStyledText,assertTextStyleSupport} from '../core/text-style';
import {vectorStrokeValues,zeroLengthStrokePoint,strokeDashAtOrigin} from '../core/vector-stroke';
import {strokeStamps,sameStrokePoint} from '../core/paint-stamps';
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
import { createCanvas, release, applyTransform,renderTransform,canonicalCellOffset } from "./canvas";
import type { RenderSpace } from "./canvas";
import type { CanvasCache } from "./cache";
import {hasMaskRefinements} from "../core/masks";
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
export function visitStrokeStamps(
  visit: (point: PaintStampPoint) => void,
  stroke: BrushStrokeData,
  visible: Rect,
  from = 0,
) {
  for (const point of strokeStamps(stroke, visible, from)) visit(point);
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
  static retainedBytes(stroke:BrushStrokeData,space:RenderSpace,world:AffineTransform){
    return space.width*space.height*4+(stroke.texture?0:RawStrokeCoverage.retainedBytes(stroke,space,world));
  }
  private readonly coverage=new RawStrokeCoverage();
  private generation=0;
  private texture:TexturedStrokeRaster|null=null;
  private canvas: HTMLCanvasElement | null = null;
  private signature = "";
  private points: StrokePoint[] = [];
  appendedPoints = 0;
  canRetain(space: RenderSpace) {
    return space.width * space.height * 4 <= 16 * 1024 * 1024;
  }
  clear() {
    this.generation++;this.coverage.dispose();
    this.texture?.dispose();this.texture=null;
    if (this.canvas) release(this.canvas);
    this.canvas = null;
    this.points = [];
    this.signature = "";
  }
  async drawTexture(stroke:BrushStrokeData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,assets:AssetStore,processor:PixelProcessor,textures?:BrushTextureSampler,isCancelled?:()=>boolean){
    this.generation++;
    this.coverage.dispose();
    if(!stroke.texture)throw new Error('A textured stroke requires an image source.');
    if(this.canvas)release(this.canvas);
    this.canvas=null;this.points=[];this.signature='';
    this.texture??=new TexturedStrokeRaster(processor,0,textures);
    await this.texture.draw(stroke,stroke.texture,assets,target,space,world,{isCancelled});
    this.appendedPoints+=stroke.points.length-this.texture.lastReplay.from;
  }
  draw(
    stroke: BrushStrokeData,
    target: HTMLCanvasElement,
    space: RenderSpace,
    x: number,
    y: number,
    world = AffineTransform.translation(x, y),
    isCancelled?:()=>boolean,
  ) {
    this.generation++;
    space={...space};
    if(this.texture){this.texture.dispose();this.texture=null;}
    const native=this.coverage.canUseNative(stroke,space,world);
    if(!isImmutable(stroke)&&!native)stroke=structuredClone(stroke);
    const {points,...settings}=stroke,signature=JSON.stringify([settings,space,world]);
    const reusable=signature===this.signature&&points.length>=this.points.length&&this.points.every((p,i)=>sameStrokePoint(p,points[i]));
    if(!reusable)this.clear();
    // Keep one accepted raw viewport. Numerical extensions work privately so a
    // cancelled frame does not destroy the reusable accepted prefix.
    const retain=this.canRetain(space),from=retain?this.points.length:0,staged=retain&&!native&&from<points.length;
    this.appendedPoints+=points.length-from;
    const generation=this.generation,width=target.width,height=target.height;
    const cancelled=()=>generation!==this.generation||target.width!==width||target.height!==height||!!isCancelled?.();
    let canvas:HTMLCanvasElement|undefined,installed=false;
    const cleanup=()=>{if(staged&&!installed&&canvas)release(canvas);};
    const fail=(error:unknown)=>{if(generation===this.generation&&!staged)this.clear();throw error;};
    try{
      canvas=staged?createCanvas(space.width,space.height):retain?(this.canvas??=createCanvas(space.width,space.height)):target;
      if(staged&&from&&this.canvas){const context=canvas.getContext('2d')!;context.imageSmoothingEnabled=false;context.drawImage(this.canvas,0,0);}
      const finish=()=>{
        checkRenderCurrent(cancelled);canvas!.getContext('2d')!.resetTransform();
        if(retain){
          const output=target.getContext('2d')!;output.save();try{output.resetTransform();output.drawImage(canvas!,0,0);}finally{output.restore();}
          if(staged){if(this.canvas)release(this.canvas);this.canvas=canvas!;installed=true;}
          this.signature=signature;this.points=isImmutable(stroke)?points:structuredClone(points);
        }
      };
      const work=this.coverage.draw(stroke,canvas,space,world,from,false,cancelled);
      if(work)return work.then(finish).catch(fail).finally(cleanup);
      finish();cleanup();
    }catch(error){cleanup();fail(error);}

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
  textures?:BrushTextureSampler,
  native = false,
) {
  if (!native && hasWetContent(layer)) return drawNativeWetContent(layer, assets, target, space, world, processor, isCancelled, textures);
  const targetContext = target.getContext("2d")!;
  // Replay-local scratch keeps the sampling grid and per-stroke isolation.
  let scratch: HTMLCanvasElement | undefined;
  const coverage=new RawStrokeCoverage();
  const replaySliceMs = 2;
  let deadline = performance.now() + replaySliceMs;
  try {
    for (const stroke of layer.strokes) {
      checkRenderCurrent(isCancelled);
      if (stroke.kind === 'wet') { await compositeWetPaint(stroke, assets, target, space, world, processor, isCancelled); continue; }
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
        if(stroke.kind==='fill'){
          await coverage.fill(stroke,surface,space,world,isCancelled);
        } else if(stroke.texture){
          context.resetTransform();
          if(active&&stroke.kind!=='clone')await active.drawTexture(stroke,surface,space,world,assets,processor,textures,isCancelled);
          else{
            const raster=new TexturedStrokeRaster(processor,0,textures);
            try{await raster.draw(stroke,stroke.texture,assets,surface,space,world,{isCancelled});}finally{raster.dispose();}
          }
        } else if (active && stroke.kind !== "clone") {
          context.resetTransform();
          await active.draw(stroke,surface,space,0,0,world,isCancelled);
        } else {
          await coverage.draw(stroke,surface,space,world,0,true,isCancelled);
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
    coverage.dispose();
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
    const offset = (origin: number, scale: number) => canonicalCellOffset(origin,scale,tileSize);
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
function drawVectorsNative(
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

export function drawVectors(layer:VectorLayerData,target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform){
  const bounds=nativeVectorFootprint(layer);if(!bounds)return;
  const grid=new NativeCanvasGrid(target.getContext('2d')!,space,renderTransform(space,world).bounds(bounds));
  try{for(const cell of grid.cells()){drawVectorsNative(layer,grid.canvas,cell.space,world);grid.present(cell);}}finally{grid.dispose();}
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
  assets?:AssetStore,
  textures?:BrushTextureSampler,
  isCancelled?:()=>boolean,
) {
  const { stroke, mode } = entry;
  if(stroke.kind==='wet'){
    if(stroke.opacity===0||!overlaps(world.bounds(strokeBounds(stroke)),space,0,0))return;
    if(!assets)throw new Error('Prepared wet mask coverage requires its image asset store.');
    await compositeWetPaint(stroke,assets,output,space,world,processor,isCancelled);return;
  }
  if(stroke.texture&&!assets)throw new Error('Textured mask coverage requires its image asset store.');
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
      if(stroke.texture)await active.drawTexture({...stroke,color:'#ffffff'},output,space,world,assets!,processor,textures,isCancelled);
      else await active.draw({ ...stroke, color: "#ffffff" }, output, space, x, y, world,isCancelled);
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
    if(stroke.texture){
      if(active)await active.drawTexture(white,surface,space,world,assets!,processor,textures,isCancelled);
      else{
        const raster=new TexturedStrokeRaster(processor,0,textures);
        try{await raster.draw(white,stroke.texture,assets!,surface,space,world,{isCancelled});}finally{raster.dispose();}
      }
    }
    else if (active) await active.draw(white, surface, space, x, y, world,isCancelled);
    else {
      const coverage=new RawStrokeCoverage();
      try{await coverage.draw(white,surface,space,world,0,true,isCancelled);}finally{coverage.dispose();}
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

export async function bitmapMask(
  bitmap: ImageBitmap | HTMLCanvasElement,
  space: RenderSpace,
  x: number,
  y: number,
  world = AffineTransform.translation(x, y),
  isCancelled?:()=>boolean,
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(space.width, space.height);
  try{
    const mapping=renderTransform(space,world),native=mapping.a===1&&mapping.b===0&&mapping.c===0&&mapping.d===1&&Number.isSafeInteger(mapping.e)&&Number.isSafeInteger(mapping.f);
    if(native||bitmapProjectionRequiresPrecision(mapping,bitmap.width,bitmap.height))await drawProjectedBitmap(canvas.getContext('2d')!,bitmap,mapping,{isCancelled});
    else{
      const width=bitmap.width,height=bitmap.height;if(!width||!height)throw new Error('Bitmap source changed during projection.');const grid=new NativeCanvasGrid(canvas.getContext('2d')!,space,mapping.bounds({x:0,y:0,width,height}));
      try{for(const cell of grid.cells()){
        checkRenderCurrent(isCancelled);if(bitmap.width!==width||bitmap.height!==height||!width||!height)throw new Error('Bitmap source changed during projection.');
        const c=grid.canvas.getContext('2d')!,matrix=renderTransform(cell.space,world);c.save();try{c.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);c.drawImage(bitmap,0,0);}finally{c.restore();}grid.present(cell);
      }}finally{grid.dispose();}
    }
    return canvas;
  }catch(error){release(canvas);throw error;}
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
  assets?:AssetStore,
  textures?:BrushTextureSampler,
  isCancelled?:()=>boolean,
  nativeWetResolved=false,
): Promise<HTMLCanvasElement> {
  if(!nativeWetResolved&&hasWetMask(mask)){if(!assets)throw new Error('Prepared wet mask coverage requires its image asset store.');return nativeWetMask(mask,space,processor,world,bitmap,assets,textures,isCancelled);}
  const output =
    mask.kind === "selection"
      ? await selectionMask(mask.selection, space, x, y, processor, world)
      : mask.kind === "vector"
        ? vectorMask(mask, space, x, y, world)
        : mask.kind === "bitmap" && bitmap
          ? await bitmapMask(bitmap, space, x, y, world,isCancelled)
          : createCanvas(space.width, space.height);
  const scratch = hasMaskRefinements(mask)
    ? createCanvas(space.width, space.height)
    : undefined;
  try {
    const target = output.getContext("2d")!;
    if (mask.kind === "raster-erasures") {
      target.fillStyle="#ffffff";target.fillRect(0,0,space.width,space.height);
      for(const entry of mask.erasures){
        await drawPaint({id:`erasure-mask:${entry.stroke.id}`,name:"Raster erasure coverage",kind:"paint",x:0,y:0,visible:true,locked:false,opacity:1,blendMode:"normal",strokes:[entry.stroke]},assets!,output,space,
          world.multiply(AffineTransform.scale(mask.width/entry.width,mask.height/entry.height)),processor,undefined,undefined,undefined,undefined,isCancelled,textures);
      }
    }
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
        assets,
        textures,
        isCancelled,
      );
    return output;
  } catch (error) {
    release(output);
    throw error;
  } finally {
    if (scratch) release(scratch);
  }
}
