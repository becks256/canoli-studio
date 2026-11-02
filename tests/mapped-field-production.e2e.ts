import { test, expect } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { compileProjectiveField } from "../src/core/projective-field";
import { fieldMappingFromFrame } from "../src/core/mapped-field";

test("production retained-map worker matches independent masks across image edges and the inverse horizon", async ({
  page,
}, info) => {
  const files = (await readdir("dist/assets")).filter(
    (name) => name.startsWith("pixels.worker-") && name.endsWith(".js"),
  );
  expect(files).toHaveLength(1);
  const folder = "tests/fixtures/projective-field/",
    manifest = JSON.parse(await readFile(folder + "manifest.json", "utf8")),
    forward = JSON.parse(
      await readFile(folder + "forward-manifest.json", "utf8"),
    );
  const source = [
    ...new Uint8Array(gunzipSync(await readFile(folder + "source.f32le.gz"))),
  ];
  await page.goto("/");
  expect(await page.evaluate(() => "luma" in window)).toBe(false);
  const records = [];
  for (const originalRow of [...manifest.cases, ...forward.cases]) {
    const input = originalRow.options,
      row = {
        ...originalRow,
        options: {
          mapping: fieldMappingFromFrame(compileProjectiveField(input)),
          field: input.field,
          source: input.source,
          output: input.output,
          background: input.background,
        },
      };
    const actual = await page.evaluate(
      async ({ url, row, source }) => {
        const worker = new Worker(url, { type: "module" });
        try {
          return await new Promise<number[]>((resolve, reject) => {
            worker.onerror = (event) => reject(new Error(event.message));
            worker.onmessage = (event) => {
              const data = event.data;
              if (data.type === "fatal" || data.error) {
                reject(new Error(data.error));
                return;
              }
              if (data.type === "ready") {
                worker.postMessage({
                  id: 1,
                  pixels: new Uint8ClampedArray(0),
                  floatMappedField: {
                    alpha: new Float32Array(new Uint8Array(source).buffer),
                    options: row.options,
                  },
                });
                return;
              }
              if (
                data.id !== 1 ||
                !(data.pixels instanceof Float32Array) ||
                data.pixels.length !==
                  row.options.output.width * row.options.output.height ||
                data.pixels.byteOffset !== 0 ||
                data.pixels.byteLength !== data.pixels.buffer.byteLength
              ) {
                reject(new Error("Invalid production scalar-field reply."));
                return;
              }
              resolve([...data.pixels]);
            };
          });
        } finally {
          worker.terminate();
        }
      },
      { url: "/assets/" + files[0], row, source },
    );
    const expected = new Float32Array(
      new Uint8Array(gunzipSync(await readFile(folder + row.reference))).buffer,
    );
    expect(actual.length).toBe(expected.length);
    let maximum = 0;
    for (let i = 0; i < expected.length; i++)
      maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
    expect(maximum).toBeLessThanOrEqual(manifest.absoluteError);
    records.push({ name: row.name, samples: expected.length, maximum });
  }
  await writeFile(
    info.outputPath("mapped-field-production.json"),
    JSON.stringify(records, null, 2),
  );
});

test("production retained-map boundary rejects forged geometry and remains usable for valid native work", async ({
  page,
}, info) => {
  const files = (await readdir("dist/assets")).filter(
    (name) => name.startsWith("pixels.worker-") && name.endsWith(".js"),
  );
  expect(files).toHaveLength(1);
  await page.goto("/");
  const result = await page.evaluate(async (url) => {
    const worker = new Worker(url, { type: "module" }),
      options = {
        mapping: {
          matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          inputOrigin: { x: 0, y: 0 },
          sourceOrigin: { x: 0, y: 0 },
        },
        field: { x: 0, y: 0, width: 1, height: 1 },
        source: { x: 0, y: 0, width: 1, height: 1 },
        output: { x: 0, y: 0, width: 1, height: 1 },
        background: 1,
      };
    try {
      return await new Promise<{ failures: string[]; actual: number[] }>(
        (resolve, reject) => {
          const failures: string[] = [];
          let id = 0;
          const send = () => {
            id++;
            worker.postMessage({
              id,
              pixels: new Uint8ClampedArray(0),
              floatMappedField: {
                alpha: new Float32Array([id === 3 ? NaN : 0.25]),
                options:
                  id === 1
                    ? { ...options, unknown: true }
                    : id === 2
                      ? {
                          ...options,
                          mapping: {
                            ...options.mapping,
                            matrix: [1, 0, 0, 0, 0, 0, 0, 0, 1],
                          },
                        }
                      : options,
              },
            });
          };
          worker.onerror = (event) => reject(new Error(event.message));
          worker.onmessage = (event) => {
            const data = event.data;
            if (data.type === "fatal") {
              reject(new Error(data.error));
              return;
            }
            if (data.type === "ready") {
              send();
              return;
            }
            if (data.id !== id) {
              reject(new Error("Unexpected field worker response."));
              return;
            }
            if (id < 4) {
              if (!data.error || data.pixels) {
                reject(new Error("Invalid field work was published."));
                return;
              }
              failures.push(data.error);
              send();
            } else if (data.error || !(data.pixels instanceof Float32Array)) {
              reject(new Error(data.error || "Missing field result."));
            } else resolve({ failures, actual: [...data.pixels] });
          };
        },
      );
    } finally {
      worker.terminate();
    }
  }, "/assets/" + files[0]);
  expect(result.failures).toHaveLength(3);
  expect(result.actual).toEqual([0.25]);
  await writeFile(
    info.outputPath("mapped-field-production-rejections.json"),
    JSON.stringify(result, null, 2),
  );
});
