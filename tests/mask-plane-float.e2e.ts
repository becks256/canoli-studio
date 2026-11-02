import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

for (const initiallyLinked of [true, false]) {
  for (const kind of [
    "paint",
    "selection",
    "vector",
    "bitmap",
    "raster-erasures",
  ]) {
    test(`float ${kind} mask relinking preserves every native HDR and alpha word from ${initiallyLinked ? "linked" : "independent"} coverage`, async ({
      page,
    }, info) => {
      const bytes = [
        ...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif")),
      ];
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const result = await page.evaluate(
        async ({ bytes, kind, initiallyLinked }) => {
          const {
            editor,
            RasterLayer,
            LayerMask,
            BrushStroke,
            EraserStroke,
            VectorPath,
            MarqueeSelection,
            PerspectiveTransform,
            AffineTransform,
            ToneAdjustment,
          } = window.luma;
          const { encodeRgbaPng } = await import(
            /* @vite-ignore */ String("/src/engine/png.ts")
          );
          await editor.openTiff(
            new File([new Uint8Array(bytes)], "Native float original.tif", {
              type: "image/tiff",
            }),
            { editingPrecision: "float32" },
          );
          const doc = editor.document,
            layer = doc.layers.at(0) as InstanceType<typeof RasterLayer>;
          layer.width = 90;
          layer.height = 58;
          layer.transform = new AffineTransform(1, 0.08, 0.12, 1, 12, 5);
          layer.perspective = new PerspectiveTransform({
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.82, y: 1 },
              { x: 0.08, y: 1 },
            ],
          });
          layer.adjustments.add(new ToneAdjustment({ exposure: 2 }));
          const bitmap = await editor.assetStore.add(
            await encodeRgbaPng(
              Uint8Array.from({ length: 17 * 13 * 4 }, (_, i) =>
                i % 4 === 3 ? ((i >> 2) * 19) & 255 : 255,
              ),
              17,
              13,
            ),
            "Independent byte mask",
            undefined,
            false,
          );
          let mask =
            kind === "paint"
              ? new LayerMask({ base: 0.8 })
              : kind === "selection"
                ? new LayerMask({
                    selection: new MarqueeSelection({
                      x: 4,
                      y: 3,
                      width: 65,
                      height: 45,
                      shape: "ellipse",
                    }),
                  })
                : kind === "vector"
                  ? new LayerMask({
                      paths: [
                        new VectorPath({
                          closed: true,
                          points: [
                            { x: 4, y: 2, out: { x: 20, y: 14 } },
                            { x: 70, y: 3 },
                            { x: 60, y: 48 },
                            { x: 3, y: 44 },
                          ],
                        }),
                      ],
                    })
                  : kind === "bitmap"
                    ? LayerMask.fromBitmap(bitmap.id)
                    : new LayerMask({
                        rasterErasures: {
                          width: 90,
                          height: 58,
                          operations: [
                            {
                              width: 90,
                              height: 58,
                              stroke: new EraserStroke({
                                points: [{ x: 22, y: 18 }],
                                size: 18,
                                hardness: 0.3,
                              }),
                            },
                          ],
                        },
                      });
          mask = mask
            .with({
              linked: initiallyLinked,
              x: 2.5,
              y: -1.25,
              placedX: 3.25,
              placedY: -2.5,
              basis: AffineTransform.rotation(0.15).multiply(
                AffineTransform.scale(1.2, 0.9),
              ),
              feather: 2.5,
              density: 0.63,
              inverted: kind === "bitmap",
            })
            .paint(
              new BrushStroke({
                points: [
                  { x: 20, y: 15 },
                  { x: 36, y: 26 },
                ],
                size: 9,
                hardness: 0.4,
              }),
              "hide",
            );
          layer.mask = mask;
          const area = { x: 0, y: 0, width: 131, height: 79 };
          const read = async () => {
            const scene = await editor.renderer.captureFloatScene(
              doc.toJSON(),
              editor.assetStore,
            );
            try {
              return await scene.read(area);
            } finally {
              scene.dispose();
            }
          };
          const difference = (a: Float32Array, b: Float32Array) => {
            const first = new Uint32Array(a.buffer),
              second = new Uint32Array(b.buffer);
            let rgb = 0,
              alpha = 0;
            for (let i = 0; i < first.length; i++)
              if (first[i] !== second[i]) {
                if (i % 4 === 3) alpha++;
                else rgb++;
              }
            return { rgb, alpha };
          };
          const before = doc.toJSON(),
            baseline = await read(),
            past = doc.getSnapshot().past.length;
          layer.setMaskLinked(!initiallyLinked);
          const changed = doc.toJSON(),
            first = difference(baseline, await read()),
            oneUndo = doc.getSnapshot().past.length === past + 1;
          doc.undo();
          const undo = JSON.stringify(before) === JSON.stringify(doc.toJSON()),
            undoPixels = difference(baseline, await read());
          doc.redo();
          const redo = JSON.stringify(changed) === JSON.stringify(doc.toJSON());
          layer.setMaskLinked(initiallyLinked);
          const second = difference(baseline, await read()),
            saved = doc.toJSON(),
            project = await editor.saveProject();
          await editor.openProject(
            new File([project], "float-mask-plane.luma"),
          );
          const reopenedScene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          let reopenedPixels;
          try {
            reopenedPixels = difference(
              baseline,
              await reopenedScene.read(area),
            );
          } finally {
            reopenedScene.dispose();
          }
          const asset = editor.assetStore.get(layer.assetId),
            original = new Uint8Array(await asset.blob.arrayBuffer());
          return {
            precision: doc.precision,
            first,
            second,
            undoPixels,
            reopenedPixels,
            oneUndo,
            undo,
            redo,
            reopened:
              JSON.stringify(saved) ===
              JSON.stringify(editor.document.toJSON()),
            hdr: baseline.some((v, i) => i % 4 !== 3 && v > 1),
            fractionalAlpha: baseline.some(
              (v, i) => i % 4 === 3 && v > 0 && v < 1,
            ),
            sourceExact:
              original.length === bytes.length &&
              original.every((v, i) => v === bytes[i]),
            reference: layer.mask!.plane!.reference,
            native: [asset.width, asset.height],
            display: [asset.bitmap.width, asset.bitmap.height],
          };
        },
        { bytes, kind, initiallyLinked },
      );
      await writeFile(
        info.outputPath("float-mask-plane.json"),
        JSON.stringify(result, null, 2),
      );
      expect(result).toMatchObject({
        precision: "float32",
        first: { rgb: 0, alpha: 0 },
        second: { rgb: 0, alpha: 0 },
        undoPixels: { rgb: 0, alpha: 0 },
        reopenedPixels: { rgb: 0, alpha: 0 },
        oneUndo: true,
        undo: true,
        redo: true,
        reopened: true,
        hdr: true,
        fractionalAlpha: true,
        sourceExact: true,
        native: [131, 79],
      });
      expect(result.display[0]).toBeLessThan(result.native[0]);
    });
  }
}

test("float mask tools are reachable from shortcuts and the command palette alongside editable color painting", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  await page.evaluate(
    async (bytes) => {
      const { editor, LayerMask } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Float tool targets.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const layer = editor.document.layers.at(0)!;
      layer.mask = new LayerMask({ base: 1 });
      editor.document.selectedLayer = layer;
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await expect(
    page.getByRole("button", { name: "Brush tool (B)", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pencil tool (N)", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Text tool (T)", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Vector pen (P)", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("b");
  await expect(
    page.getByRole("combobox", { name: "Paint target", exact: true }),
  ).toHaveValue("layer");
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("mask-hide");
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("mask-reveal");
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("n");
  await expect(
    page.getByRole("button", { name: "Pencil tool (N)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Paint target", exact: true }),
  ).toHaveValue("mask-reveal");
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find a command (Mod+K)", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Search commands", exact: true })
    .fill("Brush");
  await page.getByRole("option", { name: /Tools Brush B/ }).click();
  await expect(
    page.getByRole("button", { name: "Brush tool (B)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Paint target", exact: true }),
  ).toHaveValue("mask-reveal");
  const result = await page.evaluate(() => {
    const { editor } = window.luma,
      before = editor.document.toJSON(),
      past = editor.document.getSnapshot().past.length;
    editor.tools.configure({ paintTarget: "layer" });
    let rejected = "";
    try {
      editor.tools.begin(
        "brush",
        { x: 40, y: 25 },
        { alt: false, shift: false, pressure: 1 },
        1,
      );
    } catch (error) {
      rejected = String(error);
    }
    return {
      rejected,
      unchanged:
        JSON.stringify(before) === JSON.stringify(editor.document.toJSON()),
      historyUnchanged: past === editor.document.getSnapshot().past.length,
      preview: !!editor.tools.getSnapshot().paintPreview,
      chooseBrush: editor.tools.canChooseTool("brush"),
      useColorBrush: editor.tools.canUseTool("brush"),
    };
  });
  expect(result).toMatchObject({
    unchanged: true,
    historyUnchanged: true,
    preview: true,
    chooseBrush: true,
    useColorBrush: true,
  });
  expect(result.rejected).toBe("");
  await page.keyboard.press("Escape");
  await writeFile(
    info.outputPath("float-mask-tool-targets.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const linked of [false, true])
  for (const tool of ["brush", "pen"] as const) {
    test(`float retained ${linked ? "linked" : "independent"} mask ${tool} input preserves native preview, color, partitions and history`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const setup = await page.evaluate(
        async ({ bytes, linked, tool }) => {
          const {
            editor,
            RasterLayer,
            LayerMask,
            VectorPath,
            PerspectiveTransform,
            ToneAdjustment,
          } = window.luma;
          await editor.openTiff(
            new File([new Uint8Array(bytes)], "HDR mask editing.tif", {
              type: "image/tiff",
            }),
            { editingPrecision: "float32" },
          );
          const layer = editor.document.layers.at(0) as InstanceType<
            typeof RasterLayer
          >;
          layer.perspective = new PerspectiveTransform({
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.5, y: 0.5 },
              { x: 0, y: 0.5 },
            ],
          });
          layer.adjustments.add(new ToneAdjustment({ exposure: 2 }));
          layer.mask =
            tool === "brush"
              ? new LayerMask({ base: 1 })
              : new LayerMask({
                  paths: [
                    new VectorPath({
                      closed: true,
                      points: [
                        { x: 30, y: 25, out: { x: 60, y: 50 } },
                        { x: 110, y: 25 },
                        { x: 100, y: 65 },
                        { x: 20, y: 60 },
                      ],
                    }),
                  ],
                });
          layer.setMaskLinked(false);
          if (linked) layer.setMaskLinked(true);
          editor.document.selectedLayer = layer;
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return {
              id: layer.id,
              sourceId: layer.assetId,
              before: editor.document.toJSON(),
              past: editor.document.getSnapshot().past.length,
              baseline: [
                ...new Uint32Array(
                  (await scene.read({ x: 0, y: 0, width: 131, height: 79 }))
                    .buffer,
                ),
              ],
            };
          } finally {
            scene.dispose();
          }
        },
        {
          bytes: [
            ...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif")),
          ],
          linked,
          tool,
        },
      );

      if (tool === "brush") {
        await page
          .getByRole("button", { name: "Brush tool (B)", exact: true })
          .click();
        await page
          .getByRole("combobox", { name: "Paint target", exact: true })
          .selectOption("mask-hide");
        await page.evaluate(() =>
          window.luma.editor.tools.configure({
            size: 13,
            hardness: 0.5,
            opacity: 0.7,
            flow: 0.6,
            pressureSize: false,
            pressureOpacity: false,
          }),
        );
      } else {
        await page
          .getByRole("button", { name: "Vector pen (P)", exact: true })
          .click();
        await page
          .getByRole("combobox", { name: "Pen target", exact: true })
          .selectOption("mask");
      }
      await page.keyboard.press("Control+1");
      let start: { x: number; y: number };
      if (tool === "brush") {
        const box = (await page.locator(".canvas-wrap").boundingBox())!;
        start = {
          x: box.x + box.width / 2 - 131 / 2 + 35,
          y: box.y + box.height / 2 - 79 / 2 + 22,
        };
      } else {
        const anchor = page
          .getByTestId("projective-mask-controls")
          .locator("rect")
          .first();
        await expect(anchor).toBeVisible();
        const box = (await anchor.boundingBox())!;
        start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 7, start.y + 3, { steps: 3 });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(
        await page.evaluate(() => window.luma.editor.document.toJSON()),
      ).toEqual(setup.before);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 7, start.y + 3, { steps: 3 });
      const preview = await page.evaluate(async (tool) => {
        const { editor, Document } = window.luma,
          state = editor.tools.getSnapshot();
        let model = editor.document.toJSON();
        if (tool === "pen") {
          if (!state.preview) throw Error("Missing native Pen preview");
          const detached = Document.fromJSON(model);
          detached._dispatch(state.preview);
          model = detached.toJSON();
        } else {
          if (
            !state.paintPreview?.maskPlacement ||
            !("geometry" in state.paintPreview.maskPlacement)
          )
            throw Error("Missing mapped Brush preview");
          const { previewMask } = await import(
            /* @vite-ignore */ String("/src/engine/renderer.ts")
          );
          model = {
            ...model,
            children: model.children.map((layer) => ({
              ...layer,
              mask: previewMask(layer, state.paintPreview!),
            })),
          };
        }
        const scene = await editor.renderer.captureFloatScene(
          model,
          editor.assetStore,
        );
        try {
          return [
            ...new Uint32Array(
              (await scene.read({ x: 0, y: 0, width: 131, height: 79 })).buffer,
            ),
          ];
        } finally {
          scene.dispose();
        }
      }, tool);
      expect(
        await page.evaluate(() => window.luma.editor.document.toJSON()),
      ).toEqual(setup.before);
      await page.mouse.up();
      const result = await page.evaluate(
        async ({ setup, preview, tool }) => {
          const { editor } = window.luma,
            doc = editor.document,
            layer = doc.getLayer(setup.id)!,
            saved = doc.toJSON();
          const read = async () => {
            const scene = await editor.renderer.captureFloatScene(
              editor.document.toJSON(),
              editor.assetStore,
            );
            try {
              return await scene.read({ x: 0, y: 0, width: 131, height: 79 });
            } finally {
              scene.dispose();
            }
          };
          const after = await read(),
            words = new Uint32Array(after.buffer),
            baseline = new Float32Array(
              Uint32Array.from(setup.baseline).buffer,
            );
          let changed = 0,
            rgbDifferences = 0,
            fractionalAlpha = 0;
          for (let i = 0; i < after.length; i += 4) {
            if (words[i + 3] !== setup.baseline[i + 3]) changed++;
            if (after[i + 3] > 0 && baseline[i + 3] > 0)
              for (let c = 0; c < 3; c++)
                if (words[i + c] !== setup.baseline[i + c]) rgbDifferences++;
            if (
              after[i + 3] > 0 &&
              after[i + 3] < 1 &&
              Math.fround(Math.round(after[i + 3] * 255) / 255) !== after[i + 3]
            )
              fractionalAlpha++;
          }
          const scene = await editor.renderer.captureFloatScene(
            saved,
            editor.assetStore,
          );
          let partitionDifferences = 0;
          try {
            for (let y = 0; y < 79; y += 11)
              for (let x = 0; x < 131; x += 17) {
                const width = Math.min(17, 131 - x),
                  height = Math.min(11, 79 - y),
                  part = new Uint32Array(
                    (await scene.read({ x, y, width, height })).buffer,
                  );
                for (let row = 0; row < height; row++)
                  for (let col = 0; col < width * 4; col++)
                    if (
                      part[row * width * 4 + col] !==
                      words[((y + row) * 131 + x) * 4 + col]
                    )
                      partitionDifferences++;
              }
          } finally {
            scene.dispose();
          }
          const oneUndo = doc.getSnapshot().past.length === setup.past + 1;
          doc.undo();
          const undo =
              JSON.stringify(setup.before) === JSON.stringify(doc.toJSON()),
            undone = new Uint32Array((await read()).buffer);
          const undoPixels = undone.every((v, i) => v === setup.baseline[i]);
          doc.redo();
          const redo = JSON.stringify(saved) === JSON.stringify(doc.toJSON());
          const redone = new Uint32Array((await read()).buffer),
            redoPixels = redone.every((v, i) => v === words[i]);
          const point = tool === "pen" ? layer.mask!.paths[0].points[0] : null;
          const project = await editor.saveProject();
          await editor.openProject(
            new File([project], "float-mask-input.luma"),
          );
          const reopened = new Uint32Array((await read()).buffer),
            original = new Uint8Array(
              await editor.assetStore.get(setup.sourceId).blob.arrayBuffer(),
            );
          return {
            previewExact: words.every((v, i) => v === preview[i]),
            changed,
            rgbDifferences,
            fractionalAlpha,
            partitionDifferences,
            oneUndo,
            undo,
            undoPixels,
            redo,
            redoPixels,
            reopenedModel:
              JSON.stringify(saved) ===
              JSON.stringify(editor.document.toJSON()),
            reopenedPixels: reopened.every((v, i) => v === words[i]),
            original: [...original],
            hdr: after.some((v, i) => i % 4 !== 3 && v > 1),
            point,
            nativeWords: [...words],
            reopenedWords: [...reopened],
          };
        },
        { setup, preview, tool },
      );
      const original = [
        ...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif")),
      ];
      expect(result.original).toEqual(original);
      for (const [name, words] of Object.entries({
        before: setup.baseline,
        preview,
        committed: result.nativeWords,
        reopened: result.reopenedWords,
      }))
        await writeFile(
          info.outputPath(`float-mask-${name}.rgba32f`),
          Buffer.from(Uint32Array.from(words).buffer),
        );
      const { nativeWords, reopenedWords, ...report } = result;
      await writeFile(
        info.outputPath("float-mask-input.json"),
        JSON.stringify(
          {
            ...report,
            original: { bytes: original.length, exact: true },
            nativeSamples: nativeWords.length,
            reopenedSamples: reopenedWords.length,
          },
          null,
          2,
        ),
      );
      expect(result).toMatchObject({
        previewExact: true,
        rgbDifferences: 0,
        partitionDifferences: 0,
        oneUndo: true,
        undo: true,
        undoPixels: true,
        redo: true,
        redoPixels: true,
        reopenedModel: true,
        reopenedPixels: true,
        hdr: true,
      });
      expect(result.changed).toBeGreaterThan(0);
      expect(result.fractionalAlpha).toBeGreaterThan(0);
      if (tool === "pen") {
        const q = { x: 30 / (1 + 25 / 79) + 7, y: 25 / (1 + 25 / 79) + 3 },
          scale = 1 - q.y / 79;
        expect(result.point!.x).toBeCloseTo(q.x / scale, 3);
        expect(result.point!.y).toBeCloseTo(q.y / scale, 3);
      }
    });
  }
