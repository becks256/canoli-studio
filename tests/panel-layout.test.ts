import { expect, it } from "vitest";
import {
  defaultPanelWidths,
  fitPanelWidths,
  readPanelWidths,
} from "../src/ui/panel-layout";
it("keeps panel minimums and canvas room across narrow and wide windows", () => {
  for (const viewport of [760, 900, 1100, 1280, 1600, 1920]) {
    const widths = fitPanelWidths({ layers: 480, inspector: 480 }, viewport);
    expect(widths.layers).toBeGreaterThanOrEqual(190);
    expect(widths.inspector).toBeGreaterThanOrEqual(230);
    expect(
      widths.layers + widths.inspector + 54 + 12 + 200,
    ).toBeLessThanOrEqual(viewport);
  }
  expect(defaultPanelWidths(1000)).toEqual({ layers: 190, inspector: 230 });
});
it("validates saved widths and propagates unreadable storage without writes", () => {
  expect(readPanelWidths({ getItem: () => null })).toBeNull();
  expect(
    readPanelWidths({
      getItem: () =>
        JSON.stringify({ version: 1, layers: 300, inspector: 350 }),
    }),
  ).toEqual({ layers: 300, inspector: 350 });
  for (const raw of [
    "{broken",
    '{"version":2}',
    '{"version":1,"layers":0,"inspector":500}',
  ])
    expect(() => readPanelWidths({ getItem: () => raw })).toThrow();
});
