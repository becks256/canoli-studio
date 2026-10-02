import { expect, test } from "@playwright/test";

test("concurrent tabs preserve recipe saves and do not resurrect deleted recipes", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const second = await context.newPage();
  await second.goto("/");
  for (const tab of [page, second])
    await tab.evaluate(async () => {
      // @ts-expect-error Vite serves this browser module by URL.
      const { RecipeStorage } = await import("/src/ai/recipes/storage.ts");
      (window as any).recipeTestStorage = new RecipeStorage();
    });
  const save = (tab: typeof page, id: string) =>
    tab.evaluate(async (id) => {
      await (window as any).recipeTestStorage.save({
        schemaVersion: 1,
        id,
        name: id,
        description: "",
        version: 1,
        parameters: [],
        steps: [
          {
            id: "rename",
            name: "Rename",
            action: { type: "document.rename", name: id },
          },
        ],
      });
    }, id);
  await Promise.all([save(page, "A"), save(second, "B")]);
  const ids = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("luma_custom_recipes_v1")!)
        .map((r: any) => r.id)
        .sort(),
    );
  expect(await ids()).toEqual(["A", "B"]);
  await Promise.all([
    page.evaluate(() => (window as any).recipeTestStorage.delete("A")),
    save(second, "C"),
  ]);
  expect(await ids()).toEqual(["B", "C"]);
  await page.reload();
  expect(await ids()).toEqual(["B", "C"]);
});
