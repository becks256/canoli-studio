import {brushSymmetrySchema,symmetryMatrices,type BrushSymmetryData} from './core/brush-symmetry';
import {brushTipSchema,transformPenTilt,interpolatePenTilt,samePenTilt,type BrushTipData,type PenTiltData} from './core/brush-tip';
import {paintStampGeometry} from './core/paint-stamps';
import {pressureCurveSchema,type PressureCurveData} from './core/pressure-curve';
import { BrushPreset, type BrushTool } from './brushes/presets';
import {BrushTextureSourceOwner,brushTexturePreferenceSchema,type BrushTexturePreference} from './brushes/texture-source';
import type {AssetStore,ImageAsset} from './core/assets';
import {referencedAssets} from './core/model';
import type {BrushTextureData} from './core/brush-texture';
import { strokeCaptureRegion, strokeIntersectsRegion } from "./engine/stroke-region";
import { freeze } from "./core/immutable";
import { ClonePreviewSource } from "./engine/clone-preview";
import { lassoSelection } from "./core/lasso";
import { CanvasRenderer } from "./engine/renderer";
import { CropController } from "./crop-controller";
import type { CropHandle } from "./crop-controller";
import type { QuickSelectionOptions } from './core/quick-selection';
import type { SelectionModificationProgress } from './core/selection-modification';
import type { EditorApplication } from "./editor";
import {
  RasterLayer,
  BrushSymmetry,
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
import { isLocked, findLayer } from "./core/model";
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
import {maskStrokePointCount} from './core/masks';
import type { PreparedWetPaintJob } from './engine/wet-authoring';
import type { WetPaintPreview } from './engine/wet-preview';

import {DEFAULT_SMUDGE,DEFAULT_MIXER,wetToolSettingsSchema,type WetToolSettings} from './brushes/wet-settings';

export type Tool =
  | "smudge"
  | "mixer"
  | "quick-select"
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
  smudge: WetToolSettings;
  mixer: WetToolSettings;
  quickSize:number;
  quickTolerance:number;
  quickEdgeThreshold:number;
  quickSampling:'merged'|'layer';
  quickSelectionMode:'replace'|SelectionOperation;
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
  pressureCurve: PressureCurveData|null;
  tip:BrushTipData|null;
  symmetry:BrushSymmetryData|null;
  texture:BrushTexturePreference;
  color: string;
  penWidth: number;
  penFill: boolean;
  selectionShape: "rectangle" | "ellipse";
  lassoMode: "freeform" | "polygon";
  wandTolerance: number;
  wandContiguous: boolean;
  selectionMode: "replace" | SelectionOperation;
  cloneAligned: boolean;
}
interface ToolState {
  wetPreview: WetPaintPreview | null;
  error: string | null;
  quickSelectionPoints:Point[]|null;
  quickSelectionProgress:SelectionModificationProgress|null;
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
  textureLease?:{assets:AssetStore;asset:Readonly<ImageAsset>;created:boolean};
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
interface WetGesture extends BaseGesture {
  kind: 'wet';
  selectionId:string|null;
  maxPoints:number;
  tool: 'smudge' | 'mixer';
  inputTransform: AffineTransform;
  settings: ToolSettings;
  points: StrokePoint[];
  processed: number;
  previewed: number;
  abort: AbortController;
  ready: Promise<PreparedWetPaintJob>;
  running: Promise<void> | null;
  finishing: boolean;
}
interface LassoGesture extends BaseGesture {
  kind: "lasso";
  points: Point[];
  previous: SelectionData | null;
  operation: "replace" | SelectionOperation;
}
interface QuickSelectionGesture extends BaseGesture {
  kind:'quick-selection';
  points:Point[];
  options:Omit<QuickSelectionOptions,'points'>;
}
interface PolygonLassoDraft extends BaseGesture {
  points: Point[];
  pointer?: Point;
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
  rootOriginal?: VectorPathData;
  contourId?: string;
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
  | WetGesture
  | QuickSelectionGesture
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
  private startingGesture:BaseGesture|null=null;
  private quickAbort:AbortController|null=null;
  private patchAbort: AbortController | null = null;
  private state: ToolState = {
    wetPreview: null,
    error: null,
    quickSelectionPoints:null,
    quickSelectionProgress:null,
    healingStroke: null,
    patchOffset: null,
    settings: {
      smudge: DEFAULT_SMUDGE,
      mixer: DEFAULT_MIXER,
      quickSize:32,
      quickTolerance:32,
      quickEdgeThreshold:64,
      quickSampling:'merged',
      quickSelectionMode:'add',
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
      pressureCurve: null,
      tip:null,
      symmetry:null,
      texture:null,
      color: "#d5e79b",
      penWidth: 3,
      penFill: false,
      selectionShape: "rectangle",
      lassoMode: "freeform",
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
  private polygonLasso: PolygonLassoDraft | null = null;
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
      () => {
        // Crop bounds/active state live on the controller, outside ToolState.
        // Publish those changes even when every cached ToolState field is equal.
        this.uiSnapshot = null;
        this.publish({ drawing: this.crop.dragging || this.gesture !== null });
      },
    );
  }
  getSnapshot = () => this.state;
  /** Current gestures may begin before React flushes a selection preference reset. */
  get hasCurrentWetGesture(){const gesture=this.gesture;if(gesture?.kind!=='wet'||gesture.abort.signal.aborted||gesture.document!==this.editor.document)return false;return gesture.document.getSnapshot().revision===gesture.revision&&(gesture.document.selectedLayer?.id??null)===gesture.selectionId;}

  /** Trusted cursor adapter: use the same stroke plane as begin(), without mutations. */
  brushCursorAxes(tool: Tool, tilt?: PenTiltData, includeDefault=false) {
    const settings = this.state.settings, tip = settings.tip;
    if ((!tip&&!includeDefault) || !['smudge','mixer','brush','pencil','eraser','clone','heal','dodge','burn'].includes(tool)) return null;
    const doc = this.editor.document, snapshot = doc._read(), selected = doc.selectedLayer, gesture = this.gesture;
    let world = new AffineTransform();
    if (gesture?.kind === 'wet' || gesture?.kind === 'paint' || gesture?.kind === 'mask-paint') world = gesture.inputTransform.inverse();
    else if ((['brush','pencil','eraser','smudge','mixer'].includes(tool)) && settings.paintTarget !== 'layer') {
      const filter = settings.paintTarget.startsWith('filter-mask-');
      // Read immutable geometry directly: hover must not clone painted-mask
      // point arrays or construct an entire smart-master Document per frame.
      const record = selected ? findLayer(snapshot, selected.id) : null;
      const mask = filter ? record?.kind === 'smart-object' ? record.filterMask : null : record?.mask;
      if (selected && mask) {
        let plane = layerTransform(snapshot, selected.id)!;
        if (filter && selected instanceof SmartObjectLayer) {
          const source = snapshot.components!.find(component=>component.id === selected.componentId)!.source;
          const master = source.kind === 'document' ? source.document : source;
          plane = plane.multiply(AffineTransform.scale(selected.width / master.width, selected.height / master.height));
        }
        world = maskTransform(mask, plane);
      }
    } else if (tool !== 'heal' && selected && (
      tool === 'dodge' || tool === 'burn'
        ? selected instanceof AdjustmentLayer && selected.adjustmentKind === 'tonal'
        : selected instanceof PaintLayer || ['eraser','smudge','mixer'].includes(tool) && selected instanceof RasterLayer
    )) world = layerTransform(doc._read(), selected.id)!;
    const localTilt = tilt && (tip?.tiltAngle || tip?.tiltRoundness) ? transformPenTilt(tilt, world.inverse()) : undefined;
    const pose = paintStampGeometry({kind:tool === 'pencil' ? 'pencil' : 'brush',size:settings.size,pressureSize:false,tip:tip??undefined},{x:0,y:0,pressure:1,tilt:localTilt},!!settings.texture);
    return {
      a:(world.a*pose.cos+world.c*pose.sin)*pose.rx,
      b:(world.b*pose.cos+world.d*pose.sin)*pose.rx,
      c:(-world.a*pose.sin+world.c*pose.cos)*pose.ry,
      d:(-world.b*pose.sin+world.d*pose.cos)*pose.ry,
    };
  }
  /** Nominal world-space footprints; offsets are relative to the pointer. */
  brushCursorCopies(tool:Tool,point:Point,tilt?:PenTiltData){
    if(!this.state.settings.symmetry)return null;
    const axes=this.brushCursorAxes(tool,tilt,true);if(!axes)return null;
    return symmetryMatrices(this.state.settings.symmetry).map(copy=>{const center=copy.point(point);return{x:center.x-point.x,y:center.y-point.y,
      a:copy.a*axes.a+copy.c*axes.b,b:copy.b*axes.a+copy.d*axes.b,c:copy.a*axes.c+copy.c*axes.d,d:copy.b*axes.c+copy.d*axes.d};});
  }
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
  get drawingPolygonLasso() {
    return this.polygonLasso !== null;
  }
  get drawingQuickSelection(){return this.gesture?.kind==='quick-selection';}
  get polygonLassoPointCount() {
    return this.polygonLasso?.points.length ?? 0;
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
  /** Trusted UI selection; path geometry and document history are unchanged. */
  selectVectorPath(path:VectorPath|null){
    const owner=path?._owner;
    if(path&&(!owner||owner.document!==this.editor.document||!owner.paths.get(path.id)))throw new Error('Select a path attached to the active document.');
    if(this.gesture||this.maskContour||this.polygonLasso||this.quickAbort||this.patchAbort||this.crop.active)this.cancel();
    if(path&&(this.editor.document.selectedLayer?.id!==owner!.id||this.editor.document.selectedLayers.length!==1))this.editor.document.selectedLayer=owner!;
    const hadMaskPoint=!!this.maskPoint;this.maskPoint=null;
    const selectedPath=path?{layerId:owner!.id,pathId:path.id}:null,mode=path?'layer':this.state.settings.penEditTarget;
    if(!hadMaskPoint&&!this.state.penTarget&&this.state.selectedPath?.layerId===selectedPath?.layerId&&this.state.selectedPath?.pathId===selectedPath?.pathId&&mode===this.state.settings.penEditTarget)return;
    this.publish({selectedPath,penTarget:null,settings:mode===this.state.settings.penEditTarget?this.state.settings:{...this.state.settings,penEditTarget:mode}});
  }
  /** Trusted host preference operation; validates before discarding any gesture. */
  applyBrushPreset(preset: BrushPreset,preparedSource?:BrushTextureSourceOwner): BrushTool {
    const owned = new BrushPreset(preset.toJSON(),preset.source);
    if(owned.texture){
      const ready=preparedSource?.source,source=owned.source!;
      if(!ready||ready.blob!==source.blob||ready.width!==source.width||ready.height!==source.height||ready.name!==source.name||ready.tiff?.page!==source.tiff?.page||ready.tiff?.allowPrecisionLoss!==source.tiff?.allowPrecisionLoss)throw new Error('Prepare the original preset source before applying a textured brush.');
      this.editor.brushTextureSource.captureFrom(preparedSource!);
    }
    this.cancel();
    this.configure(owned.toToolSettings());
    return owned.tool;
  }
  /** Commit a validated dialog draft without changing document history. */
  applyBrushTexture(source:BrushTextureSourceOwner,preference:BrushTexturePreference){
    const texture=freeze(brushTexturePreferenceSchema.parse(preference));
    if(texture&&!source.source)throw new Error('Choose a brush texture source first.');
    if(source.source)this.editor.brushTextureSource.captureFrom(source);
    this.cancel();
    this.configure({texture});
  }
  configure(patch: Partial<ToolSettings>) {
    for (const key of ['smudge','mixer'] as const) if (patch[key] !== undefined) {
      patch = {...patch,[key]:freeze(wetToolSettingsSchema.parse(patch[key]))};
    }
    if(patch.texture!==undefined)patch={...patch,texture:freeze(brushTexturePreferenceSchema.parse(patch.texture))};
    if(patch.symmetry!==undefined)patch={...patch,symmetry:patch.symmetry===null?null:freeze(brushSymmetrySchema.parse(patch.symmetry))};
    if(patch.tip!==undefined)patch={...patch,tip:patch.tip===null?null:freeze(brushTipSchema.parse(patch.tip))};
    if(patch.pressureCurve!==undefined)patch={...patch,pressureCurve:patch.pressureCurve===null?null:freeze(pressureCurveSchema.parse(patch.pressureCurve))};
    if(patch.texture&&!this.editor.brushTextureSource.source)throw new Error('Choose a brush texture source first.');
    if(this.gesture?.kind==='wet' && (Object.keys(patch) as (keyof ToolSettings)[]).some(key=>JSON.stringify(patch[key])!==JSON.stringify(this.state.settings[key])))this.cancel();
    if(patch.texture!==undefined&&JSON.stringify(patch.texture)!==JSON.stringify(this.state.settings.texture))this.cancel();
    if(patch.symmetry!==undefined&&JSON.stringify(patch.symmetry)!==JSON.stringify(this.state.settings.symmetry))this.cancel();
    if(patch.tip!==undefined&&JSON.stringify(patch.tip)!==JSON.stringify(this.state.settings.tip))this.cancel();
    if(patch.pressureCurve!==undefined&&JSON.stringify(patch.pressureCurve)!==JSON.stringify(this.state.settings.pressureCurve))this.cancel();
    if((this.drawingQuickSelection||this.quickAbort)&&(['quickSize','quickTolerance','quickEdgeThreshold','quickSampling','quickSelectionMode'] as const).some(key=>patch[key]!==undefined&&patch[key]!==this.state.settings[key]))this.cancel();
    if (patch.lassoMode !== undefined && patch.lassoMode !== this.state.settings.lassoMode)
      this.cancel();
    if (this.polygonLasso && patch.selectionMode !== undefined && patch.selectionMode !== this.state.settings.selectionMode)
      this.cancel();
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
    if(this.gesture?.kind==='wet')this.releaseWet(this.gesture);
    this.state.wetPreview?.dispose();
    this.quickAbort?.abort();this.quickAbort=null;
    this.publish({quickSelectionPoints:null,quickSelectionProgress:null});
    this.patchAbort?.abort();
    this.patchAbort = null;
    this.publish({ patchOffset: null, healingStroke: null });
    this.crop.cancel();
    this.maskContour = null;
    this.polygonLasso = null;
    this.cancelFrame();
    this.generation++;
    if(this.gesture?.kind === "paint")this.gesture.cloneSource?.dispose();
    if(this.gesture)this.releaseTexture(this.gesture);
    this.gesture = null;
    this.publish({
      wetPreview:null,
      preview: null,
      lassoPoints: null,
      paintPreview: null,
      drawing: false,
      patchOffset: null,
      healingStroke: null,
    });
  }
  reset() {
    if(this.gesture?.kind==='wet')this.releaseWet(this.gesture);
    this.state.wetPreview?.dispose();
    this.quickAbort?.abort();this.quickAbort=null;
    this.publish({quickSelectionPoints:null,quickSelectionProgress:null});
    this.patchAbort?.abort();
    this.patchAbort = null;
    this.publish({ patchOffset: null, healingStroke: null });
    this.crop.cancel();
    this.maskContour = null;
    this.polygonLasso = null;
    this.maskPoint = null;
    this.cancelFrame();
    this.generation++;
    if(this.gesture?.kind === "paint")this.gesture.cloneSource?.dispose();
    if(this.gesture)this.releaseTexture(this.gesture);
    this.gesture = null;
    this.publish({
      wetPreview:null,
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
    if (this.polygonLasso) {
      this.finishPolygonLasso();
      return;
    }
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
    if (this.polygonLasso) {
      this.assertPolygonLasso(this.polygonLasso);
      this.cancelFrame();
      this.polygonLasso.pointer = undefined;
      this.polygonLasso.points.pop();
      if (!this.polygonLasso.points.length) this.cancel();
      else this.publish({ lassoPoints: [...this.polygonLasso.points] });
      return true;
    }
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
  /** Capture document-space preference into a stroke's local affine plane once. */
  private symmetryIn(mapping:AffineTransform){return this.state.settings.symmetry?new BrushSymmetry(this.state.settings.symmetry).transformed(mapping).toJSON():null;}
  private captureTexture(gesture:BaseGesture):BrushTextureData|null{
    const preference=this.state.settings.texture;if(!preference)return null;
    const assets=this.editor.assetStore,{asset,created}=this.editor.brushTextureSource.leaseIn(assets);
    gesture.textureLease={assets,asset,created};
    return {assetId:asset.id,...preference};
  }
  private releaseTexture(gesture:BaseGesture){
    const lease=gesture.textureLease;if(!lease?.created||!lease.assets.has(lease.asset.id)||lease.assets.get(lease.asset.id)!==lease.asset)return;
    const state=gesture.document.getSnapshot();
    if([state.document,...state.past.map(entry=>entry.document),...state.future.map(entry=>entry.document)]
      .some(document=>referencedAssets(document).has(lease.asset.id)))return;
    lease.assets.remove(lease.asset.id);
  }
  private textureCurrent(gesture:BaseGesture){
    const lease=gesture.textureLease;if(!lease)return true;
    return this.editor.assetStore===lease.assets&&lease.assets.has(lease.asset.id)&&
      lease.assets.get(lease.asset.id)===lease.asset&&lease.asset.bitmap.width===lease.asset.width&&lease.asset.bitmap.height===lease.asset.height;
  }
  private point(
    point: Point,
    origin: Point,
    pressure: number,
    inputTransform?: AffineTransform,
    tilt?:PenTiltData,
  ): StrokePoint {
    const hasDynamics =
      this.state.settings.pressureSize || this.state.settings.pressureOpacity;
    const p = hasDynamics
      ? this.state.settings.pressureCurve
        ? Math.max(0,Math.min(1,Number.isFinite(pressure)?pressure:.05))
        : Math.max(0.05, Math.min(1, pressure || 0.5))
      : 1;
    return {
      ...(inputTransform
        ? inputTransform.point(point)
        : { x: point.x - origin.x, y: point.y - origin.y }),
      pressure: p,
      ...(tilt&&(this.state.settings.tip?.tiltAngle||this.state.settings.tip?.tiltRoundness)?{tilt:transformPenTilt(tilt,inputTransform)}:{}),
    };
  }
  private assertPolygonLasso(draft: PolygonLassoDraft) {
    try { this.assertCurrent(draft); }
    catch (error) { this.cancel(); throw error; }
  }
  private beginPolygonLasso(
    point: Point,
    modifiers: { alt: boolean; shift: boolean },
    zoom: number,
  ) {
    if (!this.polygonLasso) {
      this.cancel();
      const document = this.editor.document;
      this.polygonLasso = {
        document,
        revision: document.getSnapshot().revision,
        generation: this.generation,
        points: [],
        operation: modifiers.shift && modifiers.alt ? "intersect"
          : modifiers.shift ? "add" : modifiers.alt ? "subtract"
          : this.state.settings.selectionMode,
      };
    }
    const draft = this.polygonLasso;
    this.assertPolygonLasso(draft);
    this.cancelFrame();
    draft.pointer = undefined;
    const first = draft.points[0];
    if (draft.points.length >= 3 && Math.hypot(point.x-first.x, point.y-first.y) <= 6/zoom) {
      this.finishPolygonLasso();
      return;
    }
    const last = draft.points.at(-1);
    if (last && last.x === point.x && last.y === point.y) return;
    if (draft.points.length >= 20000)
      throw new Error("Finish this lasso before adding more points.");
    draft.points.push({ x: point.x, y: point.y });
    this.publish({ lassoPoints: [...draft.points] });
  }
  finishPolygonLasso() {
    const draft = this.polygonLasso;
    if (!draft) return;
    this.assertPolygonLasso(draft);
    if (draft.points.length < 3)
      throw new Error("Place at least three polygon corners before finishing.");
    draft.document.selectPolygon(draft.points, draft.operation);
    this.cancel();
  }
  begin(
    tool:Tool,point:Point,modifiers:{alt:boolean;shift:boolean;pressure:number;tilt?:PenTiltData},zoom:number,cropHandle?:CropHandle,
  ){
    try{this.beginGesture(tool,point,modifiers,zoom,cropHandle);}
    catch(error){if(this.startingGesture)this.releaseTexture(this.startingGesture);throw error;}
    finally{this.startingGesture=null;}
  }
  private beginGesture(
    tool: Tool,
    point: Point,
    modifiers: { alt: boolean; shift: boolean; pressure: number;tilt?:PenTiltData },
    zoom: number,
    cropHandle?: CropHandle,
  ) {
    if (tool === "lasso" && this.state.settings.lassoMode === "polygon") {
      this.beginPolygonLasso(point, modifiers, zoom);
      return;
    }
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
    const base:BaseGesture = {
      document: doc,
      revision: doc.getSnapshot().revision,
      generation: this.generation,
    };
    this.startingGesture=base;
    if(tool==='smudge'||tool==='mixer'){
      const selected=doc.selectedLayer,settings=structuredClone(this.state.settings),target=settings.paintTarget==='layer'?'layer':settings.paintTarget.startsWith('filter-mask-')?'filter-mask':'mask';
      const mask=target==='layer'?null:target==='filter-mask'?selected instanceof SmartObjectLayer?selected.filterMask:null:selected?.mask;
      if(target!=='layer'&&!mask)throw new Error(target==='filter-mask'?'Choose a smart object with a filter mask.':'Choose a layer with a mask.');
      if(target==='layer'&&selected&&!(selected instanceof PaintLayer)&&!(selected instanceof RasterLayer))throw new Error('Choose an image or paint layer for Smudge or Mixer.');
      const maskData=mask?.toJSON(),maxPoints=maskData?Math.min(20000,200000-(maskData.strokes??[]).reduce((total,entry)=>total+maskStrokePointCount(entry),0)):20000;
      if(maskData&&((maskData.strokes?.length??0)>=2048||maxPoints<1))throw new Error('This mask has reached its stroke or point budget.');
      let world=selected?layerTransform(doc._read(),selected.id)!:new AffineTransform();
      if(target==='filter-mask'&&selected instanceof SmartObjectLayer){const master=doc.getComponent(selected.componentId);world=world.multiply(AffineTransform.scale(selected.width/master.width,selected.height/master.height));}
      if(maskData)world=maskTransform(maskData,world);
      const inputTransform=world.inverse();
      const first=this.point(point,{x:0,y:0},modifiers.pressure,inputTransform,modifiers.tilt),abort=new AbortController();
      const dynamics=settings[tool],symmetry=this.symmetryIn(inputTransform);
      const ready=this.editor._beginWetPaint(assets=>new BrushStroke({
        size:settings.size,hardness:settings.hardness,opacity:settings.opacity,flow:settings.flow,spacing:settings.spacing,
        pressureSize:settings.pressureSize,pressureOpacity:settings.pressureOpacity,
        ...(settings.pressureCurve?{pressureCurve:settings.pressureCurve}:{}),...(settings.tip?{tip:settings.tip}:{}),...(symmetry?{symmetry}:{}),
        texture:settings.texture?{assetId:this.editor.brushTextureSource.leaseIn(assets).asset.id,...settings.texture}:null,
        color:settings.color,points:[first],clip:transformSelection(doc.selection?.toJSON(),inputTransform),
      }),{mode:tool,target,signal:abort.signal,load:{load:dynamics.load,...(maskData?{color:[255,255,255,settings.paintTarget.endsWith('hide')?0:255] as [number,number,number,number]}:{})},mix:{wetness:dynamics.wetness,pickup:dynamics.pickup,flow:1}});
      const gesture:WetGesture={...base,kind:'wet',selectionId:selected?.id??null,maxPoints,tool,inputTransform,settings,points:[first],processed:1,previewed:0,abort,ready,running:null,finishing:false};
      this.gesture=gesture;this.publish({drawing:true,error:null});void this.pumpWet(gesture).catch(()=>{});return;
    }
    if(tool==='quick-select'){
      const settings=this.state.settings,layer=doc.selectedLayer;
      if(settings.quickSampling==='layer'&&!layer)throw new Error('Choose a source layer for Quick Selection.');
      const operation=modifiers.shift&&modifiers.alt?'intersect':modifiers.shift?'add':modifiers.alt?'subtract':settings.quickSelectionMode;
      this.gesture={...base,kind:'quick-selection',points:[{...point}],options:{size:settings.quickSize,tolerance:settings.quickTolerance,edgeThreshold:settings.quickEdgeThreshold,operation,source:settings.quickSampling==='layer'?{kind:'layer',layerId:layer!.id}:{kind:'merged'}}};
      this.publish({drawing:true,quickSelectionPoints:[{...point}]});return;
    }
    if (tool === "heal") {
      const settings = { ...this.state.settings };
      const stroke = new BrushStroke({
        ...settings,
        texture:this.captureTexture(base),
        color: "#ffffff",
        points: [this.point(point, { x: 0, y: 0 }, modifiers.pressure,undefined,modifiers.tilt)],
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
            (total, entry) => total + (entry.stroke.kind==='wet'?entry.stroke.brush.points.length:entry.stroke.points.length),
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
        points: [this.point(point, origin, modifiers.pressure, inputTransform,modifiers.tilt)],
        size: this.state.settings.size,
        hardness: this.state.settings.hardness,
        opacity: this.state.settings.opacity,
        flow: this.state.settings.flow,
        spacing: this.state.settings.spacing,
        pressureSize: this.state.settings.pressureSize,
        pressureOpacity: this.state.settings.pressureOpacity,
        ...(this.state.settings.pressureCurve?{pressureCurve:this.state.settings.pressureCurve}:{}),
        ...(this.state.settings.tip?{tip:this.state.settings.tip}:{}),
        ...(this.state.settings.symmetry?{symmetry:this.symmetryIn(inputTransform)!}:{}),
        texture:this.captureTexture(base),
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
      points: [this.point(point, origin, modifiers.pressure, inputTransform,modifiers.tilt)],
      settings: { ...this.state.settings,symmetry:this.symmetryIn(inputTransform) },
      offset,
      stroke: new (tool === "pencil"
        ? PencilStroke
        : tool === "eraser"
          ? EraserStroke
          : BrushStroke)({
        points: [this.point(point, origin, modifiers.pressure, inputTransform,modifiers.tilt)],
        size: this.state.settings.size,
        hardness: this.state.settings.hardness,
        opacity: this.state.settings.opacity,
        flow: this.state.settings.flow,
        spacing: this.state.settings.spacing,
        pressureSize: this.state.settings.pressureSize,
        pressureOpacity: this.state.settings.pressureOpacity,
        ...(this.state.settings.pressureCurve?{pressureCurve:this.state.settings.pressureCurve}:{}),
        ...(this.state.settings.tip?{tip:this.state.settings.tip}:{}),
        ...(this.state.settings.symmetry?{symmetry:this.symmetryIn(inputTransform)!}:{}),
        texture:this.captureTexture(base),
        color: this.state.settings.color,
        clip: transformSelection(doc.selection?.toJSON(), inputTransform),
      }).toJSON() as BrushStrokeData,
    };
    // captureTexture runs during construction, after the base object was spread.
    if(base.textureLease)this.gesture.textureLease=base.textureLease;
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
          patch: this.penPatch(gesture),
        };
  }
  private penPatch(gesture: PenGesture): Partial<Omit<VectorPathData, "id">> {
    const points = gesture.data.points.map((point, index) =>
      index === gesture.index ? structuredClone(point) : point);
    return gesture.contourId
      ? { subpaths: gesture.rootOriginal!.subpaths!.map(contour => contour.id === gesture.contourId ? { ...contour, points } : contour) }
      : { points, closed: gesture.data.closed };
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
    let contourId: string | undefined;
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
        for (const contour of [candidate, ...(candidate.subpaths ?? [])]) {
        const points = contour.points;
        for (let i = 0; i < points.length; i++) {
          const anchor = points[i];
          for (const part of ["in", "out", "anchor"] as const) {
            const p = part === "anchor" ? anchor : anchor[part];
            if (part !== "anchor" && p.x === anchor.x && p.y === anchor.y)
              continue;
            if (near(p)) {
              sourcePath = candidate;
              contourId = contour === candidate ? undefined : contour.id;
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
    const rootOriginal = sourcePath ?? freeze(path.toJSON());
    const original = contourId ? { ...rootOriginal, points: rootOriginal.subpaths!.find(c => c.id === contourId)!.points, closed: true, subpaths: undefined } : rootOriginal,
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
      rootOriginal,
      contourId,
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
    modifiers: { shift: boolean; alt: boolean; pressure: number;tilt?:PenTiltData },
  ) {
    if (this.polygonLasso) {
      const draft = this.polygonLasso;
      this.assertPolygonLasso(draft);
      draft.pointer = { x: point.x, y: point.y };
      if (this.paintFrame === null) this.paintFrame = requestAnimationFrame(() => {
        this.paintFrame = null;
        if (this.polygonLasso !== draft) return;
        if (this.editor.document !== draft.document || draft.document.getSnapshot().revision !== draft.revision) {
          this.cancel();
          return;
        }
        this.publish({ lassoPoints: [...draft.points, ...(draft.pointer ? [draft.pointer] : [])] });
      });
      return;
    }
    if (this.crop.dragging) {
      this.crop.move(point, modifiers.shift);
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.kind === "fill") return;
    if(!this.textureCurrent(gesture)){this.cancel();throw new Error('The brush texture source changed during this gesture. Try again.');}
    if(gesture.kind==='wet'){
      if(gesture.finishing)return;
      try{this.assertCurrent(gesture);}catch(error){this.cancel();throw error;}
      let next=this.point(point,{x:0,y:0},modifiers.pressure,gesture.inputTransform,modifiers.tilt);
      const last=gesture.points.at(-1)!,factor=1-Math.min(.9,gesture.settings.smoothing),tilt=interpolatePenTilt(last.tilt,next.tilt,factor);
      next={x:last.x+(next.x-last.x)*factor,y:last.y+(next.y-last.y)*factor,pressure:last.pressure!+(next.pressure!-last.pressure!)*factor,...(tilt?{tilt}:{})};
      if(next.x===last.x&&next.y===last.y&&next.pressure===last.pressure&&samePenTilt(next.tilt,last.tilt))return;
      if(gesture.points.length>=gesture.maxPoints){this.cancel();throw new Error('This wet stroke has reached its target point limit.');}
      gesture.points.push(next);
      if(this.paintFrame===null)this.paintFrame=requestAnimationFrame(()=>{this.paintFrame=null;if(this.gesture===gesture)void this.pumpWet(gesture).catch(()=>{});});
      return;
    }
    if(gesture.kind==='quick-selection'){
      try{this.assertCurrent(gesture);}catch(error){this.cancel();throw error;}
      const last=gesture.points.at(-1)!;if(Math.hypot(point.x-last.x,point.y-last.y)<.25)return;
      if(gesture.points.length>=20000)throw new Error('Finish this Quick Selection stroke before adding more points.');
      gesture.points.push({...point});
      if(this.paintFrame===null)this.paintFrame=requestAnimationFrame(()=>{this.paintFrame=null;if(this.gesture===gesture)this.publish({quickSelectionPoints:[...gesture.points]});});
      return;
    }
    if (gesture.kind === "heal") {
      let next = this.point(point, { x: 0, y: 0 }, modifiers.pressure,undefined,modifiers.tilt);
      const last = gesture.stroke.points.at(-1)!;
      const factor = 1 - Math.min(0.9, gesture.settings.smoothing);
      const nextTilt=interpolatePenTilt(last.tilt,next.tilt,factor);
      next = {
        ...(nextTilt?{tilt:nextTilt}:{}),
        x: last.x + (next.x - last.x) * factor,
        y: last.y + (next.y - last.y) * factor,
        pressure: last.pressure + (next.pressure - last.pressure) * factor,
      };
      if (Math.hypot(next.x - last.x, next.y - last.y) < 0.25&&
          (!gesture.stroke.pressureCurve||next.pressure===last.pressure)&&samePenTilt(next.tilt,last.tilt)) return;
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
        modifiers.tilt,
      );
      const last = gesture.stroke.points.at(-1)!;
      const smoothing = this.state.settings.smoothing ?? 0;
      if (smoothing > 0) {
        const factor = 1 - Math.min(0.9, smoothing);
        const nextTilt=interpolatePenTilt(last.tilt,p.tilt,factor);
        p = {
          ...(nextTilt?{tilt:nextTilt}:{}),
          x: last.x + (p.x - last.x) * factor,
          y: last.y + (p.y - last.y) * factor,
          pressure: last.pressure + (p.pressure - last.pressure) * factor,
        };
      }
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.25&&
          (!gesture.stroke.pressureCurve||p.pressure===last.pressure)&&samePenTilt(p.tilt,last.tilt)) return;
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
        modifiers.tilt,
      );
      const last = gesture.points.at(-1)!;
      const smoothing = gesture.settings.smoothing ?? 0;
      if (smoothing > 0) {
        const factor = 1 - Math.min(0.9, smoothing);
        const nextTilt=interpolatePenTilt(last.tilt,p.tilt,factor);
        p = {
          ...(nextTilt?{tilt:nextTilt}:{}),
          x: last.x + (p.x - last.x) * factor,
          y: last.y + (p.y - last.y) * factor,
          pressure: last.pressure + (p.pressure - last.pressure) * factor,
        };
      }
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.25&&
          (!gesture.settings.pressureCurve||p.pressure===last.pressure)&&samePenTilt(p.tilt,last.tilt)) return;
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
      ...(gesture.settings.pressureCurve?{pressureCurve:gesture.settings.pressureCurve}:{}),
      ...(gesture.settings.tip?{tip:gesture.settings.tip}:{}),
      ...(gesture.settings.symmetry?{symmetry:gesture.settings.symmetry}:{}),
      ...(gesture.stroke.texture?{texture:gesture.stroke.texture}:{}),
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
    if(!this.textureCurrent(gesture)){this.cancel();return;}
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
    if(!this.textureCurrent(gesture)){this.cancel();return;}
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
    if(!this.textureCurrent(gesture))throw new Error('The brush texture source changed during this gesture. Try again.');
    if (
      gesture.generation !== this.generation ||
      this.editor.document !== gesture.document ||
      gesture.document.getSnapshot().revision !== gesture.revision
    )
      throw new Error("The document changed during this gesture. Try again.");
  }
  private releaseWet(gesture: WetGesture) {
    gesture.abort.abort(new Error('Wet stroke cancelled.'));
    void gesture.ready.then(job=>job.dispose(),()=>{}).catch(()=>{});
  }
  /** Preserve every accepted sample; only prefix publication is coalesced. */
  private pumpWet(gesture: WetGesture): Promise<void> {
    if(gesture.running)return gesture.running;
    const run=(async()=>{
      const job=await gesture.ready;
      while(this.gesture===gesture&&!gesture.abort.signal.aborted){
        this.assertCurrent(gesture);
        const count=gesture.points.length;
        if(gesture.processed<count){await job.append(gesture.points.slice(gesture.processed,count));gesture.processed=count;}
        // Input can arrive while an earlier append is awaiting native work.
        // Pointer-up freezes input, then drains every still-buffered sample.
        if(gesture.finishing){if(gesture.processed<gesture.points.length)continue;break;}
        if(gesture.previewed===gesture.processed)break;
        const frame=await job.preview();
        if(this.gesture!==gesture||gesture.abort.signal.aborted){frame?.dispose();break;}
        try{this.assertCurrent(gesture);}catch(error){frame?.dispose();throw error;}
        gesture.previewed=gesture.processed;
        const previous=this.state.wetPreview;
        this.publish({wetPreview:frame});
        previous?.dispose();
      }
    })();
    gesture.running=run;
    void run.catch(error=>{
      if(this.gesture===gesture&&!gesture.abort.signal.aborted){
        this.cancel();this.publish({error:error instanceof Error?error.message:'Wet painting failed.'});
      }
    }).finally(()=>{if(gesture.running===run)gesture.running=null;});
    return run;
  }
  private async endWet(gesture: WetGesture) {
    gesture.finishing=true;
    try{
      await this.pumpWet(gesture);
      if(this.gesture!==gesture||gesture.abort.signal.aborted)return;
      this.assertCurrent(gesture);
      const job=await gesture.ready;
      await job.commit();
    }finally{
      this.releaseWet(gesture);
      if(this.gesture===gesture){
        this.gesture=null;
        const frame=this.state.wetPreview;
        this.publish({wetPreview:null,drawing:false});
        frame?.dispose();
      }
      await gesture.ready.then(job=>job.dispose(),()=>{});
    }
  }
  async end() {
    if (this.crop.dragging) {
      this.crop.end();
      return;
    }
    this.cancelFrame();
    const gesture = this.gesture;
    if (!gesture) return;
    if(gesture.kind==='wet'){await this.endWet(gesture);return;}
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
      if(gesture.kind==='quick-selection'){
        const abort=new AbortController();this.quickAbort=abort;this.publish({quickSelectionProgress:{completed:0,total:1}});
        try{await doc.selectQuickSelection({...gesture.options,points:gesture.points},{signal:abort.signal,onProgress:progress=>this.publish({quickSelectionProgress:progress})});committed=true;}
        catch(error){if(!abort.signal.aborted)throw error;}
        finally{if(this.quickAbort===abort)this.quickAbort=null;}
        return;
      }
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
            gesture.path.update(this.penPatch(gesture));
            gesture.layer.paths.add(gesture.path);
          } else
            gesture.path.update(this.penPatch(gesture));
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
      this.releaseTexture(gesture);
      if (!committed)
        stagedTiles.forEach((tile) => assets.remove(tile.assetId));
      this.publish({
        quickSelectionPoints:null,
        quickSelectionProgress:null,
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
      ...options,
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
