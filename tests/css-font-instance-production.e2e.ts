import { test, expect } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
test("production source shaping retains CSS instance coordinates, style-axis choice and explicit override precedence", async ({
  page,
}, info) => {
  const bytes = [...(await readFile("tests/fixtures/css-font/Css.ttf"))],
    files = (await readdir("dist/assets")).filter((name) =>
      /^font-shaping-worker-.*\.js$/.test(name),
    );
  expect(files).toHaveLength(1);
  const file = files[0],
    compiled = await readFile("dist/assets/" + file);
  await page.goto("/");
  const rows = await page.evaluate(
    async ({ bytes, file }) => {
      const cases = [
          {
            css: { weight: 600, width: 100, style: "normal" },
            settings: "normal",
            expected: 1400,
          },
          {
            css: { weight: 639.75, width: 100, style: "normal" },
            settings: "normal",
            expected: 1559,
          },
          {
            css: {
              weight: 700,
              width: 125,
              style: "italic",
              styleAxis: "ital",
            },
            settings: "normal",
            expected: 1980,
          },
          {
            css: {
              weight: 700,
              width: 125,
              style: "italic",
              styleAxis: "slnt",
            },
            settings: "normal",
            expected: 1844,
          },
          {
            css: {
              weight: 700,
              width: 125,
              style: "italic",
              styleAxis: "none",
            },
            settings: "normal",
            expected: 1900,
          },
          {
            css: { weight: 700, width: 125, style: "italic" },
            settings: '"wght" 550.25,"wdth" 87.5,"ital" .5,"slnt" -7',
            expected: 1163,
          },
        ],
        rows = [];
      for (const test of cases) {
        const result = await new Promise<{ data: Float64Array }>(
          (resolve, reject) => {
            const w = new Worker("/assets/" + file, { type: "module" }),
              timer = setTimeout(() => {
                w.terminate();
                reject(new Error("CSS production shaping timed out"));
              }, 10000),
              done = () => {
                clearTimeout(timer);
                w.terminate();
              };
            w.onmessage = (e) => {
              done();
              e.data?.error ? reject(new Error(e.data.error)) : resolve(e.data);
            };
            w.onerror = () => {
              done();
              reject(new Error("CSS production shaping worker failed"));
            };
            w.postMessage({
              bytes: new Uint8Array(bytes),
              input: { text: "A", css: test.css },
              settings: test.settings,
              timeoutMs: 10000,
            });
          },
        );
        rows.push({
          ...test,
          glyphId: result.data[0],
          advance: result.data[3],
        });
      }
      return rows;
    },
    { bytes, file },
  );
  for (const r of rows) {
    expect(r.glyphId).toBe(2);
    expect(r.advance).toBe(r.expected);
  }
  await writeFile(
    info.outputPath("production-css-instance.json"),
    JSON.stringify(
      {
        worker: file,
        bytes: compiled.length,
        sha256: createHash("sha256").update(compiled).digest("hex"),
        rows,
      },
      null,
      2,
    ),
  );
});
