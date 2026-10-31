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
it('placed filter-mask support uses captured image and mask basis instead of authored point bounds',()=>{
 const mask=LayerMask._fromJSON({kind:'paint',base:1,enabled:true,inverted:false,density:1,strokes:[{mode:'hide',stroke:new BrushStroke({points:[{x:100,y:50}],size:10,pressureSize:false}).toJSON(),placement:{width:128,height:96,perspective:{corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},basis:{a:2,b:0,c:0,d:2,e:0,f:0}}}]}).toJSON();
 const region={x:45,y:20,width:10,height:10},basis=new AffineTransform();expect(uniformFilterMaskCoverage(mask,region,basis)).toBeUndefined();expect(regionalFilterMask(mask,region,basis).strokes).toHaveLength(1);
});
it('unbounded placed filter strokes remain present in distant native regions',()=>{
 const mask=LayerMask._fromJSON({kind:'paint',base:1,enabled:true,inverted:false,density:1,strokes:[{mode:'hide',stroke:new BrushStroke({points:[{x:32,y:96}],size:12,pressureSize:false}).toJSON(),placement:{width:64,height:48,perspective:{corners:[{x:0,y:0},{x:1,y:0},{x:.75,y:1},{x:.25,y:1}]},basis:{a:1,b:0,c:0,d:1,e:0,f:0}}}]}).toJSON();const region={x:0,y:480000,width:8,height:8},basis=new AffineTransform();expect(uniformFilterMaskCoverage(mask,region,basis)).toBeUndefined();expect(regionalFilterMask(mask,region,basis).strokes).toHaveLength(1);
});
