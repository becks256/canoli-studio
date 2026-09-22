import { test, expect } from "@playwright/test";

test("docs highlight examples without JavaScript and keep long code keyboard-scrollable", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    for (const [path, languages] of [
      ["scripting-api", ["javascript"]],
      ["api", ["bash", "http", "json"]],
      ["plugins", ["json"]],
    ] as const) {
      await page.goto(`http://127.0.0.1:4173/developer/${path}.html`);
      for (const language of languages) {
        const code = page.locator(`.syntax-highlighter code.language-${language}`).first();
        await expect(code).toBeVisible();
        expect(await code.locator('span[class^="hljs-"]').count()).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto("http://127.0.0.1:4173/developer/scripting-api.html");
    // Native focusable pre retains text selection/copy and horizontal keyboard scrolling.
    const pre = page.locator(".syntax-highlighter pre").first();
    await pre.focus();
    await expect(pre).toBeFocused();
    await expect(pre).toHaveAttribute("aria-label", "JavaScript code example");
    expect(await pre.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => pre.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("production docs, fragment links and installed plugin commands work without developer globals", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Developer docs", exact: true }).click();
  const guide = await popup;
  await expect(
    guide.getByRole("heading", { name: "Scripting API", exact: true }),
  ).toBeVisible();
  const broken = await guide.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .map((a) => a.hash)
      .filter(
        (hash) => !document.getElementById(decodeURIComponent(hash.slice(1))),
      ),
  );
  expect(broken).toEqual([]);
  await guide
    .getByRole("navigation", { name: "Documentation" })
    .getByRole("link", { name: "Plugins", exact: true })
    .click();
  await expect(
    guide.getByRole("heading", { name: "Plugins and extensions", exact: true }),
  ).toBeVisible();
  await guide.close();
  await page.getByRole("button", { name: "Plugins (Mod+Shift+L)" }).click();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Install plugin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run Add guide frame", exact: true })
    .click();
  await expect(page.getByLabel("Plugin output")).toContainText("Finished.");
  await page
    .getByRole("button", { name: "Close plugins", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Guide frame", exact: true }),
  ).toBeVisible();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.png$/);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("production brush and pencil draw live, commit and undo without developer globals", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Brush tool (B)", exact: true }).click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const image = () => page.locator(".canvas-wrap canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const empty = await image();
  await page.mouse.move(box.x + 70, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 70, { steps: 24 });
  await expect.poll(image).not.toBe(empty);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Select Brush painting", exact: true })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await page.getByRole("button", { name: "Select Brush painting", exact: true }).click();
  await page.getByRole("button", { name: "Pencil tool (N)", exact: true }).click();
  const brush = await image();
  await page.mouse.move(box.x + 70, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 100, { steps: 24 });
  await expect.poll(image).not.toBe(brush);
  await page.mouse.up();
  await page.keyboard.press("Control+z");
  await expect.poll(image).toBe(brush);
  await expect(page.locator(".layer-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("appearance follows the OS, persists overrides, and synchronizes editor and docs", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  const appearance = page.getByRole("combobox", { name: "Appearance", exact: true, includeHidden: true });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveValue("dark");
  const guide = await context.newPage();
  await guide.goto("/developer/scripting-api.html");
  await expect(guide.locator("html")).toHaveAttribute("data-theme", "dark");
  await guide.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(appearance).toHaveValue("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(appearance).toBeFocused();
  await appearance.selectOption("system");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Switch to light mode", exact: true })).toBeFocused();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(guide.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("system");
  await guide.evaluate(() => localStorage.setItem("luma.appearance.v1", "invalid"));
  await expect(appearance).toHaveValue("system");
  await guide.close();
});

test("appearance changes preserve rendered pixels, export bytes, and undo history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Brush tool (B)", exact: true }).click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Undo (Mod+Z)", exact: true })).toBeEnabled();
  const exportBytes = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PNG", exact: true }).click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const image = () => page.locator(".canvas-wrap canvas").evaluate(node => (node as HTMLCanvasElement).toDataURL());
  const before = await exportBytes();
  const pixels = await image();
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) {
      await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await image()).toBe(pixels);
    expect(await exportBytes()).toEqual(before);
  }
  await page.getByRole("button", { name: "Undo (Mod+Z)", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
});

test("appearance works with unavailable storage and docs honor the OS without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
  const staticContext = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
  const guide = await staticContext.newPage();
  await guide.goto("http://127.0.0.1:4173/developer/api.html");
  expect(await guide.locator("body").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(244, 243, 237)");
  await guide.emulateMedia({ colorScheme: "dark" });
  expect(await guide.locator("body").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(24, 28, 27)");
  await staticContext.close();
});
