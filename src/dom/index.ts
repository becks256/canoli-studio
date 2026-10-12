import { freeze, isImmutable } from "../core/immutable";
import { EraserStroke, PaintFill } from "./values";
import { LayerCompCollection } from "./layer-comps";
export { LayerComp, LayerCompCollection } from "./layer-comps";
import { parseRetainedHistory } from "../core/history";
import { SmartFilter } from "./smart-filters";
export {
  SmartFilter,
  GaussianBlurFilter,
  UnsharpMaskFilter,
  SmartToneFilter,
} from "./smart-filters";
import {
  smartFiltersSchema,
  type SmartFilterData,
} from "../core/smart/filters";
import { ComponentRegistry } from "../core/smart/manager";
import type { SmartObjectInstanceData } from "../core/smart/types";
import { PatchAdjustment, TonalStroke } from "./retouch";
import {
  healSpotRequestSchema,
  type HealSpotRequest,
  type HealSpotOptions,
} from "../core/retouch/heal-spot";
import { isLocked } from "../core/model";
export type { HealSpotOptions } from "../core/retouch/heal-spot";
import {
  patchRegionRequestSchema,
  type PatchRegionRequest,
  type PatchRegionOptions,
} from "../core/retouch/patch-region";
export type { PatchRegionOptions } from "../core/retouch/patch-region";
export { PatchAdjustment, TonalStroke } from "./retouch";
import { GuideCollection } from "./guides";
export { Guide, GuideCollection } from "./guides";
import { maskTransform } from "../core/masks";
import { LayerSelection } from "./layer-selection";
export { LayerSelection } from "./layer-selection";
export { AffineTransform } from "../core/affine";
import type { CropBounds } from "../core/crop";
export type { CropBounds } from "../core/crop";
import { splitPathSegment } from "../core/bezier";
import { layerOrigin, layerTransform } from "../core/spatial";
import { LayerMask } from "./masks";
export { LayerMask } from "./masks";
import { LayerMetadata } from "./metadata";
export { LayerMetadata } from "./metadata";
import {
  BlendIf,
  BrushStroke,
  MarqueeSelection,
  PaintOperation,
} from "./values";
import {
  tonalSculptSchema,
  type TonalSculptOptions,
} from "../core/retouch/tonal-sculpt";
import type { DodgeBurnMode, DodgeBurnRange } from "../core/retouch/types";
export type { TonalSculptOptions } from "../core/retouch/tonal-sculpt";
import { defaultStyle, pathSchema, styleSchema } from "../core/drawing";
import type {
  BlendIfData,
  LayerStyleData,
  PathAnchor,
  Point,
  Rect,
  VectorPathData,
  SelectionData,
} from "../core/drawing";
export type { SelectionData } from "../core/drawing";
export {
  BlendIf,
  MarqueeSelection,
  PaintOperation,
  BrushStroke,
  EraserStroke,
  PencilStroke,
  CloneStroke,
  PaintFill,
} from "./values";
export type { BrushOptions } from "./values";
import {
  KAPPA,
  createRectanglePath,
  createEllipsePath,
  createPolygonPath,
  formatSvgPathD,
  exportPathSvg,
  exportVectorLayerSvg,
  parseSvgPath,
} from "../core/shapes";
import type { ShapeOptions } from "../core/shapes";
export {
  KAPPA,
  createRectanglePath,
  createEllipsePath,
  createPolygonPath,
  formatSvgPathD,
  exportPathSvg,
  exportVectorLayerSvg,
  parseSvgPath,
};
import type { AssetStore } from "../core/assets";
import {
  detectSalientSubject,
  generateTrimapFromMask,
  maskToSelectionData,
} from "../intelligence/matting/segmentation";
import { solveAlphaMatte } from "../intelligence/matting/engine";
import type {
  SelectSubjectOptions,
  RefineEdgeOptions,
  MattingResult,
} from "../intelligence/matting/types";
import { rasterizeSelection } from "../ai/diff/engine";
import { encodeRgbaPng } from "../engine/png";
import { createCanvas, release } from "../engine/canvas";
import { paintedMask } from "../engine/drawing";
import { AffineTransform } from "../core/affine";
export * from "../intelligence/matting";
export type { ShapeOptions };
import {
  defaultCurvesAdjustment,
  defaultHslAdjustment,
  defaultLevelsAdjustment,
  defaultToneAdjustment,
} from "../core/adjustments";
import type {
  AdjustmentData,
  CurvePoint,
  LevelChannelData,
} from "../core/adjustments";
export {
  defaultCurvesAdjustment,
  defaultHslAdjustment,
  defaultLevelsAdjustment,
  defaultToneAdjustment,
};
export type { AdjustmentData, CurvePoint, LevelChannelData };
import { execute } from "../core/commands";
import type { EditorCommand, LayerPatch } from "../core/commands";
import {
  SCHEMA_VERSION,
  allLayers,
  base,
  createAdjustmentLayer,
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
  AdjustmentLayerData,
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
  assets?: AssetStore;
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
  letterSpacing?: number;
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  direction?: "ltr" | "rtl";
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
  /** Register or replace an embedded master; source edits remain detached until this call. */
  defineComponent(
    source: Document,
    options: { id?: string; name?: string } = {},
  ): string {
    if (!(source instanceof Document))
      throw new Error("A component source must be a Document.");
    const { components: _nestedDefinitions, ...data } = source.toJSON();
    const componentId = options.id ?? id();
    this._dispatch({
      type: "component.set",
      definition: {
        id: componentId,
        name: options.name ?? source.name,
        source: { kind: "document", document: data },
      },
    });
    return componentId;
  }
  getComponent(componentId: string): Document {
    const definition = new ComponentRegistry(this._read().components).get(
      componentId,
    );
    const source = definition.source;
    const data =
      source.kind === "document"
        ? structuredClone(source.document)
        : {
            ...createDocument(definition.name, source.width, source.height),
            children: [
              createRaster(
                definition.name,
                source.assetId,
                source.width,
                source.height,
              ),
            ],
          };
    const document = Document.fromJSON({
      ...data,
      schemaVersion: SCHEMA_VERSION,
      components: structuredClone(this._read().components ?? []),
    });
    document.assetStore = this.assetStore;
    return document;
  }
  removeComponent(componentId: string): void {
    this._dispatch({ type: "component.remove", id: componentId });
  }
  createSmartObject(layers: Layer[]): SmartObjectLayer {
    for (const layer of layers)
      if (
        !(layer instanceof Layer) ||
        layer.document !== this ||
        !layer.isAttached
      )
        throw new Error(
          "Conversion requires attached layers from this document.",
        );
    if (layers.length === 1 && layers[0] instanceof RasterLayer)
      return layers[0].convertToSmartObject();
    const instanceId = id();
    this._dispatch({
      type: "smartObject.convertLayers",
      ids: layers.map((layer) => layer.id),
      componentId: id(),
      instanceId,
    });
    const instance = this.getLayer(instanceId) as SmartObjectLayer;
    this.selectedLayer = instance;
    return instance;
  }
  placeSmartObject(
    componentId: string,
    options: LayerOptions & { width?: number; height?: number } = {},
  ): SmartObjectLayer {
    const source = new ComponentRegistry(this._read().components).get(
      componentId,
    ).source;
    const width =
      source.kind === "asset" ? source.width : source.document.width;
    const height =
      source.kind === "asset" ? source.height : source.document.height;
    return this.layers.add(
      new SmartObjectLayer({
        ...options,
        componentId,
        width: options.width ?? width,
        height: options.height ?? height,
      }),
    );
  }

  /** @internal Asynchronous host operation; no renderer or credentials enter isolated scripts. */
  _rasterizeSmartObject?: (layerId: string) => Promise<RasterLayer>;
  async _rasterize(layerId: string): Promise<RasterLayer> {
    if (this.batch)
      throw new Error(
        "Rasterization cannot run inside a synchronous transaction.",
      );
    if (!this._rasterizeSmartObject)
      throw new Error("Rasterization requires a configured application host.");
    return this._rasterizeSmartObject(layerId);
  }
  private store: EditorStore;
  private handles = new Map<string, Layer>();
  private staged: DocumentData | null = null;
  private batch: EditorCommand[] | null = null;
  private commandListeners = new Set<
    (command: EditorCommand, before: DocumentData, after: DocumentData) => void
  >();
  private historyListeners = new Set<(direction: "undo" | "redo") => void>();
  private _assetStore: AssetStore | null = null;
  /** @internal Host preparation only; returned data is committed through normal DOM commands. */
  _preparePatch?: (request: PatchRegionRequest) => Promise<AdjustmentLayerData>;
  /** @internal */
  _prepareHeal?: (request: HealSpotRequest) => Promise<AdjustmentLayerData>;
  readonly layerComps: LayerCompCollection;
  readonly guides: GuideCollection;
  readonly layers: LayerCollection;
  readonly layerSelection: LayerSelection;

  constructor(options: DocumentOptions = {}) {
    this.store = new EditorStore(
      createDocument(options.name, options.width, options.height),
    );
    if (options.assets) {
      this._assetStore = options.assets;
    }
    this.layerComps = new LayerCompCollection(this);
    this.guides = new GuideCollection(this);
    this.layers = new LayerCollection(this);
    this.layerSelection = new LayerSelection(this);
  }

  static fromJSON(data: unknown): Document {
    const store = new EditorStore(data, undefined, { migrateSchema: true });
    const document = new Document();
    document.store = store;
    return document;
  }
  /** @internal Workspace restoration validates retained history before exposing the session. */
  static _fromWorkspace(data: unknown, history?: unknown): Document {
    const document = Document.fromJSON(data);
    if (history !== undefined) {
      const retained = parseRetainedHistory(history, document._read());
      for (const entry of [...retained.past, ...retained.future])
        entry.document.schemaVersion = SCHEMA_VERSION;
      document.store = new EditorStore(document._read(), retained);
    }
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
  crop(bounds: CropBounds) {
    this._dispatch({ type: "document.crop", bounds });
  }
  resizeImage(width: number, height: number) {
    this._dispatch({ type: "document.resizeImage", width, height });
  }
  resize(width: number, height: number) {
    this._dispatch({ type: "document.resize", width, height });
  }
  get assetStore(): AssetStore | null {
    return this._assetStore;
  }
  set assetStore(store: AssetStore | null) {
    this._assetStore = store;
  }
  get selectedLayer() {
    return this.getLayer(this.store.getSnapshot().selectedId);
  }
  set selectedLayer(layer: Layer | null) {
    if (layer && layer.document !== this)
      throw new Error("Layer belongs to another document.");
    this.store.select(layer?.id ?? null);
  }
  get selectedLayers(): Layer[] {
    return this.store
      .getSnapshot()
      .selectedIds.map((id) => this.getLayer(id)!)
      .filter(Boolean);
  }
  selectLayers(
    layers: Layer[],
    mode: "replace" | "add" | "remove" = "replace",
  ) {
    if (!["replace", "add", "remove"].includes(mode))
      throw new Error("Unknown layer selection mode.");
    for (const layer of layers)
      if (
        !(layer instanceof Layer) ||
        layer.document !== this ||
        !layer.isAttached
      )
        throw new Error("Selected layers must belong to this document.");
    const current = this.store.getSnapshot().selectedIds;
    const ids = layers.map((layer) => layer.id);
    this.store.selectMany(
      mode === "replace"
        ? ids
        : mode === "add"
          ? [...current.filter((id) => !ids.includes(id)), ...ids]
          : current.filter((id) => !ids.includes(id)),
    );
  }
  get activeLayer(): Layer | null {
    return this.selectedLayer;
  }
  set activeLayer(layer: Layer | null) {
    this.selectedLayer = layer;
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
  async patchRegion(
    targetRegion: MarqueeSelection | SelectionData,
    sourceOffset: Point,
    options: PatchRegionOptions = {},
  ): Promise<AdjustmentLayer> {
    if (this.batch)
      throw new Error(
        "Patch preparation cannot run inside a synchronous transaction.",
      );
    if (!this._preparePatch)
      throw new Error(
        "Patch preparation requires a configured application host.",
      );
    const request = patchRegionRequestSchema.parse({
      selection:
        targetRegion instanceof MarqueeSelection
          ? targetRegion.toJSON()
          : targetRegion,
      offset: sourceOffset,
      options: {
        ...options,
        layerId: options.layerId ?? this.selectedLayer?.id,
      },
    });
    const revision = this.getSnapshot().revision;
    const layer = await this._preparePatch(request);
    if (this.getSnapshot().revision !== revision)
      throw new Error("Document changed during patch preparation.");
    return this.layers.add(new AdjustmentLayer(layer));
  }
  /** @internal Invoked by attached Layer handles. */
  async _healSpot(
    layerId: string,
    center: Point,
    radius: number,
    options: HealSpotOptions,
  ): Promise<AdjustmentLayer> {
    if (this.batch)
      throw new Error("Healing cannot run inside a synchronous transaction.");
    if (!this._prepareHeal)
      throw new Error("Healing requires a configured application host.");
    if (!this.getLayer(layerId) || isLocked(this._read(), layerId))
      throw new Error("Healing requires an attached unlocked layer.");
    const request = healSpotRequestSchema.parse({
      layerId,
      center,
      radius,
      options,
      selection:
        options.clipSelection === false
          ? null
          : (this.selection?.toJSON() ?? null),
    });
    const revision = this.getSnapshot().revision;
    const layer = await this._prepareHeal(request);
    if (this.getSnapshot().revision !== revision)
      throw new Error("Document changed during healing preparation.");
    return this.layers.add(new AdjustmentLayer(layer));
  }
  applyTonalSculpt(
    path: (Point & { pressure?: number })[],
    mode: DodgeBurnMode,
    range: DodgeBurnRange,
    exposure: number,
    options: TonalSculptOptions = {},
  ): AdjustmentLayer {
    const parsed = tonalSculptSchema.parse({
      path,
      mode,
      range,
      exposure,
      options,
    });
    const {
      name,
      clipSelection = true,
      protectTones = true,
      ...brush
    } = parsed.options!;
    const stroke = new TonalStroke({
      brush: new BrushStroke({
        ...brush,
        points: parsed.path,
        clip: clipSelection ? this.selection : null,
      }),
      mode: parsed.mode,
      range: parsed.range,
      exposure: parsed.exposure,
      protectTones,
    });
    // One validated layer.add command also composes inside a caller's transaction.
    return this.layers.add(
      new AdjustmentLayer({
        name: name ?? (mode === "dodge" ? "Dodge" : "Burn"),
        adjustment: { kind: "tonal", strokes: [stroke.toJSON()] },
      }),
    );
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
  async selectSubject(options?: SelectSubjectOptions): Promise<SelectionData> {
    const layer = this.selectedLayer;
    let targetImageData: ImageData | null = null;
    let offsetX = 0;
    let offsetY = 0;

    if (
      layer instanceof RasterLayer &&
      this._assetStore &&
      this._assetStore.has(layer.assetId)
    ) {
      const asset = this._assetStore.get(layer.assetId);
      offsetX = layer.x;
      offsetY = layer.y;
      const canvas = createCanvas(asset.width, asset.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(asset.bitmap, 0, 0);
      targetImageData = ctx.getImageData(0, 0, asset.width, asset.height);
      release(canvas);
    } else {
      const canvas = createCanvas(this.width, this.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, this.width, this.height);
      targetImageData = ctx.getImageData(0, 0, this.width, this.height);
      release(canvas);
    }

    const segmentation = detectSalientSubject(targetImageData, options);
    const selection = maskToSelectionData(
      segmentation.mask,
      targetImageData.width,
      targetImageData.height,
      {
        x: segmentation.bounds.x + offsetX,
        y: segmentation.bounds.y + offsetY,
        width: segmentation.bounds.width,
        height: segmentation.bounds.height,
      },
    );

    this.selection = new MarqueeSelection(selection);
    return selection;
  }
  async removeBackground(
    targetLayer?: RasterLayer,
    options?: RefineEdgeOptions,
  ): Promise<RasterLayer> {
    const layer = targetLayer ?? this.selectedLayer;
    if (!(layer instanceof RasterLayer)) {
      throw new Error("Select a raster layer to remove its background.");
    }
    await layer.refineEdge(options);
    return layer;
  }
  get canUndo() {
    return this.store.getSnapshot().past.length > 0;
  }
  get canRedo() {
    return this.store.getSnapshot().future.length > 0;
  }
  subscribe = (listener: () => void) => this.store.subscribe(listener);
  onCommand(
    listener: (
      command: EditorCommand,
      before: DocumentData,
      after: DocumentData,
    ) => void,
  ) {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }
  /** Host observer for completed history navigation; no-op undo/redo emits nothing. */
  onHistoryNavigation(
    listener: (direction: "undo" | "redo") => void,
  ): () => void {
    this.historyListeners.add(listener);
    return () => {
      this.historyListeners.delete(listener);
    };
  }
  getSnapshot = () => this.store.getSnapshot();
  toJSON(): DocumentData {
    return structuredClone(this._read());
  }
  undo() {
    if (this.batch) throw new Error("Finish the transaction first.");
    if (!this.canUndo) return;
    this.store.undo();
    this.historyListeners.forEach((listener) => listener("undo"));
  }
  redo() {
    if (this.batch) throw new Error("Finish the transaction first.");
    if (!this.canRedo) return;
    this.store.redo();
    this.historyListeners.forEach((listener) => listener("redo"));
  }

  getLayer(layerId: string | null): Layer | null {
    const data = findLayer(this._read(), layerId);
    if (!data) return null;
    let handle = this.handles.get(data.id);
    if (!handle) {
      // Attached handles read through the document; do not copy retained artwork
      // merely to identify a layer. Public toJSON() still returns an owned copy.
      handle = Layer._fromData(data, false);
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
      this.staged = freeze(execute(this._read(), command));
      this.batch.push(command);
    } else {
      if (this.commandListeners.size > 0) {
        const before = this.toJSON();
        this.store.dispatch(command);
        const after = this.toJSON();
        this.commandListeners.forEach((listener) =>
          listener(structuredClone(command), before, after),
        );
      } else {
        this.store.dispatch(command);
      }
    }
  }
  /** @internal */
  _register(layer: Layer) {
    this.handles.set(layer.id, layer);
  }
}

export abstract class Layer {
  async healSpot(
    center: Point,
    radius: number,
    options: HealSpotOptions = {},
  ): Promise<AdjustmentLayer> {
    const document = this.document;
    if (!document || !this.isAttached)
      throw new Error("Healing requires an attached layer.");
    return document._healSpot(this.id, center, radius, options);
  }
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
  get transform(): AffineTransform {
    const data = this._read();
    return AffineTransform.translation(data.x, data.y).multiply(
      data.transform
        ? AffineTransform.fromJSON(data.transform)
        : new AffineTransform(),
    );
  }
  set transform(value: AffineTransform) {
    value.inverse();
    const matrix = value.toJSON();
    this.update({
      x: matrix.e,
      y: matrix.f,
      transform: { ...matrix, e: 0, f: 0 },
    });
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
  get mask(): LayerMask | null {
    const value = this._read().mask;
    return value ? LayerMask._fromJSON(value) : null;
  }
  set mask(value: LayerMask | null) {
    this.update({ mask: value?.toJSON() ?? null });
  }
  /** Toggle coordinate planes while preserving the mask's current world position. */
  setMaskLinked(linked: boolean) {
    if (typeof linked !== "boolean")
      throw new Error("Mask link state must be a boolean.");
    const document = this.requireDocument();
    const mask = this.mask;
    if (!mask) throw new Error("This layer has no mask to link.");
    if (mask.linked === linked) return;
    const layerWorld = layerTransform(document._read(), this.id)!;
    const world = maskTransform(mask.toJSON(), layerWorld);
    const local = linked ? layerWorld.inverse().multiply(world) : world;
    this.mask = mask.with({
      linked,
      x: local.e,
      y: local.f,
      basis: new AffineTransform(local.a, local.b, local.c, local.d, 0, 0),
    });
  }
  /** Capture a document-space selection as a mask that moves with this layer. */
  maskFromSelection(selection: MarqueeSelection) {
    const document = this.requireDocument();
    const inverse = layerTransform(document._read(), this.id)!.inverse();
    this.mask = new LayerMask({
      selection: selection.transformed(inverse),
    });
  }
  /** Copy closed paths from an attached vector layer without altering their world position. */
  maskFromPaths(source: VectorLayer) {
    const document = this.requireDocument();
    if (source.document !== document || !source.isAttached)
      throw new Error("Mask source must belong to the same document.");
    const target = layerTransform(document._read(), this.id)!;
    const origin = layerTransform(document._read(), source.id)!;
    const mapping = target.inverse().multiply(origin);
    const paths = [...source.paths].map(
      (path) =>
        new VectorPath({
          closed: path.closed,
          points: path.points.map((p) => ({
            ...mapping.point(p),
            in: mapping.point(p.in),
            out: mapping.point(p.out),
          })),
        }),
    );
    if (!paths.length)
      throw new Error("The vector layer has no paths to copy.");
    this.mask = new LayerMask({ paths });
  }
  /** Create a bitmap mask referencing an asset in the document's AssetStore. */
  maskFromBitmap(assetId: string) {
    this.mask = LayerMask.fromBitmap(assetId);
  }
  async refineEdge(_options: RefineEdgeOptions = {}): Promise<LayerMask> {
    throw new Error("Refine edge is only supported on raster layers.");
  }
  get metadata(): LayerMetadata {
    return LayerMetadata._attached(this);
  }
  set metadata(value: LayerMetadata) {
    this.update({ metadata: value.toJSON() });
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
        false,
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
              : data.kind === "smart-object"
                ? new SmartObjectLayer({
                    name: data.name,
                    componentId: data.componentId,
                    width: data.width,
                    height: data.height,
                  })
                : data.kind === "adjustment"
                  ? new AdjustmentLayer({
                      name: data.name,
                      adjustment: data.adjustment,
                    })
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

export class SmartObjectLayer extends Layer {
  constructor(
    options: LayerOptions & {
      componentId: string;
      width: number;
      height: number;
    },
  ) {
    super({
      ...createRaster(
        options.name ?? "Smart object",
        "unused",
        options.width,
        options.height,
      ),
      ...options,
      kind: "smart-object",
    } as SmartObjectInstanceData);
    delete (this.data as unknown as Record<string, unknown>).assetId;
    delete (this.data as unknown as Record<string, unknown>).effects;
    validateDocument({ ...createDocument(), children: [this.data] }, false);
  }
  get componentId(): string {
    return (this._read() as SmartObjectInstanceData).componentId;
  }
  get width(): number {
    return (this._read() as SmartObjectInstanceData).width;
  }
  set width(value: number) {
    this.update({ width: value });
  }
  get height(): number {
    return (this._read() as SmartObjectInstanceData).height;
  }
  set height(value: number) {
    this.update({ height: value });
  }
  get filterMask(): LayerMask | null {
    const value = (this._read() as SmartObjectInstanceData).filterMask;
    return value ? LayerMask._fromJSON(value) : null;
  }
  set filterMask(value: LayerMask | null) {
    if (value !== null && !(value instanceof LayerMask))
      throw new Error("Use a LayerMask constructor.");
    const command: EditorCommand = {
      type: "smartObject.filterMask",
      id: this.id,
      mask: value?.toJSON() ?? null,
    };
    if (this.document) this.document._dispatch(command);
    else
      Object.assign(
        this.data,
        execute({ ...createDocument(), children: [this.data] }, command, false)
          .children[0],
      );
  }
  /** Switch filter-mask coordinate planes without moving its current coverage. */
  setFilterMaskLinked(linked: boolean): void {
    if (typeof linked !== "boolean")
      throw new Error("Filter-mask link state must be a boolean.");
    const document = this.requireDocument();
    const mask = this.filterMask;
    if (!mask) throw new Error("This smart object has no filter mask to link.");
    if (mask.linked === linked) return;
    const source = new ComponentRegistry(document._read().components).get(
      this.componentId,
    ).source;
    const master = source.kind === "asset" ? source : source.document;
    const nativeWorld = layerTransform(document._read(), this.id)!.multiply(
      AffineTransform.scale(
        this.width / master.width,
        this.height / master.height,
      ),
    );
    const world = maskTransform(mask.toJSON(), nativeWorld);
    const local = linked ? nativeWorld.inverse().multiply(world) : world;
    this.filterMask = mask.with({
      linked,
      x: local.e,
      y: local.f,
      basis: new AffineTransform(local.a, local.b, local.c, local.d, 0, 0),
    });
  }
  /** Detached snapshots in execution order; use setFilters to update/reorder/disable. */
  get smartFilters() {
    return structuredClone(
      (this._read() as SmartObjectInstanceData).smartFilters ?? [],
    );
  }
  setFilters(filters: readonly SmartFilter[]): void {
    const data = smartFiltersSchema.parse(
      filters.map((filter) => {
        if (!(filter instanceof SmartFilter))
          throw new Error("Use smart-filter constructors.");
        return filter.toJSON();
      }),
    );
    this.writeFilters(data);
  }
  addFilter(filter: SmartFilter): void {
    if (!(filter instanceof SmartFilter))
      throw new Error("Use a smart-filter constructor.");
    const filters = smartFiltersSchema.parse([
      ...this.smartFilters,
      filter.toJSON(),
    ]);
    this.writeFilters(filters);
  }
  private writeFilters(filters: SmartFilterData[]): void {
    const command: EditorCommand = {
      type: "smartObject.filters",
      id: this.id,
      filters,
    };
    if (this.document) this.document._dispatch(command);
    else
      Object.assign(
        this.data,
        execute({ ...createDocument(), children: [this.data] }, command, false)
          .children[0],
      );
  }
  /** Copy the complete embedded master graph; ordinary duplicate() keeps shared masters. */
  duplicateIndependent(): SmartObjectLayer {
    const document = this.requireDocument();
    const registry = new ComponentRegistry(document._read().components);
    const componentIds = Object.fromEntries(
      [...registry.reachableFrom(this.componentId)].map((key) => [key, id()]),
    );
    const instanceId = id();
    document._dispatch({
      type: "smartObject.duplicateIndependent",
      id: this.id,
      instanceId,
      componentIds,
    });
    const copy = document.getLayer(instanceId) as SmartObjectLayer;
    document.selectedLayer = copy;
    return copy;
  }
  get linkedSource(): import("../core/smart/types").LinkedImageFile | null {
    const document = this.requireDocument();
    const source = new ComponentRegistry(document._read().components).get(
      this.componentId,
    ).source;
    return source.kind === "asset" ? (source.link ?? null) : null;
  }
  embedSource(): void {
    const document = this.requireDocument();
    const definition = new ComponentRegistry(document._read().components).get(
      this.componentId,
    );
    if (definition.source.kind !== "asset" || !definition.source.link) return;
    const { link: _link, ...source } = definition.source;
    document._dispatch({
      type: "component.set",
      definition: { ...definition, source },
    });
  }
  async rasterize(): Promise<RasterLayer> {
    return this.requireDocument()._rasterize(this.id);
  }
  editContents(): Document {
    if (!this.document || !this.isAttached)
      throw new Error(
        "Editing component contents requires an attached instance.",
      );
    return this.document.getComponent(this.componentId);
  }
  replaceContents(source: Document): void {
    if (!this.document || !this.isAttached)
      throw new Error(
        "Replacing component contents requires an attached instance.",
      );
    this.document.defineComponent(source, { id: this.componentId });
  }
}

export class RasterLayer extends Layer {
  /** Non-destructive alpha erasure in layer-local coordinates. */
  erase(stroke: EraserStroke): void {
    if (!(stroke instanceof EraserStroke)) throw new Error("Use an EraserStroke value.");
    this.appendErasure(stroke);
  }
  /** Clear a local-coordinate selection, or the complete image when omitted. */
  clear(selection: MarqueeSelection | null = null): void {
    if (selection !== null && !(selection instanceof MarqueeSelection)) throw new Error("Use a MarqueeSelection value.");
    this.appendErasure(new PaintFill({ bounds: { x: 0, y: 0, width: this.width, height: this.height }, erase: true, clip: selection }));
  }
  private appendErasure(operation: PaintOperation): void {
    this.update({ erasures: [...((this._read() as RasterLayerData).erasures ?? []), { width: this.width, height: this.height, stroke: operation.toJSON() }] });
  }

  /** Convert without changing original source bytes or the layer's stack position. */
  convertToSmartObject(): SmartObjectLayer {
    const document = this.requireDocument();
    const instanceId = id();
    document._dispatch({
      type: "smartObject.convertRaster",
      id: this.id,
      componentId: id(),
      instanceId,
    });
    const instance = document.getLayer(instanceId) as SmartObjectLayer;
    document.selectedLayer = instance;
    return instance;
  }

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
  override async refineEdge(
    options: RefineEdgeOptions = {},
  ): Promise<LayerMask> {
    const document = this.requireDocument();
    const assets = document.assetStore;
    if (!assets) throw new Error("Document asset store is not available.");
    if (!assets.has(this.assetId))
      throw new Error(`Missing image asset: ${this.assetId}`);

    const asset = assets.get(this.assetId);
    const canvas = createCanvas(asset.width, asset.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(asset.bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, asset.width, asset.height);
    release(canvas);

    let matte: MattingResult;

    if (options.trimap) {
      matte = solveAlphaMatte(
        imageData,
        {
          width: asset.width,
          height: asset.height,
          data: options.trimap,
        },
        options,
      );
    } else {
      let initialMask: Uint8Array;
      if (this.mask) {
        const maskData = this.mask.toJSON();
        const origin = layerOrigin(document._read(), this.id) ?? { x: 0, y: 0 };
        const space = {
          x: 0,
          y: 0,
          width: asset.width,
          height: asset.height,
          sx: 1,
          sy: 1,
        };
        const maskCanvas = await paintedMask(
          maskData,
          space,
          origin.x,
          origin.y,
          { feather: async (data: Uint8ClampedArray) => data } as any,
          new AffineTransform(),
          asset.bitmap,
        );
        const maskCtx = maskCanvas.getContext("2d")!;
        const maskImg = maskCtx.getImageData(0, 0, asset.width, asset.height);
        release(maskCanvas);
        initialMask = new Uint8Array(asset.width * asset.height);
        for (let i = 0; i < initialMask.length; i++) {
          initialMask[i] = maskImg.data[i * 4 + 3];
        }
      } else if (document.selection) {
        const selData = document.selection
          .translated(-this.x, -this.y)
          .toJSON();
        initialMask = rasterizeSelection(selData, asset.width, asset.height);
      } else {
        const segmentation = detectSalientSubject(imageData);
        initialMask = segmentation.mask;
      }

      const trimap = generateTrimapFromMask(
        initialMask,
        asset.width,
        asset.height,
        options.radius ?? 10,
      );
      matte = solveAlphaMatte(imageData, trimap, options);
    }

    const maskRgba = new Uint8Array(asset.width * asset.height * 4);
    for (let i = 0; i < matte.alpha.length; i++) {
      maskRgba[i * 4] = 255;
      maskRgba[i * 4 + 1] = 255;
      maskRgba[i * 4 + 2] = 255;
      maskRgba[i * 4 + 3] = matte.alpha[i];
    }
    const blob = await encodeRgbaPng(maskRgba, asset.width, asset.height);
    const maskAssetId = id();
    await assets.add(
      blob,
      `${this.name} - Alpha Matte Mask`,
      maskAssetId,
      false,
    );
    const mask = LayerMask.fromBitmap(maskAssetId);

    document._dispatch({
      type: "mask.setFromMatting",
      id: this.id,
      mask: mask.toJSON(),
    });
    return mask;
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
      validateDocument({ ...createDocument(), children: prospective }, false);
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
    else {
      // The detached layer shell remains mutable (including inside a detached
      // group). Copy caller-owned fields before freezing; retain only values
      // already proven recursively immutable by our own registry.
      const owned = Object.fromEntries(Object.entries(this.data).map(([key, value]) =>
        [key, isImmutable(value) ? value : structuredClone(value)],
      )) as unknown as LayerData;
      const snapshot = freeze({ ...createDocument(), children: [owned] });
      const next = execute(snapshot, command).children[0];
      Object.assign(this.data, freeze(next));
    }
  }
  toSvg(docWidth = 1920, docHeight = 1080): string {
    return exportVectorLayerSvg(
      this._read() as VectorLayerData,
      docWidth,
      docHeight,
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
  splitSegment(index: number, t = 0.5): number {
    this.update({
      points: splitPathSegment(this.points, this.closed, index, t),
    });
    return index + 1;
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
  toSvgPath(): string {
    return formatSvgPathD(this.read());
  }
  static rectangle(
    rect: Rect,
    cornerRadius = 0,
    options: ShapeOptions = {},
  ): VectorPath {
    return VectorPath._fromData(
      createRectanglePath(rect, cornerRadius, options),
    );
  }
  static ellipse(rect: Rect, options: ShapeOptions = {}): VectorPath {
    return VectorPath._fromData(createEllipsePath(rect, options));
  }
  static polygon(
    center: Point,
    radius: number,
    sides: number,
    options: ShapeOptions = {},
  ): VectorPath {
    return VectorPath._fromData(
      createPolygonPath(center, radius, sides, options),
    );
  }
  static fromSvgPath(d: string, options: ShapeOptions = {}): VectorPath {
    const anchors = parseSvgPath(d);
    return new VectorPath({
      points: anchors,
      closed: /z\s*$/i.test(d.trim()),
      fill: options.fill,
      stroke: options.stroke,
      strokeWidth: options.strokeWidth,
    });
  }
  /** @internal Owner-backed handles read validated data through their collection. */
  static _fromData(data: VectorPathData, owner?: VectorLayer) {
    // Initialize the normal instance without reparsing all owned anchors.
    // Shape factories without an owner retain their defensive construction path.
    const result = new VectorPath(owner ? { points: [{ x: 0, y: 0 }] } : data);
    // Owner-backed getters resolve the current record by ID; retaining the old
    // anchor graph here would unnecessarily pin it after history releases it.
    if (owner) result.data.id = data.id;
    else result.data = structuredClone(data);
    result._owner = owner ?? null;
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
      const path = VectorPath._fromData(data, this.owner);
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
      letterSpacing,
      fontWeight,
      fontStyle,
      direction,
      ...baseOpts
    } = options;
    super({
      ...createText(options.name ?? "Text", text, {
        fontSize,
        fontFamily,
        color,
        align,
        lineHeight,
        letterSpacing,
        fontWeight,
        fontStyle,
        direction,
      }),
      ...baseOpts,
    });
    validateDocument({ ...createDocument(), children: [this.data] });
  }

  /** Recalculate bounds with fonts available to this execution environment. */
  reflow(): void {
    this.update({ text: this.text });
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

  get letterSpacing(): number | undefined {
    return (this._read() as TextLayerData).letterSpacing;
  }
  set letterSpacing(value: number | undefined) {
    this.update({ letterSpacing: value });
  }

  get fontWeight(): string | undefined {
    return (this._read() as TextLayerData).fontWeight;
  }
  set fontWeight(value: string | undefined) {
    this.update({ fontWeight: value });
  }

  get fontStyle(): "normal" | "italic" | undefined {
    return (this._read() as TextLayerData).fontStyle;
  }
  set fontStyle(value: "normal" | "italic" | undefined) {
    this.update({ fontStyle: value });
  }

  get direction(): "ltr" | "rtl" | undefined {
    return (this._read() as TextLayerData).direction;
  }
  set direction(value: "ltr" | "rtl" | undefined) {
    this.update({ direction: value });
  }

  get width(): number {
    return (this._read() as TextLayerData).width;
  }

  get height(): number {
    return (this._read() as TextLayerData).height;
  }
}

export interface AdjustmentLayerOptions extends LayerOptions {
  adjustment?: AdjustmentData | PatchAdjustment;
}

export class AdjustmentLayer extends Layer {
  constructor(options: AdjustmentLayerOptions = {}) {
    const { adjustment = defaultCurvesAdjustment(), ...base } = options;
    super({
      ...createAdjustmentLayer(
        options.name ?? "Adjustment",
        adjustment instanceof PatchAdjustment
          ? adjustment.toJSON()
          : adjustment,
      ),
      ...base,
    });
    validateDocument({ ...createDocument(), children: [this.data] });
  }

  get adjustment(): AdjustmentData {
    return structuredClone((this._read() as AdjustmentLayerData).adjustment);
  }

  set adjustment(value: AdjustmentData) {
    this.update({ adjustment: value });
  }

  get adjustmentKind(): AdjustmentData["kind"] {
    return (this._read() as AdjustmentLayerData).adjustment.kind;
  }

  setPatch(patch: PatchAdjustment): void {
    if (!(patch instanceof PatchAdjustment))
      throw new Error("Expected a PatchAdjustment.");
    this.adjustment = patch.toJSON();
  }

  addTonalStroke(stroke: TonalStroke): void {
    if (!(stroke instanceof TonalStroke))
      throw new Error("Expected a TonalStroke.");
    const adjustment = this.adjustment;
    if (adjustment.kind !== "tonal")
      throw new Error("Tonal strokes require a tonal adjustment layer.");
    this.adjustment = {
      kind: "tonal",
      strokes: [...adjustment.strokes, stroke.toJSON()],
    };
  }

  setCurves(
    rgbOrData:
      | CurvePoint[]
      | {
          rgb: CurvePoint[];
          red?: CurvePoint[];
          green?: CurvePoint[];
          blue?: CurvePoint[];
        },
    channels?: {
      red?: CurvePoint[];
      green?: CurvePoint[];
      blue?: CurvePoint[];
    },
  ) {
    if (Array.isArray(rgbOrData)) {
      this.update({
        adjustment: {
          kind: "curves",
          rgb: rgbOrData,
          red: channels?.red,
          green: channels?.green,
          blue: channels?.blue,
        },
      });
    } else {
      this.update({
        adjustment: {
          kind: "curves",
          rgb: rgbOrData.rgb,
          red: rgbOrData.red,
          green: rgbOrData.green,
          blue: rgbOrData.blue,
        },
      });
    }
  }

  setLevels(
    rgbOrData:
      | LevelChannelData
      | {
          rgb: LevelChannelData;
          red?: LevelChannelData;
          green?: LevelChannelData;
          blue?: LevelChannelData;
        },
    channels?: {
      red?: LevelChannelData;
      green?: LevelChannelData;
      blue?: LevelChannelData;
    },
  ) {
    if ("rgb" in rgbOrData) {
      this.update({
        adjustment: {
          kind: "levels",
          rgb: rgbOrData.rgb,
          red: rgbOrData.red,
          green: rgbOrData.green,
          blue: rgbOrData.blue,
        },
      });
    } else {
      this.update({
        adjustment: {
          kind: "levels",
          rgb: rgbOrData,
          red: channels?.red,
          green: channels?.green,
          blue: channels?.blue,
        },
      });
    }
  }

  setTone(values: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
  }) {
    const current =
      (this._read() as AdjustmentLayerData).adjustment.kind === "tone"
        ? ((this._read() as AdjustmentLayerData).adjustment as Extract<
            AdjustmentData,
            { kind: "tone" }
          >)
        : defaultToneAdjustment();
    this.update({
      adjustment: {
        kind: "tone",
        exposure: values.exposure ?? current.exposure,
        contrast: values.contrast ?? current.contrast,
        saturation: values.saturation ?? current.saturation,
      },
    });
  }
}
