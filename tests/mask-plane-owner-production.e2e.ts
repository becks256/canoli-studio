import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import {
  historyPng,
  historyProject,
  historyScript,
} from "./helpers/history-inspector";

test("production float preview follows retained-mask perspective reset and basis edits with exact PNG references and Undo", async ({
  page,
}, info) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByTestId("import-input")
    .setInputFiles("tests/fixtures/tiff-float/rgba-raw-le.tif");
  const dialog = page.getByRole("dialog", { name: "Import TIFF", exact: true });
  await dialog
    .getByLabel("TIFF editing precision", { exact: true })
    .selectOption("float32");
  await dialog
    .getByRole("button", { name: "Import TIFF page", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select rgba-raw-le.tif", exact: true })
    .click();
  await historyScript(
    page,
    "document.selectedLayer.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:20,y:10,width:60,height:40})});",
    "Rectangle ready",
  );
  await page.keyboard.press("Control+1");
  const check = async (name: string) => {
    const png = await historyPng(page, info, name + ".png");
    const expected = await page.evaluate(
      async (bytes) => {
        const image = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          ),
          canvas = new OffscreenCanvas(131, 79);
        try {
          canvas.getContext("2d")!.drawImage(image, 0, 0);
          return [...canvas.getContext("2d")!.getImageData(0, 0, 131, 79).data];
        } finally {
          image.close();
        }
      },
      [...png.bytes],
    );
    const sample = () =>
      page.getByTestId("artwork").evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: [
            ...canvas
              .getContext("2d")!
              .getImageData(0, 0, canvas.width, canvas.height).data,
          ],
        };
      });
    await expect
      .poll(async () => {
        const actual = await sample();
        return (
          actual.width === 131 &&
          actual.height === 79 &&
          actual.pixels.every((v, i) => v === expected[i])
        );
      })
      .toBe(true);
    const actual = await sample();
    await writeFile(
      info.outputPath(name + "-foreground.rgba8"),
      new Uint8Array(actual.pixels),
    );
    return {
      pixels: actual.pixels,
      visible: actual.pixels.filter((v, i) => i % 4 === 3 && v > 0).length,
    };
  };
  const before = await historyProject(page, info, "owner-before.luma"),
    baseline = await check("legacy-mask");
  await historyScript(
    page,
    "const layer=document.selectedLayer;layer.setMaskLinked(false);layer.perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.5,y:.5},{x:0,y:.5}]});layer.setMaskLinked(true);layer.perspective=null;",
    "Retained perspective reset ready",
  );
  const reset = await historyProject(page, info, "owner-reset.luma"),
    resetPixels = await check("reset-mask");
  expect(resetPixels.visible).toBeGreaterThan(baseline.visible);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    (await historyProject(page, info, "owner-undo.luma")).value.document,
  ).toEqual(before.value.document);
  await check("undo-mask");
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  expect(
    (await historyProject(page, info, "owner-redo.luma")).value.document,
  ).toEqual(reset.value.document);
  await check("redo-mask");
  await historyScript(
    page,
    "const layer=document.selectedLayer,plane=layer.mask.plane;layer.mask=layer.mask.with({plane:new MaskPlane({reference:plane.reference,basis:AffineTransform.rotation(.13),pose:plane.pose,steps:plane.steps,phase:plane.phase})});",
    "Retained basis ready",
  );
  const changed = await historyProject(page, info, "owner-basis.luma"),
    basisPixels = await check("basis-mask");
  expect(basisPixels.pixels.some((v, i) => v !== resetPixels.pixels[i])).toBe(
    true,
  );
  await page.getByTestId("project-input").setInputFiles(changed.path);
  expect(
    (await historyProject(page, info, "owner-reopened.luma")).value.document,
  ).toEqual(changed.value.document);
  await check("reopened-mask");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await writeFile(
    info.outputPath("production-retained-cache.json"),
    JSON.stringify(
      {
        debugGlobals: false,
        beforeVisible: baseline.visible,
        resetVisible: resetPixels.visible,
        basisVisible: basisPixels.visible,
        pngReferencesExact: true,
        sharedUndo: true,
        reopenedExact: true,
      },
      null,
      2,
    ),
  );
});
