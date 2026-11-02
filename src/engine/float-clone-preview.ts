import { AffineTransform } from "../core/affine";
import {
  validateWindow,
  type FloatSourceWindow,
} from "../core/float-source/types";
import type { CapturedFloatScene } from "./float-scene";
import { projectFloatWindow } from "./float-projection";
import type { BrushStrokeData } from "../core/drawing";
import { floatCloneCaptureRegions } from "./float-clone-regions";

/** Gesture-owned original-derived samples. Sixteen 256-square float tiles use
 * at most 16 MiB; document/source geometry is independent of this cache. */
export class FloatClonePreviewSource {
  private tiles = new Map<string, Float32Array>();
  private closed = false;
  private scene?: CapturedFloatScene;
  private ready: Promise<CapturedFloatScene>;
  private active: Promise<unknown> = Promise.resolve();
  private planes = new WeakMap<
    BrushStrokeData,
    {
      left: number;
      top: number;
      width: number;
      height: number;
      regions: ReturnType<typeof floatCloneCaptureRegions>;
    }
  >();
  get isDisposed() {
    return this.closed;
  }
  constructor(
    capture: Promise<CapturedFloatScene>,
    private width: number,
    private height: number,
    private placement: AffineTransform,
    private current: () => void,
  ) {
    this.ready = capture.then((scene) => {
      if (this.closed) {
        scene.dispose();
        throw new Error("Float clone preview ended.");
      }
      this.scene = scene;
      this.check();
      return scene;
    });
    void this.ready.catch(() => {});
  }
  check() {
    if (this.closed) throw new Error("Float clone preview ended.");
    this.current();
    this.scene?.check();
  }
  read(input: FloatSourceWindow): Promise<Float32Array> {
    const region = validateWindow(input),
      pending = this.active.then(() => this.readTiles(region));
    this.active = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  async readPlaced(
    stroke: BrushStrokeData,
    area: FloatSourceWindow,
    world: AffineTransform,
  ): Promise<Float32Array> {
    this.check();
    let plane = this.planes.get(stroke);
    if (!plane) {
      const regions = floatCloneCaptureRegions(stroke);
      if (!regions.length)
        return new Float32Array(validateWindow(area).width * area.height * 4);
      const left = Math.min(...regions.map((r) => r.x)) - 1,
        top = Math.min(...regions.map((r) => r.y)) - 1,
        right = Math.max(...regions.map((r) => r.x + r.width)) + 1,
        bottom = Math.max(...regions.map((r) => r.y + r.height)) + 1;
      plane = { left, top, width: right - left, height: bottom - top, regions };
      if (
        !Object.values({
          left,
          top,
          right,
          bottom,
          width: plane.width,
          height: plane.height,
        }).every(Number.isSafeInteger)
      )
        throw new Error(
          "Native clone preview bounds exceed coordinate precision.",
        );
      this.planes.set(stroke, plane);
    }
    const captured = plane,
      source = {
        width: plane.width,
        height: plane.height,
        readWindow: async (input: FloatSourceWindow) => {
          this.check();
          const region = {
              ...input,
              x: input.x + captured.left,
              y: input.y + captured.top,
            },
            output = new Float32Array(region.width * region.height * 4);
          for (const tile of captured.regions) {
            const left = Math.max(region.x, tile.x),
              top = Math.max(region.y, tile.y),
              right = Math.min(region.x + region.width, tile.x + tile.width),
              bottom = Math.min(region.y + region.height, tile.y + tile.height);
            if (right <= left || bottom <= top) continue;
            const width = right - left,
              height = bottom - top,
              pixels = await this.read({ x: left, y: top, width, height });
            this.check();
            for (let row = 0; row < height; row++)
              output.set(
                pixels.subarray(row * width * 4, (row + 1) * width * 4),
                ((top - region.y + row) * region.width + left - region.x) * 4,
              );
          }
          this.check();
          return output;
        },
      };
    const output = await projectFloatWindow(
      source,
      world.multiply(AffineTransform.translation(plane.left, plane.top)),
      area,
      {
        isCancelled: () => {
          this.check();
          return false;
        },
      },
    );
    this.check();
    return output;
  }
  private async tile(x: number, y: number) {
    this.check();
    const key = x + ":" + y;
    let pixels = this.tiles.get(key);
    if (!pixels) {
      const scene = await this.ready;
      this.check();
      pixels = await projectFloatWindow(
        {
          width: this.width,
          height: this.height,
          readWindow: (region) => {
            this.check();
            return scene.read(region);
          },
        },
        this.placement,
        { x, y, width: 256, height: 256 },
        {
          isCancelled: () => {
            this.check();
            return false;
          },
        },
      );
      this.check();
      while (this.tiles.size >= 16)
        this.tiles.delete(this.tiles.keys().next().value!);
    } else this.tiles.delete(key);
    this.tiles.set(key, pixels);
    return pixels;
  }
  private async readTiles(region: FloatSourceWindow) {
    this.check();
    const output = new Float32Array(region.width * region.height * 4);
    for (
      let y = Math.floor(region.y / 256) * 256;
      y < region.y + region.height;
      y += 256
    )
      for (
        let x = Math.floor(region.x / 256) * 256;
        x < region.x + region.width;
        x += 256
      ) {
        const pixels = await this.tile(x, y);
        this.check();
        const left = Math.max(x, region.x),
          top = Math.max(y, region.y),
          right = Math.min(x + 256, region.x + region.width),
          bottom = Math.min(y + 256, region.y + region.height);
        for (let row = top; row < bottom; row++)
          output.set(
            pixels.subarray(
              ((row - y) * 256 + left - x) * 4,
              ((row - y) * 256 + right - x) * 4,
            ),
            ((row - region.y) * region.width + left - region.x) * 4,
          );
      }
    this.check();
    return output;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.tiles.clear();
    this.scene?.dispose();
    this.scene = undefined;
  }
}
