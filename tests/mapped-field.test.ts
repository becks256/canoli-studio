import { beforeAll, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import {
  compileProjectiveField,
  type ProjectiveFieldOptions,
} from "../src/core/projective-field";
import {
  captureFieldMapping,
  compileMappedField,
  fieldMappingFromFrame,
  type FieldMapping,
  type MappedFieldOptions,
} from "../src/core/mapped-field";
import { FloatPixelProcessor } from "../src/engine/float-pixels";
import { instantiateKernel } from "../src/engine/wasm";
import {
  projectMappedFieldWindow,
  type MappedFieldSource,
} from "../src/engine/projective-field";
import type { FloatSourceWindow } from "../src/core/float-source/types";

const folder = "tests/fixtures/projective-field/";
const reverse = JSON.parse(await readFile(folder + "manifest.json", "utf8")),
  forward = JSON.parse(
    await readFile(folder + "forward-manifest.json", "utf8"),
  );
let native: FloatPixelProcessor, original: Float32Array;
beforeAll(async () => {
  native = new FloatPixelProcessor(
    await instantiateKernel(
      new Uint8Array(await readFile("public/wasm/pixels.wasm")),
    ),
  );
  original = new Float32Array(
    new Uint8Array(gunzipSync(await readFile(folder + "source.f32le.gz")))
      .buffer,
  );
});
const sampler = {
  floatMappedField: async (p: Float32Array, o: MappedFieldOptions) =>
    native.mappedField(p, o),
};
function source(
  field: FloatSourceWindow,
  background: number,
  reads: FloatSourceWindow[] = [],
): MappedFieldSource {
  return {
    bounds: { ...field },
    background,
    readWindow: async (b) => {
      reads.push({ ...b });
      const out = new Float32Array(b.width * b.height);
      for (let y = 0; y < b.height; y++)
        out.set(
          original.subarray(
            (b.y - field.y + y) * field.width + b.x - field.x,
            (b.y - field.y + y) * field.width + b.x - field.x + b.width,
          ),
          y * b.width,
        );
      return out;
    },
  };
}
const identity: FieldMapping = {
  matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  inputOrigin: { x: 0, y: 0 },
  sourceOrigin: { x: 0, y: 0 },
};

for (const row of [
  ...reverse.cases,
  ...forward.cases.map((r: any) => ({ ...r, name: "forward " + r.name })),
])
  it(`retained native field map preserves every ABI word and sample for ${row.name}`, async () => {
    const options = row.options as ProjectiveFieldOptions,
      frame = compileProjectiveField(options),
      mapping = fieldMappingFromFrame(frame),
      settings = {
        mapping,
        field: options.field,
        source: options.source,
        output: options.output,
        background: options.background,
      };
    const compiled = compileMappedField(settings);
    expect(new BigUint64Array(compiled.values.buffer)).toEqual(
      new BigUint64Array(frame.values.buffer),
    );
    const before = original.slice(),
      expected = native.projectiveField(original, options),
      actual = native.mappedField(original, settings),
      reads: FloatSourceWindow[] = [];
    expect(new Uint32Array(actual.buffer)).toEqual(
      new Uint32Array(expected.buffer),
    );
    expect(original).toEqual(before);
    const streamed = await projectMappedFieldWindow(
      source(options.field, options.background, reads),
      sampler,
      mapping,
      options.output,
    );
    expect(new Uint32Array(streamed.buffer)).toEqual(
      new Uint32Array(expected.buffer),
    );
    expect(reads.every((b) => b.width * b.height <= 262144)).toBe(true);
    const independent = new Float32Array(
      new Uint8Array(gunzipSync(await readFile(folder + row.reference))).buffer,
    );
    let maximum = 0;
    for (let i = 0; i < actual.length; i++)
      maximum = Math.max(maximum, Math.abs(actual[i] - independent[i]));
    expect(maximum).toBeLessThanOrEqual(reverse.absoluteError);
    const split = new Float32Array(actual.length),
      b = options.output;
    for (let y = 0; y < b.height; y += 7)
      for (let x = 0; x < b.width; x += 11) {
        const region = {
            x: b.x + x,
            y: b.y + y,
            width: Math.min(11, b.width - x),
            height: Math.min(7, b.height - y),
          },
          part = await projectMappedFieldWindow(
            source(options.field, options.background),
            sampler,
            mapping,
            region,
          );
        for (let row = 0; row < region.height; row++)
          split.set(
            part.subarray(row * region.width, (row + 1) * region.width),
            (y + row) * b.width + x,
          );
      }
    expect(new Uint32Array(split.buffer)).toEqual(
      new Uint32Array(actual.buffer),
    );
  });

it("retains separated large origins and captured affine input without changing native arithmetic", async () => {
  const base = forward.cases[0].options,
    options: ProjectiveFieldOptions = {
      ...base,
      input: {
        origin: { x: 2 ** 40 + 0.125, y: -(2 ** 40) + 0.375 },
        matrix: { a: 1, b: 0, c: 0, d: 1, e: 5.125, f: 0.375 },
      },
      output: { x: 2 ** 40, y: -(2 ** 40), width: 10, height: 8 },
    },
    mapping = fieldMappingFromFrame(compileProjectiveField(options));
  const expected = native.projectiveField(original, options),
    actual = await projectMappedFieldWindow(
      source(options.field, options.background),
      sampler,
      mapping,
      options.output,
    );
  expect(new Uint32Array(actual.buffer)).toEqual(
    new Uint32Array(expected.buffer),
  );
});

it("samples an arbitrary horizon-crossing chart against an independent complete bilinear reference", async () => {
  const mapping: FieldMapping = {
      ...identity,
      matrix: [1, 0, 0.125, 0, 1, -0.375, 0, 1, -1.5],
    },
    field = { x: -8, y: -8, width: 17, height: 17 },
    output = { x: -4, y: -4, width: 9, height: 10 },
    background = 0.375;
  const pixels = Float32Array.from(
      { length: field.width * field.height },
      (_, i) => ((i * 7) % 31) / 30,
    ),
    reads: FloatSourceWindow[] = [];
  const input: MappedFieldSource = {
    bounds: field,
    background,
    readWindow: async (b) => {
      reads.push({ ...b });
      const out = new Float32Array(b.width * b.height);
      for (let y = 0; y < b.height; y++)
        out.set(
          pixels.subarray(
            (b.y - field.y + y) * field.width + b.x - field.x,
            (b.y - field.y + y) * field.width + b.x - field.x + b.width,
          ),
          y * b.width,
        );
      return out;
    },
  };
  const actual = await projectMappedFieldWindow(
      input,
      sampler,
      mapping,
      output,
    ),
    expected = new Float32Array(actual.length);
  for (let row = 0; row < output.height; row++)
    for (let col = 0; col < output.width; col++) {
      const x = output.x + col + 0.5,
        y = output.y + row + 0.5,
        w = y - 1.5,
        at = row * output.width + col;
      if (w === 0) {
        expected[at] = background;
        continue;
      }
      const u = (x + 0.125) / w - 0.5,
        v = (y - 0.375) / w - 0.5,
        ix = Math.floor(u),
        iy = Math.floor(v),
        fx = u - ix,
        fy = v - iy;
      let value = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const px = ix + dx,
            py = iy + dy,
            sample =
              px >= field.x &&
              py >= field.y &&
              px < field.x + field.width &&
              py < field.y + field.height
                ? pixels[(py - field.y) * field.width + px - field.x]
                : background;
          value += sample * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        }
      expected[at] = value;
    }
  let maximum = 0;
  for (let i = 0; i < actual.length; i++)
    maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
  expect(maximum).toBeLessThanOrEqual(6e-8);
  expect(
    actual.subarray(
      (1 - output.y) * output.width,
      (2 - output.y) * output.width,
    ),
  ).toEqual(new Float32Array(output.width).fill(background));
  expect(reads.length).toBeGreaterThan(0);
  expect(actual.some((v) => v !== background)).toBe(true);
});

it("streams unknown support and minifies a 50 MP field with bounded native neighborhoods", async () => {
  const unknown: MappedFieldSource = {
    bounds: undefined,
    background: 0,
    readWindow: async (b) =>
      Float32Array.from(
        { length: b.width * b.height },
        (_, i) => ((((b.x + (i % b.width)) % 7) + 7) % 7) / 8,
      ),
  };
  const output = { x: -700002, y: 480000, width: 23, height: 19 },
    actual = await projectMappedFieldWindow(unknown, sampler, identity, output);
  expect([...actual]).toEqual(
    Array.from(
      { length: 23 * 19 },
      (_, i) => ((((output.x + (i % 23)) % 7) + 7) % 7) / 8,
    ),
  );
  const reads: FloatSourceWindow[] = [],
    mapping: FieldMapping = {
      ...identity,
      matrix: [10000, 0, 0, 0, 5000, 0, 0, 0, 1],
    },
    field = { x: 0, y: 0, width: 10000, height: 5000 };
  const result = await projectMappedFieldWindow(
    {
      bounds: field,
      background: 1,
      readWindow: async (b) => {
        reads.push({ ...b });
        return new Float32Array(b.width * b.height).fill(0.25);
      },
    },
    sampler,
    mapping,
    { x: 0, y: 0, width: 1, height: 1 },
  );
  expect([...result]).toEqual([0.25]);
  expect(reads).toHaveLength(1);
  expect(reads[0].width * reads[0].height).toBeLessThanOrEqual(16);
});

it("captures mutable maps before awaits and rejects source changes, cancellation and malformed native replies", async () => {
  const row = reverse.cases[0].options as ProjectiveFieldOptions,
    mapping = structuredClone(
      fieldMappingFromFrame(compileProjectiveField(row)),
    ),
    expected = native.projectiveField(original, row),
    pending = projectMappedFieldWindow(
      source(row.field, row.background),
      sampler,
      mapping,
      row.output,
    );
  (mapping.matrix as unknown as number[])[0] = 999;
  mapping.inputOrigin.x = 1e9;
  expect(new Uint32Array((await pending).buffer)).toEqual(
    new Uint32Array(expected.buffer),
  );
  for (const change of ["geometry", "abort", "read"] as const) {
    const input = source(row.field, row.background),
      read = input.readWindow,
      abort = new AbortController();
    input.readWindow = async (b) => {
      const result = await read(b);
      if (change === "geometry") input.bounds!.width++;
      if (change === "abort") abort.abort();
      if (change === "read") input.readWindow = async () => result;
      return result;
    };
    await expect(
      projectMappedFieldWindow(
        input,
        sampler,
        fieldMappingFromFrame(compileProjectiveField(row)),
        row.output,
        { signal: abort.signal },
      ),
    ).rejects.toThrow();
  }
  await expect(
    projectMappedFieldWindow(
      source(row.field, row.background),
      { floatMappedField: async () => new Float32Array(0) },
      fieldMappingFromFrame(compileProjectiveField(row)),
      row.output,
    ),
  ).rejects.toThrow(/expected length/);
});

it("strict private maps reject singular coefficients, missing neighborhoods and unsupported working allocations", () => {
  const settings: MappedFieldOptions = {
    mapping: identity,
    field: { x: 0, y: 0, width: 2, height: 2 },
    source: { x: 0, y: 0, width: 2, height: 2 },
    output: { x: 0, y: 0, width: 2, height: 2 },
    background: 0,
  };
  for (const mapping of [
    { ...identity, matrix: [1, 0, 0, 0, 0, 0, 0, 0, 1] },
    { ...identity, unknown: true },
    { ...identity, sourceOrigin: { x: 0.5, y: 0 } },
    { ...identity, inputOrigin: { x: Infinity, y: 0 } },
  ])
    expect(() => captureFieldMapping(mapping as never)).toThrow();
  expect(() =>
    compileMappedField({ ...settings, unexpected: true } as never),
  ).toThrow();
  expect(() =>
    compileMappedField({
      ...settings,
      source: { x: 2, y: 0, width: 1, height: 1 },
    }),
  ).toThrow(/outside/);
  expect(() =>
    compileMappedField({
      ...settings,
      output: { x: 0, y: 0, width: 513, height: 512 },
    }),
  ).toThrow(/budget/);
  expect(() =>
    native.mappedField(new Float32Array(1), {
      ...settings,
      source: { x: 0, y: 0, width: 1, height: 1 },
    }),
  ).toThrow(/captured field/);
  expect(() =>
    native.mappedField(new Float32Array(4).fill(NaN), settings),
  ).toThrow(/coverage/);
});

it("owns origin-on-horizon mappings without inventing a finite reference quad", async () => {
  const mapping: FieldMapping = {
      matrix: [0, 0, 1, 0, 1, 0, 1, 0, 0],
      inputOrigin: { x: 0.5, y: 0 },
      sourceOrigin: { x: 0, y: 0 },
    },
    captured = captureFieldMapping(mapping);
  expect(
    Object.isFrozen(captured) &&
      Object.isFrozen(captured.matrix) &&
      Object.isFrozen(captured.inputOrigin) &&
      Object.isFrozen(captured.sourceOrigin),
  ).toBe(true);
  const bounds = { x: -8, y: -8, width: 17, height: 17 },
    output = { x: -2, y: -2, width: 5, height: 5 },
    pixels = new Float32Array(17 * 17).fill(0.25);
  const actual = await projectMappedFieldWindow(
      {
        bounds,
        background: 1,
        readWindow: async (b) =>
          new Float32Array(b.width * b.height).fill(0.25),
      },
      sampler,
      mapping,
      output,
    ),
    full = native.mappedField(pixels, {
      mapping,
      field: bounds,
      source: bounds,
      output,
      background: 1,
    });
  expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(full.buffer));
  for (let y = 0; y < 5; y++) expect(actual[y * 5 + 2]).toBe(1);
  expect(actual.some((v) => v === 0.25)).toBe(true);
});

it("preserves homogeneous coefficient scales and signed-zero background without a magnitude cutoff", async () => {
  const field = { x: -2, y: -2, width: 5, height: 5 },
    output = { x: -4, y: -3, width: 9, height: 7 },
    pixels = Float32Array.from({ length: 25 }, (_, i) => i / 32);
  const input: MappedFieldSource = {
    bounds: field,
    background: -0,
    readWindow: async (b) => {
      const out = new Float32Array(b.width * b.height);
      for (let y = 0; y < b.height; y++)
        out.set(
          pixels.subarray(
            (b.y - field.y + y) * 5 + b.x - field.x,
            (b.y - field.y + y) * 5 + b.x - field.x + b.width,
          ),
          y * b.width,
        );
      return out;
    },
  };
  let expected: Uint32Array | undefined;
  for (const scale of [2 ** -500, 1, 2 ** 500]) {
    const mapping: FieldMapping = {
        ...identity,
        matrix: identity.matrix.map(
          (v) => v * scale,
        ) as unknown as FieldMapping["matrix"],
      },
      settings = { mapping, field, source: field, output, background: -0 },
      compiled = compileMappedField(settings);
    expect([...compiled.values.subarray(0, 9)]).toEqual(mapping.matrix);
    const direct = native.mappedField(pixels, settings),
      actual = await projectMappedFieldWindow(input, sampler, mapping, output),
      words = new Uint32Array(actual.buffer);
    expect(words).toEqual(new Uint32Array(direct.buffer));
    if (expected) expect(words).toEqual(expected);
    else expected = words;
    expect(words[0]).toBe(0x80000000);
  }
});
