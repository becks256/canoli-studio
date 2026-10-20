import { expect, it } from "vitest";
import { BrushStroke, LayerMask } from "../src/dom";
import { freeze } from "../src/core/immutable";
import { maskGeometrySignature, maskSignature } from "../src/engine/mask-signature";

function fixture() {
  const mask=new LayerMask({ base: 1, strokes: [{ mode: "hide", stroke: new BrushStroke({ points: [{ x: 3, y: 4 }] }) }] }).toJSON();
  const entry=mask.strokes![0];if(mask.kind!=='paint'||entry.mode==='wet')throw new Error('Expected ordinary painted mask fixture.');
  return {...mask,strokes:[entry]};
}
it("retains immutable stroke keys across mask wrappers and distinguishes changed geometry", () => {
  const mask = freeze(fixture());
  const signature = maskSignature(mask);
  expect(maskSignature({ ...mask, strokes: [...mask.strokes!] })).toBe(signature);
  const changed = structuredClone(mask);
  changed.strokes![0].stroke.points[0].x++;
  expect(maskSignature(freeze(changed))).not.toBe(signature);
  expect(maskSignature({ ...mask, density: 0.5 })).not.toBe(signature);
  expect(maskGeometrySignature({ ...mask, density: 0.5, inverted: true })).toBe(maskGeometrySignature(mask));
});
it("mutable and shallow-frozen entries remain sensitive to nested stroke edits", () => {
  const mask = fixture();
  Object.freeze(mask.strokes![0]);
  const before = maskSignature(mask), raw = maskGeometrySignature(mask);
  mask.strokes![0].stroke.points[0].x++;
  expect(maskSignature(mask)).not.toBe(before);
  expect(maskGeometrySignature(mask)).not.toBe(raw);
});
it("live strokes invalidate alongside retained immutable prefixes without mutating masks", () => {
  const prefix = freeze(fixture());
  const active = fixture().strokes![0];
  const mask = { ...prefix, strokes: [...prefix.strokes!, active] };
  const before = maskGeometrySignature(mask);
  active.stroke.points.push({ x: 30, y: 40, pressure: 1 });
  expect(maskGeometrySignature(mask)).not.toBe(before);
  expect(prefix.strokes).toHaveLength(1);
  expect(prefix.strokes![0].stroke.points).toHaveLength(1);
});
