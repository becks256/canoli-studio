import {brushSymmetrySchema,type BrushSymmetryData} from '../core/brush-symmetry';
import {brushTextureSourceSchema,type BrushTextureData,type BrushTextureSource} from '../core/brush-texture';
import {AffineTransform,type AffineData} from '../core/affine';
import {brushTipSchema,type BrushTipData,type PenTiltData} from '../core/brush-tip';
import {freeze} from '../core/immutable';
import type { WetPaintStrokeData, WetPaintTileData } from '../core/wet-operation';
import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintLoadOptions, type WetPaintMixOptions } from '../core/wet-paint';
import { id } from "../core/model";
import {pressureCurveSchema,PRESSURE_CURVE_PRESETS,type PressureCurveData,type PressureKnot} from '../core/pressure-curve';
import {
  blendIfSchema,
  defaultStyle,
  paintOperationSchema,
  selectionSchema,
  translateSelection,
  transformSelection,
} from "../core/drawing";
import type {
  BlendIfData,
  BrushStrokeData,
  CloneTile,
  FillData,
  PaintOperationData,
  Point,
  Rect,
  SelectionData,
  SelectionOperation,
  SelectionRegion,
  StrokePoint,
} from "../core/drawing";

export class BlendIf {
  private readonly data: BlendIfData;
  constructor(options: Partial<BlendIfData> = {}) {
    this.data = blendIfSchema.parse({ ...defaultStyle().blendIf, ...options });
  }
  get enabled() {
    return this.data.enabled;
  }
  get channel() {
    return this.data.channel;
  }
  get source() {
    return [...this.data.source];
  }
  get underlying() {
    return [...this.data.underlying];
  }
  toJSON(): BlendIfData {
    return structuredClone(this.data);
  }
}

export class MarqueeSelection {
  private readonly data: SelectionData;
  constructor(
    options:
      | (Omit<SelectionRegion, "operation"> & {
          operation?: SelectionOperation;
        })
      | SelectionData = { regions: [] },
  ) {
    this.data = selectionSchema.parse(
      "regions" in options
        ? options
        : { regions: [{ ...options, operation: options.operation ?? "add" }] },
    );
  }
  get regions() {
    return structuredClone(this.data.regions);
  }
  combine(
    selection: MarqueeSelection,
    operation: SelectionOperation = "add",
  ): MarqueeSelection {
    if (selection.regions.length !== 1)
      throw new Error("Combine one marquee region at a time.");
    return new MarqueeSelection({
      regions: [...this.regions, { ...selection.regions[0], operation }],
    });
  }
  transformed(transform: AffineTransform): MarqueeSelection {
    if (!(transform instanceof AffineTransform))
      throw new Error("Use an AffineTransform value.");
    return new MarqueeSelection(transformSelection(this.data, transform)!);
  }
  translated(x: number, y: number) {
    return new MarqueeSelection(translateSelection(this.data, x, y)!);
  }
  toJSON(): SelectionData {
    return structuredClone(this.data);
  }
}

export class PressureCurve {
  private readonly data:PressureCurveData;
  constructor(options:{points:readonly PressureKnot[]}){
    this.data=pressureCurveSchema.parse(options);
    this.data.points.forEach(Object.freeze);Object.freeze(this.data.points);Object.freeze(this.data);
  }
  static linear(){return new PressureCurve(PRESSURE_CURVE_PRESETS.linear);}
  static soft(){return new PressureCurve(PRESSURE_CURVE_PRESETS.soft);}
  static firm(){return new PressureCurve(PRESSURE_CURVE_PRESETS.firm);}
  get points():PressureKnot[]{return structuredClone(this.data.points);}
  toJSON():PressureCurveData{return structuredClone(this.data);}
}

/** Immutable copy transforms; original ink is always implicit. */
export class BrushSymmetry {
  private readonly data:BrushSymmetryData;
  constructor(options:{copies:readonly (AffineTransform|AffineData)[]}){
    const owned=brushSymmetrySchema.parse({...options,copies:options.copies.map(m=>m instanceof AffineTransform?m.toJSON():m)});
    for(const copy of owned.copies)for(const key of ['a','b','c','d','e','f'] as const)if(Object.is(copy[key],-0))copy[key]=0;
    this.data=freeze(owned);Object.freeze(this);
  }
  static mirrorVertical(x:number){return new BrushSymmetry({copies:[new AffineTransform(-1,0,0,1,2*x,0)]});}
  static mirrorHorizontal(y:number){return new BrushSymmetry({copies:[new AffineTransform(1,0,0,-1,0,2*y)]});}
  static bothAxes(center:{x:number;y:number}){return new BrushSymmetry({copies:[new AffineTransform(-1,0,0,1,2*center.x,0),new AffineTransform(1,0,0,-1,0,2*center.y),new AffineTransform(-1,0,0,-1,2*center.x,2*center.y)]});}
  static radial(center:{x:number;y:number},count:number){
    if(!Number.isSafeInteger(count)||count<2||count>32)throw new Error('Radial symmetry requires 2–32 sectors.');
    const snap=(v:number)=>Math.abs(v)<1e-12?0:Math.abs(v-1)<1e-12?1:Math.abs(v+1)<1e-12?-1:v;
    return new BrushSymmetry({copies:Array.from({length:count-1},(_,i)=>{const angle=2*Math.PI*(i+1)/count,c=snap(Math.cos(angle)),s=snap(Math.sin(angle));return new AffineTransform(c,s,-s,c,0,0).around(center);})});
  }
  get copies(){return this.data.copies.map(AffineTransform.fromJSON);}
  transformed(mapping:AffineTransform){const inverse=mapping.inverse();return new BrushSymmetry({copies:this.copies.map(copy=>mapping.multiply(copy).multiply(inverse))});}
  toJSON():BrushSymmetryData{return structuredClone(this.data);}
}

export interface BrushTipOptions {
  roundness?:number; angle?:number; tiltAngle?:boolean; tiltRoundness?:boolean;
  tiltCurve?:PressureCurve|PressureCurveData|null;
}
export class BrushTip {
  private readonly data:BrushTipData;
  constructor(options:BrushTipOptions={}){
    const {tiltCurve,...rest}=options;
    this.data=freeze(brushTipSchema.parse({...rest,roundness:options.roundness??1,angle:options.angle??0,
      tiltAngle:options.tiltAngle??false,tiltRoundness:options.tiltRoundness??false,
      ...(tiltCurve?{tiltCurve:tiltCurve instanceof PressureCurve?tiltCurve.toJSON():tiltCurve}:{})}));
    Object.freeze(this);
  }
  get roundness(){return this.data.roundness;}
  get angle(){return this.data.angle;}
  get tiltAngle(){return this.data.tiltAngle??false;}
  get tiltRoundness(){return this.data.tiltRoundness??false;}
  get tiltCurve(){return this.data.tiltCurve?new PressureCurve(this.data.tiltCurve):null;}
  with(options:BrushTipOptions){return new BrushTip({...this.data,...options});}
  toJSON():BrushTipData{return structuredClone(this.data);}
}

/** Immutable existing-asset reference; it grants no image/file access. */
export class BrushTexture {
  private readonly data:BrushTextureData;
  constructor(options:BrushTextureSource){this.data=freeze(brushTextureSourceSchema.parse(options));Object.freeze(this);}
  get assetId(){return this.data.assetId;}
  get channel(){return this.data.channel;}
  get invert(){return this.data.invert;}
  with(options:Partial<BrushTextureSource>){return new BrushTexture({...this.data,...options});}
  toJSON():BrushTextureData{return structuredClone(this.data);}
}

export interface BrushOptions {
  points: (Point & { pressure?: number;tilt?:PenTiltData })[];
  size?: number;
  hardness?: number;
  opacity?: number;
  flow?: number;
  spacing?: number;
  pressureSize?: boolean;
  pressureOpacity?: boolean;
  pressureCurve?: PressureCurve|PressureCurveData|null;
  tip?: BrushTip|BrushTipData|null;
  symmetry?:BrushSymmetry|BrushSymmetryData|null;
  texture?:BrushTexture|BrushTextureData|null;
  color?: string;
  clip?: MarqueeSelection | SelectionData | null;
  kind?: "brush" | "pencil" | "clone" | "eraser";
  tiles?: CloneTile[];
}
export abstract class PaintOperation {
  protected data: PaintOperationData;
  protected constructor(data: PaintOperationData) {
    this.data = paintOperationSchema.parse(data);
  }
  get id() {
    return this.data.id;
  }
  get kind() {
    return this.data.kind;
  }
  toJSON(): PaintOperationData {
    return structuredClone(this.data);
  }
  /** @internal Immutable operations may share content, but collections own IDs. */
  static fromJSON(data: PaintOperationData): PaintOperation {
    const result: PaintOperation =
      data.kind === "fill"
        ? new PaintFill(data)
        : data.kind === 'wet'
          ? new WetPaintStroke(data)
        : data.kind === "pencil"
          ? new PencilStroke(data)
          : data.kind === "clone"
            ? new CloneStroke(data)
            : data.kind === "eraser"
              ? new EraserStroke(data)
              : new BrushStroke(data);
    result.data = paintOperationSchema.parse(data);
    return result;
  }
}
export class BrushStroke extends PaintOperation {
  constructor(options: BrushOptions) {
    super({
      id: id(),
      kind: options.kind ?? "brush",
      points: options.points.map((point) => ({
        ...point,
        pressure: point.pressure ?? 1,
      })),
      size: options.size ?? 24,
      hardness: options.hardness ?? 0.7,
      opacity: options.opacity ?? 1,
      flow: options.flow ?? 1,
      spacing: options.spacing ?? 0.25,
      pressureSize: options.pressureSize,
      pressureOpacity: options.pressureOpacity,
      ...(options.pressureCurve?{pressureCurve:options.pressureCurve instanceof PressureCurve?options.pressureCurve.toJSON():options.pressureCurve}:{}),
      ...(options.tip?{tip:options.tip instanceof BrushTip?options.tip.toJSON():options.tip}:{}),
      ...(options.symmetry?{symmetry:options.symmetry instanceof BrushSymmetry?options.symmetry.toJSON():options.symmetry}:{}),
      ...(options.texture!=null?{texture:options.texture instanceof BrushTexture?options.texture.toJSON():options.texture}:{}),
      color: options.color ?? "#d5e79b",
      clip:
        options.clip instanceof MarqueeSelection
          ? options.clip.toJSON()
          : (options.clip ?? null),
      tiles: options.tiles ?? [],
    });
  }
  get points(): StrokePoint[] {
    return structuredClone((this.data as BrushStrokeData).points);
  }
  override toJSON(): BrushStrokeData { return structuredClone(this.data as BrushStrokeData); }
  get size() {
    return (this.data as BrushStrokeData).size;
  }
  get hardness() {
    return (this.data as BrushStrokeData).hardness;
  }
  get opacity() {
    return this.data.opacity;
  }
  get flow() {
    return (this.data as BrushStrokeData).flow ?? 1;
  }
  get spacing() {
    return (this.data as BrushStrokeData).spacing ?? 0.25;
  }
  get pressureSize() {
    return (this.data as BrushStrokeData).pressureSize ?? true;
  }
  get pressureOpacity() {
    return (this.data as BrushStrokeData).pressureOpacity ?? false;
  }
  get pressureCurve(){const curve=(this.data as BrushStrokeData).pressureCurve;return curve?new PressureCurve(curve):null;}
  get symmetry(){const symmetry=(this.data as BrushStrokeData).symmetry;return symmetry?new BrushSymmetry(symmetry):null;}
  get texture(){const texture=(this.data as BrushStrokeData).texture;return texture?new BrushTexture(texture):null;}
  get tip(){const tip=(this.data as BrushStrokeData).tip;return tip?new BrushTip(tip):null;}
  get color() {
    return (this.data as BrushStrokeData).color;
  }
}
export interface WetPaintStrokeOptions {
  brush: BrushStroke | BrushStrokeData;
  tiles: WetPaintTileData[];
  nativeTransform?: AffineTransform | AffineData;
  opacity?: number;
  load?: WetPaintLoadOptions;
  mix?: WetPaintMixOptions;
}
export class WetPaintStroke extends PaintOperation {
  constructor(options: WetPaintStrokeOptions) {
    super({ id: id(), kind: 'wet', opacity: options.opacity === undefined ? 1 : options.opacity, clip: null,
      brush: options.brush instanceof BrushStroke ? options.brush.toJSON() : options.brush,
      tiles: options.tiles, nativeTransform: options.nativeTransform instanceof AffineTransform ? options.nativeTransform.toJSON() : options.nativeTransform === undefined ? new AffineTransform().toJSON() : options.nativeTransform,
      load: wetPaintLoadSchema.parse(options.load === undefined ? {} : options.load), mix: wetPaintMixSchema.parse(options.mix === undefined ? {} : options.mix),
    });
  }
  override toJSON(): WetPaintStrokeData { return structuredClone(this.data as WetPaintStrokeData); }
  get opacity() { return this.data.opacity; }
  get brush() { return PaintOperation.fromJSON((this.data as WetPaintStrokeData).brush) as BrushStroke; }
  get tiles() { return structuredClone((this.data as WetPaintStrokeData).tiles); }
  get nativeTransform() { return AffineTransform.fromJSON((this.data as WetPaintStrokeData).nativeTransform); }
  get load() { return structuredClone((this.data as WetPaintStrokeData).load); }
  get mix() { return structuredClone((this.data as WetPaintStrokeData).mix); }
}
export class PencilStroke extends BrushStroke {
  constructor(options: BrushOptions) {
    super({ ...options, kind: "pencil", hardness: 1, size: options.size ?? 1 });
  }
}
export class EraserStroke extends BrushStroke {
  constructor(options: BrushOptions) {
    super({ ...options, kind: "eraser" });
  }
}
export class CloneStroke extends BrushStroke {
  constructor(options: BrushOptions & { tiles: CloneTile[] }) {
    super({ ...options, kind: "clone" });
  }
}
export class PaintFill extends PaintOperation {
  override toJSON(): FillData { return structuredClone(this.data as FillData); }
  constructor(options: {
    bounds: Rect;
    color?: string;
    opacity?: number;
    clip?: MarqueeSelection | SelectionData | null;
    erase?: boolean;
  }) {
    super({
      id: id(),
      kind: "fill",
      bounds: options.bounds,
      color: options.color ?? "#d5e79b",
      opacity: options.opacity ?? 1,
      clip:
        options.clip instanceof MarqueeSelection
          ? options.clip.toJSON()
          : (options.clip ?? null),
      erase: options.erase ?? false,
    });
  }
  get bounds(): Rect {
    return structuredClone((this.data as FillData).bounds);
  }
  get color(): string {
    return (this.data as FillData).color;
  }
  get opacity(): number {
    return (this.data as FillData).opacity;
  }
  get erase(): boolean {
    return (this.data as FillData).erase;
  }
}
