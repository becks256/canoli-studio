import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    // Initialize document with a sample raster layer
    const editor = window.luma.editor;
    editor.newDocument({ width: 800, height: 600 });
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#3498db";
    ctx.beginPath();
    ctx.arc(400, 300, 150, 0, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const file = new File([blob], "campaign_hero.png", { type: "image/png" });
    await editor.assetStore.add(file, "campaign_hero.png");

    // Add raster layer to document
    await editor.importImage(file);
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}

test.describe("T15: Resumable Batch Runner & Delivery Manifest E2E", () => {
  test("opens dialog via TopBar Batch button and keyboard shortcut (Mod+Shift+B)", async ({
    page,
  }) => {
    await setup(page);

    // 1. Open via TopBar Batch button
    const topBarBatchBtn = page.getByRole("button", {
      name: "Batch",
      exact: true,
    });
    await expect(topBarBatchBtn).toBeVisible();
    await topBarBatchBtn.click();

    const dialog = page.locator(".batch-dialog");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Resumable Batch Runner & Delivery Manifest",
      }),
    ).toBeVisible();

    // Close via Escape
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // 2. Open via Keyboard Shortcut (Mod+Shift+B)
    await page.keyboard.press("Control+Shift+B");
    await expect(dialog).toBeVisible();

    // Close via Close button
    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await closeBtn.click();
    await expect(dialog).toHaveCount(0);
  });

  test("configures, starts batch run, verifies runner progress and review manifest", async ({
    page,
  }) => {
    await setup(page);

    // Open Batch dialog
    await page.getByRole("button", { name: "Batch", exact: true }).click();
    const dialog = page.locator(".batch-dialog");
    await expect(dialog).toBeVisible();

    // 1. Setup Tab Configuration
    const batchNameInput = page.locator("#batch-name");
    await batchNameInput.fill("Summer Launch Variant Pack");

    // Select a Recipe
    const recipeSelect = page.locator("#recipe-select");
    await recipeSelect.selectOption({ index: 1 }); // Choose first preset

    // Add items to queue
    await page.getByRole("button", { name: "+ Canvas" }).click();
    await page.getByRole("button", { name: "+ Demo Samples" }).click();

    // Verify items in queue list
    const queueItems = page.locator(".queue-item");
    await expect(queueItems).toHaveCount(4); // 1 canvas + 3 samples

    // Verify preflight estimate banner
    const estimateBanner = page.locator(".estimate-banner");
    await expect(estimateBanner).toBeVisible();
    await expect(estimateBanner).toContainText("Budget Approved");

    // 2. Launch Batch Run
    const startBtn = page.getByRole("button", {
      name: "Start Resumable Batch",
    });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Dialog transitions to Runner & Controls tab
    await expect(
      dialog.getByRole("tab", { name: "Runner & Controls" }),
    ).toHaveClass(/active/);

    // Wait for batch completion
    await expect(page.locator(".status-pill.completed")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator(".progress-label")).toContainText(
      "100% complete",
    );

    // Succeeded count should equal total items (4)
    const succeededCount = page.locator(".metric-box.succeeded .metric-value");
    await expect(succeededCount).toHaveText("4");

    // 3. Switch to Review & Manifest Tab
    await dialog.getByRole("tab", { name: /Review Grid & Manifest/ }).click();

    // Verify review cards rendered
    const reviewCards = page.locator(".review-card");
    await expect(reviewCards).toHaveCount(4);

    // Perform Human Review Action on first item: Approve
    const firstApproveBtn = reviewCards
      .first()
      .locator(".review-action-btn.approve");
    await firstApproveBtn.click();
    await expect(reviewCards.first().locator(".review-badge")).toHaveText(
      "approved",
    );

    // Verify Cryptographic Integrity
    const verifyIntegrityBtn = page.getByRole("button", {
      name: "Verify Integrity",
    });
    await verifyIntegrityBtn.click();
    const verificationAlert = page.locator(".batch-alert.success");
    await expect(verificationAlert).toBeVisible();
    await expect(verificationAlert).toContainText(
      "Delivery Manifest Cryptographically Verified",
    );

    // Verify Manifest and Package buttons are enabled
    const manifestJsonBtn = page.getByRole("button", {
      name: "Manifest (JSON)",
    });
    const packageZipBtn = page.getByRole("button", {
      name: "Delivery Package (.ZIP)",
    });
    await expect(manifestJsonBtn).toBeEnabled();
    await expect(packageZipBtn).toBeEnabled();
    await reviewCards.first().locator(".review-action-btn.reject").click();
    await expect(reviewCards.first().locator(".review-badge")).toHaveText(
      "rejected",
    );
    await expect(verificationAlert).toHaveCount(0);

    // Hold one real storage read so the cancellation control is deterministically reachable.
    await page.evaluate(() => {
      const storage = window.luma.editor.batch.storage;
      const original = storage.getDeliverableBlob.bind(storage);
      let first = true;
      storage.getDeliverableBlob = async (id) => {
        if (first) {
          first = false;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        return original(id);
      };
    });
    let downloads = 0;
    page.on("download", () => downloads++);
    await packageZipBtn.click();
    await dialog
      .getByRole("button", { name: "Cancel export", exact: true })
      .click();
    await expect(packageZipBtn).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel export", exact: true }),
    ).toHaveCount(0);
    expect(downloads).toBe(0);
    const download = page.waitForEvent("download");
    await packageZipBtn.click();
    expect((await download).suggestedFilename()).toMatch(
      /^delivery-package-.*\.zip$/,
    );
  });
});

test("batch setup selects a portable package and captures it in the created run", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { serializeRecipePackage } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/package.ts")
    );
    const file = await serializeRecipePackage(
      {
        schemaVersion: 1,
        id: "batch-ui-package",
        name: "Portable watermark",
        description: "",
        version: 1,
        parameters: [
          {
            name: "label",
            label: "Output title",
            type: "string",
            required: true,
          },
          {
            name: "opacity",
            label: "Artwork opacity",
            type: "number",
            min: 0,
            max: 1,
            required: true,
          },
        ],
        steps: [
          {
            id: "rename",
            name: "Rename",
            action: { type: "document.rename", name: "${label}" },
          },
          {
            id: "opacity",
            name: "Opacity",
            target: { role: "selected" },
            action: { type: "layer.update", patch: { opacity: "${opacity}" } },
          },
        ],
      },
      editor.assetStore,
    );
    await editor.recipes.packages.save(file);
  });
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  await page.locator("#recipe-select").selectOption({ index: 1 });
  await expect(
    page.locator('#package-select option[value="batch-ui-package"]'),
  ).toHaveCount(1);
  await page
    .getByLabel("Portable Recipe (Optional)")
    .selectOption("batch-ui-package");
  await expect(page.locator("#recipe-select")).toHaveValue("");
  await page.getByRole("button", { name: "+ Canvas", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start Resumable Batch" }),
  ).toBeDisabled();
  await page
    .getByRole("group", { name: "Batch recipe parameters" })
    .getByLabel("Output title")
    .fill("Processed artwork");
  await page
    .getByRole("group", { name: "Batch recipe parameters" })
    .getByLabel("Artwork opacity")
    .fill("2");
  await expect(page.locator(".estimate-banner")).toContainText(
    "exceeds maximum",
  );
  await expect(
    page.getByRole("button", { name: "Start Resumable Batch" }),
  ).toBeDisabled();
  await page
    .getByRole("group", { name: "Batch recipe parameters" })
    .getByLabel("Artwork opacity")
    .fill("0.5");
  await page.getByRole("button", { name: "+ Canvas", exact: true }).click();
  const second = page.locator(".queue-item").nth(1);
  await second.locator("summary").click();
  await second.getByLabel("Override Artwork opacity", { exact: true }).check();
  await second.getByLabel("Artwork opacity *", { exact: true }).fill("2");
  await expect(page.locator(".estimate-banner")).toContainText(
    "exceeds maximum",
  );
  await second.getByLabel("Artwork opacity *", { exact: true }).fill("0.25");
  await expect(page.locator(".estimate-banner")).toContainText(
    "Budget Approved",
  );
  await page.getByRole("button", { name: "Start Resumable Batch" }).click();
  await expect(page.locator(".status-pill.completed")).toBeVisible({
    timeout: 60000,
  });
  const captured = await page.evaluate(async () => {
    const run = (await window.luma.editor.batch.listRuns())[0];
    const alpha: number[] = [];
    for (const item of run.items) {
      const output = item.deliverables.find(
        (delivery) => delivery.format === "png",
      )!;
      const blob = await window.luma.editor.batch.storage.getDeliverableBlob(
        output.id,
      );
      const bitmap = await createImageBitmap(blob!);
      const canvas = new OffscreenCanvas(1, 1);
      const context = canvas.getContext("2d")!;
      context.drawImage(
        bitmap,
        bitmap.width / 2,
        bitmap.height / 2,
        1,
        1,
        0,
        0,
        1,
        1,
      );
      bitmap.close();
      alpha.push(context.getImageData(0, 0, 1, 1).data[3]);
    }
    return {
      packageId: run.config.recipePackageId,
      blob: run.config.recipePackageSnapshot instanceof Blob,
      alpha,
      overrides: run.items.map((item) => item.parameters),
      opacity: run.items[0].checkpoint?.children[0].opacity,
      name: run.items[0].checkpoint?.name,
      status: run.items[0].status,
    };
  });
  await page.reload();
  const persisted = await page.evaluate(
    async () =>
      (await window.luma.editor.batch.listRuns())[0].items[1].parameters,
  );
  expect(persisted).toEqual({ opacity: "0.25" });
  expect(captured).toEqual({
    packageId: "batch-ui-package",
    blob: true,
    alpha: [128, 64],
    overrides: [undefined, { opacity: "0.25" }],
    opacity: 0.5,
    name: "Processed artwork",
    status: "succeeded",
  });
});

test("batch preflight visibly rejects enabled AI steps and accepts skipped steps", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    await window.luma.editor.recipes.saveRecipe({
      schemaVersion: 1,
      id: "conditional-ai-ui",
      name: "Conditional generation",
      description: "",
      version: 1,
      parameters: [
        {
          name: "generate",
          label: "Generate artwork",
          type: "boolean",
          default: true,
        },
      ],
      steps: [
        {
          id: "ai",
          name: "AI artwork",
          condition: { param: "generate", op: "truthy" },
          action: {
            type: "ai.generate",
            modality: "text-to-image",
            prompt: "Artwork",
          },
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  await page.locator("#recipe-select").selectOption("conditional-ai-ui");
  await page.getByRole("button", { name: "+ Canvas", exact: true }).click();
  await expect(page.locator(".estimate-banner")).toContainText("ai.generate");
  await expect(
    page.getByRole("button", { name: "Start Resumable Batch" }),
  ).toBeDisabled();
  await page
    .getByRole("group", { name: "Batch recipe parameters" })
    .getByLabel("Generate artwork")
    .selectOption("false");
  await expect(page.locator(".estimate-banner")).toContainText(
    "Budget Approved",
  );
  await expect(
    page.getByRole("button", { name: "Start Resumable Batch" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      async () => (await window.luma.editor.batch.listRuns()).length,
    ),
  ).toBe(0);
});

test("batch uploads retain decoded dimensions and reject an unreadable selection atomically", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(37, 53);
    canvas.getContext("2d");
    return [
      ...new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      ),
    ];
  });
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  const upload = page.getByLabel("Upload batch images");
  const valid = {
    name: "portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  };
  await upload.setInputFiles(valid);
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await expect(page.locator(".queue-item-meta")).toContainText("37×53");
  await upload.setInputFiles([
    valid,
    {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("invalid image"),
    },
  ]);
  await expect(page.locator(".batch-alert.error")).toContainText(
    "Cannot decode 'broken.png'",
  );
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await upload.setInputFiles(valid);
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await expect(page.locator(".queue-item-meta").nth(1)).toContainText("37×53");
});

test("legacy outputs without source provenance remain reviewable but cannot be certified or packaged", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const batch = window.luma.editor.batch;
    const run = await batch.createBatch(
      { name: "Legacy provenance", budgetId: "default-budget" },
      [
        {
          id: "legacy-source",
          name: "original.png",
          width: 8,
          height: 8,
          mimeType: "image/png",
          byteLength: 10,
        },
      ],
    );
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.items[0].status = "succeeded";
    run.items[0].deliverables = [
      {
        id: "legacy-output",
        itemId: run.items[0].id,
        variantId: "square",
        variantName: "Square",
        format: "png",
        width: 8,
        height: 8,
        aspectRatio: "1:1",
        fileName: "legacy.png",
        byteLength: 10,
        sha256: "a".repeat(64),
        createdAt: new Date().toISOString(),
      },
    ];
    run.summary.pending = 0;
    run.summary.succeeded = 1;
    await batch.storage.saveRun(run);
  });
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  const dialog = page.locator(".batch-dialog");
  await dialog.getByRole("tab", { name: /Review Grid/ }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Source provenance is unavailable",
  );
  await expect(
    dialog.getByRole("button", { name: "Manifest (JSON)" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Verify Integrity" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Delivery Package (.ZIP)" }).click();
  await expect(dialog).toContainText("Source provenance is unavailable");
  const error = await page.evaluate(async () => {
    const batch = window.luma.editor.batch;
    const run = (await batch.listRuns())[0];
    try {
      await batch.exportDeliveryPackageZip(run.id);
      return "";
    } catch (error) {
      return String(error);
    }
  });
  expect(error).toContain("Source provenance is unavailable");
});

test("long variant IDs and colliding long filenames retain real outputs across reload", async ({
  page,
}) => {
  await page.goto("/");
  const runId = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ef2345";
    context.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const batch = window.luma.editor.batch;
    const run = await batch.createBatch(
      {
        name: "Long variant ID",
        budgetId: "default-budget",
        outputNamingTemplate: "a".repeat(180),
        variants: [16, 32].map((width) => ({
          id: String(width).padEnd(64, "v"),
          name: `Variant ${width}`,
          targetWidth: width,
          targetHeight: 16,
          format: "png",
          fit: "contain",
        })),
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 16,
          height: 16,
          mimeType: "image/png",
          byteLength: blob.size,
          blob,
        },
      ],
    );
    await batch.start(run.id);
    await batch.waitForRun(run.id);
    return run.id;
  });
  await page.reload();
  const result = await page.evaluate(async (id) => {
    const batch = window.luma.editor.batch;
    const run = (await batch.getRun(id))!;
    const manifestModule = "/src/ai/batch/manifest.ts";
    const { verifyDeliveryManifest } = await import(
      /* @vite-ignore */ manifestModule
    );
    const manifest = run.deliveryManifest!;
    const zip = await batch.exportDeliveryPackageZip(id);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const files: { name: string; width: number; height: number }[] = [];
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(
        bytes.subarray(offset + 30, offset + 30 + nameLength),
      );
      const start =
        offset + 30 + nameLength + view.getUint16(offset + 28, true);
      const end = start + view.getUint32(offset + 18, true);
      if (name.startsWith("deliverables/")) {
        const image = await createImageBitmap(
          new Blob([bytes.slice(start, end)], { type: "image/png" }),
        );
        files.push({ name, width: image.width, height: image.height });
        image.close();
      }
      offset = end;
    }
    const bitmap = await createImageBitmap(
      (await batch.getDeliverableBlob(manifest.deliverables[0].deliverableId))!,
    );
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      status: run.status,
      verified: (await verifyDeliveryManifest(manifest)).valid,
      files,
      signature: [...new Uint8Array(await zip.slice(0, 4).arrayBuffer())],
      pixel: [...context.getImageData(8, 8, 1, 1).data],
    };
  }, runId);
  expect(result).toEqual({
    status: "completed",
    verified: true,
    signature: [80, 75, 3, 4],
    pixel: [239, 35, 69, 255],
    files: [
      { name: `deliverables/${"a".repeat(180)}.png`, width: 16, height: 16 },
      { name: `deliverables/${"a".repeat(178)}_2.png`, width: 32, height: 16 },
    ],
  });
});

test("Unicode source names produce independently readable ZIP outputs after reload", async ({
  page,
}) => {
  await page.goto("/");
  const id = await page.evaluate(async () => {
    const sources = await Promise.all(
      ["😀", "𠀀"].map(async (suffix, i) => {
        const canvas = new OffscreenCanvas(16, 16),
          ctx = canvas.getContext("2d")!;
        ctx.fillStyle = i ? "#0000ff" : "#ff0000";
        ctx.fillRect(0, 0, 16, 16);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return {
          id: `s${i}`,
          name: "a".repeat(179) + suffix + ".png",
          width: 16,
          height: 16,
          mimeType: "image/png",
          byteLength: blob.size,
          blob,
        };
      }),
    );
    const batch = window.luma.editor.batch;
    const run = await batch.createBatch(
      {
        name: "Unicode",
        budgetId: "default-budget",
        outputNamingTemplate: "{name}",
        variants: [
          {
            id: "small",
            name: "Small",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "fill",
          },
        ],
      },
      sources,
    );
    await batch.start(run.id);
    await batch.waitForRun(run.id);
    return run.id;
  });
  await page.reload();
  const result = await page.evaluate(async (id) => {
    const batch = window.luma.editor.batch,
      run = (await batch.getRun(id))!;
    const bytes = new Uint8Array(
      await (await batch.exportDeliveryPackageZip(id)).arrayBuffer(),
    );
    const view = new DataView(bytes.buffer),
      files = new Map<string, number[]>();
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const length = view.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(
        bytes.subarray(offset + 30, offset + 30 + length),
      );
      const start = offset + 30 + length + view.getUint16(offset + 28, true);
      const end = start + view.getUint32(offset + 18, true);
      if (name.startsWith("deliverables/")) {
        const bitmap = await createImageBitmap(
          new Blob([bytes.slice(start, end)], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(16, 16),
          ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        files.set(name, [...ctx.getImageData(8, 8, 1, 1).data]);
      }
      offset = end;
    }
    return {
      count: files.size,
      colors: run.deliveryManifest!.deliverables.map((d) =>
        files.get(d.filePath),
      ),
    };
  }, id);
  expect(result).toEqual({
    count: 2,
    colors: [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ],
  });
});
