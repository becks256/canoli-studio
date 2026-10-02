import { readRecipePackage } from "./package";
import type { Recipe } from "./types";

/** One immutable package blob per recipe; IndexedDB commits bytes and identity atomically. */
export class RecipePackageStorage {
  private async open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined")
      throw new Error("Portable recipe storage requires IndexedDB.");
    return new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open("luma-recipe-packages", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("packages");
      request.onerror = () =>
        reject(
          request.error ?? new Error("Cannot open recipe package storage."),
        );
      request.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "Recipe package storage upgrade is blocked. Close other editor tabs and retry.",
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(
          "packages",
          mode,
          mode === "readwrite" ? { durability: "strict" } : undefined,
        );
        let request: IDBRequest<T>;
        try {
          request = operation(tx.objectStore("packages"));
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () =>
          reject(
            tx.error ??
              request.error ??
              new Error("Recipe package storage failed."),
          );
        tx.onabort = () =>
          reject(
            tx.error ??
              new Error("Recipe package storage transaction aborted."),
          );
      });
    } finally {
      db.close();
    }
  }

  async save(file: Blob): Promise<Recipe> {
    const { recipe } = await readRecipePackage(file);
    await this.transaction("readwrite", (store) => store.put(file, recipe.id));
    return recipe;
  }

  async get(id: string): Promise<Blob | undefined> {
    const file: unknown = await this.transaction("readonly", (store) =>
      store.get(id),
    );
    if (file === undefined) return undefined;
    if (!(file instanceof Blob))
      throw new Error("Stored recipe package is invalid.");
    const { recipe } = await readRecipePackage(file);
    if (recipe.id !== id)
      throw new Error("Stored recipe package identity mismatch.");
    return file;
  }

  async list(): Promise<Recipe[]> {
    const db = await this.open();
    let records: { key: IDBValidKey; file: unknown }[];
    try {
      records = await new Promise((resolve, reject) => {
        const tx = db.transaction("packages", "readonly");
        const result: { key: IDBValidKey; file: unknown }[] = [];
        const request = tx.objectStore("packages").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            result.push({ key: cursor.key, file: cursor.value });
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () =>
          reject(tx.error ?? new Error("Cannot read recipe packages."));
        tx.onabort = () =>
          reject(tx.error ?? new Error("Recipe package read aborted."));
      });
    } finally {
      db.close();
    }
    const recipes: Recipe[] = [];
    for (const record of records) {
      if (!(record.file instanceof Blob))
        throw new Error("Stored recipe package is invalid.");
      const { recipe } = await readRecipePackage(record.file);
      if (recipe.id !== record.key)
        throw new Error("Stored recipe package identity mismatch.");
      recipes.push(recipe);
    }
    return recipes;
  }

  async delete(id: string): Promise<void> {
    await this.transaction("readwrite", (store) => store.delete(id));
  }
}
