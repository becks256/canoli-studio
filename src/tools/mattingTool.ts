/**
 * Interactive Refine Edge brush tool (T19 / A04).
 * Allows users to paint unknown-transition bands, foreground reveals, or background erasures
 * onto the active trimap buffer for fine edge matting.
 */

import {
  TRIMAP_BACKGROUND,
  TRIMAP_FOREGROUND,
  TRIMAP_UNKNOWN,
  type TrimapBuffer,
  type TrimapValue,
} from "../intelligence/matting/types";

export type MattingBrushMode = "refine" | "foreground" | "background";

export interface MattingStrokePoint {
  x: number;
  y: number;
}

export interface MattingToolOptions {
  mode: MattingBrushMode;
  radius: number;
  hardness?: number;
}

export class MattingTool {
  private trimap: TrimapBuffer;
  private mode: MattingBrushMode = "refine";
  private radius = 10;
  private hardness = 0.5;
  private isDrawing = false;
  private lastPoint: MattingStrokePoint | null = null;
  private listeners = new Set<(trimap: TrimapBuffer) => void>();

  constructor(initialTrimap: TrimapBuffer) {
    this.trimap = {
      width: initialTrimap.width,
      height: initialTrimap.height,
      data: new Uint8Array(initialTrimap.data),
    };
  }

  getTrimap(): TrimapBuffer {
    return this.trimap;
  }

  setTrimap(trimap: TrimapBuffer): void {
    this.trimap = {
      width: trimap.width,
      height: trimap.height,
      data: new Uint8Array(trimap.data),
    };
    this.notify();
  }

  setMode(mode: MattingBrushMode): void {
    this.mode = mode;
  }

  getMode(): MattingBrushMode {
    return this.mode;
  }

  setRadius(radius: number): void {
    this.radius = Math.max(1, Math.min(100, Math.round(radius)));
  }

  getRadius(): number {
    return this.radius;
  }

  setHardness(hardness: number): void {
    this.hardness = Math.max(0, Math.min(1, hardness));
  }

  getHardness(): number {
    return this.hardness;
  }

  subscribe(listener: (trimap: TrimapBuffer) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.trimap);
    }
  }

  startStroke(point: MattingStrokePoint): void {
    this.isDrawing = true;
    this.lastPoint = point;
    this.stamp(point.x, point.y);
    this.notify();
  }

  continueStroke(point: MattingStrokePoint): void {
    if (!this.isDrawing || !this.lastPoint) return;

    // Linear interpolation between stroke points for smooth continuous strokes
    const dx = point.x - this.lastPoint.x;
    const dy = point.y - this.lastPoint.y;
    const dist = Math.hypot(dx, dy);
    const stepSize = Math.max(1, this.radius * 0.25);
    const steps = Math.ceil(dist / stepSize);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = this.lastPoint.x + dx * t;
      const y = this.lastPoint.y + dy * t;
      this.stamp(x, y);
    }

    this.lastPoint = point;
    this.notify();
  }

  endStroke(): void {
    this.isDrawing = false;
    this.lastPoint = null;
    this.notify();
  }

  cancelStroke(): void {
    this.isDrawing = false;
    this.lastPoint = null;
  }

  /**
   * Stamps circular brush footprint onto trimap at (cx, cy).
   */
  private stamp(cx: number, cy: number): void {
    const width = this.trimap.width;
    const height = this.trimap.height;
    const data = this.trimap.data;

    let targetValue: TrimapValue = TRIMAP_UNKNOWN;
    if (this.mode === "foreground") targetValue = TRIMAP_FOREGROUND;
    else if (this.mode === "background") targetValue = TRIMAP_BACKGROUND;

    const r = this.radius;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(height - 1, Math.ceil(cy + r));

    const rSq = r * r;

    for (let y = minY; y <= maxY; y++) {
      const row = y * width;
      const dy = y - cy;
      const dySq = dy * dy;

      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dySq <= rSq) {
          data[row + x] = targetValue;
        }
      }
    }
  }
}
