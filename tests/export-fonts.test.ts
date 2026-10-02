import { expect, it } from "vitest";
import { Document, TextLayer, LayerGroup } from "../src/dom";
import { exportFontFamilies } from "../src/ui/font-availability";
it("collects unique visible families from groups while excluding hidden ancestors", () => {
  const doc = new Document();
  doc.layers.add(new TextLayer({ fontFamily: "serif" }));
  const visible = doc.layers.add(new LayerGroup());
  visible.layers.add(new TextLayer({ fontFamily: "Custom" }));
  visible.layers.add(new TextLayer({ fontFamily: "serif" }));
  const hidden = doc.layers.add(new LayerGroup({ visible: false }));
  hidden.layers.add(new TextLayer({ fontFamily: "Hidden" }));
  doc.layers.add(new TextLayer({ fontFamily: "Invisible", opacity: 0 }));
  expect(exportFontFamilies(doc.toJSON())).toEqual(["Custom", "serif"]);
});
