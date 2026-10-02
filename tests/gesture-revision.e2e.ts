import { test, expect } from "@playwright/test";

for (const kind of ["move", "resize"] as const)
  test(`${kind} cancels when another edit changes the document`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      const editor = window.luma.editor;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 40;
      canvas.getContext("2d")!.fillRect(0, 0, 40, 40);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!)),
      );
      const layer = await editor.importImage(
        new File([blob], "Gesture", { type: "image/png" }),
      );
      editor.document.resize(300, 250);
      layer.update({ x: 60, y: 60 });
    });
    await page
      .getByRole("button", { name: "Move tool (V)", exact: true })
      .click();
    await page.keyboard.press("Control+1");
    const box = (await page.locator(".canvas-wrap").boundingBox())!;
    const handle = (await page
      .locator('.selection-outline [data-handle="se"]')
      .boundingBox())!;
    const start =
      kind === "move"
        ? { x: box.x + 80, y: box.y + 80 }
        : { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 15, { steps: 3 });
    const edited = await page.evaluate(() => {
      const doc = window.luma.editor.document;
      doc.selectedLayer!.update({ x: 140, name: "External change" });
      return {
        snapshot: JSON.stringify(doc.toJSON()),
        revision: doc.getSnapshot().revision,
      };
    });
    await page.mouse.move(start.x + 30, start.y + 25);
    await page.mouse.up();
    expect(
      await page.evaluate(() => ({
        snapshot: JSON.stringify(window.luma.editor.document.toJSON()),
        revision: window.luma.editor.document.getSnapshot().revision,
      })),
    ).toEqual(edited);
    await page.keyboard.press("Control+z");
    expect(
      await page.evaluate(() => window.luma.editor.document.selectedLayer!.x),
    ).toBe(60);
  });
