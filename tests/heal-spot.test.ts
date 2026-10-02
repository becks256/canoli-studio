import { expect, it } from "vitest";
import { Document, LayerGroup, TextLayer } from "../src/dom";
import { createAdjustmentLayer } from "../src/core/model";

it("healing validates attached targets, parent locks and geometry before host work", async () => {
  const document = new Document(),
    group = document.layers.add(new LayerGroup());
  const layer = group.layers.add(new TextLayer({ text: "Target" }));
  let calls = 0;
  document._prepareHeal = async () => {
    calls++;
    return createAdjustmentLayer("Prepared", {
      kind: "patch",
      assetId: "prepared",
      width: 5,
      height: 5,
    });
  };
  await expect(new TextLayer().healSpot({ x: 1, y: 1 }, 2)).rejects.toThrow(
    "attached",
  );
  group.locked = true;
  await expect(layer.healSpot({ x: 1, y: 1 }, 2)).rejects.toThrow("unlocked");
  group.locked = false;
  const before = document.toJSON();
  for (const radius of [0, -1, NaN, Infinity, 1025])
    await expect(layer.healSpot({ x: 1, y: 1 }, radius)).rejects.toThrow();
  await expect(layer.healSpot({ x: Infinity, y: 1 }, 2)).rejects.toThrow();
  await expect(
    layer.healSpot({ x: 1, y: 1 }, 2, { searchRadius: 0 }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  expect(document.toJSON()).toEqual(before);
});

it("healing captures options and rejects intervening edits before attaching its result", async () => {
  const document = new Document(),
    layer = document.layers.add(new TextLayer());
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  let captured: unknown;
  document._prepareHeal = async (request) => {
    captured = request;
    await gate;
    return createAdjustmentLayer("Prepared", {
      kind: "patch",
      assetId: "prepared",
      width: 5,
      height: 5,
    });
  };
  const center = { x: 4, y: 5 },
    options = { hardness: 1 };
  const work = layer.healSpot(center, 3, options);
  center.x = 99;
  options.hardness = 0;
  document.name = "Intervening edit";
  const before = document.toJSON();
  finish();
  await expect(work).rejects.toThrow("Document changed");
  expect(captured).toMatchObject({
    center: { x: 4, y: 5 },
    radius: 3,
    options: { hardness: 1 },
  });
  expect(document.toJSON()).toEqual(before);
});
