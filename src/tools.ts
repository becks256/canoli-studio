import { strokeCaptureRegion, strokeIntersectsRegion } from "./engine/stroke-region";
import { freeze } from "./core/immutable";
import { ClonePreviewSource } from "./engine/clone-preview";
import { lassoSelection } from "./core/lasso";
import { CanvasRenderer } from "./engine/renderer";
import { CropController } from "./crop-controller";
import type { CropHandle } from "./crop-controller";
import type { EditorApplication } from "./editor";
import {
  RasterLayer,
  BrushStroke,
  SmartObjectLayer,
  AdjustmentLayer,
  TonalStroke,
  EraserStroke,
  LayerMask,
  PaintOperation,
  CloneStroke,
  LayerGroup,
  MarqueeSelection,
  PaintFill,
  PaintLayer,
  PencilStroke,
  VectorLayer,
  VectorPath,
} from "./dom";
import type { Document, Layer, ShapeOptions } from "./dom";
import type { EditorCommand } from "./core/commands";
import { isLocked } from "./core/model";
import type { LayerMaskData } from "./core/masks";
import { maskOrigin, maskTransform } from "./core/masks";
import { hitTestPath, splitPathSegment } from "./core/bezier";
import type { CurveHit } from "./core/bezier";
import { AffineTransform } from "./core/affine";
import { layerOrigin, layerTransform } from "./core/spatial";
import { strokeBounds, transformSelection } from "./core/drawing";
import type {
  BrushStrokeData,
  CloneTile,
  FillData,
  PathAnchor,
  Point,
  SelectionData,
  SelectionOperation,
  StrokePoint,
  VectorPathData,
} from "./core/drawing";
import { release } from "./engine/canvas";
import type { PaintPreview } from "./engine/renderer";

export type Tool =
  | "wand"
  | "move"
  | "hand"
  | "heal"
  | "patch"
  | "dodge"
  | "burn"
  | "brush"
  | "pencil"
  | "eraser"
  | "pen"
  | "lasso"
  | "marquee"
  | "clone"
  | "artboard"
  | "crop"
  | "text"
  | "fill";
export interface ToolSettings {
  healingRadius: number;
  patchSampling: "current-layer" | "current-and-below" | "all-layers";
  patchMode: "source" | "mixed";
  patchDirection: "source" | "destination";
  tonalRange: "shadows" | "midtones" | "highlights";
  tonalExposure: number;
  protectTones: boolean;
  paintTarget:
    | "layer"
    | "mask-hide"
    | "mask-reveal"
    | "filter-mask-hide"
    | "filter-mask-reveal";
  penEditTarget: "layer" | "mask";
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  smoothing: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  color: string;
  penWidth: number;
  penFill: boolean;
  selectionShape: "rectangle" | "ellipse";
  wandTolerance: number;
  wandContiguous: boolean;
  selectionMode: "replace" | SelectionOperation;
  cloneAligned: boolean;
}
interface ToolState {
  lassoPoints: Point[] | null;
  healingStroke: BrushStrokeData | null;
  patchOffset: Point | null;
  settings: ToolSettings;
  preview: EditorCommand | null;
  paintPreview: PaintPreview | null;
  cloneSource: Point | null;
  cloneOffset: Point | null;
  penTarget: { layerId: string; pathId: string } | null;
  selectedPath: { layerId: string; pathId: string } | null;
  drawing: boolean;
}
interface BaseGesture {
  document: Document;
  revision: number;
  generation: number;
}
interface PaintGesture extends BaseGesture {
  inputTransform: AffineTransform;
  kind: "paint";
  tool: "brush" | "pencil" | "clone" | "eraser" | "dodge" | "burn";
  points: StrokePoint[];
  layer: PaintLayer | AdjustmentLayer | RasterLayer;
  fresh: boolean;
  after: Layer | null;
  origin: Point;
  clip: SelectionData | null;
  settings: ToolSettings;
  offset: Point | null;
  stroke: BrushStrokeData;
  cloneSource?: ClonePreviewSource;
}
interface LassoGesture extends BaseGesture {
  kind: "lasso";
  points: Point[];
  previous: SelectionData | null;
  operation: "replace" | SelectionOperation;
}
interface MarqueeGesture extends BaseGesture {
  kind: "marquee";
  start: Point;
  selection: SelectionData;
  previous: SelectionData | null;
  operation: "replace" | SelectionOperation;
  shape: "rectangle" | "ellipse";
}
interface PenGesture extends BaseGesture {
  inputTransform: AffineTransform;
  kind: "pen";
  layer: VectorLayer;
  fresh: boolean;
  after: Layer | null;
  path: VectorPath;
  newPath: boolean;
  data: VectorPathData;
  original: VectorPathData;
  index: number;
  mode: "new" | "anchor" | "in" | "out" | "close";
  start: Point;
  origin: Point;
}
interface FillGesture extends BaseGesture {
  kind: "fill";
  layer: PaintLayer;
  fresh: boolean;
  after: Layer | null;
  origin: Point;
  fill: PaintFill;
}
interface MaskPaintGesture extends BaseGesture {
  inputTransform: AffineTransform;
  kind: "mask-paint";
  filterMask: boolean;
  maxPoints: number;
  layer: Layer;
  mask: LayerMask;
  origin: Point;
  stroke: BrushStrokeData;
  mode: "hide" | "reveal";
}
interface MaskPenGesture extends BaseGesture {
  inputTransform: AffineTransform;
  kind: "mask-pen";
  layer: Layer;
  mask: LayerMask;
  data: Extract<LayerMaskData, { kind: "vector" }>;
  pathIndex: number;
  index: number;
  mode: "anchor" | "in" | "out" | "insert";
  original: PathAnchor;
  start: Point;
  origin: Point;
  changed: boolean;
}
interface MaskContourDraft extends BaseGesture {
  inputTransform: AffineTransform;
  world: AffineTransform;
  pathIndex: number;
  layer: Layer;
  mask: LayerMask;
  origin: Point;
  points: PathAnchor[];
}
interface MaskContourGesture extends BaseGesture {
  kind: "mask-contour";
  draft: MaskContourDraft;
  points: PathAnchor[];
  close: boolean;
}
interface HealGesture extends BaseGesture {
  kind: "heal";
  stroke: BrushStrokeData;
  settings: ToolSettings;
}
interface PatchGesture extends BaseGesture {
  kind: "patch";
  start: Point;
  offset: Point;
  settings: ToolSettings;
}
type Gesture =
  | HealGesture
  | PatchGesture
  | MaskContourGesture
  | MaskPenGesture
  | MaskPaintGesture
  | PaintGesture
  | LassoGesture
  | MarqueeGesture
  | PenGesture
  | FillGesture;

/** Stateful tool orchestration; previews are commands, commits use the public DOM. */
export class ToolController {
  private patchAbort: AbortController | null = null;
  private state: ToolState = {
    healingStroke: null,
    patchOffset: null,
    settings: {
      healingRadius: 64,
      patchSampling: "all-layers",
      patchMode: "source",
      patchDirection: "source",
      tonalRange: "midtones",
      tonalExposure: 0.25,
      protectTones: true,
      paintTarget: "layer",
      penEditTarget: "layer",
      size: 24,
      hardness: 0.7,
      opacity: 1,
      flow: 1,
      spacing: 0.12,
      smoothing: 0,
      pressureSize: true,
      pressureOpacity: false,
      color: "#d5e79b",
      penWidth: 3,
      penFill: false,
      selectionShape: "rectangle",
      wandTolerance: 32,
      wandContiguous: true,
      selectionMode: "replace",
      cloneAligned: true,
    },
    preview: null,
    lassoPoints: null,
    paintPreview: null,
    cloneSource: null,
    cloneOffset: null,
    penTarget: null,
    selectedPath: null,
    drawing: false,
  };
  private listeners = new Set<() => void>();
  private gesture: Gesture | null = null;
  private generation = 0;
  private maskContour: MaskContourDraft | null = null;
  private maskPoint: {
    layerId: string;
    pathIndex: number;
    index: number;
  } | null = null;
  private paintFrame: number | null = null;
  private cancelFrame() {
    if (this.paintFrame !== null) cancelAnimationFrame(this.paintFrame);
    this.paintFrame = null;
  }
  readonly crop: CropController;
  constructor(private editor: EditorApplication) {
    this.crop = new CropController(
      () => this.editor.document,
      () =>
        this.publish({ drawing: this.crop.dragging || this.gesture !== null }),
    );
  }
  getSnapshot = () => this.state;
  private uiSnapshot: ToolState | null = null;
  /** High-frequency paint pixels are consumed directly by the viewport. */
  getUiSnapshot = () => {
    const previous = this.uiSnapshot;
    if (!previous || (Object.keys(this.state) as (keyof ToolState)[]).some(
      key => key !== "paintPreview" && previous[key] !== this.state[key],
    )) this.uiSnapshot = this.state;
    return this.uiSnapshot!;
  };
  get maskContourIndex() {
    return this.maskContour?.pathIndex ?? -1;
  }
  get drawingMaskContour() {
    return this.maskContour !== null;
  }
  get maskContourPointCount() {
    return this.maskContour?.points.length ?? 0;
  }
  get selectedMaskAnchor() {
    const gesture = this.gesture;
    if (gesture?.kind === "mask-pen" && gesture.mode === "insert")
      return {
        layerId: gesture.layer.id,
        pathIndex: gesture.pathIndex,
        index: gesture.index,
      };
    return this.maskPoint ? { ...this.maskPoint } : null;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ToolState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  configure(patch: Partial<ToolSettings>) {
    if (
      patch.paintTarget !== undefined &&
      patch.paintTarget !== this.state.settings.paintTarget
    )
      this.cancel();
    if (
      patch.penEditTarget !== undefined &&
      patch.penEditTarget !== this.state.settings.penEditTarget
    ) {
      this.cancel();
      this.maskPoint = null;
    }
    const changed = (Object.keys(patch) as Array<keyof ToolSettings>).some(
      (k) => patch[k] !== undefined && patch[k] !== this.state.settings[k],
    );
    if (!changed) return;
    this.publish({ settings: { ...this.state.settings, ...patch } });
  }
  cancel() {
    this.patchAbort?.abort();
    this.patchAbort = null;
    this.publish({ patchOffset: null, healingStroke: null });
    this.crop.cancel();
    this.maskContour = null;
    this.cancelFrame();
    this.generation++;
    if(this.gesture?.kind === "paint")this.gesture.cloneSource?.dispose();
    this.gesture = null;
    this.publish({
      preview: null,
      lassoPoints: null,
      paintPreview: null,
      drawing: false,
      patchOffset: null,
      healingStroke: null,
    });
  }
  reset() {
    this.patchAbort?.abort();
    this.patchAbort = null;
    this.publish({ patchOffset: null, healingStroke: null });
    this.crop.cancel();
    this.maskContour = null;
    this.maskPoint = null;
    this.cancelFrame();
    this.generation++;
    if(this.gesture?.kind === "paint")this.gesture.cloneSource?.dispose();
    this.gesture = null;
    this.publish({
      preview: null,
      lassoPoints: null,
      paintPreview: null,
      drawing: false,
      penTarget: null,
      selectedPath: null,
      cloneSource: null,
      cloneOffset: null,
    });
  }
  finishPath() {
    const draft = this.maskContour;
    if (draft) {
      this.assertMaskContour(draft);
      if (draft.points.length) {
        const path = new VectorPath({ points: draft.points, closed: true });
        draft.document.transaction("Add mask contour", () => {
          draft.layer.mask = draft.mask.with({
            paths: [...draft.mask.paths, path],
          });
        });
      }
    }
    this.maskPoint = null;
    this.cancel();
    this.publish({ penTarget: null });
  }
  removeLastAnchor() {
    if (this.maskContour) {
      this.assertMaskContour(this.maskContour);
      this.maskContour.points.pop();
      this.previewMaskContour(this.maskContour, this.maskContour.points);
      return true;
    }
    if (this.state.settings.penEditTarget === "mask") {
      this.editMaskPoint((points, index) => {
        points.splice(index, 1);
      });
      return true;
    }
    const target = this.state.penTarget;
    if (!target) return false;
    const layer = this.editor.document.getLayer(target.layerId);
    if (!(layer instanceof VectorLayer)) return false;
    const path = layer.paths.get(target.pathId);
    if (!path) return false;
    if (path.points.length <= 1) {
      path.remove();
      this.finishPath();
    } else path.removePoint(path.points.length - 1);
    return true;
  }
  private editMaskPoint(edit: (points: PathAnchor[], index: number) => void) {
    const selected = this.editor.document.selectedLayer,
      target = this.maskPoint,
      mask = selected?.mask;
    if (!target || selected?.id !== target.layerId || mask?.kind !== "vector")
      return;
    const paths = mask.paths,
      path = paths[target.pathIndex],
      points = path?.points;
    if (!points?.[target.index]) return;
    this.cancel();
    edit(points, target.index);
    if (points.length) path.update({ points });
    else paths.splice(target.pathIndex, 1);
    selected.mask = mask.with({ paths });
    if (!points.length || target.index >= points.length) this.maskPoint = null;
  }
  insertMaskAnchor() {
    if (this.maskContour) return;
    const selected = this.editor.document.selectedLayer,
      target = this.maskPoint,
      mask = selected?.mask;
    if (!target || selected?.id !== target.layerId || mask?.kind !== "vector")
      return;
    const paths = mask.paths,
      path = paths[target.pathIndex];
    if (!path?.points[target.index]) return;
    this.cancel();
    const index = path.splitSegment(target.index);
    selected.mask = mask.with({ paths });
    this.maskPoint = { ...target, index };
    this.publish({});
  }
  nudgeMaskPoint(x: number, y: number) {
    if (this.maskContour) return;
    const layer = this.editor.document.selectedLayer;
    if (layer?.mask) {
      const inverse = this.maskWorld(
        this.editor.document,
        layer,
        layer.mask.toJSON(),
      ).inverse();
      const dx = inverse.a * x + inverse.c * y;
      y = inverse.b * x + inverse.d * y;
      x = dx;
    }
    this.editMaskPoint((points, index) => {
      const p = points[index];
      p.x += x;
      p.y += y;
      p.in.x += x;
      p.in.y += y;
      p.out.x += x;
      p.out.y += y;
    });
  }
  private unlocked() {
    const doc = this.editor.document,
      selected = doc.selectedLayer;
    if (selected && isLocked(doc._read(), selected.id))
      throw new Error(
        "Unlock the selected layer and its parent groups before drawing.",
      );
    return { doc, selected };
  }
  private point(
    point: Point,
    origin: Point,
    pressure: number,
    inputTransform?: AffineTransform,
  ): StrokePoint {
    const hasDynamics =
      this.state.settings.pressureSize || this.state.settings.pressureOpacity;
    const p = hasDynamics ? Math.max(0.05, Math.min(1, pressure || 0.5)) : 1;
    return {
      ...(inputTransform
        ? inputTransform.point(point)
        : { x: point.x - origin.x, y: point.y - origin.y }),
      pressure: p,
    };
  }
  begin(
    tool: Tool,
    point: Point,
    modifiers: { alt: boolean; shift: boolean; pressure: number },
    zoom: number,
    cropHandle?: CropHandle,
  ) {
    if (tool === "crop") {
      if (!this.crop.active) this.cancel();
      this.crop.begin(point, zoom, cropHandle);
      return;
    }
    if (
      tool === "pen" &&
      this.state.settings.penEditTarget === "mask" &&
      this.maskContour
    ) {
      this.beginMaskContour(point, zoom);
      return;
    }
    this.cancel();
    const doc = this.editor.document;
    if (tool === "clone" && modifiers.alt) {
      this.publish({ cloneSource: point, cloneOffset: null });
      return;
    }
    const base = {
      document: doc,
      revision: doc.getSnapshot().revision,
      generation: this.generation,
    };
    if (tool === "heal") {
      const settings = { ...this.state.settings };
      const stroke = new BrushStroke({
        ...settings,
        color: "#ffffff",
        points: [this.point(point, { x: 0, y: 0 }, modifiers.pressure)],
        clip: doc.selection,
      }).toJSON() as BrushStrokeData;
      this.gesture = { ...base, kind: "heal", stroke, settings };
      this.publish({ drawing: true, healingStroke: stroke });
      return;
    }
    if (tool === "patch") {
      if (!doc.selection)
        throw new Error(
          "Create a selection with the Marquee tool before patching.",
        );
      this.gesture = {
        ...base,
        kind: "patch",
        start: point,
        offset: { x: 0, y: 0 },
        settings: { ...this.state.settings },
      };
      this.publish({ drawing: true, patchOffset: { x: 0, y: 0 } });
      return;
    }
    if (tool === "lasso") {
      const operation = modifiers.shift && modifiers.alt ? "intersect" : modifiers.shift ? "add" : modifiers.alt ? "subtract" : this.state.settings.selectionMode;
      this.gesture = { ...base, kind: "lasso", points: [point], previous: doc.selection?.toJSON() ?? null, operation };
      this.publish({drawing: true, lassoPoints: [point]});
      return;
    }
    if (tool === "marquee") {
      const operation =
        modifiers.shift && modifiers.alt
          ? "intersect"
          : modifiers.shift
            ? "add"
            : modifiers.alt
              ? "subtract"
              : this.state.settings.selectionMode;
      this.gesture = {
        ...base,
        kind: "marquee",
        start: point,
        previous: doc.selection?.toJSON() ?? null,
        selection: { regions: [] },
        operation,
        shape: this.state.settings.selectionShape,
      };
      this.move(point, modifiers);
      this.publish({ drawing: true });
      return;
    }
    const { selected } = this.unlocked();
    if (
      (tool === "brush" || tool === "pencil" || tool === "eraser") &&
      this.state.settings.paintTarget !== "layer"
    ) {
      const filterMask =
        this.state.settings.paintTarget.startsWith("filter-mask-");
      const mask = filterMask
        ? selected instanceof SmartObjectLayer
          ? selected.filterMask
          : null
        : selected?.mask;
      if (!selected || !mask)
        throw new Error(
          filterMask
            ? "Select a smart object with a filter mask first."
            : "Select a layer with a mask first.",
        );
      const data = mask.toJSON();
      if ((data.strokes?.length ?? 0) >= 2048)
        throw new Error("This mask has reached its 2,048-stroke limit.");
      const maxPoints = Math.min(
        20000,
        200000 -
          (data.strokes ?? []).reduce(
            (total, entry) => total + entry.stroke.points.length,
            0,
          ),
      );
      if (maxPoints < 1)
        throw new Error("This mask has reached its 200,000-point limit.");
      const layerPosition = layerOrigin(
        doc.getSnapshot().document,
        selected.id,
      )!;
      const origin = maskOrigin(
        mask.toJSON(),
        layerPosition.x,
        layerPosition.y,
      );
      let maskWorld = this.maskWorld(doc, selected, data);
      if (filterMask && selected instanceof SmartObjectLayer) {
        const master = doc.getComponent(selected.componentId);
        const nativeWorld = layerTransform(doc._read(), selected.id)!.multiply(
          AffineTransform.scale(
            selected.width / master.width,
            selected.height / master.height,
          ),
        );
        maskWorld = maskTransform(data, nativeWorld);
      }
      const inputTransform = maskWorld.inverse();
      const stroke = new (tool === "pencil" ? PencilStroke : BrushStroke)({
        points: [this.point(point, origin, modifiers.pressure, inputTransform)],
        size: this.state.settings.size,
        hardness: this.state.settings.hardness,
        opacity: this.state.settings.opacity,
        flow: this.state.settings.flow,
        spacing: this.state.settings.spacing,
        pressureSize: this.state.settings.pressureSize,
        pressureOpacity: this.state.settings.pressureOpacity,
        color: "#ffffff",
        clip: transformSelection(doc.selection?.toJSON(), inputTransform),
      }).toJSON() as BrushStrokeData;
      const gesture: MaskPaintGesture = {
        ...base,
        kind: "mask-paint",
        filterMask,
        layer: selected,
        mask,
        origin,
        inputTransform,
        stroke,
        maxPoints,
        mode:
          tool === "eraser"
            ? "hide"
            : this.state.settings.paintTarget.endsWith("-hide")
              ? "hide"
              : "reveal",
      };
      this.gesture = gesture;
      this.updateMaskPreview(gesture);
      this.publish({ drawing: true });
      return;
    }
    if (tool === "pen" && this.state.settings.penEditTarget === "mask") {
      this.beginMaskPen(base, selected, point, zoom);
      return;
    }
    if (tool === "pen") {
      this.beginPen(base, selected, point, zoom);
      this.publish({ drawing: true });
      return;
    }
    if (tool === "fill") {
      const fresh = !(selected instanceof PaintLayer),
        layer =
          selected instanceof PaintLayer
            ? selected
            : new PaintLayer({ name: "Fill layer" });
      const origin = fresh
        ? { x: 0, y: 0 }
        : layerOrigin(doc._read(), layer.id)!;
      const fill = new PaintFill({
        color: this.state.settings.color,
        opacity: this.state.settings.opacity,
        ...this.fillGeometry(doc, fresh ? null : layer),
      });
      this.gesture = {
        ...base,
        kind: "fill",
        layer,
        fresh,
        after: selected,
        origin,
        fill,
      };
      if (fresh) {
        const layerData = layer.toJSON() as Extract<
          ReturnType<Layer["toJSON"]>,
          { kind: "paint" }
        >;
        layerData.strokes.push(fill.toJSON() as FillData);
        this.publish({
          preview: this.newLayerPreview(layerData, selected),
          drawing: true,
        });
      } else {
        this.publish({
          preview: {
            type: "paint.add",
            id: layer.id,
            stroke: fill.toJSON() as FillData,
          },
          drawing: true,
        });
      }
      return;
    }
    if (
      tool !== "brush" &&
      tool !== "pencil" &&
      tool !== "clone" &&
      tool !== "eraser" &&
      tool !== "dodge" &&
      tool !== "burn"
    )
      return;
    if (tool === "clone" && !this.state.cloneSource)
      throw new Error(
        "Alt/Option-click on the canvas to choose a clone source first.",
      );
    const tonal = tool === "dodge" || tool === "burn";
    const reusable = tonal
      ? selected instanceof AdjustmentLayer &&
        selected.adjustmentKind === "tonal"
      : selected instanceof PaintLayer || (tool === "eraser" && selected instanceof RasterLayer);
    const fresh = !reusable,
      layer = reusable
        ? (selected as PaintLayer | AdjustmentLayer | RasterLayer)
        : tonal
          ? new AdjustmentLayer({
              name: "Tonal retouch",
              adjustment: { kind: "tonal", strokes: [] },
            })
          : new PaintLayer({
              name:
                tool === "clone"
                  ? "Clone retouch"
                  : tool === "pencil"
                    ? "Pencil drawing"
                    : tool === "eraser"
                      ? "Eraser stroke"
                      : "Brush painting",
            });
    const origin = fresh
      ? { x: 0, y: 0 }
      : layerOrigin(doc._read(), layer.id)!;
    const inputTransform = fresh
      ? AffineTransform.translation(-origin.x, -origin.y)
      : layerTransform(doc._read(), layer.id)!.inverse();
    const offset =
      tool === "clone"
        ? this.state.settings.cloneAligned && this.state.cloneOffset
          ? this.state.cloneOffset
          : {
              x: this.state.cloneSource!.x - point.x,
              y: this.state.cloneSource!.y - point.y,
            }
        : null;
    this.gesture = {
      ...base,
      kind: "paint",
      tool,
      layer,
      fresh,
      after: selected,
      origin,
      inputTransform,
      clip: transformSelection(doc.selection?.toJSON(), inputTransform),
      points: [this.point(point, origin, modifiers.pressure, inputTransform)],
      settings: { ...this.state.settings },
      offset,
      stroke: new (tool === "pencil"
        ? PencilStroke
        : tool === "eraser"
          ? EraserStroke
          : BrushStroke)({
        points: [this.point(point, origin, modifiers.pressure, inputTransform)],
        size: this.state.settings.size,
        hardness: this.state.settings.hardness,
        opacity: this.state.settings.opacity,
        flow: this.state.settings.flow,
        spacing: this.state.settings.spacing,
        pressureSize: this.state.settings.pressureSize,
        pressureOpacity: this.state.settings.pressureOpacity,
        color: this.state.settings.color,
        clip: transformSelection(doc.selection?.toJSON(), inputTransform),
      }).toJSON() as BrushStrokeData,
    };
    // Place an empty transient layer once. Pointer movement never clones or
    // validates the document; only the final DOM commit enters history.
    if (fresh)
      this.publish({ preview: this.newLayerPreview(layer.toJSON(), selected) });
    this.updatePaintPreview(this.gesture);
    this.publish({ drawing: true });
  }
  private penCommand(gesture: PenGesture): EditorCommand {
    if (gesture.fresh) {
      const layer = gesture.layer.toJSON() as Extract<
        ReturnType<VectorLayer["toJSON"]>,
        { kind: "vector" }
      >;
      layer.paths.push(gesture.data);
      return this.newLayerPreview(layer, gesture.after);
    }
    return gesture.newPath
      ? { type: "path.add", id: gesture.layer.id, path: gesture.data }
      : {
          type: "path.update",
          id: gesture.layer.id,
          pathId: gesture.path.id,
          patch: {
            points: gesture.data.points.map((point, index) =>
              index === gesture.index ? structuredClone(point) : point),
            closed: gesture.data.closed,
          },
        };
  }
  private maskWorld(
    document: Document,
    layer: Layer,
    mask: LayerMaskData,
  ): AffineTransform {
    return maskTransform(mask, layerTransform(document._read(), layer.id)!);
  }
  startMaskContour() {
    const { doc, selected } = this.unlocked();
    const mask = selected?.mask;
    if (!selected || mask?.kind !== "vector")
      throw new Error("Select a layer with a Bézier mask first.");
    const data = mask.toJSON();
    if (data.kind !== "vector") return;
    if (data.paths.length >= 128)
      throw new Error("This mask has reached its 128-contour limit.");
    if (
      data.paths.reduce((count, path) => count + path.points.length, 0) >= 20000
    )
      throw new Error("This mask has reached its 20,000-anchor limit.");
    this.cancel();
    this.maskPoint = null;
    const position = layerOrigin(doc.getSnapshot().document, selected.id)!;
    this.maskContour = {
      document: doc,
      revision: doc.getSnapshot().revision,
      generation: this.generation,
      layer: selected,
      mask,
      pathIndex: data.paths.length,
      origin: maskOrigin(data, position.x, position.y),
      world: this.maskWorld(doc, selected, data),
      inputTransform: this.maskWorld(doc, selected, data).inverse(),
      points: [],
    };
    this.publish({});
  }
  private assertMaskContour(draft: MaskContourDraft) {
    try {
      this.assertCurrent(draft);
      if (draft.document.selectedLayer?.id !== draft.layer.id)
        throw new Error("The selected layer changed. Start a new contour.");
      this.unlocked();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  private previewMaskContour(draft: MaskContourDraft, points: PathAnchor[]) {
    const data = draft.mask.toJSON();
    if (data.kind !== "vector") return;
    this.publish({
      preview: points.length
        ? {
            type: "layer.update",
            id: draft.layer.id,
            patch: {
              mask: {
                ...data,
                paths: [...data.paths, { points: structuredClone(points) }],
              },
            },
          }
        : null,
    });
  }
  private beginMaskContour(point: Point, zoom: number) {
    const draft = this.maskContour!;
    this.assertMaskContour(draft);
    const local = draft.inputTransform.point(point);
    const points = structuredClone(draft.points);
    const close =
      points.length >= 2 &&
      Math.hypot(
        draft.world.point(points[0]).x - point.x,
        draft.world.point(points[0]).y - point.y,
      ) <=
        7 / zoom;
    if (!close) {
      const count = draft.mask.paths.reduce(
        (sum, path) => sum + path.points.length,
        0,
      );
      if (count + points.length >= 20000)
        throw new Error("This mask has reached its 20,000-anchor limit.");
      points.push({ ...local, in: { ...local }, out: { ...local } });
    }
    this.gesture = {
      kind: "mask-contour",
      document: draft.document,
      revision: draft.revision,
      generation: draft.generation,
      draft,
      points,
      close,
    };
    this.previewMaskContour(draft, points);
    this.publish({ drawing: true });
  }
  private beginMaskPen(
    base: BaseGesture,
    layer: Layer | null,
    point: Point,
    zoom: number,
  ) {
    const mask = layer?.mask;
    if (!layer || mask?.kind !== "vector")
      throw new Error("Select a layer with a Bézier mask first.");
    const data = mask.toJSON();
    if (data.kind !== "vector") return;
    const layerPosition = layerOrigin(
      base.document.getSnapshot().document,
      layer.id,
    )!;
    const origin = maskOrigin(data, layerPosition.x, layerPosition.y);
    const world = this.maskWorld(base.document, layer, data);
    const inputTransform = world.inverse();
    const local = inputTransform.point(point);
    for (let pathIndex = data.paths.length - 1; pathIndex >= 0; pathIndex--) {
      const points = data.paths[pathIndex].points;
      for (let index = 0; index < points.length; index++)
        for (const mode of ["in", "out", "anchor"] as const) {
          const anchor = points[index],
            p = mode === "anchor" ? anchor : anchor[mode];
          if (mode !== "anchor" && p.x === anchor.x && p.y === anchor.y)
            continue;
          if (
            Math.hypot(world.point(p).x - point.x, world.point(p).y - point.y) >
            7 / zoom
          )
            continue;
          this.maskPoint = { layerId: layer.id, pathIndex, index };
          this.gesture = {
            ...base,
            kind: "mask-pen",
            layer,
            mask,
            data,
            pathIndex,
            index,
            mode,
            original: structuredClone(anchor),
            start: local,
            origin,
            inputTransform,
            changed: false,
          };
          this.publish({ drawing: true });
          return;
        }
    }
    this.maskPoint = null;
    let hit: (CurveHit & { pathIndex: number }) | null = null;
    const budget = { remaining: 65536 };
    for (let pathIndex = data.paths.length - 1; pathIndex >= 0; pathIndex--) {
      const candidate = hitTestPath(
        data.paths[pathIndex].points.map((p) => ({
          ...p,
          ...world.point(p),
          in: world.point(p.in),
          out: world.point(p.out),
        })),
        true,
        point,
        zoom,
        hit?.distance ?? 7,
        budget,
      );
      if (candidate && (!hit || candidate.distance < hit.distance))
        hit = { ...candidate, pathIndex };
    }
    if (!hit) return;
    if (data.paths.reduce((sum, path) => sum + path.points.length, 0) >= 20000)
      throw new Error("This mask has reached its 20,000-anchor limit.");
    const path = data.paths[hit.pathIndex];
    path.points = splitPathSegment(path.points, true, hit.index, hit.t);
    const index = hit.index + 1,
      original = path.points[index];
    this.gesture = {
      ...base,
      kind: "mask-pen",
      layer,
      mask,
      data,
      pathIndex: hit.pathIndex,
      index,
      mode: "insert",
      original,
      start: local,
      origin,
      inputTransform,
      changed: true,
    };
    this.publish({
      drawing: true,
      preview: {
        type: "layer.update",
        id: layer.id,
        patch: { mask: structuredClone(data) },
      },
    });
  }
  private beginPen(
    base: BaseGesture,
    selected: Layer | null,
    point: Point,
    zoom: number,
  ) {
    const fresh = !(selected instanceof VectorLayer),
      layer = selected instanceof VectorLayer ? selected : new VectorLayer();
    const origin = fresh
      ? { x: 0, y: 0 }
      : layerOrigin(base.document._read(), layer.id)!;
    const world = fresh
      ? new AffineTransform()
      : layerTransform(base.document._read(), layer.id)!;
    const inputTransform = world.inverse();
    const local = inputTransform.point(point);
    const target = this.state.penTarget;
    const layerData = layer._read();
    const paths = layerData.kind === "vector" ? layerData.paths : [];
    let sourcePath = target?.layerId === layer.id
      ? paths.find(candidate => candidate.id === target.pathId) ?? null : null;
    let path = sourcePath ? layer.paths.get(sourcePath.id) : null;
    let mode: PenGesture["mode"] = "new",
      index = sourcePath?.points.length ?? 0,
      newPath = !path;
    const near = (p: Point) => {
      const canvas = world.point(p);
      return Math.hypot(canvas.x - point.x, canvas.y - point.y) <= 7 / zoom;
    };
    if (sourcePath && sourcePath.points.length >= 3 && near(sourcePath.points[0])) {
      mode = "close";
      index = 0;
    } else {
      outer: for (const candidate of paths) {
        const points = candidate.points;
        for (let i = 0; i < points.length; i++) {
          const anchor = points[i];
          for (const part of ["in", "out", "anchor"] as const) {
            const p = part === "anchor" ? anchor : anchor[part];
            if (part !== "anchor" && p.x === anchor.x && p.y === anchor.y)
              continue;
            if (near(p)) {
              sourcePath = candidate;
              path = layer.paths.get(candidate.id);
              index = i;
              mode = part;
              newPath = false;
              break outer;
            }
          }
        }
      }
    }
    if (!path)
      path = new VectorPath({
        points: [local],
        stroke: this.state.settings.color,
        fill: this.state.settings.penFill ? this.state.settings.color : null,
        strokeWidth: this.state.settings.penWidth,
      });
    // Existing path records are immutable document data. Clone only the active
    // anchor; public path getters remain defensive for external callers.
    const original = sourcePath ?? freeze(path.toJSON()),
      data = { ...original, points: [...original.points] };
    // Only the active anchor is mutable during a Pen gesture.
    if (data.points[index]) data.points[index] = structuredClone(data.points[index]);
    if (mode === "new" && !newPath)
      data.points.push({ ...local, in: { ...local }, out: { ...local } });
    if (mode === "close") data.closed = true;
    const gesture: PenGesture = {
      ...base,
      kind: "pen",
      layer,
      fresh,
      after: selected,
      path,
      newPath,
      data,
      original,
      index,
      mode,
      start: local,
      origin,
      inputTransform,
    };
    this.gesture = gesture;
    this.publish({
      preview: this.penCommand(gesture),
      selectedPath: { layerId: layer.id, pathId: path.id },
    });
  }
  move(
    point: Point,
    modifiers: { shift: boolean; alt: boolean; pressure: number },
  ) {
    if (this.crop.dragging) {
      this.crop.move(point, modifiers.shift);
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.kind === "fill") return;
    if (gesture.kind === "heal") {
      let next = this.point(point, { x: 0, y: 0 }, modifiers.pressure);
      const last = gesture.stroke.points.at(-1)!;
      const factor = 1 - Math.min(0.9, gesture.settings.smoothing);
      next = {
        x: last.x + (next.x - last.x) * factor,
        y: last.y + (next.y - last.y) * factor,
        pressure: last.pressure + (next.pressure - last.pressure) * factor,
      };
      if (Math.hypot(next.x - last.x, next.y - last.y) < 0.25) return;
      if (gesture.stroke.points.length >= 20000)
        throw new Error(
          "Finish this healing stroke before adding more points.",
        );
      gesture.stroke.points.push(next);
      if (this.paintFrame === null)
        this.paintFrame = requestAnimationFrame(() => {
          this.paintFrame = null;
          if (this.gesture === gesture)
            this.publish({ healingStroke: { ...gesture.stroke } });
        });
      return;
    }
    if (gesture.kind === "patch") {
      gesture.offset = {
        x: Math.round(point.x - gesture.start.x),
        y: Math.round(point.y - gesture.start.y),
      };
      this.publish({ patchOffset: gesture.offset });
      return;
    }
    if (gesture.kind === "mask-contour") {
      if (gesture.close) return;
      const anchor = gesture.points.at(-1)!;
      const local = gesture.draft.inputTransform.point(point);
      anchor.out = local;
      anchor.in = { x: 2 * anchor.x - local.x, y: 2 * anchor.y - local.y };
      if (this.paintFrame === null)
        this.paintFrame = requestAnimationFrame(() => {
          this.paintFrame = null;
          if (this.gesture === gesture)
            this.previewMaskContour(gesture.draft, gesture.points);
        });
      return;
    }
    if (gesture.kind === "mask-pen") {
      if (gesture.mode === "insert") return;
      const local = gesture.inputTransform.point(point);
      const anchor =
        gesture.data.paths[gesture.pathIndex].points[gesture.index];
      if (gesture.mode === "anchor") {
        const p = gesture.original,
          dx = local.x - gesture.start.x,
          dy = local.y - gesture.start.y;
        Object.assign(anchor, {
          x: p.x + dx,
          y: p.y + dy,
          in: { x: p.in.x + dx, y: p.in.y + dy },
          out: { x: p.out.x + dx, y: p.out.y + dy },
        });
      } else {
        const dx = local.x - gesture.start.x,
          dy = local.y - gesture.start.y;
        if (!dx && !dy)
          Object.assign(anchor, structuredClone(gesture.original));
        else {
          const handle = {
            x: gesture.original[gesture.mode].x + dx,
            y: gesture.original[gesture.mode].y + dy,
          };
          anchor[gesture.mode] = handle;
          if (!modifiers.alt)
            anchor[gesture.mode === "in" ? "out" : "in"] = {
              x: anchor.x * 2 - handle.x,
              y: anchor.y * 2 - handle.y,
            };
        }
      }
      gesture.changed =
        JSON.stringify(anchor) !== JSON.stringify(gesture.original);
      if (this.paintFrame === null)
        this.paintFrame = requestAnimationFrame(() => {
          this.paintFrame = null;
          if (this.gesture === gesture)
            this.publish({
              preview: {
                type: "layer.update",
                id: gesture.layer.id,
                patch: { mask: structuredClone(gesture.data) },
              },
            });
        });
      return;
    }
    if (gesture.kind === "mask-paint") {
      let p = this.point(
        point,
        gesture.origin,
        modifiers.pressure,
        gesture.inputTransform,
      );
      const last = gesture.stroke.points.at(-1)!;
      const smoothing = this.state.settings.smoothing ?? 0;
      if (smoothing > 0) {
        const factor = 1 - Math.min(0.9, smoothing);
        p = {
          x: last.x + (p.x - last.x) * factor,
          y: last.y + (p.y - last.y) * factor,
          pressure: last.pressure + (p.pressure - last.pressure) * factor,
        };
      }
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.25) return;
      if (gesture.stroke.points.length >= gesture.maxPoints)
        throw new Error("This mask stroke has reached its point limit.");
      gesture.stroke.points.push(p);
      if (this.paintFrame === null)
        this.paintFrame = requestAnimationFrame(() => {
          this.paintFrame = null;
          if (this.gesture === gesture) this.updateMaskPreview(gesture);
        });
      return;
    }
    if (gesture.kind === "paint") {
      let p = this.point(
        point,
        gesture.origin,
        modifiers.pressure,
        gesture.inputTransform,
      );
      const last = gesture.points.at(-1)!;
      const smoothing = gesture.settings.smoothing ?? 0;
      if (smoothing > 0) {
        const factor = 1 - Math.min(0.9, smoothing);
        p = {
          x: last.x + (p.x - last.x) * factor,
          y: last.y + (p.y - last.y) * factor,
          pressure: last.pressure + (p.pressure - last.pressure) * factor,
        };
      }
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.25) return;
      if (gesture.points.length >= 20000)
        throw new Error("Finish this stroke before adding more points.");
      gesture.points.push(p);
      if (this.paintFrame === null) {
        this.paintFrame = requestAnimationFrame(() => {
          this.paintFrame = null;
          if (this.gesture === gesture) this.updatePaintPreview(gesture);
        });
      }
      return;
    }
    if (gesture.kind === "lasso") {
      const last=gesture.points.at(-1)!;
      if(Math.hypot(point.x-last.x,point.y-last.y)<0.25)return;
      if(gesture.points.length>=20000)throw new Error("Finish this lasso before adding more points.");
      gesture.points.push(point);
      if(this.paintFrame===null)this.paintFrame=requestAnimationFrame(()=>{
        this.paintFrame=null;
        if(this.gesture===gesture)this.publish({lassoPoints:[...gesture.points]});
      });
      return;
    }
    if (gesture.kind === "marquee") {
      const width = Math.abs(point.x - gesture.start.x),
        height = Math.abs(point.y - gesture.start.y);
      const w = Math.max(1, width),
        h = Math.max(1, height);
      const region = {
        shape: gesture.shape,
        operation: "add" as const,
        x: Math.min(point.x, gesture.start.x),
        y: Math.min(point.y, gesture.start.y),
        width: w,
        height: h,
      };
      gesture.selection = {
        regions:
          gesture.operation === "replace"
            ? [region]
            : [
                ...(gesture.previous?.regions ?? []),
                { ...region, operation: gesture.operation },
              ],
      };
      this.publish({
        preview: { type: "selection.set", selection: gesture.selection },
      });
      return;
    }
    const local = gesture.inputTransform.point(point);
    const anchor = gesture.data.points[gesture.index];
    if (gesture.mode === "new") {
      anchor.out = local;
      anchor.in = { x: anchor.x * 2 - local.x, y: anchor.y * 2 - local.y };
    } else if (gesture.mode === "anchor") {
      const original = gesture.original.points[gesture.index],
        dx = local.x - gesture.start.x,
        dy = local.y - gesture.start.y;
      Object.assign(anchor, {
        x: original.x + dx,
        y: original.y + dy,
        in: { x: original.in.x + dx, y: original.in.y + dy },
        out: { x: original.out.x + dx, y: original.out.y + dy },
      });
    } else if (gesture.mode === "in" || gesture.mode === "out") {
      anchor[gesture.mode] = local;
      if (!modifiers.alt)
        anchor[gesture.mode === "in" ? "out" : "in"] = {
          x: anchor.x * 2 - local.x,
          y: anchor.y * 2 - local.y,
        };
    }
    this.publish({ preview: this.penCommand(gesture) });
  }
  private stroke(gesture: PaintGesture, tiles: CloneTile[] = []) {
    const options = {
      points: gesture.points,
      size: gesture.settings.size,
      hardness: gesture.settings.hardness,
      opacity: gesture.settings.opacity,
      flow: gesture.settings.flow,
      spacing: gesture.settings.spacing,
      pressureSize: gesture.settings.pressureSize,
      pressureOpacity: gesture.settings.pressureOpacity,
      color: gesture.settings.color,
      clip: gesture.clip,
    };
    return gesture.tool === "pencil"
      ? new PencilStroke(options)
      : gesture.tool === "clone"
        ? new CloneStroke({ ...options, tiles })
        : gesture.tool === "eraser"
          ? new EraserStroke(options)
          : new BrushStroke(options);
  }
  private updateMaskPreview(gesture: MaskPaintGesture) {
    this.publish({
      paintPreview: {
        layerId: gesture.layer.id,
        filterMask: gesture.filterMask,
        maskMode: gesture.mode,
        stroke: { ...gesture.stroke, points: gesture.stroke.points.slice() },
      },
    });
  }

  private updatePaintPreview(gesture: PaintGesture) {
    if (gesture.tool === "clone" && !gesture.cloneSource) {
      const snapshot=gesture.document.getSnapshot().document,assets=this.editor.assetStore;
      const inverse=gesture.inputTransform;
      const affine=inverse.a!==1||inverse.b!==0||inverse.c!==0||inverse.d!==1;
      const sampler=affine?new CanvasRenderer():null;
      const root=inverse.multiply(AffineTransform.translation(-gesture.offset!.x,-gesture.offset!.y));
      gesture.cloneSource=new ClonePreviewSource(async region=>{
        this.assertCurrent(gesture);
        const sx=region.x+gesture.origin.x+gesture.offset!.x,sy=region.y+gesture.origin.y+gesture.offset!.y;
        const image=sampler?await sampler.render(snapshot,assets,{region,cache:false,rootTransform:root,documentTransform:root})
          :await this.editor.renderer.render(snapshot,assets,{region:{...region,x:sx,y:sy},cache:false});
        try { this.assertCurrent(gesture); } catch(error) { release(image); throw error; }
        const c=image.getContext("2d")!;
        c.save();c.globalCompositeOperation="destination-in";c.fillStyle="#fff";
        if(sampler){
          const corners=[{x:0,y:0},{x:snapshot.width,y:0},{x:snapshot.width,y:snapshot.height},{x:0,y:snapshot.height}].map(p=>root.point(p));
          c.beginPath();c.moveTo(corners[0].x-region.x,corners[0].y-region.y);
          for(const p of corners.slice(1))c.lineTo(p.x-region.x,p.y-region.y);c.closePath();c.fill();
        }else c.fillRect(-sx,-sy,snapshot.width,snapshot.height);
        c.restore();return image;
      },()=>sampler?.dispose());
    }
    this.publish({
      paintPreview: {
        layerId: gesture.layer.id,
        cloneSource: gesture.cloneSource,
        stroke: { ...gesture.stroke, color: gesture.tool === "clone" ? "#ffffff" : gesture.stroke.color, points: gesture.points.slice() },
        tonal:
          gesture.tool === "dodge" || gesture.tool === "burn"
            ? {
                mode: gesture.tool,
                range: gesture.settings.tonalRange,
                exposure: gesture.settings.tonalExposure,
                protectTones: gesture.settings.protectTones,
              }
            : undefined,
      },
    });
  }

  private placeNew(layer: Layer, after: Layer | null, doc: Document) {
    doc.layers.add(layer);
    if (after instanceof LayerGroup)
      layer.moveTo(after, { preservePosition: true });
    else if (after) layer.moveAfter(after);
  }
  private newLayerPreview(
    layer: ReturnType<Layer["toJSON"]>,
    after: Layer | null,
  ): EditorCommand {
    const commands: EditorCommand[] = [{ type: "layer.add", layer }];
    if (after)
      commands.push({
        type: "layer.place",
        id: layer.id,
        targetId: after.id,
        placement: after instanceof LayerGroup ? "inside" : "after",
        preservePosition: true,
      });
    return { type: "transaction", label: "Drawing preview", commands };
  }
  private assertCurrent(gesture: BaseGesture) {
    if (
      gesture.generation !== this.generation ||
      this.editor.document !== gesture.document ||
      gesture.document.getSnapshot().revision !== gesture.revision
    )
      throw new Error("The document changed during this gesture. Try again.");
  }
  async end() {
    if (this.crop.dragging) {
      this.crop.end();
      return;
    }
    this.cancelFrame();
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    // Keep the displayed frame, but stop source work for previews that can no
    // longer be updated. Durable capture owns its own sampling resources.
    if (gesture.kind === "paint") gesture.cloneSource?.dispose();
    const assets = this.editor.assetStore;
    let stagedTiles: CloneTile[] = [];
    let committed = false;
    try {
      this.assertCurrent(gesture);
      const doc = gesture.document;
      if (gesture.kind === "heal") {
        const abort = new AbortController();
        this.patchAbort = abort;
        try {
          const layer = await this.editor.healStroke(
            new BrushStroke(gesture.stroke),
            { mode: gesture.settings.patchSampling },
            { mode: gesture.settings.patchMode },
            gesture.settings.healingRadius,
            abort.signal,
          );
          committed = true;
          doc.selectedLayer = layer;
        } catch (error) {
          if (!abort.signal.aborted) throw error;
        } finally {
          if (this.patchAbort === abort) this.patchAbort = null;
        }
        return;
      }
      if (gesture.kind === "patch") {
        if (!gesture.offset.x && !gesture.offset.y) return;
        const abort = new AbortController();
        this.patchAbort = abort;
        try {
          const layer = await this.editor.applyPatch(
            gesture.offset,
            { mode: gesture.settings.patchSampling },
            {
              mode: gesture.settings.patchMode,
              direction: gesture.settings.patchDirection,
            },
            abort.signal,
          );
          committed = true;
          doc.selectedLayer = layer;
        } catch (error) {
          if (!abort.signal.aborted) throw error;
        } finally {
          if (this.patchAbort === abort) this.patchAbort = null;
        }
        return;
      }
      if (gesture.kind === "mask-contour") {
        this.assertMaskContour(gesture.draft);
        gesture.draft.points = gesture.points;
        if (gesture.close) this.finishPath();
        return;
      }
      if (gesture.kind === "mask-pen") {
        if (gesture.changed)
          gesture.layer.mask = gesture.mask.with({
            paths: gesture.data.paths.map(
              (path) => new VectorPath({ points: path.points, closed: true }),
            ),
          });
        if (gesture.mode === "insert")
          this.maskPoint = {
            layerId: gesture.layer.id,
            pathIndex: gesture.pathIndex,
            index: gesture.index,
          };
        return;
      }
      if (gesture.kind === "mask-paint") {
        if (doc.selectedLayer?.id !== gesture.layer.id)
          throw new Error(
            "The mask target changed during this gesture. Try again.",
          );
        const mask = gesture.mask.paint(
          PaintOperation.fromJSON(gesture.stroke) as BrushStroke | PencilStroke,
          gesture.mode,
        );
        if (gesture.filterMask)
          (gesture.layer as SmartObjectLayer).filterMask = mask;
        else gesture.layer.mask = mask;
        return;
      }
      if (gesture.kind === "lasso") {
        const selection=lassoSelection(gesture.points,doc.width,doc.height);
        if(!selection.regions.length)return;
        const region=selection.regions[0];
        doc.selection=new MarqueeSelection(gesture.operation==='replace' ? selection : {regions:[...(gesture.previous?.regions??[]),{...region,operation:gesture.operation}]});
        return;
      }
      if (gesture.kind === "marquee") {
        doc.selection = new MarqueeSelection(gesture.selection);
        return;
      }
      if (gesture.kind === "pen") {
        doc.transaction("Edit vector path", () => {
          if (gesture.fresh) this.placeNew(gesture.layer, gesture.after, doc);
          if (gesture.newPath) {
            gesture.path.update({
              points: gesture.data.points,
              closed: gesture.data.closed,
            });
            gesture.layer.paths.add(gesture.path);
          } else
            gesture.path.update({
              points: gesture.data.points,
              closed: gesture.data.closed,
            });
        });
        doc.selectedLayer = gesture.layer;
        this.publish({
          penTarget:
            gesture.mode === "close" ||
            (gesture.mode !== "new" && gesture.data.closed)
              ? null
              : { layerId: gesture.layer.id, pathId: gesture.path.id },
        });
        return;
      }
      if (gesture.kind === "fill") {
        doc.transaction(
          doc.selection ? "Fill selection" : "Fill canvas",
          () => {
            if (gesture.fresh) this.placeNew(gesture.layer, gesture.after, doc);
            gesture.layer.strokes.add(gesture.fill);
          },
        );
        committed = true;
        doc.selectedLayer = gesture.layer;
        return;
      }
      let tiles: CloneTile[] = [];
      if (gesture.tool === "clone") tiles = await this.sampleClone(gesture);
      stagedTiles = tiles;
      this.assertCurrent(gesture);
      doc.transaction(
        gesture.tool === "clone"
          ? "Clone stroke"
          : gesture.tool === "pencil"
            ? "Pencil stroke"
            : gesture.tool === "eraser"
              ? "Eraser stroke"
              : gesture.tool === "dodge"
                ? "Dodge stroke"
                : gesture.tool === "burn"
                  ? "Burn stroke"
                  : "Brush stroke",
        () => {
          if (gesture.fresh) this.placeNew(gesture.layer, gesture.after, doc);
          if (gesture.layer instanceof AdjustmentLayer) {
            gesture.layer.addTonalStroke(
              new TonalStroke({
                brush: this.stroke(gesture) as BrushStroke,
                mode: gesture.tool === "burn" ? "burn" : "dodge",
                range: gesture.settings.tonalRange,
                exposure: gesture.settings.tonalExposure,
                protectTones: gesture.settings.protectTones,
              }),
            );
          } else if (gesture.layer instanceof RasterLayer) gesture.layer.erase(this.stroke(gesture) as EraserStroke);
          else gesture.layer.strokes.add(this.stroke(gesture, tiles));
        },
      );
      committed = true;
      doc.selectedLayer = gesture.layer;
      if (gesture.offset && gesture.settings.cloneAligned)
        this.publish({ cloneOffset: gesture.offset });
    } finally {
      if(gesture.kind === "paint")gesture.cloneSource?.dispose();
      if (!committed)
        stagedTiles.forEach((tile) => assets.remove(tile.assetId));
      this.publish({
        preview: null,
        lassoPoints: null,
        paintPreview: null,
        drawing: false,
        patchOffset: null,
        healingStroke: null,
      });
      if (this.maskContour) {
        if (
          this.maskContour.document === this.editor.document &&
          this.maskContour.revision ===
            this.editor.document.getSnapshot().revision
        )
          this.previewMaskContour(this.maskContour, this.maskContour.points);
        else this.cancel();
      }
    }
  }
  private async sampleClone(gesture: PaintGesture): Promise<CloneTile[]> {
    const snapshot = gesture.document.toJSON(),
      assets = this.editor.assetStore;
    const stroke = { ...gesture.stroke, points: gesture.points };
    const bounds = strokeBounds(stroke);
    const inverse = gesture.inputTransform;
    const affine =
      inverse.a !== 1 || inverse.b !== 0 || inverse.c !== 0 || inverse.d !== 1;
    const sampler = affine ? new CanvasRenderer() : null;
    const root = inverse.multiply(
      AffineTransform.translation(-gesture.offset!.x, -gesture.offset!.y),
    );
    const offset = gesture.offset!,
      tiles: CloneTile[] = [],
      created: string[] = [];
    const left = Math.floor(bounds.x),
      top = Math.floor(bounds.y),
      right = Math.ceil(bounds.x + bounds.width),
      bottom = Math.ceil(bounds.y + bounds.height);
    try {
      for (let ty = top; ty < bottom; ty += 1024)
        for (let tx = left; tx < right; tx += 1024) {
          const tile = { x: tx, y: ty, width: Math.min(1024, right-tx), height: Math.min(1024, bottom-ty) };
          if (!strokeIntersectsRegion(stroke, tile)) continue;
          const capture = strokeCaptureRegion(stroke, tile);
          if (!capture) continue;
          const { x, y, width, height } = capture;
          const sx = x + gesture.origin.x + offset.x,
            sy = y + gesture.origin.y + offset.y;
          const image = sampler
            ? await sampler.render(snapshot, assets, {
                region: { x, y, width, height },
                cache: false,
                readback: true,
                rootTransform: root,
                documentTransform: root,
              })
            : await this.editor.renderer.render(snapshot, assets, {
                region: { x: sx, y: sy, width, height },
                cache: false,
                readback: true,
              });
          try {
            const c = image.getContext("2d")!;
            // Pixels outside the source document are transparent, including any
            // off-canvas layer content returned by the general region renderer.
            if (sampler) {
              const corners = [
                { x: 0, y: 0 },
                { x: snapshot.width, y: 0 },
                { x: snapshot.width, y: snapshot.height },
                { x: 0, y: snapshot.height },
              ].map((p) => root.point(p));
              c.save();
              c.globalCompositeOperation = "destination-in";
              c.beginPath();
              c.moveTo(corners[0].x - x, corners[0].y - y);
              for (const p of corners.slice(1)) c.lineTo(p.x - x, p.y - y);
              c.closePath();
              c.fill();
              c.restore();
            } else {
              if (sx < 0) c.clearRect(0, 0, -sx, height);
              if (sy < 0) c.clearRect(0, 0, width, -sy);
              if (sx + width > snapshot.width)
                c.clearRect(snapshot.width - sx, 0, width, height);
              if (sy + height > snapshot.height)
                c.clearRect(0, snapshot.height - sy, width, height);
            }
            // Browser idle encoding can defer every tile for about a second.
            // Transfer the private readback to the worker for native encoding with direct fallback.
            const pixels = c.getImageData(0, 0, width, height).data;
            const blob = await this.editor.renderer.processor.encodePng(pixels, width, height);
            const asset = await assets.add(blob, "Clone source tile", undefined, false);
            created.push(asset.id);
            tiles.push({ assetId: asset.id, x, y, width, height });
          } finally {
            release(image);
          }
          this.assertCurrent(gesture);
        }
      return tiles;
    } catch (error) {
      created.forEach((id) => assets.remove(id));
      throw error;
    } finally {
      sampler?.dispose();
    }
  }
  private fillGeometry(doc: Document, layer: PaintLayer | null) {
    const inverse = layer
      ? layerTransform(doc._read(), layer.id)!.inverse()
      : new AffineTransform();
    const bounds = { x: 0, y: 0, width: doc.width, height: doc.height };
    const selection = doc.selection?.toJSON();
    const canvasRegion = {
      ...bounds,
      shape: "rectangle" as const,
      operation: selection ? ("intersect" as const) : ("add" as const),
    };
    return {
      bounds: inverse.bounds(bounds),
      clip: transformSelection(
        { regions: [...(selection?.regions ?? []), canvasRegion] },
        inverse,
      ),
    };
  }

  fillSelection(erase = false) {
    const { doc, selected } = this.unlocked();
    if (erase && selected instanceof RasterLayer) {
      const local = transformSelection(doc.selection?.toJSON(), layerTransform(doc._read(), selected.id)!.inverse());
      doc.transaction("Clear selected pixels", () => selected.clear(local ? new MarqueeSelection(local) : null));
      return;
    }
    if (erase && !(selected instanceof PaintLayer))
      throw new Error("Select a paint layer to clear its selected pixels.");
    const layer =
      selected instanceof PaintLayer
        ? selected
        : new PaintLayer({ name: "Selection fill" });
    const fresh = !layer.document;
    const fill = new PaintFill({
      color: this.state.settings.color,
      opacity: erase ? 1 : this.state.settings.opacity,
      erase,
      ...this.fillGeometry(doc, fresh ? null : layer),
    });
    doc.transaction(erase ? "Clear selected paint" : "Fill selection", () => {
      if (fresh) this.placeNew(layer, selected, doc);
      layer.strokes.add(fill);
    });
    doc.selectedLayer = layer;
  }
  get pendingStroke(): BrushStrokeData | null {
    const gesture = this.gesture;
    if (gesture?.kind !== "paint" || gesture.tool !== "clone") return null;
    // Source-position cursor; live pixels use the gesture-owned source cache.
    return new BrushStroke({
      points: gesture.points.map((p) => ({
        ...p,
        ...gesture.inputTransform.inverse().point(p),
      })),
      size: gesture.settings.size,
    }).toJSON() as BrushStrokeData;
  }
  addShape(
    kind: "rectangle" | "ellipse" | "polygon",
    params: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      cornerRadius?: number;
      radius?: number;
      sides?: number;
      fill?: string | null;
      stroke?: string | null;
      strokeWidth?: number;
    } = {},
  ): VectorPath {
    const doc = this.editor.document;
    const { selected } = this.unlocked();
    const targetLayer =
      selected instanceof VectorLayer
        ? selected
        : new VectorLayer({
            name: `${kind.charAt(0).toUpperCase() + kind.slice(1)}`,
          });
    const fresh = !(selected instanceof VectorLayer);
    const stroke =
      params.stroke === undefined ? this.state.settings.color : params.stroke;
    const strokeWidth = params.strokeWidth ?? this.state.settings.penWidth;
    const fill =
      params.fill === undefined
        ? this.state.settings.penFill
          ? this.state.settings.color
          : null
        : params.fill;
    const x = params.x ?? Math.round(doc.width / 4);
    const y = params.y ?? Math.round(doc.height / 4);
    const width = params.width ?? Math.round(doc.width / 2);
    const height = params.height ?? Math.round(doc.height / 2);

    let path: VectorPath;
    if (kind === "rectangle") {
      path = VectorPath.rectangle(
        { x, y, width, height },
        params.cornerRadius ?? 0,
        { stroke, strokeWidth, fill },
      );
    } else if (kind === "ellipse") {
      path = VectorPath.ellipse(
        { x, y, width, height },
        { stroke, strokeWidth, fill },
      );
    } else {
      const cx = params.x ?? Math.round(doc.width / 2);
      const cy = params.y ?? Math.round(doc.height / 2);
      const radius =
        params.radius ?? Math.round(Math.min(doc.width, doc.height) / 4);
      const sides = params.sides ?? 5;
      path = VectorPath.polygon({ x: cx, y: cy }, radius, sides, {
        stroke,
        strokeWidth,
        fill,
      });
    }

    doc.transaction(`Add ${kind} shape`, () => {
      if (fresh) this.placeNew(targetLayer, selected, doc);
      targetLayer.paths.add(path);
    });
    doc.selectedLayer = targetLayer;
    return path;
  }
  importSvgPath(d: string, options: ShapeOptions = {}): VectorPath {
    const doc = this.editor.document;
    const { selected } = this.unlocked();
    const targetLayer =
      selected instanceof VectorLayer
        ? selected
        : new VectorLayer({ name: "Imported vector" });
    const fresh = !(selected instanceof VectorLayer);
    const path = VectorPath.fromSvgPath(d, {
      stroke:
        options.stroke === undefined
          ? this.state.settings.color
          : options.stroke,
      strokeWidth: options.strokeWidth ?? this.state.settings.penWidth,
      fill:
        options.fill === undefined
          ? this.state.settings.penFill
            ? this.state.settings.color
            : null
          : options.fill,
    });
    doc.transaction("Import SVG path", () => {
      if (fresh) this.placeNew(targetLayer, selected, doc);
      targetLayer.paths.add(path);
    });
    doc.selectedLayer = targetLayer;
    return path;
  }
}
