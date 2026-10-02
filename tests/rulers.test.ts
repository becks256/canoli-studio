import { expect, it } from "vitest";
import { rulerTicks } from "../src/ui/CanvasRulers";

it("bounds ruler tick count by viewport size across zoom and large document origins", () => {
  for (const zoom of [0.001, 0.1, 1, 8, 64]) {
    const origin = -250000 * zoom;
    const ticks = rulerTicks(1920, origin, zoom);
    expect(ticks.length).toBeLessThanOrEqual(33);
    expect(ticks[0].pixel).toBeGreaterThanOrEqual(-0.00001);
    for (const tick of ticks)
      expect(tick.pixel).toBeCloseTo(origin + tick.value * zoom);
    expect(ticks[1].pixel - ticks[0].pixel).toBeGreaterThanOrEqual(59.999);
  }
});
