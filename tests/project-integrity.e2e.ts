import { test, expect } from "@playwright/test";

test("damaged project bytes are rejected without replacing current artwork", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    canvas.getContext("2d")!.fillRect(0, 0, 4, 4);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    await editor.importImage(
      new File([blob], "source.png", { type: "image/png" }),
    );
    const saved = await editor.saveProject();
    const bytes = new Uint8Array(await saved.arrayBuffer());
    const expected = JSON.stringify(editor.document.toJSON());
    const assetIds = editor.assetStore.values().map((a) => a.id);
    const errors = [];
    for (const offset of [60, bytes.length - 1]) {
      const corrupt = bytes.slice();
      corrupt[offset] ^= 1;
      try {
        await editor.openProject(new File([corrupt], "damaged.luma"));
      } catch (e) {
        errors.push(String(e));
      }
      if (JSON.stringify(editor.document.toJSON()) !== expected)
        throw new Error("Current artwork changed");
    }
    await editor.openProject(new File([saved], "valid.luma"));
    return {
      errors,
      signature: bytes[4],
      assets: editor.assetStore.values().map((a) => a.id),
      assetIds,
      same: JSON.stringify(editor.document.toJSON()) === expected,
    };
  });
  expect(result.signature).toBe(51);
  expect(result.errors[0]).toContain("manifest checksum mismatch");
  expect(result.errors[1]).toContain("asset checksum mismatch");
  expect(result.assets).toEqual(result.assetIds);
  expect(result.same).toBe(true);
});

test("save project button awaits hashing and downloads a v3 file", async ({
  page,
}) => {
  await page.goto("/");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.luma$/);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing project download");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString()).toBe("LUMA3");
  const { readProject } = await import("../src/core/project");
  const loaded = await readProject(new Blob([bytes]));
  expect(loaded.document.width).toBeGreaterThan(0);
});

test("edits and document switches during project opening keep current work intact", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const {editor:e, PaintLayer, BrushStroke} = window.luma;
    e.newDocument({width:698,height:396});
    const layer = new PaintLayer({visible:false});
    layer.strokes.add(new BrushStroke({points:Array.from({length:20000}, (_,i) => ({x:i%698,y:i%396,pressure:1}))}));
    e.document.layers.add(layer);
    const blob = await e.saveProject();
    await e.recovery.flush(); await e.workspaceAutosave.flush();
    const results = [];
    for (const switchDocument of [false,true]) {
      e.newDocument({name:"Current work",width:200,height:100});
      const opening = e.openProject(new File([blob],"incoming.luma")).then(() => "opened", error => String(error));
      if (switchDocument) e.newDocument({name:"New active document",width:300,height:200});
      else e.document.name = "Edited during open";
      const current = e.document;
      const expected = current.toJSON();
      const outcome = await opening;
      results.push({outcome, sameDocument:e.document===current, unchanged:JSON.stringify(e.document.toJSON())===JSON.stringify(expected)});
    }
    return results;
  });
  for (const result of results) {
    expect(result.outcome).toContain("document changed while the project was opening");
    expect(result.sameDocument).toBe(true);
    expect(result.unchanged).toBe(true);
  }
});
