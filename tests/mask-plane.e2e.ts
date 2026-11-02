import { test, expect } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";

for (const kind of [
  "paint",
  "selection",
  "vector",
  "bitmap",
  "raster-erasures",
])
  test(`perspective ${kind} mask unlink/relink preserves every pixel, original grid and one Undo`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (kind) => {
      const {
        editor,
        Document,
        RasterLayer,
        LayerGroup,
        LayerMask,
        BrushStroke,
        EraserStroke,
        VectorPath,
        MarqueeSelection,
        PerspectiveTransform,
        AffineTransform,
      } = window.luma;
      const { encodeRgbaPng } = await import(
        /* @vite-ignore */ String("/src/engine/png.ts")
      );
      const pixels = Uint8Array.from({ length: 31 * 23 * 4 }, (_, i) =>
          i % 4 === 3 ? [63, 127, 255][(i >> 2) % 3] : (i * 17) & 255,
        ),
        asset = await editor.assetStore.add(
          await encodeRgbaPng(pixels, 31, 23),
          "Retained original",
          undefined,
          false,
        );
      const maskPixels = Uint8Array.from({ length: 17 * 13 * 4 }, (_, i) =>
          i % 4 === 3 ? ((i >> 2) * 19) & 255 : 255,
        ),
        bitmap = await editor.assetStore.add(
          await encodeRgbaPng(maskPixels, 17, 13),
          "Independent mask",
          undefined,
          false,
        );
      const doc = new Document({ width: 140, height: 110 }),
        group = doc.layers.add(new LayerGroup()),
        layer = group.layers.add(
          new RasterLayer({ assetId: asset.id, width: 62, height: 46 }),
        );
      group.transform = new AffineTransform(1.15, 0.2, 0.3, -0.9, 35, 80);
      layer.perspective = new PerspectiveTransform({
        corners: [
          { x: 0.1, y: 0 },
          { x: 0.95, y: 0.05 },
          { x: 0.85, y: 1 },
          { x: 0, y: 0.85 },
        ],
      });
      let mask =
        kind === "paint"
          ? new LayerMask({ base: 0.8 })
          : kind === "selection"
            ? new LayerMask({
                selection: new MarqueeSelection({
                  x: 5,
                  y: 3,
                  width: 25,
                  height: 22,
                  shape: "ellipse",
                }),
              })
            : kind === "vector"
              ? new LayerMask({
                  paths: [
                    new VectorPath({
                      closed: true,
                      points: [
                        { x: 4, y: 2 },
                        { x: 35, y: 3 },
                        { x: 22, y: 30 },
                        { x: 3, y: 20 },
                      ],
                    }),
                  ],
                })
              : kind === "bitmap"
                ? LayerMask.fromBitmap(bitmap.id)
                : new LayerMask({
                    rasterErasures: {
                      width: 28,
                      height: 20,
                      operations: [
                        {
                          width: 28,
                          height: 20,
                          stroke: new EraserStroke({
                            points: [{ x: 12, y: 9 }],
                            size: 8,
                            hardness: 0.35,
                          }),
                        },
                      ],
                    },
                  });
      mask = mask
        .with({
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
              { x: 12, y: 8 },
              { x: 18, y: 12 },
            ],
            size: 7,
            hardness: 0.4,
          }),
          "hide",
        );
      layer.mask = mask;
      const render = async () => {
        const canvas = await editor.renderer.render(
          doc.toJSON(),
          editor.assetStore,
          { cache: false, readback: true },
        );
        try {
          return canvas.getContext("2d")!.getImageData(0, 0, 140, 110).data;
        } finally {
          canvas.width = canvas.height = 0;
        }
      };
      const different = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let count = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
        return count;
      };
      const before = doc.toJSON(),
        rgba = await render(),
        past = doc.getSnapshot().past.length;
      layer.setMaskLinked(false);
      const unlinked = doc.toJSON(),
        after = await render(),
        unlinkedDiff = different(rgba, after),
        oneUndo = doc.getSnapshot().past.length === past + 1;
      doc.undo();
      const undo = JSON.stringify(doc.toJSON()) === JSON.stringify(before),
        undoPixels = different(rgba, await render());
      doc.redo();
      const redo = JSON.stringify(doc.toJSON()) === JSON.stringify(unlinked),
        redoPixels = different(after, await render());
      layer.setMaskLinked(true);
      const linkedDiff = different(rgba, await render()),
        plane = layer.mask!.plane!.toJSON();
      return {
        unlinkedDiff,
        linkedDiff,
        oneUndo,
        undo,
        redo,
        undoPixels,
        redoPixels,
        reference: plane.reference,
        phase: plane.phase,
        steps: plane.steps.length,
        sourceExact: asset.blob === editor.assetStore.get(asset.id).blob,
        sourceSize: [asset.width, asset.height],
        rgbaSha256: [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", rgba)),
        ]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
      };
    }, kind);
    await writeFile(
      info.outputPath("mask-plane-parity.json"),
      JSON.stringify({ kind, ...result }, null, 2),
    );
    expect(result).toMatchObject({
      unlinkedDiff: 0,
      linkedDiff: 0,
      oneUndo: true,
      undo: true,
      redo: true,
      undoPixels: 0,
      redoPixels: 0,
      phase: "document",
      sourceExact: true,
      sourceSize: [31, 23],
    });
    expect(result.reference.kind).toBe("asset");
  });

for (const initialLinked of [false, true])
  for (const kind of [
    "paint",
    "selection",
    "vector",
    "bitmap",
    "raster-erasures",
  ])
    test(`perspective ${kind} filter-mask relinking retains ${initialLinked ? "native" : "document"} mixing phase and exact pixels`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const result = await page.evaluate(
        async ({ kind, initialLinked }) => {
          const {
            editor,
            Document,
            RasterLayer,
            LayerGroup,
            LayerMask,
            BrushStroke,
            EraserStroke,
            VectorPath,
            MarqueeSelection,
            PerspectiveTransform,
            AffineTransform,
            SmartToneFilter,
          } = window.luma;
          const { encodeRgbaPng } = await import(
            /* @vite-ignore */ String("/src/engine/png.ts")
          );
          const pixels = Uint8Array.from({ length: 31 * 23 * 4 }, (_, i) =>
              i % 4 === 3 ? [63, 127, 255][(i >> 2) % 3] : (i * 17) & 255,
            ),
            asset = await editor.assetStore.add(
              await encodeRgbaPng(pixels, 31, 23),
              "Native filter original",
              undefined,
              false,
            );
          const maskPixels = Uint8Array.from({ length: 17 * 13 * 4 }, (_, i) =>
              i % 4 === 3 ? ((i >> 2) * 19) & 255 : 255,
            ),
            bitmap = await editor.assetStore.add(
              await encodeRgbaPng(maskPixels, 17, 13),
              "Independent filter mask",
              undefined,
              false,
            );
          const master = new Document({ width: 31, height: 23 });
          master.layers.add(
            new RasterLayer({ assetId: asset.id, width: 31, height: 23 }),
          );
          const doc = new Document({ width: 140, height: 110 }),
            key = doc.defineComponent(master),
            group = doc.layers.add(new LayerGroup()),
            layer = doc.placeSmartObject(key, { width: 62, height: 46 });
          layer.moveTo(group);
          group.transform = new AffineTransform(1.15, 0.2, 0.3, -0.9, 35, 80);
          layer.perspective = new PerspectiveTransform({
            corners: [
              { x: 0.1, y: 0 },
              { x: 0.95, y: 0.05 },
              { x: 0.85, y: 1 },
              { x: 0, y: 0.85 },
            ],
          });
          layer.addFilter(
            new SmartToneFilter({
              exposure: 0.3,
              contrast: 12,
              saturation: -50,
            }),
          );
          let mask =
            kind === "paint"
              ? new LayerMask({ base: 0.8 })
              : kind === "selection"
                ? new LayerMask({
                    selection: new MarqueeSelection({
                      x: 5,
                      y: 3,
                      width: 20,
                      height: 16,
                      shape: "ellipse",
                    }),
                  })
                : kind === "vector"
                  ? new LayerMask({
                      paths: [
                        new VectorPath({
                          closed: true,
                          points: [
                            { x: 4, y: 2 },
                            { x: 25, y: 3 },
                            { x: 22, y: 19 },
                            { x: 3, y: 16 },
                          ],
                        }),
                      ],
                    })
                  : kind === "bitmap"
                    ? LayerMask.fromBitmap(bitmap.id)
                    : new LayerMask({
                        rasterErasures: {
                          width: 28,
                          height: 20,
                          operations: [
                            {
                              width: 28,
                              height: 20,
                              stroke: new EraserStroke({
                                points: [{ x: 12, y: 9 }],
                                size: 8,
                                hardness: 0.35,
                              }),
                            },
                          ],
                        },
                      });
          mask = mask
            .with({
              linked: initialLinked,
              x: initialLinked ? 2.5 : 45,
              y: initialLinked ? -1.25 : 35,
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
                  { x: 12, y: 8 },
                  { x: 18, y: 12 },
                ],
                size: 7,
                hardness: 0.4,
              }),
              "hide",
            );
          layer.filterMask = mask;
          const render = async () => {
            const canvas = await editor.renderer.render(
              doc.toJSON(),
              editor.assetStore,
              { cache: false, readback: true },
            );
            try {
              return canvas.getContext("2d")!.getImageData(0, 0, 140, 110).data;
            } finally {
              canvas.width = canvas.height = 0;
            }
          };
          const different = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
            let count = 0;
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
            return count;
          };
          const before = doc.toJSON(),
            rgba = await render(),
            past = doc.getSnapshot().past.length;
          layer.setFilterMaskLinked(!initialLinked);
          const changed = doc.toJSON(),
            after = await render(),
            firstDiff = different(rgba, after),
            oneUndo = doc.getSnapshot().past.length === past + 1;
          doc.undo();
          const undo = JSON.stringify(doc.toJSON()) === JSON.stringify(before),
            undoPixels = different(rgba, await render());
          doc.redo();
          const redo = JSON.stringify(doc.toJSON()) === JSON.stringify(changed);
          layer.setFilterMaskLinked(initialLinked);
          const secondDiff = different(rgba, await render());
          return {
            firstDiff,
            secondDiff,
            oneUndo,
            undo,
            redo,
            undoPixels,
            phase: layer.filterMask!.plane!.phase,
            sourceExact: asset.blob === editor.assetStore.get(asset.id).blob,
          };
        },
        { kind, initialLinked },
      );
      await writeFile(
        info.outputPath("filter-plane-parity.json"),
        JSON.stringify({ kind, initialLinked, ...result }, null, 2),
      );
      expect(result).toMatchObject({
        firstDiff: 0,
        secondDiff: 0,
        oneUndo: true,
        undo: true,
        redo: true,
        undoPixels: 0,
        phase: initialLinked ? "native" : "document",
        sourceExact: true,
      });
    });

for (const filter of [false, true])
  for (const linked of [false, true])
    test(`retained ${filter ? "filter" : "ordinary"} ${linked ? "linked" : "unlinked"} mask brush pointer preserves preview, native edits and cancellation`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const setup = await page.evaluate(
        async ({ filter, linked }) => {
          const {
            editor,
            RasterLayer,
            LayerGroup,
            LayerMask,
            PerspectiveTransform,
            AffineTransform,
            SmartToneFilter,
            MarqueeSelection,
          } = window.luma;
          editor.newDocument({ width: 400, height: 300 });
          const canvas = new OffscreenCanvas(96, 72),
            c = canvas.getContext("2d")!;
          c.fillStyle = "#e81428";
          c.fillRect(0, 0, 96, 72);
          c.fillStyle = "#154cff";
          c.fillRect(20, 12, 58, 40);
          const asset = await editor.assetStore.add(
              await canvas.convertToBlob(),
              "Retained brush original",
              undefined,
              false,
            ),
            group = editor.document.layers.add(new LayerGroup());
          group.transform = new AffineTransform(1, 0.12, 0.16, 1, 100, 60);
          const raster = group.layers.add(
              new RasterLayer({
                assetId: asset.id,
                width: 96,
                height: 72,
                perspective: new PerspectiveTransform({
                  corners: [
                    { x: 0.1, y: 0.05 },
                    { x: 1.1, y: 0.15 },
                    { x: 0.95, y: 1.15 },
                    { x: -0.1, y: 0.85 },
                  ],
                }),
              }),
            ),
            layer = filter ? raster.convertToSmartObject() : raster;
          if (layer instanceof window.luma.SmartObjectLayer) {
            layer.width = 144;
            layer.height = 108;
            layer.addFilter(new SmartToneFilter({ saturation: -100 }));
            layer.filterMask = new LayerMask({
              base: 1,
              x: 4,
              y: -2,
              basis: AffineTransform.rotation(0.17),
            });
            layer.setFilterMaskLinked(false);
            if (linked) layer.setFilterMaskLinked(true);
          } else {
            layer.mask = new LayerMask({
              base: 1,
              x: 4,
              y: -2,
              basis: AffineTransform.rotation(0.17),
            });
            layer.setMaskLinked(false);
            if (linked) layer.setMaskLinked(true);
          }
          editor.document.selectedLayer = layer;
          const local = { x: filter ? 84 : 45, y: filter ? 50 : 31 },
            point = group.transform.point(local);
          editor.document.selection = new MarqueeSelection({
            x: point.x - 9,
            y: point.y - 20,
            width: 35,
            height: 40,
            shape: "ellipse",
          });
          return {
            point,
            authorPoint: linked ? local : point,
            before: editor.document.toJSON(),
            past: editor.document.getSnapshot().past.length,
            id: layer.id,
            sourceId: asset.id,
            sourceBytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
          };
        },
        { filter, linked },
      );
      await page
        .getByRole("button", { name: "Brush tool (B)", exact: true })
        .click();
      await page.keyboard.press("Control+1");
      await page
        .getByRole("combobox", { name: "Paint target", exact: true })
        .selectOption(filter ? "filter-mask-hide" : "mask-hide");
      await page.evaluate(() =>
        window.luma.editor.tools.configure({
          size: 23,
          hardness: 0.5,
          opacity: 0.7,
          flow: 0.6,
          pressureSize: false,
          pressureOpacity: false,
          tip: { roundness: 0.6, angle: 17 },
        }),
      );
      const baselinePixels = await page.evaluate(async () => {
        const { editor } = window.luma,
          canvas = await editor.renderer.render(
            editor.document.toJSON(),
            editor.assetStore,
            { cache: false, readback: true },
          );
        try {
          return [
            ...canvas.getContext("2d")!.getImageData(0, 0, 400, 300).data,
          ];
        } finally {
          canvas.width = canvas.height = 0;
        }
      });
      const box = (await page.locator(".canvas-wrap").boundingBox())!,
        at = {
          x: box.x + box.width / 2 - 200 + setup.point.x,
          y: box.y + box.height / 2 - 150 + setup.point.y,
        };
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      const preview = await page.evaluate(async () => {
        const { editor } = window.luma,
          preview = editor.tools.getSnapshot().paintPreview;
        if (!preview?.maskPlacement || !("geometry" in preview.maskPlacement))
          throw Error("Missing retained mask preview");
        const canvas = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache: false, readback: true, paintPreview: preview },
        );
        try {
          return {
            pixels: [
              ...canvas.getContext("2d")!.getImageData(0, 0, 400, 300).data,
            ],
          };
        } finally {
          canvas.width = canvas.height = 0;
        }
      });
      await page.mouse.up();
      const result = await page.evaluate(
        async ({ filter, setup, preview, baselinePixels }) => {
          const { editor } = window.luma,
            layer = editor.document.getLayer(setup.id)!,
            mask = filter
              ? (layer as InstanceType<typeof window.luma.SmartObjectLayer>)
                  .filterMask
              : layer.mask,
            entry = mask!.toJSON().strokes![0];
          const canvas = await editor.renderer.render(
            editor.document.toJSON(),
            editor.assetStore,
            { cache: false, readback: true },
          );
          let exact, changed;
          try {
            const pixels = [
              ...canvas.getContext("2d")!.getImageData(0, 0, 400, 300).data,
            ];
            exact = pixels.every((v, i) => v === preview.pixels[i]);
            changed = pixels.some((v, i) => v !== baselinePixels[i]);
          } finally {
            canvas.width = canvas.height = 0;
          }
          const oneUndo =
              editor.document.getSnapshot().past.length === setup.past + 1,
            saved = editor.document.toJSON();
          editor.document.undo();
          const undo =
            JSON.stringify(editor.document.toJSON()) ===
            JSON.stringify(setup.before);
          editor.document.redo();
          const redo =
            JSON.stringify(editor.document.toJSON()) === JSON.stringify(saved);
          const project = await editor.saveProject();
          await editor.openProject(new File([project], "retained-mask.luma"));
          const reopened =
              JSON.stringify(saved) ===
              JSON.stringify(editor.document.toJSON()),
            sourceExact = new Uint8Array(
              await editor.assetStore.get(setup.sourceId).blob.arrayBuffer(),
            ).every((v, i) => v === setup.sourceBytes[i]);
          editor.document.undo();
          return {
            exact,
            changed,
            oneUndo,
            undo,
            redo,
            reopened,
            sourceExact,
            point: entry.stroke.kind === "wet" ? null : entry.stroke.points[0],
            placement: entry.mode === "wet" ? null : entry.placement,
          };
        },
        { filter, setup, preview, baselinePixels },
      );
      expect(result).toMatchObject({
        exact: true,
        changed: true,
        oneUndo: true,
        undo: true,
        redo: true,
        reopened: true,
        sourceExact: true,
      });
      expect(result.point!.x).toBeCloseTo(setup.authorPoint.x, 3);
      expect(result.point!.y).toBeCloseTo(setup.authorPoint.y, 3);
      await writeFile(
        info.outputPath("retained-brush-pointer.json"),
        JSON.stringify(result, null, 2),
      );
      // A new gesture is discarded synchronously when the ordered selection changes.
      await page.evaluate(
        ({ id, filter }) => {
          const { editor } = window.luma;
          editor.document.selectedLayer = editor.document.getLayer(id)!;
          editor.tools.configure({
            paintTarget: filter ? "filter-mask-hide" : "mask-hide",
          });
        },
        { id: setup.id, filter },
      );
      await page
        .getByRole("combobox", { name: "Paint target", exact: true })
        .selectOption(filter ? "filter-mask-hide" : "mask-hide");
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.evaluate((id) => {
        const { editor } = window.luma,
          layer = editor.document.getLayer(id)!;
        editor.document.selectedLayer = null;
        editor.document.selectedLayer = layer;
      }, setup.id);
      expect(
        await page.evaluate(
          () => window.luma.editor.tools.getSnapshot().paintPreview,
        ),
      ).toBeNull();
      await page.mouse.up();
    });

for (const filter of [false, true])
  for (const linked of [false, true])
    test(`retained ${filter ? "filter" : "ordinary"} ${linked ? "linked" : "unlinked"} mask Mixer transports complete fields, private previews and one Undo`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const setup = await page.evaluate(
        async ({ filter, linked }) => {
          const {
            editor,
            RasterLayer,
            LayerMask,
            PerspectiveTransform,
            AffineTransform,
            SmartToneFilter,
          } = window.luma;
          editor.newDocument({ width: 220, height: 160 });
          const canvas = new OffscreenCanvas(96, 72),
            c = canvas.getContext("2d")!;
          c.fillStyle = "#e81428";
          c.fillRect(0, 0, 96, 72);
          const asset = await editor.assetStore.add(
              await canvas.convertToBlob(),
              "Retained wet original",
              undefined,
              false,
            ),
            raster = editor.document.layers.add(
              new RasterLayer({
                assetId: asset.id,
                width: 96,
                height: 72,
                x: 40,
                y: 30,
              }),
            ),
            layer = filter ? raster.convertToSmartObject() : raster;
          layer.transform = new AffineTransform(1, 0.12, 0.16, 1, 40, 30);
          layer.perspective = new PerspectiveTransform({
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.9, y: 1 },
              { x: 0.05, y: 1 },
            ],
          });
          if (layer instanceof window.luma.SmartObjectLayer) {
            layer.addFilter(new SmartToneFilter({ saturation: -100 }));
            layer.filterMask = new LayerMask({
              base: 1,
              x: 3,
              y: -2,
              basis: AffineTransform.rotation(0.1),
            });
            layer.setFilterMaskLinked(false);
            if (linked) layer.setFilterMaskLinked(true);
          } else {
            layer.mask = new LayerMask({
              base: 1,
              x: 3,
              y: -2,
              basis: AffineTransform.rotation(0.1),
            });
            layer.setMaskLinked(false);
            if (linked) layer.setMaskLinked(true);
          }
          editor.document.selectedLayer = layer;
          const local = { x: 45, y: 32 },
            point = {
              x: local.x + 0.16 * local.y + 40,
              y: 0.12 * local.x + local.y + 30,
            };
          return {
            id: layer.id,
            point,
            author: linked ? local : point,
            before: editor.document.toJSON(),
            past: editor.document.getSnapshot().past.length,
            assetId: asset.id,
            original: [...new Uint8Array(await asset.blob.arrayBuffer())],
          };
        },
        { filter, linked },
      );
      await page
        .getByRole("button", { name: "Mixer brush", exact: true })
        .click();
      await page.keyboard.press("Control+1");
      await page
        .getByRole("combobox", { name: "Paint target", exact: true })
        .selectOption(filter ? "filter-mask-hide" : "mask-hide");
      await page.evaluate(() =>
        window.luma.editor.tools.configure({
          size: 12,
          hardness: 0.5,
          opacity: 0.7,
          flow: 0.8,
          pressureSize: false,
          pressureOpacity: false,
          mixer: { load: 1, wetness: 0, pickup: 0 },
        }),
      );
      const box = (await page.locator(".canvas-wrap").boundingBox())!,
        at = {
          x: box.x + box.width / 2 - 110 + setup.point.x,
          y: box.y + box.height / 2 - 80 + setup.point.y,
        };
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 10, at.y + 2, { steps: 3 });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.luma.editor.tools.getSnapshot().wetPreview?.operation.brush
                .points.length ?? 0,
          ),
        )
        .toBeGreaterThanOrEqual(4);
      const preview = await page.evaluate(async () => {
        const { editor } = window.luma,
          frame = editor.tools.getSnapshot().wetPreview!,
          release = frame.retain();
        try {
          const canvas = await editor.renderer.render(
              frame.document,
              frame.assets,
              { cache: false, readback: true },
            ),
            before = await editor.renderer.render(
              editor.document.toJSON(),
              editor.assetStore,
              { cache: false, readback: true },
            );
          try {
            const pixels = [
                ...canvas.getContext("2d")!.getImageData(0, 0, 220, 160).data,
              ],
              baseline = before
                .getContext("2d")!
                .getImageData(0, 0, 220, 160).data;
            return {
              pixels,
              changed: pixels.some((v, i) => v !== baseline[i]),
              operation: frame.operation.toJSON(),
            };
          } finally {
            canvas.width = canvas.height = before.width = before.height = 0;
          }
        } finally {
          release();
        }
      });
      await page.mouse.up();
      await expect
        .poll(() =>
          page.evaluate(() => window.luma.editor.tools.getSnapshot().drawing),
        )
        .toBe(false);
      const result = await page.evaluate(
        async ({ setup, preview }) => {
          const { editor } = window.luma,
            doc = editor.document,
            saved = doc.toJSON(),
            canvas = await editor.renderer.render(saved, editor.assetStore, {
              cache: false,
              readback: true,
            });
          let exact;
          try {
            exact = [
              ...canvas.getContext("2d")!.getImageData(0, 0, 220, 160).data,
            ].every((v, i) => v === preview.pixels[i]);
          } finally {
            canvas.width = canvas.height = 0;
          }
          const oneUndo = doc.getSnapshot().past.length === setup.past + 1;
          doc.undo();
          const undo =
            JSON.stringify(setup.before) === JSON.stringify(doc.toJSON());
          doc.redo();
          const redo = JSON.stringify(saved) === JSON.stringify(doc.toJSON());
          const project = await editor.saveProject();
          await editor.openProject(new File([project], "retained-wet.luma"));
          return {
            exact,
            oneUndo,
            undo,
            redo,
            reopened:
              JSON.stringify(saved) ===
              JSON.stringify(editor.document.toJSON()),
            sourceExact: new Uint8Array(
              await editor.assetStore.get(setup.assetId).blob.arrayBuffer(),
            ).every((v, i) => v === setup.original[i]),
          };
        },
        { setup, preview },
      );
      expect(preview.changed).toBe(true);
      expect(preview.operation.placement).toHaveProperty("geometry");
      expect(preview.operation.brush.points[0].x).toBeCloseTo(
        setup.author.x,
        3,
      );
      expect(preview.operation.brush.points[0].y).toBeCloseTo(
        setup.author.y,
        3,
      );
      expect(result).toMatchObject({
        exact: true,
        oneUndo: true,
        undo: true,
        redo: true,
        reopened: true,
        sourceExact: true,
      });
      await writeFile(
        info.outputPath("retained-mixer.json"),
        JSON.stringify(
          {
            setup: { point: setup.point, author: setup.author },
            operation: preview.operation,
            ...result,
          },
          null,
          2,
        ),
      );
    });

for (const kind of ["selection", "paths"] as const)
  test(`projected mask capture retains document ${kind} geometry and exact current coverage`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (kind) => {
      const {
        editor,
        RasterLayer,
        LayerMask,
        VectorLayer,
        VectorPath,
        MarqueeSelection,
        PerspectiveTransform,
        AffineTransform,
      } = window.luma;
      editor.newDocument({ width: 160, height: 120 });
      const canvas = new OffscreenCanvas(100, 80),
        c = canvas.getContext("2d")!;
      c.fillStyle = "#f04020";
      c.fillRect(0, 0, 100, 80);
      const asset = await editor.assetStore.add(
          await canvas.convertToBlob(),
          "Capture original",
          undefined,
          false,
        ),
        layer = editor.document.layers.add(
          new RasterLayer({
            assetId: asset.id,
            width: 100,
            height: 80,
            x: 25,
            y: 20,
            perspective: new PerspectiveTransform({
              corners: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0.7, y: 1 },
                { x: 0.1, y: 1 },
              ],
            }),
          }),
        );
      const selection = new MarqueeSelection({
          x: 45,
          y: 35,
          width: 55,
          height: 40,
          shape: "ellipse",
        }),
        source = editor.document.layers.add(new VectorLayer());
      source.paths.add(
        new VectorPath({
          closed: true,
          points: [
            { x: 0, y: 0, out: { x: 40, y: -15 } },
            { x: 50, y: 10, in: { x: 35, y: 10 } },
            { x: 40, y: 45 },
            { x: 0, y: 35 },
          ],
        }),
      );
      source.transform = new AffineTransform(1, 0.2, 0.1, 1, 45, 30);
      source.visible = false;
      layer.mask =
        kind === "selection"
          ? new LayerMask({ linked: false, selection })
          : new LayerMask({
              linked: false,
              paths: [...source.paths],
              x: source.x,
              y: source.y,
              basis: new AffineTransform(
                source.transform.a,
                source.transform.b,
                source.transform.c,
                source.transform.d,
              ),
            });
      const sample = async () => {
        const out = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache: false, readback: true },
        );
        try {
          return [...out.getContext("2d")!.getImageData(0, 0, 160, 120).data];
        } finally {
          out.width = out.height = 0;
        }
      };
      const before = editor.document.toJSON(),
        pixels = await sample(),
        past = editor.document.getSnapshot().past.length;
      if (kind === "selection") layer.maskFromSelection(selection);
      else layer.maskFromPaths(source);
      const saved = editor.document.toJSON(),
        after = await sample(),
        oneUndo = editor.document.getSnapshot().past.length === past + 1,
        geometryExact =
          kind === "selection"
            ? JSON.stringify(layer.mask!.selection!.toJSON()) ===
              JSON.stringify(selection.toJSON())
            : JSON.stringify(layer.mask!.paths[0].points) ===
              JSON.stringify(source.paths.at(0)!.points);
      editor.document.undo();
      const undo =
        JSON.stringify(before) === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      return {
        pixelsExact: pixels.every((v, i) => v === after[i]),
        geometryExact,
        oneUndo,
        undo,
        redo:
          JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()),
        linked: layer.mask!.linked,
        reference: layer.mask!.plane!.reference,
      };
    }, kind);
    expect(result).toMatchObject({
      pixelsExact: true,
      geometryExact: true,
      oneUndo: true,
      undo: true,
      redo: true,
      linked: true,
      reference: { width: 1, height: 1 },
    });
    await writeFile(
      info.outputPath("retained-capture.json"),
      JSON.stringify(result, null, 2),
    );
  });

test("retained plane on a genuine 50 MP mask preserves source bytes, native sampling and one Undo", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  await page
    .getByTestId("import-input")
    .setInputFiles("tests/fixtures/matting/native-50mp.png");
  await page.waitForFunction(() =>
    window.luma.editor.assetStore
      .values()
      .some((a) => a.width === 10000 && a.height === 5000),
  );
  const result = await page.evaluate(async () => {
    const {
        editor,
        RasterLayer,
        LayerMask,
        BrushStroke,
        PerspectiveTransform,
      } = window.luma,
      layer = editor.document.layers.at(0) as InstanceType<typeof RasterLayer>,
      asset = editor.assetStore.get(layer.assetId);
    layer.perspective = new PerspectiveTransform({
      corners: [
        { x: 0.0001, y: 0 },
        { x: 1.0001, y: 0 },
        { x: 1.0001, y: 1 },
        { x: 0.0001, y: 1 },
      ],
    });
    layer.mask = new LayerMask({ base: 1 });
    const sample = async () => {
      const out = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        {
          region: { x: 8997, y: 3996, width: 10, height: 10 },
          cache: false,
          readback: true,
        },
      );
      try {
        return [...out.getContext("2d")!.getImageData(0, 0, 10, 10).data];
      } finally {
        out.width = out.height = 0;
      }
    };
    const before = await sample();
    layer.setMaskLinked(false);
    const unlinked = await sample(),
      model = editor.document.toJSON(),
      past = editor.document.getSnapshot().past.length;
    layer.paintMask(
      new BrushStroke({
        points: [{ x: 9001.5, y: 4000.5 }],
        size: 3,
        hardness: 1,
        pressureSize: false,
        opacity: 0.5,
      }),
      "hide",
      { space: "placed" },
    );
    const after = await sample(),
      saved = editor.document.toJSON(),
      oneUndo = editor.document.getSnapshot().past.length === past + 1;
    editor.document.undo();
    const undo =
      JSON.stringify(model) === JSON.stringify(editor.document.toJSON());
    editor.document.redo();
    const sha = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await asset.blob.arrayBuffer()),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    return {
      unlinkExact: before.every((v, i) => v === unlinked[i]),
      changed: after.some((v, i) => v !== before[i]),
      alphaBefore: before[(4 * 10 + 4) * 4 + 3],
      alphaAfter: after[(4 * 10 + 4) * 4 + 3],
      oneUndo,
      undo,
      redo: JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()),
      reference: layer.mask!.plane!.reference,
      sha,
      dimensions: [asset.width, asset.height],
    };
  });
  expect(result).toMatchObject({
    unlinkExact: true,
    changed: true,
    alphaBefore: 128,
    alphaAfter: 64,
    oneUndo: true,
    undo: true,
    redo: true,
    reference: { assetId: expect.any(String) },
    sha: "b457af22024ac92524b87f06ada74fd652484835edbaafbb20470a8a9bb3897f",
    dimensions: [10000, 5000],
  });
  await writeFile(
    info.outputPath("retained-mask-50mp.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const linked of [false, true])
  test(`retained ${linked ? "linked" : "unlinked"} mask Pen preserves rational controls, native cubic edits and one Undo`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const setup = await page.evaluate(async (linked) => {
      const {
        editor,
        RasterLayer,
        LayerMask,
        VectorPath,
        PerspectiveTransform,
      } = window.luma;
      editor.newDocument({ width: 260, height: 180 });
      const canvas = new OffscreenCanvas(160, 120),
        c = canvas.getContext("2d")!;
      c.fillStyle = "#e84020";
      c.fillRect(0, 0, 160, 120);
      const asset = await editor.assetStore.add(
          await canvas.convertToBlob(),
          "Retained Pen original",
          undefined,
          false,
        ),
        layer = editor.document.layers.add(
          new RasterLayer({
            assetId: asset.id,
            width: 160,
            height: 120,
            x: 40,
            y: 30,
            perspective: new PerspectiveTransform({
              corners: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0.5, y: 0.5 },
                { x: 0, y: 0.5 },
              ],
            }),
          }),
        );
      layer.mask = new LayerMask({
        paths: [
          new VectorPath({
            closed: true,
            points: [
              { x: 30, y: 25, out: { x: 60, y: 50 } },
              { x: 110, y: 25 },
              { x: 100, y: 90 },
              { x: 20, y: 85 },
            ],
          }),
        ],
      });
      layer.setMaskLinked(false);
      if (linked) layer.setMaskLinked(true);
      editor.document.selectedLayer = layer;
      return {
        id: layer.id,
        before: editor.document.toJSON(),
        past: editor.document.getSnapshot().past.length,
      };
    }, linked);
    await page
      .getByRole("button", { name: "Vector pen (P)", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Pen target", exact: true })
      .selectOption("mask");
    await page.keyboard.press("Control+1");
    const controls = page.getByTestId("projective-mask-controls"),
      anchor = controls.locator("rect").first();
    await expect(anchor).toBeVisible();
    const box = (await anchor.boundingBox())!,
      start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 4, { steps: 3 });
    expect(
      await page.evaluate(() => window.luma.editor.document.toJSON()),
    ).toEqual(setup.before);
    const preview = await page.evaluate(async () => {
      const { editor, Document } = window.luma,
        command = editor.tools.getSnapshot().preview;
      if (!command) throw Error("Missing retained Pen preview");
      const detached = Document.fromJSON(editor.document.toJSON());
      detached._dispatch(command);
      const canvas = await editor.renderer.render(
        detached.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      try {
        return [...canvas.getContext("2d")!.getImageData(0, 0, 260, 180).data];
      } finally {
        canvas.width = canvas.height = 0;
      }
    });
    await page.mouse.up();
    const result = await page.evaluate(
      async ({ setup, preview }) => {
        const { editor } = window.luma,
          doc = editor.document,
          layer = doc.getLayer(setup.id)!,
          point = layer.mask!.paths[0].points[0],
          saved = doc.toJSON(),
          canvas = await editor.renderer.render(saved, editor.assetStore, {
            cache: false,
            readback: true,
          });
        let exact;
        try {
          exact = [
            ...canvas.getContext("2d")!.getImageData(0, 0, 260, 180).data,
          ].every((v, i) => v === preview[i]);
        } finally {
          canvas.width = canvas.height = 0;
        }
        const oneUndo = doc.getSnapshot().past.length === setup.past + 1;
        doc.undo();
        const undo =
          JSON.stringify(setup.before) === JSON.stringify(doc.toJSON());
        doc.redo();
        const q = { x: 30 / (1 + 25 / 120) + 10, y: 25 / (1 + 25 / 120) + 4 },
          scale = 1 - q.y / 120;
        return {
          exact,
          oneUndo,
          undo,
          redo: JSON.stringify(saved) === JSON.stringify(doc.toJSON()),
          point,
          expected: { x: q.x / scale, y: q.y / scale },
        };
      },
      { setup, preview },
    );
    expect(result).toMatchObject({
      exact: true,
      oneUndo: true,
      undo: true,
      redo: true,
    });
    expect(result.point.x).toBeCloseTo(result.expected.x, 3);
    expect(result.point.y).toBeCloseTo(result.expected.y, 3);
    await writeFile(
      info.outputPath("retained-pen.json"),
      JSON.stringify(result, null, 2),
    );
  });

test("documented MaskPlane values and relinking example execute in isolation with one transaction and atomic failure", async ({
  page,
}, info) => {
  const guide = await readFile("docs/MASK_PLANES.md", "utf8"),
    examples = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(
      (match) => match[1],
    );
  expect(examples).toHaveLength(2);
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const result = await page.evaluate(async (examples) => {
    const { editor, RasterLayer, LayerMask, PerspectiveTransform } =
      window.luma;
    editor.newDocument({ width: 180, height: 130 });
    const canvas = new OffscreenCanvas(100, 80),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#e84020";
    c.fillRect(0, 0, 100, 80);
    const asset = await editor.assetStore.add(
        await canvas.convertToBlob(),
        "Script plane original",
        undefined,
        false,
      ),
      layer = editor.document.layers.add(
        new RasterLayer({
          assetId: asset.id,
          width: 100,
          height: 80,
          x: 40,
          y: 30,
          perspective: new PerspectiveTransform({
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.8, y: 1 },
              { x: 0.1, y: 1 },
            ],
          }),
        }),
      );
    layer.mask = new LayerMask({ base: 1 });
    editor.document.selectedLayer = layer;
    const before = editor.document.toJSON(),
      past = editor.document.getSnapshot().past.length;
    const code =
      "const originalAssetId=document.selectedLayer.assetId;\n" +
      examples[0] +
      "\ndocument.selectedLayer.mask=document.selectedLayer.mask.with({plane});\n" +
      examples[1];
    await editor.runScript(code);
    const saved = editor.document.toJSON(),
      oneUndo = editor.document.getSnapshot().past.length === past + 1,
      plane = editor.document.selectedLayer!.mask!.plane!.toJSON(),
      stroke = editor.document.selectedLayer!.mask!.toJSON().strokes![0];
    let rejected = false;
    try {
      await editor.runScript(
        "document.name='Uncommitted plane';" +
          code +
          "\n;throw new Error('Reject this script');",
      );
    } catch {
      rejected = true;
    }
    const atomic =
      JSON.stringify(saved) === JSON.stringify(editor.document.toJSON());
    editor.document.undo();
    const undo =
      JSON.stringify(before) === JSON.stringify(editor.document.toJSON());
    editor.document.redo();
    return {
      oneUndo,
      rejected,
      atomic,
      undo,
      redo: JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()),
      reference: plane.reference,
      mapped:
        stroke.mode !== "wet" &&
        !!stroke.placement &&
        "geometry" in stroke.placement,
      phase: plane.phase,
    };
  }, examples);
  expect(result).toMatchObject({
    oneUndo: true,
    rejected: true,
    atomic: true,
    undo: true,
    redo: true,
    mapped: true,
    phase: "document",
    reference: { kind: "asset", assetId: expect.any(String) },
  });
  await writeFile(
    info.outputPath("retained-script.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const nativeScale of [0.5, 2])
  test(`mapped brush retains the original ${nativeScale}x rasterization grid without an intermediate logical bitmap`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (nativeScale) => {
      const {
          editor,
          Document,
          RasterLayer,
          LayerMask,
          BrushStroke,
          BrushTip,
          MarqueeSelection,
          PerspectiveTransform,
        } = window.luma,
        canvas = new OffscreenCanvas(64 * nativeScale, 48 * nativeScale),
        c = canvas.getContext("2d")!;
      c.fillStyle = "#ee4010";
      c.fillRect(0, 0, canvas.width, canvas.height);
      const asset = await editor.assetStore.add(
          await canvas.convertToBlob(),
          "Independent rasterization grid",
          undefined,
          false,
        ),
        doc = new Document({ width: 80, height: 60 }),
        layer = doc.layers.add(
          new RasterLayer({
            assetId: asset.id,
            width: 64,
            height: 48,
            perspective: new PerspectiveTransform({
              corners: [
                { x: 0.0625, y: 0 },
                { x: 1.0625, y: 0 },
                { x: 1.0625, y: 1 },
                { x: 0.0625, y: 1 },
              ],
            }),
          }),
        );
      layer.mask = new LayerMask({ base: 1 });
      const before = doc.toJSON(),
        stroke = new BrushStroke({
          points: [
            { x: 32.5, y: 24.5 },
            { x: 42, y: 31 },
          ],
          size: 9.5,
          hardness: 0.3,
          flow: 0.7,
          opacity: 0.6,
          pressureSize: false,
          tip: new BrushTip({ roundness: 0.6, angle: 25 }),
          clip: new MarqueeSelection({
            x: 25,
            y: 18,
            width: 20,
            height: 20,
            shape: "ellipse",
          }),
        });
      const sample = async () => {
        const out = await editor.renderer.render(
          doc.toJSON(),
          editor.assetStore,
          { cache: false, readback: true },
        );
        try {
          return [...out.getContext("2d")!.getImageData(0, 0, 80, 60).data];
        } finally {
          out.width = out.height = 0;
        }
      };
      layer.paintMask(stroke, "hide", { space: "placed" });
      const expected = await sample();
      doc.undo();
      if (JSON.stringify(doc.toJSON()) !== JSON.stringify(before))
        throw Error("Control did not restore source");
      layer.setMaskLinked(false);
      layer.setMaskLinked(true);
      layer.paintMask(stroke, "hide", { space: "placed" });
      const actual = await sample();
      let different = 0;
      for (let i = 0; i < actual.length; i++)
        if (actual[i] !== expected[i]) different++;
      return {
        different,
        native: [asset.width, asset.height],
        logical: [layer.width, layer.height],
        changed: expected.some((v, i) => i % 4 === 3 && v > 0 && v < 255),
      };
    }, nativeScale);
    expect(result).toEqual({
      different: 0,
      native: [64 * nativeScale, 48 * nativeScale],
      logical: [64, 48],
      changed: true,
    });
    await writeFile(
      info.outputPath("retained-native-grid.json"),
      JSON.stringify(result, null, 2),
    );
  });
