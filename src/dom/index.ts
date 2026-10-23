import { createFrequencySeparation } from "./frequency-separation";
import {RawDevelopment,type RawDevelopmentControl} from './raw';
import type {RawDevelopSettings,RawImportReport} from '../core/interchange/raw/types';
export {RawDevelopment,LensCorrection} from './raw';
export type {RawDevelopmentControl,RawDevelopmentOptions} from './raw';
export type {LensCorrectionOptions,LensCorrectionData} from '../core/interchange/raw/lens';
import { frequencyRadiusOwner } from "../core/frequency-separation";
import type { FrequencySeparationOptions } from "../core/frequency-separation";
export type { FrequencySeparationOptions } from "../core/frequency-separation";
import { captureVectorBoolean, vectorBooleanOperationSchema, vectorBooleanResultSchema, type VectorBooleanOperation, type VectorBooleanSelection, type VectorBooleanResult, type VectorBooleanControl } from '../core/vector-boolean';
export type { VectorBooleanOperation, VectorBooleanProgress, VectorBooleanControl } from '../core/vector-boolean';
import {vectorFillData,type VectorFillOptions,type VectorGradientData} from '../core/vector-gradient';
export type {VectorGradientData,VectorGradientStop,VectorFillOptions} from '../core/vector-gradient';
import {vectorStrokeData,vectorStrokeValues,type VectorStrokeOptions} from '../core/vector-stroke';
export type {VectorStrokeOptions} from '../core/vector-stroke';
import { parseCubeLut, lutOptionsSchema, type LutInterpolation } from "../core/lut";
import {inspectDesign,preflightOptionsSchema,preflightReportSchema,type PreflightOptions,type PreflightSettings,type PreflightReport,type PreflightControl} from '../core/preflight';
export type {PreflightOptions,PreflightReport,PreflightFinding,PreflightControl} from '../core/preflight';
import { selectSubjectOptionsSchema, type SelectSubjectSettings, type SelectSubjectControl } from '../core/subject-selection';
import {refineEdgeOptionsSchema,mattingPlanSchema,type MattingRequest,type PreparedMatting,type RefineEdgeControl} from '../core/matting';
import {parentId} from '../core/spatial';
import { colorRangeOptionsSchema, type ColorRangeOptions, type ColorRangeSettings, type ColorRangeControl } from "../core/color-range";
import { quickSelectionOptionsSchema, type QuickSelectionOptions, type QuickSelectionSettings, type QuickSelectionControl } from '../core/quick-selection';
export type { QuickSelectionOptions, QuickSelectionControl } from '../core/quick-selection';
export type { ColorRangeOptions, ColorRangeSettings, ColorRangeControl } from "../core/color-range";
export { defaultLutAdjustment, parseCubeLut, serializeCubeLut } from "../core/lut";
export type { LutAdjustmentData, CubeLutData, LutInterpolation } from "../core/lut";
export { defaultWhiteBalanceAdjustment } from "../core/white-balance";
export type { WhiteBalanceAdjustmentData } from "../core/white-balance";
export { defaultGradientMapAdjustment } from "../core/gradient-map";
export type { GradientMapAdjustmentData, GradientStop } from "../core/gradient-map";
import { freeze, isImmutable } from "../core/immutable";
import { yieldTask } from "../core/task-yield";
import { selectionModificationSchema, type SelectionModificationOptions, type SelectionModificationControl } from "../core/selection-modification";
import { selectionSchema } from "../core/drawing";
export type { SelectionModificationOptions, SelectionModificationControl } from "../core/selection-modification";
import { EraserStroke, PaintFill } from "./values";
import { LayerCompCollection } from "./layer-comps";
import {ParagraphStyle,ParagraphStyleCollection} from './paragraph-styles';
import {z} from 'zod';
import {paragraphFormat,type ParagraphFormat} from '../core/paragraph-styles';
export {ParagraphStyle,ParagraphStyleCollection} from './paragraph-styles';
export type {ParagraphFormat} from '../core/paragraph-styles';
import { AlphaChannelCollection } from './alpha-channels';
import { channelLoadSchema, channelLoadOptionsSchema, type ChannelLoadSettings, type ChannelLoadOptions, type ChannelLoadControl } from '../core/alpha-channels';
export { AlphaChannel, AlphaChannelCollection } from './alpha-channels';
export type { ChannelLoadOptions, ChannelLoadControl } from '../core/alpha-channels';
export { LayerComp, LayerCompCollection } from "./layer-comps";
import { parseRetainedHistory } from "../core/history";
import { SmartFilter } from "./smart-filters";
export {
  SmartFilter,
  GaussianBlurFilter,
  MedianFilter,
  BilateralDenoiseFilter,
  FrequencyBandFilter,
  NativeCompositionFilter,
  DocumentToneFilter,
  UnsharpMaskFilter,
  SmartToneFilter,
} from "./smart-filters";
import {
  smartFiltersSchema,
  type SmartFilterData,
} from "../core/smart/filters";
import { ComponentRegistry } from "../core/smart/manager";
import type { SmartObjectInstanceData } from "../core/smart/types";
import { RedEyeAdjustment } from "./red-eye";
export { RedEyeAdjustment } from "./red-eye";
export { defaultRedEyeAdjustment } from "../core/red-eye";
export type { RedEyeAdjustmentData } from "../core/red-eye";
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
import { layerTransform } from "../core/spatial";
import { LayerMask } from "./masks";
export { LayerMask } from "./masks";
export type { RasterErasureMaskSource } from "./masks";
import { LayerMetadata } from "./metadata";
export { LayerMetadata } from "./metadata";
import {
  BlendIf,
  PressureCurve,
  BrushTip,
  BrushSymmetry,
  BrushTexture,
  BrushStroke,
  WetPaintStroke,
  MarqueeSelection,
  PaintOperation,
} from "./values";
import {
  tonalSculptSchema,
  type TonalSculptOptions as TonalSculptDataOptions,
} from "../core/retouch/tonal-sculpt";
import type { DodgeBurnMode, DodgeBurnRange } from "../core/retouch/types";
import type {PressureCurveData} from '../core/pressure-curve';
import type {BrushSymmetryData} from '../core/brush-symmetry';
import type {BrushTextureData} from '../core/brush-texture';
import type {BrushTipData,PenTiltData} from '../core/brush-tip';
export type TonalSculptOptions=Omit<TonalSculptDataOptions,'pressureCurve'|'tip'|'symmetry'|'texture'>&{pressureCurve?:PressureCurve|PressureCurveData|null;tip?:BrushTip|BrushTipData|null;symmetry?:BrushSymmetry|BrushSymmetryData|null;texture?:BrushTexture|BrushTextureData|null};
import { defaultStyle, pathSchema, styleSchema, vectorContourSchema, pathContours } from "../core/drawing";
import type { VectorContourData } from "../core/drawing";
import type {
  BlendIfData,
  LayerStyleData,
  PathAnchor,
  Point,
  SelectionOperation,
  Rect,
  VectorPathData,
  SelectionData,
} from "../core/drawing";
export type { SelectionData } from "../core/drawing";
export {
  BlendIf,
  PressureCurve,
  BrushTip,
  BrushSymmetry,
  BrushTexture,
  MarqueeSelection,
  PaintOperation,
  BrushStroke,
  WetPaintStroke,
  EraserStroke,
  PencilStroke,
  CloneStroke,
  PaintFill,
} from "./values";
export type { BrushOptions,BrushTipOptions,WetPaintStrokeOptions } from "./values";
export type { WetPaintStrokeData, WetPaintTileData } from '../core/wet-operation';
export type {PressureCurveData,PressureKnot} from '../core/pressure-curve';
export type {BrushSymmetryData} from '../core/brush-symmetry';
export type {BrushTextureData,BrushTextureSource} from '../core/brush-texture';
export type {BrushTipData,PenTiltData} from '../core/brush-tip';
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
import type {SelectSubjectOptions,RefineEdgeOptions} from "../intelligence/matting/types";
import { AffineTransform } from "../core/affine";
export * from "../intelligence/matting";
export type { ShapeOptions };
import {
  defaultCurvesAdjustment,
  defaultHslAdjustment,
  defaultColorBalanceAdjustment,
  defaultVibranceAdjustment,
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
  defaultColorBalanceAdjustment,
  defaultVibranceAdjustment,
  defaultLevelsAdjustment,
  defaultToneAdjustment,
};
export type { AdjustmentData, CurvePoint, LevelChannelData };
export type { ColorBalanceAdjustmentData, VibranceAdjustmentData, BalanceChannels, ChromaticAdjustmentData } from "../core/adjustments";
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
  LayerBlendMode,
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
  paragraphJustify?: 'none' | 'inter-word';
  wrapWidth?: number | null;
  paragraphSpacing?: number;
  firstLineIndent?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  fontKerning?: 'auto' | 'normal' | 'none';
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
  createFrequencySeparation(source: RasterLayer, snapshot: RasterLayer, options: FrequencySeparationOptions = {}): LayerGroup {
    return createFrequencySeparation(this, source, snapshot, options);
  }

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
  /** @internal Native file development requires a configured application host. */
  _prepareRawDevelopment?:(layerId:string,settings:RawDevelopSettings,control:RawDevelopmentControl)=>Promise<Readonly<RawImportReport>>;
  /** @internal Metadata-only bridge for isolated callers; never transfers source bytes. */
  _readRawDevelopment?:(layerId:string)=>Promise<RawDevelopSettings|null>;
  async _developRaw(layerId:string,settings:RawDevelopSettings,control:RawDevelopmentControl):Promise<Readonly<RawImportReport>>{
    if(this.batch)throw new Error('RAW development cannot run inside a synchronous transaction.');
    if(!this._prepareRawDevelopment)throw new Error('RAW development requires a configured application host.');
    return this._prepareRawDevelopment(layerId,settings,control);
  }
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
  /** @internal Read-only host inspection; no result can mutate document/history. */
  _preflight?: (options:PreflightSettings,control:PreflightControl)=>Promise<PreflightReport>;
  async preflight(options:PreflightOptions={},control:PreflightControl={}):Promise<PreflightReport>{
    if(this.batch)throw new Error('Run design checks outside synchronous transactions.');
    const settings=preflightOptionsSchema.parse(options),snapshot=this.getSnapshot();control.signal?.throwIfAborted();
    const report=preflightReportSchema.parse(await(this._preflight?this._preflight(settings,control):inspectDesign(snapshot.document,snapshot.revision,settings,{signal:control.signal,assets:this._assetStore?new Map(this._assetStore.values().map(asset=>[asset.id,{width:asset.width,height:asset.height}])):undefined})));
    control.signal?.throwIfAborted();
    if(this.getSnapshot().revision!==snapshot.revision)throw new Error('The document changed during design checks.');
    if(report.documentId!==this.id||report.revision!==snapshot.revision||JSON.stringify(report.options)!==JSON.stringify(settings))throw new Error('Design-check results do not match the inspected document and policy.');
    return report;
  }
  /** @internal Host preparation only; returned data is committed through normal DOM commands. */
  _preparePatch?: (request: PatchRegionRequest) => Promise<AdjustmentLayerData>;
  /** @internal Hosts prepare coverage off the UI thread; this class validates the commit. */
  _prepareSelectionModification?: (options: SelectionModificationOptions, control: SelectionModificationControl) => Promise<SelectionData>;
  /** @internal Private worker preparation; final geometry uses shared path replacement. */
  _prepareVectorBoolean?: (selection:VectorBooleanSelection,control:VectorBooleanControl)=>Promise<VectorBooleanResult>;
  async combinePaths(operation:VectorBooleanOperation,paths:VectorPath[],control:VectorBooleanControl={}):Promise<VectorPath|null>{
    if(this.batch)throw new Error('Boolean operations cannot run inside a synchronous transaction.');
    vectorBooleanOperationSchema.parse(operation);
    if(!this._prepareVectorBoolean)throw new Error('Boolean operations require a configured application host.');
    control.signal?.throwIfAborted();
    const operands=paths.map(path=>{
      const layer=path._owner;if(!layer||layer.document!==this||!layer.isAttached)throw new Error('Boolean operands must belong to this document.');
      return {layerId:layer.id,pathId:path.id};
    });
    const snapshot=this.getSnapshot(),captured=captureVectorBoolean(snapshot.document,{operation,operands});
    control.signal?.throwIfAborted();
    const prepared=vectorBooleanResultSchema.parse(await this._prepareVectorBoolean(captured.selection,control));
    if(control.signal)await yieldTask();control.signal?.throwIfAborted();
    if(this.getSnapshot().revision!==snapshot.revision)throw new Error('The document changed during the Boolean operation.');
    const [points,...extras]=prepared.contours;
    const result=points?pathSchema.parse({...captured.first.path,points,closed:true,fillRule:prepared.fillRule,subpaths:extras.map(points=>({id:id(),points,closed:true}))}):null;
    this._dispatch({type:'transaction',label:`${operation[0].toUpperCase()+operation.slice(1)} vector paths`,commands:[{type:'paths.replace',operands,result}]});
    const layer=this.getLayer(operands[0].layerId);
    if(layer&&(this.selectedLayer?.id!==layer.id||this.selectedLayers.length!==1))this.selectedLayer=layer;
    return result&&layer instanceof VectorLayer?layer.paths.get(result.id):null;
  }
  /** @internal Native color sampling belongs to the application host. */
  _prepareColorRange?: (options:ColorRangeSettings,control:ColorRangeControl)=>Promise<SelectionData>;
  /** @internal Private native sampling and region growing belong to the host. */
  _prepareQuickSelection?: (options:QuickSelectionSettings,control:QuickSelectionControl)=>Promise<SelectionData>;
  /** @internal Original-pixel subject sampling belongs to the configured host. */
  _prepareSubject?: (options:SelectSubjectSettings,control:SelectSubjectControl)=>Promise<SelectionData>;
  /** @internal Hosts stage native matte assets; mutations remain shared commands. */
  _prepareMatting?: (request:MattingRequest,control:RefineEdgeControl)=>Promise<PreparedMatting>;
  /** @internal */
  _prepareHeal?: (request: HealSpotRequest) => Promise<AdjustmentLayerData>;
  readonly layerComps: LayerCompCollection;
  readonly paragraphStyles:ParagraphStyleCollection;
  readonly alphaChannels: AlphaChannelCollection;
  /** @internal Hosts rasterize saved coverage without exposing source pixels. */
  _prepareChannelLoad?: (settings:ChannelLoadSettings,control:ChannelLoadControl)=>Promise<SelectionData>;
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
    this.paragraphStyles=new ParagraphStyleCollection(this);
    this.alphaChannels = new AlphaChannelCollection(this);
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

  /** @internal AlphaChannel.load owns the public instance API. */
  async _loadAlphaChannel(id:string,options:ChannelLoadOptions={},control:ChannelLoadControl={}):Promise<void>{
    const settings=channelLoadSchema.parse({...channelLoadOptionsSchema.parse(options),id});
    if(this.batch)throw new Error('Load an alpha channel outside synchronous transactions.');
    if(!this.alphaChannels.getById(id))throw new Error('Alpha channel not found.');
    if(!this._prepareChannelLoad)throw new Error('Loading alpha channels requires a configured application host.');
    const revision=this.getSnapshot().revision;control.signal?.throwIfAborted();
    const selection=selectionSchema.parse(await this._prepareChannelLoad(settings,control));
    if(control.signal)await yieldTask();control.signal?.throwIfAborted();
    if(this.getSnapshot().revision!==revision)throw new Error('The document changed while loading its alpha channel.');
    this.transaction('Load alpha channel',()=>{this.selection=new MarqueeSelection(selection);});
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
  selectPolygon(points: Point[], operation: "replace" | SelectionOperation = "replace"): void {
    this._dispatch({ type: "selection.polygon", points, operation });
  }
  async modifySelection(options: SelectionModificationOptions, control: SelectionModificationControl = {}): Promise<void> {
    const settings = selectionModificationSchema.parse(options);
    if (this.batch) throw new Error("Selection modification cannot run inside a synchronous transaction.");
    if (!this._read().selection) throw new Error("Create a pixel selection first.");
    if (!this._prepareSelectionModification) throw new Error("Selection modification requires a configured application host.");
    const revision = this.getSnapshot().revision;
    control.signal?.throwIfAborted();
    const selection = selectionSchema.parse(await this._prepareSelectionModification(settings, control));
    if (control.signal) await yieldTask();
    control.signal?.throwIfAborted();
    if (this.getSnapshot().revision !== revision) throw new Error("The document changed while modifying its selection. Try again.");
    this.transaction(`${settings.operation[0].toUpperCase()+settings.operation.slice(1)} selection`, () => {
      this.selection = new MarqueeSelection(selection);
    });
  }
  async selectQuickSelection(options:QuickSelectionOptions,control:QuickSelectionControl={}):Promise<void>{
    const settings=quickSelectionOptionsSchema.parse(options);
    if(this.batch)throw new Error('Quick Selection cannot run inside a synchronous transaction.');
    if(!this._prepareQuickSelection)throw new Error('Quick Selection requires a configured application host.');
    const revision=this.getSnapshot().revision;control.signal?.throwIfAborted();
    const prepared=selectionSchema.parse(await this._prepareQuickSelection(settings,control));
    if(control.signal)await yieldTask();control.signal?.throwIfAborted();
    if(this.getSnapshot().revision!==revision)throw new Error('The document changed during Quick Selection.');
    const next=new MarqueeSelection(prepared);
    this.transaction('Quick selection',()=>{
      this.selection=settings.operation==='replace'||(!prepared.regions.length&&settings.operation==='intersect')?next:
        !prepared.regions.length?(this.selection??new MarqueeSelection()):(this.selection??new MarqueeSelection()).combine(next,settings.operation);
    });
  }
  async selectColorRange(options:ColorRangeOptions,control:ColorRangeControl={}):Promise<void> {
    const settings=colorRangeOptionsSchema.parse(options);
    if(this.batch)throw new Error('Color Range cannot run inside a synchronous transaction.');
    if(!this._prepareColorRange)throw new Error('Color Range requires a configured application host.');
    const revision=this.getSnapshot().revision;control.signal?.throwIfAborted();
    const prepared=selectionSchema.parse(await this._prepareColorRange(settings,control));
    if(control.signal)await yieldTask();control.signal?.throwIfAborted();
    if(this.getSnapshot().revision!==revision)throw new Error('The document changed while selecting a color range. Try again.');
    const next=new MarqueeSelection(prepared);
    this.transaction('Select color range',()=>{
      this.selection=settings.operation==='replace'||(!prepared.regions.length&&settings.operation==='intersect')?next:
        !prepared.regions.length?(this.selection??new MarqueeSelection()):(this.selection??new MarqueeSelection()).combine(next,settings.operation);
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
    path: (Point & { pressure?: number;tilt?:PenTiltData })[],
    mode: DodgeBurnMode,
    range: DodgeBurnRange,
    exposure: number,
    options: TonalSculptOptions = {},
  ): AdjustmentLayer {
    const curve=options.pressureCurve;
    const normalized={...options,
      ...(options.symmetry===undefined?{}:{symmetry:options.symmetry instanceof BrushSymmetry?options.symmetry.toJSON():options.symmetry??undefined}),
      ...(options.texture===undefined?{}:{texture:options.texture instanceof BrushTexture?options.texture.toJSON():options.texture??undefined}),
      ...(curve===undefined?{}:{pressureCurve:curve instanceof PressureCurve?curve.toJSON():curve??undefined}),
      ...(options.tip===undefined?{}:{tip:options.tip instanceof BrushTip?options.tip.toJSON():options.tip??undefined})};
    const parsed = tonalSculptSchema.parse({
      path,
      mode,
      range,
      exposure,
      options:normalized,
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
  async selectSubject(options:SelectSubjectOptions={},control:SelectSubjectControl={}):Promise<SelectionData>{
    const settings=selectSubjectOptionsSchema.parse(options);
    settings.targetLayerId ??= this.selectedLayer?.id;
    if(!settings.targetLayerId)throw new Error('Select a raster layer for Select Subject.');
    if(this.batch)throw new Error('Select Subject cannot run inside a synchronous transaction.');
    if(!this._prepareSubject)throw new Error('Select Subject requires a configured application host.');
    const revision=this.getSnapshot().revision;control.signal?.throwIfAborted();
    const selection=selectionSchema.parse(await this._prepareSubject(settings,control));
    if(control.signal)await yieldTask();control.signal?.throwIfAborted();
    if(this.getSnapshot().revision!==revision)throw new Error('The document changed during Select Subject.');
    if(!selection.regions.length)throw new Error('No foreground found. Try Quick Selection or adjust the threshold.');
    this.transaction('Select subject',()=>{this.selection=new MarqueeSelection(selection);});
    return structuredClone(selection);
  }
  async removeBackground(
    targetLayer?: RasterLayer,
    options?: RefineEdgeOptions,
    control?:RefineEdgeControl,
  ): Promise<RasterLayer> {
    const layer = targetLayer ?? this.selectedLayer;
    if (!(layer instanceof RasterLayer)) {
      throw new Error("Select a raster layer to remove its background.");
    }
    if(layer.document!==this)throw new Error('The raster belongs to another document.');
    return (await this._refineRaster(layer.id,options,control)).layer;
  }
  /** @internal Shared OO entry point for native matte preparation and one asset/history commit. */
  async _refineRaster(layerId:string,options:RefineEdgeOptions={},control:RefineEdgeControl={}):Promise<{layer:RasterLayer;mask:LayerMask}>{
    const settings=refineEdgeOptionsSchema.parse(options),source=findLayer(this._read(),layerId);
    if(this.batch)throw new Error('Refine Edge cannot run inside a synchronous transaction.');
    if(source?.kind!=='raster'||isLocked(this._read(),layerId))throw new Error('Refine Edge requires an attached unlocked raster layer.');
    if(!this._prepareMatting)throw new Error('Refine Edge requires a configured application host.');
    const revision=this.getSnapshot().revision;control.signal?.throwIfAborted();
    const prepared=await this._prepareMatting({layerId,options:settings},control);
    try{
      const plan=mattingPlanSchema.parse(prepared.plan),layer=plan.layer as RasterLayerData|undefined;
      if(control.signal)await yieldTask();control.signal?.throwIfAborted();
      if(this.getSnapshot().revision!==revision)throw new Error('The document changed during matting.');
      if(plan.sourceId!==layerId||plan.mask.kind!=='bitmap'||!!layer!==(settings.outputTo==='new-layer'))throw new Error('Invalid prepared matting target or output.');
      const commands:EditorCommand[]=layer?[
        {type:'layer.add',layer,parentId:parentId(this._read(),layerId)??undefined},
        {type:'layer.place',id:layer.id,targetId:layerId,placement:'after',preservePosition:false},
        {type:'layer.update',id:layerId,patch:{visible:false}},
      ]:[{type:'mask.setFromMatting',id:layerId,mask:plan.mask}];
      if(layer&&(layer.kind!=='raster'||layer.id===layerId||JSON.stringify(layer.mask)!==JSON.stringify(plan.mask)))throw new Error('Invalid corrected foreground output.');
      const command:EditorCommand={type:'transaction',label:layer?'Refine edge to new layer':'Refine edge mask',commands};
      execute(this._read(),command); // Validate before any host transfers staged assets.
      const apply=()=>this._dispatch(command);if(prepared.commit)prepared.commit(apply);else apply();
      const target=this.getLayer(layer?.id??layerId) as RasterLayer;if(layer)this.selectedLayer=target;
      return{layer:target,mask:target.mask!};
    }finally{prepared.dispose?.();}
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
  /** Group controlling frequency filters in this document plane, including this group itself. */
  get frequencyGroup(): LayerGroup | null {
    const document=this.document;
    if(!document || !this.isAttached)return null;
    const owner=frequencyRadiusOwner(document._read(),this.id);
    return owner ? document.getLayer(owner.id) as LayerGroup : null;
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
    const sources = [...source.paths];
    const explicitRules = sources.some(path => path.subpaths.length || path._pathRecord().fillRule !== undefined);
    const rules = new Set(sources.map(path => explicitRules ? path.fillRule : "evenodd"));
    if (rules.size > 1) throw new Error("Mask source paths must use the same fill rule.");
    const paths = [...source.paths].flatMap(path => pathContours(path.toJSON()).map(
      (contour) =>
        new VectorPath({
          closed: contour.closed,
          points: contour.points.map((p) => ({
            ...mapping.point(p),
            in: mapping.point(p.in),
            out: mapping.point(p.out),
          })),
        }),
    ));
    if (!paths.length)
      throw new Error("The vector layer has no paths to copy.");
    this.mask = new LayerMask({ paths, fillRule: [...rules][0] ?? "nonzero" });
  }
  /** Create a bitmap mask referencing an asset in the document's AssetStore. */
  maskFromBitmap(assetId: string) {
    this.mask = LayerMask.fromBitmap(assetId);
  }
  async refineEdge(_options: RefineEdgeOptions = {}, _control:RefineEdgeControl={}): Promise<LayerMask> {
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
  set blendMode(value: LayerBlendMode) {
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
        for (const path of node.paths) {
          newIds[path.id] = id();
          for (const contour of path.subpaths ?? []) newIds[contour.id] = id();
        }
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
  /** Accepted settings for this shared master; null for ordinary smart objects. */
  get rawDevelopment():RawDevelopment|null{
    const document=this.requireDocument(),source=new ComponentRegistry(document._read().components).get(this.componentId).source;
    if(document._readRawDevelopment&&!document.assetStore)throw new Error('Use await layer.getRawDevelopment() in isolated scripts.');
    const store=document.assetStore,raw=source.kind==='asset'&&store?.has(source.assetId)?store.get(source.assetId).raw:undefined;
    return raw?new RawDevelopment(raw.settings.development):null;
  }
  async getRawDevelopment():Promise<RawDevelopment|null>{
    const document=this.requireDocument();if(!document._readRawDevelopment)return this.rawDevelopment;
    const revision=document.getSnapshot().revision,settings=await document._readRawDevelopment(this.id);
    if(document.getSnapshot().revision!==revision)throw new Error('The document changed while reading RAW development settings.');
    return settings?new RawDevelopment(settings):null;
  }
  async developRaw(value:RawDevelopment,control:RawDevelopmentControl={}):Promise<Readonly<RawImportReport>>{
    if(!(value instanceof RawDevelopment))throw new Error('Use a RawDevelopment constructor.');
    return this.requireDocument()._developRaw(this.id,value.toJSON(),control);
  }
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
  /** Apply a prepared native replacement in the same order as erase/clear. */
  applyWetPaint(stroke: WetPaintStroke): void {
    if (!(stroke instanceof WetPaintStroke)) throw new Error('Use a WetPaintStroke value.');
    this.appendErasure(stroke);
  }
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
  override async refineEdge(options:RefineEdgeOptions={},control:RefineEdgeControl={}):Promise<LayerMask>{
    return(await this.requireDocument()._refineRaster(this.id,options,control)).mask;
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
  constructor(options: Omit<LayerOptions, 'blendMode'> & {blendMode?:LayerBlendMode;frequencyRadius?:number|null} = {}) {
    super({ ...createGroup(options.name), ...options });
    validateDocument({ ...createDocument(), children: [this.data] });
    this.layers = new LayerCollection(this);
  }
  get frequencyRadius(): number | null {
    return (this._read() as GroupLayerData).frequencyRadius ?? null;
  }
  set frequencyRadius(value: number | null) {
    this.update({frequencyRadius:value});
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
  async combinePaths(operation:VectorBooleanOperation,paths:VectorPath[]=[...this.paths],control:VectorBooleanControl={}):Promise<VectorPath|null>{
    if(paths.some(path=>path._owner!==this))throw new Error('Use Document.combinePaths for paths from different layers.');
    return this.requireDocument().combinePaths(operation,paths,control);
  }
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
    let layer=this._read() as VectorLayerData;
    // Standalone output excludes ancestors. Rebase an attached unlinked mask
    // from document space into the immediate parent plane without mutating it.
    if(this.document&&layer.mask?.linked===false){
      const parent=parentId(this.document._read(),this.id);
      const frame=parent?layerTransform(this.document._read(),parent):undefined;
      if(frame){
        const m=frame.inverse().multiply(maskTransform(layer.mask,new AffineTransform()));
        layer={...layer,mask:{...layer.mask,x:m.e,y:m.f,basis:{a:m.a,b:m.b,c:m.c,d:m.d,e:0,f:0}}};
      }
    }
    return exportVectorLayerSvg(
      layer,
      docWidth,
      docHeight,
    );
  }
}
export interface VectorPathOptions extends VectorStrokeOptions, VectorFillOptions {
  points: (Point & { in?: Point; out?: Point })[];
  closed?: boolean;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  fillRule?: "nonzero" | "evenodd";
  subpaths?: VectorContour[];
}
export class VectorPath {
  private data: VectorPathData;
  readonly subpaths = new SubpathCollection(this);
  /** @internal */ _owner: VectorLayer | null = null;
  constructor(options: VectorPathOptions) {
    for (const contour of options.subpaths ?? [])
      if (contour._owner) throw new Error("Contour already belongs to a path.");
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
      ...vectorStrokeData(options),
      ...vectorFillData(options),
      ...(options.fillRule === undefined ? {} : { fillRule: options.fillRule }),
      ...(options.subpaths === undefined ? {} : { subpaths: options.subpaths.map(contour => contour.toJSON()) }),
    });
    for (const contour of options.subpaths ?? []) this.subpaths._own(contour);
  }
  /** @internal */ _pathRecord() { return this.read(); }
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
  get fillRule() { return this.read().fillRule ?? "nonzero"; }
  set fillRule(value: "nonzero" | "evenodd") { this.update({ fillRule: value }); }
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
  get fillGradient():VectorGradientData|null{return structuredClone(this.read().fillGradient??null);}
  set fillGradient(value:VectorGradientData|null){this.update({fillGradient:value});}
  get strokeCap(){return vectorStrokeValues(this.read()).strokeCap;}
  set strokeCap(value:NonNullable<VectorStrokeOptions['strokeCap']>){this.update({strokeCap:value});}
  get strokeJoin(){return vectorStrokeValues(this.read()).strokeJoin;}
  set strokeJoin(value:NonNullable<VectorStrokeOptions['strokeJoin']>){this.update({strokeJoin:value});}
  get strokeMiterLimit(){return vectorStrokeValues(this.read()).strokeMiterLimit;}
  set strokeMiterLimit(value:number){this.update({strokeMiterLimit:value});}
  get strokeDashArray():number[]{return [...vectorStrokeValues(this.read()).strokeDashArray];}
  set strokeDashArray(value:number[]){this.update({strokeDashArray:value});}
  get strokeDashOffset(){return vectorStrokeValues(this.read()).strokeDashOffset;}
  set strokeDashOffset(value:number){this.update({strokeDashOffset:value});}
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
      ...options,
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
    const result = new VectorPath({ points: [{ x: 0, y: 0 }] });
    // Owner-backed getters resolve the current record by ID; retaining the old
    // anchor graph here would unnecessarily pin it after history releases it.
    if (owner) result.data.id = data.id;
    else result.data = pathSchema.parse(data);
    result._owner = owner ?? null;
    return result;
  }
}
/** An editable closed boundary sharing its parent path's paint and fill rule. */
export class VectorContour {
  private data: VectorContourData;
  /** @internal */ _owner: VectorPath | null = null;
  constructor(options: { points: (Point & { in?: Point; out?: Point })[] }) {
    this.data = vectorContourSchema.parse({ id: id(), closed: true, points: options.points.map(p => ({
      x: p.x, y: p.y, in: p.in ?? { x: p.x, y: p.y }, out: p.out ?? { x: p.x, y: p.y },
    })) });
  }
  private read(): VectorContourData {
    if (!this._owner) return this.data;
    const data = this._owner._pathRecord().subpaths?.find(contour => contour.id === this.id);
    if (!data) throw new Error("This contour is not in the current document revision.");
    return data;
  }
  get id() { return this.data.id; }
  get closed(): true { this.read(); return true; }
  get points() { return structuredClone(this.read().points); }
  toJSON(): VectorContourData { return structuredClone(this.read()); }
  private update(points: PathAnchor[]) {
    const data = vectorContourSchema.parse({ ...this.read(), points });
    if (this._owner) this._owner.update({ subpaths: this._owner._pathRecord().subpaths!.map(c => c.id === this.id ? data : c) });
    else this.data = data;
  }
  setPoint(index: number, patch: Partial<PathAnchor>) {
    const points = this.points;
    if (!points[index]) throw new Error("Anchor not found.");
    points[index] = { ...points[index], ...patch }; this.update(points);
  }
  addPoint(point: Point & { in?: Point; out?: Point }) {
    this.update([...this.points, { x: point.x, y: point.y, in: point.in ?? { x: point.x, y: point.y }, out: point.out ?? { x: point.x, y: point.y } }]);
  }
  splitSegment(index: number, t = .5) { this.update(splitPathSegment(this.points, true, index, t)); return index + 1; }
  removePoint(index: number) {
    const points = this.points;
    if (!points[index]) throw new Error("Anchor not found.");
    points.splice(index, 1); this.update(points);
  }
  remove() {
    if (!this._owner) throw new Error("Add the contour to a path first.");
    this.read(); this._owner.subpaths.remove(this.id);
  }
  /** @internal */ static _fromData(data: VectorContourData, owner: VectorPath) {
    const contour = new VectorContour({ points: [{ x: 0, y: 0 }] });
    contour.data.id = data.id; contour._owner = owner; return contour;
  }
}
export class SubpathCollection implements Iterable<VectorContour> {
  private handles = new Map<string, VectorContour>();
  constructor(private owner: VectorPath) {}
  private get data() { return this.owner._pathRecord().subpaths ?? []; }
  get length() { return this.data.length; }
  get(id: string): VectorContour | null {
    const data = this.data.find(c => c.id === id); if (!data) return null;
    if (!this.handles.has(id)) this.handles.set(id, VectorContour._fromData(data, this.owner));
    return this.handles.get(id)!;
  }
  at(index: number) { const data = this.data.at(index); return data ? this.get(data.id) : null; }
  /** @internal */ _own(contour: VectorContour) { contour._owner = this.owner; this.handles.set(contour.id, contour); }
  add(contour: VectorContour): VectorContour {
    if (contour._owner) throw new Error("Contour already belongs to a path.");
    this.owner.update({ subpaths: [...this.data, contour.toJSON()] }); this._own(contour); return contour;
  }
  remove(id: string) {
    if (!this.data.some(c => c.id === id)) throw new Error("Contour not found.");
    this.owner.update({ subpaths: this.data.filter(c => c.id !== id) });
  }
  *[Symbol.iterator]() { for (const data of this.data) yield this.get(data.id)!; }
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
  get paragraphFormat():ParagraphFormat{return paragraphFormat(this._read() as TextLayerData);}
  get paragraphStyle():ParagraphStyle|null{
    const binding=(this._read() as TextLayerData).paragraphStyle;
    return binding?this.requireDocument().paragraphStyles.getById(binding.id)??null:null;
  }
  set paragraphStyle(style:ParagraphStyle|null){this.applyParagraphStyle(style);}
  get paragraphOverrides():Partial<ParagraphFormat>{return structuredClone((this._read() as TextLayerData).paragraphStyle?.overrides??{});}
  applyParagraphStyle(style:ParagraphStyle|null,options:{keepOverrides?:boolean}={}){
    const document=this.requireDocument();
    if(style!==null&&(!(style instanceof ParagraphStyle)||style.document!==document))throw new Error('Use a paragraph style attached to this document.');
    const settings=z.object({keepOverrides:z.boolean().optional()}).strict().parse(options);
    document._dispatch({type:'text.paragraphStyle',id:this.id,styleId:style?.id??null,...settings});
  }
  resetParagraphOverrides(keys?:(keyof ParagraphFormat)[]){this.requireDocument()._dispatch({type:'text.paragraphOverrides.clear',id:this.id,...(keys===undefined?{}:{keys})});}
  constructor(options: TextLayerOptions = {}) {
    const {
      text = "Text",
      fontSize = 32,
      fontFamily = "sans-serif",
      color = "#ffffff",
      align = "left",
      lineHeight = 1.2,
      letterSpacing,
      wordSpacing,
      fontKerning,
      wrapWidth,
      paragraphSpacing,
      firstLineIndent,
      paragraphJustify,
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
        wordSpacing,
        fontKerning,
        wrapWidth,
        paragraphSpacing,
        firstLineIndent,
        paragraphJustify,
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
  /** Restore point text and default paragraph spacing in one undoable command. */
  resetParagraph(): void {
    this.update({wrapWidth: null, paragraphSpacing: 0, firstLineIndent: 0, paragraphJustify: 'none'});
  }
  get paragraphJustify(): 'none' | 'inter-word' | undefined { return (this._read() as TextLayerData).paragraphJustify; }
  set paragraphJustify(value: 'none' | 'inter-word' | undefined) { this.update({paragraphJustify: value}); }
  get wrapWidth(): number | undefined { return (this._read() as TextLayerData).wrapWidth??undefined; }
  set wrapWidth(value: number | null | undefined) { this.update({wrapWidth: value}); }
  get paragraphSpacing(): number | undefined { return (this._read() as TextLayerData).paragraphSpacing; }
  set paragraphSpacing(value: number | undefined) { this.update({paragraphSpacing: value}); }
  get firstLineIndent(): number | undefined { return (this._read() as TextLayerData).firstLineIndent; }
  set firstLineIndent(value: number | undefined) { this.update({firstLineIndent: value}); }
  /** Restore native default spacing in one command, including unsupported styles. */
  resetSpacing(): void {
    this.update({letterSpacing: 0, wordSpacing: 0, fontKerning: 'auto'});
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

  get wordSpacing(): number | undefined {
    return (this._read() as TextLayerData).wordSpacing;
  }
  set wordSpacing(value: number | undefined) {
    this.update({wordSpacing: value});
  }
  get fontKerning(): 'auto' | 'normal' | 'none' | undefined {
    return (this._read() as TextLayerData).fontKerning;
  }
  set fontKerning(value: 'auto' | 'normal' | 'none' | undefined) {
    this.update({fontKerning: value});
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
  adjustment?: AdjustmentData | PatchAdjustment | RedEyeAdjustment;
}

export class AdjustmentLayer extends Layer {
  constructor(options: AdjustmentLayerOptions = {}) {
    const { adjustment = defaultCurvesAdjustment(), ...base } = options;
    super({
      ...createAdjustmentLayer(
        options.name ?? "Adjustment",
        adjustment instanceof PatchAdjustment || adjustment instanceof RedEyeAdjustment
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

  setRedEye(value: RedEyeAdjustment): void {
    if (!(value instanceof RedEyeAdjustment)) throw new Error("Expected a RedEyeAdjustment.");
    this.adjustment = value.toJSON();
  }

  setPatch(patch: PatchAdjustment): void {
    if (!(patch instanceof PatchAdjustment))
      throw new Error("Expected a PatchAdjustment.");
    this.adjustment = patch.toJSON();
  }

  /** Parse a portable .cube table, then use the normal validated command/history boundary. */
  setLut(source: string, options: { amount?: number; interpolation?: LutInterpolation } = {}): void {
    const settings = lutOptionsSchema.parse(options);
    this.adjustment = { kind: "lut", lut: parseCubeLut(source), amount: settings.amount ?? 100,
      interpolation: settings.interpolation ?? "tetrahedral" };
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
