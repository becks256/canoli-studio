import { test, expect } from "@playwright/test";
import { exifSegment } from "./fixtures/exif";

test("local metadata worker extracts declarations and exports an explicit privacy sidecar", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    async (segment) => {
      const canvas = document.createElement("canvas");
      canvas.width = 12;
      canvas.height = 8;
      canvas.getContext("2d")!.fillRect(0, 0, 12, 8);
      const jpeg = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), "image/jpeg"),
      );
      const file = new File(
        [jpeg.slice(0, 2), new Uint8Array(segment), jpeg.slice(2)],
        "private-source.jpg",
        { type: "image/jpeg" },
      );
      await window.luma.editor.importImage(file);
    },
    [...exifSegment()],
  );
  await page.getByText("Asset info", { exact: true }).click();
  const info = page.getByRole("region", { name: "Asset information" });
  await expect(info).toContainText("Fixture Camera");
  await expect(info).toContainText("<script>private author</script>");
  await expect(info.locator("script")).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await info.getByRole("button", { name: "Export metadata sidecar" }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.format).toBe("luma-asset-metadata");
  expect(
    data.fields.some(
      (field: { privacy: string }) => field.privacy === "private",
    ),
  ).toBe(false);
  expect(
    data.fields.some((field: { label: string }) => field.label === "Artist"),
  ).toBe(true);
  await page.evaluate(async () => {
    const e = window.luma.editor;
    const project = await e.saveProject();
    await e.openProject(new File([project], "reopen.luma"));
    e.document.selectedLayer = e.document.layers.at(0)!;
  });
  await expect(
    page.getByRole("region", { name: "Asset information" }),
  ).toContainText("Fixture Camera");
});

test("authored metadata edits share undo, survive reopen, and work in isolated scripts", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 12;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    await window.luma.editor.importImage(
      new File([blob], "source.png", { type: "image/png" }),
    );
  });
  await page.getByText("Asset info", { exact: true }).click();
  const title = page.getByRole("textbox", {
    name: "Metadata title",
    exact: true,
  });
  await title.fill("Botanical collection");
  await title.press("Enter");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.metadata.title,
    ),
  ).toBe("Botanical collection");
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(title).toHaveValue("");
  await page
    .getByRole("button", { name: "Redo (Mod+Shift+Z)", exact: true })
    .click();
  await expect(title).toHaveValue("Botanical collection");
  await page.evaluate(async () => {
    const e = window.luma.editor;
    await e.runScript(
      'document.selectedLayer.metadata = new LayerMetadata({ title: "Scripted title", creator: "Studio", keywords: ["green", "art"] });',
    );
    const original = e.assetStore.values()[0].blob;
    const saved = await e.saveProject();
    await e.openProject(new File([saved], "metadata.luma"));
    e.document.selectedLayer = e.document.layers.at(0)!;
    const current = e.assetStore.values()[0].blob;
    if (
      [...new Uint8Array(await original.arrayBuffer())].join() !==
      [...new Uint8Array(await current.arrayBuffer())].join()
    )
      throw new Error("Source bytes changed");
  });
  await page.getByText("Asset info", { exact: true }).click();
  await expect(title).toHaveValue("Scripted title");
  await expect(
    page.getByRole("textbox", { name: "Metadata creator", exact: true }),
  ).toHaveValue("Studio");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.toJSON().schemaVersion,
    ),
  ).toBe(5);
});

test("malformed metadata jobs leave editing available and do not block the next extraction", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(
    async (segment) => {
      const servicePath = "/src/intelligence/metadata/service.ts";
      const { MetadataService } = await import(/* @vite-ignore */ servicePath);
      const service = new MetadataService();
      const jpeg = new Blob([
        new Uint8Array([255, 216]),
        new Uint8Array(segment),
        new Uint8Array([255, 217]),
      ]);
      const sources = [
        new Blob([new Uint8Array([0, 1, 2, 3])]),
        jpeg.slice(0, 16),
        jpeg,
      ];
      const before = await Promise.all(
        sources.map((source) =>
          source.arrayBuffer().then((buffer) => [...new Uint8Array(buffer)]),
        ),
      );
      try {
        const finished = new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => {
            unsubscribe();
            reject(new Error("Metadata queue did not finish"));
          }, 28000);
          const unsubscribe = service.subscribe(() => {
            if (
              sources.every(
                (_, i) =>
                  service.get(String(i))?.status !== "pending" &&
                  service.get(String(i)),
              )
            ) {
              clearTimeout(deadline);
              unsubscribe();
              resolve();
            }
          });
        });
        sources.forEach((blob, i) =>
          service.analyze(String(i), {
            blob,
            name: `fixture-${i}.jpg`,
            width: 12,
            height: 8,
          }),
        );
        window.luma.editor.document.name = "Editing while metadata runs";
        await finished;
        const states = sources.map((_, i) => service.get(String(i)));
        const after = await Promise.all(
          sources.map((source) =>
            source.arrayBuffer().then((buffer) => [...new Uint8Array(buffer)]),
          ),
        );
        return {
          states,
          unchanged: JSON.stringify(before) === JSON.stringify(after),
        };
      } finally {
        service.dispose();
      }
    },
    [...exifSegment()],
  );
  expect(results.states[0]).toMatchObject({
    status: "ready",
    result: {
      warnings: expect.arrayContaining([
        expect.stringContaining("could not be read"),
      ]),
    },
  });
  expect(results.states[1]?.status).toBe("ready");
  expect(results.states[2]).toMatchObject({
    status: "ready",
    result: {
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Make", value: "Fixture Camera" }),
      ]),
    },
  });
  expect(results.unchanged).toBe(true);
  await expect(page.getByLabel("Document name", { exact: true })).toHaveValue(
    "Editing while metadata runs",
  );
});
