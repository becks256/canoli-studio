import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    const journal = new GenerationJournal();
    const initialBudget = {
      approvedCeilingCents: 100,
      consentGiven: true,
      approverId: "artist",
      spentSoFarCents: 0,
      approvalTimestamp: new Date().toISOString(),
    };
    await journal.reserve({
      jobId: "queued-recovery",
      budgetId: "default-budget",
      providerId: "fixture-provider",
      requestFingerprint: "queued-request",
      estimatedCostCents: 10,
      initialBudget,
    });
    await journal.reserve({
      jobId: "pending-recovery",
      budgetId: "default-budget",
      providerId: "fixture-provider",
      requestFingerprint: "pending-request",
      estimatedCostCents: 20,
      initialBudget,
    });
    await journal.beginDispatch("pending-recovery");
  });
  await page.reload();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const summary = page.locator(".generation-recovery > summary");
  await expect(summary).toHaveText("Unfinished generation requests (2)");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Unfinished generation requests" }),
  ).toBeVisible();
}

const queuedRow = (page: Page) =>
  page.locator('[data-job-id="queued-recovery"]');
const pendingRow = (page: Page) =>
  page.locator('[data-job-id="pending-recovery"]');
const budget = (page: Page) =>
  page
    .locator(".ledger-row")
    .filter({ hasText: "Available Approved Ceiling:" });

test("recovery panel survives reload and releases only an undispatched reservation", async ({
  page,
}) => {
  await seed(page);
  await expect(budget(page)).toContainText("70.0¢");
  await expect(pendingRow(page)).toContainText("final charge not confirmed");
  await expect(pendingRow(page).getByRole("button")).toHaveCount(0);
  await queuedRow(page)
    .getByRole("button", { name: "Cancel queued request" })
    .click();
  await expect(queuedRow(page)).toHaveCount(0);
  await expect(budget(page)).toContainText("80.0¢");
  const state = await page.evaluate(async () => {
    const entries = await window.luma.editor.ai.recoveredAccounting();
    let error = "";
    try {
      await window.luma.editor.ai.cancelRecoveredQueued("pending-recovery");
    } catch (value) {
      error = String(value);
    }
    return { entries, error };
  });
  expect(
    state.entries.find((entry) => entry.jobId === "queued-recovery"),
  ).toMatchObject({ billingState: "settled", actualCostCents: 0 });
  expect(state.error).toContain("Only an undispatched job");
  await page.reload();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".generation-recovery > summary")).toHaveText(
    "Unfinished generation requests (1)",
  );
  await expect(budget(page)).toContainText("80.0¢");
});

test("stale recovery actions cannot release a request dispatched by another tab", async ({
  page,
  context,
}) => {
  await seed(page);
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    await new GenerationJournal().beginDispatch("queued-recovery");
  });
  await queuedRow(page)
    .getByRole("button", { name: "Cancel queued request" })
    .click();
  await expect(
    page.locator('.generation-recovery [role="alert"]'),
  ).toContainText("Only an undispatched job");
  await expect(queuedRow(page)).toContainText("final charge not confirmed");
  await expect(queuedRow(page).getByRole("button")).toHaveCount(0);
  await expect(budget(page)).toContainText("70.0¢");
  await other.close();
});

test("a failed recovery cancellation keeps the row and reserved budget intact", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreJournalPut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const result = put.apply(this, args);
      if (this.transaction.db.name === "luma-generation-journal")
        this.transaction.abort();
      return result;
    };
  });
  await queuedRow(page)
    .getByRole("button", { name: "Cancel queued request" })
    .click();
  await expect(
    page.locator('.generation-recovery [role="alert"]'),
  ).toContainText("abort");
  await expect(queuedRow(page)).toContainText("Not dispatched");
  await expect(budget(page)).toContainText("70.0¢");
  await page.evaluate(() => (window as any).restoreJournalPut());
  await page.reload();
  const saved = await page.evaluate(() =>
    window.luma.editor.ai.recoveredAccounting(),
  );
  expect(
    saved.find((entry) => entry.jobId === "queued-recovery")?.billingState,
  ).toBe("reserved");
});
