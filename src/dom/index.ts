import { BlendIf, MarqueeSelection, PaintOperation } from "./values";
import { defaultStyle, pathSchema, styleSchema } from "../core/drawing";
import type {
  BlendIfData,
  LayerStyleData,
  PathAnchor,
  Point,
  VectorPathData,
} from "../core/drawing";
export {
  BlendIf,
  MarqueeSelection,
  PaintOperation,
  BrushStroke,
  PencilStroke,
  CloneStroke,
  PaintFill,
} from "./values";
export type { BrushOptions } from "./values";
import { execute } from "../core/commands";
import type { EditorCommand, LayerPatch } from "../core/commands";
import {
  allLayers,
  base,
  createDocument,
  createGroup,
  createRaster,
  createText,
  findLayer,
  id,
  toneOf,
  validateDocument,
} from "../core/model";
import type {
  BlendMode,
  DocumentData,
  GroupLayerData,
  LayerData,
  RasterLayerData,
  PaintLayerData,
  VectorLayerData,
  TextLayerData,
  ToneEffectData,
} from "../core/model";
import { EditorStore } from "../core/store";

export interface DocumentOptions {
  name?: string;
  width?: number;
  height?: number;
}
export interface LayerOptions {
  name?: string;
  x?: number;
  y?: number;
  opacity?: number;
  fillOpacity?: number;
  visible?: boolean;
  locked?: boolean;
  blendMode?: BlendMode;
}
export interface RasterLayerOptions extends LayerOptions {
  assetId: string;
  width: number;
  height: number;
}
export interface TextLayerOptions extends LayerOptions {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
}
export interface ToneOptions {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  enabled?: boolean;
}

/** Public document DOM. Constructors create objects; collections establish ownership.
 * Attached setters use commands. Stable object handles survive undo/redo because
 * properties resolve by ID against the current document, never stale snapshots.
 */
export class Document {
  private store: EditorStore;
  private handles = new Map<string, Layer>();
  private staged: DocumentData | null = null;
  private batch: EditorCommand[] | null = null;
  private commandListeners = new Set<(command: EditorCommand) => void>();
  readonly layers: LayerCollection;

  constructor(options: DocumentOptions = {}) {
    this.store = new EditorStore(
      createDocument(options.name, options.width, options.height),
    );
    this.layers = new LayerCollection(this);
  }

  static fromJSON(data: unknown): Document {
    validateDocument(data);
    const document = new Document();
    document.store = new EditorStore(data);
    return document;
  }

  get id() {
    return this._read().id;
  }
  get name() {
    return this._read().name;
  }
  set name(name: string) {
    this._dispatch({ type: "document.rename", name });
  }
  get width() {
    return this._read().width;
  }
  set width(value: number) {
    this.resize(value, this.height);
  }
  get height() {
    return this._read().height;
  }
  set height(value: number) {
    this.resize(this.width, value);
  }
  resize(width: number, height: number) {
    this._dispatch({ type: "document.resize", width, height });
  }
  get selectedLayer() {
    return this.getLayer(this.store.getSnapshot().selectedId);
  }
  set selectedLayer(layer: Layer | null) {
    if (layer && layer.document !== this)
      throw new Error("Layer belongs to another document.");
    this.store.select(layer?.id ?? null);
  }
  get selection(): MarqueeSelection | null {
    return this._read().selection
      ? new MarqueeSelection(this._read().selection!)
      : null;
  }
  set selection(value: MarqueeSelection | null) {
    this._dispatch({
      type: "selection.set",
      selection: value?.toJSON() ?? null,
    });
  }
  selectAll() {
    this.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    });
  }
  deselect() {
    this.selection = null;
  }
  get canUndo() {
    return this.store.getSnapshot().past.length > 0;
  }
  get canRedo() {
    return this.store.getSnapshot().future.length > 0;
  }
  subscribe = (listener: () => void) => this.store.subscribe(listener);
  onCommand(listener: (command: EditorCommand) => void) {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }
  getSnapshot = () => this.store.getSnapshot();
  toJSON(): DocumentData {
    return structuredClone(this._read());
  }
  undo() {
    if (this.batch) throw new Error("Finish the transaction first.");
    this.store.undo();
  }
  redo() {
    if (this.batch) throw new Error("Finish the transaction first.");
    this.store.redo();
  }

  getLayer(layerId: string | null): Layer | null {
    const data = findLayer(this._read(), layerId);
    if (!data) return null;
    let handle = this.handles.get(data.id);
    if (!handle) {
      handle = Layer._fromData(data);
      handle._attach(this);
    }
    return handle;
  }

  /** Synchronous, atomic changes; one history entry. Failed batches roll back. */
  transaction(label: string, callback: () => void): void {
    if (this.batch) throw new Error("Nested transactions are not supported.");
    this.batch = [];
    this.staged = this.store.getSnapshot().document;
    try {
      const result: unknown = callback();
      if (result instanceof Promise)
        throw new Error("Transactions must be synchronous.");
      const commands = this.batch;
      this.batch = null;
      this.staged = null;
      if (commands.length)
        this._dispatch({ type: "transaction", label, commands });
    } finally {
      this.batch = null;
      this.staged = null;
    }
  }

  /** @internal Read-only snapshot for DOM nodes and the renderer. */
  _read(): DocumentData {
    return this.staged ?? this.store.getSnapshot().document;
  }
  /** @internal Automation adapters must validate external requests before dispatch. */
  _dispatch(command: EditorCommand) {
    if (this.batch) {
      this.staged = execute(this._read(), command);
      this.batch.push(command);
    } else {
      this.store.dispatch(command);
      this.commandListeners.forEach((listener) =>
        listener(structuredClone(command)),
      );
    }
  }
  /** @internal */
  _register(layer: Layer) {
    this.handles.set(layer.id, layer);
  }
}

export abstract class Layer {
  protected data: LayerData;
  private owner: Document | null = null;
  /** @internal */ _parent: LayerGroup | null = null;
  protected constructor(data: LayerData) {
    this.data = data;
  }
  get id() {
    return this.data.id;
  }
  get document(): Document | null {
    return this.owner ?? this._parent?.document ?? null;
  }
  get isAttached() {
    return !!this.document && !!findLayer(this.document._read(), this.id);
  }
  get kind() {
    return this.data.kind;
  }
  get name() {
    return this._read().name;
  }
  set name(value: string) {
    this.update({ name: value });
  }
  get x() {
    return this._read().x;
  }
  set x(value: number) {
    this.update({ x: value });
  }
  get y() {
    return this._read().y;
  }
  set y(value: number) {
    this.update({ y: value });
  }
  get opacity() {
    return this._read().opacity;
  }
  set opacity(value: number) {
    this.update({ opacity: value });
  }
  get fillOpacity() {
    return this._read().fillOpacity ?? 1;
  }
  set fillOpacity(value: number) {
    this.update({ fillOpacity: value });
  }
  get styles(): LayerStyle {
    return LayerStyle._attached(this);
  }
  set styles(value: LayerStyle) {
    this.update({ styles: value.toJSON() });
  }
  get visible() {
    return this._read().visible;
  }
  set visible(value: boolean) {
    this.update({ visible: value });
  }
  get locked() {
    return this._read().locked;
  }
  set locked(value: boolean) {
    this.update({ locked: value });
  }
  get blendMode() {
    return this._read().blendMode;
  }
  set blendMode(value: BlendMode) {
    this.update({ blendMode: value });
  }
  toJSON(): LayerData {
    return structuredClone(this._read());
  }

  update(patch: LayerPatch) {
    if (this.document)
      this.document._dispatch({ type: "layer.update", id: this.id, patch });
    else {
      const updated = execute(
        { ...createDocument(), children: [this.data] },
        { type: "layer.update", id: this.id, patch },
      );
      Object.assign(this.data, updated.children[0]);
    }
  }
  remove() {
    this.requireDocument()._dispatch({ type: "layer.remove", id: this.id });
  }
  duplicate(): Layer {
    const document = this.requireDocument();
    const before = new Set(allIds(document._read().children));
    const newIds: Record<string, string> = {};
    for (const node of allLayers([this.toJSON()])) {
      newIds[node.id] = id();
      if (node.kind === "raster")
        for (const effect of node.effects) newIds[effect.id] = id();
      if (node.kind === "paint")
        for (const stroke of node.strokes) newIds[stroke.id] = id();
      if (node.kind === "vector")
        for (const path of node.paths) newIds[path.id] = id();
    }
    document._dispatch({ type: "layer.duplicate", id: this.id, newIds });
    const added = allIds(document._read().children).find(
      (key) => !before.has(key),
    )!;
    return document.getLayer(added)!;
  }
  moveUp() {
    this.requireDocument()._dispatch({
      type: "layer.reorder",
      id: this.id,
      direction: "up",
    });
  }
  moveDown() {
    this.requireDocument()._dispatch({
      type: "layer.reorder",
      id: this.id,
      direction: "down",
    });
  }
  moveTo(
    parent: Document | LayerGroup,
    options: { preservePosition?: boolean } = {},
  ) {
    const document = this.requireDocument();
    if ((parent instanceof Document ? parent : parent.document) !== document)
      throw new Error("Cannot move between documents.");
    document._dispatch({
      type: "layer.place",
      id: this.id,
      targetId: parent instanceof Document ? null : parent.id,
      placement: "inside",
      preservePosition: options.preservePosition ?? false,
    });
  }
  moveBefore(target: Layer) {
    this.placeBeside(target, "before");
  }
  moveAfter(target: Layer) {
    this.placeBeside(target, "after");
  }
  private placeBeside(target: Layer, placement: "before" | "after") {
    const document = this.requireDocument();
    if (target.document !== document)
      throw new Error("Cannot move between documents.");
    document._dispatch({
      type: "layer.place",
      id: this.id,
      targetId: target.id,
      placement,
      preservePosition: true,
    });
  }
  protected requireDocument(): Document {
    if (!this.document || !this.isAttached)
      throw new Error("Add the layer to a document first.");
    return this.document;
  }
  /** @internal */
  _read(): LayerData {
    if (!this.document) return this.data;
    const node = findLayer(this.document._read(), this.id);
    if (!node)
      throw new Error("This layer is not in the current document revision.");
    return node;
  }
  /** @internal */
  _attach(document: Document) {
    const children =
      this instanceof LayerGroup ? this.layers._detachedHandles() : [];
    this.owner = document;
    document._register(this);
    children.forEach((child) => child._attach(document));
  }
  /** @internal */
  static _fromData(data: LayerData, copy = true): Layer {
    const layer: Layer =
      data.kind === "group"
        ? new LayerGroup({ name: data.name })
        : data.kind === "paint"
          ? new PaintLayer({ name: data.name })
          : data.kind === "vector"
            ? new VectorLayer({ name: data.name })
            : data.kind === "text"
              ? new TextLayer({ name: data.name, text: data.text })
              : new RasterLayer({
                  name: data.name,
                  assetId: data.assetId,
                  width: data.width,
                  height: data.height,
                });
    layer.data = copy ? structuredClone(data) : data;
    return layer;
  }
}

function allIds(nodes: LayerData[]): string[] {
  return nodes.flatMap((node) => [
    node.id,
    ...(node.kind === "group" ? allIds(node.children) : []),
  ]);
}

export class RasterLayer extends Layer {
  readonly adjustments: AdjustmentCollection;
  constructor(options: RasterLayerOptions) {
    const { assetId, width, height, ...base } = options;
    super({
      ...createRaster(options.name ?? "Image", assetId, width, height),
      ...base,
    });
    validateDocument({ ...createDocument(), children: [this.data] });
    this.adjustments = new AdjustmentCollection(this);
  }
  get assetId() {
    return (this._read() as RasterLayerData).assetId;
  }
  get width() {
    return (this._read() as RasterLayerData).width;
  }
  set width(value: number) {
    this.update({ width: value });
  }
  get height() {
    return (this._read() as RasterLayerData).height;
  }
  set height(value: number) {
    this.update({ height: value });
  }
  setTone(values: ToneOptions) {
    const tone = toneOf(this._read() as RasterLayerData);
    const existing = this.adjustments.get(tone.id);
    if (existing) existing.update(values);
    else this.adjustments.add(new ToneAdjustment({ ...tone, ...values }));
  }
  resetAdjustments() {
    if (this.document)
      this.document._dispatch({ type: "effect.reset", id: this.id });
    else (this.data as RasterLayerData).effects = [];
  }
  /** @internal */
  _effectCommand(command: EditorCommand) {
    if (this.document) this.document._dispatch(command);
    else {
      const next = execute(
        { ...createDocument(), children: [this.data] },
        command,
      );
      Object.assign(this.data, next.children[0]);
    }
  }
}

export class LayerGroup extends Layer {
  readonly layers: LayerCollection;
  constructor(options: LayerOptions = {}) {
    super({ ...createGroup(options.name), ...options });
    validateDocument({ ...createDocument(), children: [this.data] });
    this.layers = new LayerCollection(this);
  }
}

export class LayerCollection implements Iterable<Layer> {
  private detached = new Map<string, Layer>();
  constructor(private owner: Document | LayerGroup) {}
  private get document() {
    return this.owner instanceof Document ? this.owner : this.owner.document;
  }
  private get data() {
    return this.owner instanceof Document
      ? this.owner._read().children
      : (this.owner._read() as GroupLayerData).children;
  }
  get length() {
    return this.data.length;
  }
  at(index: number): Layer | null {
    const data = this.data.at(index);
    return data ? this.get(data.id) : null;
  }
  get(layerId: string): Layer | null {
    const data = this.data.find((node) => node.id === layerId);
    if (!data) return null;
    if (this.document) return this.document.getLayer(layerId);
    if (!this.detached.has(layerId)) {
      const handle = Layer._fromData(data, false);
      handle._parent = this.owner as LayerGroup;
      this.detached.set(layerId, handle);
    }
    return this.detached.get(layerId)!;
  }
  add<T extends Layer>(layer: T): T {
    if (layer.document || layer._parent)
      throw new Error(
        "This layer already has an owner. Use moveTo or duplicate.",
      );
    if (
      this.owner instanceof LayerGroup &&
      (layer.id === this.owner.id ||
        allIds([layer.toJSON()]).includes(this.owner.id))
    )
      throw new Error("A group cannot contain itself.");
    const document = this.document;
    if (document) {
      document._dispatch({
        type: "layer.add",
        layer: layer.toJSON(),
        parentId: this.owner instanceof LayerGroup ? this.owner.id : undefined,
      });
      layer._attach(document);
    } else {
      const prospective = [...this.data, layer.toJSON()];
      validateDocument({ ...createDocument(), children: prospective });
      // Preserve detached object identity until the subtree is attached.
      this.data.push(layer._read());
      layer._parent = this.owner as LayerGroup;
      this.detached.set(layer.id, layer);
    }
    return layer;
  }
  *[Symbol.iterator]() {
    for (const data of this.data) yield this.get(data.id)!;
  }
  /** @internal */ _detachedHandles(): Layer[] {
    return [...this.detached.values()];
  }
}

export class ToneAdjustment {
  private data: ToneEffectData;
  /** @internal */ _owner: RasterLayer | null = null;
  constructor(options: ToneOptions = {}) {
    this.data = {
      id: id(),
      kind: "tone",
      enabled: options.enabled ?? true,
      exposure: options.exposure ?? 0,
      contrast: options.contrast ?? 0,
      saturation: options.saturation ?? 0,
    };
    validateDocument({
      ...createDocument(),
      children: [
        { ...createRaster("Validation", "asset", 1, 1), effects: [this.data] },
      ],
    });
  }
  get id() {
    return this.data.id;
  }
  private read() {
    if (!this._owner) return this.data;
    const effect = (this._owner._read() as RasterLayerData).effects.find(
      (item) => item.id === this.id,
    );
    if (!effect)
      throw new Error(
        "This adjustment is not in the current document revision.",
      );
    return effect;
  }
  get exposure() {
    return this.read().exposure;
  }
  set exposure(value: number) {
    this.update({ exposure: value });
  }
  get contrast() {
    return this.read().contrast;
  }
  set contrast(value: number) {
    this.update({ contrast: value });
  }
  get saturation() {
    return this.read().saturation;
  }
  set saturation(value: number) {
    this.update({ saturation: value });
  }
  get enabled() {
    return this.read().enabled;
  }
  set enabled(value: boolean) {
    this.update({ enabled: value });
  }
  toJSON() {
    return structuredClone(this.read());
  }
  update(values: ToneOptions) {
    if (this._owner)
      this._owner._effectCommand({
        type: "effect.update",
        id: this._owner.id,
        effectId: this.id,
        values,
      });
    else {
      const next = { ...this.data, ...values };
      validateDocument({
        ...createDocument(),
        children: [
          { ...createRaster("Validation", "asset", 1, 1), effects: [next] },
        ],
      });
      this.data = next;
    }
  }
  remove() {
    if (!this._owner) throw new Error("Add this adjustment to a layer first.");
    this._owner._effectCommand({
      type: "effect.remove",
      id: this._owner.id,
      effectId: this.id,
    });
  }
  /** @internal */ static _fromData(data: ToneEffectData) {
    const effect = new ToneAdjustment(data);
    effect.data = structuredClone(data);
    return effect;
  }
}

export class AdjustmentCollection implements Iterable<ToneAdjustment> {
  private handles = new Map<string, ToneAdjustment>();
  constructor(private owner: RasterLayer) {}
  private get data() {
    return (this.owner._read() as RasterLayerData).effects;
  }
  get length() {
    return this.data.length;
  }
  at(index: number) {
    const data = this.data.at(index);
    return data ? this.get(data.id) : null;
  }
  get(effectId: string): ToneAdjustment | null {
    const data = this.data.find((effect) => effect.id === effectId);
    if (!data) return null;
    if (!this.handles.has(effectId)) {
      const effect = ToneAdjustment._fromData(data);
      effect._owner = this.owner;
      this.handles.set(effectId, effect);
    }
    return this.handles.get(effectId)!;
  }
  add(effect: ToneAdjustment): ToneAdjustment {
    if (effect._owner)
      throw new Error("Adjustment already belongs to a layer.");
    this.owner._effectCommand({
      type: "effect.add",
      id: this.owner.id,
      effect: effect.toJSON(),
    });
    effect._owner = this.owner;
    this.handles.set(effect.id, effect);
    return effect;
  }
  *[Symbol.iterator]() {
    for (const data of this.data) yield this.get(data.id)!;
  }
}

export interface LayerStyleOptions {
  blendIf?: BlendIf | Partial<BlendIfData>;
  colorOverlay?: Partial<LayerStyleData["colorOverlay"]>;
  dropShadow?: Partial<LayerStyleData["dropShadow"]>;
}
export class LayerStyle {
  private data = defaultStyle();
  private owner: Layer | null = null;
  constructor(options: LayerStyleOptions = {}) {
    this.update(options);
  }
  private read() {
    return this.owner?._read().styles ?? this.data;
  }
  get blendIf() {
    return new BlendIf(this.read().blendIf);
  }
  set blendIf(value: BlendIf) {
    this.update({ blendIf: value });
  }
  get colorOverlay() {
    return structuredClone(this.read().colorOverlay);
  }
  set colorOverlay(value: Partial<LayerStyleData["colorOverlay"]>) {
    this.update({ colorOverlay: value });
  }
  get dropShadow() {
    return structuredClone(this.read().dropShadow);
  }
  set dropShadow(value: Partial<LayerStyleData["dropShadow"]>) {
    this.update({ dropShadow: value });
  }
  toJSON(): LayerStyleData {
    return structuredClone(this.read());
  }
  update(options: LayerStyleOptions) {
    const current = this.read();
    const next = styleSchema.parse({
      blendIf: {
        ...current.blendIf,
        ...(options.blendIf instanceof BlendIf
          ? options.blendIf.toJSON()
          : options.blendIf),
      },
      colorOverlay: { ...current.colorOverlay, ...options.colorOverlay },
      dropShadow: { ...current.dropShadow, ...options.dropShadow },
    });
    if (this.owner) this.owner.update({ styles: next });
    else this.data = next;
  }
  reset() {
    if (this.owner) this.owner.update({ styles: defaultStyle() });
    else this.data = defaultStyle();
  }
  /** @internal */ static _attached(owner: Layer) {
    const result = new LayerStyle();
    result.owner = owner;
    return result;
  }
}

export class PaintLayer extends Layer {
  readonly strokes = new StrokeCollection(this);
  constructor(options: LayerOptions = {}) {
    super({ ...base("Paint"), ...options, kind: "paint", strokes: [] });
    validateDocument({ ...createDocument(), children: [this.data] });
  }
  /** @internal */ _drawingCommand(command: EditorCommand) {
    if (this.document) this.document._dispatch(command);
    else
      Object.assign(
        this.data,
        execute({ ...createDocument(), children: [this.data] }, command)
          .children[0],
      );
  }
}
export class StrokeCollection implements Iterable<PaintOperation> {
  constructor(private owner: PaintLayer) {}
  private get data() {
    return (this.owner._read() as PaintLayerData).strokes;
  }
  get length() {
    return this.data.length;
  }
  at(index: number): PaintOperation | null {
    const data = this.data.at(index);
    return data ? PaintOperation.fromJSON(data) : null;
  }
  get(id: string): PaintOperation | null {
    const data = this.data.find((entry) => entry.id === id);
    return data ? PaintOperation.fromJSON(data) : null;
  }
  add<T extends PaintOperation>(stroke: T): T {
    this.owner._drawingCommand({
      type: "paint.add",
      id: this.owner.id,
      stroke: stroke.toJSON(),
    });
    return stroke;
  }
  remove(id: string) {
    this.owner._drawingCommand({
      type: "paint.remove",
      id: this.owner.id,
      strokeId: id,
    });
  }
  *[Symbol.iterator]() {
    for (const data of this.data) yield PaintOperation.fromJSON(data);
  }
}
export class VectorLayer extends Layer {
  readonly paths = new PathCollection(this);
  constructor(options: LayerOptions = {}) {
    super({ ...base("Vector"), ...options, kind: "vector", paths: [] });
    validateDocument({ ...createDocument(), children: [this.data] });
  }
  /** @internal */ _drawingCommand(command: EditorCommand) {
    if (this.document) this.document._dispatch(command);
    else
      Object.assign(
        this.data,
        execute({ ...createDocument(), children: [this.data] }, command)
          .children[0],
      );
  }
}
export interface VectorPathOptions {
  points: (Point & { in?: Point; out?: Point })[];
  closed?: boolean;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
}
export class VectorPath {
  private data: VectorPathData;
  /** @internal */ _owner: VectorLayer | null = null;
  constructor(options: VectorPathOptions) {
    this.data = pathSchema.parse({
      id: id(),
      points: options.points.map((p) => ({
        x: p.x,
        y: p.y,
        in: p.in ?? { x: p.x, y: p.y },
        out: p.out ?? { x: p.x, y: p.y },
      })),
      closed: options.closed ?? false,
      fill: options.fill ?? null,
      stroke: options.stroke === undefined ? "#d5e79b" : options.stroke,
      strokeWidth: options.strokeWidth ?? 2,
    });
  }
  private read() {
    if (!this._owner) return this.data;
    const path = (this._owner._read() as VectorLayerData).paths.find(
      (entry) => entry.id === this.id,
    );
    if (!path)
      throw new Error("This path is not in the current document revision.");
    return path;
  }
  get id() {
    return this.data.id;
  }
  get points(): PathAnchor[] {
    return structuredClone(this.read().points);
  }
  get closed() {
    return this.read().closed;
  }
  set closed(value: boolean) {
    this.update({ closed: value });
  }
  get fill() {
    return this.read().fill;
  }
  set fill(value: string | null) {
    this.update({ fill: value });
  }
  get stroke() {
    return this.read().stroke;
  }
  set stroke(value: string | null) {
    this.update({ stroke: value });
  }
  get strokeWidth() {
    return this.read().strokeWidth;
  }
  set strokeWidth(value: number) {
    this.update({ strokeWidth: value });
  }
  toJSON(): VectorPathData {
    return structuredClone(this.read());
  }
  update(patch: Partial<Omit<VectorPathData, "id">>) {
    if (this._owner)
      this._owner._drawingCommand({
        type: "path.update",
        id: this._owner.id,
        pathId: this.id,
        patch,
      });
    else this.data = pathSchema.parse({ ...this.data, ...patch });
  }
  addPoint(point: Point & { in?: Point; out?: Point }) {
    this.update({
      points: [
        ...this.points,
        {
          x: point.x,
          y: point.y,
          in: point.in ?? { x: point.x, y: point.y },
          out: point.out ?? { x: point.x, y: point.y },
        },
      ],
    });
  }
  setPoint(index: number, patch: Partial<PathAnchor>) {
    const points = this.points;
    if (!points[index]) throw new Error("Anchor not found.");
    points[index] = { ...points[index], ...patch };
    this.update({ points });
  }
  removePoint(index: number) {
    const points = this.points;
    if (!points[index]) throw new Error("Anchor not found.");
    points.splice(index, 1);
    this.update({ points });
  }
  remove() {
    if (!this._owner) throw new Error("Add the path to a layer first.");
    this._owner._drawingCommand({
      type: "path.remove",
      id: this._owner.id,
      pathId: this.id,
    });
  }
  /** @internal */ static _fromData(data: VectorPathData) {
    const result = new VectorPath(data);
    result.data = structuredClone(data);
    return result;
  }
}
export class PathCollection implements Iterable<VectorPath> {
  private handles = new Map<string, VectorPath>();
  constructor(private owner: VectorLayer) {}
  private get data() {
    return (this.owner._read() as VectorLayerData).paths;
  }
  get length() {
    return this.data.length;
  }
  get(id: string): VectorPath | null {
    const data = this.data.find((entry) => entry.id === id);
    if (!data) return null;
    if (!this.handles.has(id)) {
      const path = VectorPath._fromData(data);
      path._owner = this.owner;
      this.handles.set(id, path);
    }
    return this.handles.get(id)!;
  }
  at(index: number): VectorPath | null {
    const data = this.data.at(index);
    return data ? this.get(data.id) : null;
  }
  add(path: VectorPath): VectorPath {
    if (path._owner) throw new Error("Path already belongs to a vector layer.");
    this.owner._drawingCommand({
      type: "path.add",
      id: this.owner.id,
      path: path.toJSON(),
    });
    path._owner = this.owner;
    this.handles.set(path.id, path);
    return path;
  }
  *[Symbol.iterator]() {
    for (const data of this.data) yield this.get(data.id)!;
  }
}

export class TextLayer extends Layer {
  constructor(options: TextLayerOptions = {}) {
    const {
      text = "Text",
      fontSize = 32,
      fontFamily = "sans-serif",
      color = "#ffffff",
      align = "left",
      lineHeight = 1.2,
      ...baseOpts
    } = options;
    super({
      ...createText(options.name ?? "Text", text, {
        fontSize,
        fontFamily,
        color,
        align,
        lineHeight,
      }),
      ...baseOpts,
    });
    validateDocument({ ...createDocument(), children: [this.data] });
  }

  get text(): string {
    return (this._read() as TextLayerData).text;
  }
  set text(value: string) {
    this.update({ text: value });
  }

  get fontSize(): number {
    return (this._read() as TextLayerData).fontSize;
  }
  set fontSize(value: number) {
    this.update({ fontSize: value });
  }

  get fontFamily(): string {
    return (this._read() as TextLayerData).fontFamily;
  }
  set fontFamily(value: string) {
    this.update({ fontFamily: value });
  }

  get color(): string {
    return (this._read() as TextLayerData).color;
  }
  set color(value: string) {
    this.update({ color: value });
  }

  get align(): "left" | "center" | "right" {
    return (this._read() as TextLayerData).align;
  }
  set align(value: "left" | "center" | "right") {
    this.update({ align: value });
  }

  get lineHeight(): number {
    return (this._read() as TextLayerData).lineHeight;
  }
  set lineHeight(value: number) {
    this.update({ lineHeight: value });
  }

  get width(): number {
    return (this._read() as TextLayerData).width;
  }

  get height(): number {
    return (this._read() as TextLayerData).height;
  }
}
