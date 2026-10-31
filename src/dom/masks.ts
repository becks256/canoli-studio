import {PerspectiveTransform} from './perspective';
import { AffineTransform } from "../core/affine";
import { layerMaskSchema } from "../core/masks";
import type { LayerMaskData } from "../core/masks";
import {
  BrushStroke,
  EraserStroke,
  PaintFill,
  WetPaintStroke,
  PencilStroke,
  PaintOperation,
  MarqueeSelection,
} from "./values";
import { VectorPath } from "./index";
import { pathContours } from "../core/drawing";

export interface MaskPaintPlacement {width:number;height:number;perspective:PerspectiveTransform;basis:AffineTransform}
export type MaskPaint = {stroke:BrushStroke|PencilStroke;mode:"hide"|"reveal";placement?:MaskPaintPlacement}|{stroke:WetPaintStroke;mode:"wet"};
function paintData(entry:MaskPaint){
 const placement='placement'in entry?entry.placement:undefined;
 if(placement!==undefined&&(entry.mode==='wet'||!placement||!(placement.perspective instanceof PerspectiveTransform)||!(placement.basis instanceof AffineTransform)))throw new Error('Placed mask values require BrushStroke/PencilStroke, PerspectiveTransform and AffineTransform.');
 return{stroke:entry.stroke.toJSON(),mode:entry.mode,...(placement?{placement:{width:placement.width,height:placement.height,perspective:placement.perspective.toJSON(),basis:placement.basis.toJSON()}}:{})};
}
function paintValue(entry:import('../core/masks').MaskOperationData):MaskPaint{return entry.mode==='wet'?{mode:'wet',stroke:PaintOperation.fromJSON(entry.stroke) as WetPaintStroke}:{mode:entry.mode,stroke:PaintOperation.fromJSON(entry.stroke) as BrushStroke|PencilStroke,...(entry.placement?{placement:{width:entry.placement.width,height:entry.placement.height,perspective:new PerspectiveTransform(entry.placement.perspective),basis:AffineTransform.fromJSON(entry.placement.basis)}}:{})};}
export interface RasterErasureMaskSource {width:number;height:number;operations:readonly {width:number;height:number;stroke:EraserStroke|PaintFill;placement?:{perspective:PerspectiveTransform;bounds:import('../core/drawing').Rect}}[]}
interface MaskSettings {
  rasterErasures?: RasterErasureMaskSource;
  basis?: AffineTransform;
  strokes?: MaskPaint[];
  x?: number;
  y?: number;
  linked?: boolean;
  feather?: number;
  enabled?: boolean;
  inverted?: boolean;
  density?: number;
}
export type LayerMaskOptions = MaskSettings &
  (
    | { rasterErasures: RasterErasureMaskSource; selection?:never; paths?:never; fillRule?:never; base?:never; assetId?:never }
    | {
        selection: MarqueeSelection;
        paths?: never;
        fillRule?: never;
        base?: never;
        assetId?: never;
      }
    | {
        paths: VectorPath[];
        fillRule?: "evenodd" | "nonzero";
        selection?: never;
        base?: never;
        assetId?: never;
      }
    | {
        base: number;
        strokes?: MaskPaint[];
        paths?: never;
        selection?: never;
        fillRule?: never;
        assetId?: never;
      }
    | {
        assetId: string;
        selection?: never;
        paths?: never;
        fillRule?: never;
        base?: never;
      }
  );
/** Immutable value: assign a new mask to a layer to create an undoable change. */
export class LayerMask {
  private readonly data: LayerMaskData;
  constructor(options: LayerMaskOptions) {
    const {
      enabled = true,
      inverted = false,
      density = 1,
      feather = 0,
      x = 0,
      y = 0,
      linked = true,
    } = options;
    const native=options.rasterErasures;
    if(native&&options.fillRule!==undefined)throw new Error("Fill rule applies only to vector masks.");
    const sources = [
      !!native,
      options.base !== undefined,
      !!options.selection,
      !!options.paths,
      !!options.assetId,
    ].filter(Boolean).length;
    if (sources > 1) throw new Error("Choose one mask geometry source.");
    if (options.base !== undefined && options.fillRule !== undefined)
      throw new Error("Fill rule applies only to vector masks.");
    if (options.selection && options.fillRule !== undefined)
      throw new Error("Fill rule applies only to vector masks.");
    if (options.assetId && options.fillRule !== undefined)
      throw new Error("Fill rule applies only to vector masks.");
    const strokeSettings =
      options.strokes === undefined
        ? {}
        : {
            strokes: options.strokes.map(paintData),
          };
    if (native) {
      this.data=layerMaskSchema.parse({kind:'raster-erasures',width:native.width,height:native.height,
        erasures:native.operations.map(entry=>({width:entry.width,height:entry.height,stroke:entry.stroke.toJSON(),...(entry.placement?{placement:{perspective:entry.placement.perspective.toJSON(),bounds:{...entry.placement.bounds}}}:{})})),...strokeSettings,enabled,inverted,density,feather,x,y,linked,
        ...(options.basis?{basis:options.basis.toJSON()}:{})});
    } else if (options.base !== undefined) {
      this.data = layerMaskSchema.parse({
        kind: "paint",
        base: options.base,
        strokes: (options.strokes === undefined ? [] : options.strokes).map(paintData),
        enabled,
        inverted,
        density,
        feather,
        x,
        y,
        linked,
        ...(options.basis ? { basis: options.basis.toJSON() } : {}),
      });
    } else if (options.paths) {
      const paths = options.paths.flatMap((path) => {
        if (!path.closed) throw new Error("Vector masks require closed paths.");
        return pathContours(path.toJSON()).map(contour => ({ points: contour.points }));
      });
      this.data = layerMaskSchema.parse({
        kind: "vector",
        ...strokeSettings,
        paths,
        fillRule: options.fillRule === undefined ? "evenodd" : options.fillRule,
        enabled,
        inverted,
        density,
        feather,
        x,
        y,
        linked,
        ...(options.basis ? { basis: options.basis.toJSON() } : {}),
      });
    } else if (options.assetId) {
      this.data = layerMaskSchema.parse({
        kind: "bitmap",
        assetId: options.assetId,
        ...strokeSettings,
        enabled,
        inverted,
        density,
        feather,
        x,
        y,
        linked,
        ...(options.basis ? { basis: options.basis.toJSON() } : {}),
      });
    } else {
      this.data = layerMaskSchema.parse({
        kind: "selection",
        ...strokeSettings,
        selection: options.selection?.toJSON(),
        enabled,
        inverted,
        density,
        feather,
        x,
        y,
        linked,
        ...(options.basis ? { basis: options.basis.toJSON() } : {}),
      });
    }
  }
  get rasterErasures(): RasterErasureMaskSource | null {
    return this.data.kind==='raster-erasures'?{width:this.data.width,height:this.data.height,operations:this.data.erasures.map(entry=>({width:entry.width,height:entry.height,stroke:PaintOperation.fromJSON(entry.stroke) as EraserStroke|PaintFill,...(entry.placement?{placement:{perspective:new PerspectiveTransform(entry.placement.perspective),bounds:{...entry.placement.bounds}}}:{})}))}:null;
  }
  get base() {
    return this.data.kind === "paint" ? this.data.base : null;
  }
  get assetId(): string | null {
    return this.data.kind === "bitmap" ? this.data.assetId : null;
  }
  get strokes(): MaskPaint[] {
    return (this.data.strokes ?? []).map(paintValue);
  }
  paint(stroke: BrushStroke | PencilStroke, mode: "hide" | "reveal" = "hide", options:{placement?:MaskPaintPlacement}={}) {
    if(!(stroke instanceof BrushStroke)||!['hide','reveal'].includes(mode))throw new Error('Use a BrushStroke or PencilStroke with Hide/Reveal.');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='placement'))throw new Error('Invalid mask paint options.');
    if(options.placement!==undefined&&(!options.placement||!(options.placement.perspective instanceof PerspectiveTransform)||!(options.placement.basis instanceof AffineTransform)))throw new Error('Use PerspectiveTransform and AffineTransform placement values.');
    return this.with({ strokes: [...this.strokes, { stroke, mode,...(options.placement?{placement:options.placement}:{}) }] });
  }
  applyWetPaint(stroke:WetPaintStroke):LayerMask {
    if(!(stroke instanceof WetPaintStroke))throw new Error('Use a WetPaintStroke value for prepared mask coverage.');
    return this.with({strokes:[...this.strokes,{mode:'wet',stroke}]});
  }
  get basis() {
    return this.data.basis
      ? AffineTransform.fromJSON(this.data.basis)
      : new AffineTransform();
  }
  get x() {
    return this.data.x ?? 0;
  }
  get y() {
    return this.data.y ?? 0;
  }
  get linked() {
    return this.data.linked ?? true;
  }
  get feather() {
    return this.data.feather ?? 0;
  }
  get kind() {
    return this.data.kind;
  }
  get selection() {
    if (this.data.kind !== "selection")
      throw new Error(
        `This is a ${this.data.kind} mask; it has no selection geometry.`,
      );
    return new MarqueeSelection(this.data.selection);
  }
  get paths() {
    if (this.data.kind !== "vector")
      throw new Error(
        `This is a ${this.data.kind} mask; it has no vector paths.`,
      );
    return this.data.paths.map(
      (path) =>
        new VectorPath({
          points: path.points,
          closed: true,
          fill: null,
          stroke: null,
        }),
    );
  }
  get fillRule() {
    return this.data.kind === "vector" ? this.data.fillRule : null;
  }
  get enabled() {
    return this.data.enabled;
  }
  get inverted() {
    return this.data.inverted;
  }
  get density() {
    return this.data.density;
  }
  with(values: Partial<LayerMaskOptions>) {
    if([values.base!==undefined,!!values.selection,!!values.paths,!!values.assetId,!!values.rasterErasures].filter(Boolean).length>1)throw new Error("Choose one mask geometry source.");
    if (values.base !== undefined && (values.selection || values.paths))
      throw new Error("Choose one mask geometry source.");
    if (values.selection && values.paths)
      throw new Error("Choose selection or paths for a mask, not both.");
    const {
      enabled = this.enabled,
      inverted = this.inverted,
      density = this.density,
      feather = this.feather,
      x = this.x,
      y = this.y,
      linked = this.linked,
    } = values;
    const strokes =
      values.strokes === undefined ? this.strokes : values.strokes;
    const settings = {
      basis: values.basis ?? (this.data.basis ? this.basis : undefined),
      enabled,
      inverted,
      density,
      feather,
      x,
      y,
      linked,
      ...(values.strokes !== undefined || this.data.strokes !== undefined
        ? { strokes }
        : {}),
    };
    if(values.rasterErasures || (this.data.kind==='raster-erasures'&&values.base===undefined&&values.selection===undefined&&values.paths===undefined&&values.assetId===undefined)){
      if(values.fillRule!==undefined)throw new Error('Fill rule applies only to vector masks.');
      return new LayerMask({...settings,rasterErasures:values.rasterErasures??this.rasterErasures!});
    }
    if (
      values.base !== undefined ||
      (this.data.kind === "paint" &&
        values.selection === undefined &&
        values.paths === undefined)
    ) {
      if (values.fillRule !== undefined)
        throw new Error("Fill rule applies only to vector masks.");
      return new LayerMask({
        ...settings,
        base: values.base === undefined ? this.base! : values.base,
        strokes,
      });
    }
    if (values.selection && values.fillRule !== undefined)
      throw new Error("Fill rule applies only to vector masks.");
    if (values.selection !== undefined)
      return new LayerMask({ ...settings, selection: values.selection });
    if (values.paths !== undefined)
      return new LayerMask({
        ...settings,
        paths: values.paths,
        fillRule:
          values.fillRule === undefined
            ? (this.fillRule ?? "evenodd")
            : values.fillRule,
      });
    if (this.data.kind === "vector")
      return new LayerMask({
        ...settings,
        paths: this.paths,
        fillRule:
          values.fillRule === undefined ? this.data.fillRule : values.fillRule,
      });
    if (
      values.assetId !== undefined ||
      (this.data.kind === "bitmap" && values.selection === undefined)
    ) {
      return new LayerMask({
        ...settings,
        assetId:
          values.assetId ??
          (this.data.kind === "bitmap" ? this.data.assetId : ""),
      });
    }
    if (values.fillRule !== undefined)
      throw new Error("Fill rule applies only to vector masks.");
    return new LayerMask({ ...settings, selection: this.selection });
  }
  toJSON(): LayerMaskData {
    return structuredClone(this.data);
  }
  static fromBitmap(assetId: string, options: Partial<MaskSettings> = {}) {
    return new LayerMask({ ...options, assetId });
  }
  /** @internal */
  static _fromJSON(data: LayerMaskData) {
    const value = layerMaskSchema.parse(data);
    const basis = value.basis
      ? AffineTransform.fromJSON(value.basis)
      : undefined;
    const strokes:MaskPaint[]|undefined = value.strokes?.map(paintValue);
    if(value.kind==='raster-erasures')return new LayerMask({...value,basis,strokes,rasterErasures:{width:value.width,height:value.height,operations:value.erasures.map(entry=>({width:entry.width,height:entry.height,stroke:PaintOperation.fromJSON(entry.stroke) as EraserStroke|PaintFill,...(entry.placement?{placement:{perspective:new PerspectiveTransform(entry.placement.perspective),bounds:{...entry.placement.bounds}}}:{})}))}});
    if (value.kind === "paint")
      return new LayerMask({ ...value, basis, strokes });
    if (value.kind === "bitmap")
      return new LayerMask({
        ...value,
        basis,
        strokes,
        assetId: value.assetId,
      });
    return value.kind === "selection"
      ? new LayerMask({
          ...value,
          basis,
          strokes,
          selection: new MarqueeSelection(value.selection),
        })
      : new LayerMask({
          ...value,
          basis,
          strokes,
          paths: value.paths.map(
            (path) => new VectorPath({ points: path.points, closed: true }),
          ),
        });
  }
}
