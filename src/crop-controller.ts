import type { Document } from "./dom";
import type { Point } from "./core/drawing";
import { cropBoundsSchema, cropFromSelection } from "./core/crop";
import type { CropBounds } from "./core/crop";

export const CROP_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;
export type CropHandle = (typeof CROP_HANDLES)[number];
type CropMode = CropHandle | "move" | "new";
interface CropDrag {
  start: Point;
  original: CropBounds | null;
  next: CropBounds;
  mode: CropMode;
}

export function cropHandlePoint(bounds: CropBounds, handle: CropHandle): Point {
  return {
    x:
      bounds.x +
      (handle.includes("w")
        ? 0
        : handle.includes("e")
          ? bounds.width
          : bounds.width / 2),
    y:
      bounds.y +
      (handle.includes("n")
        ? 0
        : handle.includes("s")
          ? bounds.height
          : bounds.height / 2),
  };
}
function hitFrame(bounds: CropBounds, point: Point, zoom: number): CropMode {
  const tolerance = 7 / zoom;
  for (const handle of ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const) {
    const p = cropHandlePoint(bounds, handle);
    if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) return handle;
  }
  const right = bounds.x + bounds.width,
    bottom = bounds.y + bounds.height;
  if (point.y >= bounds.y && point.y <= bottom) {
    if (Math.abs(point.x - bounds.x) <= tolerance) return "w";
    if (Math.abs(point.x - right) <= tolerance) return "e";
  }
  if (point.x >= bounds.x && point.x <= right) {
    if (Math.abs(point.y - bounds.y) <= tolerance) return "n";
    if (Math.abs(point.y - bottom) <= tolerance) return "s";
  }
  return point.x > bounds.x &&
    point.x < right &&
    point.y > bounds.y &&
    point.y < bottom
    ? "move"
    : "new";
}
export function adjustCrop(
  bounds: CropBounds,
  mode: CropHandle | "move",
  dx: number,
  dy: number,
  proportional = false,
): CropBounds {
  if (mode === "move")
    return cropBoundsSchema.parse({
      ...bounds,
      x: bounds.x + dx,
      y: bounds.y + dy,
    });
  let left = bounds.x,
    top = bounds.y,
    right = left + bounds.width,
    bottom = top + bounds.height;
  if (mode.includes("w")) left = Math.min(right - 1, left + dx);
  if (mode.includes("e")) right = Math.max(left + 1, right + dx);
  if (mode.includes("n")) top = Math.min(bottom - 1, top + dy);
  if (mode.includes("s")) bottom = Math.max(top + 1, bottom + dy);
  if (proportional && mode.length === 2) {
    let width = right - left,
      height = bottom - top;
    if (Math.abs(dx) / bounds.width >= Math.abs(dy) / bounds.height)
      height = Math.max(1, Math.round((width * bounds.height) / bounds.width));
    else
      width = Math.max(1, Math.round((height * bounds.width) / bounds.height));
    if (mode.includes("w")) left = right - width;
    else right = left + width;
    if (mode.includes("n")) top = bottom - height;
    else bottom = top + height;
  }
  return cropBoundsSchema.parse({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

/** A transient frame: pointer and keyboard edits never change the document until apply. */
export class CropController {
  private document: Document | null = null;
  private revision = 0;
  private frame: CropBounds | null = null;
  private drag: CropDrag | null = null;
  private animationFrame: number | null = null;
  constructor(
    private currentDocument: () => Document,
    private changed: () => void,
  ) {}
  get active() {
    return this.document !== null;
  }
  get dragging() {
    return this.drag !== null;
  }
  get bounds() {
    return this.frame ? { ...this.frame } : null;
  }
  start(bounds?: CropBounds | null) {
    this.cancel();
    const document = this.currentDocument();
    const initial =
      bounds === undefined
        ? cropFromSelection(document.selection?.toJSON())
        : bounds;
    this.frame = initial ? cropBoundsSchema.parse(initial) : null;
    this.document = document;
    this.revision = document.getSnapshot().revision;
    this.changed();
  }
  cancel() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    const active = this.active;
    this.document = null;
    this.frame = null;
    this.drag = null;
    if (active) this.changed();
  }
  private assertCurrent() {
    if (
      this.document !== this.currentDocument() ||
      this.document.getSnapshot().revision !== this.revision
    ) {
      this.cancel();
      throw new Error(
        "The document changed. Draw a new crop frame before applying.",
      );
    }
  }
  begin(point: Point, zoom: number, handle?: CropHandle) {
    if (!this.active) this.start(null);
    this.assertCurrent();
    const start = { x: Math.round(point.x), y: Math.round(point.y) };
    const mode = this.frame
      ? (handle ?? hitFrame(this.frame, point, zoom))
      : "new";
    const next =
      this.frame && mode !== "new"
        ? { ...this.frame }
        : cropBoundsSchema.parse({ ...start, width: 1, height: 1 });
    this.drag = { start, original: this.frame, next, mode };
    this.frame = next;
    this.changed();
  }
  move(point: Point, proportional = false) {
    const drag = this.drag;
    if (!drag) return;
    this.assertCurrent();
    let dx = Math.round(point.x) - drag.start.x,
      dy = Math.round(point.y) - drag.start.y;
    if (drag.mode === "new") {
      if (proportional) {
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (dx < 0 ? -1 : 1) * size;
        dy = (dy < 0 ? -1 : 1) * size;
      }
      drag.next = cropBoundsSchema.parse({
        x: drag.start.x + Math.min(0, dx),
        y: drag.start.y + Math.min(0, dy),
        width: Math.max(1, Math.abs(dx)),
        height: Math.max(1, Math.abs(dy)),
      });
    } else
      drag.next = adjustCrop(drag.original!, drag.mode, dx, dy, proportional);
    if (this.animationFrame === null)
      this.animationFrame = requestAnimationFrame(() => {
        this.animationFrame = null;
        if (this.drag === drag) {
          this.frame = drag.next;
          this.changed();
        }
      });
  }
  end() {
    if (!this.drag) return;
    this.assertCurrent();
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.frame = this.drag.next;
    this.drag = null;
    this.changed();
  }
  nudge(dx: number, dy: number, handle: CropHandle | "move" = "move") {
    if (!this.frame || this.drag) return;
    this.assertCurrent();
    this.frame = adjustCrop(this.frame, handle, dx, dy);
    this.changed();
  }
  apply() {
    if (!this.active) return;
    this.assertCurrent();
    this.end();
    if (!this.frame) return;
    this.document!.crop(this.frame);
    this.cancel();
  }
}
