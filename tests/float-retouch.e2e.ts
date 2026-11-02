import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const directory = "tests/fixtures/float-retouch/";
const example = async (kind: string) =>
  (await readFile("docs/FLOAT_RETOUCH.md", "utf8")).match(
    new RegExp(
      `<!-- example: float-retouch-${kind} -->\\s*\x60\x60\x60js\\n([\\s\\S]*?)\\n\x60\x60\x60`,
    ),
  )![1];

for (const kind of ["patch", "heal"] as const)
  test(`documented isolated native ${kind} repairs signed HDR samples and retains exact alpha, originals, one Undo and project replay`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const raw = gunzipSync(await readFile(directory + "clean-original.f32.gz")),
      clean = [...new Float32Array(new Uint8Array(raw).buffer)],
      code = await example(kind);
    const result = await page.evaluate(
      async ({ bytes, clean, code, kind }) => {
        const { editor } = window.luma;
        await editor.openTiff(
          new File([new Uint8Array(bytes)], "Native damaged.tif", {
            type: "image/tiff",
          }),
          { editingPrecision: "float32" },
        );
        const scope = { x: 0, y: 0, width: 257, height: 193 },
          read = async () => {
            const scene = await editor.renderer.captureFloatScene(
              editor.document.toJSON(),
              editor.assetStore,
            );
            try {
              return await scene.read(scope);
            } finally {
              scene.dispose();
            }
          },
          words = (a: Float32Array) =>
            new Uint32Array(a.buffer, a.byteOffset, a.length),
          before = JSON.stringify(editor.document.toJSON()),
          past = editor.document.getSnapshot().past.length,
          original = editor.assetStore.values()[0],
          base = await read();
        await editor.runScript(code);
        const after = JSON.stringify(editor.document.toJSON()),
          actual = await read(),
          correction = editor.document.layers
            .at(editor.document.layers.length - 1)!
            .toJSON();
        if (
          correction.kind !== "adjustment" ||
          correction.adjustment.kind !== "patch"
        )
          throw new Error("Missing correction");
        let maxError = 0,
          alphaExact = true,
          outsideExact = true,
          changed = 0;
        const baseWords = words(base),
          actualWords = words(actual);
        for (let y = 0; y < 193; y++)
          for (let x = 0; x < 257; x++) {
            const p = (y * 257 + x) * 4;
            alphaExact &&= baseWords[p + 3] === actualWords[p + 3];
            for (let c = 0; c < 3; c++) {
              maxError = Math.max(
                maxError,
                Math.abs(actual[p + c] - clean[p + c]),
              );
              if (baseWords[p + c] !== actualWords[p + c]) changed++;
              if (x < 120 || x > 136 || y < 88 || y > 104)
                outsideExact &&= baseWords[p + c] === actualWords[p + c];
            }
          }
        const one = editor.document.getSnapshot().past.length === past + 1,
          asset = editor.assetStore.get(correction.adjustment.assetId),
          native = asset.tiff?.editingPrecision === "float32",
          sourceBytes = new Uint8Array(await original.blob.arrayBuffer()),
          sourceExact =
            sourceBytes.length === bytes.length &&
            sourceBytes.every((v, i) => v === bytes[i]);
        editor.document.undo();
        const undo = before === JSON.stringify(editor.document.toJSON());
        editor.document.redo();
        const redo = after === JSON.stringify(editor.document.toJSON()),
          project = await editor.saveProject();
        await editor.openProject(new File([project], "Native repaired.luma"));
        const reopened = await read(),
          reopenExact = words(reopened).every(
            (word, i) => word === actualWords[i],
          );
        return {
          kind,
          maxError,
          alphaExact,
          outsideExact,
          changed,
          one,
          native,
          sourceExact,
          undo,
          redo,
          reopenExact,
          words: actual.length,
          center: [
            ...actual.subarray((96 * 257 + 128) * 4, (96 * 257 + 128 + 1) * 4),
          ],
        };
      },
      {
        bytes: [...(await readFile(directory + "damaged-original.tif"))],
        clean,
        code,
        kind,
      },
    );
    // A 13-wide Dirichlet domain has ||A^-1||inf <= 14^2/8=24.5;
    // add one Float32 rounding unit to its default 1e-7 equation residual.
    expect(result.maxError).toBeLessThanOrEqual(24.5e-7 + 2 ** -20);
    expect(result.changed).toBeGreaterThan(0);
    expect(result).toMatchObject({
      alphaExact: true,
      outsideExact: true,
      one: true,
      native: true,
      sourceExact: true,
      undo: true,
      redo: true,
      reopenExact: true,
      words: 257 * 193 * 4,
    });
    await writeFile(
      info.outputPath(`native-${kind}.json`),
      JSON.stringify(result, null, 2),
    );
  });

test("native Source and Destination preparation use the same original scene and Healing keeps unquantized opacity", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, MarqueeSelection, BrushStroke } = window.luma,
        { prepareRetouchPatch } = (await import(
          /* @vite-ignore */ String("/src/engine/patch.ts")
        )) as typeof import("../src/engine/patch"),
        { prepareHealingStroke } = (await import(
          /* @vite-ignore */ String("/src/engine/healing.ts")
        )) as typeof import("../src/engine/healing"),
        { PixelProcessor } = (await import(
          /* @vite-ignore */ String("/src/engine/processor.ts")
        )) as typeof import("../src/engine/processor");
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Native damaged.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const before = JSON.stringify(editor.document.toJSON()),
        assets = editor.assetStore.values().length,
        processor = new PixelProcessor();
      try {
        const source = await prepareRetouchPatch(
            editor.document.toJSON(),
            editor.assetStore,
            editor.renderer,
            processor,
            new MarqueeSelection({
              shape: "rectangle",
              x: 122,
              y: 90,
              width: 13,
              height: 13,
            }).toJSON(),
            { x: 16, y: 0 },
            { mode: "all-layers" },
          ),
          destination = await prepareRetouchPatch(
            editor.document.toJSON(),
            editor.assetStore,
            editor.renderer,
            processor,
            new MarqueeSelection({
              shape: "rectangle",
              x: 138,
              y: 90,
              width: 13,
              height: 13,
            }).toJSON(),
            { x: -16, y: 0 },
            { mode: "all-layers" },
            { direction: "destination" },
          );
        if (
          source.precision !== "float32" ||
          destination.precision !== "float32"
        )
          throw new Error("Byte repair");
        const words = (p: Float32Array) =>
            new Uint32Array(p.buffer, p.byteOffset, p.length),
          same = words(source.correctedPixels).every(
            (v, i) => v === words(destination.correctedPixels)[i],
          );
        const healed = await prepareHealingStroke(
          editor.document.toJSON(),
          editor.assetStore,
          editor.renderer,
          processor,
          new BrushStroke({
            points: [{ x: 128.5, y: 96.5 }],
            size: 12,
            hardness: 1,
            opacity: 0.64123,
            flow: 1,
            pressureSize: false,
            pressureOpacity: false,
          }).toJSON(),
          { mode: "all-layers" },
          {},
          24,
        );
        if (healed.precision !== "float32") throw new Error("Byte heal");
        const center =
          (96 - healed.bounds.y) * healed.bounds.width + 128 - healed.bounds.x;
        return {
          same,
          bounds: source.bounds,
          coverage: healed.coverage[center],
          quantized: Math.round(0.64123 * 255) / 255,
          private:
            before === JSON.stringify(editor.document.toJSON()) &&
            editor.assetStore.values().length === assets,
          residuals: [source.residual, destination.residual, healed.residual],
        };
      } finally {
        processor.dispose();
      }
    },
    [...(await readFile(directory + "damaged-original.tif"))],
  );
  expect(result).toMatchObject({
    same: true,
    bounds: { x: 121, y: 89, width: 15, height: 15 },
    coverage: Math.fround(0.64123),
    private: true,
  });
  expect(result.coverage).not.toBe(result.quantized);
  for (const residual of result.residuals)
    expect(residual).toBeLessThanOrEqual(1e-7);
  await writeFile(
    info.outputPath("native-private-preparation.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native preparation rejects changed and restored ordered selections, source interpretation changes and cancellation, then retries", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, MarqueeSelection } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Native damaged.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      editor.document.selectedLayer = editor.document.layers.at(0);
      editor.document.selection = new MarqueeSelection({
        shape: "rectangle",
        x: 122,
        y: 90,
        width: 13,
        height: 13,
      });
      const before = JSON.stringify(editor.document.toJSON()),
        assets = editor.assetStore.values().length,
        past = editor.document.getSnapshot().past.length,
        errors: string[] = [];
      for (const kind of ["selection", "source", "abort"]) {
        const original = editor.renderer.captureFloatScene.bind(
          editor.renderer,
        );
        let release!: () => void, entered!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve)),
          started = new Promise<void>((resolve) => (entered = resolve));
        editor.renderer.captureFloatScene = async (
          ...args: Parameters<typeof original>
        ) => {
          const scene = await original(...args);
          return {
            ...scene,
            async read(...readArgs: Parameters<typeof scene.read>) {
              entered();
              await gate;
              return scene.read(...readArgs);
            },
          };
        };
        const abort = new AbortController(),
          pending = editor
            .applyPatch(
              { x: 16, y: 0 },
              { mode: "all-layers" },
              {},
              abort.signal,
            )
            .then(
              () => "",
              (error) => String(error),
            ),
          source = editor.assetStore.values()[0],
          prior = source.tiff;
        await started;
        if (kind === "selection") {
          const selected = editor.document.selectedLayers;
          editor.document.selectLayers([]);
          editor.document.selectLayers(selected);
        } else if (kind === "source")
          Reflect.set(source, "tiff", { ...source.tiff! });
        else abort.abort(new Error("Cancelled native repair"));
        release();
        errors.push(await pending);
        Reflect.set(source, "tiff", prior);
        editor.renderer.captureFloatScene = original;
      }
      const rollback =
        before === JSON.stringify(editor.document.toJSON()) &&
        assets === editor.assetStore.values().length &&
        past === editor.document.getSnapshot().past.length;
      await editor.applyPatch({ x: 16, y: 0 });
      return {
        errors,
        rollback,
        retry: editor.document.getSnapshot().past.length === past + 1,
      };
    },
    [...(await readFile(directory + "damaged-original.tif"))],
  );
  expect(result.errors[0]).toMatch(/selection/i);
  expect(result.errors[1]).toMatch(/source|changed/i);
  expect(result.errors[2]).toContain("Cancelled native repair");
  expect(result).toMatchObject({ rollback: true, retry: true });
  await writeFile(
    info.outputPath("native-cancellation.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native isolated repairs keep plugin installation inert, reject missing grants and late errors, and retain recipe and redo-only workspace sources", async ({
  page,
}, info) => {
  await page.goto("/");
  const code = await example("patch"),
    result = await page.evaluate(
      async ({ bytes, code }) => {
        const { editor } = window.luma,
          open = () =>
            editor.openTiff(
              new File([new Uint8Array(bytes)], "Native damaged.tif", {
                type: "image/tiff",
              }),
              { editingPrecision: "float32" },
            );
        await open();
        const before = JSON.stringify(editor.document.toJSON()),
          assets = editor.assetStore.values().length,
          past = editor.document.getSnapshot().past.length;
        const denied = {
          format: "luma-plugin" as const,
          apiVersion: 2 as const,
          id: "native-retouch-denied",
          name: "Native repair denied",
          version: "1.0.0",
          permissions: ["document:read", "document:write"] as (
            "document:read" | "document:write"
          )[],
          commands: [{ id: "repair", title: "Repair", source: code }],
        };
        editor.plugins.install(denied);
        let missing = "",
          late = "";
        try {
          await editor.runPlugin(denied.id, "repair");
        } catch (error) {
          missing = String(error);
        }
        try {
          await editor.runScript(
            code + ";throw new Error('Late native repair failure')",
          );
        } catch (error) {
          late = String(error);
        }
        const atomic =
          before === JSON.stringify(editor.document.toJSON()) &&
          assets === editor.assetStore.values().length &&
          past === editor.document.getSnapshot().past.length;
        const manifest = {
          ...denied,
          id: "native-retouch-granted",
          name: "Native repair granted",
          permissions: [
            "document:read",
            "document:write",
            "assets:read",
            "assets:write",
          ] as (
            "document:read" | "document:write" | "assets:read" | "assets:write"
          )[],
        };
        editor.plugins.install(manifest);
        const inert =
          before === JSON.stringify(editor.document.toJSON()) &&
          assets === editor.assetStore.values().length;
        const read = async () => {
            const scene = await editor.renderer.captureFloatScene(
              editor.document.toJSON(),
              editor.assetStore,
            );
            try {
              return new Uint32Array(
                (await scene.read({ x: 0, y: 0, width: 257, height: 193 }))
                  .buffer,
              );
            } finally {
              scene.dispose();
            }
          },
          same = (a: Uint32Array, b: Uint32Array) =>
            a.every((v, i) => v === b[i]);
        editor.recipes.startRecording();
        await editor.runPlugin(manifest.id, "repair");
        const expected = await read(),
          recipe = await editor.recipes.stopRecording({
            name: "Native repair",
          }),
          file = await editor.recipes.exportRecipePackage(recipe),
          originalCorrection = editor.document.layers
            .at(editor.document.layers.length - 1)!
            .toJSON();
        if (
          originalCorrection.kind !== "adjustment" ||
          originalCorrection.adjustment.kind !== "patch"
        )
          throw new Error("No repair");
        const oldAsset = originalCorrection.adjustment.assetId;
        await open();
        const absent = !editor.assetStore.has(oldAsset);
        await editor.recipes.executeRecipePackage(file);
        const replay = same(expected, await read()),
          after = JSON.stringify(editor.document.toJSON());
        editor.document.undo();
        const retained = JSON.stringify(editor.document.toJSON());
        await editor.saveWorkspace();
        await editor.restoreWorkspace();
        const restored = retained === JSON.stringify(editor.document.toJSON());
        editor.document.redo();
        return {
          missing,
          late,
          atomic,
          inert,
          absent,
          replay,
          restored,
          redo: after === JSON.stringify(editor.document.toJSON()),
          workspaceExact: same(expected, await read()),
          actions: recipe.steps.map((step) => step.action.type),
        };
      },
      {
        bytes: [...(await readFile(directory + "damaged-original.tif"))],
        code,
      },
    );
  expect(result.missing).toContain("assets:read");
  expect(result.late).toContain("Late native repair failure");
  expect(result).toMatchObject({
    atomic: true,
    inert: true,
    absent: true,
    replay: true,
    restored: true,
    redo: true,
    workspaceExact: true,
    actions: ["layer.add", "layer.update"],
  });
  await writeFile(
    info.outputPath("native-retouch-transport.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native correction replay applies affine masks, appearance, Fill and pass-through opacity after once-only correction coverage", async ({
  page,
}, info) => {
  // Three Float32 color stages have at most three half-ULPs at the largest
  // fixture magnitude (8). The independent scalar reference does no sampling.
  const bound = 3 * 2 ** -21;
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const {
          editor,
          AdjustmentLayer,
          PatchAdjustment,
          LayerGroup,
          LayerMask,
          MarqueeSelection,
          AffineTransform,
        } = window.luma,
        { encodeFloatPatchAsset } = (await import(
          /* @vite-ignore */ String("/src/core/float-patch-codec.ts")
        )) as typeof import("../src/core/float-patch-codec");
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Native appearance.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const area = { x: 16, y: 8, width: 16, height: 12 },
        read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return await scene.read(area);
          } finally {
            scene.dispose();
          }
        },
        before = await read(),
        words = (p: Float32Array) =>
          new Uint32Array(p.buffer, p.byteOffset, p.length),
        blob = await encodeFloatPatchAsset(
          new Float32Array([4, -2, 8, 0.375, -16, 32, 4, 0.125]),
          new Float32Array([0.64123, 0.375]),
          2,
          1,
        ),
        asset = await editor.assetStore.add(
          blob,
          "Native correction",
          undefined,
          false,
          { tiff: { editingPrecision: "float32" } },
        ),
        group = editor.document.layers.add(
          new LayerGroup({ blendMode: "pass-through", opacity: 0.75 }),
        ),
        rect = (width: number) =>
          new LayerMask({
            selection: new MarqueeSelection({
              shape: "rectangle",
              x: 0,
              y: 0,
              width,
              height: 1,
            }),
          }),
        layer = group.layers.add(
          new AdjustmentLayer({
            adjustment: new PatchAdjustment({
              precision: "float32",
              assetId: asset.id,
              width: 2,
              height: 1,
            }),
            opacity: 0.64123,
            fillOpacity: 0.375,
          }),
        );
      layer.mask = rect(1);
      group.mask = rect(2);
      layer.styles.colorOverlay = {
        enabled: true,
        color: "#0000ff",
        opacity: 0.25,
      };
      const rows = [];
      for (const pose of [
        {
          name: "rotation",
          x: 20,
          y: 10,
          matrix: new AffineTransform(0, 1, -1, 0),
          pixel: { x: 19, y: 10 },
        },
        {
          name: "reflection",
          x: 24,
          y: 14,
          matrix: new AffineTransform(-1, 0, 0, 1),
          pixel: { x: 23, y: 14 },
        },
      ]) {
        group.transform = AffineTransform.translation(pose.x, pose.y).multiply(
          pose.matrix,
        );
        const scene = await editor.renderer.captureFloatScene(
          editor.document.toJSON(),
          editor.assetStore,
        );
        let actual: Float32Array, parts: Float32Array;
        try {
          actual = await scene.read(area);
          parts = new Float32Array(actual.length);
          for (let y = 0; y < area.height; y++)
            for (let x = 0; x < area.width; x++)
              parts.set(
                await scene.read({
                  x: area.x + x,
                  y: area.y + y,
                  width: 1,
                  height: 1,
                }),
                (y * area.width + x) * 4,
              );
        } finally {
          scene.dispose();
        }
        const expected = before.slice(),
          at =
            ((pose.pixel.y - area.y) * area.width + pose.pixel.x - area.x) * 4,
          cov = Math.fround(0.64123),
          mix = (a: number, b: number, amount: number) =>
            Math.fround(a * (1 - amount) + b * amount);
        for (let c = 0; c < 3; c++) {
          const corrected = mix(before[at + c], [4, -2, 8][c], cov),
            styled = mix(corrected, c === 2 ? 1 : 0, 0.25),
            adjusted = mix(before[at + c], styled, 0.64123 * 0.375);
          expected[at + c] = mix(before[at + c], adjusted, 0.75);
        }
        const a = words(actual!),
          b = words(before),
          partition = words(parts!),
          e = words(expected);
        let error = 0,
          alphaExact = true,
          outsideExact = true;
        for (let i = 0; i < a.length; i++) {
          error = Math.max(error, Math.abs(actual![i] - expected[i]));
          if (i % 4 === 3) alphaExact &&= a[i] === b[i];
          if (i < at || i >= at + 3) outsideExact &&= a[i] === b[i];
        }
        rows.push({
          pose: pose.name,
          matrix: group.transform.toJSON(),
          pixel: pose.pixel,
          actual: [...actual!.subarray(at, at + 4)],
          expected: [...expected.subarray(at, at + 4)],
          changedPixels: Array.from({ length: a.length / 4 }, (_, p) => p)
            .filter((p) => [0, 1, 2].some((c) => a[p * 4 + c] !== b[p * 4 + c]))
            .map((p) => ({
              x: area.x + (p % area.width),
              y: area.y + Math.floor(p / area.width),
              actual: [...actual!.subarray(p * 4, p * 4 + 4)],
              before: [...before.subarray(p * 4, p * 4 + 4)],
            })),
          error,
          alphaExact,
          outsideExact,
          partitionExact: a.every((v, i) => v === partition[i]),
          changed: a.some((v, i) => v !== b[i]),
          referenceChanged: e.some((v, i) => v !== b[i]),
          words: a.length,
        });
      }
      return rows;
    },
    [...(await readFile(directory + "damaged-original.tif"))],
  );
  await writeFile(
    info.outputPath("native-correction-appearance.json"),
    JSON.stringify({ bound, rows: result }, null, 2),
  );
  for (const row of result) {
    expect(row.error).toBeLessThanOrEqual(bound);
    expect(row).toMatchObject({
      alphaExact: true,
      outsideExact: true,
      partitionExact: true,
      changed: true,
      referenceChanged: true,
      words: 16 * 12 * 4,
    });
  }
  await writeFile(
    info.outputPath("native-correction-appearance.json"),
    JSON.stringify({ bound, rows: result }, null, 2),
  );
});
