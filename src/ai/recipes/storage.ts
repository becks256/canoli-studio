import type { Recipe } from "./types";
import { validateRecipe } from "./schema";

const STORAGE_KEY = "luma_custom_recipes_v1";

export class RecipeStorage {
  private memCache = new Map<string, Recipe>();

  constructor() {
    this.loadFromStorage();
  }

  private readFailure?: string;
  private unreadableSource?: string;

  get loadError(): string | undefined {
    return this.readFailure;
  }
  get recoverySource(): string | undefined {
    return this.unreadableSource;
  }

  reload(): void {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const raw = localStorage.getItem(STORAGE_KEY);
      this.unreadableSource = raw ?? undefined;
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(parsed))
        throw new Error("Expected a recipe library array.");
      const next = new Map<string, Recipe>();
      for (const item of parsed) {
        const result = validateRecipe(item);
        if (!result.valid || !result.recipe)
          throw new Error("The library contains an invalid recipe.");
        if (next.has(result.recipe.id))
          throw new Error("The library contains duplicate recipe IDs.");
        next.set(result.recipe.id, result.recipe);
      }
      this.memCache = next;
      this.readFailure = undefined;
      this.unreadableSource = undefined;
    } catch (error) {
      this.readFailure = `Recipe library could not be loaded. Saved data was preserved; writes are disabled until it can be read. ${String(error)}`;
    }
  }

  private persist(next: Map<string, Recipe>): void {
    if (this.readFailure) throw new Error(this.readFailure);
    if (typeof localStorage === "undefined") return;
    try {
      const list = Array.from(next.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      throw new Error(
        "Recipe storage could not be updated. Free browser storage and retry, or export the recipe before closing.",
      );
    }
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    if (this.readFailure) throw new Error(this.readFailure);
    const commit = () => {
      this.loadFromStorage();
      if (this.readFailure) throw new Error(this.readFailure);
      return operation();
    };
    if (typeof window === "undefined") return commit();
    if (!navigator.locks)
      throw new Error(
        "Saving recipes requires browser Web Locks support. Export the recipe to preserve it.",
      );
    return navigator.locks.request(
      "luma-recipe-library",
      { mode: "exclusive" },
      commit,
    );
  }

  list(): Recipe[] {
    return structuredClone(Array.from(this.memCache.values()));
  }

  get(id: string): Recipe | undefined {
    const recipe = this.memCache.get(id);
    return recipe ? structuredClone(recipe) : undefined;
  }

  async save(recipe: Recipe): Promise<void> {
    const check = validateRecipe(recipe);
    if (!check.valid || !check.recipe) {
      throw new Error(`Cannot save invalid recipe: ${check.errors.join("; ")}`);
    }
    const updated = {
      ...check.recipe,
      modified: new Date().toISOString(),
    };
    await this.mutate(() => {
      const next = new Map(this.memCache);
      next.set(updated.id, structuredClone(updated));
      this.persist(next);
      this.memCache = next;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.mutate(() => {
      const next = new Map(this.memCache);
      const deleted = next.delete(id);
      if (deleted) {
        this.persist(next);
        this.memCache = next;
      }
      return deleted;
    });
  }

  exportJson(recipe: Recipe): string {
    return JSON.stringify(recipe, null, 2);
  }

  async importJson(jsonString: string): Promise<Recipe> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error(
        "Invalid JSON file. Please provide a valid JSON recipe string.",
      );
    }
    const check = validateRecipe(parsed);
    if (!check.valid || !check.recipe) {
      throw new Error(`Invalid recipe structure: ${check.errors.join("; ")}`);
    }
    await this.save(check.recipe);
    return check.recipe;
  }
}
