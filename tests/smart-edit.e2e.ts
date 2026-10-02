import { expect, test } from "@playwright/test";

test("contents tabs apply imported pixels to all instances with parent undo and independent asset ownership", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    editor.newDocument({ name: "Composition", width: 48, height: 24 });
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const asset = await editor.assetStore.add(blob, "Red", undefined, false);
    const photo = editor.document.layers.add(
      new RasterLayer({
        assetId: asset.id,
        width: 16,
        height: 16,
        name: "Artwork",
      }),
    );
    const instance = photo.convertToSmartObject();
    editor.document.placeSmartObject(instance.componentId, { x: 24 });
    editor.document.selectedLayer = instance;
  });
  await page
    .getByRole("button", { name: "Edit contents", exact: true })
    .click();
  const bar = page.getByRole("region", { name: "Smart-object contents" });
  await expect(bar).toContainText("Composition");
  await expect(
    bar.getByRole("button", { name: "Apply to source" }),
  ).toBeDisabled();
  const before = await page.evaluate(async () => {
    const { editor } = window.luma;
    const contents = editor.document;
    const owner = editor.openDocuments.find(
      (document) => document !== contents,
    )!;
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#0000ff";
    context.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await editor.importImage(
      new File([blob], "Blue.png", { type: "image/png" }),
    );
    const rendered = await editor.renderer.render(
      owner.toJSON(),
      owner.assetStore!,
      { readback: true },
    );
    const color = [...rendered.getContext("2d")!.getImageData(8, 8, 1, 1).data];
    rendered.width = rendered.height = 0;
    return {
      color,
      history: owner.getSnapshot().past.length,
      sourceCount: owner.assetStore!.values().length,
    };
  });
  expect(before.color).toEqual([255, 0, 0, 255]);
  expect(before.sourceCount).toBe(1);
  await bar.getByRole("button", { name: "Apply to source" }).click();
  await expect(bar).toContainText("No pending contents changes");
  const after = await page.evaluate(async () => {
    const { editor } = window.luma;
    const contents = editor.document,
      owner = editor.openDocuments.find((document) => document !== contents)!;
    async function sample() {
      const rendered = await editor.renderer.render(
        owner.toJSON(),
        owner.assetStore!,
        { readback: true },
      );
      const result = [8, 32].map((x) => [
        ...rendered.getContext("2d")!.getImageData(x, 8, 1, 1).data,
      ]);
      rendered.width = rendered.height = 0;
      return result;
    }
    const applied = await sample();
    const history = owner.getSnapshot().past.length;
    owner.undo();
    const undo = await sample();
    owner.redo();
    await editor.closeDocument(contents, { discardChanges: true });
    const afterClose = await sample();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "applied.luma"));
    const rendered = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { readback: true },
    );
    const reopened = [
      ...rendered.getContext("2d")!.getImageData(8, 8, 1, 1).data,
    ];
    rendered.width = rendered.height = 0;
    return { applied, undo, afterClose, reopened, history };
  });
  const red = [255, 0, 0, 255],
    blue = [0, 0, 255, 255];
  expect(after).toEqual({
    applied: [blue, blue],
    undo: [red, red],
    afterClose: [blue, blue],
    reopened: blue,
    history: before.history + 1,
  });
});

for (const closeOwner of [false, true])
  test(`late contents apply rejects ${closeOwner ? "closed" : "changed"} owners without publishing imported assets`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (closeOwner) => {
      const { editor, Document, TextLayer } = window.luma;
      const owner = editor.newDocument({ name: "Owner" });
      const master = new Document();
      master.layers.add(new TextLayer({ text: "Original" }));
      const instance = owner.placeSmartObject(owner.defineComponent(master));
      const contents = await editor.editSmartObject(instance);
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
      await editor.importImage(
        new File(
          [await canvas.convertToBlob({ type: "image/png" })],
          "New.png",
          { type: "image/png" },
        ),
      );
      const original = window.createImageBitmap;
      let resume!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      window.createImageBitmap = (async (
        ...args: Parameters<typeof original>
      ) => {
        entered();
        await gate;
        return Reflect.apply(original, window, args);
      }) as typeof original;
      const applying = editor.applySmartObjectContents(contents).then(
        () => "",
        (error) => String(error),
      );
      await started;
      if (closeOwner)
        await editor.closeDocument(owner, { discardChanges: true });
      else owner.name = "Changed owner";
      const expected = owner.toJSON();
      resume();
      const error = await applying;
      window.createImageBitmap = original;
      return {
        error,
        unchanged: JSON.stringify(owner.toJSON()) === JSON.stringify(expected),
        ownerAssets: owner.assetStore!.values().length,
        contentsAssets: contents.assetStore!.values().length,
        retained: editor.openDocuments.includes(contents),
        pending: editor.getSnapshot().smartObjectEdit?.changed,
      };
    }, closeOwner);
    expect(result.error).toMatch(/disposed|changed|closed/);
    expect(result).toMatchObject({
      unchanged: true,
      ownerAssets: 0,
      contentsAssets: 1,
      retained: true,
      pending: true,
    });
  });
