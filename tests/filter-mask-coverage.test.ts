import { expect, it } from "vitest";
import { LayerMask, BrushStroke, AffineTransform } from "../src/dom";
import {
  uniformFilterMaskCoverage,
  regionalFilterMask,
} from "../src/engine/filter-mask-coverage";
const region = { x: 0, y: 0, width: 16, height: 16 },
  identity = new AffineTransform();
it("recognizes only exact uniform endpoints with mask density and inversion", () => {
  const mask = new LayerMask({ base: 1 });
  expect(uniformFilterMaskCoverage(mask.toJSON(), region, identity)).toBe(1);
  expect(
    uniformFilterMaskCoverage(
      mask.with({ inverted: true }).toJSON(),
      region,
      identity,
    ),
  ).toBe(0);
  expect(
    uniformFilterMaskCoverage(
      mask.with({ inverted: true, density: 0.5 }).toJSON(),
      region,
      identity,
    ),
  ).toBeUndefined();
  expect(
    uniformFilterMaskCoverage(
      new LayerMask({ base: 0.5 }).toJSON(),
      region,
      identity,
    ),
  ).toBeUndefined();
  expect(
    uniformFilterMaskCoverage(
      mask.with({ enabled: false }).toJSON(),
      region,
      identity,
    ),
  ).toBe(1);
});
it("accounts for transformed stroke bounds and feather halos conservatively", () => {
  const mask = new LayerMask({ base: 1 }).paint(
    new BrushStroke({
      points: [{ x: 24, y: 8 }],
      size: 4,
      pressureSize: false,
    }),
    "hide",
  );
  expect(uniformFilterMaskCoverage(mask.toJSON(), region, identity)).toBe(1);
  expect(
    uniformFilterMaskCoverage(
      mask.toJSON(),
      region,
      AffineTransform.translation(-10, 0),
    ),
  ).toBeUndefined();
  expect(
    uniformFilterMaskCoverage(
      mask.with({ feather: 6 }).toJSON(),
      region,
      identity,
    ),
  ).toBeUndefined();
  expect(
    uniformFilterMaskCoverage(
      mask.toJSON(),
      region,
      AffineTransform.scale(0.5),
    ),
  ).toBeUndefined();
});

it("regional signatures retain feather-reaching and transformed strokes but ignore distant edits", () => {
  const near = new BrushStroke({
    points: [{ x: 8, y: 8 }],
    size: 4,
    pressureSize: false,
  });
  const far = new BrushStroke({
    points: [{ x: 24, y: 8 }],
    size: 4,
    pressureSize: false,
  });
  const mask = new LayerMask({ base: 1 }).paint(near, "hide");
  const edited = mask.paint(far, "reveal");
  expect(regionalFilterMask(edited.toJSON(), region, identity)).toEqual(
    mask.toJSON(),
  );
  expect(
    regionalFilterMask(edited.with({ feather: 6 }).toJSON(), region, identity)
      .strokes,
  ).toHaveLength(2);
  expect(
    regionalFilterMask(
      edited.toJSON(),
      region,
      AffineTransform.translation(-10, 0),
    ).strokes,
  ).toHaveLength(2);
  expect(edited.toJSON().strokes).toHaveLength(2);
});
