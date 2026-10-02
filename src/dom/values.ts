import { AffineTransform } from "../core/affine";
import { id } from "../core/model";
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

export interface BrushOptions {
  points: (Point & { pressure?: number })[];
  size?: number;
  hardness?: number;
  opacity?: number;
  flow?: number;
  spacing?: number;
  pressureSize?: boolean;
  pressureOpacity?: boolean;
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
  get color() {
    return this.data.color;
  }
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
