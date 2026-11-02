import { test, expect } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { historyProject, historyPng } from "./helpers/history-inspector";

test("production float wet worker retains every independent HDR word without developer globals", async ({
  page,
}, info) => {
  const workers = (await readdir("dist/assets")).filter((name) =>
    /^pixels\.worker-.*\.js$/.test(name),
  );
  expect(workers).toHaveLength(1);
  const base = "tests/fixtures/float-wet/",
    manifest = JSON.parse(await readFile(base + "manifest.json", "utf8"));
  const raw = Object.fromEntries(
    await Promise.all(
      ["source", "pigment", "carried", "coverage"].map(async (name) => [
        name,
        [...gunzipSync(await readFile(base + name + ".f32le.gz"))],
      ]),
    ),
  );
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  const rows = await page.evaluate(
    async ({ raw, manifest, path }) => {
      const worker = new Worker(path, { type: "module" }),
        decode = (name: string) =>
          new Float32Array(Uint8Array.from(raw[name]).buffer);
      let sequence = 0;
      const result: { name: string; bytes: number[] }[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          worker.onmessage = (event) => {
            if (event.data.type === "ready") resolve();
            else if (event.data.type === "fatal")
              reject(new Error(event.data.error));
          };
          worker.onerror = (event) => reject(new Error(event.message));
        });
        const request = (payload: Record<string, unknown>) =>
          new Promise<any>((resolve, reject) => {
            const id = ++sequence;
            worker.onmessage = (event) => {
              if (event.data.id === id)
                event.data.error
                  ? reject(new Error(event.data.error))
                  : resolve(event.data);
            };
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage({
              id,
              pixels: new Uint8ClampedArray(0),
              ...payload,
            });
          });
        const save = (name: string, value: Float32Array) => {
          if (
            !(value instanceof Float32Array) ||
            value.byteOffset ||
            value.byteLength !== value.buffer.byteLength
          )
            throw new Error("Incomplete native float output.");
          result.push({ name, bytes: [...new Uint8Array(value.buffer)] });
        };
        for (const item of manifest.loads)
          save(
            "load-" + item.name,
            (
              await request({
                floatWetLoad: {
                  pixels: decode("source"),
                  options: item.options,
                },
              })
            ).pixels,
          );
        for (const item of manifest.mixes) {
          const value = (
            await request({
              floatWetMix: {
                pixels: decode("source"),
                carried: decode("carried"),
                coverage: decode("coverage"),
                options: item.options,
              },
            })
          ).floatWetPaint;
          if (value.pixels.buffer === value.carried.buffer)
            throw new Error("Aliased native float outputs.");
          save("mix-" + item.name, value.pixels);
          save("carry-" + item.name, value.carried);
        }
        for (const item of manifest.envelopes)
          save(
            "envelope-" + item.name,
            (
              await request({
                floatWetEnvelope: {
                  before: decode("source"),
                  after: decode("pigment"),
                  coverage: decode("coverage"),
                  opacity: item.opacity,
                },
              })
            ).pixels,
          );
        return result;
      } finally {
        worker.terminate();
      }
    },
    { raw, manifest, path: "/assets/" + workers[0] },
  );
  for (const row of rows) {
    const actual = Buffer.from(row.bytes);
    expect(
      actual.equals(gunzipSync(await readFile(base + row.name + ".f32le.gz"))),
      row.name,
    ).toBe(true);
    await writeFile(info.outputPath(row.name + ".f32le"), actual);
  }
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await writeFile(
    info.outputPath("float-wet-production.json"),
    JSON.stringify(
      {
        worker: workers[0],
        debugGlobals: false,
        rows: rows.map((row) => ({
          name: row.name,
          bytes: row.bytes.length,
          exact: true,
        })),
      },
      null,
      2,
    ),
  );
});

test("production HDR Mixer previews, cancels and commits a source-preserving native stroke without developer globals", async ({
  page,
}, info) => {
  await page.goto("/");
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
  await expect(
    page.getByRole("button", { name: "Smudge tool", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Mixer brush", exact: true }).click();
  await page.keyboard.press("Control+1");
  for (const [label, value] of [
    ["Size value", "8"],
    ["Hardness value", "100"],
    ["Wetness value", "0"],
    ["Pickup value", "0"],
  ] as const) {
    const input = page.getByRole("spinbutton", { name: label, exact: true });
    await input.fill(value);
    await input.press("Enter");
  }
  await page.getByLabel("Foreground color", { exact: true }).fill("#208040");
  await page
    .getByRole("checkbox", { name: "Pressure controls size", exact: true })
    .uncheck();
  const before = await historyProject(page, info, "before.luma"),
    box = (await page.getByTestId("artwork").boundingBox())!,
    at = {
      x: box.x + (24 * box.width) / 131,
      y: box.y + (24 * box.height) / 79,
    };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 4, at.y, { steps: 2 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(
    (await historyProject(page, info, "cancelled.luma")).value.document,
  ).toEqual(before.value.document);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 4, at.y, { steps: 2 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Save project", exact: true }),
  ).toBeEnabled();
  const after = await historyProject(page, info, "authored-hdr.luma"),
    target = after.value.document.children[0];
  if (target.kind !== "raster") throw new Error("No authored raster");
  expect(target.erasures).toHaveLength(1);
  const stroke = target.erasures![0].stroke;
  if (stroke.kind !== "wet") throw new Error("No wet operation");
  expect(stroke.precision).toBe("float32");
  expect(stroke.load.color[3]).toBe(1);
  const original = after.value.entries.find(
    (entry) => entry.id === target.assetId,
  )!;
  expect(Buffer.from(await original.blob.arrayBuffer())).toEqual(
    await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"),
  );
  for (const tile of stroke.tiles)
    for (const id of [tile.assetId, tile.coverage.assetId]) {
      const asset = after.value.entries.find((entry) => entry.id === id)!;
      expect(asset.tiff?.editingPrecision).toBe("float32");
      expect(asset.blob.type).toBe("image/tiff");
    }
  const image = await historyPng(page, info, "hdr-pointer.png");
  expect(image.bytes.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    (await historyProject(page, info, "undo.luma")).value.document,
  ).toEqual(before.value.document);
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  expect(
    (await historyProject(page, info, "redo.luma")).value.document,
  ).toEqual(after.value.document);
  await page.getByTestId("project-input").setInputFiles(after.path);
  expect(
    (await historyProject(page, info, "reopened.luma")).value.document,
  ).toEqual(after.value.document);
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  await writeFile(
    info.outputPath("production-hdr-pointer.json"),
    JSON.stringify(
      {
        nativePairs: stroke.tiles.length,
        precision: stroke.precision,
        load: stroke.load,
        oneUndo: true,
        originalExact: true,
        cancellationExact: true,
        projectExact: true,
        debugGlobals: false,
      },
      null,
      2,
    ),
  );
});
