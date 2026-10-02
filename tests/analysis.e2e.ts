import { test, expect } from "@playwright/test";

test("local pixel heuristics expose honest capabilities and candidate rejection updates immediately", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, 400, 300);
    c.fillStyle = "#20b030";
    c.fillRect(70, 70, 200, 160);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    await window.luma.editor.importImage(
      new File([blob], "portrait-nature-OCR-secret.png", { type: "image/png" }),
    );
  });
  await page.getByText("Asset info", { exact: true }).click();
  const section = page.getByRole("region", {
    name: "Content analysis and candidate suggestions",
  });
  await expect(section).toContainText("OCR and cloud analysis are unavailable");
  await expect(
    section.getByRole("button", { name: "Detect text (OCR)" }),
  ).toHaveCount(0);
  await expect(section.getByRole("radio")).toHaveCount(0);
  await section.getByRole("button", { name: "Suggest keywords" }).click();
  const shelf = section.getByRole("region", {
    name: "Analysis candidate shelf",
  });
  await expect(shelf).not.toContainText("Keyword: portrait");
  await expect(shelf).not.toContainText("Keyword: nature");
  const first = shelf.locator(".candidate-card").first();
  const before = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().past.length,
  );
  await first.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Accept keyword" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(before);
  const next = shelf.locator(".candidate-card").nth(1);
  await next.getByRole("button", { name: "Accept keyword" }).click();
  await expect(next).toContainText("Accepted");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.metadata.keywords.length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.metadata.keywords.length,
    ),
  ).toBe(0);
  await section.getByRole("button", { name: "Propose contrast mask" }).click();
  const mask = shelf
    .locator(".candidate-card")
    .filter({ hasText: "Contrast bounding mask" })
    .first();
  await mask.getByRole("button", { name: "Apply layer mask" }).click();
  await expect(mask).toContainText("Accepted");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.mask?.kind,
    ),
  ).toBe("selection");
});
