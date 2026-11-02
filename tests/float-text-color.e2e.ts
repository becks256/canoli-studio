import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("native CSS text color capture retains signed HDR and Float32 precision without Canvas RGB readback", async ({
  page,
}, info) => {
  await page.goto("/developer/api.html");
  const result = await page.evaluate(async () => {
    const { captureLinearTextColors } = (await import(
        /* @vite-ignore */ String("/src/engine/float-text-color.ts")
      )) as typeof import("../src/engine/float-text-color"),
      native = CanvasRenderingContext2D.prototype.getImageData;
    let reads = 0;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      reads++;
      throw new Error("Text source color must not read Canvas pixels");
    };
    const input = [
        0.13286832155381798, -0.042058092565, 1.23456789123, 0.64123012345,
      ],
      css = `color(srgb-linear ${input.slice(0, 3).join(" ")} / ${input[3]})`,
      host = document.createElement("span");
    host.style.color = css;
    document.body.append(host);
    const serialized = getComputedStyle(host).color;
    host.remove();
    try {
      const values = await captureLinearTextColors([
        css,
        "#336699",
        "red",
        "transparent",
        "hsl(240 100% 50% / .375)",
        "color(display-p3 1 0 0)",
        css,
      ]);
      return {
        input,
        values,
        serialized,
        reads,
        capabilities: {
          textClusters: "getTextClusters" in TextMetrics.prototype,
          paintCluster: "fillTextCluster" in CanvasRenderingContext2D.prototype,
        },
        duplicate: values[0] === values[6],
        frozen: Object.isFrozen(values) && values.every(Object.isFrozen),
        hosts: document.querySelectorAll("[data-canoli-float-text-color-probe]")
          .length,
      };
    } finally {
      CanvasRenderingContext2D.prototype.getImageData = native;
    }
  });
  expect(result.values[0]).toEqual(result.input.map(Math.fround));
  expect(result.values[2]).toEqual([1, 0, 0, 1]);
  expect(result.values[3]).toEqual([0, 0, 0, 0]);
  expect(result.values[4]).toEqual([0, 0, 1, 0.375]);
  expect(result.values[5][0]).toBeGreaterThan(1);
  expect(result.values[5][1]).toBeLessThan(0);
  expect(result.values[5][2]).toBeLessThan(0);
  expect(result).toMatchObject({
    reads: 0,
    duplicate: true,
    frozen: true,
    hosts: 0,
  });
  const coarse = Number(result.serialized.match(/srgb-linear\s+([^ ]+)/)![1]);
  expect(result.values[0][0]).not.toBe(Math.fround(coarse));
  await writeFile(
    info.outputPath("native-css-colors.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native color capture snapshots caller data and cleans up on invalid, cancelled and reentrant host retirement before retry", async ({
  page,
}, info) => {
  await page.goto("/developer/api.html");
  const result = await page.evaluate(async () => {
    const { captureLinearTextColors } = (await import(
        /* @vite-ignore */ String("/src/engine/float-text-color.ts")
      )) as typeof import("../src/engine/float-text-color"),
      selector = "[data-canoli-float-text-color-probe]",
      input = ["color(srgb-linear 4 -.25 1.5 / .64123)"];
    let changed = false;
    const values = await captureLinearTextColors(input, {
        check() {
          if (!changed) {
            changed = true;
            input[0] = "#000000";
          }
        },
      }),
      errors: string[] = [];
    for (const kind of ["invalid", "cancel", "retire"]) {
      const abort = new AbortController();
      let triggered = false;
      try {
        await captureLinearTextColors(
          [
            kind === "invalid"
              ? "no-such-color"
              : "color(srgb-linear 4 -.25 1.5 / .64123)",
          ],
          {
            signal: abort.signal,
            check() {
              const host = document.querySelector(selector);
              if (host && !triggered) {
                triggered = true;
                if (kind === "cancel")
                  abort.abort(new Error("Cancelled native color"));
                if (kind === "retire") host.remove();
              }
            },
          },
        );
        errors.push("Unexpected success");
      } catch (error) {
        errors.push(String(error));
      }
      if (document.querySelector(selector))
        throw new Error("Leaked native color host");
    }
    const retry = await captureLinearTextColors([
      "color(srgb-linear 4 -.25 1.5 / .64123)",
    ]);
    return {
      values,
      retry,
      errors,
      hosts: document.querySelectorAll(selector).length,
    };
  });
  expect(result.values[0]).toEqual([4, -0.25, 1.5, Math.fround(0.64123)]);
  expect(result.retry).toEqual(result.values);
  expect(result.errors[0]).toContain("invalid");
  expect(result.errors[1]).toContain("Cancelled native color");
  expect(result.errors[2]).toContain("removed");
  expect(result.hosts).toBe(0);
  await writeFile(
    info.outputPath("native-css-ownership.json"),
    JSON.stringify(result, null, 2),
  );
});

test("source CSS colors retain their authored values under dark and forced-color UI modes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await page.goto("/developer/api.html");
  const result = await page.evaluate(async () => {
    const { captureLinearTextColors } = (await import(
      /* @vite-ignore */ String("/src/engine/float-text-color.ts")
    )) as typeof import("../src/engine/float-text-color");
    return await captureLinearTextColors([
      "color(srgb-linear 4 -.25 1.5 / .64123)",
      "red",
      "rgb(51 102 153)",
      "#336699",
      "currentColor",
    ]);
  });
  expect(result[0]).toEqual([4, -0.25, 1.5, Math.fround(0.64123)]);
  expect(result[1]).toEqual([1, 0, 0, 1]);
  expect(result[2]).toEqual(result[3]);
  expect(result[4]).toEqual([0, 0, 0, 1]);
});

test("linear CSS capture retains extreme finite RGB and sub-byte source alpha without serialization loss", async ({
  page,
}, info) => {
  await page.goto("/developer/api.html");
  const inputs = [
      [3e38, -3e38, 1e-30, 1e-8],
      [-4.123456789, 123456789.125, 0.0001328683215, 0.99999994],
      [0.13286832155381798, -0.042058092565, 1.23456789123, 0.64123012345],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
    ],
    actual = await page.evaluate(async (inputs) => {
      const { captureLinearTextColors } = (await import(
        /* @vite-ignore */ String("/src/engine/float-text-color.ts")
      )) as typeof import("../src/engine/float-text-color");
      return await captureLinearTextColors(
        inputs.map(
          (rgba) =>
            `color(srgb-linear ${rgba.slice(0, 3).join(" ")} / ${rgba[3]})`,
        ),
      );
    }, inputs);
  expect(actual).toEqual(inputs.map((rgba) => rgba.map(Math.fround)));
  await writeFile(
    info.outputPath("native-css-extremes.json"),
    JSON.stringify({ inputs, actual }, null, 2),
  );
});
