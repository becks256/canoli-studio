import { test, expect } from "@playwright/test";

test("chunked workspace encoding owns snapshots, matches project bytes and cancels disposal", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { ProjectEncoder } = await import(/* @vite-ignore */ String("/src/workspace/project-encoder.ts"));
    const { serializeProject } = await import(/* @vite-ignore */ String("/src/core/project.ts"));
    const { Document, PaintLayer, BrushStroke, editor } = window.luma;
    const doc = new Document({ name: "Captured" });
    const layer = doc.layers.add(new PaintLayer({ visible: false }));
    layer.strokes.add(new BrushStroke({ points: Array.from({ length: 8000 }, (_, x) => ({ x, y: 2, pressure: 1 })) }));
    doc.name = "Second";
    const state = doc.getSnapshot();
    const history = { version: 1 as const, past: state.past, future: state.future };
    const encoder = new ProjectEncoder();
    const mutable = doc.toJSON();
    const mutableHistory = structuredClone(history);
    const expected = await serializeProject(mutable, editor.assetStore, mutableHistory);
    const one = encoder.encode(mutable, editor.assetStore, mutableHistory);
    mutable.name = "Changed caller";
    mutableHistory.past.length = 0;
    const two = encoder.encode(state.document, editor.assetStore, history);
    doc.name = "Live changed";
    const [a, b] = await Promise.all([one, two]);
    const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).join(",");
    const hashes = await Promise.all([expected, a, b].map(digest));
    const pending = encoder.encode(state.document, editor.assetStore, history).then(() => "unexpected success", (error: Error) => error.message);
    encoder.dispose();
    const disposed = await pending;
    const later = await encoder.encode(state.document, editor.assetStore, history).then(() => "unexpected success", (error: Error) => error.message);
    return { hashes, disposed, later };
  });
  expect(result.hashes[1]).toBe(result.hashes[0]);
  expect(result.hashes[2]).toBe(result.hashes[0]);
  expect(result.disposed).toContain("disposed");
  expect(result.later).toContain("disposed");
});
