import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const fixture = "tests/fixtures/float-wet/";
async function inputs() {
  const rows = await Promise.all(
    ["source", "carried", "coverage", "pigment"].map(async (name) => {
      const samples = gunzipSync(await readFile(fixture + name + ".f32le.gz"));
      return [name, [...samples]] as const;
    }),
  );
  return Object.fromEntries(rows);
}

test("real native float wet worker preserves every independent HDR load, deposit, pickup and envelope word", async ({
  page,
}, info) => {
  const manifest = JSON.parse(
    await readFile(fixture + "manifest.json", "utf8"),
  );
  await page.goto("/");
  const result = await page.evaluate(
    async ({ raw, manifest }) => {
      const { PixelProcessor } = (await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      )) as typeof import("../src/engine/processor");
      const p = new PixelProcessor(),
        decode = (name: string) =>
          new Float32Array(Uint8Array.from(raw[name]).buffer),
        source = decode("source"),
        carried = decode("carried"),
        coverage = decode("coverage"),
        pigment = decode("pigment");
      const originals = [
          source.slice(),
          carried.slice(),
          coverage.slice(),
          pigment.slice(),
        ],
        rows: { name: string; bytes: number[] }[] = [];
      const save = (name: string, value: Float32Array) =>
        rows.push({
          name,
          bytes: [
            ...new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
          ],
        });
      try {
        for (const item of manifest.loads)
          save("load-" + item.name, await p.floatWetLoad(source, item.options));
        for (const item of manifest.mixes) {
          const result = await p.floatWetMix(
            source,
            carried,
            coverage,
            item.options,
          );
          save("mix-" + item.name, result.pixels);
          save("carry-" + item.name, result.carried);
        }
        for (const item of manifest.envelopes)
          save(
            "envelope-" + item.name,
            await p.floatWetEnvelope(source, pigment, coverage, item.opacity),
          );
        return {
          rows,
          inputsExact: [source, carried, coverage, pigment].every((a, i) =>
            new Uint32Array(a.buffer).every(
              (v, j) => v === new Uint32Array(originals[i].buffer)[j],
            ),
          ),
        };
      } finally {
        p.dispose();
      }
    },
    { raw: await inputs(), manifest },
  );
  for (const row of result.rows) {
    const actual = Buffer.from(row.bytes),
      reference = gunzipSync(await readFile(fixture + row.name + ".f32le.gz"));
    await writeFile(info.outputPath(row.name + ".f32le"), actual);
    expect(actual.equals(reference), row.name).toBe(true);
  }
  expect(result.inputsExact).toBe(true);
  await writeFile(
    info.outputPath("float-wet-worker.json"),
    JSON.stringify(
      {
        rows: result.rows.map((r) => ({
          name: r.name,
          bytes: r.bytes.length,
          exact: true,
        })),
        inputsExact: true,
      },
      null,
      2,
    ),
  );
});

test("float wet requests own all samples, coverage and nested options before worker readiness", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (raw) => {
      const { PixelProcessor } = (await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      )) as typeof import("../src/engine/processor");
      const p = new PixelProcessor(),
        internals = p as unknown as { ready: Promise<void> },
        ready = internals.ready,
        decode = (name: string) =>
          new Float32Array(Uint8Array.from(raw[name]).buffer);
      await ready;
      const rows: { name: string; bytes: number[] }[] = [];
      const hold = () => {
        let release!: () => void;
        internals.ready = new Promise<void>((resolve) => (release = resolve));
        return release;
      };
      try {
        let source = decode("source"),
          release = hold();
        const options = {
            color: [4.5, -2.25, 13.125, 0.375] as [
              number,
              number,
              number,
              number,
            ],
            load: 0.37,
          },
          load = p.floatWetLoad(source, options);
        source.fill(0);
        options.color.fill(0);
        options.load = 0;
        release();
        let value = await load;
        rows.push({
          name: "load-partial",
          bytes: [...new Uint8Array(value.buffer)],
        });
        source = decode("source");
        let carried = decode("carried"),
          coverage = decode("coverage");
        release = hold();
        const mixOptions = { flow: 0.625, wetness: 0.2, pickup: 0.7 },
          mix = p.floatWetMix(source, carried, coverage, mixOptions);
        source.fill(0);
        carried.fill(0);
        coverage.fill(0);
        mixOptions.flow = 0;
        release();
        const mixed = await mix;
        rows.push(
          {
            name: "mix-partial",
            bytes: [...new Uint8Array(mixed.pixels.buffer)],
          },
          {
            name: "carry-partial",
            bytes: [...new Uint8Array(mixed.carried.buffer)],
          },
        );
        source = decode("source");
        const after = decode("pigment");
        coverage = decode("coverage");
        release = hold();
        const envelope = p.floatWetEnvelope(source, after, coverage, 0.625);
        source.fill(0);
        after.fill(0);
        coverage.fill(0);
        release();
        value = await envelope;
        rows.push({
          name: "envelope-partial",
          bytes: [...new Uint8Array(value.buffer)],
        });
        return rows;
      } finally {
        internals.ready = ready;
        p.dispose();
      }
    },
    await inputs(),
  );
  for (const row of result) {
    const actual = Buffer.from(row.bytes);
    await writeFile(info.outputPath("captured-" + row.name + ".f32le"), actual);
    expect(
      actual.equals(
        gunzipSync(await readFile(fixture + row.name + ".f32le.gz")),
      ),
      row.name,
    ).toBe(true);
  }
});

test("the actual float wet worker boundary rejects malformed replies and remains usable after failure or disposal", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = (await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    )) as typeof import("../src/engine/processor");
    const p = new PixelProcessor(),
      worker = (p as unknown as { worker: Worker }).worker,
      handler = worker.onmessage!;
    const source = new Float32Array([2, -4, 8, 0.375]),
      carried = new Float32Array([0.75, -1.5, 3, 0.375]),
      coverage = new Float32Array([1]),
      errors: string[] = [];
    try {
      for (const fault of [
        "type",
        "alias",
        "extra",
        "hidden",
        "extent",
        "subarray",
      ]) {
        worker.onmessage = (event) => {
          const data = event.data;
          if (data.floatWetPaint) {
            const v = data.floatWetPaint;
            if (fault === "type") v.pixels = new Uint8ClampedArray(4);
            if (fault === "alias") v.pixels = v.carried;
            if (fault === "extra") v.extra = true;
            if (fault === "hidden") {
              v.carried[3] = 0;
              v.carried[0] = 1;
            }
            if (fault === "extent") v.carried = new Float32Array(8);
            if (fault === "subarray")
              v.pixels = new Float32Array(8).subarray(0, 4);
          }
          handler.call(worker, new MessageEvent("message", { data }));
        };
        try {
          await p.floatWetMix(source, carried, coverage);
        } catch (error) {
          errors.push(String(error));
        } finally {
          worker.onmessage = handler;
        }
      }
      const healthy = await p.floatWetMix(source, carried, coverage, {
        pickup: 0,
      });
      const badCarry = new Float32Array([1e38, 0, 0, 1e-30]);
      let overflow = "";
      try {
        await p.floatWetMix(source, badCarry, coverage);
      } catch (error) {
        overflow = String(error);
      }
      const retry = await p.floatWetMix(source, carried, coverage, {
        pickup: 0,
      });
      let release!: () => void;
      const internals = p as unknown as { ready: Promise<void> },
        ready = internals.ready;
      internals.ready = new Promise<void>((resolve) => (release = resolve));
      const pending = p.floatWetLoad(source).then(
        () => "",
        (error) => String(error),
      );
      p.dispose();
      release();
      const disposed = await pending;
      internals.ready = ready;
      return {
        errors,
        overflow,
        disposed,
        healthy: [...healthy.pixels],
        retry: [...retry.pixels],
        source: [...source],
        reservoir: [...carried],
      };
    } finally {
      worker.onmessage = handler;
      p.dispose();
    }
  });
  expect(result.errors).toHaveLength(6);
  expect(result.overflow).toMatch(/float32/);
  expect(result.disposed).toMatch(/disposed|closed/);
  expect(result.healthy).toEqual([2, -4, 8, 0.375]);
  expect(result.retry).toEqual(result.healthy);
  expect(result.source).toEqual([2, -4, 8, 0.375]);
  expect(result.reservoir).toEqual([0.75, -1.5, 3, 0.375]);
  await writeFile(
    info.outputPath("float-wet-worker-failures.json"),
    JSON.stringify(result, null, 2),
  );
});

test("float wet native windows and caller partitions stay exact beside concurrent byte work", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (raw) => {
      const { PixelProcessor } = (await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      )) as typeof import("../src/engine/processor");
      const p = new PixelProcessor(),
        decode = (name: string) =>
          new Float32Array(Uint8Array.from(raw[name]).buffer);
      const original = decode("source"),
        reservoir = decode("carried"),
        mask = decode("coverage"),
        count = 65539;
      const source = new Float32Array(count * 4),
        carried = new Float32Array(count * 4),
        coverage = new Float32Array(count);
      for (let i = 0; i < source.length; i++) {
        source[i] = original[i % original.length];
        carried[i] = reservoir[i % reservoir.length];
      }
      for (let i = 0; i < count; i++) coverage[i] = mask[i % mask.length];
      const options = { flow: 0.625, wetness: 0.2, pickup: 0.7 },
        same = (a: Float32Array, b: Float32Array) =>
          new Uint32Array(a.buffer, a.byteOffset, a.length).every(
            (v, i) =>
              v === new Uint32Array(b.buffer, b.byteOffset, b.length)[i],
          );
      try {
        const [whole, loaded, bytes] = await Promise.all([
          p.floatWetMix(source, carried, coverage, options),
          p.floatWetLoad(source, {
            color: [4.5, -2.25, 13.125, 0.375],
            load: 0.37,
          }),
          p.process(new Uint8ClampedArray([71, 88, 99, 255]), []),
        ]);
        const final = await p.floatWetEnvelope(
            source,
            whole.pixels,
            coverage,
            0.375,
          ),
          pixels = new Float32Array(source.length),
          next = new Float32Array(source.length),
          envelope = new Float32Array(source.length),
          load = new Float32Array(source.length);
        for (let at = 0; at < count; at += 8191) {
          const end = Math.min(count, at + 8191),
            s = source.subarray(at * 4, end * 4),
            m = coverage.subarray(at, end),
            part = await p.floatWetMix(
              s,
              carried.subarray(at * 4, end * 4),
              m,
              options,
            );
          pixels.set(part.pixels, at * 4);
          next.set(part.carried, at * 4);
          envelope.set(
            await p.floatWetEnvelope(s, part.pixels, m, 0.375),
            at * 4,
          );
          load.set(
            await p.floatWetLoad(s, {
              color: [4.5, -2.25, 13.125, 0.375],
              load: 0.37,
            }),
            at * 4,
          );
        }
        return {
          count,
          partitions: Math.ceil(count / 8191),
          pixels: same(pixels, whole.pixels),
          carried: same(next, whole.carried),
          envelope: same(envelope, final),
          load: same(load, loaded),
          byteOutput: [...bytes],
        };
      } finally {
        p.dispose();
      }
    },
    await inputs(),
  );
  expect(result).toEqual({
    count: 65539,
    partitions: 9,
    pixels: true,
    carried: true,
    envelope: true,
    load: true,
    byteOutput: [71, 88, 99, 255],
  });
  await writeFile(
    info.outputPath("float-wet-worker-windows.json"),
    JSON.stringify(result, null, 2),
  );
});
