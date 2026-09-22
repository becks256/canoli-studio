import { id } from "../core/model";
import {
  blendIfSchema,
  defaultStyle,
  paintOperationSchema,
  selectionSchema,
  translateSelection,
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
  color?: string;
  clip?: MarqueeSelection | SelectionData | null;
  kind?: "brush" | "pencil" | "clone";
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
  get color() {
    return this.data.color;
  }
}
export class PencilStroke extends BrushStroke {
  constructor(options: BrushOptions) {
    super({ ...options, kind: "pencil", hardness: 1, size: options.size ?? 1 });
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
