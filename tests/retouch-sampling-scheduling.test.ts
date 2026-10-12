import { expect, it, vi } from "vitest";
import { Document } from "../src/dom";
import { sampleRetouchRegion } from "../src/engine/retouch-sampling";
import type { AssetStore } from "../src/core/assets";
import type { DocumentRenderer } from "../src/engine/renderer";

const pause = vi.hoisted(() => ({ resume: undefined as undefined | (() => void) }));
vi.mock("../src/engine/task-yield", () => ({
  yieldTask: () => new Promise<void>(resolve => { pause.resume = resolve; }),
}));

it("releases capture surfaces and honors cancellation between expensive tiles", async () => {
  const document = new Document().toJSON();
  const controller = new AbortController();
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const canvas = {
    width: 1024, height: 1,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4096) }) }),
  };
  const render = vi.fn(async () => { now += 10; return canvas; });
  try {
    const capture = sampleRetouchRegion(document, {} as AssetStore,
      { render } as unknown as DocumentRenderer,
      { x: 0, y: 0, width: 1025, height: 1 }, controller.signal);
    await Promise.resolve();
    expect(pause.resume).toBeTypeOf("function");
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    controller.abort();
    pause.resume!();
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(render).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
    pause.resume = undefined;
  }
});
