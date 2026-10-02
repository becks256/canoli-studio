import { expect, test } from "@playwright/test";

for (const cache of [false, true])
  test(`component resolution (cache ${cache}) renders clipping, scoped masks, shared updates and transform round trips`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (cache) => {
      const { ComponentRegistry } = await import(
        /* @vite-ignore */ String("/src/core/smart/manager.ts")
      );
      const { resolveSmartDocument } = await import(
        /* @vite-ignore */ String("/src/core/smart/resolve.ts")
      );
      const { createDocument, createRaster, base } = await import(
        /* @vite-ignore */ String("/src/core/model.ts")
      );
      const { CanvasRenderer } = await import(
        /* @vite-ignore */ String("/src/engine/renderer.ts")
      );
      const { AssetStore } = await import(
        /* @vite-ignore */ String("/src/core/assets.ts")
      );
      const assets = new AssetStore();
      const renderer = new CanvasRenderer();
      async function add(color: string, id: string) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 16;
        canvas.getContext("2d")!.fillStyle = color;
        canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((value) => resolve(value!), "image/png"),
        );
        await assets.add(blob, id, id, false);
        return blob;
      }
      try {
        const original = await add("#ff0000", "red");
        await add("#0000ff", "blue");
        const photo = createRaster("Master image", "red", 16, 16);
        photo.x = 4;
        photo.mask = {
          kind: "selection",
          enabled: true,
          inverted: false,
          density: 1,
          linked: false,
          selection: {
            regions: [
              {
                shape: "rectangle",
                operation: "add",
                x: 4,
                y: 0,
                width: 16,
                height: 16,
              },
            ],
          },
        };
        const master = {
          id: "master",
          name: "Master",
          source: {
            kind: "document" as const,
            document: {
              ...createDocument("Master", 16, 16),
              children: [photo],
            },
          },
        };
        const registry = new ComponentRegistry([master]);
        const first = {
          ...base("First"),
          kind: "smart-object" as const,
          componentId: "master",
          width: 16,
          height: 16,
        };
        const second = {
          ...base("Second"),
          kind: "smart-object" as const,
          componentId: "master",
          width: 16,
          height: 16,
          x: 20,
        };
        const root = {
          ...createDocument("Instances", 40, 16),
          children: [first, second],
        };
        async function render(definitions = registry): Promise<number[]> {
          const canvas = await renderer.render(
            resolveSmartDocument(root, definitions),
            assets,
            { cache, readback: true, maxPixels: 640, maxDimension: 40 },
          );
          const bytes = Array.from(
            canvas.getContext("2d")!.getImageData(0, 0, 40, 16)
              .data as Uint8ClampedArray,
          );
          canvas.width = canvas.height = 0;
          return bytes;
        }
        const before = await render();
        first.transform = { a: 0.01, b: 0, c: 0, d: 0.01, e: 0, f: 0 };
        await render();
        first.transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const restored = await render();
        const updated = structuredClone(master);
        updated.source.document.children[0].assetId = "blue";
        const next = registry.withDefinitions([updated]);
        const changed = await render(next.registry);
        const undone = await render(registry);
        const sample = (pixels: number[], x: number) =>
          pixels.slice((8 * 40 + x) * 4, (8 * 40 + x) * 4 + 4);
        return {
          before: [sample(before, 5), sample(before, 25)],
          outside: [
            sample(before, 2),
            sample(before, 17),
            sample(before, 22),
            sample(before, 37),
          ],
          after: [sample(changed, 5), sample(changed, 25)],
          roundTrip: JSON.stringify(before) === JSON.stringify(restored),
          undo: JSON.stringify(before) === JSON.stringify(undone),
          sourceBytesIntact:
            new Uint8Array(
              await assets.get("red").blob.arrayBuffer(),
            ).join() === new Uint8Array(await original.arrayBuffer()).join(),
        };
      } finally {
        renderer.dispose();
        assets.dispose();
      }
    }, cache);
    expect(result.before).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    expect(result.outside).toEqual(Array(4).fill([0, 0, 0, 0]));
    expect(result.after).toEqual([
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    expect(result).toMatchObject({
      roundTrip: true,
      undo: true,
      sourceBytesIntact: true,
    });
  });
