import { expect, it } from "vitest";
import { createGroup, createText, createRaster } from "../src/core/model";
import { emptyLayerFilter, filterLayers } from "../src/ui/layer-filter";
it("combines predicates and retains only ancestors of matches", () => {
  const group = createGroup("Collection");
  group.visible = false;
  group.locked = true;
  const title = createText("Blue label", "Hello");
  const photo = createRaster("Blue photo", "asset", 10, 10);
  group.children = [title, photo];
  const sibling = createText("Blue label outside", "Other");
  const before = structuredClone([group, sibling]);
  const found = filterLayers([group, sibling], {
    query: "LABEL blue",
    kind: "text",
    visibility: "hidden",
    lock: "locked",
  });
  expect([...found.matches]).toEqual([title.id]);
  expect(found.included).toEqual(new Set([title.id, group.id]));
  expect([group, sibling]).toEqual(before);
  expect(
    filterLayers([group, sibling], {
      ...emptyLayerFilter,
      visibility: "visible",
    }).matches,
  ).toEqual(new Set([sibling.id]));
  expect(filterLayers([group, sibling], emptyLayerFilter).matches.size).toBe(4);
});
