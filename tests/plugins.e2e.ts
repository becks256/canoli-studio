import { test, expect } from "@playwright/test";
import { examplePlugin } from "../src/plugins";

test("plugins install inertly, execute named commands, undo, persist, update and remove", async ({
  page,
}, info) => {
  const reloadFailures:{path:string;error:string|null}[]=[],pageErrors:string[]=[];
  page.on('requestfailed',request=>{if(request.url().startsWith('http://127.0.0.1:'))reloadFailures.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText??null});});
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Plugins (Mod+Shift+L)" }).click();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await expect(page.getByLabel("Review plugin")).toContainText(
    "read and edit the open document",
  );
  await page
    .getByRole("button", { name: "Install plugin", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Run Add guide frame", exact: true })
    .click();
  await expect(page.getByLabel("Plugin output")).toContainText("Finished.");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.at(-1)?.label,
    ),
  ).toBe("Studio utilities: Add guide frame");
  await page
    .getByRole("button", { name: "Close plugins", exact: true })
    .click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+Shift+l");
  await expect(
    page.getByRole("button", { name: "Run Add guide frame", exact: true }),
  ).toBeVisible();
  await page.getByTestId("plugin-input").setInputFiles({
    name: "update.luma-plugin.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...examplePlugin, version: "1.1.0" })),
  });
  await expect(page.getByLabel("Review plugin")).toContainText(
    "replaces installed version 1.0.0",
  );
  await page
    .getByRole("button", { name: "Replace installed plugin", exact: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Studio utilities", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe(
    "studio.utilities.luma-plugin.json",
  );
  await page.screenshot({ path: info.outputPath("luma-plugins.png") });
  await page
    .getByRole("button", { name: "Remove Studio utilities", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run Add guide frame", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  try{await expect(page.getByRole("button", {name:"History",exact:true})).toBeVisible();}
  catch(error){await info.attach('plugin-reload-errors',{body:JSON.stringify({reloadFailures,pageErrors}),contentType:'application/json'});throw error;}
  expect(
    await page.evaluate(
      () => window.luma.editor.plugins.getSnapshot().plugins.length,
    ),
  ).toBe(0);
});

test("plugin host enforces read permission, rollback, network isolation, cancellation and revision conflicts", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (manifest) => {
    const e = window.luma.editor,
      before = JSON.stringify(e.document.toJSON());
    const run = async (source: string, readOnly = false) => {
      e.plugins.install({
        ...manifest,
        permissions: readOnly
          ? ["document:read"]
          : ["document:read", "document:write"],
        commands: [{ id: "test", title: "Test", source }],
      });
      try {
        return { logs: await e.runPlugin(manifest.id, "test") };
      } catch (error) {
        return { error: (error as Error).message };
      }
    };
    const read = await run("print(document.name);", true);
    const denied = await run('document.name = "denied";', true);
    const thrown = await run(
      'document.name = "wrong"; throw new Error("plugin failed");',
    );
    const network = await run('await fetch("https://example.com");');
    const pending = run(
      'await new Promise(resolve => setTimeout(resolve, 1000)); document.name = "cancelled";',
    );
    e.scripts.cancel();
    const cancelled = await pending;
    const unchanged = before === JSON.stringify(e.document.toJSON());
    const stale = run(
      'await new Promise(resolve => setTimeout(resolve, 500)); document.name = "stale";',
    );
    e.document.name = "New edit";
    const conflict = await stale;
    return {
      read,
      denied,
      thrown,
      network,
      cancelled,
      unchanged,
      conflict,
      name: e.document.name,
    };
  }, examplePlugin);
  expect(result.read.logs).toEqual(["Untitled"]);
  expect(result.denied.error).toContain("document:read");
  expect(result.thrown.error).toContain("plugin failed");
  expect(result.network.error).toBeTruthy();
  expect(result.cancelled.error).toContain("stopped");
  expect(result.unchanged).toBe(true);
  expect(result.conflict.error).toContain("changed");
  expect(result.name).toBe("New edit");
});

test("dynamic permission revocation in UI blocks command execution until re-granted", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Plugins (Mod+Shift+L)" }).click();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Install plugin", exact: true })
    .click();

  // Inspect permissions list
  const permList = page.getByLabel("Permissions for Studio utilities");
  await expect(permList).toBeVisible();
  await expect(permList).toContainText("document:read");
  await expect(permList).toContainText("document:write");

  // Revoke document:write permission
  const revokeBtn = page.getByRole("button", { name: "Revoke document:write" });
  await expect(revokeBtn).toBeVisible();
  await revokeBtn.click();

  // Try running Add guide frame while document:write is revoked
  await page
    .getByRole("button", { name: "Run Add guide frame", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "document:read permission. No edits were applied.",
  );

  // Document layers must remain 0
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(0);

  // Re-grant document:write permission
  const grantBtn = page.getByRole("button", { name: "Grant document:write" });
  await expect(grantBtn).toBeVisible();
  await grantBtn.click();

  // Run Add guide frame again with granted write permission
  await page
    .getByRole("button", { name: "Run Add guide frame", exact: true })
    .click();
  await expect(page.getByLabel("Plugin output")).toContainText("Finished.");

  // Document now has 1 layer
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);

  // Close plugins dialog
  await page
    .getByRole("button", { name: "Close plugins", exact: true })
    .click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
});
