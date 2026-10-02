import { expect, test } from "@playwright/test";

for (const direction of ["source", "destination"])
  test(`patch ${direction} gesture previews placement, commits once and cancels without edits`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async (direction) => {
      const editor = window.luma.editor;
      editor.newDocument({ width: 160, height: 100 });
      const canvas = new OffscreenCanvas(160, 100),
        c = canvas.getContext("2d")!;
      c.fillStyle = "#646464";
      c.fillRect(0, 0, 80, 100);
      c.fillStyle = "#a0a0a0";
      c.fillRect(80, 0, 80, 100);
      c.fillStyle = "#bebebe";
      c.fillRect(104, 34, 1, 1);
      await editor.importImage(
        new File([await canvas.convertToBlob()], "base.png", {
          type: "image/png",
        }),
      );
      editor.document.selection = new window.luma.MarqueeSelection({
        shape: "rectangle",
        x: direction === "source" ? 42 : 102,
        y: 32,
        width: 5,
        height: 5,
      });
    }, direction);
    await page
      .getByRole("button", { name: "Move tool (V)", exact: true })
      .click();
    await page.keyboard.press("Control+1");
    await page.keyboard.press("j");
    await expect(
      page.getByRole("button", { name: "Patch tool (J)", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Patch sampling")).toHaveValue("all-layers");
    await page.getByLabel("Patch detail").selectOption("mixed");
    await page.getByLabel("Patch detail").selectOption("source");
    await page
      .getByLabel("Patch mode", { exact: true })
      .selectOption(direction);
    const outline = page.getByTestId(
      direction === "source"
        ? "patch-donor-outline"
        : "patch-destination-outline",
    );
    const before = await page.evaluate(() =>
      JSON.stringify(window.luma.editor.document.toJSON()),
    );
    const history = await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    );
    const box = (await page.locator(".canvas-wrap").boundingBox())!;
    const drag = async () => {
      await page.mouse.move(
        box.x + (direction === "source" ? 44 : 104),
        box.y + 34,
      );
      await page.mouse.down();
      await page.mouse.move(
        box.x + (direction === "source" ? 104 : 44),
        box.y + 34,
        { steps: 5 },
      );
    };
    await drag();
    await expect(outline).toHaveAttribute(
      "transform",
      direction === "source" ? "translate(60 0)" : "translate(-60 0)",
    );
    expect(
      await page.evaluate(() => window.luma.editor.document.layers.length),
    ).toBe(1);
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(() => window.luma.editor.document.layers.length),
      )
      .toBe(2);
    expect(
      await page.evaluate(
        () => window.luma.editor.document.getSnapshot().past.length,
      ),
    ).toBe(history + 1);
    const pixel = await page.evaluate(async () => {
      const editor = window.luma.editor;
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const context = surface.getContext("2d")!;
      const pixel = [...context.getImageData(44, 34, 1, 1).data];
      const donor = [...context.getImageData(104, 34, 1, 1).data];
      surface.width = surface.height = 0;
      return { pixel, donor };
    });
    expect(pixel).toEqual({
      pixel: [130, 130, 130, 255],
      donor: [190, 190, 190, 255],
    });
    await page.keyboard.press("Control+z");
    expect(
      await page.evaluate(() =>
        JSON.stringify(window.luma.editor.document.toJSON()),
      ),
    ).toBe(before);
    await drag();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(outline).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.stringify(window.luma.editor.document.toJSON()),
      ),
    ).toBe(before);
  });
