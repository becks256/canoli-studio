import { afterEach, expect, it, vi } from "vitest";
import { RecipeStorage } from "../src/ai/recipes/storage";
import { RecipeService } from "../src/ai/recipes/service";
import { Document, TextLayer } from "../src/dom";
import type { EditorApplication } from "../src/editor";
import type { Recipe } from "../src/ai/recipes/types";

const recipe: Recipe = {
  schemaVersion: 1,
  id: "saved",
  name: "Saved recipe",
  description: "",
  version: 1,
  parameters: [],
  steps: [
    {
      id: "rename",
      name: "Rename",
      action: { type: "document.rename", name: "Renamed" },
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
function storageFixture() {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value);
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem,
  });
  return setItem;
}
it("failed save and delete preserve the last durable recipe in memory and after reload", async () => {
  const write = storageFixture();
  const storage = new RecipeStorage();
  await storage.save(recipe);
  write.mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  await expect(
    storage.save({ ...recipe, name: "Unsaved replacement" }),
  ).rejects.toThrow("could not be updated");
  await expect(storage.delete(recipe.id)).rejects.toThrow(
    "could not be updated",
  );
  expect(storage.get(recipe.id)?.name).toBe("Saved recipe");
  expect(new RecipeStorage().get(recipe.id)?.name).toBe("Saved recipe");
});
it("retains stopped recordings for export and retry until persistence succeeds", async () => {
  const write = storageFixture();
  const successfulWrite = write.getMockImplementation()!;
  const document = new Document({ name: "Recording", width: 16, height: 16 });
  const service = new RecipeService({ document } as EditorApplication);
  service.startRecording();
  document.layers.add(
    new TextLayer({ name: "Caption", text: "Keep this work" }),
  );
  write.mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  await expect(service.stopRecording({ name: "Recover me" })).rejects.toThrow(
    "could not be updated",
  );
  expect(service.getCustomRecipes()).toEqual([]);
  expect(service.pendingRecording?.name).toBe("Recover me");
  expect(
    JSON.parse(service.exportRecipeJson(service.pendingRecording!)).steps,
  ).toHaveLength(1);
  expect(() => service.startRecording()).toThrow("pending recording");
  await expect(service.savePendingRecording()).rejects.toThrow(
    "could not be updated",
  );
  write.mockImplementation(successfulWrite);
  const saved = await service.savePendingRecording();
  expect(service.pendingRecording).toBeUndefined();
  expect(new RecipeStorage().get(saved.id)?.name).toBe("Recover me");
  service.dispose();
});

it.each([
  "{broken",
  "{}",
  "",
  JSON.stringify([recipe, { invalid: true }]),
  JSON.stringify([recipe, recipe]),
])("preserves unreadable library bytes and rejects writes: %s", async (raw) => {
  storageFixture();
  localStorage.setItem("luma_custom_recipes_v1", raw);
  const storage = new RecipeStorage();
  expect(storage.loadError).toContain("could not be loaded");
  expect(storage.recoverySource).toBe(raw);
  await expect(storage.save(recipe)).rejects.toThrow("writes are disabled");
  expect(localStorage.getItem("luma_custom_recipes_v1")).toBe(raw);
  localStorage.setItem("luma_custom_recipes_v1", JSON.stringify([recipe]));
  storage.reload();
  expect(storage.loadError).toBeUndefined();
  expect(storage.recoverySource).toBeUndefined();
  expect(storage.get(recipe.id)?.name).toBe(recipe.name);
  await storage.save({ ...recipe, name: "Recovered" });
  expect(new RecipeStorage().get(recipe.id)?.name).toBe("Recovered");
});
it("keeps the last readable library when a later read fails", async () => {
  storageFixture();
  const storage = new RecipeStorage();
  await storage.save(recipe);
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("SecurityError");
    },
  });
  storage.reload();
  expect(storage.loadError).toContain("SecurityError");
  expect(storage.get(recipe.id)?.name).toBe(recipe.name);
  await expect(storage.delete(recipe.id)).rejects.toThrow(
    "writes are disabled",
  );
});

it("merges saves and deletes from independent caches without resurrecting stale entries", async () => {
  storageFixture();
  const first = new RecipeStorage(),
    second = new RecipeStorage();
  await first.save(recipe);
  await second.save({ ...recipe, id: "second" });
  expect(
    new RecipeStorage()
      .list()
      .map((item) => item.id)
      .sort(),
  ).toEqual(["saved", "second"]);
  await first.delete("saved");
  await second.save({ ...recipe, id: "third" });
  expect(
    new RecipeStorage()
      .list()
      .map((item) => item.id)
      .sort(),
  ).toEqual(["second", "third"]);
});
