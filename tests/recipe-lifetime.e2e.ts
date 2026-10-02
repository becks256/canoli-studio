import { test, expect } from "@playwright/test";

for (const saved of [false, true])
  for (const transition of ["close", "switch-back"])
    test(`package ${saved ? "saved" : "direct"} rejects ${transition} during decoding`, async ({
      page,
    }) => {
      await page.goto("/");
      const result = await page.evaluate(
        async ({ saved, transition }) => {
          const editor = window.luma.editor;
          const { serializeRecipePackage } = await import(
            /* @vite-ignore */ String("/src/ai/recipes/package.ts")
          );
          editor.newDocument({ width: 2, height: 2 });
          const target = editor.document,
            assets = editor.assetStore;
          target.name = "Recipe target";
          const history = target.getSnapshot().past.length;
          const canvas = new OffscreenCanvas(2, 2);
          canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
          const blob = await canvas.convertToBlob();
          const file = await serializeRecipePackage(
            {
              schemaVersion: 1,
              id: "probe",
              name: "Probe",
              description: "",
              version: 1,
              parameters: [],
              steps: [
                {
                  id: "add",
                  name: "Add",
                  action: {
                    type: "layer.add",
                    layerTemplate: {
                      kind: "raster",
                      name: "Added",
                      assetId: "source",
                      width: 2,
                      height: 2,
                    },
                  },
                },
              ],
            },
            {
              get: () => ({
                id: "source",
                name: "Source",
                width: 2,
                height: 2,
                blob,
              }),
            },
          );
          if (saved) await editor.recipes.packages.save(file);
          const original = window.createImageBitmap.bind(window);
          let decoded: ImageBitmap | undefined;
          let entered!: () => void, release!: () => void;
          const started = new Promise<void>((r) => (entered = r)),
            gate = new Promise<void>((r) => (release = r));
          window.createImageBitmap = (async (...args: any[]) => {
            const image = await (original as any)(...args);
            decoded = image;
            entered();
            await gate;
            return image;
          }) as typeof createImageBitmap;
          let error = "";
          const work = (
            saved
              ? editor.recipes.executeSavedPackage("probe")
              : editor.recipes.executeRecipePackage(file)
          ).catch((e) => {
            error = String(e);
          });
          await started;
          if (transition === "close")
            await editor.closeDocument(target, { discardChanges: true });
          else {
            editor.newDocument({ width: 2, height: 2 });
            editor.activateDocument(target);
          }
          release();
          await work;
          window.createImageBitmap = original;
          return {
            error,
            layers: target.layers.length,
            assets: assets.values().length,
            active: editor.document === target,
            released: decoded?.width === 0,
            historyUnchanged: target.getSnapshot().past.length === history,
          };
        },
        { saved, transition },
      );
      expect(result.error).toContain("Document session changed");
      expect(result.assets).toBe(0);
      expect(result.released).toBe(true);
      expect(result.historyUnchanged).toBe(true);
      expect(result.layers).toBe(0);
    });
