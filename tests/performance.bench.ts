import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, arch } from "node:os";

const corpus = JSON.parse(
  await readFile(
    new URL("./fixtures/performance/corpus.json", import.meta.url),
    "utf8",
  ),
) as {
  version: number;
  cases: {
    id: string;
    width: number;
    height: number;
    groups: number;
    textLayers: number;
  }[];
};
for (const fixture of corpus.cases) {
  test(`production benchmark: ${fixture.id}`, async ({
    page,
    browser,
  }, info) => {
    await page.goto("/");
    await expect(
      page.getByRole("tablist", { name: "Open documents" }),
    ).toBeVisible();
    const samples: {
      dimensions: number[];
      sourceHash: string;
      timingsMs: Record<string, number>;
    }[] = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      if (iteration) await page.reload();
      await page.waitForFunction(() => !!window.luma?.editor);
      samples.push(
        await page.evaluate(async (fixture) => {
          const { editor, LayerGroup, TextLayer } = window.luma;
          const source = document.createElement("canvas");
          source.width = fixture.width;
          source.height = fixture.height;
          const ctx = source.getContext("2d")!;
          ctx.fillStyle = "#284765";
          ctx.fillRect(0, 0, source.width, source.height);
          for (let y = 0; y < source.height; y += 128) {
            ctx.fillStyle = y % 256 ? "#dc8659" : "#b7d3a1";
            ctx.fillRect(0, y, source.width, 32);
          }
          const blob = await new Promise<Blob>((resolve) =>
            source.toBlob((value) => resolve(value!)),
          );
          source.width = source.height = 1;
          const digest = await crypto.subtle.digest(
            "SHA-256",
            await blob.arrayBuffer(),
          );
          const sourceHash = [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
          const measure = async <T>(action: () => Promise<T>) => {
            const start = performance.now();
            const value = await action();
            return { value, ms: performance.now() - start };
          };
          const imported = await measure(() =>
            editor.importImage(
              new File([blob], fixture.id + ".png", { type: "image/png" }),
            ),
          );
          const groups = Array.from({ length: fixture.groups }, (_, i) => {
            const group = new LayerGroup({
              name: `Group ${i}`,
              x: i * 3,
              y: i * 4,
            });
            editor.document.layers.add(group);
            return group;
          });
          for (let i = 0; i < fixture.textLayers; i++)
            groups[i % groups.length].layers.add(
              new TextLayer({
                text: `Benchmark ${i}`,
                x: (i % 6) * 260,
                y: Math.floor(i / 6) * 200,
                fontSize: 40,
              }),
            );
          const edit = await measure(async () => {
            imported.value.setTone({ exposure: 0.25 });
          });
          const render = await measure(() =>
            editor.renderer.render(
              editor.document.toJSON(),
              editor.assetStore,
              {
                maxPixels: 1_000_000,
                maxDimension: 1600,
                cache: false,
                readback: true,
              },
            ),
          );
          const exported = await measure(() => editor.exportPng());
          const bitmap = await createImageBitmap(exported.value);
          const dimensions = [bitmap.width, bitmap.height];
          bitmap.close();
          const memory = (
            performance as Performance & {
              memory?: {
                usedJSHeapSize: number;
                totalJSHeapSize: number;
                jsHeapSizeLimit: number;
              };
            }
          ).memory;
          return {
            sourceHash,
            sourceBytes: blob.size,
            outputBytes: exported.value.size,
            dimensions,
            timingsMs: {
              import: imported.ms,
              editCommand: edit.ms,
              editedViewportRender: render.ms,
              export: exported.ms,
            },
            resourceDiagnostics: {
              jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
              jsHeapLimitBytes: memory?.jsHeapSizeLimit ?? null,
              hardwareConcurrency: navigator.hardwareConcurrency,
              webgpuAvailable: !!navigator.gpu,
            },
            userAgent: navigator.userAgent,
          };
        }, fixture),
      );
      expect(samples.at(-1)!.dimensions).toEqual([
        fixture.width,
        fixture.height,
      ]);
      expect(samples.at(-1)!.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const medianMs = Object.fromEntries(
      Object.keys(samples[0].timingsMs).map((key) => {
        const values = samples
          .map(
            (sample) => sample.timingsMs[key as keyof typeof sample.timingsMs],
          )
          .sort((a, b) => a - b);
        return [key, values[1]];
      }),
    );
    const report = {
      schemaVersion: 1,
      corpusVersion: corpus.version,
      fixture,
      measuredAt: new Date().toISOString(),
      browser: browser.version(),
      host: {
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      samples,
      medianMs,
      limitations: [
        "Synthetic corpus; not a photo quality benchmark.",
        "JS heap diagnostics exclude decoded image, GPU, WASM and total process memory.",
        "Fresh page per sample; browser/OS caches may remain warm.",
        "No hardware-independent pass/fail timing threshold.",
      ],
    };
    const path = info.outputPath(`${fixture.id}.json`);
    await writeFile(path, JSON.stringify(report, null, 2));
    await info.attach("performance-report", {
      path,
      contentType: "application/json",
    });
    console.log(JSON.stringify({ fixture: fixture.id, medianMs }));
  });
}
