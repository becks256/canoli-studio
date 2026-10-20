import { expect, test } from '@playwright/test';

test('native worker captures paint, reservoir, coverage and settings before readiness without detaching callers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor = new PixelProcessor();
    try {
      const source = new Uint8ClampedArray([255, 0, 0, 255]), options = { load: .5, color: [0, 0, 255, 255] as [number, number, number, number] };
      const pendingLoad = processor.loadWetPaint(source, options);
      source.fill(0); options.load = 0; options.color.fill(0);
      const loaded = await pendingLoad, captured = [...loaded];
      const pixels = new Uint8ClampedArray([0, 0, 0, 0]), coverage = new Uint8Array([255]), settings = { flow: .5, wetness: 0, pickup: 0 };
      const pending = processor.mixWetPaint(pixels, loaded, coverage, settings);
      pixels.fill(255); loaded.fill(0); coverage.fill(0); settings.flow = 0; settings.pickup = 1;
      const mixed = await pending;
      return { captured, pixels: [...mixed.pixels], carried: [...mixed.carried], callerPixels: [...pixels], callerCarry: [...loaded], source: [...source], lengths: [pixels.byteLength, loaded.byteLength, coverage.byteLength, source.byteLength] };
    } finally { processor.dispose(); }
  });
  expect(result).toEqual({ captured: [.5, 0, .5, 1], pixels: [128, 0, 128, 128], carried: [.5, 0, .5, 1], callerPixels: [255, 255, 255, 255], callerCarry: [0, 0, 0, 0], source: [0, 0, 0, 0], lengths: [4, 16, 1, 4] });
});

test('native paint transport deposits alpha, lifts alpha and mixes acquired pigment on subsequent dabs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor = new PixelProcessor();
    try {
      const red = new Uint8ClampedArray([255, 0, 0, 255]), blue = new Uint8ClampedArray([0, 0, 255, 255]), clear = new Uint8ClampedArray([0, 255, 0, 0]), mask = new Uint8Array([255]);
      const carried = await processor.loadWetPaint(red);
      const outward = await processor.mixWetPaint(clear, carried, mask, { pickup: 0 });
      const empty = await processor.loadWetPaint(clear);
      const inward = await processor.mixWetPaint(red, empty, mask, { pickup: 0 });
      const first = await processor.mixWetPaint(blue, carried, mask, { wetness: .25, pickup: .5 });
      const second = await processor.mixWetPaint(clear, first.carried, mask, { pickup: 1 });
      const third = await processor.mixWetPaint(clear, second.carried, mask);
      return { outward: [...outward.pixels], inward: [...inward.pixels], first: [...first.pixels], second: [...second.pixels], exhausted: [...third.pixels], original: [...red, ...blue, ...clear] };
    } finally { processor.dispose(); }
  });
  expect(result).toEqual({ outward: [255, 0, 0, 255], inward: [0, 0, 0, 0], first: [191, 0, 64, 255], second: [128, 0, 128, 255], exhausted: [0, 0, 0, 0], original: [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0] });
});

test('concurrent wet paint and ordinary worker operations retain request identity and private outputs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor = new PixelProcessor();
    try {
      const pixels = new Uint8ClampedArray([0, 0, 0, 0]), carry = new Float32Array([1, 0, 0, 1]), mask = new Uint8Array([255]);
      const [small, texture, load, large] = await Promise.all([
        processor.mixWetPaint(pixels, carry, mask, { flow: .25, pickup: 0 }),
        processor.brushTexture(new Uint8ClampedArray([0, 0, 0, 117]), { channel: 'alpha' }),
        processor.loadWetPaint(new Uint8ClampedArray([0, 255, 0, 255])),
        processor.mixWetPaint(new Uint8ClampedArray(512 * 512 * 4), new Float32Array(512 * 512 * 4).map((_, i) => i % 4 === 0 || i % 4 === 3 ? 1 : 0), new Uint8Array(512 * 512).fill(255)),
      ]);
      large.carried.fill(0); large.pixels.fill(0); texture.fill(0);
      return { small: [...small.pixels], carried: [...small.carried], loaded: [...load], inputs: [...pixels, ...carry, ...mask], lengths: [pixels.byteLength, carry.byteLength, mask.byteLength] };
    } finally { processor.dispose(); }
  });
  expect(result).toEqual({ small: [255, 0, 0, 64], carried: [1, 0, 0, 1], loaded: [0, 1, 0, 1], inputs: [0, 0, 0, 0, 1, 0, 0, 1, 255], lengths: [4, 16, 1] });
});

test('native worker rejects invalid paint requests and continues with exact valid alpha transport', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor = new PixelProcessor();
    try {
      const pixels = new Uint8ClampedArray([255, 0, 0, 255]), carry = new Float32Array([0, 0, 0, 0]), mask = new Uint8Array([128]), errors: string[] = [];
      const requests = [
        () => processor.mixWetPaint(pixels, new Float32Array([1, 0, 0, .5]), mask),
        () => processor.mixWetPaint(pixels, new Float32Array([NaN, 0, 0, 0]), mask),
        () => processor.mixWetPaint(pixels, carry, new Uint8Array(2)),
        () => processor.mixWetPaint(pixels, carry, mask, { wetness: 2 }),
        () => processor.loadWetPaint(pixels, { color: [255, 0, 0, 256] }),
      ];
      for (const request of requests) try { await request(); } catch (error) { errors.push(String(error)); }
      const restored = await processor.mixWetPaint(pixels, carry, mask, { pickup: 0 });
      const partial = await processor.loadWetPaint(new Uint8ClampedArray([255, 0, 0, 1]));
      return { errors, pixels: [...restored.pixels], fractional: [...partial], inputs: [...pixels, ...carry, ...mask] };
    } finally { processor.dispose(); }
  });
  expect(result.errors).toHaveLength(5);
  expect(result.errors[0]).toContain('premultiplied'); expect(result.errors[1]).toContain('premultiplied'); expect(result.errors[2]).toContain('coverage');
  expect(result.pixels).toEqual([255, 0, 0, 127]); expect(result.fractional[0]).toBeCloseTo(1 / 255, 7); expect(result.fractional[3]).toBe(result.fractional[0]);
  expect(result.inputs).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 128]);
});

test('native worker preserves exact dab results across different working-tile partitions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String('/src/engine/processor.ts'));
    const processor = new PixelProcessor();
    try {
      const count = 977, pixels = Uint8ClampedArray.from({ length: count * 4 }, (_, i) => i * 73 % 256), source = Uint8ClampedArray.from(pixels, (_, i) => i * 17 % 256), mask = Uint8Array.from({ length: count }, (_, i) => i * 19 % 256);
      const carry = await processor.loadWetPaint(source, { color: [177, 83, 23, 191], load: .31 }), settings = { flow: .59, pickup: .47, wetness: .17 };
      const whole = await processor.mixWetPaint(pixels, carry, mask, settings), tiled = { pixels: new Uint8ClampedArray(count * 4), carried: new Float32Array(count * 4) };
      for (let end = count; end > 0;) {
        const start = Math.max(0, end - 83), tile = await processor.mixWetPaint(pixels.subarray(start * 4, end * 4), carry.subarray(start * 4, end * 4), mask.subarray(start, end), settings);
        tiled.pixels.set(tile.pixels, start * 4); tiled.carried.set(tile.carried, start * 4); end = start;
      }
      return { exactPixels: whole.pixels.every((v: number, i: number) => tiled.pixels[i] === v), exactCarried: whole.carried.every((v: number, i: number) => tiled.carried[i] === v), components: whole.pixels.length };
    } finally { processor.dispose(); }
  });
  expect(result).toEqual({ exactPixels: true, exactCarried: true, components: 3908 });
});
