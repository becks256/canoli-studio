import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readProject } from "../src/core/project";
import { SCHEMA_VERSION } from "../src/core/model";
import { historyProject, historyScript } from "./helpers/history-inspector";
test("production native clone example preserves all float words, originals and one Undo through affine TIFF/project delivery", async ({
  page,
}, info) => {
  const fixture = "tests/fixtures/hdr-wet-document/setup.luma",
    input = await readProject(
      new Blob([new Uint8Array(await readFile(fixture))]),
    ),
    code = (await readFile("docs/FLOAT_CLONE.md", "utf8")).match(
      /<!-- example: float-clone-prepared -->\s*```js\n([\s\S]*?)\n```/,
    )![1];
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page.getByTestId("project-input").setInputFiles(fixture);
  await expect(
    page.getByRole("button", { name: "Select HDR target", exact: true }),
  ).toBeVisible();
  await historyScript(
    page,
    `for(const layer of document.layers){layer.visible=false;if(layer.name==='HDR wet output')layer.name='Native clone source';}const background=document.layers.add(new PaintLayer({name:'Clone backdrop'}));background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:document.width,height:document.height},color:'#ff0000',opacity:.5}));`,
    "Clone backdrop ready",
  );
  const before = await historyProject(page, info, "before.luma");
  const tiff = async (name: string) => {
    await page.getByRole("button", { name: "Export…", exact: true }).click();
    const dialog = page.locator(".export-dialog");
    await dialog.getByLabel("Format", { exact: true }).selectOption("tiff");
    await dialog
      .getByLabel("TIFF precision", { exact: true })
      .selectOption("float32");
    await dialog
      .getByLabel("Use output RGB profile for high-precision TIFF", {
        exact: true,
      })
      .uncheck();
    const pending = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Export .tif", exact: true })
      .click();
    await (await pending).saveAs(info.outputPath(name + ".tif"));
    await expect(dialog).toHaveCount(0);
  };
  await historyScript(page, code, "Production clone ready");
  const native = await historyProject(page, info, "native.luma");
  expect(native.value.document.schemaVersion).toBe(SCHEMA_VERSION);
  await tiff("native");
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    (await historyProject(page, info, "undo.luma")).value.document,
  ).toEqual(before.value.document);
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  expect(
    (await historyProject(page, info, "redo.luma")).value.document,
  ).toEqual(native.value.document);
  await historyScript(
    page,
    "const paint=[...document.layers].find(layer=>layer.name==='Native clone paint');const group=document.layers.add(new LayerGroup({blendMode:'normal'}));paint.moveTo(group);group.x=80.25;group.y=4.5;paint.transform=AffineTransform.scale(-1.5,.75);",
    "Native clone reflected",
  );
  const placed = await historyProject(page, info, "placed.luma");
  await tiff("placed");
  await page.getByTestId("project-input").setInputFiles(placed.path);
  expect(
    (await historyProject(page, info, "reopened.luma")).value.document,
  ).toEqual(placed.value.document);
  await tiff("reopened");
  for (const source of input.entries) {
    const restored = placed.value.entries.find(
      (entry) => entry.id === source.id,
    );
    expect(Buffer.from(await restored!.blob.arrayBuffer())).toEqual(
      Buffer.from(await source.blob.arrayBuffer()),
    );
  }
  await writeFile(
    info.outputPath("float-clone.json"),
    JSON.stringify(
      {
        scope: { x: 0, y: 0, width: 131, height: 79 },
        debugGlobals: false,
        oneUndo: true,
        sourceExact: true,
      },
      null,
      2,
    ),
  );
  const reference = spawnSync(
    "python3",
    ["scripts/check-float-clone.py", info.outputDir, "--tiff"],
    { encoding: "utf8", timeout: 120000 },
  );
  expect(reference.status, reference.stderr || reference.stdout).toBe(0);
  await writeFile(
    info.outputPath("independent-native-clone.json"),
    reference.stdout,
  );
});

test("production Clone source marker and pointer create native TIFF sources with precise history and reopen", async ({
  page,
}, info) => {
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await page
    .getByTestId("project-input")
    .setInputFiles("tests/fixtures/hdr-wet-document/setup.luma");
  await expect(
    page.getByRole("button", { name: "Select HDR target", exact: true }),
  ).toBeVisible();
  await historyScript(
    page,
    `document.resize(64,48);for(const layer of document.layers){layer.visible=false;if(layer.name==='HDR wet output'){layer.visible=true;layer.width=32;layer.height=16;document.selectedLayer=layer;}}`,
    "Native source ready",
  );
  const before = await historyProject(page, info, "pointer-before.luma");
  await page.keyboard.press("s");
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + 4.5, box.y + 4.5);
  await page.keyboard.up("Alt");
  await page.mouse.click(box.x + 50.5, box.y + 30.5);
  await expect(
    page.getByRole("button", { name: "Select Clone retouch", exact: true }),
  ).toBeVisible();
  const after = await historyProject(page, info, "pointer-after.luma"),
    paint = after.value.document.children.find(
      (layer) => layer.kind === "paint" && layer.name === "Clone retouch",
    );
  if (paint?.kind !== "paint" || paint.strokes[0].kind !== "clone")
    throw new Error("No native pointer clone");
  const stroke = paint.strokes[0];
  expect(stroke.precision).toBe("float32");
  for (const tile of stroke.tiles)
    expect(
      after.value.entries.find((entry) => entry.id === tile.assetId)?.tiff
        ?.editingPrecision,
    ).toBe("float32");
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    (await historyProject(page, info, "pointer-undo.luma")).value.document,
  ).toEqual(before.value.document);
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  expect(
    (await historyProject(page, info, "pointer-redo.luma")).value.document,
  ).toEqual(after.value.document);
  await page.getByTestId("project-input").setInputFiles(after.path);
  expect(
    (await historyProject(page, info, "pointer-reopened.luma")).value.document,
  ).toEqual(after.value.document);
  await writeFile(
    info.outputPath("native-clone-pointer-production.json"),
    JSON.stringify(
      {
        native: true,
        oneUndo: true,
        reopenExact: true,
        debugGlobals: false,
        tiles: stroke.tiles.length,
      },
      null,
      2,
    ),
  );
});

test.describe("native clone guide", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  test("documents canonical float sources without JavaScript", async ({
    page,
  }) => {
    await page.goto("/developer/float-clone.html");
    await expect(
      page.getByRole("heading", {
        name: "Native float clone paint",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("schema 58");
    await expect(page.locator("main")).toContainText("unmasked");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
