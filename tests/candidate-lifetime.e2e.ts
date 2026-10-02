import { test, expect } from "@playwright/test";

for (const phase of ["promotion", "verification"])
  test(`closing document during candidate ${phase} rejects placement`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (phase) => {
      const { CanvasRenderer } = await import(
        /* @vite-ignore */ String("/src/engine/renderer.ts")
      );
      const { applyCandidateToDocument } = await import(
        /* @vite-ignore */ String("/src/ai/jobs/apply.ts")
      );
      const editor = window.luma.editor;
      editor.newDocument({ width: 2, height: 2 });
      const target = editor.document,
        assets = editor.assetStore;
      const pixels = new Uint8Array(16).fill(255);
      const candidate = await editor.ai.staging.stageCandidate(
        "lifetime",
        {
          id: "lifetime",
          providerId: "fixture",
          durationMs: 0,
          costCents: 0,
          width: 2,
          height: 2,
          hasAlpha: false,
          mimeType: "image/png",
          imageData: pixels,
        },
        {
          prompt: "Lifetime",
          modality: "masked-edit",
          targetWidth: 2,
          targetHeight: 2,
          referenceImage: {
            width: 2,
            height: 2,
            data: pixels,
            mimeType: "image/png",
          },
          protectedMask: {
            width: 2,
            height: 2,
            coverage: new Uint8Array(4).fill(255),
          },
        },
      );
      const original = window.createImageBitmap.bind(window);
      const renderer = new CanvasRenderer();
      const render = renderer.render.bind(renderer);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => (enter = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      if (phase === "promotion")
        window.createImageBitmap = (async (...args: any[]) => {
          const bitmap = await (original as any)(...args);
          enter();
          await gate;
          return bitmap;
        }) as typeof createImageBitmap;
      else
        renderer.render = async (...args: Parameters<typeof render>) => {
          const canvas = await render(...args);
          enter();
          await gate;
          return canvas;
        };
      let error = "";
      const work =
        phase === "promotion"
          ? editor.applyGeneratedCandidate(candidate.id)
          : applyCandidateToDocument({
              candidateId: candidate.id,
              document: target,
              assetStore: assets,
              staging: editor.ai.staging,
              records: new Map(),
              options: {},
              renderer,
            });
      const pending = work.catch((e: unknown) => {
        error = String(e);
      });
      await entered;
      await editor.closeDocument(target, { discardChanges: true });
      release();
      await pending;
      window.createImageBitmap = original;
      renderer.dispose();
      return {
        error,
        open: editor.openDocuments.includes(target),
        layers: target.layers.length,
        assets: assets.values().length,
        history: target.getSnapshot().past.length,
      };
    }, phase);
    expect(result.error).toContain("disposed");
    expect(result).toMatchObject({
      open: false,
      layers: 0,
      assets: 0,
      history: 0,
    });
  });

test("candidate can be reapplied after undo without damaging earlier assets or redo", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    const candidate = await editor.ai.staging.stageCandidate(
      "reuse",
      {
        id: "reuse",
        providerId: "fixture",
        durationMs: 0,
        costCents: 0,
        width: 2,
        height: 2,
        hasAlpha: false,
        mimeType: "image/png",
        imageData: new Uint8Array(16).fill(255),
      },
      {
        prompt: "Reuse",
        modality: "text-to-image",
        targetWidth: 2,
        targetHeight: 2,
      },
    );
    const first = await editor.applyGeneratedCandidate(candidate.id);
    const firstAsset = editor.assetStore.get(first.assetId);
    editor.document.undo();
    const second = await editor.applyGeneratedCandidate(candidate.id);
    const snapshot = editor.document.toJSON();
    editor.document.undo();
    editor.document.redo();
    let error = "";
    try {
      await editor.applyGeneratedCandidate(candidate.id, {
        parentId: "missing",
      });
    } catch (e) {
      error = String(e);
    }
    return {
      unique: firstAsset.id !== second.assetId,
      firstRetained: editor.assetStore.get(firstAsset.id) === firstAsset,
      assets: editor.assetStore.values().length,
      error,
      unchanged:
        JSON.stringify(editor.document.toJSON()) === JSON.stringify(snapshot),
    };
  });
  expect(result).toMatchObject({
    unique: true,
    firstRetained: true,
    assets: 2,
    unchanged: true,
  });
  expect(result.error).toContain("does not exist");
});
