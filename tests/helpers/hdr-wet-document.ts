import { encodeFloatWetTile } from "../../src/core/float-wet-tile";
import type { EditorApplication } from "../../src/editor";
import { RasterLayer } from "../../src/dom";

export async function prepareHdrWetDocument(
  editor: EditorApplication,
  bytes: number[],
  file = "rgba-raw-le.tif",
) {
  await editor.openTiff(
    new File([new Uint8Array(bytes)], file, { type: "image/tiff" }),
    { editingPrecision: "float32" },
  );
  const target = editor.document.layers.at(0);
  if (!(target instanceof RasterLayer)) throw new Error("No float target");
  target.name = "HDR target";
  const colors = new Float32Array([4, -2, 8, 0.375, 16, -8, 4, 0.125]),
    removal = new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0.75]);
  const pixels = await encodeFloatWetTile(colors, 2, 1),
    coverage = await encodeFloatWetTile(removal, 2, 1),
    bad = await encodeFloatWetTile(
      new Float32Array([0, 0, 0, 0.125, 0, 0, 0, 0.75]),
      2,
      1,
    );
  for (const [name, blob] of [
    ["HDR wet output", pixels],
    ["HDR wet coverage", coverage],
    ["HDR wet invalid coverage", bad],
  ] as const) {
    const asset = await editor.assetStore.add(
        blob,
        name + ".tif",
        undefined,
        false,
        { tiff: { editingPrecision: "float32" } },
      ),
      layer = editor.document.layers.add(
        new RasterLayer({ name, assetId: asset.id, width: 2, height: 1 }),
      );
    layer.visible = false;
  }
  editor.document.selectedLayer = target;
  const output = [...editor.document.layers].find(
      (layer) => layer.name === "HDR wet output",
    ) as RasterLayer,
    mask = [...editor.document.layers].find(
      (layer) => layer.name === "HDR wet coverage",
    ) as RasterLayer;
  return {
    target,
    colors,
    removal,
    pixels,
    coverage,
    tile: {
      x: 3,
      y: 4,
      width: 2,
      height: 1,
      assetId: output.assetId,
      coverage: { assetId: mask.assetId },
    },
  };
}
