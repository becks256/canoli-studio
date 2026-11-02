import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("mapped coupled-field IPC rejects malformed host results and preserves caller data", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      ),
      Native = window.Worker;
    const options = {
        mapping: {
          matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
          inputOrigin: { x: 0, y: 0 },
          sourceOrigin: { x: 0, y: 0 },
        },
        field: { x: 0, y: 0, width: 1, height: 1 },
        source: { x: 0, y: 0, width: 1, height: 1 },
        output: { x: 0, y: 0, width: 1, height: 1 },
        background: 0,
      },
      original = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.75]),
      rows = [];
    try {
      for (const mode of ["length", "coverage", "premultiplied", "subview"]) {
        let intercepted = false,
          error = "";
        window.Worker = class extends Native {
          set onmessage(
            listener: ((this: Worker, event: MessageEvent) => unknown) | null,
          ) {
            super.onmessage = (event) => {
              if (event.data.pixels) {
                intercepted = true;
                const pixels =
                  mode === "length"
                    ? new Float32Array(0)
                    : mode === "coverage"
                      ? new Float32Array([0.1, 0.2, 0.3, 0.4, 0.1])
                      : mode === "premultiplied"
                        ? new Float32Array([0.5, 0.2, 0.3, 0.4, 0.75])
                        : new Float32Array(new ArrayBuffer(24), 4, 5);
                listener?.call(
                  this,
                  new MessageEvent("message", {
                    data: { ...event.data, pixels },
                  }),
                );
              } else listener?.call(this, event);
            };
          }
          get onmessage() {
            return super.onmessage;
          }
        };
        const processor = new PixelProcessor();
        try {
          await processor.floatMappedWet(original, options);
        } catch (cause) {
          error = String(cause);
        } finally {
          processor.dispose();
          window.Worker = Native;
        }
        rows.push({ mode, intercepted, error });
      }
      const fresh = new PixelProcessor();
      try {
        const pixels = original.slice(),
          settings = structuredClone(options),
          pending = fresh.floatMappedWet(pixels, settings);
        pixels.fill(99);
        settings.mapping.inputOrigin.x = 999;
        settings.source.width = 2;
        return {
          rows,
          result: [...(await pending)],
          original: [...original],
          owned: pixels.every((v) => v === 99),
        };
      } finally {
        fresh.dispose();
      }
    } finally {
      window.Worker = Native;
    }
  });
  for (const row of result.rows) {
    expect(row.intercepted).toBe(true);
    expect(row.error).toMatch(/field|geometry|length|premultiplied|coverage/);
  }
  expect(result.owned).toBe(true);
  expect(new Float32Array(result.result)).toEqual(
    new Float32Array([0.1, 0.2, 0.3, 0.4, 0.75]),
  );
  expect(result.original).toEqual(result.result);
  await writeFile(
    info.outputPath("mapped-wet-host.json"),
    JSON.stringify(result, null, 2),
  );
});

test("actual mapped wet worker rejects forged maps, source windows and pigment then permits native retry", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const rows = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      ),
      Native = window.Worker,
      rows = [];
    const options = {
      mapping: {
        matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
        inputOrigin: { x: 0, y: 0 },
        sourceOrigin: { x: 0, y: 0 },
      },
      field: { x: 0, y: 0, width: 1, height: 1 },
      source: { x: 0, y: 0, width: 1, height: 1 },
      output: { x: 0, y: 0, width: 1, height: 1 },
      background: 0,
    };
    try {
      for (const mode of [
        "unknown",
        "singular",
        "missing",
        "coverage",
        "background",
      ]) {
        let intercepted = false,
          error = "";
        window.Worker = class extends Native {
          postMessage(
            message: unknown,
            transfer?: Transferable[] | StructuredSerializeOptions,
          ) {
            const packet = message as {
              floatMappedWet?: { alpha: Float32Array; options: typeof options };
            };
            if (packet.floatMappedWet && !intercepted) {
              intercepted = true;
              const request = packet.floatMappedWet,
                forged = structuredClone(request.options) as any;
              if (mode === "unknown") forged.mapping.unexpected = true;
              else if (mode === "singular")
                forged.mapping.matrix = [1, 0, 0, 0, 0, 0, 0, 0, 1];
              else if (mode === "missing") {
                forged.field.width = 2;
                forged.output.width = 2;
              } else if (mode === "background") forged.background = 1;
              else request.alpha[4] = 0;
              message = {
                ...packet,
                floatMappedWet: { ...request, options: forged },
              };
            }
            if (Array.isArray(transfer)) super.postMessage(message, transfer);
            else super.postMessage(message, transfer);
          }
        };
        const processor = new PixelProcessor(),
          original = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.75]);
        try {
          try {
            await processor.floatMappedWet(original, options);
          } catch (cause) {
            error = String(cause);
          }
          rows.push({
            mode,
            intercepted,
            error,
            retry: [...(await processor.floatMappedWet(original, options))],
            original: [...original],
          });
        } finally {
          processor.dispose();
          window.Worker = Native;
        }
      }
      return rows;
    } finally {
      window.Worker = Native;
    }
  });
  for (const row of rows) {
    expect(row.intercepted).toBe(true);
    expect(row.error).toMatch(
      /Unrecognized|singular|captured field|coverage|field|background/,
    );
    expect(row.retry).toEqual(row.original);
  }
  await writeFile(
    info.outputPath("mapped-wet-worker.json"),
    JSON.stringify(rows, null, 2),
  );
});
