import type { EditorApplication } from "./editor";
import {
  BrushStroke,
  CloneStroke,
  LayerGroup,
  MarqueeSelection,
  PaintFill,
  PaintLayer,
  PencilStroke,
  VectorLayer,
  VectorPath,
} from "./dom";
import type { Document, Layer } from "./dom";
import type { EditorCommand } from "./core/commands";
import { isLocked } from "./core/model";
import { layerOrigin } from "./core/spatial";
import { strokeBounds, translateSelection } from "./core/drawing";
import type {
  BrushStrokeData,
  CloneTile,
  FillData,
  Point,
  SelectionData,
  SelectionOperation,
  StrokePoint,
  VectorPathData,
} from "./core/drawing";
import { release } from "./engine/canvas";
import type { PaintPreview } from "./engine/renderer";

export type Tool =
  | "move"
  | "hand"
  | "brush"
  | "pencil"
  | "pen"
  | "marquee"
  | "clone"
  | "artboard"
  | "text"
  | "fill";
export interface ToolSettings {
  size: number;
  hardness: number;
  opacity: number;
  color: string;
  penWidth: number;
  penFill: boolean;
  selectionShape: "rectangle" | "ellipse";
  selectionMode: "replace" | SelectionOperation;
  cloneAligned: boolean;
}
interface ToolState {
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
  kind: "paint";
  tool: "brush" | "pencil" | "clone";
  points: StrokePoint[];
  layer: PaintLayer;
  fresh: boolean;
  after: Layer | null;
  origin: Point;
  clip: SelectionData | null;
  settings: ToolSettings;
  offset: Point | null;
  stroke: BrushStrokeData;
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
type Gesture = PaintGesture | MarqueeGesture | PenGesture | FillGesture;

/** Stateful tool orchestration; previews are commands, commits use the public DOM. */
export class ToolController {
  private state: ToolState = {
    settings: {
      size: 24,
      hardness: 0.7,
      opacity: 1,
      color: "#d5e79b",
      penWidth: 3,
      penFill: false,
      selectionShape: "rectangle",
      selectionMode: "replace",
      cloneAligned: true,
    },
    preview: null,
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
  private paintFrame: number | null = null;
  private cancelFrame() {
    if (this.paintFrame !== null) cancelAnimationFrame(this.paintFrame);
    this.paintFrame = null;
  }
  constructor(private editor: EditorApplication) {}
  getSnapshot = () => this.state;
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
    this.publish({ settings: { ...this.state.settings, ...patch } });
  }
  cancel() {
    this.cancelFrame();
    this.generation++;
    this.gesture = null;
    this.publish({ preview: null, paintPreview: null, drawing: false });
  }
  reset() {
    this.cancelFrame();
    this.generation++;
    this.gesture = null;
    this.publish({
      preview: null,
      paintPreview: null,
      drawing: false,
      penTarget: null,
      selectedPath: null,
      cloneSource: null,
      cloneOffset: null,
    });
  }
  finishPath() {
    this.cancel();
    this.publish({ penTarget: null });
  }
  removeLastAnchor() {
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
  private unlocked() {
    const doc = this.editor.document,
      selected = doc.selectedLayer;
    if (selected && isLocked(doc.toJSON(), selected.id))
      throw new Error(
        "Unlock the selected layer and its parent groups before drawing.",
      );
    return { doc, selected };
  }
  private point(point: Point, origin: Point, pressure: number): StrokePoint {
    return { x: point.x - origin.x, y: point.y - origin.y, pressure };
  }
  begin(
    tool: Tool,
    point: Point,
    modifiers: { alt: boolean; shift: boolean; pressure: number },
    zoom: number,
  ) {
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
        : layerOrigin(doc.toJSON(), layer.id)!;
      const clip = translateSelection(
        doc.selection?.toJSON(),
        -origin.x,
        -origin.y,
      );
      const fill = new PaintFill({
        color: this.state.settings.color,
        opacity: this.state.settings.opacity,
        bounds: {
          x: -origin.x,
          y: -origin.y,
          width: doc.width,
          height: doc.height,
        },
        clip,
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
    if (tool !== "brush" && tool !== "pencil" && tool !== "clone") return;
    if (tool === "clone" && !this.state.cloneSource)
      throw new Error(
        "Alt/Option-click on the canvas to choose a clone source first.",
      );
    const fresh = !(selected instanceof PaintLayer),
      layer =
        selected instanceof PaintLayer
          ? selected
          : new PaintLayer({
              name:
                tool === "clone"
                  ? "Clone retouch"
                  : tool === "pencil"
                    ? "Pencil drawing"
                    : "Brush painting",
            });
    const origin = fresh
      ? { x: 0, y: 0 }
      : layerOrigin(doc.toJSON(), layer.id)!;
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
      clip: translateSelection(doc.selection?.toJSON(), -origin.x, -origin.y),
      points: [this.point(point, origin, modifiers.pressure)],
      settings: { ...this.state.settings },
      offset,
      stroke: new (tool === "pencil" ? PencilStroke : BrushStroke)({
        points: [this.point(point, origin, modifiers.pressure)],
        size: this.state.settings.size,
        hardness: this.state.settings.hardness,
        opacity: this.state.settings.opacity,
        color: this.state.settings.color,
        clip: translateSelection(doc.selection?.toJSON(), -origin.x, -origin.y),
      }).toJSON() as BrushStrokeData,
    };
    // Place an empty transient layer once. Pointer movement never clones or
    // validates the document; only the final DOM commit enters history.
    if (fresh && tool !== "clone")
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
          patch: { points: gesture.data.points, closed: gesture.data.closed },
        };
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
      : layerOrigin(base.document.toJSON(), layer.id)!;
    const local = { x: point.x - origin.x, y: point.y - origin.y };
    const target = this.state.penTarget;
    let path =
      target?.layerId === layer.id ? layer.paths.get(target.pathId) : null;
    let mode: PenGesture["mode"] = "new",
      index = path?.points.length ?? 0,
      newPath = !path;
    const near = (p: Point) =>
      Math.hypot(p.x - local.x, p.y - local.y) <= 7 / zoom;
    if (path && path.points.length >= 3 && near(path.points[0])) {
      mode = "close";
      index = 0;
    } else {
      outer: for (const candidate of layer.paths)
        for (let i = 0; i < candidate.points.length; i++) {
          const anchor = candidate.points[i];
          for (const part of ["in", "out", "anchor"] as const) {
            const p = part === "anchor" ? anchor : anchor[part];
            if (part !== "anchor" && p.x === anchor.x && p.y === anchor.y)
              continue;
            if (near(p)) {
              path = candidate;
              index = i;
              mode = part;
              newPath = false;
              break outer;
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
    const original = path.toJSON(),
      data = path.toJSON();
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
    const gesture = this.gesture;
    if (!gesture || gesture.kind === "fill") return;
    if (gesture.kind === "paint") {
      const p = this.point(point, gesture.origin, modifiers.pressure),
        last = gesture.points.at(-1)!;
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
    const local = {
      x: point.x - gesture.origin.x,
      y: point.y - gesture.origin.y,
    };
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
      size:
        gesture.tool === "pencil"
          ? gesture.settings.size
          : gesture.settings.size,
      hardness: gesture.settings.hardness,
      opacity: gesture.settings.opacity,
      color: gesture.settings.color,
      clip: gesture.clip,
    };
    return gesture.tool === "pencil"
      ? new PencilStroke(options)
      : gesture.tool === "clone"
        ? new CloneStroke({ ...options, tiles })
        : new BrushStroke(options);
  }
  private updatePaintPreview(gesture: PaintGesture) {
    if (gesture.tool === "clone") {
      this.publish({ preview: null });
      return;
    }
    this.publish({ paintPreview: {
      layerId: gesture.layer.id,
      stroke: { ...gesture.stroke, points: gesture.points.slice() },
    } });
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
    this.cancelFrame();
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    const assets = this.editor.assetStore;
    let stagedTiles: CloneTile[] = [];
    let committed = false;
    try {
      this.assertCurrent(gesture);
      const doc = gesture.document;
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
            : "Brush stroke",
        () => {
          if (gesture.fresh) this.placeNew(gesture.layer, gesture.after, doc);
          gesture.layer.strokes.add(this.stroke(gesture, tiles));
        },
      );
      committed = true;
      doc.selectedLayer = gesture.layer;
      if (gesture.offset && gesture.settings.cloneAligned)
        this.publish({ cloneOffset: gesture.offset });
    } finally {
      if (!committed)
        stagedTiles.forEach((tile) => assets.remove(tile.assetId));
      this.publish({ preview: null, paintPreview: null, drawing: false });
    }
  }
  private async sampleClone(gesture: PaintGesture): Promise<CloneTile[]> {
    const snapshot = gesture.document.toJSON(),
      assets = this.editor.assetStore;
    const bounds = strokeBounds(
      new BrushStroke({
        points: gesture.points,
        size: gesture.settings.size,
      }).toJSON(),
    );
    const offset = gesture.offset!,
      tiles: CloneTile[] = [],
      created: string[] = [];
    const left = Math.floor(bounds.x),
      top = Math.floor(bounds.y),
      right = Math.ceil(bounds.x + bounds.width),
      bottom = Math.ceil(bounds.y + bounds.height);
    try {
      for (let y = top; y < bottom; y += 1024)
        for (let x = left; x < right; x += 1024) {
          const width = Math.min(1024, right - x),
            height = Math.min(1024, bottom - y);
          const sx = x + gesture.origin.x + offset.x,
            sy = y + gesture.origin.y + offset.y;
          const image = await this.editor.renderer.render(snapshot, assets, {
            region: { x: sx, y: sy, width, height },
            cache: false,
          });
          try {
            const c = image.getContext("2d")!;
            // Pixels outside the source document are transparent, including any
            // off-canvas layer content returned by the general region renderer.
            if (sx < 0) c.clearRect(0, 0, -sx, height);
            if (sy < 0) c.clearRect(0, 0, width, -sy);
            if (sx + width > snapshot.width)
              c.clearRect(snapshot.width - sx, 0, width, height);
            if (sy + height > snapshot.height)
              c.clearRect(0, snapshot.height - sy, width, height);
            const blob = await new Promise<Blob>((resolve, reject) =>
              image.toBlob(
                (blob) =>
                  blob
                    ? resolve(blob)
                    : reject(new Error("Could not sample clone source.")),
                "image/png",
              ),
            );
            const asset = await assets.add(blob, "Clone source tile");
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
    }
  }
  fillSelection(erase = false) {
    const { doc, selected } = this.unlocked();
    if (erase && !(selected instanceof PaintLayer))
      throw new Error("Select a paint layer to clear its selected pixels.");
    const layer =
      selected instanceof PaintLayer
        ? selected
        : new PaintLayer({ name: "Selection fill" });
    const fresh = !layer.document,
      origin = fresh ? { x: 0, y: 0 } : layerOrigin(doc.toJSON(), layer.id)!;
    const fill = new PaintFill({
      color: this.state.settings.color,
      opacity: erase ? 1 : this.state.settings.opacity,
      erase,
      bounds: {
        x: -origin.x,
        y: -origin.y,
        width: doc.width,
        height: doc.height,
      },
      clip: translateSelection(doc.selection?.toJSON(), -origin.x, -origin.y),
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
    // Cursor overlay only; clone pixels are sampled atomically on release.
    return new BrushStroke({
      points: gesture.points.map((p) => ({
        ...p,
        x: p.x + gesture.origin.x,
        y: p.y + gesture.origin.y,
      })),
      size: gesture.settings.size,
    }).toJSON() as BrushStrokeData;
  }
}
