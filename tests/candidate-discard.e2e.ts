import { test, expect } from "@playwright/test";

for (const preview of [false, true])
  test(`discard during composite ${preview ? "preview" : "apply"} preserves the document`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (preview) => {
      const { CanvasRenderer } = await import(
        /* @vite-ignore */ String("/src/engine/renderer.ts")
      );
      const { applyCandidateToDocument, previewCandidatePlacement } =
        await import(/* @vite-ignore */ String("/src/ai/jobs/apply.ts"));
      const editor = window.luma.editor;
      editor.newDocument({ width: 2, height: 2 });
      const pixels = new Uint8Array(16).fill(255);
      const staging = editor.ai.staging;
      const candidate = await staging.stageCandidate(
        "discard-composite",
        {
          id: "discard-composite",
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
          prompt: "Discard fixture",
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
      const renderer = new CanvasRenderer();
      const render = renderer.render.bind(renderer);
      let releasedCanvas: HTMLCanvasElement | undefined;
      renderer.render = async (...args: Parameters<typeof render>) => {
        const canvas = await render(...args);
        releasedCanvas = canvas;
        await editor.ai.discardCandidate(candidate.id);
        return canvas;
      };
      const before = JSON.stringify(editor.document.toJSON());
      const history = editor.document.getSnapshot().past.length;
      let error = "";
      try {
        await (preview ? previewCandidatePlacement : applyCandidateToDocument)({
          candidateId: candidate.id,
          document: editor.document,
          assetStore: editor.assetStore,
          staging,
          records: new Map(),
          options: { allowStaleRevision: true, allowViolationOverride: true },
          renderer,
        });
      } catch (e) {
        error = String(e);
      } finally {
        renderer.dispose();
      }
      return {
        error,
        unchanged: JSON.stringify(editor.document.toJSON()) === before,
        historyUnchanged: editor.document.getSnapshot().past.length === history,
        assets: editor.assetStore.values().length,
        state: candidate.reviewState,
        discarded: !staging.getCandidate(candidate.id),
        canvasReleased: releasedCanvas?.width === 0,
      };
    }, preview);
    expect(result.error).toContain("discarded");
    expect(result).toMatchObject({
      unchanged: true,
      historyUnchanged: true,
      assets: 0,
      state: "discarded",
      discarded: true,
      canvasReleased: true,
    });
  });

test("discard during promotion rejects protected application without assets or history", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StagedAssetRepository } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/staging.ts")
    );
    const { applyCandidateToDocument } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/apply.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    const staging = new StagedAssetRepository();
    const pixels = new Uint8Array(16);
    for (let i = 0; i < 16; i += 4) {
      pixels[i] = 255;
      pixels[i + 3] = 255;
    }
    const candidate = await staging.stageCandidate(
      "job",
      {
        id: "candidate",
        providerId: "test",
        imageData: pixels,
        mimeType: "image/png",
        width: 2,
        height: 2,
        hasAlpha: false,
        costCents: 1,
        durationMs: 1,
      },
      {
        prompt: "Probe",
        modality: "masked-edit",
        targetWidth: 2,
        targetHeight: 2,
        requireAlpha: false,
        referenceImage: {
          width: 2,
          height: 2,
          data: new Uint8Array(16),
          mimeType: "image/png",
        },
        protectedMask: {
          width: 2,
          height: 2,
          coverage: new Uint8Array(4).fill(255),
        },
      },
    );
    if (!candidate.validation.valid)
      throw new Error(JSON.stringify(candidate.validation));
    const violatedBefore = !candidate.diffReport?.passed;
    const historyBefore = editor.document.getSnapshot().past.length;
    const original = window.createImageBitmap.bind(window);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    window.createImageBitmap = (async (...args: any[]) => {
      const image = await (original as any)(...args);
      entered();
      await gate;
      return image;
    }) as typeof createImageBitmap;
    let error = "";
    const work = applyCandidateToDocument({
      candidateId: candidate.id,
      document: editor.document,
      assetStore: editor.assetStore,
      staging,
      records: new Map(),
      options: { expectedRevision: editor.document.getSnapshot().revision },
    }).catch((e: unknown) => {
      error = String(e);
    });
    await started;
    staging.discard(candidate.id);
    release();
    await work;
    window.createImageBitmap = original;
    return {
      error,
      violatedBefore,
      layers: editor.document.layers.length,
      discarded: !staging.getCandidate(candidate.id),
      state: candidate.reviewState,
      assets: editor.assetStore.values().length,
      historyUnchanged:
        editor.document.getSnapshot().past.length === historyBefore,
    };
  });
  expect(result.error).toContain("discarded");
  expect(result).toMatchObject({
    violatedBefore: true,
    layers: 0,
    discarded: true,
    state: "discarded",
    assets: 0,
    historyUnchanged: true,
  });
});
