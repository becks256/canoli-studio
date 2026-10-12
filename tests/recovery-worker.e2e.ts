import { test, expect } from "@playwright/test";

test("large worker checkpoints retain three revisions and recover from corrupt latest data", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor: e, PaintLayer, BrushStroke } = window.luma;
    e.newDocument({ width: 698, height: 396 });
    const layer = new PaintLayer({ visible: false });
    layer.strokes.add(new BrushStroke({ points: Array.from({length: 10000}, (_, i) => ({x: i % 698, y: i % 396, pressure: 1})) }));
    e.document.layers.add(layer);
    await e.recovery.flush();
    const repository = e.recovery.repository, id = crypto.randomUUID();
    for (let i = 0; i < 4; i++) {
      e.document.name = `Worker revision ${i}`;
      await repository.save(id, e.document.getSnapshot().document, e.assetStore);
    }
    await e.recovery.flush();
    const entry = (await repository.list()).find(item => item.id === id)!;
    const names = [entry, ...entry.previous!].map(item => item.document.name);
    const summaries = await repository.summaries();
    const expectedSummaries = (await repository.list()).map(item => ({
      id: item.id, savedAt: item.savedAt, document: {name: item.document.name, width: item.document.width, height: item.document.height},
    }));
    const summaryMatches = JSON.stringify(summaries) === JSON.stringify(expectedSummaries);
    const workerCopy = await repository.restore(id);
    const localCopy = await repository.readRestoration(id);
    const hash = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).join(",");
    const identicalProject = await hash(workerCopy.blob) === await hash(localCopy.blob);
    let missingError = "";
    try { await repository.restore("missing-" + id); }
    catch (error) { missingError = (error as Error).message; }
    const open = indexedDB.open("luma-recovery", 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    entry.document.name = "Corrupt";
    const tx = db.transaction("checkpoints", "readwrite");
    tx.objectStore("checkpoints").put(entry);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    db.close();
    const restored = await repository.restore(id);
    const { readProject } = await import(/* @vite-ignore */ String("/src/core/project.ts"));
    const project = await readProject(restored.blob);
    await repository.remove(id);
    return { identicalProject, missingError, summaryMatches, names, skipped: restored.skipped, name: project.document.name, removed: !(await repository.list()).some(item => item.id === id) };
  });
  expect(result).toEqual({ identicalProject: true, missingError: "Recovery checkpoint no longer exists.", summaryMatches: true, names: ["Worker revision 3", "Worker revision 2", "Worker revision 1"], skipped: 1, name: "Worker revision 2", removed: true });
});
