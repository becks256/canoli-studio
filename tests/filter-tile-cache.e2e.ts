import { expect, test } from "@playwright/test";
test("mask edits reuse native filter pixels while source/filter edits and cache bypass remain exact", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      RasterLayer,
      LayerMask,
      GaussianBlurFilter,
      UnsharpMaskFilter,
      BrushStroke,
    } = window.luma;
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const renderer = new CanvasRenderer();
    try {
      editor.newDocument({ width: 256, height: 128 });
      const source = new OffscreenCanvas(256, 128),
        c = source.getContext("2d")!;
      c.fillStyle = "#ef4010";
      c.fillRect(32, 16, 192, 96);
      const asset = await editor.assetStore.add(
        await source.convertToBlob(),
        "Source",
        undefined,
        false,
      );
      const raster = editor.document.layers.add(
        new RasterLayer({ assetId: asset.id, width: 256, height: 128 }),
      );
      const layer = raster.convertToSmartObject();
      layer.setFilters([
        new GaussianBlurFilter({ sigma: 3 }),
        new UnsharpMaskFilter({ sigma: 1, amount: 0.5 }),
      ]);
      layer.filterMask = new LayerMask({ base: 1 });
      let calls = 0;
      const spatial = renderer.processor.spatialFilter.bind(renderer.processor);
      renderer.processor.spatialFilter = (
        ...args: Parameters<typeof spatial>
      ) => {
        calls++;
        return spatial(...args);
      };
      async function render(cache = true) {
        const start = performance.now();
        const canvas = await renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache, readback: true },
        );
        const data = [
          ...canvas.getContext("2d")!.getImageData(0, 0, 256, 128).data,
        ];
        canvas.width = canvas.height = 0;
        return { data, ms: performance.now() - start };
      }
      const cold = await render(),
        coldCalls = calls;
      layer.filterMask = layer.filterMask.paint(
        new BrushStroke({
          points: [{ x: 32, y: 64 }],
          size: 32,
          hardness: 0.5,
        }),
        "hide",
      );
      const warm = await render(),
        maskCalls = calls - coldCalls;
      const reference = await render(false),
        bypassCalls = calls - coldCalls - maskCalls;
      layer.filterMask = layer.filterMask.paint(
        new BrushStroke({
          points: [{ x: 32, y: 65 }],
          size: 16,
          hardness: 0.5,
        }),
        "reveal",
      );
      const extended = await render();
      const extendedReference = await render(false);
      const paintedMask = layer.filterMask;
      layer.filterMask = new LayerMask({ base: 0 });
      const beforeHidden = calls,
        hidden = await render(),
        hiddenCalls = calls - beforeHidden,
        hiddenReference = await render(false);
      layer.filterMask = new LayerMask({ base: 1 });
      const beforeRevealed = calls,
        revealed = await render(),
        revealedCalls = calls - beforeRevealed;
      layer.filterMask = paintedMask;
      const beforeFilter = calls;
      layer.setFilters([new GaussianBlurFilter({ sigma: 2 })]);
      const changed = await render(),
        filterCalls = calls - beforeFilter;
      const changedReference = await render(false);
      const master = layer.editContents();
      master.layers.at(0)!.opacity = 0.5;
      layer.replaceContents(master);
      const beforeMaster = calls,
        edited = await render(),
        masterCalls = calls - beforeMaster,
        editedReference = await render(false);
      renderer.clearCache();
      const beforeClear = calls;
      const cleared = await render(),
        clearCalls = calls - beforeClear;
      const equal = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
      return {
        coldCalls,
        maskCalls,
        bypassCalls,
        filterCalls,
        masterCalls,
        clearCalls,
        hiddenCalls,
        revealedCalls,
        extendedExact: equal(extended.data, extendedReference.data),
        hiddenExact: equal(hidden.data, hiddenReference.data),
        revealedExact: equal(revealed.data, cold.data),
        maskedChanged: !equal(cold.data, warm.data),
        maskExact: equal(warm.data, reference.data),
        filterExact: equal(changed.data, changedReference.data),
        masterExact: equal(edited.data, editedReference.data),
        clearExact: equal(edited.data, cleared.data),
        coldMs: cold.ms,
        warmMs: warm.ms,
        uncachedMs: reference.ms,
      };
    } finally {
      renderer.dispose();
    }
  });
  expect(result.coldCalls).toBeGreaterThan(0);
  expect(result.maskCalls).toBe(0);
  expect(result.bypassCalls).toBeGreaterThan(0);
  expect(result.filterCalls).toBeGreaterThan(0);
  expect(result.masterCalls).toBeGreaterThan(0);
  expect(result.clearCalls).toBeGreaterThan(0);
  expect(result).toMatchObject({
    maskedChanged: true,
    maskExact: true,
    filterExact: true,
    masterExact: true,
    clearExact: true,
    hiddenCalls: 0,
    revealedCalls: 0,
    hiddenExact: true,
    revealedExact: true,
    extendedExact: true,
  });
  await test
    .info()
    .attach("native-filter-cache-timing", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
});

test("clearing retained tiles during worker processing prevents stale cache publication", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer, GaussianBlurFilter, LayerMask } = window.luma;
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const renderer = new CanvasRenderer();
    try {
      editor.newDocument({ width: 32, height: 32 });
      const source = new OffscreenCanvas(32, 32),
        c = source.getContext("2d")!;
      c.fillStyle = "red";
      c.fillRect(4, 4, 24, 24);
      const asset = await editor.assetStore.add(
        await source.convertToBlob(),
        "Source",
        undefined,
        false,
      );
      const layer = editor.document.layers
        .add(new RasterLayer({ assetId: asset.id, width: 32, height: 32 }))
        .convertToSmartObject();
      layer.addFilter(new GaussianBlurFilter({ sigma: 1 }));
      layer.filterMask = new LayerMask({ base: 1 });
      let started!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => (started = resolve)),
        gate = new Promise<void>((resolve) => (release = resolve));
      const spatial = renderer.processor.spatialFilter.bind(renderer.processor);
      let calls = 0;
      renderer.processor.spatialFilter = async (
        ...args: Parameters<typeof spatial>
      ) => {
        calls++;
        if (calls === 1) {
          started();
          await gate;
        }
        return spatial(...args);
      };
      const pending = renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: true },
      );
      await entered;
      renderer.clearCache();
      release();
      const first = await pending;
      first.width = first.height = 0;
      layer.filterMask = layer.filterMask.with({ density: 0.5 });
      const second = await renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: true },
      );
      second.width = second.height = 0;
      return calls;
    } finally {
      renderer.dispose();
    }
  });
  expect(result).toBe(2);
});

test("filtered-only retention regenerates translucent originals without rerunning filters or changing pixels", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { filteredMasterTile } = await import(
      /* @vite-ignore */ String("/src/engine/smart-filters.ts")
    );
    const { FilterTileCache } = await import(
      /* @vite-ignore */ String("/src/engine/filter-tile-cache.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor(),
      cache = new FilterTileCache(1000);
    let filterCalls = 0,
      sourceCalls = 0;
    const spatial = processor.spatialFilter.bind(processor);
    processor.spatialFilter = (...args: Parameters<typeof spatial>) => {
      filterCalls++;
      return spatial(...args);
    };
    const render = async (region: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => {
      sourceCalls++;
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "rgba(240,40,100,0.4)";
      c.fillRect(1 - region.x, 1 - region.y, 6, 6);
      return canvas;
    };
    const mask = {
      density: 0.6,
      inverted: true,
      render: async (region: { width: number; height: number }) => {
        const canvas = document.createElement("canvas");
        canvas.width = region.width;
        canvas.height = region.height;
        const c = canvas.getContext("2d")!;
        c.fillStyle = "rgba(255,255,255,0.5)";
        c.fillRect(0, 0, region.width, region.height);
        return canvas;
      },
    };
    const retention = { cache, key: "a", signature: "s", canCache: () => true };
    const region = { x: 0, y: 0, width: 8, height: 8 },
      filters = [{ id: "b", kind: "gaussian-blur", enabled: true, sigma: 1 }];
    const read = (canvas: HTMLCanvasElement) => {
      const data = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 14, 14).data,
      ];
      canvas.width = canvas.height = 0;
      return data;
    };
    try {
      const first = read(
        (
          await filteredMasterTile(
            render,
            processor,
            region,
            filters,
            8,
            8,
            mask,
            retention,
          )
        ).canvas,
      );
      const second = read(
        (
          await filteredMasterTile(
            render,
            processor,
            region,
            filters,
            8,
            8,
            mask,
            retention,
          )
        ).canvas,
      );
      const retainedCounts = { filterCalls, sourceCalls };
      const reference = read(
        (
          await filteredMasterTile(
            render,
            processor,
            region,
            filters,
            8,
            8,
            mask,
          )
        ).canvas,
      );
      return {
        retainedCounts,
        bytes: cache.byteLength,
        identical: first.every((v, i) => v === second[i] && v === reference[i]),
        visible: first.some((v, i) => i % 4 === 3 && v > 0),
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toMatchObject({
    retainedCounts: { filterCalls: 1, sourceCalls: 2 },
    identical: true,
    visible: true,
  });
  expect(result.bytes).toBeLessThanOrEqual(1000);
});

test("finished mask tiles reuse distant coverage and invalidate both sides of a stroke boundary", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer, LayerMask, GaussianBlurFilter, BrushStroke } =
      window.luma;
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const renderer = new CanvasRenderer();
    let mixes = 0;
    const mix = renderer.processor.mixFiltered.bind(renderer.processor);
    renderer.processor.mixFiltered = (...args: Parameters<typeof mix>) => {
      mixes++;
      return mix(...args);
    };
    try {
      editor.newDocument({ width: 1024, height: 128 });
      const source = new OffscreenCanvas(1024, 128),
        context = source.getContext("2d")!;
      context.fillStyle = "rgba(200,40,90,0.6)";
      context.fillRect(16, 16, 992, 96);
      const asset = await editor.assetStore.add(
        await source.convertToBlob(),
        "Coverage source",
        undefined,
        false,
      );
      const layer = editor.document.layers
        .add(new RasterLayer({ assetId: asset.id, width: 1024, height: 128 }))
        .convertToSmartObject();
      layer.setFilters([new GaussianBlurFilter({ sigma: 2 })]);
      layer.filterMask = new LayerMask({ base: 0.5 });
      const render = async (cache = true) => {
        const before = mixes,
          canvas = await renderer.render(
            editor.document.toJSON(),
            editor.assetStore,
            { cache, readback: true },
          );
        const pixels = [
          ...canvas.getContext("2d")!.getImageData(0, 0, 1024, 128).data,
        ];
        canvas.width = canvas.height = 0;
        return { pixels, mixes: mixes - before };
      };
      const cold = await render();
      layer.filterMask = layer.filterMask.paint(
        new BrushStroke({
          points: [{ x: 32, y: 16 }],
          size: 24,
          hardness: 0.5,
        }),
        "hide",
      );
      const local = await render(),
        localReference = await render(false);
      layer.filterMask = layer.filterMask.paint(
        new BrushStroke({
          points: [{ x: 256, y: 16 }],
          size: 24,
          hardness: 0.5,
        }),
        "hide",
      );
      const boundary = await render(),
        boundaryReference = await render(false);
      layer.filterMask = layer.filterMask.with({ feather: 12 });
      const feather = await render(),
        featherReference = await render(false);
      editor.document.undo();
      const undone = await render();
      editor.document.redo();
      const redone = await render();
      layer.filterMask = layer.filterMask.with({
        strokes: layer.filterMask.strokes.slice(0, 1),
      });
      const removed = await render(),
        removedReference = await render(false);
      layer.filterMask = layer.filterMask.with({ x: 512 });
      const translated = await render(),
        translatedReference = await render(false);
      layer.filterMask = layer.filterMask.with({
        inverted: true,
        density: 0.7,
      });
      const inverted = await render(),
        invertedReference = await render(false);
      const exact = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
      return {
        cold: cold.mixes,
        local: local.mixes,
        boundary: boundary.mixes,
        feather: feather.mixes,
        changed:
          !exact(removed.pixels, feather.pixels) &&
          !exact(translated.pixels, removed.pixels) &&
          !exact(inverted.pixels, translated.pixels),
        history: [
          exact(undone.pixels, boundary.pixels),
          exact(redone.pixels, feather.pixels),
        ],
        subsequent: [
          exact(removed.pixels, removedReference.pixels),
          exact(translated.pixels, translatedReference.pixels),
          exact(inverted.pixels, invertedReference.pixels),
        ],
        exact: [
          exact(local.pixels, localReference.pixels),
          exact(boundary.pixels, boundaryReference.pixels),
          exact(feather.pixels, featherReference.pixels),
        ],
      };
    } finally {
      renderer.dispose();
    }
  });
  expect(result).toEqual({
    cold: 4,
    local: 1,
    boundary: 2,
    feather: 4,
    changed: true,
    history: [true, true],
    subsequent: [true, true, true],
    exact: [true, true, true],
  });
});
