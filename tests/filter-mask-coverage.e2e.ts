import { expect, test } from "@playwright/test";
test("uniform-mask shortcuts match full rasterization and skip work only at proven endpoints", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { LayerMask, BrushStroke, AffineTransform } = window.luma;
    const { filteredMasterTile } = await import(
      /* @vite-ignore */ String("/src/engine/smart-filters.ts")
    );
    const { uniformFilterMaskCoverage } = await import(
      /* @vite-ignore */ String("/src/engine/filter-mask-coverage.ts")
    );
    const { maskCoverage } = await import(
      /* @vite-ignore */ String("/src/engine/masks.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    let filters = 0,
      masks = 0;
    const spatial = processor.spatialFilter.bind(processor);
    processor.spatialFilter = (...args: Parameters<typeof spatial>) => {
      filters++;
      return spatial(...args);
    };
    const source = async (region: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => {
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "rgba(240,40,100,0.4)";
      c.fillRect(2 - region.x, 2 - region.y, 12, 12);
      return canvas;
    };
    const cases = [
      {
        name: "white",
        mask: new LayerMask({ base: 1 }),
        basis: new AffineTransform(),
        endpoint: 1,
      },
      {
        name: "black",
        mask: new LayerMask({ base: 0 }),
        basis: new AffineTransform(),
        endpoint: 0,
      },
      {
        name: "inverted",
        mask: new LayerMask({ base: 1, inverted: true }),
        basis: new AffineTransform(),
        endpoint: 0,
      },
      {
        name: "fractional",
        mask: new LayerMask({ base: 0, density: 0.5 }),
        basis: new AffineTransform(),
        endpoint: null,
      },
      {
        name: "far-stroke",
        mask: new LayerMask({ base: 1 }).paint(
          new BrushStroke({ points: [{ x: 100, y: 8 }], size: 4 }),
          "hide",
        ),
        basis: new AffineTransform(),
        endpoint: 1,
      },
      {
        name: "transformed-stroke",
        mask: new LayerMask({ base: 1 }).paint(
          new BrushStroke({ points: [{ x: 100, y: 8 }], size: 4 }),
          "hide",
        ),
        basis: AffineTransform.translation(-92, 0),
        endpoint: null,
      },
      {
        name: "feather-reaches-tile",
        mask: new LayerMask({ base: 1, feather: 6 }).paint(
          new BrushStroke({ points: [{ x: 24, y: 8 }], size: 4 }),
          "hide",
        ),
        basis: new AffineTransform(),
        endpoint: null,
      },
    ];
    const results = [];
    try {
      for (const item of cases) {
        const data = item.mask.toJSON();
        const render = async (optimized: boolean) => {
          const startFilters = filters,
            startMasks = masks;
          const output = await filteredMasterTile(
            source,
            processor,
            { x: 0, y: 0, width: 16, height: 16 },
            [{ id: "blur", kind: "gaussian-blur", enabled: true, sigma: 1 }],
            16,
            16,
            {
              density: data.density,
              inverted: data.inverted,
              constant: optimized
                ? (region: any) =>
                    uniformFilterMaskCoverage(data, region, item.basis)
                : undefined,
              render: (region: any) => {
                masks++;
                return maskCoverage(
                  data,
                  { ...region, sx: 1, sy: 1 },
                  0,
                  0,
                  processor,
                  undefined,
                  item.basis,
                );
              },
            },
          );
          const pixels = [
            ...output.canvas.getContext("2d")!.getImageData(0, 0, 22, 22).data,
          ];
          output.canvas.width = output.canvas.height = 0;
          return {
            pixels,
            filters: filters - startFilters,
            masks: masks - startMasks,
          };
        };
        const fast = await render(true),
          reference = await render(false);
        results.push({
          name: item.name,
          endpoint: item.endpoint,
          exact: fast.pixels.every((v, i) => v === reference.pixels[i]),
          filters: fast.filters,
          masks: fast.masks,
        });
      }
      return results;
    } finally {
      processor.dispose();
    }
  });
  for (const item of results) {
    expect(item.exact, item.name).toBe(true);
    expect(item.masks, item.name).toBe(item.endpoint === null ? 1 : 0);
    expect(item.filters, item.name).toBe(item.endpoint === 0 ? 0 : 1);
  }
});

test("whole feather regions match the larger tiled path across fractional feather and transformed strokes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { LayerMask, BrushStroke, AffineTransform } = window.luma;
    const { maskCoverage } = await import(
      /* @vite-ignore */ String("/src/engine/masks.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    let calls = 0;
    const feather = processor.feather.bind(processor);
    processor.feather = (...args: Parameters<typeof feather>) => {
      calls++;
      return feather(...args);
    };
    const mask = new LayerMask({ base: 1, feather: 12.25 })
      .paint(
        new BrushStroke({
          points: [
            { x: 20, y: 40 },
            { x: 500, y: 450 },
            { x: 850, y: 180 },
          ],
          size: 90,
          hardness: 0.4,
          pressureSize: false,
        }),
        "hide",
      )
      .toJSON();
    const basis = AffineTransform.translation(17, -8).multiply(
      AffineTransform.scale(0.9, 1.1),
    );
    try {
      const compact = await maskCoverage(
        mask,
        { x: 232, y: 19, width: 560, height: 560, sx: 1, sy: 1 },
        0,
        0,
        processor,
        undefined,
        basis,
      );
      const compactCalls = calls;
      const reference = await maskCoverage(
        mask,
        { x: 0, y: 0, width: 1025, height: 600, sx: 1, sy: 1 },
        0,
        0,
        processor,
        undefined,
        basis,
      );
      const a = compact.getContext("2d")!.getImageData(0, 0, 560, 560).data;
      const b = reference
        .getContext("2d")!
        .getImageData(232, 19, 560, 560).data;
      let difference = 0;
      for (let i = 0; i < a.length; i++)
        difference = Math.max(difference, Math.abs(a[i] - b[i]));
      compact.width = compact.height = reference.width = reference.height = 0;
      return { difference, compactCalls, tiledCalls: calls - compactCalls };
    } finally {
      processor.dispose();
    }
  });
  expect(result.compactCalls).toBe(1);
  expect(result.tiledCalls).toBe(6);
  // The previous 512px path also differs by one alpha level for this translated Canvas brush fixture.
  expect(result.difference).toBeLessThanOrEqual(1);
});

test("mask scratch reuse preserves clipped hide and reveal stroke isolation", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { LayerMask, BrushStroke, MarqueeSelection, AffineTransform } =
      window.luma;
    const { paintedMask, drawMaskStroke } = await import(
      /* @vite-ignore */ String("/src/engine/drawing.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    const space = { x: 0, y: 0, width: 96, height: 64, sx: 1, sy: 1 };
    const mask = new LayerMask({ base: 1 })
      .paint(
        new BrushStroke({
          points: [{ x: 24, y: 32 }],
          size: 40,
          hardness: 0.5,
          opacity: 0.7,
          clip: new MarqueeSelection({
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 24,
            height: 64,
          }),
        }),
        "hide",
      )
      .paint(
        new BrushStroke({
          points: [{ x: 48, y: 32 }],
          size: 40,
          hardness: 0.7,
          opacity: 0.8,
        }),
        "hide",
      )
      .paint(
        new BrushStroke({
          points: [{ x: 35, y: 32 }],
          size: 48,
          hardness: 0.4,
          opacity: 0.6,
        }),
        "reveal",
      )
      .toJSON();
    const basis = AffineTransform.translation(3, 2);
    try {
      const actual = await paintedMask(mask, space, 0, 0, processor, basis);
      const reference = document.createElement("canvas");
      reference.width = 96;
      reference.height = 64;
      const context = reference.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 96, 64);
      for (const entry of mask.strokes!)
        await drawMaskStroke(
          entry,
          reference,
          space,
          0,
          0,
          processor,
          undefined,
          basis,
        );
      const a: Uint8ClampedArray = actual
        .getContext("2d")!
        .getImageData(0, 0, 96, 64).data;
      const b = context.getImageData(0, 0, 96, 64).data;
      const result = {
        exact: a.every((v, i) => v === b[i]),
        modified: a.some((v, i) => i % 4 === 3 && v < 255),
        right: a[(34 * 96 + 54) * 4 + 3],
      };
      actual.width = actual.height = reference.width = reference.height = 0;
      return result;
    } finally {
      processor.dispose();
    }
  });
  expect(result.exact).toBe(true);
  expect(result.modified).toBe(true);
  expect(result.right).toBeLessThan(255);
});
